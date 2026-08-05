// Sticky top header + horizontal quick-jump nav (replaces the old sidebar).
import DeviceStatusChip from "./DeviceStatusChip";
import DeviceResetButton from "./DeviceResetButton";

export type SectionKey = "overview" | "patients" | "camera" | "records" | "disease" | "guide";

// Page + nav order. Camera sits right after Patients per the workflow:
// manage/select the patient, then run the gait test.
export const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "overview", label: "ภาพรวม" },
  { key: "patients", label: "ผู้ทดสอบ" },
  { key: "camera", label: "กล้องทดสอบ" },
  { key: "records", label: "ผลการทดสอบ" },
  { key: "disease", label: "เสี่ยงโรค" },
  { key: "guide", label: "วิธีอ่านผล" },
];

interface Props {
  active: SectionKey;
  onNavigate: (key: SectionKey) => void;
}

export default function Header({ active, onNavigate }: Props) {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <button className="app-brand" type="button" onClick={() => onNavigate("overview")}>
          <span className="app-brand__icon" aria-hidden="true">
            <svg viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="30" fill="currentColor" opacity="0.15" />
              <path d="M28 16h8v12h12v8H36v12h-8V36H16v-8h12V16z" fill="currentColor" />
            </svg>
          </span>
          <span className="app-brand__text">
            <strong>TUG Care Board</strong>
            <small>Timed Up &amp; Go Monitoring</small>
          </span>
        </button>

        <nav className="app-nav" aria-label="เมนูหลัก">
          {SECTIONS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`app-nav__link ${active === key ? "app-nav__link--active" : ""}`}
              onClick={() => onNavigate(key)}
            >
              {label}
            </button>
          ))}
          <a className="app-nav__link app-nav__external" href="?view=patients">
            จัดการผู้ทดสอบ <span aria-hidden="true">→</span>
          </a>
          <a
            className="app-nav__link app-nav__external"
            href="?view=live-status"
            target="_blank"
            rel="noopener noreferrer"
            title="เปิดจอแสดงสถานะในแท็บใหม่"
          >
            จอสถานะ ESP32 <span aria-hidden="true">↗</span>
            <span className="sr-only"> เปิดในแท็บใหม่</span>
          </a>
        </nav>

        <div className="app-header__status">
          <DeviceStatusChip deviceId="chair" />
          <DeviceStatusChip deviceId="checkpoint" />
          <DeviceResetButton />
        </div>
      </div>
    </header>
  );
}
