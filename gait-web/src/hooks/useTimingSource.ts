// แหล่งจับเวลาที่เลือกไว้ (กล้อง / ฮาร์ดแวร์) — ใช้ร่วมกันทั้งหน้าหลัก หน้ากล้อง และจอสถานะ
import { useEffect, useState } from "react";
import { DEFAULT_TIMING_SOURCE, ensureAuth, subscribeTimingSource, type TimingSource } from "../lib/firebase";

export interface TimingSourceView {
  source: TimingSource;
  /** false = ยังไม่ได้ค่าจาก Firestore (ใช้ค่าเริ่มต้นไปก่อน) */
  loaded: boolean;
}

export function useTimingSource(): TimingSourceView {
  const [view, setView] = useState<TimingSourceView>({ source: DEFAULT_TIMING_SOURCE, loaded: false });

  useEffect(() => {
    let unsub = () => {};
    let cancelled = false;
    ensureAuth().then((ok) => {
      if (!ok || cancelled) return;
      unsub = subscribeTimingSource(
        (source) => setView({ source, loaded: true }),
        (err) => console.error("[TimingSource]", err.message),
      );
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return view;
}
