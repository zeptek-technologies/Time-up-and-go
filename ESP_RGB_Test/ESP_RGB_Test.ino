// ============================================================
// ESP_RGB_Test.ino — RGB LED Checker (Rainbow Mode)
// ============================================================
// สเก็ตช์สำหรับ "เช็คหลอดไฟ RGB" ของจุด Checkpoint โดยเฉพาะ
// คัดลอกการต่อพิน / คอนเวนชัน RGB มาจาก ESP_Checkpoint.ino
//
// เสียบไฟ (จ่ายไฟเข้า) แล้วจะทำงานทันที ไม่ต้องรอ WiFi/ESP-NOW:
//   ① Self-test ทีละสี  : แดง → เขียว → น้ำเงิน → ขาว
//      (ไว้เช็คว่าแต่ละขาต่อถูก และหลอดไม่ขาด)
//   ② ไล่สีรุ้งต่อเนื่อง : แดง→ส้ม→เหลือง→เขียว→ฟ้า→น้ำเงิน→ม่วง→วน
//
// ใช้ PWM (LEDC) ผสมสีจริง จึงได้สีรุ้งไล่เฉดเนียน ๆ
// ต่างจากโค้ด Checkpoint เดิมที่เปิด/ปิดดิจิทัลได้แค่ 7 สี
//
// การต่อพิน (เหมือน ESP_Checkpoint.ino):
//   RED   → GPIO25   GREEN → GPIO26   BLUE → GPIO27
//   ขา Common ต่อกับ 3.3V (Common Anode) ผ่านตัวต้านทานจำกัดกระแส
// ============================================================

// ============================================================
// ⚙️  USER CONFIGURATION — ปรับก่อนอัปโหลดถ้าจำเป็น
// ============================================================

// ---------- Pin Configuration (เหมือน ESP_Checkpoint) ----------
#define RED_PIN     25
#define GREEN_PIN   26
#define BLUE_PIN    27

// ---------- ชนิดหลอด RGB ----------
// true  = Common Anode  (ขา Common ต่อ +3.3V, LOW = ติด)
// false = Common Cathode (ขา Common ต่อ GND,   HIGH = ติด)  ← ตามบอร์ด Checkpoint
// ถ้าสีที่ออกมา "กลับด้าน" (เช่น สั่งแดงแต่ได้ฟ้า) ให้สลับค่านี้
// ⚠️ ต้องตรงกับ LED_COMMON_ANODE ใน ESP_Checkpoint_v2.ino เสมอ
#define COMMON_ANODE   false

// ---------- ความเร็ว/ความสว่าง ----------
#define RAINBOW_STEP_MS   15    // ยิ่งน้อยยิ่งไล่สีเร็ว (15ms ≈ 5.4s ต่อรอบ)
#define SELFTEST_HOLD_MS  700   // ค้างแต่ละสีตอน self-test กี่ ms
#define BRIGHTNESS        255   // ความสว่างสูงสุดของสีรุ้ง (0-255)

// ============================================================

// ---------- PWM (LEDC) Settings ----------
#define PWM_FREQ      5000   // 5 kHz — ไม่กะพริบให้เห็น
#define PWM_RES_BITS  8      // 8-bit → ค่าดิวตี้ 0-255
#define PWM_MAX       255

// LEDC channel (ใช้เฉพาะ ESP32 core 2.x)
#define CH_RED    0
#define CH_GREEN  1
#define CH_BLUE   2

// ---------- ตรวจเวอร์ชัน ESP32 Arduino core ----------
// core 3.x เปลี่ยน LEDC API ใหม่ (ผูก freq/res กับ "พิน" ไม่ใช่ "channel")
// โค้ดนี้รองรับทั้งสองเวอร์ชันโดยอัตโนมัติ
#ifndef ESP_ARDUINO_VERSION_VAL
  #define USE_NEW_LEDC 0
#elif ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
  #define USE_NEW_LEDC 1
#else
  #define USE_NEW_LEDC 0
#endif

// ============================================================
// เขียนค่าสี RGB ออกหลอด (0-255 ต่อช่อง)
// จัดการกลับค่าดิวตี้ให้อัตโนมัติเมื่อเป็น Common Anode
// ============================================================
void writeRGB(uint8_t r, uint8_t g, uint8_t b) {
  if (COMMON_ANODE) {           // Common Anode: ดิวตี้สูง = ดับ จึงต้องกลับค่า
    r = PWM_MAX - r;
    g = PWM_MAX - g;
    b = PWM_MAX - b;
  }
#if USE_NEW_LEDC
  ledcWrite(RED_PIN,   r);
  ledcWrite(GREEN_PIN, g);
  ledcWrite(BLUE_PIN,  b);
#else
  ledcWrite(CH_RED,   r);
  ledcWrite(CH_GREEN, g);
  ledcWrite(CH_BLUE,  b);
#endif
}

// ============================================================
// แปลง HSV → RGB สำหรับไล่สีรุ้ง
//   h : Hue 0-359 (มุมล้อสี — ไล่ค่านี้ไปเรื่อย ๆ ได้สีรุ้ง)
//   s : Saturation 0-255 (ความอิ่มสี)
//   v : Value 0-255 (ความสว่าง)
// ============================================================
void hsvToRgb(int h, uint8_t s, uint8_t v, uint8_t &r, uint8_t &g, uint8_t &b) {
  float S = s / 255.0f;
  float V = v / 255.0f;
  float C = V * S;
  float X = C * (1.0f - fabs(fmod(h / 60.0f, 2.0f) - 1.0f));
  float m = V - C;

  float rf, gf, bf;
  if      (h < 60)  { rf = C; gf = X; bf = 0; }
  else if (h < 120) { rf = X; gf = C; bf = 0; }
  else if (h < 180) { rf = 0; gf = C; bf = X; }
  else if (h < 240) { rf = 0; gf = X; bf = C; }
  else if (h < 300) { rf = X; gf = 0; bf = C; }
  else              { rf = C; gf = 0; bf = X; }

  r = (uint8_t)((rf + m) * 255.0f);
  g = (uint8_t)((gf + m) * 255.0f);
  b = (uint8_t)((bf + m) * 255.0f);
}

// ============================================================
// Self-test: โชว์ทีละสีเพื่อเช็คว่าแต่ละขาต่อถูกและหลอดไม่ขาด
// ============================================================
void selfTest() {
  Serial.println("  [SELF-TEST] ทดสอบทีละช่องสี...");

  Serial.println("    RED   (แดง)");    writeRGB(255,   0,   0); delay(SELFTEST_HOLD_MS);
  Serial.println("    GREEN (เขียว)");  writeRGB(  0, 255,   0); delay(SELFTEST_HOLD_MS);
  Serial.println("    BLUE  (น้ำเงิน)"); writeRGB(  0,   0, 255); delay(SELFTEST_HOLD_MS);
  Serial.println("    WHITE (ขาว=ครบ3สี)"); writeRGB(255, 255, 255); delay(SELFTEST_HOLD_MS);

  writeRGB(0, 0, 0);   // ดับก่อนเริ่มไล่สีรุ้ง
  delay(300);

  Serial.println("  [SELF-TEST] เสร็จสิ้น ✅");
  Serial.println("  ถ้าเห็นครบ 4 สีตามลำดับ = หลอด + สายไฟปกติ");
  Serial.println("  ถ้าสีสลับกัน = ต่อขาผิด / ถ้าสีกลับด้าน = ลองสลับ COMMON_ANODE");
  Serial.println();
}

// ==========================================================
// SETUP
// ==========================================================
void setup() {
  Serial.begin(115200);
  delay(200);

  Serial.println();
  Serial.println("========================================");
  Serial.println("  RGB LED Checker — Rainbow Mode");
  Serial.println("  (based on ESP_Checkpoint pin layout)");
  Serial.println("========================================");
  Serial.print("  Pins  : R=GPIO"); Serial.print(RED_PIN);
  Serial.print("  G=GPIO"); Serial.print(GREEN_PIN);
  Serial.print("  B=GPIO"); Serial.println(BLUE_PIN);
  Serial.print("  Type  : ");
  Serial.println(COMMON_ANODE ? "Common Anode (LOW=ON)" : "Common Cathode (HIGH=ON)");
  Serial.print("  LEDC  : ");
  Serial.println(USE_NEW_LEDC ? "core 3.x API" : "core 2.x API");
  Serial.println("========================================");
  Serial.println();

  // ---------- ตั้งค่า PWM ให้แต่ละพิน ----------
#if USE_NEW_LEDC
  // core 3.x — ผูก freq/resolution กับพินโดยตรง
  ledcAttach(RED_PIN,   PWM_FREQ, PWM_RES_BITS);
  ledcAttach(GREEN_PIN, PWM_FREQ, PWM_RES_BITS);
  ledcAttach(BLUE_PIN,  PWM_FREQ, PWM_RES_BITS);
#else
  // core 2.x — ตั้ง channel แล้วค่อย attach เข้าพิน
  ledcSetup(CH_RED,   PWM_FREQ, PWM_RES_BITS);
  ledcSetup(CH_GREEN, PWM_FREQ, PWM_RES_BITS);
  ledcSetup(CH_BLUE,  PWM_FREQ, PWM_RES_BITS);
  ledcAttachPin(RED_PIN,   CH_RED);
  ledcAttachPin(GREEN_PIN, CH_GREEN);
  ledcAttachPin(BLUE_PIN,  CH_BLUE);
#endif

  writeRGB(0, 0, 0);   // เริ่มที่ดับ
  selfTest();          // เช็คทีละสีก่อน

  Serial.println("  [RAINBOW] เริ่มไล่สีรุ้งต่อเนื่อง... 🌈");
}

// ==========================================================
// MAIN LOOP — ไล่ Hue 0→359 วนไปเรื่อย ๆ = สีรุ้ง
// ==========================================================
void loop() {
  static int hue = 0;
  uint8_t r, g, b;

  hsvToRgb(hue, 255, BRIGHTNESS, r, g, b);
  writeRGB(r, g, b);

  hue = (hue + 1) % 360;
  delay(RAINBOW_STEP_MS);
}
