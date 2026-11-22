// Arduino Uno R3, Arduino-IRremote 4.4.1. The USB protocol is documented in ../README.md.
#define DECODE_NEC
#define DECODE_LG
#include <IRremote.hpp>

const uint8_t TX_PIN = 3;
const uint8_t RX_PIN = 2;
const bool HAS_LIGHT_SENSOR = true;  // Set false and upload again when A0 is unwired.
char input[32];
size_t used = 0;
bool overflow = false;
unsigned long lastLight = 0;

bool hexField(const char *s, uint8_t size, uint16_t &value) {
  value = 0;
  for (uint8_t i = 0; i < size; ++i) {
    char c = s[i];
    if (c >= '0' && c <= '9') value = (value << 4) | (c - '0');
    else if (c >= 'A' && c <= 'F') value = (value << 4) | (c - 'A' + 10);
    else return false;
  }
  return true;
}

void sendCode(const char *code) {
  bool nec = strncmp(code, "NEC:", 4) == 0;
  bool lg2 = strncmp(code, "LG2:", 4) == 0;
  if (!nec && !lg2 && strncmp(code, "LG:", 3) != 0) return;
  const char *fields = strchr(code, ':') + 1;
  uint16_t address, command;
  uint8_t digits = nec ? 2 : 4;
  if (strlen(fields) != size_t(5 + digits) || fields[4] != ':' ||
      !hexField(fields, 4, address) || !hexField(fields + 5, digits, command) ||
      (!nec && address > 255)) return;

  // The board's own transmission must never appear as a physical remote press.
  IrReceiver.stop();
  if (nec) IrSender.sendNEC(address, command, 0);
  else if (lg2) IrSender.sendLG2(address, command, 0);
  else IrSender.sendLG(address, command, 0);
  IrReceiver.start();
  Serial.print(F("sent "));
  Serial.println(code);
}

void readHost() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      input[used] = '\0';
      if (!overflow) {
        if (strcmp(input, "hello") == 0) Serial.println(F("ready"));
        else if (strncmp(input, "send ", 5) == 0) sendCode(input + 5);
      }
      used = 0;
      overflow = false;
    } else if (c < 32 || c > 126 || used >= sizeof(input) - 1) overflow = true;
    else if (!overflow) input[used++] = c;
  }
}

void readRemote() {
  if (!IrReceiver.decode()) return;
  const IRData &data = IrReceiver.decodedIRData;
  if (!(data.flags & (IRDATA_FLAGS_IS_REPEAT | IRDATA_FLAGS_WAS_OVERFLOW | IRDATA_FLAGS_PARITY_FAILED))) {
    char code[20] = {};
    if (data.protocol == NEC || data.protocol == NEC2)
      snprintf(code, sizeof(code), "NEC:%04X:%02X", data.address, data.command);
    else if (data.protocol == LG || data.protocol == LG2)
      snprintf(code, sizeof(code), "%s:%04X:%04X", data.protocol == LG ? "LG" : "LG2", data.address, data.command);
    if (code[0]) { Serial.print(F("remote ")); Serial.println(code); }
  }
  IrReceiver.resume();
}

void setup() {
  Serial.begin(115200);
  IrSender.begin(TX_PIN);
  IrReceiver.begin(RX_PIN, DISABLE_LED_FEEDBACK);
  Serial.println(F("boot"));
  Serial.println(F("ready"));
}

void loop() {
  readRemote();
  readHost();
  unsigned long now = millis();
  if (now - lastLight >= 100) {
    lastLight = now;
    if (HAS_LIGHT_SENSOR) { Serial.print(F("light ")); Serial.println(analogRead(A0)); }
    else Serial.println(F("light none"));
  }
}
