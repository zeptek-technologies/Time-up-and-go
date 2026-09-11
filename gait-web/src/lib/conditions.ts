// รายการโรคประจำตัวที่บันทึกกับผู้ทดสอบได้
// อยู่ใน lib/ เพราะตอนนี้มีผู้ใช้สองที่: หน้าจัดการผู้ทดสอบ (ให้ติ๊กเลือก) และ
// จอ live-status (แสดงชื่อโรคตอนสรุปผล) — id ต้องเป็นชุดเดียวกันเป๊ะ เพราะมันคือ
// สิ่งที่ lib/riskContext.ts ใช้จับคู่กับท่าเดินที่กล้องเห็น
export interface ConditionOption {
  id: string;
  label: string;
  hint: string;
  group: "ระบบประสาท" | "กระดูกและข้อ" | "การทรงตัว" | "หัวใจและปอด";
}

// Common diagnosed conditions that can change walking, balance, joint motion,
// muscle control, or exercise tolerance. These are background data—not diagnoses.
export const CONDITION_OPTIONS: ConditionOption[] = [
  { id: "parkinsons", label: "โรคพาร์กินสัน / กลุ่มอาการพาร์กินสัน", hint: "อาจก้าวสั้น เดินช้า หรือเสียการทรงตัว", group: "ระบบประสาท" },
  { id: "stroke", label: "เคยเป็นโรคหลอดเลือดสมอง", hint: "อาจมีแขนขาอ่อนแรงหรือควบคุมการเดินได้ไม่เท่ากัน", group: "ระบบประสาท" },
  { id: "multiple-sclerosis", label: "โรคปลอกประสาทเสื่อมแข็ง (MS)", hint: "อาจมีอาการอ่อนแรง เกร็ง และเดินไม่มั่นคง", group: "ระบบประสาท" },
  { id: "peripheral-neuropathy", label: "ปลายประสาทเสื่อม / เบาหวานลงปลายประสาท", hint: "อาจชาเท้า รับรู้ตำแหน่งเท้าลดลง หรือเสียสมดุล", group: "ระบบประสาท" },
  { id: "ataxia", label: "โรคสมองน้อยหรือภาวะเดินเซ (Ataxia)", hint: "กระทบการประสานงานและการทรงตัว", group: "ระบบประสาท" },
  { id: "arthritis", label: "ข้อเสื่อมหรือข้ออักเสบที่สะโพก เข่า หรือเท้า", hint: "ความปวดและข้อฝืดอาจทำให้ลุกหรือเดินช้าลง", group: "กระดูกและข้อ" },
  { id: "vestibular", label: "โรคหูชั้นในหรือโรคการทรงตัว", hint: "อาจเวียนศีรษะ เดินโซเซ หรือรู้สึกว่าจะล้ม", group: "การทรงตัว" },
  { id: "heart-failure", label: "ภาวะหัวใจล้มเหลว", hint: "อาจเหนื่อยหรือหอบเมื่อเดินระยะสั้น", group: "หัวใจและปอด" },
  { id: "copd", label: "โรคปอดอุดกั้นเรื้อรัง (COPD)", hint: "อาจหายใจลำบากและเหนื่อยเมื่อออกแรง", group: "หัวใจและปอด" },
];

export const CONDITION_LABEL = new Map(CONDITION_OPTIONS.map((item) => [item.id, item.label]));

/** ชื่อโรคสำหรับแสดงผล — id ที่ไม่รู้จัก (ข้อมูลเก่า) คืนค่าเดิมไปแทนที่จะหายไปเฉย ๆ */
export function conditionLabel(id: string): string {
  return CONDITION_LABEL.get(id) ?? id;
}
