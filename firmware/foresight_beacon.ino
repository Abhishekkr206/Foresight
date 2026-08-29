/*
 * Foresight ESP32-S3 acoustic beacon
 *
 * Default wiring:
 *   INMP441 SCK/BCLK -> GPIO5
 *   INMP441 WS/LRCLK -> GPIO6
 *   INMP441 SD       -> GPIO7
 *   INMP441 L/R      -> GND (left channel)
 *   Battery divider  -> GPIO4
 *
 * Coordinates are intentionally not present in this firmware. The backend
 * owns deployment coordinates through beacons_config.json.
 */
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <driver/i2s.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASSWORD = "YOUR_PASSWORD";
const char* API_BASE_URL = "http://192.168.1.100:8000";
const char* BEACON_ID = "BEACON_01";

constexpr i2s_port_t I2S_PORT = I2S_NUM_0;
constexpr int I2S_BCLK_PIN = 5;
constexpr int I2S_WS_PIN = 6;
constexpr int I2S_DATA_PIN = 7;
constexpr int BATTERY_ADC_PIN = 4;

constexpr uint32_t SAMPLE_RATE = 16000;
constexpr uint32_t CAPTURE_SECONDS = 5;
constexpr uint32_t SAMPLE_COUNT = SAMPLE_RATE * CAPTURE_SECONDS;
constexpr uint32_t AUDIO_INTERVAL_MS = 7000;
constexpr uint32_t HEARTBEAT_INTERVAL_MS = 12000;
constexpr float BATTERY_DIVIDER_RATIO = 2.0f;
constexpr float BATTERY_EMPTY_VOLTS = 3.20f;
constexpr float BATTERY_FULL_VOLTS = 4.20f;

uint32_t lastAudio = 0;
uint32_t lastHeartbeat = 0;

void writeLE16(uint8_t* target, uint16_t value) {
  target[0] = value & 0xff;
  target[1] = (value >> 8) & 0xff;
}

void writeLE32(uint8_t* target, uint32_t value) {
  target[0] = value & 0xff;
  target[1] = (value >> 8) & 0xff;
  target[2] = (value >> 16) & 0xff;
  target[3] = (value >> 24) & 0xff;
}

bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 15000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi connected: ");
    Serial.println(WiFi.localIP());
    return true;
  }
  Serial.println("Wi-Fi connection failed");
  return false;
}

float batteryPercent() {
  float measuredVolts = analogReadMilliVolts(BATTERY_ADC_PIN) / 1000.0f;
  float batteryVolts = measuredVolts * BATTERY_DIVIDER_RATIO;
  float percent = (batteryVolts - BATTERY_EMPTY_VOLTS) /
                  (BATTERY_FULL_VOLTS - BATTERY_EMPTY_VOLTS) * 100.0f;
  return constrain(percent, 0.0f, 100.0f);
}

void postHeartbeat() {
  if (!connectWifi()) return;
  HTTPClient client;
  String endpoint = String(API_BASE_URL) + "/api/ingest/heartbeat";
  client.begin(endpoint);
  client.addHeader("Content-Type", "application/json");
  String body = String("{\"beacon_id\":\"") + BEACON_ID +
                "\",\"battery_percentage\":" + String(batteryPercent(), 1) + "}";
  int response = client.POST(body);
  Serial.printf("Heartbeat response: %d\n", response);
  client.end();
}

bool configureI2S() {
  i2s_config_t config = {};
  config.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
  config.sample_rate = SAMPLE_RATE;
  config.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
  config.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;
  config.communication_format = I2S_COMM_FORMAT_I2S;
  config.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  config.dma_buf_count = 8;
  config.dma_buf_len = 256;
  config.use_apll = false;
  config.tx_desc_auto_clear = false;
  config.fixed_mclk = 0;

  i2s_pin_config_t pins = {};
  pins.bck_io_num = I2S_BCLK_PIN;
  pins.ws_io_num = I2S_WS_PIN;
  pins.data_out_num = I2S_PIN_NO_CHANGE;
  pins.data_in_num = I2S_DATA_PIN;

  esp_err_t result = i2s_driver_install(I2S_PORT, &config, 0, nullptr);
  if (result != ESP_OK) return false;
  result = i2s_set_pin(I2S_PORT, &pins);
  if (result != ESP_OK) return false;
  i2s_zero_dma_buffer(I2S_PORT);
  return true;
}

uint8_t* captureWav(size_t* outputLength) {
  constexpr size_t headerLength = 44;
  const size_t pcmLength = SAMPLE_COUNT * sizeof(int16_t);
  uint8_t* wav = static_cast<uint8_t*>(malloc(headerLength + pcmLength));
  if (!wav) {
    Serial.println("Audio allocation failed");
    return nullptr;
  }

  memset(wav, 0, headerLength);
  memcpy(wav, "RIFF", 4);
  writeLE32(wav + 4, headerLength + pcmLength - 8);
  memcpy(wav + 8, "WAVEfmt ", 8);
  writeLE32(wav + 16, 16);
  writeLE16(wav + 20, 1);
  writeLE16(wav + 22, 1);
  writeLE32(wav + 24, SAMPLE_RATE);
  writeLE32(wav + 28, SAMPLE_RATE * sizeof(int16_t));
  writeLE16(wav + 32, sizeof(int16_t));
  writeLE16(wav + 34, 16);
  memcpy(wav + 36, "data", 4);
  writeLE32(wav + 40, pcmLength);

  int16_t* destination = reinterpret_cast<int16_t*>(wav + headerLength);
  int32_t raw[256];
  size_t written = 0;
  while (written < SAMPLE_COUNT) {
    size_t bytesRead = 0;
    esp_err_t result = i2s_read(I2S_PORT, raw, sizeof(raw), &bytesRead, portMAX_DELAY);
    if (result != ESP_OK) {
      free(wav);
      return nullptr;
    }
    size_t samplesRead = bytesRead / sizeof(int32_t);
    for (size_t index = 0; index < samplesRead && written < SAMPLE_COUNT; ++index) {
      int32_t shifted = raw[index] >> 14;
      destination[written++] = static_cast<int16_t>(constrain(shifted, -32768, 32767));
    }
  }

  *outputLength = headerLength + pcmLength;
  return wav;
}

void postAudio(const uint8_t* wav, size_t length) {
  if (!connectWifi()) return;
  WiFiClient connection;
  HTTPClient client;
  String boundary = "----ForesightBoundary";
  String endpoint = String(API_BASE_URL) + "/api/ingest/audio?beacon_id=" + BEACON_ID;
  String prefix = "--" + boundary +
    "\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"capture.wav\"" +
    "\r\nContent-Type: audio/wav\r\n\r\n";
  String suffix = "\r\n--" + boundary + "--\r\n";
  size_t bodyLength = prefix.length() + length + suffix.length();
  uint8_t* body = static_cast<uint8_t*>(malloc(bodyLength));
  if (!body) {
    Serial.println("Multipart allocation failed");
    return;
  }
  memcpy(body, prefix.c_str(), prefix.length());
  memcpy(body + prefix.length(), wav, length);
  memcpy(body + prefix.length() + length, suffix.c_str(), suffix.length());

  client.begin(connection, endpoint);
  client.addHeader("Content-Type", "multipart/form-data; boundary=" + boundary);
  int response = client.POST(body, bodyLength);
  Serial.printf("Audio response: %d (%u bytes)\n", response, static_cast<unsigned>(length));
  client.end();
  free(body);
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  pinMode(BATTERY_ADC_PIN, INPUT);
  if (!configureI2S()) Serial.println("I2S configuration failed");
  connectWifi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();

  uint32_t now = millis();
  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeat = now;
    postHeartbeat();
  }

  if (now - lastAudio >= AUDIO_INTERVAL_MS) {
    lastAudio = now;
    size_t wavLength = 0;
    uint8_t* wav = captureWav(&wavLength);
    if (wav) {
      postAudio(wav, wavLength);
      free(wav);
    }
  }
}