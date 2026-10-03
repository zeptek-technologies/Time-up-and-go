# TUG Gait Camera (Web)

ระบบกล้องตรวจจับท่าทางการเดิน (gait) บนเบราว์เซอร์ สำหรับโครงการ
**ระบบประเมินความเสี่ยงการล้มของผู้สูงอายุแบบ Timed Up and Go Test (TUG)**

เป็นการย้าย logic จาก `../main.py` (OpenCV + MediaPipe Python prototype) มาเป็นเว็บ
React + TypeScript โดยรัน pose estimation **ทั้งหมดในเบราว์เซอร์** (on-device, PDPA)
แล้วส่งเฉพาะ "ตัวเลขผลลัพธ์" ขึ้น Firestore — ไม่ส่งวิดีโอ/ภาพใบหน้าออกไป

## รันโปรเจกต์

```bash
cd gait-web
npm install
npm run dev        # http://localhost:5173  (getUserMedia ทำงานบน localhost)
npm run build      # production build
npm test           # ทดสอบด้วยข้อมูลจำลอง ไม่ต้องใช้กล้อง (tests/*.mjs)
```

`tests/gaitClassifier.mjs` จำลองท่าเดิน 5 แบบ (ปกติ / ลากเท้า / โน้มตัว / อัมพาตครึ่งซีก /
เท้าตก) เป็น landmark 33 จุดที่ 30 fps แล้ววิ่งผ่าน pipeline ทั้งสาย เพื่อล็อกกฎของ
classifier, การสรุปผลทั้งรอบ (recorder) และตัวนับก้าว

เปิดในเบราว์เซอร์แล้วอนุญาตให้เข้าถึงกล้อง → จะเห็น skeleton overlay + ตัวชี้วัด gait
แบบเรียลไทม์ กด **● เริ่มบันทึก** เพื่อเก็บเฟรม แล้ว **จบ & อัปโหลดผล** เพื่อบันทึกลง Firestore

## สถาปัตยกรรม

```
CameraView (1 instance ต่อ 1 กล้อง)
  └─ PoseEngine            MediaPipe Pose Landmarker (33 จุด, GPU/WASM)
  └─ GaitFeatureExtractor  คำนวณมุมข้อ/ก้าว/สมมาตร/arm swing (พอร์ตจาก main.py)
  └─ FeatureSmoother       EMA ลด jitter
  └─ RuleBasedClassifier   Normal / Parkinsonian / Hemiplegic / Steppage
  └─ PredictionSmoother    majority vote
        │ onFrame(features, prediction)
        ▼
App  ─ GaitSessionRecorder ─ uploadAssessment() ─→ Firestore: gait_assessments
```

ไฟล์หลักใน `src/lib/` แมปกับคลาสใน `main.py` แบบ 1:1:

| main.py | เว็บ (TypeScript) |
|---------|-------------------|
| `GaitFeatureExtractor` | `lib/gaitFeatures.ts` |
| `RuleBasedGaitClassifier` | `lib/classifier.ts` |
| `FeatureSmoother`, `PredictionSmoother` | `lib/smoothers.ts` |
| `GaitSessionRecorder` | `lib/recorder.ts` |
| `FirebaseGaitLogger` | `lib/firebase.ts` |
| `mp_pose.Pose(...)` | `lib/poseEngine.ts` |
| `mp_drawing.draw_landmarks` | `lib/drawing.ts` |

ค่า threshold/parameter ทั้งหมดอยู่ใน `lib/config.ts` และ `lib/classifier.ts`
(ค่าเดียวกับ argparse defaults ของ `main.py`)

## Firestore

เขียนลง collection **`gait_assessments`** ด้วย schema เดียวกับ `main.py` เป๊ะ
(`timestamp`, `session_duration_frames`, `risk_scores`, `highest_risk_detected`)
บวก `patient_id` และ `source: "web"` → **dashboard เดิม (`ESP_Chair/web_dashboard`)
อ่านได้ทันทีโดยไม่ต้องแก้**

⚠️ เว็บใช้ Firebase **client SDK** จึงต้องตั้ง **Firestore Security Rules** ให้อนุญาต
(Python ใช้ Admin SDK ซึ่งข้าม rules) — ดู `firestore.rules` (เปิดไว้สำหรับ dev เท่านั้น)
deploy ด้วย:

```bash
firebase deploy --only firestore:rules
```

ก่อนใช้งานจริงควรเปลี่ยนเป็น gate ด้วย Firebase Auth

## แผนรองรับ 2 กล้อง (front + side)

โครงสร้างทำเป็น "1 กล้อง = 1 `CameraView`" อยู่แล้ว เพิ่มกล้องที่ 2 ทำได้โดย:

1. ใน `App.tsx` เพิ่ม `<CameraView view="side" label="กล้องด้านข้าง" .../>` อีกตัว
2. แต่ละมุมวัดคนละมิติ:
   - **front** — ความสมมาตรซ้าย-ขวา, การโคลงตัว, ความกว้างก้าว, การหมุนตัว, แกว่งแขน
   - **side** — ความยาวก้าว, มุมข้อเข่า/สะโพก/ข้อเท้า, การเอนลำตัว
3. fuse ผลตาม timestamp ก่อนป้อน recorder (เช่น side ให้ step/มุมข้อ, front ให้ symmetry)
4. เลือกกล้องแต่ละตัวด้วย `deviceId` ผ่าน `navigator.mediaDevices.enumerateDevices()`

## หมายเหตุทางคลินิก

เป็นเครื่องมือ **คัดกรอง/วิจัย (MVP) ไม่ใช่อุปกรณ์วินิจฉัยทางการแพทย์**
threshold ต้อง calibrate กับมุมกล้อง กลุ่มประชากร และข้อมูลที่ label แล้วก่อนใช้งานจริง
