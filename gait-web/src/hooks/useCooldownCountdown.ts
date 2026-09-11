// นับถอยหลังช่วงพักหลังจบรอบ (สถานะ COOLDOWN ของเก้าอี้) ก่อนเริ่มรอบถัดไปได้
//
// บอร์ดรายงานเวลาที่เข้าสถานะ (state_since) และความยาวช่วงพัก (cooldown_sec) มาเอง จึงนับได้ตรง
// แม้เปิดหน้านี้กลางช่วงพัก ถ้าเป็นเฟิร์มแวร์รุ่นเก่าที่ยังไม่ส่งสองค่านี้ จะนับจากตอนที่หน้านี้
// เห็นสถานะ "เสร็จสิ้น" ครั้งแรกแทน (อาจช้ากว่าจริงเท่ากับเวลาที่สถานะเดินทางมาถึงเว็บ)
import { useEffect, useState } from "react";

// ตรงกับ COOLDOWN_DURATION ใน ESP_Chair_v2.ino — ใช้เมื่อบอร์ดไม่ได้ส่ง cooldown_sec มา
const FALLBACK_COOLDOWN_SEC = 15;

/** วินาทีที่เหลือ (0 = ครบแล้ว รอบอร์ดเปลี่ยนสถานะ) · null = ไม่ได้อยู่ในช่วงพัก */
export function useCooldownCountdown(active: boolean, stateSince: number, cooldownSec: number): number | null {
  const [clock, setClock] = useState<{ seenAt: number; now: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    const seenAt = Date.now() / 1000;
    const tick = () => setClock({ seenAt, now: Date.now() / 1000 });
    const first = window.setTimeout(tick, 0);
    // 250 ms ให้ตัวเลขเปลี่ยนตรงจังหวะวินาที ไม่กระตุกข้ามเลข
    const id = window.setInterval(tick, 250);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [active]);

  if (!active || !clock) return null;
  const duration = cooldownSec > 0 ? cooldownSec : FALLBACK_COOLDOWN_SEC;
  const start = stateSince > 0 ? stateSince : clock.seenAt;
  // clamp: นาฬิกาบอร์ด (NTP) กับนาฬิกาเครื่องนี้อาจต่างกันไม่กี่วินาที ห้ามแสดงเกินช่วงพักหรือติดลบ
  return Math.min(duration, Math.max(0, Math.ceil(start + duration - clock.now)));
}
