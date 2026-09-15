// Remote-reboot button for the ESP32 chair controller. Only usable while the
// chair is online — a board that isn't polling Firestore can't be woken by a
// write, so there's no point queuing a reset for an offline device.
import { useDeviceStatus } from "../hooks/useDeviceStatus";
import { useDeviceReset } from "../hooks/useDeviceReset";

export default function DeviceResetButton() {
  const { online } = useDeviceStatus("chair");
  const { pending, requestReset } = useDeviceReset();

  const onClick = () => {
    const ok = confirm(
      "เริ่มอุปกรณ์ที่เก้าอี้ใหม่ทันที?\n" +
        "การทดสอบที่กำลังทำอยู่ (ถ้ามี) จะถูกยกเลิก และอุปกรณ์จะใช้งานไม่ได้ชั่วคราวประมาณ 10-15 วินาที",
    );
    if (ok) requestReset();
  };

  return (
    <button
      type="button"
      className="device-reset-btn"
      disabled={!online || pending}
      onClick={onClick}
      title={!online ? "อุปกรณ์ต้องออนไลน์ก่อน จึงจะสั่งเริ่มใหม่ได้" : "สั่งให้อุปกรณ์ที่เก้าอี้เริ่มทำงานใหม่"}
      aria-label={pending ? "กำลังส่งคำสั่งเริ่มอุปกรณ์ใหม่" : "เริ่มอุปกรณ์ใหม่"}
    >
      {/* Full label on roomy viewports; on phones the header row cannot fit
          it beside two status chips, so it collapses to the glyph while the
          accessible name above stays complete. */}
      <span className="device-reset-btn__icon-wrap" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M20 11a8 8 0 1 0 1 4"/><path d="M20 5v6h-6"/></svg></span>
      <span className="device-reset-btn__full">{pending ? "กำลังส่งคำสั่ง…" : "เริ่มอุปกรณ์ใหม่"}</span>
      <span className="device-reset-btn__icon" aria-hidden="true">⟳</span>
    </button>
  );
}
