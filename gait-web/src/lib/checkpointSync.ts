// ขาไป/ขากลับในโหมดกล้อง: เวลาเริ่มมาจากกล้อง (นาฬิกาเครื่องนี้) ส่วนเวลาที่คนเดินผ่านจุดหมุนตัว
// มาจากบอร์ด checkpoint (นาฬิกา NTP ของบอร์ด ส่งมาเป็น pass_at_ms) — สองนาฬิกาต้องเทียบกันก่อน
//
// นาฬิกาคอมอาจเพี้ยนได้หลายวินาที (Windows sync แค่สัปดาห์ละครั้ง) จึงเทียบนาฬิกาเครื่องนี้กับ
// เวลาของเซิร์ฟเวอร์ Firestore ทุกครั้งที่หน้ากล้องส่งสถานะ (serverTimestamp) ส่วนบอร์ดใช้ NTP
// ที่ตรงกับเวลามาตรฐานอยู่แล้ว ความคลาดรวมจึงเหลือราวครึ่งหนึ่งของเวลาไป-กลับของเน็ต (~0.1 วิ)

export interface ClockSample {
  /** Date.now() ตอนสั่งเขียน */
  sentMs: number;
  /** เวลาที่เซิร์ฟเวอร์ประทับให้ (serverTimestamp) */
  serverMs: number;
  /** Date.now() ตอนได้รับยืนยันจากเซิร์ฟเวอร์ */
  recvMs: number;
}

/** เก็บตัวอย่างล่าสุดเท่านี้ แล้วเลือกตัวที่เน็ตเร็วที่สุด (คลาดน้อยที่สุด) */
const KEEP_SAMPLES = 8;
/** ไป-กลับนานกว่านี้ ค่าที่ได้คลาดเกินใช้ */
const MAX_RTT_MS = 3000;

export class ClockOffset {
  private samples: Array<{ offsetMs: number; rttMs: number }> = [];

  add(s: ClockSample): void {
    const rttMs = s.recvMs - s.sentMs;
    if (!(rttMs >= 0 && rttMs <= MAX_RTT_MS) || !Number.isFinite(s.serverMs)) return;
    // เซิร์ฟเวอร์ประทับเวลาระหว่างสั่งเขียนกับได้รับยืนยัน — เดาว่ากึ่งกลาง คลาดไม่เกิน rtt/2
    this.samples.push({ offsetMs: s.serverMs - (s.sentMs + s.recvMs) / 2, rttMs });
    if (this.samples.length > KEEP_SAMPLES) this.samples.shift();
  }

  /** เวลาเซิร์ฟเวอร์ - เวลาเครื่องนี้ (ms) · null = ยังไม่มีตัวอย่าง */
  get offsetMs(): number | null {
    if (!this.samples.length) return null;
    return this.samples.reduce((best, s) => (s.rttMs < best.rttMs ? s : best)).offsetMs;
  }

  /** ความคลาดสูงสุดโดยประมาณ (ms) */
  get uncertaintyMs(): number | null {
    if (!this.samples.length) return null;
    return Math.min(...this.samples.map((s) => s.rttMs)) / 2;
  }
}

export const PASS_RULES = {
  /** เห็นคนผ่านเร็วกว่านี้หลังเริ่ม = ไม่ใช่ผู้ทดสอบ (เดิน 3 เมตรไม่ทันแน่) */
  minAfterStartMs: 1000,
  /** เห็นคนผ่านช้ากว่านี้ก่อนจบ = ไม่ใช่ขาไป (ต้องเดินกลับอีก 3 เมตร) */
  minBeforeEndMs: 1000,
} as const;

/**
 * ขาไป (วินาที) จากเวลาที่ checkpoint เห็นคนเดินผ่าน — เลือกครั้งแรกที่อยู่ในรอบนี้
 * ทุกค่าเป็นเวลาฐานเดียวกัน (เวลามาตรฐาน epoch ms) · null = ไม่มีครั้งไหนเข้าเกณฑ์
 */
export function pickCheckpointSplit(passAtMs: number[], startMs: number, endMs: number): number | null {
  const lo = startMs + PASS_RULES.minAfterStartMs;
  const hi = endMs - PASS_RULES.minBeforeEndMs;
  let best: number | null = null;
  for (const p of passAtMs) {
    if (p >= lo && p <= hi && (best === null || p < best)) best = p;
  }
  return best === null ? null : (best - startMs) / 1000;
}
