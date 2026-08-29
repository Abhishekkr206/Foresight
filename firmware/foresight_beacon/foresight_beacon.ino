/*
 * FORESIGHT ESP32-S3 Acoustic Beacon
 * + Real-time OLED oscilloscope waveform (SSD1306)
 * + Live Serial tuning for gain / noise floor / peak range
 *
 * ARCHITECTURE:
 *   Two independent tasks connected only by a FreeRTOS queue.
 *
 *   CAPTURE TASK (Arduino loop(), core 1):
 *     Continuously reads I2S at real-time cadence and feeds the OLED.
 *     This task NEVER touches WiFi/HTTP, so it can never be stalled
 *     by a slow network. This is what makes the waveform smooth.
 *
 *   NETWORK TASK (core 0):
 *     Handles WiFi connect, heartbeat POST, and streaming audio
 *     chunks pulled from the queue to the backend. Free to block on
 *     slow network calls - it can never affect the display.
 *
 *   The queue buffers ~1 second of audio, enough to absorb short
 *   network hiccups without losing samples. If the network stalls
 *   longer than that, a few chunks of that capture may be dropped
 *   (logged), but the display and mic capture never freeze.
 *
 * INMP441:
 *   SCK/BCLK -> GPIO5
 *   WS/LRCLK -> GPIO3
 *   SD       -> GPIO4
 *   L/R      -> GND
 *
 * OLED:
 *   SDA -> GPIO6
 *   SCL -> GPIO7
 *   ADDR -> 0x3C
 *
 * LIVE TUNING (Serial Monitor, 115200 baud, newline-terminated):
 *   gain 5.0      -> SENSITIVITY (higher = taller waveform)
 *   floor 150     -> NOISE_FLOOR (higher = more silence gets zeroed)
 *   range 8000    -> peak range (lower = quiet sounds fill more of the screen)
 */

#include <Arduino.h>
#include <WiFi.h>
#include <driver/i2s.h>
#include <HTTPClient.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ============================================================
// NETWORK
// ============================================================

const char* WIFI_SSID = "gege-2-4ghz";
const char* WIFI_PASSWORD = "pjk@77#G";

const char* API_HOST = "192.168.29.230";
const uint16_t API_PORT = 8000;
const char* API_BASE_URL = "http://192.168.29.230:8000";

const char* BEACON_ID = "BEACON_01";

// ============================================================
// I2S / AUDIO
// ============================================================

constexpr i2s_port_t I2S_PORT = I2S_NUM_0;

constexpr int I2S_BCLK_PIN = 5;
constexpr int I2S_WS_PIN   = 3;
constexpr int I2S_DATA_PIN = 4;

constexpr uint32_t SAMPLE_RATE = 16000;
constexpr uint32_t CAPTURE_SECONDS = 5;
constexpr uint32_t SAMPLE_COUNT = SAMPLE_RATE * CAPTURE_SECONDS;

constexpr size_t I2S_CHUNK_SAMPLES = 256; // matches dma_buf_len

// ============================================================
// MICROPHONE SENSITIVITY (DIGITAL) - live-tunable over Serial
// ============================================================
// Only touched by the capture task (main loop) and by
// handleSerialTuning() (also main loop) - no cross-task race.
constexpr int RAW_TO_16BIT_SHIFT = 16;

float SENSITIVITY = 3.0f;
int16_t NOISE_FLOOR = 100;

// ============================================================
// OLED WAVEFORM DISPLAY
// ============================================================
#define OLED_SDA_PIN     6
#define OLED_SCL_PIN     7
#define OLED_SCREEN_WIDTH  128
#define OLED_SCREEN_HEIGHT 64
#define OLED_RESET       -1
#define OLED_ADDR        0x3C

Adafruit_SSD1306 oledDisplay(OLED_SCREEN_WIDTH, OLED_SCREEN_HEIGHT, &Wire, OLED_RESET);
bool oledAvailable = false;

int16_t waveBuffer[OLED_SCREEN_WIDTH];

constexpr int WAVE_SAMPLES_PER_COLUMN = 64;
long waveMaxPeakRange = 12000; // live-tunable via "range"

constexpr uint32_t DISPLAY_UPDATE_INTERVAL_MS = 40;
uint32_t lastDisplayUpdateMs = 0;

// ============================================================
// TIMING
// ============================================================

constexpr uint32_t AUDIO_INTERVAL_MS = 7000;
constexpr uint32_t HEARTBEAT_INTERVAL_MS = 12000;

uint32_t lastAudioTrigger = 0; // owned by capture task only
uint32_t lastHeartbeat = 0;    // owned by network task only

// ============================================================
// MULTIPART
// ============================================================

const char* BOUNDARY = "----ForesightBoundary";

// ============================================================
// CAPTURE <-> NETWORK QUEUE
// ============================================================
// Sized to buffer ~1s of audio (40 * 256 samples @ 16kHz = 10240
// samples = 0.64s). Enough to absorb short network hiccups without
// stalling the capture task or losing samples.
constexpr int STREAM_QUEUE_LEN = 40;

struct StreamMsg {
    bool isControl;   // true = start/end marker, false = audio data
    bool isStart;     // valid only if isControl: true=start, false=end
    int16_t samples[I2S_CHUNK_SAMPLES];
    size_t sampleCount;
};

QueueHandle_t streamQueue;

uint32_t droppedChunkCount = 0;
uint32_t lastDropLogMs = 0;

// ============================================================
// WAV HEADER
// ============================================================

void writeLE16(uint8_t* target, uint16_t value)
{
    target[0] = value & 0xFF;
    target[1] = (value >> 8) & 0xFF;
}

void writeLE32(uint8_t* target, uint32_t value)
{
    target[0] = value & 0xFF;
    target[1] = (value >> 8) & 0xFF;
    target[2] = (value >> 16) & 0xFF;
    target[3] = (value >> 24) & 0xFF;
}

void createWavHeader(uint8_t* header, uint32_t pcmLength)
{
    memset(header, 0, 44);
    memcpy(header + 0, "RIFF", 4);
    writeLE32(header + 4, 36 + pcmLength);
    memcpy(header + 8, "WAVE", 4);
    memcpy(header + 12, "fmt ", 4);
    writeLE32(header + 16, 16);
    writeLE16(header + 20, 1);
    writeLE16(header + 22, 1);
    writeLE32(header + 24, SAMPLE_RATE);
    writeLE32(header + 28, SAMPLE_RATE * 2);
    writeLE16(header + 32, 2);
    writeLE16(header + 34, 16);
    memcpy(header + 36, "data", 4);
    writeLE32(header + 40, pcmLength);
}

// ============================================================
// OLED WAVEFORM HELPERS (capture task only)
// ============================================================

int16_t scaleForDisplay(int32_t rawShiftedSample)
{
    int maxSwing = (OLED_SCREEN_HEIGHT / 2) - 2;
    long scaled = ((long)rawShiftedSample * SENSITIVITY * maxSwing) / waveMaxPeakRange;

    if (scaled > maxSwing) scaled = maxSwing;
    if (scaled < -maxSwing) scaled = -maxSwing;

    return (int16_t)scaled;
}

void drawWaveform()
{
    if (!oledAvailable) return;

    oledDisplay.clearDisplay();

    int centerY = OLED_SCREEN_HEIGHT / 2;

    for (int x = 0; x < OLED_SCREEN_WIDTH; x += 4) {
        oledDisplay.drawPixel(x, centerY, SSD1306_WHITE);
    }

    for (int x = 0; x < OLED_SCREEN_WIDTH - 1; x++) {
        int y1 = centerY - waveBuffer[x];
        int y2 = centerY - waveBuffer[x + 1];
        oledDisplay.drawLine(x, y1, x + 1, y2, SSD1306_WHITE);
    }

    oledDisplay.display();
}

void pushWaveformSample(int16_t value)
{
    if (!oledAvailable) return;

    for (int x = 0; x < OLED_SCREEN_WIDTH - 1; x++) {
        waveBuffer[x] = waveBuffer[x + 1];
    }
    waveBuffer[OLED_SCREEN_WIDTH - 1] = value;

    uint32_t now = millis();
    if (now - lastDisplayUpdateMs >= DISPLAY_UPDATE_INTERVAL_MS) {
        lastDisplayUpdateMs = now;
        drawWaveform();
    }
}

// Called on EVERY mic chunk, unconditionally - whether or not we're
// currently uploading. This is what makes the display continuous
// regardless of network state.
void feedWaveformFromRawChunk(const int32_t* rawBuf, size_t sampleCount)
{
    if (!oledAvailable || sampleCount == 0) return;

    size_t idx = 0;
    while (idx < sampleCount) {
        size_t groupEnd = idx + (size_t)WAVE_SAMPLES_PER_COLUMN;
        if (groupEnd > sampleCount) groupEnd = sampleCount;

        int32_t peak = 0;
        for (size_t i = idx; i < groupEnd; i++) {
            int32_t v = rawBuf[i] >> RAW_TO_16BIT_SHIFT;
            if (abs(v) > abs(peak)) peak = v;
        }

        if (abs(peak) < NOISE_FLOOR) peak = 0;

        pushWaveformSample(scaleForDisplay(peak));
        idx = groupEnd;
    }
}

// ============================================================
// LIVE TUNING OVER SERIAL (capture task)
// ============================================================

void handleSerialTuning()
{
    if (!Serial.available()) return;

    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) return;

    int spaceIdx = line.indexOf(' ');
    if (spaceIdx == -1) {
        Serial.println("Usage: gain <float> | floor <int> | range <long>");
        return;
    }

    String cmd = line.substring(0, spaceIdx);
    String valueStr = line.substring(spaceIdx + 1);
    valueStr.trim();
    float value = valueStr.toFloat();

    if (cmd == "gain") {
        if (value <= 0) { Serial.println("Ignored: gain must be > 0"); return; }
        SENSITIVITY = value;
        Serial.printf("SENSITIVITY (gain) set to %.2f\n", SENSITIVITY);
    } else if (cmd == "floor") {
        if (value < 0) { Serial.println("Ignored: floor must be >= 0"); return; }
        NOISE_FLOOR = (int16_t)value;
        Serial.printf("NOISE_FLOOR set to %d\n", NOISE_FLOOR);
    } else if (cmd == "range") {
        if (value <= 0) { Serial.println("Ignored: range must be > 0"); return; }
        waveMaxPeakRange = (long)value;
        Serial.printf("waveMaxPeakRange set to %ld\n", waveMaxPeakRange);
    } else {
        Serial.println("Unknown command. Use: gain <float> | floor <int> | range <long>");
    }
}

// ============================================================
// I2S INITIALIZATION
// ============================================================

bool configureI2S()
{
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
    if (result != ESP_OK) {
        Serial.printf("I2S driver install failed: %d\n", result);
        return false;
    }

    result = i2s_set_pin(I2S_PORT, &pins);
    if (result != ESP_OK) {
        Serial.printf("I2S pin configuration failed: %d\n", result);
        return false;
    }

    i2s_zero_dma_buffer(I2S_PORT);
    Serial.println("I2S configured successfully");
    return true;
}

// ============================================================
// WIFI (network task only)
// ============================================================

bool connectWifi()
{
    if (WiFi.status() == WL_CONNECTED)
        return true;

    Serial.println("Connecting to Wi-Fi...");
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    uint32_t started = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - started < 15000) {
        delay(250);
        Serial.print(".");
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
        Serial.print("Wi-Fi connected. IP: ");
        Serial.println(WiFi.localIP());
        return true;
    }

    Serial.println("Wi-Fi connection failed");
    return false;
}

// ============================================================
// HEARTBEAT (network task only)
// ============================================================

void postHeartbeat()
{
    if (!connectWifi()) return;

    WiFiClient connection;
    HTTPClient client;

    String endpoint = String(API_BASE_URL) + "/api/ingest/heartbeat";

    Serial.print("Heartbeat -> ");
    Serial.println(endpoint);

    client.begin(connection, endpoint);
    client.setTimeout(5000);
    client.addHeader("Content-Type", "application/json");

    String body = String("{\"beacon_id\":\"") + BEACON_ID + "\"}";
    int response = client.POST(body);

    Serial.printf("Heartbeat response: %d\n", response);

    if (response > 0) {
        Serial.print("Backend: ");
        Serial.println(client.getString());
    }

    client.end();
}

// ============================================================
// AUDIO UPLOAD (network task only) - state lives here, single-task
// ============================================================

bool writeAll(WiFiClient& connection, const uint8_t* data, size_t length)
{
    size_t written = 0;
    while (written < length) {
        size_t result = connection.write(data + written, length - written);
        if (result == 0) return false;
        written += result;
        delay(0);
    }
    return true;
}

WiFiClient audioConnection;
bool uploadInProgress = false;

void beginAudioUpload()
{
    if (!connectWifi()) {
        Serial.println("Skipping this capture upload - Wi-Fi unavailable");
        uploadInProgress = false;
        return;
    }

    audioConnection.setTimeout(10000);

    constexpr size_t WAV_HEADER_SIZE = 44;
    constexpr size_t PCM_LENGTH = SAMPLE_COUNT * sizeof(int16_t);
    constexpr size_t WAV_LENGTH = WAV_HEADER_SIZE + PCM_LENGTH;

    String prefix =
        String("--") + BOUNDARY + "\r\n"
        "Content-Disposition: form-data; "
        "name=\"audio\"; "
        "filename=\"capture.wav\"\r\n"
        "Content-Type: audio/wav\r\n"
        "\r\n";

    String suffix = String("\r\n--") + BOUNDARY + "--\r\n";
    size_t contentLength = prefix.length() + WAV_LENGTH + suffix.length();

    Serial.println();
    Serial.println("Connecting to audio backend...");

    if (!audioConnection.connect(API_HOST, API_PORT)) {
        Serial.println("Audio connection failed");
        uploadInProgress = false;
        return;
    }

    Serial.println("Audio connection established");

    String endpoint = String("/api/ingest/audio?beacon_id=") + BEACON_ID;
    audioConnection.print("POST " + endpoint + " HTTP/1.1\r\n");
    audioConnection.print("Host: ");
    audioConnection.print(API_HOST);
    audioConnection.print(":");
    audioConnection.print(API_PORT);
    audioConnection.print("\r\n");
    audioConnection.print("Content-Type: multipart/form-data; boundary=");
    audioConnection.print(BOUNDARY);
    audioConnection.print("\r\n");
    audioConnection.print("Content-Length: ");
    audioConnection.print(contentLength);
    audioConnection.print("\r\n");
    audioConnection.print("Connection: close\r\n");
    audioConnection.print("\r\n");
    audioConnection.print(prefix);

    uint8_t wavHeader[44];
    createWavHeader(wavHeader, PCM_LENGTH);

    if (!writeAll(audioConnection, wavHeader, sizeof(wavHeader))) {
        Serial.println("WAV header network write failed");
        audioConnection.stop();
        uploadInProgress = false;
        return;
    }

    uploadInProgress = true;
    Serial.println("Recording + streaming audio...");
}

void sendAudioChunk(const int16_t* samples, size_t count)
{
    if (!uploadInProgress || count == 0) return;

    if (!writeAll(audioConnection, (const uint8_t*)samples, count * sizeof(int16_t))) {
        Serial.println("Audio network write failed - aborting this capture's upload");
        audioConnection.stop();
        uploadInProgress = false;
    }
}

void finishAudioUpload()
{
    if (!uploadInProgress) return;

    String suffix = String("\r\n--") + BOUNDARY + "--\r\n";
    audioConnection.print(suffix);

    Serial.println("Audio uploaded. Waiting for backend...");

    uint32_t timeoutStart = millis();
    while (!audioConnection.available() && audioConnection.connected() &&
           millis() - timeoutStart < 15000) {
        delay(10); // fine to block here - this is the network task, not the display
    }

    if (audioConnection.available()) {
        String statusLine = audioConnection.readStringUntil('\n');
        statusLine.trim();
        Serial.print("Audio response: ");
        Serial.println(statusLine);

        while (audioConnection.available()) {
            String line = audioConnection.readStringUntil('\n');
            line.trim();
            if (line.length() > 0) {
                Serial.print("Backend: ");
                Serial.println(line);
            }
        }
    } else {
        Serial.println("No response from backend");
    }

    audioConnection.stop();
    uploadInProgress = false;
    Serial.println("Audio upload complete");
}

// ============================================================
// NETWORK TASK (core 0) - the only task allowed to block on WiFi/HTTP
// ============================================================

void networkTask(void* param)
{
    connectWifi();

    for (;;) {
        uint32_t now = millis();
        if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
            lastHeartbeat = now;
            postHeartbeat();
        }

        StreamMsg msg;
        if (xQueueReceive(streamQueue, &msg, pdMS_TO_TICKS(50)) == pdTRUE) {
            if (msg.isControl) {
                if (msg.isStart) beginAudioUpload();
                else finishAudioUpload();
            } else {
                sendAudioChunk(msg.samples, msg.sampleCount);
            }
        }
    }
}

// ============================================================
// CAPTURE TASK (Arduino loop(), core 1) - never touches the network
// ============================================================

bool captureActive = false;
uint32_t captureSampleCounter = 0;

void setup()
{
    Serial.begin(115200);
    delay(1000);

    Serial.println();
    Serial.println("================================");
    Serial.println("FORESIGHT ACOUSTIC BEACON");
    Serial.println("================================");
    Serial.println("Live tuning: gain <float> | floor <int> | range <long>");

    if (!configureI2S()) {
        Serial.println("I2S configuration failed");
        while (true) delay(1000);
    }

    Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
    Wire.setClock(400000);

    if (oledDisplay.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
        oledAvailable = true;
        oledDisplay.clearDisplay();
        oledDisplay.display();
        memset(waveBuffer, 0, sizeof(waveBuffer));
        Serial.println("OLED waveform display ready.");
    } else {
        oledAvailable = false;
        Serial.println("SSD1306 not found - continuing without OLED waveform display.");
    }

    streamQueue = xQueueCreate(STREAM_QUEUE_LEN, sizeof(StreamMsg));
    if (streamQueue == NULL) {
        Serial.println("Failed to create stream queue!");
        while (true) delay(1000);
    }

    xTaskCreatePinnedToCore(
        networkTask,
        "networkTask",
        12288,   // stack size - WiFiClient/HTTPClient need headroom
        NULL,
        1,       // priority
        NULL,
        0        // pin to core 0
    );

    Serial.printf("Current gain=%.2f floor=%d range=%ld\n", SENSITIVITY, NOISE_FLOOR, waveMaxPeakRange);
    Serial.println("Beacon ready.");
}

void loop()
{
    handleSerialTuning();

    // Read the next real-time chunk from the mic. This blocks only on
    // fresh audio arriving (~16ms at 256 samples / 16kHz) - never on
    // the network, since this task doesn't touch WiFi at all.
    int32_t rawBuffer[I2S_CHUNK_SAMPLES];
    size_t bytesRead = 0;
    i2s_read(I2S_PORT, rawBuffer, sizeof(rawBuffer), &bytesRead, portMAX_DELAY);
    size_t samplesRead = bytesRead / sizeof(int32_t);

    // Always feed the display, whether or not we're currently uploading.
    feedWaveformFromRawChunk(rawBuffer, samplesRead);

    // Start a new capture cycle on schedule.
    uint32_t now = millis();
    if (!captureActive && now - lastAudioTrigger >= AUDIO_INTERVAL_MS) {
        lastAudioTrigger = now;
        captureActive = true;
        captureSampleCounter = 0;

        StreamMsg startMsg = {};
        startMsg.isControl = true;
        startMsg.isStart = true;
        xQueueSend(streamQueue, &startMsg, 0);
    }

    // While capturing, convert this chunk to PCM and hand it to the
    // network task via the queue. Non-blocking: if the queue is
    // briefly full (network task busy on a slow write), this chunk
    // is dropped and logged rather than stalling the mic/display.
    if (captureActive) {
        StreamMsg dataMsg = {};
        dataMsg.isControl = false;

        size_t remaining = SAMPLE_COUNT - captureSampleCounter;
        size_t toCopy = samplesRead < remaining ? samplesRead : remaining;

        for (size_t i = 0; i < toCopy; i++) {
            int32_t sample = rawBuffer[i] >> RAW_TO_16BIT_SHIFT;
            if (abs(sample) < NOISE_FLOOR) sample = 0;
            sample = (int32_t)(sample * SENSITIVITY);
            if (sample > 32767) sample = 32767;
            if (sample < -32768) sample = -32768;
            dataMsg.samples[i] = (int16_t)sample;
        }
        dataMsg.sampleCount = toCopy;

        if (xQueueSend(streamQueue, &dataMsg, 0) == pdTRUE) {
            captureSampleCounter += toCopy;
        } else {
            droppedChunkCount++;
            if (now - lastDropLogMs > 2000) {
                lastDropLogMs = now;
                Serial.printf("Warning: stream queue full, dropped %u chunks so far (network congestion)\n", droppedChunkCount);
            }
        }

        if (captureSampleCounter >= SAMPLE_COUNT) {
            captureActive = false;

            StreamMsg endMsg = {};
            endMsg.isControl = true;
            endMsg.isStart = false;
            xQueueSend(streamQueue, &endMsg, 0);
        }
    }
}