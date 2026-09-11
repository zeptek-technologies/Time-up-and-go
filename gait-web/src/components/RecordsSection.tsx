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
  // by default so the common case — reviewing real results — isn't cluttered.
  const [showAborted, setShowAborted] = useState(false);

  const onAssign = async (id: string, pid: string) => {
    try {
      await assignResult(id, pid);
    } catch (e) {
      console.error("[assignResult]", e);
      alert("บันทึกผู้ทดสอบให้ผลการทดสอบไม่สำเร็จ:\n" + (e as Error).message);
    }
  };

  let rows = showAborted ? results : results.filter((r) => r.status === "completed");
  // กรองระดับความเสี่ยงเฉพาะรอบที่สำเร็จ — รอบที่ยกเลิกเก็บ "เวลาที่ผ่านไปก่อนถูก
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
        <label className="search-box">
          <span className="search-box__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M16 16l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          {/* ห้าม .trim() ตรงนี้: ช่องนี้เป็น controlled input การตัดช่องว่างทุกครั้งที่พิมพ์
              ทำให้เคาะ space ไม่ติด — ค้นชื่อที่มีเว้นวรรค ("สมชาย ใจดี") ไม่ได้เลย
              ตัดตอนเอาไปเทียบแทน */}
          <input type="text" placeholder="ค้นหาจากชื่อผู้ทดสอบ, รหัส, ระดับความเสี่ยง, เวลา..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="filter-group" role="group" aria-label="กรองระดับความเสี่ยง">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className={`filter-chip ${filter === f.key ? "filter-chip--active" : ""}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
          {abortedCount > 0 && (
            <button
              type="button"
              className={`filter-chip ${showAborted ? "filter-chip--active" : ""}`}
              onClick={() => setShowAborted((v) => !v)}
              title="รอบที่ถูกยกเลิก/หมดเวลา — ไม่ถูกนำไปคิดสถิติ"
            >
              แสดงรอบที่ยกเลิก ({abortedCount})
            </button>
          )}
        </div>
      </div>

      <div className="table-wrap">
        <table className="results-table">
          <thead>
            <tr>
              <th>ลำดับ</th><th>ผู้ทดสอบ</th><th>เวลาที่ทดสอบ</th><th>รอบที่</th>
              <th>ไป (Checkpoint)</th><th>กลับ</th><th>เวลารวม</th><th>ระดับความเสี่ยง</th><th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="table-empty"><div className="table-empty__inner"><p>ไม่พบข้อมูลที่ตรงกับเงื่อนไข</p></div></td></tr>
            ) : (
              rows.map((r, i) => {
                const pn = patientName(r.patientId);
                const level = riskLevelOf(r.totalSec);
                const aborted = r.status === "aborted";
                return (
                  <tr key={r.id} style={aborted ? { opacity: 0.55 } : undefined}>
                    <td data-label="ลำดับ" style={{ fontWeight: 600, color: "var(--clr-text-secondary)" }}>{i + 1}</td>
                    <td data-label="ผู้ทดสอบ">
                      <span className={`patient-name-badge ${pn ? "" : "patient-name-badge--empty"}`}>
                        {pn ?? (r.subjectKey && r.subjectKey !== "unassigned" ? r.subjectKey : "ไม่ระบุ")}
                      </span>
                    </td>
                    <td data-label="เวลาที่ทดสอบ">{formatThai(r.finishedAt)}</td>
                    <td data-label="รอบที่">{r.trialNo > 0 ? r.trialNo : "—"}</td>
                    <td data-label="ไป (Checkpoint)">{r.checkpointSec.toFixed(2)} วินาที</td>
                    <td data-label="กลับ">{r.returnSec > 0 ? `${r.returnSec.toFixed(2)} วินาที` : "—"}</td>
                    <td data-label="เวลารวม"><strong>{r.totalSec.toFixed(2)} วินาที</strong></td>
                    <td data-label="ระดับความเสี่ยง">
                      {aborted ? (
                        <span className="risk-badge" title="รอบนี้ถูกยกเลิก/หมดเวลา — เวลาที่ได้ไม่ใช่ผลจริง">ยกเลิก</span>
                      ) : (
                        <span className={`risk-badge risk-badge--${riskClass(level)}`}><span className="risk-badge__dot" />{riskThai(level)}</span>
                      )}
                    </td>
                    <td data-label="จัดการ">
                      <select className="assign-select" value={r.patientId} onChange={(e) => onAssign(r.id, e.target.value)}>
                        <option value="">— เลือก —</option>
                        {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
