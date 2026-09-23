import DataViewport from "./DataViewport";
import Pagination from "./Pagination";
import DataSearch from "./DataSearch";
import { usePagination } from "../hooks/usePagination";
import PatientProgressModal from "./PatientProgressModal";
import { useState } from "react";
import type { TugData } from "../hooks/useTugData";
import { riskClass, riskThai } from "../lib/meta";
import { riskLevelOf } from "../lib/tugRisk";
import { formatThai } from "../lib/time";

const FILTERS = [
  { key: "ALL", label: "ทั้งหมด" },
  { key: "LOW", label: "ต่ำ" },
  { key: "MODERATE", label: "ปานกลาง" },
  { key: "HIGH", label: "สูง" },
];

export default function RecordsSection({ data }: { data: TugData }) {
  const { results, patients, patientName, assignResult } = data;
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  // Aborted trials stay in the table for audit (spec section 3) but are hidden
  // by default so the common case - reviewing real results - isn't cluttered.
  const [showAborted, setShowAborted] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  const onAssign = async (id: string, pid: string) => {
    try {
      await assignResult(id, pid);
    } catch (e) {
      console.error("[assignResult]", e);
      alert("บันทึกผู้ทดสอบให้ผลการทดสอบไม่สำเร็จ:\n" + (e as Error).message);
    }
  };

  let rows = showAborted ? results : results.filter((r) => r.status === "completed");
  // กรองระดับความเสี่ยงเฉพาะรอบที่สำเร็จ - รอบที่ยกเลิกเก็บ "เวลาที่ผ่านไปก่อนถูก
  // ยกเลิก" ไม่ใช่เวลา TUG จริง การเอาไปจัดระดับจึงได้ผลที่ขัดกับช่องผลของมันเอง
  // (แถวขึ้นว่า "ยกเลิก" แต่ดันโผล่มาในตัวกรอง "สูง")
  if (filter !== "ALL") {
    rows = rows.filter((r) => r.status === "completed" && riskLevelOf(r.totalSec) === filter);
  }
  const q = search.trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) => {
      const pn = patientName(r.patientId) ?? "";
      return (
        r.id.toLowerCase().includes(q) ||
        r.totalSec.toFixed(2).includes(q) ||
        r.checkpointSec.toFixed(2).includes(q) ||
        riskThai(riskLevelOf(r.totalSec)).includes(q) ||
        riskLevelOf(r.totalSec).toLowerCase().includes(q) ||
        r.subjectKey.toLowerCase().includes(q) ||
        r.sessionId.toLowerCase().includes(q) ||
        pn.toLowerCase().includes(q)
      );
    });
  }

  const pagination = usePagination(rows, JSON.stringify([q, filter, showAborted]));

  const abortedCount = results.length - results.filter((r) => r.status === "completed").length;

  return (
    <section className="records-section" id="records">
      <div className="section-header">
        <div>
          <span className="section-header__eyebrow">Test Records</span>
          <h3 className="section-header__title">ผลการทดสอบทั้งหมด</h3>
        </div>
      </div>

      <div className="toolbar">
        <DataSearch label="ค้นหาผลการทดสอบ" placeholder="ค้นหาชื่อ รหัส ระดับความเสี่ยง หรือเวลา" value={search} onChange={setSearch} />
        <div className="filter-group" role="group" aria-label="กรองระดับความเสี่ยง">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className={`filter-chip ${filter === f.key ? "filter-chip--active" : ""}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
          {abortedCount > 0 && (
            <button
              type="button"
              className={`filter-chip ${showAborted ? "filter-chip--active" : ""}`}
              aria-pressed={showAborted}
              onClick={() => setShowAborted((v) => !v)}
              title="รอบที่ถูกยกเลิก/หมดเวลา - ไม่ถูกนำไปคิดสถิติ"
            >
              แสดงรอบที่ยกเลิก ({abortedCount})
            </button>
          )}
        </div>
      </div>

      <DataViewport className="table-wrap data-viewport" label="ผลการทดสอบในหน้านี้" resetKey={JSON.stringify([search, filter, showAborted, pagination.page, pagination.pageSize])}>
        <table className="results-table">
          <thead>
            <tr>
              <th>ลำดับ</th><th>ผู้ทดสอบ</th><th>เวลาที่ทดสอบ</th><th>รอบที่</th>
              <th>ขาไป (ถึงจุดหมุนตัว)</th><th>กลับ</th><th>เวลารวม</th><th>ระดับความเสี่ยง</th><th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="table-empty"><div className="table-empty__inner"><p>ไม่พบข้อมูลที่ตรงกับเงื่อนไข</p></div></td></tr>
            ) : (
              pagination.items.map((r, i) => {
                const pn = patientName(r.patientId);
                const level = riskLevelOf(r.totalSec);
                const aborted = r.status === "aborted";
                return (
                  <tr key={r.id} className="data-row-clickable" style={aborted ? { opacity: 0.55 } : undefined} onClick={() => r.patientId && setSelectedPatientId(r.patientId)} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && r.patientId) { e.preventDefault(); setSelectedPatientId(r.patientId); } }} tabIndex={r.patientId ? 0 : undefined}>
                    <td data-label="ลำดับ" style={{ fontWeight: 600, color: "var(--clr-text-secondary)" }}>{pagination.offset + i + 1}</td>
                    <td data-label="ผู้ทดสอบ">
                      <span className={`patient-name-badge ${pn ? "" : "patient-name-badge--empty"}`}>
                        {pn ?? (r.subjectKey && r.subjectKey !== "unassigned" ? r.subjectKey : "ไม่ระบุ")}
                      </span>
                    </td>
                    <td data-label="เวลาที่ทดสอบ">{formatThai(r.finishedAt)}</td>
                    <td data-label="รอบที่">{r.trialNo > 0 ? r.trialNo : "-"}</td>
                    <td data-label="ขาไป (ถึงจุดหมุนตัว)">{r.checkpointSec > 0 ? `${r.checkpointSec.toFixed(2)} วินาที` : "-"}</td>
                    <td data-label="กลับ">{r.returnSec > 0 ? `${r.returnSec.toFixed(2)} วินาที` : "-"}</td>
                    <td data-label="เวลารวม">
                      <strong>{r.totalSec.toFixed(2)} วินาที</strong>
                      <small className="timing-source">
                        {r.timingSource === "camera" ? "จากกล้อง" : "จากเก้าอี้"}
                        {r.cameraTotalSec != null && r.chairTotalSec != null && ` · เก้าอี้วัดได้ ${r.chairTotalSec.toFixed(2)}`}
                      </small>
                    </td>
                    <td data-label="ระดับความเสี่ยง">
                      {aborted ? (
                        <span className="risk-badge" title="รอบนี้ถูกยกเลิก/หมดเวลา - เวลาที่ได้ไม่ใช่ผลจริง">ยกเลิก</span>
                      ) : (
                        <span className={`risk-badge risk-badge--${riskClass(level)}`}><span className="risk-badge__dot" />{riskThai(level)}</span>
                      )}
                    </td>
                    <td data-label="จัดการ">
                      <select className="assign-select" value={r.patientId} onClick={(e) => e.stopPropagation()} onChange={(e) => onAssign(r.id, e.target.value)}>
                        <option value="">- เลือก -</option>
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
      <Pagination label="ผลการทดสอบ" {...pagination} />
      {selectedPatientId && <PatientProgressModal patient={patients.find((p) => p.id === selectedPatientId) ?? null} results={results.filter((r) => r.patientId === selectedPatientId)} assessments={[]} onClose={() => setSelectedPatientId(null)} />}
    </section>
  );
}
