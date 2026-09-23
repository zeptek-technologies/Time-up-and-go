// ตัดสินท่า "นั่ง / กำลังลุก / ยืน / ไม่เห็นคน" จากจุดข้อต่อของเฟรมเดียว
// ออกแบบสำหรับกล้องด้านข้าง (เห็นมุมสะโพกและมุมเข่าชัดที่สุด)
//
// ใช้ 3 สัญญาณ แล้วโหวต 2 ใน 3 — สัญญาณเดียวคลาดได้ (เช่นเก้าอี้บังเข่า) โดยไม่ทำให้ท่าผิด
//   ① มุมสะโพก  ไหล่-สะโพก-เข่า   นั่ง ~90°   ยืน ~170°
//   ② มุมเข่า   สะโพก-เข่า-ข้อเท้า นั่ง ~90°   ยืน ~170°
//   ③ ความสูงสะโพก = (y เข่า − y สะโพก) ÷ ความยาวต้นขา ในภาพ
//      นั่ง: ต้นขาแนวนอน → ~0   ยืน: ต้นขาแนวตั้ง → ~1   ไม่ขึ้นกับระยะห่างจากกล้อง
//
// ⚠️ เกณฑ์เป็นค่าตั้งต้นจากท่าทางทั่วไป ควรปรับจากคลิปผู้ทดสอบจริงก่อนใช้ประเมิน
import { LM, type RawLandmark } from "./landmarks";
import { angle3d, type Vec3 } from "./mathUtils";

export type Posture = "none" | "sitting" | "transition" | "standing";

export interface PostureSample {
  /** เวลาที่ถ่ายเฟรมนี้ (ms ฐานเดียวกับ performance.now) — เดินหน้าอย่างเดียว */
  tMs: number;
  posture: Posture;
  /** องศา ไหล่-สะโพก-เข่า (NaN = มองไม่เห็น) */
  hipAngle: number;
  /** องศา สะโพก-เข่า-ข้อเท้า (NaN = มองไม่เห็น) */
  kneeAngle: number;
  /** ความสูงสะโพกเทียบเข่า หน่วยเป็น "เท่าของความยาวต้นขา" (NaN = มองไม่เห็น) */
  hipLift: number;
}

export const POSTURE_THRESHOLDS = {
  /** จุดข้อต่อต้องชัดอย่างน้อยเท่านี้ทุกจุดของขาข้างที่ใช้ */
  minVisibility: 0.5,
  /** มุมน้อยกว่านี้ = ท่านั่ง */
  sitMaxDeg: 120,
  /** มุมมากกว่านี้ = ท่ายืน (ช่วงระหว่าง 120-150 = กำลังลุก/นั่ง กันท่าสลับไปมา) */
  standMinDeg: 150,
  sitMaxLift: 0.45,
  standMinLift: 0.75,
} as const;

const SIDES = [
  { shoulder: LM.LEFT_SHOULDER, hip: LM.LEFT_HIP, knee: LM.LEFT_KNEE, ankle: LM.LEFT_ANKLE },
  { shoulder: LM.RIGHT_SHOULDER, hip: LM.RIGHT_HIP, knee: LM.RIGHT_KNEE, ankle: LM.RIGHT_ANKLE },
] as const;

export function classifyPosture(
  landmarks: RawLandmark[] | null,
  worldLandmarks: RawLandmark[] | null,
  width: number,
  height: number,
  tMs: number,
): PostureSample {
  const none: PostureSample = { tMs, posture: "none", hipAngle: NaN, kneeAngle: NaN, hipLift: NaN };
  if (!landmarks) return none;

  // กล้องข้างเห็นขาใกล้ชัด ขาไกลโดนบัง — เลือกข้างที่จุดข้อต่อชัดกว่า
  const vis = (i: number) => landmarks[i]?.visibility ?? 0;
  const sideScore = (s: (typeof SIDES)[number]) => Math.min(vis(s.shoulder), vis(s.hip), vis(s.knee), vis(s.ankle));
  const side = sideScore(SIDES[0]) >= sideScore(SIDES[1]) ? SIDES[0] : SIDES[1];
  if (sideScore(side) < POSTURE_THRESHOLDS.minVisibility) return none;

  const img = (i: number): Vec3 => [landmarks[i].x * width, landmarks[i].y * height, (landmarks[i].z ?? 0) * width];
  const world = (i: number): Vec3 | null => {
    const w = worldLandmarks?.[i];
    return w ? [w.x, w.y, w.z ?? 0] : null;
  };
  // มุมจากพิกัด 3 มิติ (แก้มุมมองกล้องแล้ว) ถ้ามี ไม่งั้นใช้พิกัดในภาพ — แบบเดียวกับ gaitFeatures
  const angle = (a: number, b: number, c: number) => {
    const wa = world(a);
    const wb = world(b);
    const wc = world(c);
    return wa && wb && wc ? angle3d(wa, wb, wc) : angle3d(img(a), img(b), img(c));
  };

  const hipAngle = angle(side.shoulder, side.hip, side.knee);
  const kneeAngle = angle(side.hip, side.knee, side.ankle);

  const hip = img(side.hip);
  const knee = img(side.knee);
  const thigh = Math.hypot(knee[0] - hip[0], knee[1] - hip[1]);
  // ภาพ y เพิ่มลงล่าง: สะโพกอยู่สูงกว่าเข่า → knee.y − hip.y เป็นบวก
  const hipLift = thigh > 1 ? (knee[1] - hip[1]) / thigh : NaN;

  const t = POSTURE_THRESHOLDS;
  const sitVotes = Number(hipAngle < t.sitMaxDeg) + Number(kneeAngle < t.sitMaxDeg) + Number(hipLift < t.sitMaxLift);
  const standVotes =
    Number(hipAngle > t.standMinDeg) + Number(kneeAngle > t.standMinDeg) + Number(hipLift > t.standMinLift);
  const posture: Posture = sitVotes >= 2 ? "sitting" : standVotes >= 2 ? "standing" : "transition";

  return { tMs, posture, hipAngle, kneeAngle, hipLift };
}
