// ============================================================
// ESP_Checkpoint_v2.ino — TUG Test: Checkpoint & RGB Controller
// ============================================================
// บอร์ดนี้ติดตั้งที่จุดหมุนตัวระยะ 3 เมตร
//   • ตรวจจับว่าผู้ทดสอบเดินมาถึงแล้ว (ultrasonic) แล้วส่งสัญญาณกลับไป Chair
//   • เป็นไฟ RGB ดวงเดียวของทั้งระบบ — บอกครบทุกขั้นตอนของการทดสอบ:
//       น้ำเงินกระพริบ = ยังไม่พร้อม      น้ำเงินค้าง = พร้อมใช้งาน
//       เขียวกระพริบ   = นั่งแล้ว ลุกได้   ขาวกระพริบ  = กำลังเดิน
//       ขาวค้าง        = ผ่านจุดหมุนตัว    เขียว/เหลือง/แดงค้าง = ผล LOW/MODERATE/HIGH
//     (ดูตารางเต็มที่หัวข้อ "RGB LED + ไฟสถานะ")
//   • ขั้นตอนที่เก้าอี้เห็น (นั่ง/ลุก/จบรอบ) ส่งมาทาง ESP-NOW ใน field chairState
//   • รายงานสถานะตัวเองขึ้น Firestore ให้เว็บเห็น (device_status/checkpoint)
//   • รับคำสั่งรีเซ็ตจากเว็บได้เอง (device_commands/checkpoint)
//
// Library ที่ต้องติดตั้ง (Arduino Library Manager):
//   → "Firebase ESP Client" by Mobizt
//
// ⚠️  struct_message และ TUG_*_RISK_MAX ต้องตรงกับ ESP_Chair เสมอ
// ============================================================

#include <esp_now.h>
#include <WiFi.h>
#include <time.h>
#include <Firebase_ESP_Client.h>
#include "addons/TokenHelper.h"
#include "TUGWiFiPortal.h"

#define FW_VERSION "checkpoint-2.3.0"

// ============================================================
// ⚙️  USER CONFIGURATION — แก้ไขค่าเหล่านี้ก่อนอัปโหลด
//     ใช้ค่าเดียวกับที่ตั้งไว้ใน ESP_Chair_v2.ino
// ============================================================

// --- WiFi Setup Portal ---
// บอร์ดเปิด WiFi ของตัวเองค้างไว้ตลอด ต่อเข้าวงนี้แล้วหน้าตั้งค่าจะเด้งขึ้นเอง
// (ถ้าไม่เด้ง เปิดเบราว์เซอร์ไปที่ http://192.168.4.1)
//
// ⚠️  ชื่อ AP ต้องไม่ซ้ำกับของ ESP_Chair จะได้แยกออกว่ากำลังตั้งค่าบอร์ดไหน
#define AP_SSID       "TUG-Checkpoint-Setup"
#define AP_PASSWORD   "tugsetup123"

// --- Firebase (Cloud Firestore) ---
#define FIREBASE_API_KEY     "AIzaSyC4dFT0u_NWRmsbuQygQhQnW6nGuRUn4D8"
#define FIREBASE_PROJECT_ID  "time-up-and-go"
#define FIREBASE_EMAIL       "esp32@tugtest.com"
#define FIREBASE_PASS        "Esp32TugPass!"

// --- ESP-NOW encryption keys ---
// ⚠️ ต้องยาว 16 ตัวอักษรพอดี และต้องตรงกับใน ESP_Chair_v2 เป๊ะ ๆ
#define ESPNOW_PMK           "TUG_PMK_16CHARS!"
#define ESPNOW_LMK           "TUG_LMK_16CHARS!"

// ============================================================

// ---------- Pin Configuration ----------
#define TRIG_PIN    18
#define ECHO_PIN    19

#define RED_PIN     25
#define GREEN_PIN   26
#define BLUE_PIN    27

// ---------- Distance Thresholds (cm) ----------
#define DIST_DETECT        30.0   // ตรวจพบคนภายใน 30 ซม.
#define DIST_MAX_VALID    400.0   // ระยะสูงสุดที่เป็นไปได้
#define DIST_TIMEOUT      999.0   // ค่าที่คืนเมื่อไม่มี echo

// ---------- Timing Configuration (ms) ----------
#define DEBOUNCE_DETECT_MS 300
#define SERIAL_INTERVAL_MS 500
#define WIFI_TIMEOUT_MS    10000

// [แก้ข้อ 10] เพดานเวลาของการเฝ้ารอ — ถ้า Chair รีบูตหรือแพ็กเก็ต ABORT หาย
// บอร์ดนี้จะไม่ค้างอยู่ในสถานะ DETECTING ตลอดไป
#define DETECT_TIMEOUT_MS     130000  // ยาวกว่า MAX_TEST_DURATION_MS ของ Chair เล็กน้อย
#define RESULT_DISPLAY_MS     10000   // แสดงไฟผลลัพธ์ 10 วิ แล้วกลับเป็นไฟ "พร้อมใช้งาน"

#define HEARTBEAT_INTERVAL_MS    15000
// ถ้า heartbeat ส่งไม่สำเร็จ ให้ลองใหม่เร็วขึ้น แทนที่จะรอครบ 15 วิ
// เกณฑ์ OFFLINE ของเว็บคือ 45 วิ = heartbeat พอดี 3 ครั้ง ถ้าพลาดติดกัน 2 ครั้ง
// เว็บจะขึ้น OFFLINE หลอก ๆ ทั้งที่บอร์ดยังทำงานปกติ
#define HEARTBEAT_RETRY_MS        3000
#define COMMAND_POLL_INTERVAL_MS 6000

// ---------- Median / Valid-only Filter ----------
#define MEDIAN_SAMPLES      5
#define VALID_WINDOW        5

// ============================================================
// [แก้ข้อ 1] เกณฑ์ความเสี่ยง TUG — ต้องตรงกับ ESP_Chair และเว็บ
//   ≤ 11 วิ = LOW | > 11–30 วิ = MODERATE | > 30 วิ = HIGH
// ค่าเดิมคือ 20.0 ซึ่งไม่ตรงเอกสารโครงการหัวข้อ 6.5.1
// ============================================================
#define TUG_LOW_RISK_MAX   11.0
#define TUG_MOD_RISK_MAX   30.0

// ---------- RGB LED ----------
// ⚠️ ถ้าไฟออกเป็น "สีตรงข้าม" ของที่สั่ง (สั่งเขียวได้ม่วง / สั่งเหลืองได้น้ำเงิน /
//    สั่งดับแต่ติดขาว) แปลว่าโมดูลเป็นขั้วร่วมอีกแบบ — สลับค่าบรรทัดล่างนี้อันเดียวจบ
#define LED_COMMON_ANODE  false      // false = Common Cathode (ขาร่วมลง GND, HIGH = ติด)

#if LED_COMMON_ANODE
  #define LED_ON   LOW
  #define LED_OFF  HIGH
#else
  #define LED_ON   HIGH
  #define LED_OFF  LOW
#endif

// ---------- ไฟสถานะ: จังหวะกระพริบ (ms) ----------
// ค่าคู่กัน = (ติดกี่ ms, ครบรอบกี่ ms) — ตั้งให้ติดครึ่งหนึ่งของรอบ = กระพริบสม่ำเสมอ
#define BLINK_NOT_READY_ON_MS     400   // "ยังไม่พร้อม" — น้ำเงินกระพริบช้า ๆ
#define BLINK_NOT_READY_PERIOD_MS 800
#define BLINK_STANDUP_ON_MS       400   // "ลุกได้แล้ว" — เขียวกระพริบ จังหวะเดียวกับข้างบน
#define BLINK_STANDUP_PERIOD_MS   800
#define BLINK_WALKING_ON_MS       200   // "กำลังเดิน" — ขาวกระพริบถี่กว่า บอกว่ากำลังจับเวลา
#define BLINK_WALKING_PERIOD_MS   400

// ESP-NOW: Chair ส่ง PING มาทุก 2 วิ — เกิน 6 วิ (พลาด 3 ครั้ง) ถือว่าลิงก์ขาด
// ใช้เกณฑ์เดียวกับ CHECKPOINT_LINK_TIMEOUT_MS ฝั่ง Chair เพื่อให้ทั้งสองบอร์ดเห็นตรงกัน
#define CHAIR_LINK_TIMEOUT_MS   6000

// ---------- ESP-NOW Peer (Chair ESP32) ----------
// ดู MAC ของอีกบอร์ดได้จาก Serial ตอนบูต (บอร์ดจะพิมพ์ MAC ของตัวเองออกมา)
uint8_t chairMAC[] = {0x88, 0x57, 0x21, 0xB6, 0x70, 0x84};

// ---------- Communication Struct (ต้องเหมือน ESP_Chair เป๊ะ) ----------
// chairState: ไฟ RGB ของทั้งระบบอยู่ที่บอร์ดนี้บอร์ดเดียว แต่สีที่ต้องแสดงขึ้นกับ
// ขั้นตอนที่ "เก้าอี้" เห็น (นั่งรอลุก / ลุกเดิน / จบรอบ) Chair จึงแนบสถานะตัวเอง
// มากับทุกแพ็กเก็ต รวมถึง PING ที่ส่งทุก 2 วิ
typedef struct struct_message {
  char     command[15];
  float    timeSec;
  uint32_t runId;
  uint8_t  chairState;
} struct_message;

// ---------- สถานะของ Chair (ต้องตรงกับ enum SystemState ฝั่ง ESP_Chair เป๊ะ) ----------
// ⚠️ ค่าตัวเลขวิ่งข้าม ESP-NOW ห้ามสลับลำดับหรือแทรกค่าใหม่ตรงกลางฝั่งเดียว
enum ChairState : uint8_t {
  CHAIR_CALIBRATE = 0,
  CHAIR_WAIT_SIT  = 1,
  CHAIR_READY     = 2,   // มีคนนั่งอยู่ รอลุก → ไฟเขียวกระพริบ
  CHAIR_RUNNING   = 3,   // ลุกเดินแล้ว      → ไฟขาวกระพริบ
  CHAIR_RETURNING = 4,   // ผ่านจุดหมุนตัวแล้ว → ไฟขาวค้าง
  CHAIR_COOLDOWN  = 5,
  CHAIR_UNKNOWN   = 255  // ยังไม่เคยได้ยินจาก Chair เลยตั้งแต่บูต
};

// ---------- State Machine ----------
enum CheckpointState {
  CP_IDLE,       // รอคำสั่ง START — ไฟน้ำเงิน = พร้อมใช้งาน
  CP_DETECTING,  // ได้รับ START แล้ว กำลังเฝ้ารอผู้ทดสอบเดินมาถึง
  CP_RESULT      // ได้รับ FINISH แล้ว กำลังแสดงไฟผลลัพธ์
};

// ---------- ขั้นตอนของไฟ (ตามสเปกไฟชุดใหม่) ----------
// ค่านี้ถูกส่งขึ้น Firestore ด้วย (field "light") เพื่อให้หน้าเว็บโชว์สีเดียวกับหลอดจริง
enum LightPhase {
  LIGHT_NOT_READY,      // น้ำเงินกระพริบ  — เพิ่งบูต / WiFi-คลาวด์-Chair ยังไม่ครบ
  LIGHT_READY,          // น้ำเงินค้าง     — พร้อมใช้งาน
  LIGHT_STAND_UP,       // เขียวกระพริบ    — นั่งอยู่แล้ว ลุกได้เลย
  LIGHT_WALKING,        // ขาวกระพริบ      — ลุกเดินแล้ว กำลังจับเวลา
  LIGHT_PASSED,         // ขาวค้าง         — ผ่านจุดหมุนตัวแล้ว กำลังเดินกลับ
  LIGHT_RESULT_LOW,     // เขียวค้าง       — ผล LOW
  LIGHT_RESULT_MOD,     // เหลืองค้าง      — ผล MODERATE
  LIGHT_RESULT_HIGH     // แดงค้าง         — ผล HIGH
};

// ---------- Risk Level ----------
enum RiskLevel { RISK_LOW, RISK_MODERATE, RISK_HIGH };

// ---------- รูปแบบไฟสถานะ = สี + จังหวะกระพริบ ----------
//   periodMs == 0 → ติดค้าง ไม่กระพริบ
//   pulses        → จำนวน "แวบ" ต่อรอบ (2 = แวบคู่ ใช้แยกสถานะที่สีเดียวกัน)
// ⚠️ ต้องประกาศ struct ไว้ก่อนฟังก์ชันตัวแรกของไฟล์ .ino เสมอ เพราะ Arduino IDE
//    แทรก prototype ของฟังก์ชันทั้งไฟล์ไว้ตรงหน้าฟังก์ชันตัวแรก ถ้าประกาศทีหลัง
//    prototype ของ setLedPattern() จะมองไม่เห็นชนิดนี้ ("does not name a type")
struct LedPattern {
  bool     r, g, b;
  uint16_t onMs;
  uint16_t periodMs;
  uint8_t  pulses;
};

// ---------- Firebase Objects ----------
FirebaseData   fbdo;
FirebaseAuth   auth;
FirebaseConfig firebaseConfig;
TUGWiFiPortal  portal;

// ---------- Global Variables ----------
struct_message      msgData;   // buffer สำหรับ "ส่ง" เท่านั้น
esp_now_peer_info_t peerInfo;

CheckpointState currentState = CP_IDLE;

unsigned long debounceStart   = 0;
unsigned long lastPrintTime   = 0;
unsigned long detectStart     = 0;   // เวลาที่เข้าสู่ CP_DETECTING
unsigned long resultStart     = 0;   // เวลาที่เข้าสู่ CP_RESULT
unsigned long lastHeartbeat   = 0;
unsigned long lastCommandPoll = 0;
unsigned long checkpointPassed = 0;  // เวลาที่ส่ง CHECKPOINT ให้ Chair (ไว้กันไฟค้างรอผล)

// ระยะห่าง heartbeat ครั้งถัดไป — หดสั้นลงอัตโนมัติเมื่อส่งไม่สำเร็จ
unsigned long heartbeatGap    = HEARTBEAT_INTERVAL_MS;
// สั่งให้ส่ง heartbeat ทันทีในรอบถัดไปที่ปลอดภัย (ตอนสถานะเปลี่ยนสำคัญ ๆ)
bool heartbeatDue = true;

bool debounceActive  = false;
bool wifiConnected   = false;
bool firebaseReady   = false;
bool firebaseStarted = false;   // Firebase.begin() ถูกเรียกไปแล้วหรือยัง
bool ntpStarted      = false;   // configTime() ถูกเรียกไปแล้วหรือยัง

// สถานะคลาวด์ที่ "พิสูจน์แล้ว" — คือ heartbeat ครั้งล่าสุดเขียน Firestore สำเร็จจริงหรือไม่
// ใช้ค่านี้ขับไฟสถานะ แทนการเรียก Firebase.ready() ตรง ๆ เพราะฟังก์ชันนั้นอาจไป
// refresh token แล้วบล็อกลูปเป็นวินาที ซึ่งห้ามเกิดขึ้นระหว่างเฝ้ารอผู้ทดสอบ
bool cloudOk = false;

// ผู้ทดสอบผ่านจุดหมุนตัวไปแล้ว กำลังรอ FINISH จาก Chair
// (สถานะจะเป็น CP_IDLE เหมือนตอนว่าง จึงต้องมีตัวแปรนี้แยกไฟสถานะออกจากกัน)
bool awaitingFinish = false;

// สถานะล่าสุดของ Chair ที่ได้ยินมาทาง ESP-NOW — ตัวขับสีไฟหลักของบอร์ดนี้
volatile uint8_t chairState = CHAIR_UNKNOWN;

uint32_t  currentRunId  = 0;   // runId ของรอบที่กำลังทำอยู่ (ได้มาจาก START)
float     lastResultSec = 0;   // เวลารวมของรอบล่าสุด ไว้โชว์ในสถานะ
RiskLevel resultRisk    = RISK_LOW;   // ผลของรอบล่าสุด ไว้ขับไฟตอน CP_RESULT

// ---------- Valid-only distance filter ----------
float validWindow[VALID_WINDOW];
int   validHead   = 0;
int   validCount  = 0;
float lastValidDistance = DIST_TIMEOUT;
bool  distanceHeld = false;

// ---------- Chair link status ----------
volatile unsigned long lastChairAck = 0;

// ==========================================================
// Utilities
// ==========================================================
const char* getStateName(CheckpointState s) {
  switch (s) {
    case CP_IDLE:      return "IDLE";
    case CP_DETECTING: return "DETECTING";
    case CP_RESULT:    return "RESULT";
    default:           return "UNKNOWN";
  }
}

RiskLevel riskLevelOf(float totalSec) {
  if (totalSec <= TUG_LOW_RISK_MAX) return RISK_LOW;
  if (totalSec <= TUG_MOD_RISK_MAX) return RISK_MODERATE;
  return RISK_HIGH;
}

const char* riskName(RiskLevel r) {
  switch (r) {
    case RISK_LOW:      return "LOW";
    case RISK_MODERATE: return "MODERATE";
    default:            return "HIGH";
  }
}

uint32_t getEpoch() {
  time_t t = time(nullptr);
  return (t < 100000) ? 0 : (uint32_t)t;
}

// ==========================================================
// Ultrasonic
// ==========================================================
float readDistanceRaw() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0) return DIST_TIMEOUT;
  return duration * 0.034 / 2.0;
}

// [แก้ข้อ 12] ตัวกรองแบบเอาเฉพาะค่า valid — เดิมบอร์ดนี้ยังใช้ median แบบเก่า
// ที่เอา 999.0 (timeout) มาคิดเป็นระยะด้วย ทำให้ค่า median เด้งสูงผิดปกติ
// และ "พลาดการตรวจจับ" ตอนผู้ทดสอบเดินผ่านจริง ๆ
//   ① ยิงเซ็นเซอร์เป็นชุด เก็บเฉพาะค่าที่ valid (0 < d < DIST_MAX_VALID)
//   ② หา median จาก ring buffer ของค่า valid ล่าสุด
//   ③ ถ้ารอบนี้ไม่มีค่า valid เลย → คืนค่า valid ล่าสุด (hold last)
float getDistance() {
  int gotValid = 0;

  for (int i = 0; i < MEDIAN_SAMPLES; i++) {
    float raw = readDistanceRaw();

    if (raw > 0.0 && raw < DIST_MAX_VALID) {
      validWindow[validHead] = raw;
      validHead = (validHead + 1) % VALID_WINDOW;
      if (validCount < VALID_WINDOW) validCount++;
      gotValid++;
    }

    if (i < MEDIAN_SAMPLES - 1) delayMicroseconds(500);
  }

  if (gotValid == 0) {
    distanceHeld = true;
    return lastValidDistance;
  }
  distanceHeld = false;

  float tmp[VALID_WINDOW];
  for (int i = 0; i < validCount; i++) tmp[i] = validWindow[i];

  for (int i = 1; i < validCount; i++) {
    float key = tmp[i];
    int j = i - 1;
    while (j >= 0 && tmp[j] > key) {
      tmp[j + 1] = tmp[j];
      j--;
    }
    tmp[j + 1] = key;
  }

  lastValidDistance = tmp[validCount / 2];
  return lastValidDistance;
}

// ==========================================================
// RGB LED + ไฟสถานะ
// ==========================================================
void setRGB(bool r, bool g, bool b) {
  digitalWrite(RED_PIN,   r ? LED_ON : LED_OFF);
  digitalWrite(GREEN_PIN, g ? LED_ON : LED_OFF);
  digitalWrite(BLUE_PIN,  b ? LED_ON : LED_OFF);
}

// ---------- ตารางไฟสถานะทั้งหมดของบอร์ดนี้ ----------
// สเปกไฟชุดใหม่ — ไฟดวงนี้เป็นไฟดวงเดียวของทั้งระบบ จึงต้องเล่าครบทั้งขั้นตอน
//   น้ำเงินกระพริบ       = เพิ่งเปิดเครื่อง / ยังไม่พร้อม (WiFi, คลาวด์ หรือ Chair ยังไม่ครบ)
//   น้ำเงินค้าง          = พร้อมใช้งาน
//   เขียวกระพริบ         = ผู้ทดสอบนั่งแล้ว ลุกได้เลย
//   ขาวกระพริบ           = ลุกเดินแล้ว กำลังจับเวลา
//   ขาวค้าง              = ผ่านจุดหมุนตัวแล้ว กำลังเดินกลับ
//   เขียว/เหลือง/แดงค้าง = ผลประเมิน LOW / MODERATE / HIGH (ค้าง 10 วิ แล้วกลับเป็นพร้อมใช้งาน)
//
// สาเหตุที่ "ยังไม่พร้อม" ดูได้จาก Serial log และจากการ์ดสถานะบนเว็บ (field light/state)
// ไฟจึงไม่ต้องแยกสีตามสาเหตุ — เจ้าหน้าที่หน้างานเห็นแค่ "พร้อม/ไม่พร้อม" ก็พอ
static const LedPattern PAT_NOT_READY    = {false, false, true,  BLINK_NOT_READY_ON_MS, BLINK_NOT_READY_PERIOD_MS, 1};
static const LedPattern PAT_READY        = {false, false, true,  0,                     0,                         1};
static const LedPattern PAT_STAND_UP     = {false, true,  false, BLINK_STANDUP_ON_MS,   BLINK_STANDUP_PERIOD_MS,   1};
static const LedPattern PAT_WALKING      = {true,  true,  true,  BLINK_WALKING_ON_MS,   BLINK_WALKING_PERIOD_MS,   1};
static const LedPattern PAT_PASSED       = {true,  true,  true,  0,                     0,                         1};
static const LedPattern PAT_RESULT_LOW   = {false, true,  false, 0,                     0,                         1};
static const LedPattern PAT_RESULT_MOD   = {true,  true,  false, 0,                     0,                         1};  // Red + Green = Yellow
static const LedPattern PAT_RESULT_HIGH  = {true,  false, false, 0,                     0,                         1};

const LedPattern* activePattern = nullptr;
unsigned long     patternStart  = 0;

// เปลี่ยนรูปแบบ = เริ่มนับเฟสใหม่ ไฟจะขึ้นต้นด้วยแวบแรกเสมอ ไม่ไปโผล่กลางจังหวะ
void setLedPattern(const LedPattern& p) {
  if (activePattern == &p) return;
  activePattern = &p;
  patternStart  = millis();
}

// ขับไฟตามเฟสของรูปแบบปัจจุบัน — ไม่มี delay() ต้องถูกเรียกบ่อย ๆ จาก loop()
void driveLed() {
  if (!activePattern) return;
  const LedPattern& p = *activePattern;

  if (p.periodMs == 0 || p.onMs == 0) {
    setRGB(p.r, p.g, p.b);
    return;
  }

  unsigned long t    = (millis() - patternStart) % p.periodMs;
  unsigned long slot = 2UL * p.onMs;            // 1 แวบ = ติด onMs แล้วดับ onMs
  bool          on   = (t < slot * p.pulses) && (t % slot < p.onMs);

  if (on) setRGB(p.r, p.g, p.b);
  else    setRGB(false, false, false);
}

bool chairLinkOk() {
  return lastChairAck != 0 && (millis() - lastChairAck < CHAIR_LINK_TIMEOUT_MS);
}

// อุปกรณ์ "พร้อมใช้งาน" ต่อเมื่อครบทั้งสามอย่าง — ขาดข้อใดข้อหนึ่ง = น้ำเงินกระพริบ
//   ① ต่อ WiFi ได้        ② เขียน Firestore สำเร็จจริง        ③ คุยกับ Chair ได้
bool deviceReady() {
  return wifiConnected && cloudOk && chairLinkOk();
}

// เลือกขั้นตอนของไฟจาก "สถานะรอบทดสอบ" + "สถานะของเก้าอี้" + "สถานะการเชื่อมต่อ"
//
// ลำดับความสำคัญมีเหตุผลกำกับทุกบรรทัด:
//   ① ผลลัพธ์มาก่อนเสมอ — เป็นสิ่งเดียวที่เจ้าหน้าที่ต้องอ่านให้ทัน
//   ② "ผ่านจุดหมุนตัวแล้ว" ต้องมาก่อน "กำลังเดิน" เพราะบอร์ดนี้รู้ตัวเองทันทีที่ตรวจเจอ
//      ส่วน chairState=RETURNING ยังต้องรอแพ็กเก็ตจาก Chair อีกเสี้ยววินาที
//      ถ้าเรียงกลับกัน ไฟจะกระพริบขาวต่ออีกแวบก่อนจะค้าง ดูเหมือนระบบสะดุด
//   ③ ปัญหาการเชื่อมต่อเช็คทีหลังขั้นตอนทดสอบ — ระหว่างจับเวลาไฟต้องนิ่ง
//      ไม่ใช่เปลี่ยนเป็นน้ำเงินกลางคันเพราะ PING พลาดไปครั้งเดียว
LightPhase currentLightPhase() {
  if (currentState == CP_RESULT) {
    if (resultRisk == RISK_LOW)      return LIGHT_RESULT_LOW;
    if (resultRisk == RISK_MODERATE) return LIGHT_RESULT_MOD;
    return LIGHT_RESULT_HIGH;
  }

  if (awaitingFinish || chairState == CHAIR_RETURNING)              return LIGHT_PASSED;
  if (currentState == CP_DETECTING || chairState == CHAIR_RUNNING)  return LIGHT_WALKING;
  if (!deviceReady())                                              return LIGHT_NOT_READY;
  if (chairState == CHAIR_READY)                                   return LIGHT_STAND_UP;
  return LIGHT_READY;
}

const char* lightName(LightPhase p) {
  switch (p) {
    case LIGHT_NOT_READY:   return "not_ready";
    case LIGHT_READY:       return "ready";
    case LIGHT_STAND_UP:    return "stand_up";
    case LIGHT_WALKING:     return "walking";
    case LIGHT_PASSED:      return "passed";
    case LIGHT_RESULT_LOW:  return "result_low";
    case LIGHT_RESULT_MOD:  return "result_moderate";
    default:                return "result_high";
  }
}

const char* chairStateName(uint8_t s) {
  switch (s) {
    case CHAIR_CALIBRATE: return "CALIBRATE";
    case CHAIR_WAIT_SIT:  return "WAIT_SIT";
    case CHAIR_READY:     return "READY";
    case CHAIR_RUNNING:   return "RUNNING";
    case CHAIR_RETURNING: return "RETURNING";
    case CHAIR_COOLDOWN:  return "COOLDOWN";
    default:              return "UNKNOWN";
  }
}

void updateStatusLight() {
  switch (currentLightPhase()) {
    case LIGHT_NOT_READY:  setLedPattern(PAT_NOT_READY);   break;
    case LIGHT_READY:      setLedPattern(PAT_READY);       break;
    case LIGHT_STAND_UP:   setLedPattern(PAT_STAND_UP);    break;
    case LIGHT_WALKING:    setLedPattern(PAT_WALKING);     break;
    case LIGHT_PASSED:     setLedPattern(PAT_PASSED);      break;
    case LIGHT_RESULT_LOW: setLedPattern(PAT_RESULT_LOW);  break;
    case LIGHT_RESULT_MOD: setLedPattern(PAT_RESULT_MOD);  break;
    default:               setLedPattern(PAT_RESULT_HIGH); break;
  }
  driveLed();
}

// ==========================================================
// Cloud Firestore
// ==========================================================

// [แก้ข้อ 8] รายงานสถานะตัวเองขึ้น Firestore
// เดิมบอร์ดนี้ต่อ WiFi ไว้เฉย ๆ เพื่อ sync channel ของ ESP-NOW เท่านั้น
// เว็บจึงไม่มีทางรู้เลยว่า Checkpoint เปิดอยู่หรือเปล่า
// คืน true เฉพาะเมื่อ "เขียนขึ้น Firestore สำเร็จจริง" เท่านั้น
// ผู้เรียกใช้ค่านี้ตัดสินใจว่าจะรออีก 15 วิ หรือรีบลองใหม่ใน 3 วิ
bool sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED || !Firebase.ready()) return false;

  uint32_t nowSec = getEpoch();
  if (nowSec == 0) return false;

  // ใช้หน้าต่างกว้างกว่า chairLinkOk() ของไฟสถานะ (6 วิ) โดยตั้งใจ
  // ไฟที่บอร์ดต้องไวเพื่อให้เจ้าหน้าที่เห็นทันที แต่ค่าที่ขึ้นเว็บควรนิ่ง ไม่กระพริบ
  // ออนไลน์/ออฟไลน์ไปมาเพราะ PING พลาดครั้งเดียว
  bool chairOnline = (lastChairAck != 0) && (millis() - lastChairAck < 15000);

  FirebaseJson content;
  content.set("fields/online/booleanValue",       true);
  content.set("fields/last_seen/integerValue",    String((long)nowSec));
  content.set("fields/state/stringValue",         getStateName(currentState));
  content.set("fields/rssi/integerValue",         String((long)WiFi.RSSI()));
  content.set("fields/device/stringValue",        "checkpoint");
  content.set("fields/fw_version/stringValue",    FW_VERSION);
  content.set("fields/uptime_sec/integerValue",   String((long)(millis() / 1000)));
  content.set("fields/chair_online/booleanValue", chairOnline);
  content.set("fields/wifi_ssid/stringValue",     WiFi.SSID());
  content.set("fields/ap_ssid/stringValue",       portal.apSSID());
  // สองอันนี้ทำให้เว็บโชว์สีไฟดวงเดียวกับที่หน้างานเห็นจริง โดยไม่ต้องเดาเอาจาก state
  // และเป็นทางที่หน้า live รู้ว่า "ผ่านจุดหมุนตัวแล้ว" ก่อนที่เก้าอี้จะว่างมาบอกเอง
  content.set("fields/light/stringValue",         lightName(currentLightPhase()));
  content.set("fields/chair_state/stringValue",   chairStateName(chairState));

  if (!Firebase.Firestore.patchDocument(
        &fbdo, FIREBASE_PROJECT_ID, "(default)",
        "device_status/checkpoint", content.raw(),
        "online,last_seen,state,rssi,device,fw_version,uptime_sec,chair_online,"
        "wifi_ssid,ap_ssid,light,chair_state")) {
    Serial.println("  [Heartbeat] ❌ " + fbdo.errorReason());
    return false;
  }
  return true;
}

long readIntField(FirebaseJson& payload, const char* path) {
  FirebaseJsonData result;
  payload.get(result, path);
  // Firestore ส่ง integerValue มาเป็น string เสมอ
  return result.success ? result.to<String>().toInt() : 0;
}

// [แก้ข้อ 8] รับคำสั่งรีเซ็ตจากเว็บได้เอง ไม่ต้องเดินไปกดปุ่มที่บอร์ด
// หลักการ ack-before-restart เหมือนฝั่ง Chair:
// ต้องเขียน reset_handled_at สำเร็จก่อนรีบูต ไม่งั้นบูตขึ้นมาจะเจอคำสั่งเดิมค้าง
// แล้ววนรีบูตไม่รู้จบ
void checkResetCommand() {
  if (WiFi.status() != WL_CONNECTED || !Firebase.ready()) return;

  if (!Firebase.Firestore.getDocument(&fbdo, FIREBASE_PROJECT_ID, "(default)",
                                      "device_commands/checkpoint", "")) {
    return;   // ยังไม่มี document — ไม่มีคำสั่งค้าง
  }

  FirebaseJson payload;
  payload.setJsonData(fbdo.payload());

  long resetReq = readIntField(payload, "fields/reset_requested_at/integerValue");
  long resetAck = readIntField(payload, "fields/reset_handled_at/integerValue");
  if (resetReq <= 0 || resetReq <= resetAck) return;

  Serial.println();
  Serial.println("========================================");
  Serial.println("  [Remote Reset] คำสั่งรีเซ็ตจากเว็บ — กำลังรีบูต...");
  Serial.println("========================================");

  FirebaseJson ack;
  ack.set("fields/reset_handled_at/integerValue", String(resetReq));

  if (!Firebase.Firestore.patchDocument(&fbdo, FIREBASE_PROJECT_ID, "(default)",
                                        "device_commands/checkpoint", ack.raw(),
                                        "reset_handled_at")) {
    Serial.println("  [Remote Reset] ❌ ack ไม่สำเร็จ — ยกเลิกการรีบูต จะลองใหม่รอบหน้า");
    Serial.println("  [Remote Reset] Error : " + fbdo.errorReason());
    return;
  }

  delay(200);
  ESP.restart();
}

// ==========================================================
// ESP-NOW
// ==========================================================
void sendCommand(const char* cmd, float t) {
  strncpy(msgData.command, cmd, sizeof(msgData.command) - 1);
  msgData.command[sizeof(msgData.command) - 1] = '\0';
  msgData.timeSec    = t;
  msgData.runId      = currentRunId;
  msgData.chairState = chairState;   // สะท้อนกลับเฉย ๆ ฝั่ง Chair ไม่ได้ใช้ค่านี้
  esp_now_send(chairMAC, (uint8_t *)&msgData, sizeof(msgData));
}

// ---------- ความเข้ากันได้ของ signature ระหว่าง core เวอร์ชันต่าง ๆ ----------
// ESP32 Arduino core 3.x เปลี่ยน argument ตัวแรกของ callback ทั้งสองตัว
// จาก "uint8_t* MAC" เป็น struct info โค้ดเดิมใช้ cast ทับซึ่งผิดชนิดจริง ๆ
// (ที่ยังไม่พังเพราะไม่เคยแตะ argument ตัวนั้น) ตรงนี้ประกาศให้ถูกต้อง
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  #define ESPNOW_SEND_CB_ARG  const esp_now_send_info_t *sendInfo
  #define ESPNOW_RECV_CB_ARG  const esp_now_recv_info_t *recvInfo
#else
  #define ESPNOW_SEND_CB_ARG  const uint8_t *sendInfo
  #define ESPNOW_RECV_CB_ARG  const uint8_t *recvInfo
#endif

void OnDataSent(ESPNOW_SEND_CB_ARG, esp_now_send_status_t status) {
  // ไม่พิมพ์ทุกครั้ง เพราะจะทำให้ log รก — เก็บไว้เป็นสัญญาณว่า Chair ยังออนไลน์
  if (status == ESP_NOW_SEND_SUCCESS) lastChairAck = millis();
}

void OnDataRecv(ESPNOW_RECV_CB_ARG, const uint8_t *incomingData, int len) {
  // ใช้ buffer แยกจาก msgData ที่ใช้ส่ง ไม่งั้นข้อมูลขารับจะไปทับข้อมูลขาส่ง
  struct_message in;
  if (len != sizeof(in)) return;
  memcpy(&in, incomingData, sizeof(in));
  in.command[sizeof(in.command) - 1] = '\0';

  // ได้ยินเสียงจาก Chair = ลิงก์ยังดี ไม่ว่าจะเป็นคำสั่งอะไรก็ตาม
  lastChairAck = millis();

  // ทุกแพ็กเก็ตแนบสถานะเก้าอี้มาด้วย — ค่านี้คือตัวขับสีไฟหลักของบอร์ดนี้
  // อัปเดตก่อนแยกประเภทคำสั่ง จะได้ไม่ต้องไปไล่เขียนซ้ำในทุกสาขา
  if (in.chairState != chairState) {
    chairState   = in.chairState;
    heartbeatDue = true;   // สีไฟเปลี่ยน = ดัน field light ขึ้นเว็บทันที (ทำจากลูป)
  }

  // --- PING / STATE: ใช้บอกสถานะและเช็คลิงก์เท่านั้น ไม่ต้องทำอะไรต่อ ---
  if (strcmp(in.command, "PING")  == 0) return;
  if (strcmp(in.command, "STATE") == 0) return;

  // --- START: เริ่มเฝ้ารอผู้ทดสอบ ---
  if (strcmp(in.command, "START") == 0) {
    currentRunId    = in.runId;   // จำ runId ของรอบนี้ไว้ตอบกลับ
    currentState    = CP_DETECTING;
    debounceActive  = false;
    awaitingFinish  = false;
    detectStart     = millis();
    updateStatusLight();

    Serial.println();
    Serial.println("========================================");
    Serial.println("  [START] Test begun! ไฟเข้าโหมดกำลังทดสอบ");
    Serial.print  ("  runId: "); Serial.println(currentRunId);
    Serial.println("  Watching for patient arrival...");
    Serial.println("========================================");
    return;
  }

  // --- [แก้ข้อ 10] ABORT: Chair ยกเลิก/หมดเวลา/กำลังรีบูต ---
  // เดิมไม่มีคำสั่งนี้ บอร์ดจึงค้างรออยู่แบบนั้นและไฟค้างสีของรอบเก่า
  if (strcmp(in.command, "ABORT") == 0) {
    currentState   = CP_IDLE;
    debounceActive = false;
    awaitingFinish = false;
    updateStatusLight();

    Serial.println();
    Serial.println("  [ABORT] ได้รับคำสั่งยกเลิกจาก Chair — กลับสู่สถานะพร้อมใช้งาน");
    Serial.println();
    return;
  }

  // --- FINISH: แสดงผลด้วยไฟ RGB ---
  if (strcmp(in.command, "FINISH") == 0) {
    float finalTime = in.timeSec;
    lastResultSec   = finalTime;
    resultRisk      = riskLevelOf(finalTime);   // เกณฑ์ 11 / 30 ตามเอกสาร
    currentState    = CP_RESULT;
    resultStart     = millis();
    awaitingFinish  = false;
    updateStatusLight();

    Serial.println();
    Serial.println("========================================");
    Serial.println("  TEST RESULT");
    Serial.println("----------------------------------------");
    Serial.print("  Total time  : "); Serial.print(finalTime, 2); Serial.println(" s");
    Serial.print("  Risk level  : "); Serial.println(riskName(resultRisk));
    Serial.print("  RGB display : ");
    Serial.println(resultRisk == RISK_LOW ? "GREEN" : (resultRisk == RISK_MODERATE ? "YELLOW" : "RED"));
    Serial.println("========================================");
    Serial.println();
  }
}

// ==========================================================
// WiFi ↔ บริการที่ต้องใช้เน็ต (NTP / Firebase)
// ==========================================================
// แยกออกมาเป็นฟังก์ชันเพราะ WiFi อาจต่อได้ "ทีหลัง" ตอนบูตไปแล้ว
// (ผู้ใช้เพิ่งตั้งค่าผ่าน portal หรือ Router เพิ่งกลับมา) — เรียกซ้ำได้อย่างปลอดภัย
void onWiFiConnected() {
  heartbeatDue = true;   // เพิ่งกลับมาออนไลน์ — รีบบอกเว็บทันที ไม่ต้องรอครบรอบ

  Serial.println();
  Serial.println("  [WiFi] ✅ ออนไลน์แล้ว");
  Serial.print("  [WiFi] SSID    : "); Serial.println(WiFi.SSID());
  Serial.print("  [WiFi] IP      : "); Serial.println(WiFi.localIP());
  Serial.print("  [WiFi] Channel : "); Serial.println(WiFi.channel());
  Serial.print("  [WiFi] Signal  : "); Serial.print(WiFi.RSSI()); Serial.println(" dBm");

  if (!ntpStarted) {
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    ntpStarted = true;
    Serial.println("  [NTP] เริ่ม sync เวลาแล้ว (ทำเบื้องหลัง)");
  }

  if (!firebaseStarted) {
    firebaseConfig.api_key = FIREBASE_API_KEY;
    auth.user.email        = FIREBASE_EMAIL;
    auth.user.password     = FIREBASE_PASS;
    firebaseConfig.token_status_callback = tokenStatusCallback;

    Firebase.begin(&firebaseConfig, &auth);
    Firebase.reconnectWiFi(true);
    fbdo.setResponseSize(4096);

    firebaseStarted = true;
    firebaseReady   = true;
    Serial.println("  [Firebase] กำลังรับ token... (อาจใช้เวลา 5-10 วินาที)");
  }
}

// ==========================================================
// SETUP
// ==========================================================
void setup() {
  Serial.begin(115200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  pinMode(RED_PIN,   OUTPUT);
  pinMode(GREEN_PIN, OUTPUT);
  pinMode(BLUE_PIN,  OUTPUT);
  setLedPattern(PAT_NOT_READY);   // น้ำเงินกระพริบ = ยังไม่พร้อม (ช่วงนี้ลูปหลักยังไม่เดิน)
  driveLed();

  Serial.println();
  Serial.println("========================================");
  Serial.println("  TUG Test — Checkpoint Controller (ESP2)");
  Serial.print  ("  Firmware: "); Serial.println(FW_VERSION);
  Serial.println("========================================");

  // ----------------------------------------------------------
  // ① WiFi Setup Portal (ต้องทำก่อน ESP-NOW เพราะเป็นคนตั้งโหมด WiFi)
  //    เปิด SoftAP ค้างไว้ตลอด + ต่อ WiFi ที่จำไว้ให้อัตโนมัติ
  //    เปลี่ยน WiFi ได้จากหน้าเว็บ ไม่ต้องอัปโหลดโค้ดใหม่
  // ----------------------------------------------------------
  portal.begin(AP_SSID, AP_PASSWORD, "TUG Checkpoint (จุดหมุนตัว 3 ม.)");

  Serial.print("  [ESP-NOW] MAC ของบอร์ดนี้ : ");
  Serial.println(WiFi.macAddress());   // เอาไปใส่ในตัวแปร checkpointMAC[] ของ ESP_Chair

  Serial.print("  [WiFi] กำลังเชื่อมต่อเครือข่ายที่จดจำไว้");
  unsigned long wifiStart = millis();
  while (!portal.isConnected() && millis() - wifiStart < WIFI_TIMEOUT_MS) {
    portal.handle();
    driveLed();     // ต้องเรียกด้วย ไม่งั้นไฟจะค้างนิ่งแทนที่จะกระพริบตลอดช่วงบูต
    delay(20);
  }
  Serial.println();

  if (portal.isConnected()) {
    wifiConnected = true;
    onWiFiConnected();

    Serial.print("  [NTP] กำลัง sync เวลา");
    unsigned long t0 = millis();
    while (getEpoch() == 0 && millis() - t0 < 8000) {
      portal.handle();
      driveLed();
      delay(300);
      Serial.print(".");
    }
    Serial.println();
  } else {
    Serial.println("  [WiFi] ⚠️  ยังไม่ได้เชื่อมต่อ!");
    Serial.print  ("  ต่อมือถือ/โน้ตบุ๊กเข้า WiFi ชื่อ \"");
    Serial.print(AP_SSID);
    Serial.println("\" เพื่อตั้งค่า");
    Serial.println("  ⚠️  ESP-NOW อาจทำงานผิดพลาดหากอยู่คนละ channel กับ ESP_Chair");
    Serial.println("      บอร์ดทั้งสองต้องต่อ WiFi 'วงเดียวกัน' เสมอ");
  }

  // ----------------------------------------------------------
  // ② ESP-NOW (ต้องหลัง WiFi พร้อมแล้ว)
  // ----------------------------------------------------------
  if (esp_now_init() != ESP_OK) {
    Serial.println("[ERROR] ESP-NOW initialization failed!");
    return;
  }

  esp_now_register_send_cb(OnDataSent);
  esp_now_register_recv_cb(OnDataRecv);

  // [แก้ข้อ 13] เปิดการเข้ารหัส — กันคนยิงแพ็กเก็ตปลอมเข้ามาในระบบ
  esp_now_set_pmk((uint8_t *)ESPNOW_PMK);

  memset(&peerInfo, 0, sizeof(peerInfo));
  memcpy(peerInfo.peer_addr, chairMAC, 6);
  peerInfo.channel = 0;
  peerInfo.encrypt = true;
  memcpy(peerInfo.lmk, ESPNOW_LMK, 16);

  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    Serial.println("[ERROR] Failed to add ESP-NOW peer!");
    return;
  }

  Serial.println();
  Serial.println("  [ESP-NOW] ✅ พร้อมแล้ว (เข้ารหัส)");
  Serial.print  ("  [Config] เกณฑ์ความเสี่ยง: LOW <= ");
  Serial.print(TUG_LOW_RISK_MAX, 0); Serial.print("s, MODERATE <= ");
  Serial.print(TUG_MOD_RISK_MAX, 0); Serial.println("s, HIGH > 30s");
  Serial.println("  Firmware ready. Waiting for START...");
  Serial.println("----------------------------------------");
  Serial.println("  ไฟสถานะ: น้ำเงินกระพริบ=ยังไม่พร้อม / น้ำเงินค้าง=พร้อมใช้งาน");
  Serial.println("           เขียวกระพริบ=นั่งแล้ว ลุกได้ / ขาวกระพริบ=กำลังเดิน");
  Serial.println("           ขาวค้าง=ผ่านจุดหมุนตัวแล้ว");
  Serial.println("           เขียว-เหลือง-แดงค้าง=ผลประเมิน LOW-MODERATE-HIGH (10 วิ)");
  Serial.println("========================================");
  Serial.println();

  updateStatusLight();   // ปล่อยให้ไฟว่าไปตามสถานะการเชื่อมต่อจริงตั้งแต่วินาทีแรก
}

// ==========================================================
// MAIN LOOP
// ==========================================================
void loop() {
  float distance = getDistance();
  unsigned long now = millis();

  // --- WiFi Setup Portal ---
  // handle() เร็วมาก (แค่ตอบ HTTP/DNS ที่ค้างอยู่) แต่ "สแกน WiFi" กับ "ลองต่อใหม่"
  // กินเวลาเป็นวินาที จึงต้องห้ามทำระหว่าง CP_DETECTING ด้วยเหตุผลเดียวกับ Firestore:
  // บอร์ดอาจพลาดจังหวะที่ผู้ทดสอบเดินผ่าน
  portal.setTimingCritical(currentState == CP_DETECTING);
  portal.handle();

  // สถานะเปลี่ยน = ดัน heartbeat ขึ้นเว็บทันที
  // สำคัญมากตอนออกจาก CP_DETECTING เพราะช่วงนั้นบอร์ดหยุดส่ง heartbeat ไปเลย
  // ถ้ารอครบรอบปกติอีก 15 วิ เว็บจะค้างเห็นเป็น OFFLINE นานเกินจำเป็น
  static CheckpointState prevReportedState = CP_IDLE;
  if (currentState != prevReportedState) {
    prevReportedState = currentState;
    heartbeatDue = true;
  }

  bool wifiNow = portal.isConnected();
  if (wifiNow != wifiConnected) {
    wifiConnected = wifiNow;
    if (wifiNow) onWiFiConnected();
    else {
      cloudOk = false;   // WiFi หลุด = คลาวด์ใช้ไม่ได้แน่นอน ไม่ต้องรอ heartbeat พลาดก่อน
      Serial.println("  [WiFi] ⚠️  หลุดการเชื่อมต่อ — portal จะลองต่อใหม่ให้เอง");
    }
  }

  // --- Periodic status print ---
  if (now - lastPrintTime >= SERIAL_INTERVAL_MS) {
    Serial.print("[");
    Serial.print(getStateName(currentState));
    Serial.print("] Distance: ");
    Serial.print(distance, 1);
    Serial.print(" cm");
    if (distanceHeld) Serial.print(" (hold)");
    if (WiFi.status() != WL_CONNECTED)      Serial.print("  [WiFi: X]");
    if (firebaseReady && !Firebase.ready()) Serial.print("  [Firebase: pending]");
    Serial.println();
    lastPrintTime = now;
  }

  // --- งานที่คุย Firestore ---
  // สำคัญ: ห้ามทำระหว่าง CP_DETECTING เด็ดขาด เพราะ HTTPS จะบล็อกลูปหลายร้อย ms
  // แล้วบอร์ดอาจ "พลาด" จังหวะที่ผู้ทดสอบเดินผ่าน ทำให้เวลา checkpoint เพี้ยน
  if (currentState != CP_DETECTING) {
    if (heartbeatDue || now - lastHeartbeat >= heartbeatGap) {
      lastHeartbeat = now;
      heartbeatDue  = false;
      // ส่งสำเร็จ → รอบหน้าอีก 15 วิ / ไม่สำเร็จ → รีบลองใหม่ใน 3 วิ
      cloudOk      = sendHeartbeat();
      heartbeatGap = cloudOk ? HEARTBEAT_INTERVAL_MS : HEARTBEAT_RETRY_MS;
    }
    if (now - lastCommandPoll >= COMMAND_POLL_INTERVAL_MS) {
      checkResetCommand();
      lastCommandPoll = now;
    }
  }

  // --- State Machine ---
  switch (currentState) {

    case CP_IDLE:
      // รอ START ผ่าน ESP-NOW callback
      // ยกเว้นกรณีเพิ่งส่ง CHECKPOINT ไปแล้วรอ FINISH อยู่ — ถ้า Chair หายไป
      // (รีบูต/ไฟดับ/แพ็กเก็ตหาย) ต้องเลิกรอ ไม่งั้นไฟจะแวบคู่ค้างอยู่แบบนั้นตลอด
      if (awaitingFinish && now - checkpointPassed >= DETECT_TIMEOUT_MS) {
        awaitingFinish = false;
        Serial.println();
        Serial.println("  [TIMEOUT] ⚠️  รอผลจาก Chair นานเกินไป — กลับสู่ไฟพร้อมใช้งาน");
        Serial.println();
      }
      break;

    case CP_DETECTING:
      // [แก้ข้อ 10] กันค้างถาวรถ้า Chair หายไป (รีบูต/ไฟดับ/แพ็กเก็ต ABORT หาย)
      if (now - detectStart >= DETECT_TIMEOUT_MS) {
        currentState   = CP_IDLE;
        debounceActive = false;
        awaitingFinish = false;
        Serial.println();
        Serial.println("  [TIMEOUT] ⚠️  ไม่มีใครเดินผ่านและ Chair ไม่ตอบ — กลับสู่ IDLE");
        Serial.println();
        break;
      }

      if (distance > 0.0 && distance < DIST_DETECT) {
        if (!debounceActive) {
          debounceActive = true;
          debounceStart  = now;
        } else if (now - debounceStart >= DEBOUNCE_DETECT_MS) {
          // ยืนยันแล้วว่าผู้ทดสอบมาถึงจุดหมุนตัว
          sendCommand("CHECKPOINT", 0.0);   // แนบ runId ของรอบนี้ไปด้วยอัตโนมัติ
          currentState     = CP_IDLE;
          debounceActive   = false;
          awaitingFinish   = true;          // ไฟแวบคู่ = ยังอยู่ในรอบทดสอบ รอผลจาก Chair
          checkpointPassed = now;

          Serial.println();
          Serial.println("========================================");
          Serial.println("  [CHECKPOINT] Patient detected!");
          Serial.println("  Signal sent to Chair. รอผลลัพธ์ (ไฟแวบคู่)");
          Serial.println("========================================");
        }
      } else {
        debounceActive = false;
      }
      break;

    case CP_RESULT:
      // แสดงไฟผลลัพธ์ชั่วคราว แล้วกลับเป็นไฟ "พร้อมใช้งาน"
      // เพื่อให้เจ้าหน้าที่แยกออกว่า "ไฟค้างจากรอบเก่า" กับ "พร้อมทำรอบใหม่" ต่างกัน
      if (now - resultStart >= RESULT_DISPLAY_MS) {
        currentState = CP_IDLE;
        Serial.println("  [RESULT] แสดงผลครบเวลาแล้ว — กลับสู่ไฟพร้อมใช้งาน (น้ำเงิน)");
      }
      break;
  }

  // --- ไฟสถานะ ---
  // เรียกทุกรอบ: เลือกรูปแบบตามสถานะล่าสุด แล้วขับจังหวะกระพริบต่อ (ไม่มี delay())
  updateStatusLight();

  delay(10);
}
