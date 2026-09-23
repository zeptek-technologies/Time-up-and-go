// สถานะตัวจับเวลาจากกล้อง (device_status/camera) สำหรับจอสถานะการทดสอบ ซึ่งมักเปิดคนละเครื่อง
//
// ความสด/เวลาที่ผ่านไปคิดจาก "นาฬิกาของเครื่องนี้ตอนได้รับข้อมูล" ไม่ใช่เวลาที่อีกเครื่องเขียนมา
// เพราะนาฬิกาสองเครื่องอาจต่างกันหลายวินาที หน้ากล้องส่งสถานะทุก 1 วินาทีขณะจับเวลา
// และทุก 10 วินาทีตอนว่าง (ดู PUBLISH_*_MS ใน CameraPage.tsx)
import { useEffect, useState } from "react";
import { ensureAuth, subscribeCameraStatus, type CameraStatus } from "../lib/firebase";

/** ไม่ได้รับข้อมูลใหม่นานเกินนี้ = หน้ากล้องปิดไปแล้ว (ยาวกว่ารอบส่งตอนว่าง 10 วิ) */
const STALE_MS = 20000;

export interface CameraStatusView extends CameraStatus {
  fresh: boolean;
  /** เวลาที่ผ่านไปของรอบที่กำลังจับ ประมาณต่อเนื่องระหว่างรอข้อมูลรอบถัดไป */
  liveElapsedMs: number;
  /** เวลาพักที่เหลือก่อนรอบถัดไป ลดลงต่อเนื่องระหว่างรอข้อมูลรอบถัดไป */
  liveCooldownLeftMs: number;
}

const EMPTY: CameraStatus = { exists: false, phase: "off", elapsedMs: 0, lastDurationMs: 0, cooldownLeftMs: 0 };

export function useCameraStatus(): CameraStatusView {
  const [latest, setLatest] = useState<{ status: CameraStatus; receivedAt: number }>({ status: EMPTY, receivedAt: 0 });
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    let unsub = () => {};
    let cancelled = false;
    ensureAuth().then((ok) => {
      if (!ok || cancelled) return;
      unsub = subscribeCameraStatus(
        (status) => setLatest({ status, receivedAt: performance.now() }),
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

  const { status, receivedAt } = latest;
  const age = receivedAt ? Math.max(0, now - receivedAt) : Infinity;
  const fresh = status.exists && status.phase !== "off" && age < STALE_MS;
  const liveElapsedMs = fresh && status.phase === "running" ? status.elapsedMs + age : 0;
  const liveCooldownLeftMs = fresh && status.phase === "cooldown" ? Math.max(0, status.cooldownLeftMs - age) : 0;
  return { ...status, fresh, liveElapsedMs, liveCooldownLeftMs };
}
