export type SectionKey = "overview" | "patients" | "camera" | "records" | "disease" | "guide";

// Page + nav order. Camera sits right after Patients per the workflow:
// manage/select the patient, then run the gait test.
export const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "overview", label: "ภาพรวม" },
  { key: "patients", label: "ผู้ทดสอบ" },
  { key: "camera", label: "กล้องทดสอบ" },
  { key: "records", label: "ผลการทดสอบ" },
  { key: "disease", label: "เสี่ยงโรค" },
  { key: "guide", label: "วิธีอ่านผล" },
];

