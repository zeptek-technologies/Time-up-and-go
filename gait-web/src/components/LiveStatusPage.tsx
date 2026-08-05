import { useEffect, useMemo, useState } from "react";
import { useDeviceStatus } from "../hooks/useDeviceStatus";
import {
  ensureAuth,
  subscribeResults,
  type TugResult,
} from "../lib/firebase";
import { effectiveChairState } from "../lib/liveStage";
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

function resultForCurrentTrial(
  results: TugResult[],
  sessionId: string,
  nextTrialNo: number,
): TugResult | null {
  if (!sessionId || nextTrialNo < 2) return null;
  return (
    results.find(
      (result) =>
        result.status === "completed" &&
        result.sessionId === sessionId &&
        result.trialNo === nextTrialNo - 1,
    ) ?? null
  );
}

export default function LiveStatusPage() {
  const chair = useDeviceStatus("chair");
  const checkpoint = useDeviceStatus("checkpoint");
  const [results, setResults] = useState<TugResult[]>([]);
  const [resultConnection, setResultConnection] = useState<"pending" | "online" | "error">("pending");

  useEffect(() => {
    let unsubscribe = () => {};
    let cancelled = false;

    ensureAuth().then((ok) => {
      if (cancelled) return;
      if (!ok) {
        setResultConnection("error");
        return;
      }
      unsubscribe = subscribeResults(
        (rows) => {
          setResults(rows);
          setResultConnection("online");
        },
        () => setResultConnection("error"),
      );
    });

    return () => {
      cancelled = true;
      unsubscribe();
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
  const checkpointConnected =
    chair.online && (chair.checkpointOnline || checkpoint.online || liveChairState === "RUNNING");

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

        <div className="live-links" aria-label="สถานะการเชื่อมต่อ">
          <span className={`live-link ${chair.online ? "live-link--online" : "live-link--offline"}`}>
            <i aria-hidden="true" /> ESP32 {chair.online ? "ออนไลน์" : "ออฟไลน์"}
          </span>
          <span className={`live-link ${checkpointConnected ? "live-link--online" : "live-link--offline"}`}>
            <i aria-hidden="true" /> Checkpoint {checkpointConnected ? "เชื่อมต่อแล้ว" : "ไม่เชื่อมต่อ"}
          </span>
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

      <footer className="live-footer">
        <p>ผลนี้เป็นการคัดกรองเบื้องต้น ไม่ใช่การวินิจฉัยทางการแพทย์</p>
      </footer>
    </main>
  );
}
