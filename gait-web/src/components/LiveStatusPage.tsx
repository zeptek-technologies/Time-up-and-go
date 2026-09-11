import { useEffect, useMemo, useState } from "react";
import DeviceStatusChip from "./DeviceStatusChip";
import { useDeviceStatus } from "../hooks/useDeviceStatus";
import {
  ensureAuth,
  subscribeActiveSubject,
  subscribeGaitAssessments,
  subscribePatients,
  subscribeResults,
  type ActiveSubject,
  type GaitAssessment,
  type Patient,
  type TugResult,
} from "../lib/firebase";
import { storedGaitLabel } from "../lib/classifier";
import { conditionLabel } from "../lib/conditions";
import { assessmentForTrial, effectiveChairState, resultForCurrentTrial } from "../lib/liveStage";
import { getDiseaseMeta } from "../lib/meta";
import { assessConsistency } from "../lib/riskContext";
import { riskLevelOf, type RiskLevel } from "../lib/tugRisk";
import "../live-status.css";

type StageKey =
  | "connecting"
  | "offline"
  | "preparing"
  | "waiting"
  | "ready"
  | "walking"
  | "checkpoint"
  | "complete";

type Stage = {
  key: StageKey;
  step: number;
  eyebrow: string;
  title: string;
  instruction: string;
  detail: string;
};

const FLOW = [
  { label: "พร้อม", short: "เตรียมลุก" },
  { label: "กำลังเดิน", short: "ไป Checkpoint" },
  { label: "ผ่าน Checkpoint", short: "เดินกลับ" },
  { label: "เสร็จสิ้น", short: "ดูผล" },
];

const RISK_LABEL: Record<RiskLevel, string> = {
  LOW: "ความเสี่ยงต่ำ",
  MODERATE: "ความเสี่ยงปานกลาง",
  HIGH: "ความเสี่ยงสูง",
};

function stageFrom(state: string, known: boolean, online: boolean): Stage {
  if (!known) {
    return {
      key: "connecting",
      step: -1,
      eyebrow: "กำลังเชื่อมต่อ",
      title: "กำลังค้นหาอุปกรณ์",
      instruction: "กรุณารอสักครู่",
      detail: "หน้าเว็บกำลังเชื่อมต่อ Firebase และรอข้อมูลจาก ESP32",
    };
  }

  if (!online) {
    return {
      key: "offline",
      step: -1,
      eyebrow: "การเชื่อมต่อขาดหาย",
      title: "ESP32 ออฟไลน์",
      instruction: "ตรวจไฟเลี้ยงและการเชื่อมต่อ Wi-Fi",
      detail: "เมื่ออุปกรณ์กลับมาออนไลน์ หน้านี้จะอัปเดตให้อัตโนมัติ",
    };
  }

  switch (state.toUpperCase()) {
    case "CALIBRATE":
      return {
        key: "preparing",
        step: -1,
        eyebrow: "กำลังเตรียมระบบ",
        title: "กำลังปรับตั้งอุปกรณ์",
        instruction: "อย่าเพิ่งเริ่มทดสอบ",
        detail: "วางพื้นที่รอบเก้าอี้ให้โล่ง แล้วรอจนหน้าจอแสดงคำว่า “พร้อม”",
      };
    case "WAIT_SIT":
      return {
        key: "waiting",
        step: -1,
        eyebrow: "เตรียมผู้ทดสอบ",
        title: "รอผู้ทดสอบนั่ง",
        instruction: "ให้นั่งบนเก้าอี้ในท่าเริ่มต้น",
        detail: "วางเท้าบนพื้นและเตรียมเส้นทางเดินให้เรียบร้อย",
      };
    case "READY":
      return {
        key: "ready",
        step: 0,
        eyebrow: "พร้อมเริ่มทดสอบ",
        title: "พร้อม",
        instruction: "พร้อมแล้ว ให้ลุกเดินได้เลย",
        detail: "ลุกจากเก้าอี้และเดินตรงไปยังจุด Checkpoint",
      };
    case "RUNNING":
      return {
        key: "walking",
        step: 1,
        eyebrow: "กำลังจับเวลา",
        title: "กำลังเดิน",
        instruction: "เดินตรงไปยังจุด Checkpoint",
        detail: "เดินด้วยความเร็วตามปกติ ไม่ต้องรีบ",
      };
    case "RETURNING":
      return {
        key: "checkpoint",
        step: 2,
        eyebrow: "ผ่านจุด Checkpoint แล้ว",
        title: "ผ่านจุด Checkpoint แล้ว",
        instruction: "เดินกลับไปที่เก้าอี้",
        detail: "เดินกลับด้วยความเร็วตามปกติ แล้วนั่งลงให้เรียบร้อย",
      };
    case "COOLDOWN":
      return {
        key: "complete",
        step: 3,
        eyebrow: "บันทึกผลแล้ว",
        title: "เสร็จสิ้น",
        instruction: "การทดสอบเสร็จเรียบร้อย",
        detail: "กรุณานั่งพัก และดูผลประเมินด้านล่าง",
      };
    default:
      return {
        key: "waiting",
        step: -1,
        eyebrow: "อุปกรณ์ออนไลน์",
        title: "รอเริ่มการทดสอบ",
        instruction: "กรุณาเตรียมผู้ทดสอบ",
        detail: "หน้านี้จะเปลี่ยนสถานะอัตโนมัติเมื่อ ESP32 เริ่มทำงาน",
      };
  }
}

export default function LiveStatusPage() {
  const chair = useDeviceStatus("chair");
  const checkpoint = useDeviceStatus("checkpoint");
  const [results, setResults] = useState<TugResult[]>([]);
  const [assessments, setAssessments] = useState<GaitAssessment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [subject, setSubject] = useState<ActiveSubject>({ patientId: "", patientName: "", sessionId: "" });
  const [resultConnection, setResultConnection] = useState<"pending" | "online" | "error">("pending");

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    let cancelled = false;

    ensureAuth().then((ok) => {
      if (cancelled) return;
      if (!ok) {
        setResultConnection("error");
        return;
      }
      unsubs.push(
        subscribeResults(
          (rows) => {
            setResults(rows);
            setResultConnection("online");
          },
          () => setResultConnection("error"),
        ),
        // ผลกล้อง + โรคประจำตัว: หน้านี้เป็นคนละเพจกับแท็บกล้อง จึงรับทุกอย่างผ่าน
        // Firestore เหมือนกันหมด ไม่มี state ที่แชร์กันได้ตรง ๆ
        subscribeGaitAssessments(setAssessments, (e) => console.error("[Assessments]", e.message)),
        subscribePatients(setPatients, (e) => console.error("[Patients]", e.message)),
        subscribeActiveSubject(setSubject, (e) => console.error("[ActiveSubject]", e.message)),
      );
    });

    return () => {
      cancelled = true;
      unsubs.forEach((fn) => fn());
    };
  }, []);

  const liveChairState = effectiveChairState(chair.state, checkpoint);
  const stage = stageFrom(liveChairState, chair.known, chair.online);
  const result = useMemo(
    () => resultForCurrentTrial(results, chair.sessionId, chair.trialNo),
    [results, chair.sessionId, chair.trialNo],
  );
  const risk = result ? riskLevelOf(result.totalSec) : null;
  const passed = risk === "LOW";

  // ผลกล้องของรอบเดียวกัน + โรคประจำตัวของคนที่เจ้าหน้าที่เลือกไว้บนแดชบอร์ด
  const assessment = useMemo(() => assessmentForTrial(assessments, result), [assessments, result]);
  const patient = useMemo(
    () => patients.find((p) => p.id === (result?.patientId || subject.patientId)) ?? null,
    [patients, result, subject.patientId],
  );
  // ยึด identity เดิมไว้ ไม่งั้น array ใหม่ทุก render จะทำให้ useMemo ข้างล่างไม่มีผล
  const conditions = useMemo(() => patient?.conditions ?? [], [patient]);

  // null = รอบนั้นไม่มีผลกล้องที่ใช้ได้ (ไม่มีเอกสาร หรือเป็นเอกสาร "No Data")
  const cameraLabel = assessment ? storedGaitLabel(assessment.condition) : null;
  // recorder จะรายงาน "Normal" เมื่อไม่มีรูปแบบผิดปกติใดผ่านเกณฑ์ RISK_MIN_SHARE
  // ดังนั้น flagged = ป้ายที่ได้ไม่ใช่ Normal
  const cameraFlagged = cameraLabel !== null && cameraLabel !== "Normal";
  const consistency = useMemo(
    () => assessConsistency(cameraLabel, cameraFlagged, conditions),
    [cameraLabel, cameraFlagged, conditions],
  );

  return (
    <main className={`live-page live-page--${stage.key}`}>
      <header className="live-header">
        <a className="live-brand" href="/" aria-label="กลับไปหน้า TUG Care Board">
          <span className="live-brand__mark" aria-hidden="true">
            <svg viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="30" fill="currentColor" opacity="0.15" />
              <path d="M28 16h8v12h12v8H36v12h-8V36H16v-8h12V16z" fill="currentColor" />
            </svg>
          </span>
          <span>
            <strong>TUG Care Board</strong>
            <small>จอแสดงสถานะการทดสอบ</small>
          </span>
        </a>

        {/* ใช้การ์ดตัวเดียวกับหน้าหลัก เพื่อให้ชื่อบอร์ด สถานะ และเวลาที่อัปเดตล่าสุด
            ตรงกันทั้งสองหน้า — รวมถึงสถานะ "กำลังทดสอบ" ของจุดหมุนตัว ที่หน้านี้เคย
            แสดงเป็น "ไม่เชื่อมต่อ" ทั้งที่เป็นพฤติกรรมปกติของบอร์ดระหว่างจับเวลา */}
        <div className="live-links" aria-label="สถานะการเชื่อมต่อ">
          <DeviceStatusChip deviceId="chair" />
          <DeviceStatusChip deviceId="checkpoint" />
        </div>
      </header>

      <section className="live-stage" aria-live="polite" aria-atomic="true">
        <div className="live-stage__signal" aria-hidden="true">
          <span />
        </div>
        <div className="live-stage__copy">
          <p className="live-stage__eyebrow">{stage.eyebrow}</p>
          <h1>{stage.title}</h1>
          <div className="live-instruction">
            <span>ขั้นตอนต่อไป</span>
            <h2>{stage.instruction}</h2>
            <p>{stage.detail}</p>
          </div>
        </div>
      </section>

      <ol className="live-progress" aria-label="ขั้นตอนการทดสอบ">
        {FLOW.map((item, index) => {
          const state = stage.step === index ? "current" : stage.step > index ? "done" : "upcoming";
          return (
            <li className={`live-progress__step live-progress__step--${state}`} key={item.label}>
              <span className="live-progress__number" aria-hidden="true">
                {state === "done" ? "✓" : index + 1}
              </span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.short}</small>
              </span>
            </li>
          );
        })}
      </ol>

      {stage.key === "complete" && (
        <section
          className={`live-result ${result ? (passed ? "live-result--pass" : "live-result--review") : "live-result--pending"}`}
          aria-live="polite"
        >
          {result ? (
            <>
              <div>
                <span className="live-result__label">ผลตามเกณฑ์เวลา TUG</span>
                <h2>{passed ? "ผ่านเกณฑ์เวลา" : "ไม่ผ่านเกณฑ์เวลา"}</h2>
                <p>{RISK_LABEL[risk!]}</p>
              </div>
              <div className="live-result__time">
                <strong>{result.totalSec.toFixed(2)}</strong>
                <span>วินาที</span>
              </div>
            </>
          ) : (
            <div>
              <span className="live-result__label">ผลตามเกณฑ์เวลา TUG</span>
              <h2>{resultConnection === "error" ? "รับผลไม่สำเร็จ" : "กำลังรับผลประเมิน…"}</h2>
              <p>กรุณารอสักครู่ ไม่ต้องเริ่มรอบใหม่</p>
            </div>
          )}
        </section>
      )}

      {/* สามแหล่งข้อมูลวางไว้ข้างกัน ไม่ยุบเป็นคะแนนเดียว — การรวมประวัติโรคเข้ากับ
          ผลวัดให้เป็นระดับความเสี่ยงตัวเดียวคือการตัดสินทางคลินิก ที่ทำได้คือบอกว่า
          สองแหล่งสอดคล้องกันไหม แล้วให้เจ้าหน้าที่เป็นคนตัดสิน */}
      {stage.key === "complete" && result && (
        <section className="live-detail" aria-live="polite">
          <article className="live-detail__card">
            <span className="live-detail__label">ผู้ทดสอบ</span>
            <strong>{patient?.name ?? subject.patientName ?? "ไม่ระบุ"}</strong>
            <p>
              {result.trialNo ? `รอบที่ ${result.trialNo}` : "—"}
              {result.checkpointSec > 0 && ` · ขาไป ${result.checkpointSec.toFixed(1)} วิ`}
              {result.returnSec > 0 && ` · ขากลับ ${result.returnSec.toFixed(1)} วิ`}
            </p>
          </article>

          <article className="live-detail__card">
            <span className="live-detail__label">กล้องวิเคราะห์ท่าเดิน</span>
            {assessment && cameraLabel ? (
              <>
                <strong>{getDiseaseMeta(cameraLabel).th}</strong>
                <p>
                  {cameraFlagged ? `พบใน ${assessment.confidence.toFixed(0)}% ของช่วงที่วิเคราะห์ได้` : "ไม่พบรูปแบบผิดปกติที่ชัดเจน"}
                  {assessment.stepCount !== null && ` · ${assessment.stepCount} ก้าว`}
                </p>
              </>
            ) : (
              <>
                <strong className="live-detail__muted">ไม่มีผล</strong>
                <p>
                  {assessment
                    ? "กล้องบันทึกรอบนี้ไว้ แต่จับท่าเดินไม่ได้ (ผู้ทดสอบอาจอยู่นอกเฟรม)"
                    : "รอบนี้กล้องไม่ได้บันทึก (ยังไม่ได้เปิดกล้อง หรือเปิดหลังผู้ทดสอบลุกแล้ว)"}
                </p>
              </>
            )}
          </article>

          <article className="live-detail__card">
            <span className="live-detail__label">โรคประจำตัวที่บันทึกไว้</span>
            {conditions.length > 0 ? (
              <ul className="live-detail__tags">
                {conditions.map((id) => (
                  <li key={id} className={consistency.matched.includes(id) ? "is-matched" : ""}>
                    {conditionLabel(id)}
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <strong className="live-detail__muted">ไม่มีบันทึก</strong>
                <p>เพิ่มได้ที่หน้าจัดการผู้ทดสอบ เพื่อให้อ่านผลได้ตรงบริบทมากขึ้น</p>
              </>
            )}
          </article>

          <article className={`live-verdict live-verdict--${consistency.key}`}>
            <span className="live-detail__label">สรุปความสอดคล้อง</span>
            <strong>{consistency.headline}</strong>
            <p>{consistency.detail}</p>
          </article>
        </section>
      )}

      <footer className="live-footer">
        <p>ผลนี้เป็นการคัดกรองเบื้องต้น ไม่ใช่การวินิจฉัยทางการแพทย์</p>
      </footer>
    </main>
  );
}
