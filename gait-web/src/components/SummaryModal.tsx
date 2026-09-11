// Session summary - web port of draw_summary_modal().
import { getDiseaseMeta } from "../lib/meta";
import type { RiskScores } from "../lib/recorder";

export interface Summary {
  highestRisk: string;
  riskPercentage: number;
  totalFrames: number;
  riskScores: RiskScores;
  stepCount: number;
  cadenceAvg: number;
  stepTimeCvAvg: number;
  uploadStatus: string;
  documentId: string | null;
}

export default function SummaryModal({ summary, onClose }: { summary: Summary; onClose: () => void }) {
  const ok = summary.uploadStatus.startsWith("Successfully");
  return (
    <div className="gc-modal-backdrop" onClick={onClose}>
      <div className="gc-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="gc-modal__title">สรุปผลการวิเคราะห์การเดิน</h2>
        <div className="gc-modal__rows">
          {/* ป้ายผลใช้ชื่อไทยชุดเดียวกับตารางและจอสถานะ - เดิมกล่องนี้โชว์ค่าดิบ
              ("Hemiplegic", "No Data") ทั้งที่ทุกหน้าจออื่นแปลไทยหมดแล้ว */}
          <div className="gc-modal__highlight">
            ผลที่พบเด่นสุด: <b>{getDiseaseMeta(summary.highestRisk).th}</b> ({summary.riskPercentage.toFixed(1)}%)
          </div>
          <div>จำนวนภาพที่วิเคราะห์ได้: {summary.totalFrames}</div>
          <div className="gc-modal__gait">
            <span><b>{summary.stepCount}</b> ก้าว</span>
            <span>
              จังหวะ:{" "}
              <b>{Number.isFinite(summary.cadenceAvg) ? `${summary.cadenceAvg.toFixed(0)} ก้าว/นาที` : "-"}</b>
            </span>
            <span>
              ความแปรปรวน:{" "}
              <b>{Number.isFinite(summary.stepTimeCvAvg) ? `${summary.stepTimeCvAvg.toFixed(1)}%` : "-"}</b>
            </span>
          </div>
          <div className="gc-modal__scores">
            {(Object.keys(summary.riskScores) as (keyof RiskScores)[]).map((label) => (
              <span key={label}>{getDiseaseMeta(label).th}: {summary.riskScores[label]}</span>
            ))}
          </div>
          <div className={ok ? "gc-modal__status-ok" : "gc-modal__status-err"}>
            {ok ? "ส่งผลเข้าระบบเรียบร้อย" : "ส่งผลเข้าระบบไม่สำเร็จ ลองกด “จบและส่งผล” อีกครั้ง"}
          </div>
        </div>
        <button className="gc-btn gc-btn--primary" onClick={onClose}>
          ปิด / ทดสอบต่อ
        </button>
      </div>
    </div>
  );
}
