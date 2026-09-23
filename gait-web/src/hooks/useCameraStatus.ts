// สถานะตัวจับเวลาจากกล้อง (device_status/camera) สำหรับจอสถานะการทดสอบ ซึ่งมักเปิดคนละเครื่อง
//
// ความสด/เวลาที่ผ่านไปคิดจาก "นาฬิกาของเครื่องนี้ตอนได้รับข้อมูล" ไม่ใช่เวลาที่อีกเครื่องเขียนมา
// เพราะนาฬิกาสองเครื่องอาจต่างกันหลายวินาที หน้ากล้องส่งสถานะทุก 1 วินาทีขณะจับเวลา
// และทุก 10 วินาทีตอนว่าง (ดู PUBLISH_*_MS ใน CameraPage.tsx)
import { useEffect, useState } from "react";
import { ensureAuth, subscribeCameraStatus, type CameraPhase, type CameraStatus } from "../lib/firebase";

/** ไม่ได้รับข้อมูลใหม่นานเกินนี้ = หน้ากล้องปิดไปแล้ว (ยาวกว่ารอบส่งตอนว่าง 10 วิ) */
const STALE_MS = 20000;
/** หน้ากล้องที่ถูกซ่อนนานเกิน 5 นาที เบราว์เซอร์จะให้ส่งได้แค่นาทีละครั้ง */
const STALE_HIDDEN_MS = 90000;

export interface CameraStatusView extends CameraStatus {
  fresh: boolean;
  /** เวลาที่ผ่านไปของรอบที่กำลังจับ ประมาณต่อเนื่องระหว่างรอข้อมูลรอบถัดไป */
  liveElapsedMs: number;
  /** เวลาพักที่เหลือก่อนรอบถัดไป ลดลงต่อเนื่องระหว่างรอข้อมูลรอบถัดไป */
  liveCooldownLeftMs: number;
}

const EMPTY: CameraStatus = {
  exists: false,
  phase: "off",
  elapsedMs: 0,
  lastDurationMs: 0,
  cooldownLeftMs: 0,
  clientId: "",
  clientMs: 0,
};

// เปิดกล้องได้มากกว่าหนึ่งหน้า (หลายแท็บ/หลายเครื่อง) ทุกหน้าเขียนเอกสารเดียวกันสลับกันไป
// จึงแยกเก็บค่าล่าสุดของแต่ละหน้า แล้วเลือกหน้าที่ "ใช้งานได้จริง" ที่สุด — ไม่งั้นจอสถานะจะสลับตามคนเขียนล่าสุด
const PHASE_RANK: Record<CameraPhase, number> = {
  running: 6,
  cooldown: 5,
  ready: 4,
  waiting: 3,
  no_side: 2,
  hidden: 1,
  off: 0,
};

type Entry = { status: CameraStatus; receivedAt: number };

const staleFor = (phase: CameraPhase) => (phase === "hidden" ? STALE_HIDDEN_MS : STALE_MS);

export function useCameraStatus(): CameraStatusView {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    let unsub = () => {};
    let cancelled = false;
    ensureAuth().then((ok) => {
      if (!ok || cancelled) return;
      unsub = subscribeCameraStatus(
        (status) =>
          setEntries((prev) => {
            const at = performance.now();
            // ทิ้งหน้าที่เงียบไปนานแล้ว ไม่ให้ค้างสะสม
            const next: Record<string, Entry> = {};
            for (const [id, e] of Object.entries(prev)) if (at - e.receivedAt < STALE_HIDDEN_MS) next[id] = e;
            // หน้ารุ่นเก่า (ยังไม่ได้รีโหลด) ไม่เขียน client_id/client_ms — เอกสารจึงยังมีค่าของหน้าก่อนหน้าค้างอยู่
            // client_ms ซ้ำกับที่เคยเห็น = ไม่ใช่หน้านั้นเขียน แยกไว้เป็น "legacy" ไม่ให้ทับหน้าตัวจริง
            const seen = prev[status.clientId];
            const legacy = !status.clientId || (seen !== undefined && seen.status.clientMs === status.clientMs);
            next[legacy ? "legacy" : status.clientId] = { status, receivedAt: at };
            return next;
          }),
        (err) => console.error("[CameraStatus]", err.message),
      );
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 200);
    return () => window.clearInterval(id);
  }, []);

  let best: Entry | null = null;
  for (const e of Object.values(entries)) {
    const { status } = e;
    const fresh = status.exists && status.phase !== "off" && now - e.receivedAt < staleFor(status.phase);
    if (!fresh) continue;
    if (
      !best ||
      PHASE_RANK[status.phase] > PHASE_RANK[best.status.phase] ||
      (PHASE_RANK[status.phase] === PHASE_RANK[best.status.phase] && e.receivedAt > best.receivedAt)
    ) {
      best = e;
    }
  }

  if (!best) return { ...EMPTY, fresh: false, liveElapsedMs: 0, liveCooldownLeftMs: 0 };
  const { status, receivedAt } = best;
  const age = Math.max(0, now - receivedAt);
  const liveElapsedMs = status.phase === "running" ? status.elapsedMs + age : 0;
  const liveCooldownLeftMs = status.phase === "cooldown" ? Math.max(0, status.cooldownLeftMs - age) : 0;
  return { ...status, fresh: true, liveElapsedMs, liveCooldownLeftMs };
}
