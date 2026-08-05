// ESP32 board presence indicator for the header. One chip per board.
import { useDeviceStatus } from "../hooks/useDeviceStatus";
import type { DeviceId } from "../lib/firebase";

function relTime(sec: number): string {
  if (!Number.isFinite(sec)) return "";
  // No Math.max(0, …) clamp here on purpose. It used to turn a negative age
  // (heartbeat timestamped slightly ahead of the browser clock) into a
  // misleading "0 วินาทีที่แล้ว" sitting next to an OFFLINE label. Anything
  // this recent — including a small negative — is honestly "just now".
  if (sec < 5) return "เมื่อสักครู่";
  if (sec < 60) return `${Math.round(sec)} วินาทีที่แล้ว`;
  if (sec < 3600) return `${Math.round(sec / 60)} นาทีที่แล้ว`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ชม.ที่แล้ว`;

  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);

  return hours > 0
    ? `${days} วัน ${hours} ชม.ที่แล้ว`
    : `${days} วันที่แล้ว`;
}

const LABEL: Record<DeviceId, string> = {
  chair: "เก้าอี้",
  checkpoint: "จุดหมุนตัว",
};

export default function DeviceStatusChip({ deviceId }: { deviceId: DeviceId }) {
  const d = useDeviceStatus(deviceId);
  const chair = useDeviceStatus("chair");

  // Spec section 4: while the chair is RUNNING, the checkpoint deliberately
  // stops sending heartbeats (an HTTPS call would block its loop and make it
  // miss the walker passing by). Showing OFFLINE then would alarm staff over
  // normal behaviour — so trust chair.checkpoint_online, which comes straight
  // from the ESP-NOW link and stays accurate throughout.
  const busyDuringTest =
    deviceId === "checkpoint" && !d.online && chair.online && chair.state === "RUNNING";

  const cls = !d.known ? "unknown" : busyDuringTest ? "busy" : d.online ? "online" : "offline";
  const state = !d.known
    ? "ไม่พบข้อมูล"
    : busyDuringTest
      ? "กำลังทดสอบ"
      : d.online
        ? "ออนไลน์"
        : "ออฟไลน์";

  const title = d.known
    ? [
        `สถานะ: ${d.state || "-"}`,
        `สัญญาณ ${d.rssi} dBm`,
        d.fwVersion && `เฟิร์มแวร์ ${d.fwVersion}`,
        `อัปเดต ${relTime(d.secondsAgo)}`,
        busyDuringTest && "หยุดส่ง heartbeat ชั่วคราวระหว่างทดสอบ (ปกติ)",
      ]
        .filter(Boolean)
        .join(" · ")
    : `ยังไม่เคยได้รับ heartbeat จากบอร์ด${LABEL[deviceId]}`;

  return (
    <div className={`device-chip device-chip--${cls}`} title={title}>
      <span className="device-chip__dot" />
      <span className="device-chip__label">{LABEL[deviceId]}: {state}</span>
      {d.known && !d.online && !busyDuringTest && Number.isFinite(d.secondsAgo) && (
        <span className="device-chip__ago">· {relTime(d.secondsAgo)}</span>
      )}
    </div>
  );
}
