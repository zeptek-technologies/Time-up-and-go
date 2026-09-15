import { useCallback, useEffect, useRef, useState } from "react";
import CameraView, { type FrameData } from "./CameraView";
import StatusPanel from "./StatusPanel";
import SummaryModal, { type Summary } from "./SummaryModal";
import { GaitSessionRecorder } from "../lib/recorder";
import { uploadAssessment } from "../lib/firebase";
import { useDeviceStatus } from "../hooks/useDeviceStatus";
import { normalizePredictionLabel, type GaitPrediction } from "../lib/classifier";
import { getDiseaseMeta } from "../lib/meta";
import "../camera.css";

const IDLE: GaitPrediction = { status: "No Pose Detected", color: "#f59e0b", reasons: [] };
const IDLE_FRAME: FrameData = { features: null, prediction: IDLE };

// A camera's frame is "live" only if we received one recently - used to tell a
// running side camera apart from one that's off / stalled.
const FRESH_MS = 500;

interface Stamped {
  data: FrameData;
  tMs: number;
}

interface Props {
  activePatientId: string;
  activePatientName: string | null;
}

export default function CameraPage({ activePatientId, activePatientName }: Props) {
  const recorderRef = useRef(new GaitSessionRecorder());
  const recordingRef = useRef(false);
  const frontRef = useRef<Stamped>({ data: IDLE_FRAME, tMs: -Infinity });
  const sideRef = useRef<Stamped>({ data: IDLE_FRAME, tMs: -Infinity });

  const [displayFront, setDisplayFront] = useState<FrameData>(IDLE_FRAME);
  const [displaySide, setDisplaySide] = useState<FrameData>(IDLE_FRAME);
  const [sideLive, setSideLive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [stepCount, setStepCount] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [autoNote, setAutoNote] = useState("");

  // The trial this recording belongs to, captured when the chair says RUNNING.
  // It must be read at the START: the board increments trial_no inside
  // enterCooldown() BEFORE it publishes COOLDOWN, so reading it at the end would
  // stamp the walk with the NEXT round's number and pair it with the wrong result.
  const trialRef = useRef<{ sessionId: string; trialNo: number }>({ sessionId: "", trialNo: 0 });
  // true = รอบนี้เก้าอี้เป็นคนสั่งเริ่ม (เก้าอี้จึงมีสิทธิ์สั่งหยุด)
  // false = เจ้าหน้าที่กดเอง - ห้ามให้เก้าอี้ไปหยุดกลางคัน
  const autoRef = useRef(false);
  const prevChairStateRef = useRef("");
  // sideLive อ่านจากใน callback ที่ไม่ได้ re-create ตาม state จึงต้องมี ref คู่ไว้
  const sideLiveRef = useRef(false);
  // กันอัปโหลดซ้อน: ปุ่มกับ "เก้าอี้สั่งจบ" เรียก finishAndUpload คนละทาง และ state
  // uploading กว่าจะ re-render ก็ช้าเกินกันคลิกรัวหรือคลิกชนกับ auto-flow
  const uploadingRef = useRef(false);

  const chair = useDeviceStatus("chair");

  const handleFront = useCallback((data: FrameData) => {
    frontRef.current = { data, tMs: performance.now() };
  }, []);
  const handleSide = useCallback((data: FrameData) => {
    sideRef.current = { data, tMs: performance.now() };
  }, []);

  // Drive display + fusion at ~10 Hz. Pairing the two independent camera streams
  // on a fixed tick (rather than per-frame) avoids the fps-mismatch sync problem.
  useEffect(() => {
    const id = setInterval(() => {
      const now = performance.now();
      const frontLive = now - frontRef.current.tMs < FRESH_MS;
      const side = now - sideRef.current.tMs < FRESH_MS;

      setDisplayFront(frontLive ? frontRef.current.data : IDLE_FRAME);
      setDisplaySide(side ? sideRef.current.data : IDLE_FRAME);
      setSideLive(side);
      sideLiveRef.current = side;

      if (recordingRef.current) {
        recorderRef.current.recordFused(
          frontLive ? frontRef.current.data : null,
          side ? sideRef.current.data : null,
        );
        setFrameCount(recorderRef.current.totalFrames);
        setStepCount(recorderRef.current.sessionSteps);
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  const toggleRecording = () => {
    const starting = !recorderRef.current.isRecording;
    recorderRef.current.toggle();
    recordingRef.current = recorderRef.current.isRecording;
    autoRef.current = false; // taken over by hand - the chair must not stop it
    // จดเลขรอบเฉพาะตอน "เริ่ม" เท่านั้น ด้วยเหตุผลเดียวกับที่อธิบายไว้ที่ trialRef:
    // ระหว่างที่บันทึกอยู่ เก้าอี้อาจจบรอบและบวก trial_no ไปแล้ว การจดตอนกดหยุดจึง
    // แสตมป์ผลกล้องเป็นรอบถัดไป แล้วไปโผล่คู่กับผล TUG ของรอบหน้าแทน
    if (starting) {
      trialRef.current = { sessionId: chair.sessionId, trialNo: chair.trialNo };
      setUploaded(false);
    }
    setRecording(recorderRef.current.isRecording);
    setFrameCount(recorderRef.current.totalFrames);
    setStepCount(recorderRef.current.sessionSteps);
  };

  const finishAndUpload = useCallback(async () => {
    if (uploadingRef.current) return;
    recorderRef.current.stop();
    recordingRef.current = false;
    autoRef.current = false;
    setRecording(false);

    // ไม่มีเฟรมที่ประเมินได้เลย = กล้องเปิดอยู่แต่ไม่เห็นคน (อยู่นอกภาพกล้อง/มืดเกินไป)
    // ห้ามอัปโหลด: recorder.result() จะคืน "No Data" ซึ่งจอสถานะอ่านเป็น "ปกติ"
    // เพราะ normalizePredictionLabel ตีทุกป้ายที่ไม่รู้จักเป็น Normal - กลายเป็น
    // รายงานว่าเดินปกติทั้งที่ไม่เคยวัดอะไรได้เลย
    if (recorderRef.current.totalFrames === 0) {
      setAutoNote("รอบนี้กล้องจับท่าเดินไม่ได้ (ผู้ทดสอบอาจอยู่นอกภาพกล้อง) - ไม่ได้ส่งผลขึ้นระบบ");
      return;
    }

    uploadingRef.current = true;
    setUploading(true);
    const outcome = await uploadAssessment(recorderRef.current, {
      patientId: activePatientId,
      cameraMode: sideLiveRef.current ? "front+side" : "front",
      sessionId: trialRef.current.sessionId,
      trialNo: trialRef.current.trialNo,
    });
    const r = recorderRef.current.result();
    setSummary({
      highestRisk: r.highestRisk,
      riskPercentage: r.riskPercentage,
      totalFrames: recorderRef.current.totalFrames,
      riskScores: { ...recorderRef.current.riskScores },
      stepCount: recorderRef.current.sessionSteps,
      cadenceAvg: recorderRef.current.avgCadence,
      stepTimeCvAvg: recorderRef.current.avgStepTimeVariability,
      uploadStatus: outcome.status,
      documentId: outcome.documentId,
    });
    setUploading(false);
    uploadingRef.current = false;
    // ส่งสำเร็จแล้วล็อกปุ่มไว้ - กดซ้ำจะได้ doc ที่สอง session_id/trial_no เดียวกัน
    // แล้วจอสถานะ (assessmentForTrial ใช้ find) จะหยิบตัวไหนก็ได้
    setUploaded(!!outcome.documentId);
    // รายละเอียด error เป็นภาษาเทคนิค (อังกฤษ) - เก็บไว้ใน console ให้ผู้พัฒนา หน้าจอบอกแค่สิ่งที่ต้องทำ
    if (!outcome.documentId) console.warn("[uploadAssessment]", outcome.status);
    setAutoNote(
      outcome.documentId
        ? `ส่งผลรอบที่ ${trialRef.current.trialNo || "?"} เข้าระบบแล้ว - ดูสรุปได้ที่จอสถานะ`
        : "ส่งผลไม่สำเร็จ ลองกด “จบและส่งผล” อีกครั้ง",
    );
  }, [activePatientId]);

  // ── กล้องเดินตามเก้าอี้ ──
  // เก้าอี้เป็นคนบอกว่ารอบเริ่มและจบเมื่อไร (ผ่าน device_status/chair.state) กล้องจึง
  // ไม่ต้องมีใครกดปุ่ม: ลุก = RUNNING → เริ่มบันทึก, กลับมานั่ง = ออกจาก RETURNING → หยุด+อัปโหลด
  //
  // ผูก callback ล่าสุดไว้ใน ref เพื่อให้ effect นี้ subscribe แค่ "สถานะเก้าอี้" อย่างเดียว
  // ถ้าใส่ finishAndUpload ลงใน deps ตรง ๆ effect จะรันใหม่ทุกครั้งที่เปลี่ยนผู้ทดสอบ
  // แล้วตัวจับ transition (prevChairStateRef) จะรวน
  //
  // อัปเดตใน effect ไม่ใช่ระหว่าง render (React ห้ามแตะ ref ตอน render) และต้อง
  // ประกาศ effect นี้ "ก่อน" effect ที่เฝ้าเก้าอี้ เพื่อให้ ref ถูกอัปเดตก่อนเสมอ
  // ในคอมมิตที่ทั้ง finishAndUpload และ chair.state เปลี่ยนพร้อมกัน
  const finishRef = useRef(finishAndUpload);
  useEffect(() => {
    finishRef.current = finishAndUpload;
  }, [finishAndUpload]);

  useEffect(() => {
    const state = (chair.state || "").toUpperCase();
    const prev = prevChairStateRef.current;
    if (state === prev) return;
    prevChairStateRef.current = state;

    // ครั้งแรกที่ได้ยินจากบอร์ด (prev ว่าง) แค่จำสถานะไว้ ห้ามทำอะไร ไม่งั้นการเปิดหน้า
    // ตอนบอร์ดค้างอยู่ที่ COOLDOWN จะกลายเป็นการอัปโหลดผลเปล่า ๆ ทันทีที่โหลดหน้า
    if (!prev || !chair.online) return;

    const inTest = (s: string) => s === "RUNNING" || s === "RETURNING";

    if (state === "RUNNING" && !recordingRef.current) {
      const now = performance.now();
      const frontLive = now - frontRef.current.tMs < FRESH_MS;
      const sideNow = now - sideRef.current.tMs < FRESH_MS;
      if (!frontLive && !sideNow) {
        setAutoNote("ผู้ทดสอบเริ่มเดินแล้ว แต่ยังไม่ได้เปิดกล้อง - รอบนี้จะไม่มีผลวิเคราะห์ท่าเดิน");
        return;
      }
      trialRef.current = { sessionId: chair.sessionId, trialNo: chair.trialNo };
      recorderRef.current.start();
      recordingRef.current = true;
      autoRef.current = true;
      setRecording(true);
      setFrameCount(0);
      setStepCount(0);
      setSummary(null);
      setUploaded(false);
      setAutoNote(`เริ่มบันทึกอัตโนมัติ - รอบที่ ${chair.trialNo || "?"}`);
      return;
    }

    // จบรอบ = ออกจากช่วงทดสอบ (นั่งลง → COOLDOWN หรือถูกยกเลิก/หมดเวลา)
    if (autoRef.current && inTest(prev) && !inTest(state)) {
      setAutoNote("จบรอบ - กำลังส่งผลวิเคราะห์ท่าเดิน");
      void finishRef.current();
    }
  }, [chair.state, chair.online, chair.sessionId, chair.trialNo]);

  const canUpload = frameCount > 0 && !uploaded;

  return (
    <div className="gc-page2">
      <div className="gc-cams">
        <CameraView view="front" label="กล้องด้านหน้า" onFrame={handleFront} />
        <CameraView view="side" label="กล้องด้านข้าง" onFrame={handleSide} />
      </div>

      <div className="gc-side">
        <div className="gc-controls">
          <div className="gc-controls__patient">
            ผู้ทดสอบ: <strong>{activePatientName ?? "ไม่ระบุ (เลือกได้ในเมนู ผู้ทดสอบ)"}</strong>
          </div>

          <div className={`gc-auto gc-auto--${chair.online ? "on" : "off"}`}>
            {chair.online
              ? "เชื่อมกับเก้าอี้แล้ว - เปิดกล้องค้างไว้ ระบบจะเริ่มบันทึกเองเมื่อผู้ทดสอบลุก"
              : "ยังไม่พบเก้าอี้ - ใช้ปุ่มด้านล่างบันทึกเองได้ตามปกติ"}
          </div>
          {autoNote && <div className="gc-auto__note">{autoNote}</div>}

          <button className={`gc-btn ${recording ? "gc-btn--danger" : "gc-btn--primary"}`} onClick={toggleRecording}>
            {recording ? `■ หยุดบันทึก (${frameCount})` : "● เริ่มบันทึก"}
          </button>
          <button className="gc-btn" onClick={() => void finishAndUpload()} disabled={!canUpload || uploading}>
            {uploading ? "กำลังส่งผล…" : uploaded ? "ส่งผลรอบนี้แล้ว" : "จบและส่งผล"}
          </button>
          {recording && (
            <span className="gc-rec">
              <span className="gc-rec__dot" />กำลังบันทึก · {frameCount} ภาพ · {stepCount} ก้าว
            </span>
          )}
        </div>

        <FusionPanel front={displayFront.prediction} side={displaySide.prediction} sideLive={sideLive} />

        <StatusPanel features={displayFront.features} prediction={displayFront.prediction} />
      </div>

      {summary && <SummaryModal summary={summary} onClose={() => setSummary(null)} />}
    </div>
  );
}

/** Shows what each camera sees and whether they confirm each other. */
function FusionPanel({ front, side, sideLive }: { front: GaitPrediction; side: GaitPrediction; sideLive: boolean }) {
  const fLabel = normalizePredictionLabel(front.status);
  const sLabel = normalizePredictionLabel(side.status);
  const th = (l: string) => getDiseaseMeta(l).th;

  let verdict: { text: string; cls: string };
  if (!sideLive) {
    verdict = { text: "ใช้กล้องเดียว (ด้านหน้า)", cls: "single" };
  } else if (fLabel === sLabel) {
    verdict =
      fLabel === "Normal"
        ? { text: "ตรงกัน: ปกติ", cls: "agree-normal" }
        : { text: `ยืนยันตรงกัน: ${th(fLabel)}`, cls: "agree-risk" };
  } else if (fLabel === "Hemiplegic") {
    verdict = { text: `ยืนยันจากกล้องหน้า: ${th("Hemiplegic")}`, cls: "agree-risk" };
  } else {
    verdict = { text: "สองกล้องยังไม่ยืนยันตรงกัน", cls: "disagree" };
  }

  return (
    <div className="gc-fusion">
      <div className="gc-fusion__cams">
        <span>หน้า: <b>{th(fLabel)}</b></span>
        <span>ข้าง: <b>{sideLive ? th(sLabel) : "-"}</b></span>
      </div>
      <div className={`gc-fusion__verdict gc-fusion__verdict--${verdict.cls}`}>{verdict.text}</div>
    </div>
  );
}
