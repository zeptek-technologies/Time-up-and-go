import type { TugData } from "../hooks/useTugData";
import { IconPatients, IconPlus, IconUser } from "./Icons";

interface Props {
  data: TugData;
  activePatientId: string;
  setActivePatientId: (id: string) => void;
}

export default function PatientsSection({ data, activePatientId, setActivePatientId }: Props) {
  const { patients, results, assessments, removePatient } = data;

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

        <div className="patients-grid">
          {patients.length === 0 ? (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 40, color: "var(--clr-text-secondary)" }}>
              <IconPatients width={44} height={44} style={{ color: "#94a3b8", marginBottom: 8 }} />
              <p style={{ fontSize: ".85rem" }}>ยังไม่มีข้อมูลผู้ทดสอบ — กดปุ่ม "เพิ่มผู้ทดสอบ" เพื่อเริ่มต้น</p>
            </div>
          ) : (
            patients.map((p) => {
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
