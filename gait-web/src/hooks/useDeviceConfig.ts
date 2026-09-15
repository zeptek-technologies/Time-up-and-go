// ค่าระยะเซนเซอร์ที่ "บันทึกไว้" ใน device_commands/<บอร์ด> (ฝั่งที่เว็บเป็นคนเขียน)
// ค่าที่บอร์ด "ใช้อยู่จริง" มาจาก useDeviceStatus (cfg_*) — ส่วนตั้งค่าเทียบสองค่านี้กัน
import { useEffect, useState } from "react";
import { ensureAuth, subscribeDeviceConfig, type DeviceConfigRequest, type DeviceId } from "../lib/firebase";

export function useDeviceConfig(deviceId: DeviceId): DeviceConfigRequest | null {
  const [config, setConfig] = useState<DeviceConfigRequest | null>(null);

  useEffect(() => {
    let unsub = () => {};
    let cancelled = false;
    ensureAuth().then((ok) => {
      if (ok && !cancelled) {
        unsub = subscribeDeviceConfig(deviceId, setConfig, (err) =>
          console.error(`[DeviceConfig:${deviceId}]`, err.message),
        );
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [deviceId]);

  return config;
}
