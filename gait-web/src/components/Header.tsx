// Sticky top header + horizontal quick-jump nav (replaces the old sidebar).
import DeviceStatusChip from "./DeviceStatusChip";
import DeviceResetButton from "./DeviceResetButton";

import { SECTIONS, type SectionKey } from "../lib/navigation";

interface Props {
  active: SectionKey;
  onNavigate: (key: SectionKey) => void;
}

export default function Header({ active, onNavigate }: Props) {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <button className="app-brand" aria-label="TUG Care Board — กลับภาพรวม" type="button" onClick={() => onNavigate("overview")}>
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
              aria-current={active === key ? "location" : undefined}
              onClick={() => onNavigate(key)}
            >
              <span className="app-nav__symbol" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d={NAV_ICONS[key]} />
                </svg>
              </span>
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

const NAV_ICONS: Record<SectionKey, string> = {
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  patients: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87",
  camera: "M3 6h12v12H3z M15 10l6-4v12l-6-4",
  records: "M6 3h12v18H6z M9 8h6 M9 12h6 M9 16h4",
  disease: "M3 12h4l3-8 4 16 3-8h4",
  guide: "M4 4h7l1 2 1-2h7v16h-7l-1 1-1-1H4z M12 6v15",
};
