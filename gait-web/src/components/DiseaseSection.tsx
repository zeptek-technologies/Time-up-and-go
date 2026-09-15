import DataViewport from "./DataViewport";
import { useState } from "react";
import Pagination from "./Pagination";
import DataSearch from "./DataSearch";
import { usePagination } from "../hooks/usePagination";
import PatientProgressModal from "./PatientProgressModal";
import type { TugData } from "../hooks/useTugData";
import { getDiseaseMeta } from "../lib/meta";
import { formatIsoThai } from "../lib/time";

const ORDER = ["Normal", "Parkinsonian", "Hemiplegic", "Steppage"];

export default function DiseaseSection({ data }: { data: TugData }) {
  const { assessments, assessmentsError, patients, patientName, assignAssessment } = data;
  const [selectedAssessment, setSelectedAssessment] = useState<typeof assessments[number] | null>(null);

  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase("th-TH");
  const filtered = assessments.filter((item) => [patientName(item.patientId), item.id, getDiseaseMeta(item.condition).th, item.condition].join(" ").toLocaleLowerCase("th-TH").includes(query));
  const pagination = usePagination(filtered, query);

  const onAssign = async (id: string, pid: string) => {
    try {
      await assignAssessment(id, pid);
    } catch (e) {
      console.error("[assignAssessment]", e);
      alert("บันทึกผู้ป่วยให้ผลประเมินไม่สำเร็จ:\n" + (e as Error).message);
    }
  };
  const latest = assessments[0];
  const latestMeta = latest ? getDiseaseMeta(latest.condition) : null;

  const latestScores = latest?.riskScores ?? {};
  const maxScore = Math.max(...ORDER.map((k) => Number(latestScores[k] ?? 0)), 1);

  return (
    <section className="disease-section" id="disease">
      <div className="section-header">
        <div>
          <span className="section-header__eyebrow">Disease Risk Assessment</span>
          <h3 className="section-header__title">ผลประเมินความเสี่ยงที่จะเป็นโรค</h3>
        </div>
      </div>

      <div className="disease-stats-grid" aria-label="สรุปผลประเมินความเสี่ยงโรค">
        <article className="stat-card stat-card--accent">
          <div className="stat-card__body">
            <p className="stat-card__label">จำนวนผลประเมินโรค</p>
            <h3 className="stat-card__value">{assessmentsError ? "-" : assessments.length}</h3>

          </div>
        </article>
        <article className="stat-card">
          <div className="stat-card__body">
            <p className="stat-card__label">ผลล่าสุดที่พบ</p>
            <h3 className="stat-card__value">{latestMeta ? latestMeta.th : "-"}</h3>
            <p className="stat-card__hint">{latest ? (patientName(latest.patientId) ?? `รหัสผล ${latest.id.slice(0, 8)}`) : "รอข้อมูล"}</p>
          </div>
        </article>
        <article className="stat-card">
          <div className="stat-card__body">
            <p className="stat-card__label">ความแม่นยำล่าสุด</p>
            <h3 className="stat-card__value">{latest ? `${latest.confidence.toFixed(0)}%` : "0%"}</h3>

          </div>
        </article>
      </div>

      <div className="disease-score-grid">
        {ORDER.map((key) => {
          const value = Number(latestScores[key] ?? 0);
          const percent = Math.max(0, Math.min(100, (value / maxScore) * 100));
          return (
            <article key={key} className="disease-score-card">
              <div className="disease-score-card__top">
                <span className="disease-score-card__label">{getDiseaseMeta(key).th}</span>
                <span className="disease-score-card__value">{value}</span>
              </div>
              <div className="disease-score-card__bar" aria-hidden="true">
                <div className="disease-score-card__fill" style={{ width: `${percent}%` }} />
              </div>
            </article>
          );
        })}
      </div>

      <div className="toolbar"><DataSearch label="ค้นหาผลประเมินโรค" placeholder="ค้นหาชื่อ รหัส หรือผลที่พบ" value={search} onChange={setSearch} /></div>
      <DataViewport className="table-wrap disease-table-wrap data-viewport" label="ผลประเมินโรคในหน้านี้" resetKey={JSON.stringify([search, pagination.page, pagination.pageSize])}>
        <table className="results-table disease-table">
          <thead>
            <tr>
              <th>ลำดับ</th><th>ผู้ป่วย</th><th>ผลที่พบ</th><th>ความมั่นใจ</th><th>การเดิน</th><th>คะแนนความเสี่ยง</th><th>เวลา</th><th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {assessmentsError ? (
              <tr><td colSpan={8} className="table-empty table-empty--error">
                <div className="table-empty__inner">
                  <p>โหลดผลประเมินจากกล้องไม่สำเร็จ</p>
                  <small title={assessmentsError}>กรุณาลองโหลดหน้าเว็บใหม่อีกครั้ง</small>
                </div>
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="table-empty"><div className="table-empty__inner"><p>{query ? "ไม่พบผลประเมินที่ตรงกับคำค้น" : "ยังไม่มีผลประเมินความเสี่ยงโรคจากกล้อง"}</p></div></td></tr>
            ) : (
              pagination.items.map((item, i) => {
                const meta = getDiseaseMeta(item.condition);
                const pn = patientName(item.patientId);
                const scores = Object.entries(item.riskScores)
                  .sort((a, b) => Number(b[1]) - Number(a[1]))
                  .map(([k, v]) => (
                    <span key={k} className="score-pill">{getDiseaseMeta(k).th} <strong>{Number(v)}</strong></span>
                  ));
                return (
                  <tr key={item.id} className="data-row-clickable" onClick={() => item.patientId && setSelectedAssessment(item)} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && item.patientId) { e.preventDefault(); setSelectedAssessment(item); } }} tabIndex={item.patientId ? 0 : undefined}>
                    <td data-label="ลำดับ" style={{ fontWeight: 600, color: "var(--clr-text-secondary)" }}>{pagination.offset + i + 1}</td>
                    <td data-label="ผู้ป่วย">
                      <span className={`patient-name-badge ${pn ? "" : "patient-name-badge--empty"}`}>{pn ?? "ไม่ระบุ"}</span>
                    </td>
                    <td data-label="ผลที่พบ"><span className={`condition-badge condition-badge--${meta.cls}`}>{meta.th}</span></td>
                    <td data-label="ความมั่นใจ">
                      <span className="confidence-meter">
                        <span className="confidence-meter__track" aria-hidden="true">
                          <span className="confidence-meter__fill" style={{ width: `${Math.max(0, Math.min(100, item.confidence))}%` }} />
                        </span>
                        <span className="confidence-meter__value">{item.confidence.toFixed(0)}%</span>
                      </span>
                    </td>
                    <td data-label="การเดิน">
                      {item.stepCount === null ? (
                        // Records written before step counting existed.
                        <span style={{ color: "var(--clr-text-secondary)" }}>-</span>
                      ) : (
                        <span className="gait-cell">
                          <strong>{item.stepCount}</strong> ก้าว
                          {item.cadenceAvg !== null && (
                            <small>{item.cadenceAvg.toFixed(0)} ก้าว/นาที</small>
                          )}
                        </span>
                      )}
                    </td>
                    <td data-label="คะแนน"><span className="score-stack">{scores.length ? scores : "-"}</span></td>
                    <td data-label="เวลา">{formatIsoThai(item.timestamp)}</td>
                    <td data-label="จัดการ">
                      <select className="assign-select" value={item.patientId} onClick={(e) => e.stopPropagation()} onChange={(e) => onAssign(item.id, e.target.value)}>
                        <option value="">- เลือกผู้ป่วย -</option>
                        {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </DataViewport>
      <Pagination label="ผลประเมินโรค" {...pagination} />
      {selectedAssessment && <PatientProgressModal patient={patients.find((p) => p.id === selectedAssessment.patientId) ?? null} results={data.results.filter((r) => r.patientId === selectedAssessment.patientId)} assessments={assessments.filter((a) => a.patientId === selectedAssessment.patientId)} focusAssessment={selectedAssessment} onClose={() => setSelectedAssessment(null)} />}
    </section>
  );
}
