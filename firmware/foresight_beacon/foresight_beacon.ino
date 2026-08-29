/*
 * FORESIGHT ESP32-S3 Acoustic Beacon
 *
 * INMP441:
 *   SCK/BCLK -> GPIO5
 *   WS/LRCLK -> GPIO3
 *   SD       -> GPIO4
 *   L/R      -> GND
 *
 * Network:
 *   ESP32-S3 -> Wi-Fi -> Router -> Laptop backend
 *
 * Audio:
 *   16 kHz
 *   16-bit PCM
 *   Mono
 *   5 seconds
 *
 * IMPORTANT:
 *   Audio is streamed directly to the backend.
 *   The ESP32 does NOT allocate a 160 KB WAV buffer
 *   and does NOT allocate another 160 KB multipart buffer.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <driver/i2s.h>
#include <HTTPClient.h>
// ============================================================
// NETWORK
// ============================================================

const char* WIFI_SSID = "gege-2-4ghz";
const char* WIFI_PASSWORD = "pjk@77#G";

// Laptop running the Foresight backend.
// Update this if the laptop receives a different address from the router.
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
constexpr uint32_t SAMPLE_COUNT =
    SAMPLE_RATE * CAPTURE_SECONDS;

// ============================================================
// MICROPHONE SENSITIVITY (DIGITAL)
// ============================================================
// The INMP441's physical sensitivity is fixed. These controls adjust
// the signed PCM samples sent to the backend after I2S has read them.
// Start with SENSITIVITY = 1.0. Increase it if the waveform is too
// small; lower it if the waveform clips at +/-32767.
constexpr int RAW_TO_16BIT_SHIFT = 16;
float SENSITIVITY = 3.0f;

// Samples below this absolute signed value are treated as silence.
// Set to 0 to disable the noise floor.
int16_t NOISE_FLOOR = 100;

// ============================================================
// TIMING
// ============================================================

constexpr uint32_t AUDIO_INTERVAL_MS = 7000;
constexpr uint32_t HEARTBEAT_INTERVAL_MS = 12000;

uint32_t lastAudio = 0;
uint32_t lastHeartbeat = 0;

// ============================================================
// MULTIPART
// ============================================================

const char* BOUNDARY = "----ForesightBoundary";

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

void createWavHeader(
    uint8_t* header,
    uint32_t pcmLength
)
{
    memset(header, 0, 44);

    // RIFF
    memcpy(header + 0, "RIFF", 4);

    writeLE32(
        header + 4,
        36 + pcmLength
    );

    // WAVE
    memcpy(header + 8, "WAVE", 4);

    // fmt
    memcpy(header + 12, "fmt ", 4);

    writeLE32(header + 16, 16); // fmt chunk size

    writeLE16(header + 20, 1);  // PCM

    writeLE16(header + 22, 1);  // mono

    writeLE32(
        header + 24,
        SAMPLE_RATE
    );

    // Byte rate
    writeLE32(
        header + 28,
        SAMPLE_RATE * 2
    );

    // Block align
    writeLE16(header + 32, 2);

    // Bits per sample
    writeLE16(header + 34, 16);

    // data
    memcpy(header + 36, "data", 4);

    writeLE32(
        header + 40,
        pcmLength
    );
}

// ============================================================
// WIFI
// ============================================================

bool connectWifi()
{
    if (WiFi.status() == WL_CONNECTED)
        return true;

    Serial.println("Connecting to Wi-Fi...");

    WiFi.mode(WIFI_STA);

    WiFi.begin(
        WIFI_SSID,
        WIFI_PASSWORD
    );

    uint32_t started = millis();

    while (
        WiFi.status() != WL_CONNECTED &&
        millis() - started < 15000
    )
    {
        delay(250);
        Serial.print(".");
    }

    Serial.println();

    if (WiFi.status() == WL_CONNECTED)
    {
        Serial.print("Wi-Fi connected. IP: ");
        Serial.println(WiFi.localIP());

        return true;
    }

    Serial.println("Wi-Fi connection failed");

    return false;
}

// ============================================================
// HEARTBEAT
// ============================================================

void postHeartbeat()
{
    if (!connectWifi())
        return;

    WiFiClient connection;

    HTTPClient client;

    String endpoint =
        String(API_BASE_URL) +
        "/api/ingest/heartbeat";

    Serial.print("Heartbeat -> ");
    Serial.println(endpoint);

    client.begin(
        connection,
        endpoint
    );

    client.setTimeout(5000);

    client.addHeader(
        "Content-Type",
        "application/json"
    );

    String body =
        String("{\"beacon_id\":\"") +
        BEACON_ID +
        "\"}";

    int response =
        client.POST(body);

    Serial.printf(
        "Heartbeat response: %d\n",
        response
    );

    if (response > 0)
    {
        String responseBody =
            client.getString();

        Serial.print(
            "Backend: "
        );

        Serial.println(
            responseBody
        );
    }

    client.end();
}

// ============================================================
// I2S INITIALIZATION
// ============================================================

bool configureI2S()
{
    i2s_config_t config = {};

    config.mode =
        (i2s_mode_t)(
            I2S_MODE_MASTER |
            I2S_MODE_RX
        );

    config.sample_rate =
        SAMPLE_RATE;

    config.bits_per_sample =
        I2S_BITS_PER_SAMPLE_32BIT;

    config.channel_format =
        I2S_CHANNEL_FMT_ONLY_LEFT;

    config.communication_format =
        I2S_COMM_FORMAT_I2S;

    config.intr_alloc_flags =
        ESP_INTR_FLAG_LEVEL1;

    config.dma_buf_count = 8;

    config.dma_buf_len = 256;

    config.use_apll = false;

    config.tx_desc_auto_clear = false;

    config.fixed_mclk = 0;


    i2s_pin_config_t pins = {};

    pins.bck_io_num =
        I2S_BCLK_PIN;

    pins.ws_io_num =
        I2S_WS_PIN;

    pins.data_out_num =
        I2S_PIN_NO_CHANGE;

    pins.data_in_num =
        I2S_DATA_PIN;


    esp_err_t result =
        i2s_driver_install(
            I2S_PORT,
            &config,
            0,
            nullptr
        );

    if (result != ESP_OK)
    {
        Serial.printf(
            "I2S driver install failed: %d\n",
            result
        );

        return false;
    }


    result =
        i2s_set_pin(
            I2S_PORT,
            &pins
        );

    if (result != ESP_OK)
    {
        Serial.printf(
            "I2S pin configuration failed: %d\n",
            result
        );

        return false;
    }


    i2s_zero_dma_buffer(
        I2S_PORT
    );

    Serial.println(
        "I2S configured successfully"
    );

    return true;
}

// ============================================================
// SEND HTTP HEADER
// ============================================================

bool sendHttpHeader(
    WiFiClient& connection,
    size_t contentLength
)
{
    String endpoint =
        String("/api/ingest/audio?beacon_id=") +
        BEACON_ID;

    connection.print(
        "POST " +
        endpoint +
        " HTTP/1.1\r\n"
    );

    connection.print(
        "Host: "
    );

    connection.print(
        API_HOST
    );

    connection.print(
        ":"
    );

    connection.print(
        API_PORT
    );

    connection.print(
        "\r\n"
    );

    connection.print(
        "Content-Type: multipart/form-data; boundary="
    );

    connection.print(
        BOUNDARY
    );

    connection.print(
        "\r\n"
    );

    connection.print(
        "Content-Length: "
    );

    connection.print(
        contentLength
    );

    connection.print(
        "\r\n"
    );

    connection.print(
        "Connection: close\r\n"
    );

    connection.print(
        "\r\n"
    );

    return true;
}

// WiFiClient.write() is allowed to send fewer bytes than requested.
// Complete each block so the multipart WAV body is never truncated.
bool writeAll(
    WiFiClient& connection,
    const uint8_t* data,
    size_t length
)
{
    size_t written = 0;

    while (written < length)
    {
        size_t result = connection.write(data + written, length - written);

        if (result == 0)
            return false;

        written += result;
        delay(0);
    }

    return true;
}

// ============================================================
// STREAM AUDIO TO BACKEND
// ============================================================

bool postAudio()
{
    if (!connectWifi())
        return false;

    WiFiClient connection;

    connection.setTimeout(10000);


    // --------------------------------------------------------
    // WAV size
    // --------------------------------------------------------

    constexpr size_t WAV_HEADER_SIZE = 44;

    constexpr size_t PCM_LENGTH =
        SAMPLE_COUNT *
        sizeof(int16_t);

    constexpr size_t WAV_LENGTH =
        WAV_HEADER_SIZE +
        PCM_LENGTH;


    // --------------------------------------------------------
    // Multipart prefix
    // --------------------------------------------------------

    String prefix =
        String("--") +
        BOUNDARY +
        "\r\n"
        "Content-Disposition: form-data; "
        "name=\"audio\"; "
        "filename=\"capture.wav\"\r\n"
        "Content-Type: audio/wav\r\n"
        "\r\n";


    // --------------------------------------------------------
    // Multipart suffix
    // --------------------------------------------------------

    String suffix =
        String("\r\n--") +
        BOUNDARY +
        "--\r\n";


    // --------------------------------------------------------
    // Entire HTTP body size
    // --------------------------------------------------------

    size_t contentLength =
        prefix.length() +
        WAV_LENGTH +
        suffix.length();


    // --------------------------------------------------------
    // Connect
    // --------------------------------------------------------

    Serial.println();
    Serial.println(
        "Connecting to audio backend..."
    );

    if (!connection.connect(
            API_HOST,
            API_PORT))
    {
        Serial.println(
            "Audio connection failed"
        );

        return false;
    }


    Serial.println(
        "Audio connection established"
    );


    // --------------------------------------------------------
    // HTTP headers
    // --------------------------------------------------------

    sendHttpHeader(
        connection,
        contentLength
    );


    // --------------------------------------------------------
    // Multipart prefix
    // --------------------------------------------------------

    connection.print(prefix);


    // --------------------------------------------------------
    // WAV header
    // --------------------------------------------------------

    uint8_t wavHeader[44];

    createWavHeader(
        wavHeader,
        PCM_LENGTH
    );

    if (!writeAll(connection, wavHeader, sizeof(wavHeader)))
    {
        Serial.println("WAV header network write failed");
        connection.stop();
        return false;
    }


    // --------------------------------------------------------
    // Audio capture + streaming
    // --------------------------------------------------------

    int32_t rawBuffer[256];

    int16_t pcmBuffer[256];

    uint32_t samplesSent = 0;

    Serial.println(
        "Recording + streaming audio..."
    );


    while (
        samplesSent < SAMPLE_COUNT
    )
    {
        size_t bytesRead = 0;


        esp_err_t result =
            i2s_read(
                I2S_PORT,
                rawBuffer,
                sizeof(rawBuffer),
                &bytesRead,
                portMAX_DELAY
            );


        if (result != ESP_OK)
        {
            Serial.printf(
                "I2S read failed: %d\n",
                result
            );

            connection.stop();

            return false;
        }


        size_t samplesRead =
            bytesRead /
            sizeof(int32_t);


        for (
            size_t i = 0;
            i < samplesRead &&
            samplesSent < SAMPLE_COUNT;
            i++
        )
        {
            /*
             * INMP441 gives 24-bit audio
             * inside a 32-bit I2S slot.
             *
             * Shift by 16 to convert
             * the useful signal into
             * a practical 16-bit PCM range.
             *
             * Sensitivity and noise-floor tuning is applied below.
             */
            // Preserve the sign: this remains a true acoustic waveform.
            int32_t sample =
                rawBuffer[i] >> RAW_TO_16BIT_SHIFT;

            if (abs(sample) < NOISE_FLOOR)
                sample = 0;

            sample = (int32_t)(sample * SENSITIVITY);


            // Prevent int16 overflow
            if (sample > 32767)
                sample = 32767;

            if (sample < -32768)
                sample = -32768;


            pcmBuffer[
                samplesSent % 256
            ] =
                (int16_t)sample;


            samplesSent++;


            // Send every full 256-sample block
            if (
                samplesSent % 256 == 0
            )
            {
                size_t bytesToSend =
                    256 *
                    sizeof(int16_t);

                if (!writeAll(connection, (uint8_t*)pcmBuffer, bytesToSend))
                {
                    Serial.println(
                        "Audio network write failed"
                    );

                    connection.stop();

                    return false;
                }
            }
        }
    }


    // --------------------------------------------------------
    // Send remaining samples
    // --------------------------------------------------------

    uint32_t remainder =
        SAMPLE_COUNT % 256;

    if (remainder > 0)
    {
        size_t bytesToSend =
            remainder *
            sizeof(int16_t);

        if (!writeAll(connection, (uint8_t*)pcmBuffer, bytesToSend))
        {
            Serial.println("Audio remainder network write failed");
            connection.stop();
            return false;
        }
    }


    // --------------------------------------------------------
    // Multipart ending
    // --------------------------------------------------------

    connection.print(
        suffix
    );


    // --------------------------------------------------------
    // Wait for backend response
    // --------------------------------------------------------

    Serial.println(
        "Audio uploaded. Waiting for backend..."
    );


    uint32_t timeoutStart =
        millis();


    while (
        !connection.available() &&
        connection.connected() &&
        millis() - timeoutStart < 15000
    )
    {
        delay(10);
    }


    // --------------------------------------------------------
    // Read HTTP response
    // --------------------------------------------------------

    if (connection.available())
    {
        String statusLine =
            connection.readStringUntil(
                '\n'
            );

        statusLine.trim();

        Serial.print(
            "Audio response: "
        );

        Serial.println(
            statusLine
        );


        while (
            connection.available()
        )
        {
            String line =
                connection.readStringUntil(
                    '\n'
                );

            line.trim();

            if (line.length() > 0)
            {
                Serial.print(
                    "Backend: "
                );

                Serial.println(
                    line
                );
            }
        }
    }
    else
    {
        Serial.println(
            "No response from backend"
        );
    }


    connection.stop();

    Serial.println(
        "Audio upload complete"
    );

    return true;
}

// ============================================================
// SETUP
// ============================================================

void setup()
{
    Serial.begin(115200);

    delay(1000);

    Serial.println();
    Serial.println(
        "================================"
    );

    Serial.println(
        "FORESIGHT ACOUSTIC BEACON"
    );

    Serial.println(
        "================================"
    );


    // I2S
    if (!configureI2S())
    {
        Serial.println(
            "I2S configuration failed"
        );

        while (true)
            delay(1000);
    }


    // Wi-Fi
    connectWifi();


    Serial.print(
        "Free heap: "
    );

    Serial.println(
        ESP.getFreeHeap()
    );


    Serial.println(
        "Beacon ready."
    );
}

// ============================================================
// LOOP
// ============================================================

void loop()
{
    if (
        WiFi.status() != WL_CONNECTED
    )
    {
        connectWifi();
    }


    uint32_t now =
        millis();


    // --------------------------------------------------------
    // HEARTBEAT
    // --------------------------------------------------------

    if (
        now - lastHeartbeat >=
        HEARTBEAT_INTERVAL_MS
    )
    {
        lastHeartbeat = now;

        postHeartbeat();
    }


    // --------------------------------------------------------
    // AUDIO
    // --------------------------------------------------------

    if (
        now - lastAudio >=
        AUDIO_INTERVAL_MS
    )
    {
        lastAudio = now;

        postAudio();
    }


    delay(10);
}
