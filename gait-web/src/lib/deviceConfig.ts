// ค่าระยะเซนเซอร์ที่ปรับได้จากส่วน "ตั้งค่าอุปกรณ์"
// ⚠️ ช่วงค่าและค่าเริ่มต้นต้องตรงกับ CFG_* / DIST_* ใน ESP_Chair_v2.ino และ ESP_Checkpoint_v2.ino
//    บอร์ดตรวจซ้ำอีกชั้น และจะไม่ใช้ค่าที่อยู่นอกช่วงนี้

export interface ChairDistances {
  /** ระยะไม่เกินเท่านี้ = นั่งอยู่ */
  sitCm: number;
  /** ระยะมากกว่าเท่านี้ = ลุกแล้ว */
  standCm: number;
}

export interface CheckpointDistances {
  /** ระยะน้อยกว่าเท่านี้ = ผู้ทดสอบเดินมาถึงจุดหมุนตัว */
  detectCm: number;
}

export const CHAIR_DEFAULTS: ChairDistances = { sitCm: 10, standCm: 30 };
export const CHECKPOINT_DEFAULTS: CheckpointDistances = { detectCm: 30 };

export const LIMITS = {
  sit: { min: 3, max: 60 },
  stand: { min: 10, max: 150 },
  detect: { min: 10, max: 150 },
  /** ระยะลุกต้องห่างจากระยะนั่งอย่างน้อยเท่านี้ — กันสถานะแกว่งไปมาระหว่างนั่ง/ลุก */
  gap: 10,
} as const;

/** ความยาวสเกลของแถบแสดงช่วงระยะ (ซม.) */
export const SCALE_MAX_CM = 150;

const inRange = (n: number, r: { min: number; max: number }) =>
  Number.isFinite(n) && n >= r.min && n <= r.max;

/** null = ค่าใช้ได้ · ข้อความ = เหตุผลที่ใช้ไม่ได้ (แสดงให้เจ้าหน้าที่เห็นตรง ๆ) */
export function chairError(v: ChairDistances): string | null {
  if (!inRange(v.sitCm, LIMITS.sit)) return `ระยะนั่งต้องอยู่ระหว่าง ${LIMITS.sit.min}-${LIMITS.sit.max} ซม.`;
  if (!inRange(v.standCm, LIMITS.stand)) return `ระยะลุกต้องอยู่ระหว่าง ${LIMITS.stand.min}-${LIMITS.stand.max} ซม.`;
  if (v.standCm - v.sitCm < LIMITS.gap) return `ระยะลุกต้องมากกว่าระยะนั่งอย่างน้อย ${LIMITS.gap} ซม.`;
  return null;
}

export function checkpointError(v: CheckpointDistances): string | null {
  if (!inRange(v.detectCm, LIMITS.detect)) {
    return `ระยะตรวจจับต้องอยู่ระหว่าง ${LIMITS.detect.min}-${LIMITS.detect.max} ซม.`;
  }
  return null;
}
