import PatientAvatar from "./PatientAvatar";
import DataSearch from "./DataSearch";
import PatientTrendChart from "./PatientTrendChart";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTugData, type TugData } from "../hooks/useTugData";
import { CONDITION_LABEL, CONDITION_OPTIONS } from "../lib/conditions";
import { getDiseaseMeta, riskClass, riskThai } from "../lib/meta";
import { riskLevelOf } from "../lib/tugRisk";
import { formatIsoThai, formatThai } from "../lib/time";
import { IconClose, IconPatients, IconPlus, IconUser } from "./Icons";
import tugCareLogo from "../assets/brand/tug-care-logo-192.png";

export default function PatientManagementPage() {
  const data = useTugData();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const filteredPatients = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("th");
    if (!query) return data.patients;
    return data.patients.filter((patient) => {
      const conditions = patient.conditions.map((id) => CONDITION_LABEL.get(id) ?? id).join(" ");
      return [patient.name, patient.gender, patient.note, String(patient.age ?? ""), conditions]
        .join(" ")
        .toLocaleLowerCase("th")
        .includes(query);
    });
  }, [data.patients, search]);

  const effectiveSelectedId = data.patients.some((patient) => patient.id === selectedId)
    ? selectedId
    : (data.patients[0]?.id ?? "");
  const selectedPatient = data.patients.find((patient) => patient.id === effectiveSelectedId) ?? null;

  return (
    <div className="patient-manager">
      <header className="pm-header">
        <div className="pm-header__inner">
          <a className="pm-brand" href="./" aria-label="กลับไปหน้าภาพรวม">
            <span className="pm-brand__mark" aria-hidden="true">
              <img src={tugCareLogo} alt="" />
            </span>
            <span>
              <strong>TUG Care Board</strong>
              <small>ทะเบียนและประวัติผู้ทดสอบ</small>
            </span>
          </a>
          <a className="pm-back" href="./">← กลับหน้าภาพรวม</a>
        </div>
      </header>

      <main className="pm-main">
        <section className="pm-intro" aria-labelledby="pm-title">
          <div>
            <span className="section-header__eyebrow">Patient Registry</span>
            <h1 id="pm-title">จัดการผู้ทดสอบ</h1>
            <p>ค้นหารายชื่อ เลือกดูผลเฉพาะบุคคล และบันทึกโรคประจำตัวที่อาจมีผลต่อการเดิน</p>
          </div>
          <button className="btn btn--primary pm-add-button" type="button" onClick={() => setAddOpen(true)}>
            <IconPlus width={18} height={18} />
            เพิ่มผู้ทดสอบ
          </button>
        </section>

        {data.conn === "error" && (
          <div className="pm-connection pm-connection--error" role="alert">
            เชื่อมต่อข้อมูลไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วโหลดหน้าใหม่
          </div>
        )}

        <div className="pm-workspace">
          <aside className="pm-roster" aria-label="รายชื่อผู้ทดสอบ">
            <div className="pm-roster__toolbar">
              <h2 className="pm-roster__title">รายชื่อผู้ทดสอบ</h2>
              <DataSearch label="ค้นหาผู้ทดสอบ" placeholder="ค้นหาชื่อ อายุ หรือโรคประจำตัว" value={search} onChange={setSearch} />
              <div className="pm-roster__count">
                พบ {filteredPatients.length} จาก {data.patients.length} คน
              </div>
            </div>

            <div className="pm-roster__list" tabIndex={0} role="region" aria-label="เลื่อนรายชื่อผู้ทดสอบ">
              {data.conn === "pending" ? (
                <div className="pm-empty">กำลังโหลดรายชื่อ…</div>
              ) : filteredPatients.length === 0 ? (
                <div className="pm-empty">
                  <IconPatients width={36} height={36} />
                  <strong>{data.patients.length === 0 ? "ยังไม่มีผู้ทดสอบ" : "ไม่พบรายชื่อที่ค้นหา"}</strong>
                  <span>{data.patients.length === 0 ? "กด “เพิ่มผู้ทดสอบ” เพื่อเริ่มต้น" : "ลองใช้คำค้นอื่น"}</span>
                </div>
              ) : (
                filteredPatients.map((patient) => {
                  const resultCount = data.results.filter((result) => result.patientId === patient.id).length;
                  return (
                    <button
                      className={`pm-person ${patient.id === effectiveSelectedId ? "pm-person--active" : ""}`}
                      type="button"
                      key={patient.id}
                      onClick={() => setSelectedId(patient.id)}
                      aria-pressed={patient.id === effectiveSelectedId}
                    >
                      <PatientAvatar gender={patient.gender} />
                      <span className="pm-person__body">
                        <strong>{patient.name}</strong>
                        <span>{patient.age ? `${patient.age} ปี` : "ไม่ระบุอายุ"} · ผลทดสอบ {resultCount} ครั้ง</span>
                      </span>
                      <span className="pm-person__arrow" aria-hidden="true">›</span>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <section className="pm-detail" aria-live="polite">
            {selectedPatient ? (
              <PatientDetail data={data} patient={selectedPatient} onDeleted={() => setSelectedId("")} />
            ) : (
              <div className="pm-detail-empty">
                <IconUser width={48} height={48} />
                <h2>เลือกผู้ทดสอบจากรายชื่อ</h2>
                <p>เมื่อเลือกแล้ว ประวัติการทดสอบของบุคคลนั้นจะแสดงที่นี่</p>
              </div>
            )}
          </section>
        </div>
      </main>

      {addOpen && <PatientDialog data={data} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function PatientDetail({
  data,
  patient,
  onDeleted,
}: {
  data: TugData;
  patient: TugData["patients"][number];
  onDeleted: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const results = data.results.filter((result) => result.patientId === patient.id);
  const completed = results.filter((result) => result.status === "completed");
  const assessments = data.assessments.filter((assessment) => assessment.patientId === patient.id);
  const average = completed.length
    ? completed.reduce((sum, result) => sum + result.totalSec, 0) / completed.length
    : null;
  const latest = completed[0] ?? null;

  const remove = async () => {
    if (!confirm(`ต้องการลบผู้ทดสอบ “${patient.name}” จริงหรือไม่?\nผลเดิมจะไม่ถูกลบ แต่จะยกเลิกการผูกกับรายชื่อนี้`)) return;
    try {
      await data.removePatient(patient.id);
      onDeleted();
    } catch (error) {
      alert(`ลบผู้ทดสอบไม่สำเร็จ: ${(error as Error).message}`);
    }
  };

  return (
    <>
      <div className="pm-profile">
        <div className="pm-profile__identity">
          <PatientAvatar gender={patient.gender} size="large" />
          <div>
            <span className="section-header__eyebrow">ผู้ทดสอบที่เลือก</span>
            <h2>{patient.name}</h2>
            <p>
              {[patient.age ? `${patient.age} ปี` : "", patient.gender].filter(Boolean).join(" · ") || "ไม่ระบุอายุและเพศ"}
            </p>
          </div>
        </div>
        <div className="pm-profile__actions">
          <button className="pm-edit" type="button" onClick={() => setEditOpen(true)}>แก้ไขข้อมูล</button>
          <button className="pm-delete" type="button" onClick={remove}>ลบผู้ทดสอบ</button>
        </div>
      </div>

      <div className="pm-conditions">
        <div className="pm-section-heading">
          <h3>โรคประจำตัวที่บันทึกไว้</h3>
          <span>ข้อมูลประกอบการอ่านผล ไม่ใช่การวินิจฉัย</span>
        </div>
        {patient.conditions.length > 0 ? (
          <div className="pm-condition-tags">
            {patient.conditions.map((condition) => (
              <span key={condition}>{CONDITION_LABEL.get(condition) ?? condition}</span>
            ))}
          </div>
        ) : (
          <p className="pm-muted">ไม่ได้ระบุโรคประจำตัวที่เกี่ยวข้องกับการเดิน</p>
        )}
        {patient.note && <p className="pm-note"><strong>หมายเหตุ:</strong> {patient.note}</p>}
      </div>

      {editOpen && <PatientDialog data={data} patient={patient} onClose={() => setEditOpen(false)} />}

      <div className="pm-stats" aria-label="สรุปผล TUG">
        <div><span>ทดสอบสำเร็จ</span><strong>{completed.length}</strong><small>ครั้ง</small></div>
        <div><span>เวลาเฉลี่ย</span><strong>{average === null ? "-" : average.toFixed(2)}</strong><small>{average === null ? "" : "วินาที"}</small></div>
        <div className={latest ? `pm-stat--${riskClass(riskLevelOf(latest.totalSec))}` : ""}>
          <span>ผลล่าสุด</span>
          <strong>{latest ? riskThai(riskLevelOf(latest.totalSec)) : "-"}</strong>
          <small>{latest ? `${latest.totalSec.toFixed(2)} วินาที` : "ยังไม่มีผล"}</small>
        </div>
      </div>

      <PatientTrendChart results={results} />

      <div className="pm-history">
        <div className="pm-section-heading">
          <h3>ประวัติ TUG</h3>
          <span>{results.length} รายการ</span>
        </div>
        <div className="pm-history__table-wrap" tabIndex={0} role="region" aria-label="เลื่อนประวัติ TUG">
          <table className="pm-history__table">
            <thead>
              <tr><th>วันและเวลา</th><th>รอบ</th><th>ไป</th><th>กลับ</th><th>รวม</th><th>ผล</th></tr>
            </thead>
            <tbody>
              {results.length === 0 ? (
                <tr><td colSpan={6} className="pm-table-empty">ยังไม่มีผล TUG ของผู้ทดสอบคนนี้</td></tr>
              ) : results.map((result) => {
                const level = riskLevelOf(result.totalSec);
                return (
                  <tr key={result.id}>
                    <td data-label="วันและเวลา">{formatThai(result.finishedAt)}</td>
                    <td data-label="รอบ">{result.trialNo || "-"}</td>
                    <td data-label="ไป">{result.checkpointSec > 0 ? result.checkpointSec.toFixed(2) : "-"}</td>
                    <td data-label="กลับ">{result.returnSec > 0 ? result.returnSec.toFixed(2) : "-"}</td>
                    <td data-label="รวม"><strong>{result.totalSec.toFixed(2)} วินาที</strong></td>
                    <td data-label="ผล">
                      {result.status === "aborted"
                        ? <span className="pm-result pm-result--aborted">ยกเลิก</span>
                        : <span className={`pm-result pm-result--${riskClass(level)}`}>{riskThai(level)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="pm-history">
        <div className="pm-section-heading">
          <h3>ประวัติการประเมินการเดินจากกล้อง</h3>
          <span>{assessments.length} รายการ</span>
        </div>
        <div className="pm-history__table-wrap" tabIndex={0} role="region" aria-label="เลื่อนประวัติจากกล้อง">
          <table className="pm-history__table">
            <thead>
              <tr><th>วันและเวลา</th><th>ผลที่ตรวจพบ</th><th>ความมั่นใจ</th><th>จำนวนก้าว</th><th>จังหวะก้าว</th></tr>
            </thead>
            <tbody>
              {assessments.length === 0 ? (
                <tr><td colSpan={5} className="pm-table-empty">ยังไม่มีผลจากกล้องของผู้ทดสอบคนนี้</td></tr>
              ) : assessments.map((assessment) => (
                <tr key={assessment.id}>
                  <td data-label="วันและเวลา">{formatIsoThai(assessment.timestampRaw)}</td>
                  <td data-label="ผลที่ตรวจพบ">{getDiseaseMeta(assessment.condition).th}</td>
                  <td data-label="ความมั่นใจ">{assessment.confidence.toFixed(1)}%</td>
                  <td data-label="จำนวนก้าว">{assessment.stepCount ?? "-"}</td>
                  <td data-label="จังหวะก้าว">{assessment.cadenceAvg === null ? "-" : `${assessment.cadenceAvg.toFixed(1)} ก้าว/นาที`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ฟอร์มเดียวใช้ทั้งเพิ่มและแก้ไข: ช่องที่กรอกเหมือนกันเป๊ะ และการมีฟอร์มแก้ไขคือ
// ทางเดียวที่จะใส่โรคประจำตัวให้คนที่อยู่ในทะเบียนอยู่แล้วได้ - เดิมทำได้แค่ตอนสร้าง
// ใหม่ ซึ่งแปลว่าต้องลบทิ้งแล้วสร้างใหม่ และประวัติผลเดิมจะขาดจากรายชื่อไปด้วย
function PatientDialog({
  data,
  patient,
  onClose,
}: {
  data: TugData;
  patient?: TugData["patients"][number];
  onClose: () => void;
}) {
  const [name, setName] = useState(patient?.name ?? "");
  const [age, setAge] = useState(patient?.age != null ? String(patient.age) : "");
  const [gender, setGender] = useState(patient?.gender ?? "");
  const [note, setNote] = useState(patient?.note ?? "");
  // โรคที่พิมพ์เองถูกเก็บเป็นข้อความดิบปนอยู่ใน array เดียวกับ id มาตรฐาน จึงต้อง
  // แยกกลับตอนเปิดแก้ไข ไม่งั้นข้อความที่พิมพ์เองจะหายไปเงียบ ๆ เมื่อกดบันทึก
  const [conditions, setConditions] = useState<string[]>(
    () => patient?.conditions.filter((id) => CONDITION_LABEL.has(id)) ?? [],
  );
  const [otherCondition, setOtherCondition] = useState(
    () => patient?.conditions.filter((id) => !CONDITION_LABEL.has(id)).join(", ") ?? "",
  );
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const toggleCondition = (id: string) => {
    setConditions((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    // คั่นด้วยจุลภาคได้หลายรายการ เพื่อให้ค่าที่พิมพ์เองไป-กลับระหว่างฟอร์มกับ
    // Firestore ได้ครบ (ตอนเปิดแก้ไขเรา join ด้วย ", " เหมือนกัน)
    const savedConditions = [
      ...conditions,
      ...otherCondition.split(",").map((item) => item.trim()).filter(Boolean),
    ];
    try {
      if (patient) {
        await data.updatePatient(patient.id, {
          name: name.trim(),
          age,
          gender,
          note: note.trim(),
          conditions: savedConditions,
        });
      } else {
        await data.addPatient(name.trim(), age, gender, note.trim(), savedConditions);
      }
      onClose();
    } catch (error) {
      alert(`บันทึกผู้ทดสอบไม่สำเร็จ: ${(error as Error).message}`);
      setSaving(false);
    }
  };

  const groups = ["ระบบประสาท", "กระดูกและข้อ", "การทรงตัว", "หัวใจและปอด"] as const;

  return (
    <div className="pm-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="pm-dialog" role="dialog" aria-modal="true" aria-labelledby="pm-dialog-title" ref={dialogRef}>
        <div className="pm-dialog__header">
          <div>
            <span className="section-header__eyebrow">{patient ? "Edit Patient" : "New Patient"}</span>
            <h2 id="pm-dialog-title">{patient ? "แก้ไขข้อมูลผู้ทดสอบ" : "เพิ่มผู้ทดสอบใหม่"}</h2>
          </div>
          <button ref={closeButtonRef} className="pm-dialog__close" type="button" onClick={onClose} aria-label="ปิดหน้าต่าง">
            <IconClose width={20} height={20} />
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="pm-form__identity">
            <label className="pm-field pm-field--wide">
              <span>ชื่อ-นามสกุล <em>*</em></span>
              <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="เช่น สมชาย ใจดี" />
            </label>
            <label className="pm-field">
              <span>อายุ (ปี)</span>
              <input type="number" min={1} max={150} value={age} onChange={(event) => setAge(event.target.value)} placeholder="65" />
            </label>
            <label className="pm-field">
              <span>เพศ</span>
              <select value={gender} onChange={(event) => setGender(event.target.value)}>
                <option value="">- ไม่ระบุ -</option>
                <option value="ชาย">ชาย</option>
                <option value="หญิง">หญิง</option>
                <option value="อื่นๆ">อื่นๆ</option>
              </select>
            </label>
          </div>

          <fieldset className="pm-condition-fieldset">
            <legend>โรคประจำตัวที่อาจมีผลต่อการเดิน</legend>
            <p className="pm-fieldset-help">เลือกเฉพาะโรคที่ผู้ทดสอบได้รับการวินิจฉัยแล้ว สามารถเลือกได้มากกว่าหนึ่งข้อ</p>
            {groups.map((group) => (
              <div className="pm-condition-group" key={group}>
                <h3>{group}</h3>
                <div className="pm-condition-grid">
                  {CONDITION_OPTIONS.filter((option) => option.group === group).map((option) => (
                    <label className="pm-condition-option" key={option.id}>
                      <input
                        type="checkbox"
                        checked={conditions.includes(option.id)}
                        onChange={() => toggleCondition(option.id)}
                      />
                      <span>
                        <strong>{option.label}</strong>
                        <small>{option.hint}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <label className="pm-field pm-field--other">
              <span>โรคหรือภาวะอื่นที่มีผลต่อการเดิน</span>
              <input value={otherCondition} onChange={(event) => setOtherCondition(event.target.value)} placeholder="พิมพ์เพิ่มเติม (ถ้ามี)" />
            </label>
          </fieldset>

          <label className="pm-field">
            <span>หมายเหตุ</span>
            <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="เช่น ใช้ไม้เท้า ปวดเข่าข้างซ้าย หรือควรมีผู้ดูแลเดินประกบ" />
          </label>

          <p className="pm-medical-note">ข้อมูลนี้ใช้ประกอบการดูผลการเดินเท่านั้น ไม่ใช้แทนการประเมินหรือวินิจฉัยโดยบุคลากรทางการแพทย์</p>

          <div className="pm-dialog__actions">
            <button className="btn btn--ghost" type="button" onClick={onClose}>ยกเลิก</button>
            <button className="btn btn--primary" type="submit" disabled={saving}>
              {saving ? "กำลังบันทึก…" : patient ? "บันทึกการแก้ไข" : "บันทึกผู้ทดสอบ"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
