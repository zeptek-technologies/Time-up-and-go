// ============================================================
// ESP_UltrasonicTest — ทดสอบเซนเซอร์ ultrasonic (HC-SR04) อย่างเดียว
//   • อ่านระยะทุก 200 ms แล้วพิมพ์ออก Serial Monitor (115200 baud)
//   • ใช้ขาเดียวกับ ESP_Chair_v2 / ESP_Checkpoint_v2: TRIG=18, ECHO=19
// ============================================================

#define TRIG_PIN 18
#define ECHO_PIN 19

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);
  delay(500);
  Serial.println();
  Serial.println("=== Ultrasonic test (TRIG=18, ECHO=19) ===");
}

void loop() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);  // timeout 30 ms (~5 m)

  if (duration == 0) {
    Serial.println("No echo (timeout) — เช็คสาย/ไฟเลี้ยง หรือไม่มีวัตถุในระยะ");
  } else {
    float cm = duration * 0.0343f / 2.0f;
    Serial.printf("Distance: %6.1f cm   (echo %ld us)\n", cm, duration);
  }

  delay(200);
}
