// Live metrics + current classification — web port of draw_status_panel().
//
// ข้อความผลวิเคราะห์ (prediction.status / reasons) มาจาก classifier เป็นภาษาอังกฤษ และถูกใช้
// ในตรรกะภายใน (recorder ตรวจ "No Pose", normalizePredictionLabel ตรวจชื่อโรค) จึงห้ามแก้ต้นทาง
// — แปลเป็นภาษาไทยเฉพาะตอนแสดงผลที่นี่
import type { GaitFeatures } from "../lib/gaitFeatures";
import { normalizePredictionLabel, type GaitPrediction } from "../lib/classifier";
import { getDiseaseMeta } from "../lib/meta";

function fmt(v: number | undefined, suffix = "", precision = 1): string {
  if (v === undefined || !Number.isFinite(v)) return "--";
  return `${v.toFixed(precision)}${suffix}`;
}

const SIDE_TH: Record<string, string> = { left: "ซ้าย", right: "ขวา", one: "ข้างหนึ่ง" };

const REASON_TH: Record<string, string> = {
  "heuristics below alert thresholds": "ค่าที่วัดได้อยู่ในเกณฑ์ปกติ",
  "Move fully into camera view": "ให้ผู้ทดสอบอยู่ในกล้องให้เห็นเต็มตัว",
  "excessive swing-phase knee flexion": "งอเข่ามากขณะก้าวขา",
  "asymmetric arm swing (L/R)": "แกว่งแขนซ้าย-ขวาไม่เท่ากัน",
  "reduced bilateral arm swing": "แกว่งแขนน้อยทั้งสองข้าง",
  "reduced arm swing": "แกว่งแขนน้อย",
  "short step length": "ก้าวสั้น",
  "forward trunk lean": "ลำตัวโน้มไปข้างหน้า",
  "one arm held close to torso": "แขนข้างหนึ่งแนบลำตัว",
  "high knee lift": "ยกเข่าสูงผิดปกติ",
};

function reasonThai(reason: string): string {
  if (REASON_TH[reason]) return REASON_TH[reason];
  let m = /^high (left|right) knee lift$/.exec(reason);
  if (m) return `ยกเข่า${SIDE_TH[m[1]]}สูงผิดปกติ`;
  m = /^(\w+) leg movement reduced\/asymmetric$/.exec(reason);
  if (m) return `ขา${SIDE_TH[m[1]] ?? "ข้างหนึ่ง"}เคลื่อนไหวน้อยหรือไม่เท่ากับอีกข้าง`;
  return reason;
}

function statusThai(status: string): string {
  if (status.includes("No Pose")) return "ยังไม่เห็นตัวผู้ทดสอบ";
  return `ท่าเดิน: ${getDiseaseMeta(normalizePredictionLabel(status)).th}`;
}

interface Props {
  features: GaitFeatures | null;
  prediction: GaitPrediction;
}

export default function StatusPanel({ features, prediction }: Props) {
  return (
    <div className="gc-panel" style={{ borderColor: prediction.color }}>
      <div className="gc-panel__status" style={{ color: prediction.color }}>
        {statusThai(prediction.status)}
      </div>
      <div className="gc-panel__disclaimer">เครื่องมือคัดกรอง (รุ่นทดลอง) ไม่ใช่การวินิจฉัยทางการแพทย์</div>

      {!features ? (
        <div className="gc-panel__rows">
          <div>รอให้กล้องเห็นตัวผู้ทดสอบเต็มตัว</div>
          <div>คำแนะนำ: ยืนให้กล้องเห็นเต็มตัว ทั้งมุมหน้าและมุมข้าง</div>
        </div>
      ) : (
        <div className="gc-panel__rows">
          <Row label="มุมเข่า ซ้าย/ขวา" value={`${fmt(features.leftKneeAngle, "°")} / ${fmt(features.rightKneeAngle, "°")}`} />
          <Row label="มุมสะโพก ซ้าย/ขวา" value={`${fmt(features.leftHipAngle, "°")} / ${fmt(features.rightHipAngle, "°")}`} />
          <Row label="ความยาวก้าว" value={`${fmt(features.stepLength, "", 3)} เท่าของความสูง`} />
          <Row label="การแกว่งแขน ซ้าย/ขวา" value={`${fmt(features.leftArmSwing, "", 3)} / ${fmt(features.rightArmSwing, "", 3)}`} />
          <Row label="แขนสองข้างต่างกัน" value={fmt(features.armSwingAsymmetry, "", 3)} />
          <Row
            label="ขาสองข้างต่างกัน"
            value={`${fmt(features.symmetryIndex, "", 3)}  (ข้างที่อ่อนกว่า: ${SIDE_TH[features.weakSide] ?? "ไม่ชัดเจน"})`}
          />
          <Row label="ลำตัวเอียง" value={fmt(features.trunkLean, "°")} />
          <Row label="การยกเข่า ซ้าย/ขวา" value={`${fmt(features.leftKneeLift, "", 3)} / ${fmt(features.rightKneeLift, "", 3)}`} />
          <Row label="จำนวนก้าว" value={`${features.stepCount} ก้าว`} />
          <Row label="จังหวะก้าว" value={fmt(features.cadence, " ก้าว/นาที", 0)} />
          <Row label="ความไม่สม่ำเสมอของจังหวะก้าว" value={fmt(features.stepTimeVariability, "%", 1)} />
        </div>
      )}

      {prediction.reasons.length > 0 && (
        <div className="gc-panel__reasons">{prediction.reasons.slice(0, 3).map(reasonThai).join(" · ")}</div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="gc-panel__row">
      <span className="gc-panel__row-label">{label}</span>
      <span className="gc-panel__row-value">{value}</span>
    </div>
  );
}
