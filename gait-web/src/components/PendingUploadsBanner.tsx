// Warns that the chair board is holding results it hasn't managed to upload,
// which means the list on screen is INCOMPLETE. The board retries automatically
// once it's back online.
import { useDeviceStatus } from "../hooks/useDeviceStatus";

// The firmware's on-board queue holds 8 results; past that it drops the oldest,
// so hitting 8 means data may already be lost - escalate the warning.
const BUFFER_LIMIT = 8;

export default function PendingUploadsBanner() {
  const chair = useDeviceStatus("chair");
  if (!chair.known || chair.pendingUploads <= 0) return null;

  const full = chair.pendingUploads >= BUFFER_LIMIT;

  return (
    <div className={`pending-banner ${full ? "pending-banner--critical" : ""}`} role="status">
      <span className="pending-banner__icon" aria-hidden="true">{full ? "⛔" : "⚠️"}</span>
      <div>
        <strong>
          {full
            ? `อุปกรณ์เก็บผลที่ยังส่งไม่ได้ไว้เต็มแล้ว (${chair.pendingUploads}/${BUFFER_LIMIT}) - ผลบางรอบอาจหายไปแล้ว`
            : `มีผลการทดสอบ ${chair.pendingUploads} รายการที่อุปกรณ์ยังส่งเข้าระบบไม่ได้`}
        </strong>
        <p className="pending-banner__hint">
          {full
            ? "อุปกรณ์เก็บได้สูงสุด 8 รายการ ถ้าเกินจะลบรายการเก่าที่สุดทิ้ง กรุณาตรวจสอบอินเทอร์เน็ตของอุปกรณ์โดยด่วน"
            : "รายการบนหน้าจอจึงยังไม่ครบ อุปกรณ์จะส่งให้เองเมื่อกลับมาออนไลน์"}
        </p>
      </div>
    </div>
  );
}
