// Issues + tracks a remote reset command for the ESP32 chair. Mirrors
// useDeviceStatus.ts's shape but for the write-side (device_commands/chair).
import { useCallback, useEffect, useState } from "react";
import { ensureAuth, requestReset as requestResetDoc, subscribeDeviceCommand } from "../lib/firebase";

// An un-acked request older than this is treated as dead (board was powered off
// or lost WiFi before it could poll). Without this the doc keeps a permanently
// pending request and the button would sit disabled on "กำลังส่งคำสั่ง…" forever
// — including on every future page load, since the doc outlives the session.
//
// requestedAt is written by the WEB and echoed back verbatim by the ESP, so both
// sides of this comparison come from the browser's clock — no NTP skew involved.
const REQUEST_TTL_SEC = 60;

export interface DeviceResetView {
  pending: boolean;
  requestReset: () => Promise<void>;
}

export function useDeviceReset(): DeviceResetView {
  const [requestedAt, setRequestedAt] = useState(0);
  const [handledAt, setHandledAt] = useState(0);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let unsub = () => {};
    let cancelled = false;
    ensureAuth().then((ok) => {
      if (ok && !cancelled) {
        // ต้องมี error handler เสมอ (เหตุผลเดียวกับ useDeviceStatus): ถ้า Firestore
        // ปฏิเสธ เช่น permission-denied ปุ่มจะค้างสถานะเดิมโดยไม่มีเบาะแสใน console
        unsub = subscribeDeviceCommand(
          (c) => {
            setRequestedAt(c.requestedAt);
            setHandledAt(c.handledAt);
          },
          (err) => console.error("[DeviceCommand]", err.message),
        );
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Re-evaluate the TTL so a dead request stops showing as pending on its own.
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 3000);
    return () => clearInterval(id);
  }, []);

  const requestReset = useCallback(async () => {
    await requestResetDoc();
  }, []);

  const pending = requestedAt > 0 && handledAt < requestedAt && nowSec - requestedAt < REQUEST_TTL_SEC;
  return { pending, requestReset };
}
