import DataViewport from "./DataViewport";
import { useState } from "react";
import Pagination from "./Pagination";
import DataSearch from "./DataSearch";
import { usePagination } from "../hooks/usePagination";
import type { TugData } from "../hooks/useTugData";
import { IconPatients, IconPlus, IconUser } from "./Icons";

interface Props {
  data: TugData;
  activePatientId: string;
  setActivePatientId: (id: string) => void;
}

export default function PatientsSection({ data, activePatientId, setActivePatientId }: Props) {
  const { patients, results, assessments, removePatient } = data;

  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase("th-TH");
  const filtered = patients.filter((p) => [p.name, p.id, p.age, p.gender, p.note].join(" ").toLocaleLowerCase("th-TH").includes(query));
  const pagination = usePagination(filtered, query);

  const onDelete = async (id: string, name: string) => {
    if (!confirm(`ต้องการลบผู้ทดสอบ "${name}" จริงหรือไม่?\nผลการทดสอบที่ผูกไว้จะถูกปลดออก`)) return;
    try {
      await removePatient(id);
      if (activePatientId === id) setActivePatientId("");
    } catch (e) {
      alert("เกิดข้อผิดพลาด: " + (e as Error).message);
    }
  };

  return (
    <>
      <section className="patients-section" id="patients">
        <div className="section-header">
          <div>
            <span className="section-header__eyebrow">Patient Management</span>
            <h3 className="section-header__title">จัดการข้อมูลผู้ทดสอบ</h3>
          </div>
          <a className="btn btn--primary" href="?view=patients">
            <IconPlus width={18} height={18} />
            เพิ่มผู้ทดสอบ
          </a>
        </div>

        <div className="toolbar"><DataSearch label="ค้นหาผู้ทดสอบ" placeholder="ค้นหาชื่อ รหัส หรือหมายเหตุ" value={search} onChange={setSearch} /></div>
        <DataViewport className="data-viewport data-viewport--patients" label="รายชื่อผู้ทดสอบในหน้านี้" resetKey={JSON.stringify([search, pagination.page, pagination.pageSize])}>
        <div className="patients-grid">
          {filtered.length === 0 ? (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 40, color: "var(--clr-text-secondary)" }}>
              <IconPatients width={44} height={44} style={{ color: "#94a3b8", marginBottom: 8 }} />
              <p style={{ fontSize: ".85rem" }}>{query ? "ไม่พบผู้ทดสอบที่ตรงกับคำค้น" : 'ยังไม่มีข้อมูลผู้ทดสอบ — กดปุ่ม "เพิ่มผู้ทดสอบ" เพื่อเริ่มต้น'}</p>
            </div>
          ) : (
            pagination.items.map((p) => {
              const meta: string[] = [];
              if (p.age) meta.push(`${p.age} ปี`);
              if (p.gender) meta.push(p.gender);
              meta.push(`${results.filter((r) => r.patientId === p.id).length} TUG`);
              meta.push(`${assessments.filter((a) => a.patientId === p.id).length} ประเมินโรค`);
              return (
                <div key={p.id} className={`patient-card ${p.id === activePatientId ? "patient-card--active" : ""}`}>
                  <div className="patient-card__top">
                    <div className="patient-card__avatar">{p.name.charAt(0)}</div>
                    <div className="patient-card__info">
                      <div className="patient-card__name">{p.name}</div>
                      <div className="patient-card__meta">{meta.join(" · ")}</div>
                    </div>
                  </div>
                  {p.note && <div className="patient-card__note">{p.note}</div>}
                  <div className="patient-card__actions">
                    <button className="btn--assign" onClick={() => setActivePatientId(p.id)}>เลือก</button>
                    <button className="btn--danger-sm" onClick={() => onDelete(p.id, p.name)}>ลบ</button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        </DataViewport>
        <Pagination label="ผู้ทดสอบ" {...pagination} />
      </section>

      <ActivePatientBar patients={patients} value={activePatientId} onChange={setActivePatientId} />
    </>
  );
}

function ActivePatientBar({
  patients,
  value,
  onChange,
}: {
  patients: TugData["patients"];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="active-patient-bar">
      <div className="active-patient-bar__left">
        <IconUser width={20} height={20} />
        <span className="active-patient-bar__label">ผู้ทดสอบที่เลือก:</span>
      </div>
      <select className="active-patient-select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— ไม่ระบุผู้ทดสอบ —</option>
        {patients.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </div>
  );
}
