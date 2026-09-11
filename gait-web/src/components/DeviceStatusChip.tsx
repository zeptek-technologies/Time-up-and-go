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

// ชื่อสถานะแบบภาษาคน — ค่าที่อุปกรณ์ส่งมาเป็นรหัสภาษาอังกฤษ (RUNNING, IDLE ...)
const STATE_TH: Record<string, string> = {
  CALIBRATE: "กำลังเตรียมระบบ",
  WAIT_SIT: "รอผู้ทดสอบนั่ง",
  READY: "พร้อมให้ลุก",
  RUNNING: "กำลังจับเวลา",
  RETURNING: "กำลังเดินกลับ",
  COOLDOWN: "พักระหว่างรอบ",
  IDLE: "รอเริ่มทดสอบ",
  DETECTING: "รอผู้ทดสอบเดินมาถึง",
  RESULT: "กำลังแสดงผล",
};

// ความแรงสัญญาณ Wi-Fi เป็นคำพูด แทนตัวเลข dBm ที่คนทั่วไปอ่านไม่ออก
function signalThai(rssi: number): string {
  if (!rssi) return "ไม่ทราบ";
  return rssi >= -60 ? "ดี" : rssi >= -70 ? "พอใช้" : "อ่อน";
}

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
        `สถานะ: ${STATE_TH[d.state] ?? (d.state || "-")}`,
        `สัญญาณ Wi-Fi: ${signalThai(d.rssi)}`,
        d.fwVersion && `รุ่นซอฟต์แวร์ ${d.fwVersion}`,
        `อัปเดต ${relTime(d.secondsAgo)}`,
        busyDuringTest && "หยุดส่งข้อมูลชั่วคราวระหว่างทดสอบ (ปกติ)",
      ]
        .filter(Boolean)
        .join(" · ")
    : `ยังไม่เคยได้รับข้อมูลจากอุปกรณ์${LABEL[deviceId]}`;

  return (
    <div className={`device-chip device-chip--${cls}`} title={title} aria-label={`${LABEL[deviceId]}: ${state}`}>
      <span className="device-chip__icon" aria-hidden="true">
        {deviceId === "chair" ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 11V6a2 2 0 0 1 2-2h7a3 3 0 0 1 3 3v4"/><path d="M4 11h15a2 2 0 0 1 2 2v2H3v-2a2 2 0 0 1 1-2Z"/><path d="M5 15v4m14-4v4"/></svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v8m-4-4h8"/></svg>
        )}
      </span>
      <span className="device-chip__body">
        <span className="device-chip__label">{LABEL[deviceId]}</span>
        <span className="device-chip__state"><span className="device-chip__dot" />{state}</span>
      </span>
      {d.known && !d.online && !busyDuringTest && Number.isFinite(d.secondsAgo) && <span className="device-chip__ago">{relTime(d.secondsAgo)}</span>}
    </div>
  );
}
