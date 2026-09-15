import { useState } from "react";
import type { TugResult } from "../lib/firebase";
import { formatThai } from "../lib/time";
import "./patient-progress-modal.css";

export default function PatientTrendChart({ results }: { results: TugResult[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const rows = [...results].filter((r) => r.status === "completed").reverse();
  const max = Math.max(...rows.map((r) => r.totalSec), 1);
  const w = 680, h = 190, left = 42, right = 18, top = 16, bottom = 32;
  const iw = w - left - right, ih = h - top - bottom;
  const points = rows.map((r, i) => ({ r, x: left + (rows.length <= 1 ? iw / 2 : i * iw / (rows.length - 1)), y: top + ih - (r.totalSec / max) * ih }));
  const path = points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return <section className="pm-trend" aria-labelledby="pm-trend-title">
    <div className="pm-section-heading"><div><span className="section-header__eyebrow">Progress</span><h3 id="pm-trend-title">แนวโน้มเวลา TUG</h3></div><span>ยิ่งต่ำยิ่งดี · {rows.length} ครั้ง</span></div>
    {rows.length ? <div className="pm-trend__frame"><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="กราฟแนวโน้มเวลา TUG ของผู้ทดสอบ">
      {[0, .5, 1].map((ratio) => <g key={ratio}><line x1={left} x2={w - right} y1={top + ih * ratio} y2={top + ih * ratio} /><text x={left - 8} y={top + ih * ratio + 4}>{(max * (1 - ratio)).toFixed(0)}s</text></g>)}
      <path className="pm-trend__line" d={path} />
      {points.map((p, i) => <g key={p.r.id} onMouseEnter={() => setActiveIndex(i)} onMouseLeave={() => setActiveIndex(null)} onFocus={() => setActiveIndex(i)} onBlur={() => setActiveIndex(null)} tabIndex={0} role="img" aria-label={`รอบที่ ${p.r.trialNo || i + 1} ${p.r.totalSec.toFixed(2)} วินาที`}><circle className={activeIndex === i ? "is-active" : ""} cx={p.x} cy={p.y} r={activeIndex === i ? 7 : 5} /><text className="pm-trend__x" x={p.x} y={h - 10}>{p.r.trialNo || i + 1}</text></g>)}
    </svg>{activeIndex !== null && <div className="chart-tooltip" style={{ left: `${Math.max(10, Math.min(90, points[activeIndex].x / w * 100))}%`, top: `${Math.max(10, points[activeIndex].y / h * 100)}%` }} role="status"><strong>รอบที่ {points[activeIndex].r.trialNo || activeIndex + 1}</strong><span>{points[activeIndex].r.totalSec.toFixed(2)} วินาที</span><small>{formatThai(points[activeIndex].r.finishedAt)}</small></div>}</div> : <p className="pm-trend__empty">ยังไม่มีผล TUG ที่สำเร็จสำหรับผู้ทดสอบคนนี้</p>}
  </section>;
}
