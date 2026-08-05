// ตัวช่วยของหน้าจอสถานะสด (LiveStatusPage)
// อยู่แยกจากไฟล์ component เพราะเป็นฟังก์ชันบริสุทธิ์ ไม่เกี่ยวกับการเรนเดอร์
// (และการ export ฟังก์ชันที่ไม่ใช่ component ออกจากไฟล์ .tsx จะทำให้ Fast Refresh พัง)

/** สถานะของกล่อง Checkpoint เท่าที่ตัวตัดสินใจนี้ต้องใช้ */
export type CheckpointHint = {
  online: boolean;
  light: string;
  chairState: string;
};

// เก้าอี้ "หยุดคุยเน็ต" ตลอดช่วง RETURNING โดยตั้งใจ — การยิงขึ้นคลาวด์บล็อกลูปได้
// หลายร้อย ms ซึ่งตรงกับจังหวะที่มันต้องเฝ้าตรวจว่าผู้ทดสอบนั่งลงเมื่อไร (= จุดหยุดเวลา)
// ผลคือ state=RETURNING ของเก้าอี้จะขึ้นเว็บก็ต่อเมื่อนั่งลงแล้ว ซึ่งสายเกินไปสำหรับจอนี้
//
// แต่กล่อง Checkpoint เป็นคนตรวจเจอเองว่าผู้ทดสอบเดินผ่าน และมันว่างพอจะส่งขึ้นคลาวด์
// ได้ทันที เราจึงเลื่อนขั้นให้จากข้อมูลฝั่งนั้นแทน — เห็นผลภายในราว 1 วินาที
//
// เลื่อนขั้นเฉพาะ RUNNING → RETURNING เท่านั้น และต้องมี heartbeat สดของ Checkpoint
// ประกอบ ค่าเก่าค้างจากรอบก่อนจึงดันสถานะผิดไม่ได้
export function effectiveChairState(chairState: string, checkpoint: CheckpointHint): string {
  const state = chairState.toUpperCase();
  if (state !== "RUNNING" || !checkpoint.online) return state;

  const passed =
    checkpoint.light === "passed" || checkpoint.chairState.toUpperCase() === "RETURNING";
  return passed ? "RETURNING" : state;
}
