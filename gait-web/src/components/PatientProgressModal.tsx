import { useEffect, useState } from "react";
import type { GaitAssessment, Patient, TugResult } from "../lib/firebase";
import { getDiseaseMeta, riskClass, riskThai } from "../lib/meta";
import { formatIsoThai, formatThai } from "../lib/time";
import PatientAvatar from "./PatientAvatar";
import "./patient-progress-modal.css";

export default function PatientProgressModal({
  patient, results, assessments, focusAssessment, onClose,
}: {
  patient: Patient | null;
  results: TugResult[];
  assessments: GaitAssessment[];
  focusAssessment?: GaitAssessment;
  onClose: () => void;
}) {
  const [activePoint, setActivePoint] = useState<number | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const orderedResults = [...results].filter((r) => r.status === "completed").reverse();
  const maxTime = Math.max(...orderedResults.map((r) => r.totalSec), 1);
  const chartWidth = 640;
  const chartHeight = 190;
  const pad = { left: 42, right: 18, top: 16, bottom: 32 };
  const innerWidth = chartWidth - pad.left - pad.right;
  const innerHeight = chartHeight - pad.top - pad.bottom;
  const points = orderedResults.map((r, i) => ({
    x: pad.left + (orderedResults.length <= 1 ? innerWidth / 2 : i * innerWidth / (orderedResults.length - 1)),
    y: pad.top + innerHeight - (r.totalSec / maxTime) * innerHeight,
    result: r,
  }));
  const path = points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const latest = orderedResults.at(-1);
  const latestAssessment = focusAssessment ?? assessments[0];
  const title = patient?.name ?? (latestAssessment ? `ผลประเมิน ${latestAssessment.id.slice(0, 8)}` : "รายละเอียดผลประเมิน");

  return (
    <div className="progress-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="progress-modal" role="dialog" aria-modal="true" aria-labelledby="progress-modal-title">
        <header className="progress-modal__header">
          <div className="progress-modal__identity">
            {patient && <PatientAvatar gender={patient.gender} size="large" />}
            <div><span className="section-header__eyebrow">ข้อมูลผู้ทดสอบ</span><h2 id="progress-modal-title">{title}</h2>
              {patient && <p>{[patient.age ? `${patient.age} ปี` : "", patient.gender].filter(Boolean).join(" · ") || "ไม่ระบุอายุและเพศ"}</p>}
            </div>
          </div>
          <button className="progress-modal__close" type="button" onClick={onClose} aria-label="ปิดรายละเอียด">×</button>
        </header>

        <div className="progress-modal__body">
          <div className="progress-modal__summary">
            <div><span>ทดสอบสำเร็จ</span><strong>{orderedResults.length}</strong><small>ครั้ง</small></div>
            <div><span>เวลาเฉลี่ย</span><strong>{orderedResults.length ? (orderedResults.reduce((s, r) => s + r.totalSec, 0) / orderedResults.length).toFixed(2) : "-"}</strong><small>{orderedResults.length ? "วินาที" : ""}</small></div>
            <div><span>ผลล่าสุด</span><strong className={latest ? `is-${riskClass(riskThaiClass(latest))}` : ""}>{latest ? riskThai(riskThaiClass(latest)) : "-"}</strong><small>{latest ? `${latest.totalSec.toFixed(2)} วินาที` : "ยังไม่มีผล"}</small></div>
          </div>

          <section className="progress-chart" aria-labelledby="progress-chart-title">
            <div className="progress-modal__section-heading"><div><span className="section-header__eyebrow">Progress</span><h3 id="progress-chart-title">แนวโน้มเวลา TUG</h3></div><span>ยิ่งต่ำยิ่งดี</span></div>
            {points.length ? <div className="progress-chart__frame">
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`กราฟเวลา TUG ${points.length} ครั้ง`}>
                {[0, .5, 1].map((ratio) => <g key={ratio}><line x1={pad.left} x2={chartWidth - pad.right} y1={pad.top + innerHeight * ratio} y2={pad.top + innerHeight * ratio} /><text x={pad.left - 8} y={pad.top + innerHeight * ratio + 4}>{(maxTime * (1 - ratio)).toFixed(0)} วิ</text></g>)}
                <path className="progress-chart__line" d={path} />
                {points.map((p, i) => <g key={p.result.id} onMouseEnter={() => setActivePoint(i)} onMouseLeave={() => setActivePoint(null)} onFocus={() => setActivePoint(i)} onBlur={() => setActivePoint(null)} tabIndex={0} role="img" aria-label={`รอบที่ ${p.result.trialNo || i + 1} ${p.result.totalSec.toFixed(2)} วินาที`}><circle className={activePoint === i ? "is-active" : ""} cx={p.x} cy={p.y} r={activePoint === i ? 7 : 5} /><text className="progress-chart__x" x={p.x} y={chartHeight - 10}>{p.result.trialNo || i + 1}</text></g>)}
              </svg>{activePoint !== null && <div className="chart-tooltip" style={{ left: `${Math.max(10, Math.min(90, points[activePoint].x / chartWidth * 100))}%`, top: `${Math.max(10, points[activePoint].y / chartHeight * 100)}%` }} role="status"><strong>รอบที่ {points[activePoint].result.trialNo || activePoint + 1}</strong><span>{points[activePoint].result.totalSec.toFixed(2)} วินาที</span><small>{formatThai(points[activePoint].result.finishedAt)}</small></div>}
            </div> : <p className="progress-modal__empty">ยังไม่มีผล TUG ที่สำเร็จสำหรับผู้ทดสอบคนนี้</p>}
          </section>

          {latestAssessment && <section className="assessment-progress"><div className="progress-modal__section-heading"><div><span className="section-header__eyebrow">Gait assessment</span><h3>ผลประเมินจากกล้อง</h3></div><span>{formatIsoThai(latestAssessment.timestamp)}</span></div><div className="assessment-progress__row"><strong>{getDiseaseMeta(latestAssessment.condition).th}</strong><span>{latestAssessment.confidence.toFixed(0)}% ความมั่นใจ</span><div className="assessment-progress__track"><i style={{ width: `${Math.max(0, Math.min(100, latestAssessment.confidence))}%` }} /></div></div></section>}

          <section className="progress-history"><div className="progress-modal__section-heading"><h3>ประวัติการทดสอบ</h3><span>{results.length} รายการ</span></div><div className="progress-history__list">{[...results].slice(0, 8).map((r) => <div key={r.id}><span>{formatThai(r.finishedAt)}</span><strong>{r.status === "completed" ? `${r.totalSec.toFixed(2)} วินาที` : "ยกเลิก"}</strong><em className={r.status === "completed" ? `is-${riskClass(riskThaiClass(r))}` : ""}>{r.status === "completed" ? riskThai(riskThaiClass(r)) : "-"}</em></div>)}</div></section>
        </div>
      </section>
    </div>
  );
}

function riskThaiClass(result: TugResult): "LOW" | "MODERATE" | "HIGH" {
  return result.totalSec <= 11 ? "LOW" : result.totalSec <= 30 ? "MODERATE" : "HIGH";
}
