// ตัวจับเวลา TUG จากกล้อง: เริ่มเมื่อผู้ทดสอบลุกจากเก้าอี้ หยุดเมื่อกลับมานั่ง
// รับท่าทางทีละเฟรม (postureDetector) แล้วคืนเหตุการณ์เมื่อขั้นตอนเปลี่ยน — ไม่แตะ UI/เน็ต
//
// หลักสำคัญ: เวลาเริ่มและเวลาจบ "ย้อนกลับไปหาจังหวะจริง" จากประวัติท่าทางที่เก็บไว้
// ไม่ใช่จังหวะที่ระบบยืนยันเสร็จ (ซึ่งช้ากว่าจริงหลายร้อย ms) จึงแม่นประมาณ 1 เฟรม
//
//   รอผู้ทดสอบ ─ นั่งนิ่ง 1 วิ ─▶ นั่งพร้อม ─ สะโพกยกชัด ─▶ จับเวลา ─ นั่งนิ่ง 0.5 วิ ─▶ พัก ─▶ รอผู้ทดสอบ
//                                  ▲                        │
//                                  └──── ขยับตัว (นั่งกลับเร็ว) ─┘
import type { PostureSample } from "./postureDetector";
import { median } from "./mathUtils";

export type TimerPhase = "waiting" | "ready" | "running" | "cooldown";

export const TIMER_CONFIG = {
  /** นั่งต่อเนื่องเท่านี้ก่อนนับว่า "นั่งพร้อม" */
  readySitMs: 1000,
  /** ตอนนั่งพร้อม ถ้ามองไม่เห็นคนนานเท่านี้ ถือว่าออกไปแล้ว กลับไปรอ */
  lostResetMs: 1500,
  /** สะโพกยกเหนือระดับตอนนั่งเท่านี้ (เท่าของต้นขา) = ลุกจริง */
  riseConfirmLift: 0.35,
  /** สะโพกยกเหนือระดับตอนนั่งเกินเท่านี้ = พ้นเก้าอี้แล้ว (ใช้หาเวลาเริ่ม/จบย้อนหลัง) */
  onsetMargin: 0.08,
  /** ต้องเห็นท่ายืนต่อเนื่องเท่านี้จึงนับว่า "ยืนแล้ว" */
  standConfirmMs: 300,
  /**
   * นั่งกลับภายในเวลานี้โดยไม่เคยยืน = แค่ขยับตัว ยกเลิกรอบ
   * หลังจากนี้นั่งลง = จบรอบ แม้ไม่เคยเห็นท่ายืนตรง (ผู้สูงอายุหลายคนยืนหลังงอ)
   * TUG จริงไม่มีทางเสร็จภายใน 2.5 วินาที
   */
  falseStartMs: 2500,
  /** นั่งต่อเนื่องเท่านี้จึงนับว่านั่งลงจบรอบ */
  finishSitMs: 500,
  /** สั้นกว่านี้ = ผลผิดปกติ ไม่บันทึก (เดิน 3 เมตรไป-กลับเร็วกว่านี้ไม่ได้) */
  minValidMs: 4000,
  /** เกินนี้ยกเลิกรอบ (เท่ากับเพดานของอุปกรณ์เก้าอี้) */
  maxRunMs: 120000,
  /** พักหลังจบรอบ กันการเริ่มรอบใหม่จากการขยับตัวตอนนั่งลง */
  cooldownMs: 3000,
  /** เก็บประวัติท่าทางย้อนหลังเท่านี้ ไว้หาจังหวะเริ่มลุก */
  historyMs: 3000,
} as const;

export type TimerEvent =
  | { type: "ready" }
  | { type: "start"; startMs: number; detectedMs: number }
  | { type: "cancel"; reason: string }
  | { type: "finish"; startMs: number; endMs: number; durationMs: number }
  | { type: "reject"; durationMs: number; reason: string }
  | { type: "abort"; reason: string }
  | { type: "lost" };

export class CameraTugTimer {
  phase: TimerPhase = "waiting";
  /** เวลาเริ่มของรอบที่กำลังจับอยู่ (ฐานเดียวกับ tMs ของเฟรม) */
  startMs = 0;

  private readonly cfg: typeof TIMER_CONFIG;
  private history: PostureSample[] = [];
  private sitRunStart = -1; // เฟรมแรกของช่วง "นั่ง" ต่อเนื่องปัจจุบัน
  private settledRunStart = -1; // เฟรมแรกของช่วง "นั่งจมเก้าอี้" ต่อเนื่อง (ใช้หาเวลาจบ)
  private standRunStart = -1;
  private standingSeen = false;
  private baselineLift = NaN; // ความสูงสะโพกตอนนั่ง ของคนนี้บนเก้าอี้ตัวนี้
  private lastSeenMs = -Infinity;
  private cooldownUntil = 0;
  private cooldownMs: number;

  constructor(config: Partial<typeof TIMER_CONFIG> = {}) {
    this.cfg = { ...TIMER_CONFIG, ...config };
    this.cooldownMs = this.cfg.cooldownMs;
  }

  /**
   * ความยาวช่วงพักหลังจบรอบ — หน้ากล้องตั้งให้เท่ากับของเก้าอี้ (15 วิ) เพื่อให้เก้าอี้ที่เป็นตัวสำรอง
   * พร้อมรอบถัดไปพร้อมกัน และจอสถานะโชว์ผลนานเท่ากันทั้งสองโหมด (มีผลกับรอบถัดไป)
   */
  setCooldownMs(ms: number) {
    if (Number.isFinite(ms) && ms >= 0) this.cooldownMs = ms;
  }

  /** เวลาพักที่เหลือ ณ nowMs (0 ถ้าไม่ได้อยู่ในช่วงพัก) */
  cooldownLeftMs(nowMs: number): number {
    return this.phase === "cooldown" ? Math.max(0, this.cooldownUntil - nowMs) : 0;
  }

  /** เวลาที่ผ่านไปของรอบปัจจุบัน ณ เวลา nowMs (0 ถ้าไม่ได้จับเวลาอยู่) */
  elapsedMs(nowMs: number): number {
    return this.phase === "running" ? Math.max(0, nowMs - this.startMs) : 0;
  }

  reset() {
    this.phase = "waiting";
    this.startMs = 0;
    this.history = [];
    this.sitRunStart = this.settledRunStart = this.standRunStart = -1;
    this.standingSeen = false;
    this.baselineLift = NaN;
    this.lastSeenMs = -Infinity;
    this.cooldownUntil = 0;
  }

  push(s: PostureSample): TimerEvent | null {
    const c = this.cfg;
    const prevSeen = this.lastSeenMs;
    this.history.push(s);
    while (this.history.length && this.history[0].tMs < s.tMs - c.historyMs) this.history.shift();
    if (s.posture !== "none") this.lastSeenMs = s.tMs;

    const sitting = s.posture === "sitting";
    if (sitting) {
      if (this.sitRunStart < 0) this.sitRunStart = s.tMs;
    } else this.sitRunStart = -1;

    switch (this.phase) {
      case "cooldown":
        if (s.tMs < this.cooldownUntil) return null;
        this.phase = "waiting";
        return this.checkReady(s);

      case "waiting":
        return this.checkReady(s);

      case "ready": {
        if (s.posture === "none") {
          if (s.tMs - prevSeen > c.lostResetMs) {
            this.phase = "waiting";
            return { type: "lost" };
          }
          return null;
        }
        if (sitting) this.baselineLift = this.seatedBaseline(s.tMs - 1500) ?? this.baselineLift;

        const liftedClearly =
          Number.isFinite(s.hipLift) && Number.isFinite(this.baselineLift) && s.hipLift >= this.baselineLift + c.riseConfirmLift;
        if (!liftedClearly && s.posture !== "standing") return null;

        this.startMs = this.riseOnset(s.tMs);
        this.phase = "running";
        this.standingSeen = false;
        this.standRunStart = this.settledRunStart = -1;
        return { type: "start", startMs: this.startMs, detectedMs: s.tMs };
      }

      case "running": {
        const elapsed = s.tMs - this.startMs;
        if (elapsed > c.maxRunMs) {
          this.enterCooldown(s.tMs);
          return { type: "abort", reason: "เกินเวลา 120 วินาที" };
        }

        if (s.posture === "standing") {
          if (this.standRunStart < 0) this.standRunStart = s.tMs;
          if (s.tMs - this.standRunStart >= c.standConfirmMs) this.standingSeen = true;
        } else this.standRunStart = -1;

        // "นั่งจมเก้าอี้" = ท่านั่ง และสะโพกกลับลงมาใกล้ระดับตอนนั่งพร้อม
        const settled =
          sitting &&
          (!Number.isFinite(s.hipLift) ||
            !Number.isFinite(this.baselineLift) ||
            s.hipLift <= this.baselineLift + c.riseConfirmLift / 2);
        if (settled) {
          if (this.settledRunStart < 0) this.settledRunStart = s.tMs;
        } else {
          this.settledRunStart = -1;
          return null;
        }
        if (s.tMs - this.settledRunStart < c.finishSitMs) return null;

        if (!this.standingSeen && elapsed < c.falseStartMs) {
          this.phase = "ready";
          return { type: "cancel", reason: "ขยับตัวแต่ไม่ได้ลุกเดิน" };
        }

        const endMs = this.settledRunStart;
        const durationMs = endMs - this.startMs;
        const startMs = this.startMs;
        this.enterCooldown(s.tMs);
        if (durationMs < c.minValidMs) {
          return { type: "reject", durationMs, reason: `สั้นผิดปกติ (${(durationMs / 1000).toFixed(2)} วินาที)` };
        }
        return { type: "finish", startMs, endMs, durationMs };
      }
    }
  }

  private checkReady(s: PostureSample): TimerEvent | null {
    if (this.sitRunStart < 0 || s.tMs - this.sitRunStart < this.cfg.readySitMs) return null;
    const base = this.seatedBaseline(this.sitRunStart);
    if (base === null) return null;
    this.baselineLift = base;
    this.phase = "ready";
    return { type: "ready" };
  }

  /** ค่ากลางของความสูงสะโพกตอนนั่ง ตั้งแต่ fromMs (null = ไม่มีข้อมูล) */
  private seatedBaseline(fromMs: number): number | null {
    const lifts = this.history
      .filter((h) => h.tMs >= fromMs && h.posture === "sitting" && Number.isFinite(h.hipLift))
      .map((h) => h.hipLift);
    if (lifts.length) return median(lifts);
    // มองไม่เห็นต้นขาชัดพอจะวัดความสูง — ใช้ท่า (มุม) อย่างเดียว เวลาเริ่มจะหยาบลงเล็กน้อย
    return this.history.some((h) => h.tMs >= fromMs && h.posture === "sitting") ? NaN : null;
  }

  /**
   * จังหวะเริ่มลุกจริง: ไล่ประวัติย้อนหลังจากเฟรมที่ยืนยัน หาเฟรมสุดท้ายที่สะโพกยังอยู่ระดับนั่ง
   * แล้วคืนเวลาของเฟรมถัดไป (เฟรมแรกที่สะโพกพ้นเก้าอี้)
   */
  private riseOnset(detectedMs: number): number {
    const limit = this.baselineLift + this.cfg.onsetMargin;
    const h = this.history;
    for (let i = h.length - 1; i >= 0; i--) {
      const smp = h[i];
      const stillSeated = Number.isFinite(smp.hipLift) ? smp.hipLift <= limit : smp.posture === "sitting";
      if (stillSeated && smp.posture !== "none") return i + 1 < h.length ? h[i + 1].tMs : detectedMs;
    }
    return h.length ? h[0].tMs : detectedMs;
  }

  private enterCooldown(nowMs: number) {
    this.phase = "cooldown";
    this.cooldownUntil = nowMs + this.cooldownMs;
    this.standingSeen = false;
    this.settledRunStart = this.standRunStart = -1;
  }
}
