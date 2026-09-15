// Display metadata + formatters ported from web_dashboard/app.js.

export const riskMeta = {
  LOW: { th: "ต่ำ", cls: "low", emoji: "✅" },
  MODERATE: { th: "ปานกลาง", cls: "mod", emoji: "⚠️" },
  HIGH: { th: "สูง", cls: "high", emoji: "❌" },
} as const;

export type RiskLevel = keyof typeof riskMeta;

export function riskThai(level: string): string {
  return riskMeta[level as RiskLevel]?.th ?? level;
}
export function riskClass(level: string): string {
  return riskMeta[level as RiskLevel]?.cls ?? "low";
}

export const diseaseMeta: Record<string, { th: string; cls: string }> = {
  Normal: { th: "ปกติ", cls: "low" },
  Parkinsonian: { th: "เสี่ยงพาร์กินสัน", cls: "mod" },
  Hemiplegic: { th: "เสี่ยงอัมพาตครึ่งซีก", cls: "high" },
  Steppage: { th: "เสี่ยงภาวะเท้าตก", cls: "mod" },
  // ค่าที่ไม่ใช่ "ป้ายท่าเดิน": No Data = รอบที่กล้องไม่ได้เฟรมที่ประเมินได้เลย
  // (recorder.result() เมื่อ totalFrames = 0), Unknown = เอกสารเก่าที่ไม่มีฟิลด์
  // condition ทั้งสองต้องเป็นสีกลาง ไม่ใช่สีระดับความเสี่ยง ไม่งั้นตารางจะอ่าน
  // เหมือนว่าตรวจแล้วพบอะไรบางอย่าง
  "No Data": { th: "ไม่มีข้อมูล", cls: "none" },
  Unknown: { th: "ไม่ทราบผล", cls: "none" },
};

export function getDiseaseMeta(condition: string) {
  return diseaseMeta[condition] ?? { th: condition || "ไม่ระบุ", cls: "none" };
}

// Time formatting lives in lib/time.ts (formatThai / formatIsoThai) so there is
// one path that pins the display zone to Asia/Bangkok. The old formatter here
// was never wired up and used the browser's local zone, which would silently
// disagree with the ESP timestamps on any non-Thai machine.
