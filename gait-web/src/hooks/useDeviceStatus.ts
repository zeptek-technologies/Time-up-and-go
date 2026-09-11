// Live ESP32 board presence. Each board writes a `last_seen` epoch every ~15s;
// we treat it as OFFLINE once that timestamp is older than STALE_SEC. A local
// timer re-evaluates freshness so it flips to offline even when NO new snapshot
// arrives (i.e. exactly when the device has gone away).
import { useEffect, useState } from "react";
import { EMPTY_DEVICE, ensureAuth, subscribeDeviceStatus, type DeviceId, type DeviceStatus } from "../lib/firebase";

// 3x the 15s heartbeat: tolerates one or two dropped beats on flaky WiFi so
// staff don't see a scary OFFLINE for a board that's actually fine.
const STALE_SEC = 45;

// `last_seen` can legitimately read as slightly in the FUTURE, which used to
// flip the chip to a contradictory "ออฟไลน์ · 0 วินาทีที่แล้ว". Two causes:
//   1. nowSec below only refreshes every 5s, while a heartbeat lands the
//      instant onSnapshot fires — so "now" can be up to 5s behind last_seen.
//   2. the board's clock is NTP-accurate while the PC's may lag a few seconds.
// Either way a small negative age means "just arrived", not "offline".
const CLOCK_SKEW_TOLERANCE_SEC = 10;

export interface DeviceView extends DeviceStatus {
  online: boolean;
  known: boolean; // a status doc exists at all
  secondsAgo: number;
}

export function useDeviceStatus(deviceId: DeviceId): DeviceView {
  const [raw, setRaw] = useState<DeviceStatus | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let unsub = () => {};
    let cancelled = false;
    setRaw(null); // reset when switching device
    ensureAuth().then((ok) => {
      if (ok && !cancelled) {
        // ต้องมี error handler เสมอ ไม่งั้น error จาก Firestore (เช่น permission-denied
        // เพราะยังไม่ publish rules) จะเงียบสนิท แล้วหน้าจอค้างที่ "กำลังค้นหาอุปกรณ์"
        // โดยไม่มีเบาะแสว่าเกิดอะไรขึ้น
        unsub = subscribeDeviceStatus(deviceId, setRaw, (err) =>
          console.error(`[DeviceStatus:${deviceId}]`, err.message),
        );
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [deviceId]);

  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 5000);
    return () => clearInterval(id);
  }, []);

  const known = !!raw?.exists;
  const secondsAgo = raw?.lastSeen ? nowSec - raw.lastSeen : Infinity;
  const online = known && secondsAgo > -CLOCK_SKEW_TOLERANCE_SEC && secondsAgo < STALE_SEC;

  return {
    ...(raw ?? EMPTY_DEVICE),
    online,
    known,
    secondsAgo,
  };
}
