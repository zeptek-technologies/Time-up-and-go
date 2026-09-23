// รวม "เวลาจากกล้อง" (tug_results/cam_*) เข้ากับ "ผลของเก้าอี้" ในรอบเดียวกัน ให้เหลือรอบละหนึ่งแถว
//
// ทำฝั่งเว็บแทนการให้กล้องไปเขียนทับเอกสารของเก้าอี้ เพราะเก้าอี้อาจส่งผลมาทีหลัง
// (เน็ตหลุดแล้วส่งจากบัฟเฟอร์) — ถ้าเขียนทับ/สร้างแถวใหม่ตอนนั้นจะเกิดแถวซ้ำ
// จับคู่ที่นี่จึงถูกเสมอไม่ว่าผลไหนมาถึงก่อน
//
// กล้องเป็นแหล่งหลัก: ถ้าจับคู่ได้ ใช้เวลาของกล้องเป็นเวลารวม และเก็บเวลาเก้าอี้ไว้เทียบ
// ถ้ากล้องไม่ได้จับรอบนั้น ใช้เวลาเก้าอี้ตามเดิม (สำรอง)
import type { TugResult } from "./firebase";

/** จับคู่เฉพาะผลที่จบห่างกันไม่เกินเท่านี้ — กันเลขรอบซ้ำข้ามวัน (เก้าอี้รีบูตแล้วนับรอบใหม่) */
export const PAIR_WINDOW_SEC = 90;

export function mergeCameraTimings(chairRows: TugResult[], cameraRows: TugResult[]): TugResult[] {
  const merged = chairRows.map((r) => ({ ...r }));
  const paired = new Set<string>();
  const cameraOnly: TugResult[] = [];

  for (const cam of cameraRows) {
    const match = merged.find(
      (r) =>
        !paired.has(r.id) &&
        cam.trialNo > 0 &&
        r.trialNo === cam.trialNo &&
        r.sessionId === cam.sessionId &&
        r.finishedAt > 0 &&
        cam.finishedAt > 0 &&
        Math.abs(r.finishedAt - cam.finishedAt) <= PAIR_WINDOW_SEC,
    );
    if (!match) {
      cameraOnly.push(cam);
      continue;
    }
    paired.add(match.id);
    match.chairTotalSec = match.totalSec;
    match.cameraTotalSec = cam.totalSec;
    match.totalSec = cam.totalSec;
    match.timingSource = "camera";
    // กล้องเห็นครบรอบ แม้เก้าอี้จะยกเลิก (เช่น จุดหมุนตัวพลาดสัญญาณจนหมดเวลา) รอบนี้ก็ใช้ได้
    match.status = "completed";
    // ขาไป: ใช้ของเก้าอี้+จุดหมุนตัวก่อน (นาฬิกาเดียวกันทั้งรอบ) ถ้าเก้าอี้ไม่ได้วัด ใช้ที่กล้องคิดจาก
    // เวลาที่ checkpoint เห็นคนผ่าน · ขากลับคิดจากเวลารวมของกล้อง ให้ไป+กลับ = รวมเสมอ
    if (!(match.checkpointSec > 0) && cam.checkpointSec > 0) match.checkpointSec = cam.checkpointSec;
    if (match.checkpointSec > 0) match.returnSec = Math.max(0, cam.totalSec - match.checkpointSec);
  }

  return [...merged, ...cameraOnly];
}
