// อ่าน "สิ่งที่กล้องเห็น" เทียบกับ "โรคประจำตัวที่บันทึกไว้"
//
// ตั้งใจไม่ยุบเป็นคะแนนเดียว: การเอาประวัติโรคมาบวกเป็นระดับความเสี่ยงตัวเดียว
// คือการตัดสินทางคลินิก ซึ่งเกินขอบเขตของเครื่องมือคัดกรอง ที่ทำได้และมีประโยชน์จริง
// คือวางข้อมูลสองแหล่งไว้ข้างกัน แล้วบอกว่ามัน "สอดคล้องกันไหม" ให้เจ้าหน้าที่ตัดสินเอง
import type { GaitLabel } from "./classifier";

/** โรคที่อธิบายท่าเดินผิดปกติแต่ละแบบได้ (id ตรงกับ CONDITION_OPTIONS ในหน้าจัดการผู้ทดสอบ) */
const EXPLAINS: Record<Exclude<GaitLabel, "Normal">, string[]> = {
  // ก้าวสั้น แกว่งแขนน้อย ตัวโน้มไปหน้า
  Parkinsonian: ["parkinsons"],
  // อ่อนแรงครึ่งซีก - ขาสองข้างทำงานไม่เท่ากัน แขนข้างหนึ่งงอแนบตัว
  Hemiplegic: ["stroke"],
  // เท้าตก ต้องยกเข่าสูงเพื่อให้ปลายเท้าพ้นพื้น
  Steppage: ["peripheral-neuropathy", "multiple-sclerosis"],
};

/** โรคที่กระทบการเดิน/การทรงตัวโดยรวม ใช้เตือนเมื่อกล้องไม่เห็นอะไรผิดปกติในรอบนั้น */
const GAIT_RELEVANT = new Set([
  "parkinsons", "stroke", "multiple-sclerosis", "peripheral-neuropathy",
  "ataxia", "arthritis", "vestibular",
]);

export type ConsistencyKey = "match" | "unexplained" | "history-only" | "clear" | "no-camera";

export interface Consistency {
  key: ConsistencyKey;
  headline: string;
  detail: string;
  /** โรคที่บันทึกไว้ซึ่งอธิบายสิ่งที่กล้องเห็นได้ */
  matched: string[];
}

/**
 * @param cameraLabel  ป้ายที่กล้องสรุปทั้งรอบ ("Normal" = ไม่พบความผิดปกติ)
 * @param flagged      กล้องยืนยันความผิดปกติจริงหรือไม่ (ผ่าน RISK_MIN_SHARE แล้ว)
 * @param conditions   id โรคประจำตัวของผู้ทดสอบ
 */
export function assessConsistency(
  cameraLabel: GaitLabel | null,
  flagged: boolean,
  conditions: string[],
): Consistency {
  const relevant = conditions.filter((id) => GAIT_RELEVANT.has(id));

  if (cameraLabel === null) {
    return {
      key: "no-camera",
      headline: "รอบนี้ไม่มีผลจากกล้อง",
      detail: relevant.length
        ? "มีโรคประจำตัวที่กระทบการเดินบันทึกไว้ - ควรวิเคราะห์ท่าเดินในรอบถัดไป"
        : "ใช้เวลาที่ทำได้เป็นเกณฑ์หลักสำหรับรอบนี้",
      matched: [],
    };
  }

  if (flagged && cameraLabel !== "Normal") {
    const matched = conditions.filter((id) => EXPLAINS[cameraLabel].includes(id));
    if (matched.length > 0) {
      return {
        key: "match",
        headline: "สอดคล้องกับโรคประจำตัวที่บันทึกไว้",
        detail: "ท่าเดินที่กล้องเห็นตรงกับประวัติ - ใช้ติดตามความเปลี่ยนแปลงของอาการได้",
        matched,
      };
    }
    return {
      key: "unexplained",
      headline: "ไม่พบสาเหตุนี้ในประวัติ",
      detail: "กล้องเห็นท่าเดินผิดปกติที่โรคประจำตัวเท่าที่บันทึกไว้อธิบายไม่ได้ ควรส่งตรวจเพิ่มเติม",
      matched: [],
    };
  }

  if (relevant.length > 0) {
    return {
      key: "history-only",
      headline: "รอบนี้กล้องไม่พบความผิดปกติ",
      detail: "แต่ประวัติมีโรคที่กระทบการเดิน ควรติดตามต่อเนื่องแม้ผลรอบนี้จะปกติ",
      matched: relevant,
    };
  }

  return {
    key: "clear",
    headline: "ไม่พบความผิดปกติในรอบนี้",
    detail: "ทั้งท่าเดินที่กล้องวิเคราะห์และประวัติที่บันทึกไว้ไม่มีสัญญาณที่ต้องตามต่อ",
    matched: [],
  };
}
