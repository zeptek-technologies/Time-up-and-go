export type SectionKey = "overview" | "patients" | "camera" | "records" | "disease" | "guide" | "devices";

// Page + nav order. Camera sits right after Patients per the workflow:
// manage/select the patient, then run the gait test.
export const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "overview", label: "ภาพรวม" },
  { key: "patients", label: "ผู้ทดสอบ" },
  { key: "camera", label: "กล้องทดสอบ" },
  { key: "records", label: "ผลการทดสอบ" },
  { key: "disease", label: "เสี่ยงโรค" },
  { key: "guide", label: "วิธีอ่านผล" },
  // ใช้ไม่บ่อย (ตั้งครั้งเดียวตอนติดตั้งอุปกรณ์) จึงอยู่ท้ายสุด
  { key: "devices", label: "ตั้งค่าอุปกรณ์" },
];

