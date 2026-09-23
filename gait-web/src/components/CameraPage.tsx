import { useCallback, useEffect, useRef, useState } from "react";
import CameraView, { type FrameData } from "./CameraView";
import StatusPanel from "./StatusPanel";
import SummaryModal, { type Summary } from "./SummaryModal";
import { GaitSessionRecorder } from "../lib/recorder";
import { publishCameraStatus, saveCameraTiming, uploadAssessment, type CameraPhase } from "../lib/firebase";
import { CameraTugTimer, type TimerEvent, type TimerPhase } from "../lib/cameraTugTimer";
import type { PostureSample } from "../lib/postureDetector";
import { useDeviceStatus } from "../hooks/useDeviceStatus";
import { useTimingSource } from "../hooks/useTimingSource";
import { normalizePredictionLabel, type GaitPrediction } from "../lib/classifier";
import { getDiseaseMeta } from "../lib/meta";
import "../camera.css";

const IDLE: GaitPrediction = { status: "No Pose Detected", color: "#f59e0b", reasons: [] };
const IDLE_FRAME: FrameData = { features: null, prediction: IDLE };

// A camera's frame is "live" only if we received one recently - used to tell a
// running side camera apart from one that's off / stalled.
const FRESH_MS = 500;
// กล้องข้างไม่ส่งภาพนานเท่านี้ = ปิด/หลุดจริง (ไม่ใช่แค่เฟรมสะดุด) → ล้างตัวจับเวลา
const SIDE_LOST_MS = 3000;
// ส่งสถานะให้จอสถานะ: ถี่ขณะจับเวลา (ตัวเลขเดิน) ห่างตอนว่าง (ประหยัดโควตาการเขียน)
const PUBLISH_RUNNING_MS = 1000;
const PUBLISH_IDLE_MS = 10000;

// ใครเป็นคนสั่งเริ่มบันทึกรอบนี้ — มีสิทธิ์สั่งจบเฉพาะคนที่สั่งเริ่ม ไม่งั้นกล้องกับเก้าอี้
// จะสั่งจบซ้อนกันแล้วส่งผลวิเคราะห์ท่าเดินซ้ำสองชุด
type RecordingOwner = "camera" | "chair" | "manual" | null;

const TIMER_HEADLINE: Record<TimerPhase, string> = {
  waiting: "รอผู้ทดสอบนั่งให้กล้องเห็นเต็มตัว",
  ready: "นั่งพร้อมแล้ว - ลุกได้เลย",
  running: "กำลังจับเวลา",
  cooldown: "พักก่อนรอบถัดไป",
};

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
  const ownerRef = useRef<RecordingOwner>(null);

  // ── ตัวจับเวลาจากกล้องด้านข้าง ──
  const timerRef = useRef(new CameraTugTimer());
  const [timerPhase, setTimerPhase] = useState<TimerPhase>("waiting");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastDurationMs, setLastDurationMs] = useState(0);
  // เวลาเริ่มของรอบ (ฐาน performance.now) ใช้แสดงตัวเลขที่เดินอยู่
  const runStartRef = useRef<number | null>(null);
  // ข้อมูลของรอบที่ต้องใช้ตอนบันทึก — จดตอน "เริ่ม" เพราะเก้าอี้บวกเลขรอบทันทีที่จบ
  const runMetaRef = useRef<{ startedAtMs: number; sessionId: string; trialNo: number; subjectKey: string } | null>(null);
  const lastDurationRef = useRef(0);
  const lastPublishRef = useRef<{ phase: CameraPhase | ""; at: number }>({ phase: "", at: 0 });
  const timerEventRef = useRef<(ev: TimerEvent) => void>(() => {});
  const prevChairStateRef = useRef("");
  // sideLive อ่านจากใน callback ที่ไม่ได้ re-create ตาม state จึงต้องมี ref คู่ไว้
  const sideLiveRef = useRef(false);
  // กันอัปโหลดซ้อน: ปุ่มกับ "เก้าอี้สั่งจบ" เรียก finishAndUpload คนละทาง และ state
  // uploading กว่าจะ re-render ก็ช้าเกินกันคลิกรัวหรือคลิกชนกับ auto-flow
  const uploadingRef = useRef(false);

  const chair = useDeviceStatus("chair");

  // แหล่งจับเวลาที่เลือกในหน้าตั้งค่าอุปกรณ์ — โหมดฮาร์ดแวร์ กล้องใช้บันทึกท่าเดินอย่างเดียว
  const { source: timingSource } = useTimingSource();
  const cameraTiming = timingSource === "camera";
  const cameraTimingRef = useRef(cameraTiming);

  const handleFront = useCallback((data: FrameData) => {
    frontRef.current = { data, tMs: performance.now() };
  }, []);
  const handleSide = useCallback((data: FrameData) => {
    sideRef.current = { data, tMs: performance.now() };
  }, []);
  // ท่าทางทุกเฟรมจากกล้องข้าง → ตัวจับเวลา (ทำงานตามอัตราเฟรม ไม่แตะ React state
  // จนกว่าจะมีเหตุการณ์ ซึ่งเกิดไม่กี่ครั้งต่อรอบ)
  const handleSidePose = useCallback((sample: PostureSample) => {
    if (!cameraTimingRef.current) return;
    const ev = timerRef.current.push(sample);
    if (ev) timerEventRef.current(ev);
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

      // ── ตัวจับเวลาจากกล้อง ──
      const timer = timerRef.current;
      if (now - sideRef.current.tMs > SIDE_LOST_MS && timer.phase !== "waiting") {
        // กล้องข้างหยุดส่งภาพกลางคัน (ปิดกล้อง/หลุด) — รอบนี้จบด้วยกล้องไม่ได้แล้ว
        const wasRunning = timer.phase === "running";
        timer.reset();
        if (wasRunning) timerEventRef.current({ type: "abort", reason: "กล้องด้านข้างหยุดส่งภาพ" });
      }
      const running = timer.phase === "running" && runStartRef.current !== null;
      const elapsed = running ? now - runStartRef.current! : 0;
      setTimerPhase(timer.phase);
      setElapsedMs(elapsed);

      // โหมดฮาร์ดแวร์ = "off" จอสถานะจะไม่เอาสถานะกล้องไปใช้
      // โหมดกล้องส่งสถานะเสมอเมื่อเปิดหน้านี้ไว้ จอสถานะจะได้บอกว่าต้องแก้อะไร แทนการไปรอฮาร์ดแวร์
      const phase: CameraPhase = !cameraTimingRef.current
        ? "off"
        : document.hidden
          ? "hidden"
          : side
            ? timer.phase
            : "no_side";
      const last = lastPublishRef.current;
      const gap = phase === "running" ? PUBLISH_RUNNING_MS : PUBLISH_IDLE_MS;
      if (phase !== last.phase || (phase !== "off" && now - last.at >= gap)) {
        lastPublishRef.current = { phase, at: now };
        publishCameraStatus(phase, elapsed, lastDurationRef.current, timer.cooldownLeftMs(now)).catch((err) =>
          console.warn("[publishCameraStatus]", err),
        );
      }
    }, 100);
    // สลับแท็บ/ย่อหน้าต่าง: ส่งสถานะทันทีในรอบถัดไป ไม่ต้องรอรอบส่งตอนว่าง 10 วิ
    const onVisibility = () => {
      lastPublishRef.current = { phase: "", at: 0 };
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const toggleRecording = () => {
    const starting = !recorderRef.current.isRecording;
    recorderRef.current.toggle();
    recordingRef.current = recorderRef.current.isRecording;
    ownerRef.current = "manual"; // taken over by hand - neither camera nor chair may stop it
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
    ownerRef.current = null;
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

  // ── เหตุการณ์จากตัวจับเวลาของกล้อง (กล้องเป็นตัวหลัก เก้าอี้เป็นสำรอง) ──
  // ผูกผ่าน ref เพื่อให้ handleSidePose คงที่ แต่ยังเห็นค่าเก้าอี้/ผู้ทดสอบล่าสุดเสมอ
  useEffect(() => {
    const discardRecording = () => {
      recorderRef.current.stop();
      recordingRef.current = false;
      ownerRef.current = null;
      setRecording(false);
      setFrameCount(0);
      setStepCount(0);
    };

    timerEventRef.current = (ev: TimerEvent) => {
      switch (ev.type) {
        case "ready":
          setAutoNote("กล้องเห็นผู้ทดสอบนั่งพร้อมแล้ว - ลุกได้เลย");
          return;

        case "lost":
          setAutoNote("");
          return;

        case "start": {
          runStartRef.current = ev.startMs;
          // แปลงเวลาเริ่ม (นาฬิกาเฟรม) เป็นเวลาจริง — ย้อนกลับไปถึงจังหวะลุกจริง ไม่ใช่ตอนยืนยัน
          const startedAtMs = Date.now() - (performance.now() - ev.startMs);
          // เลขรอบของเก้าอี้ตอนนี้ = รอบที่กำลังจะเริ่ม (เก้าอี้บวกเลขตอนจบรอบ) — ใช้จับคู่ผล
          const meta = {
            startedAtMs,
            sessionId: chair.online ? chair.sessionId : "",
            trialNo: chair.online ? chair.trialNo : 0,
            subjectKey: activePatientId || chair.subjectKey,
          };
          runMetaRef.current = meta;
          if (!recordingRef.current) {
            trialRef.current = { sessionId: meta.sessionId, trialNo: meta.trialNo };
            recorderRef.current.start();
            recordingRef.current = true;
            ownerRef.current = "camera";
            setRecording(true);
            setFrameCount(0);
            setStepCount(0);
            setSummary(null);
            setUploaded(false);
          }
          setAutoNote(`ผู้ทดสอบลุกแล้ว - เริ่มจับเวลาจากกล้อง${meta.trialNo ? ` รอบที่ ${meta.trialNo}` : ""}`);
          return;
        }

        case "finish": {
          runStartRef.current = null;
          lastDurationRef.current = ev.durationMs;
          setLastDurationMs(ev.durationMs);
          const meta = runMetaRef.current;
          runMetaRef.current = null;
          if (meta) {
            saveCameraTiming({ ...meta, durationMs: ev.durationMs, finishedAtMs: meta.startedAtMs + ev.durationMs }).catch(
              (err) => {
                console.error("[saveCameraTiming]", err);
                setAutoNote("บันทึกเวลาจากกล้องไม่สำเร็จ - ระบบจะใช้เวลาจากเก้าอี้แทน");
              },
            );
          }
          setAutoNote(`จบรอบ ${(ev.durationMs / 1000).toFixed(2)} วินาที (จากกล้อง) - กำลังส่งผล`);
          if (ownerRef.current === "camera") void finishRef.current();
          return;
        }

        case "cancel":
        case "reject":
        case "abort":
          runStartRef.current = null;
          runMetaRef.current = null;
          // รอบที่ไม่บันทึกเข้าช่วงพักเหมือนกัน - ล้างเวลารอบก่อน ไม่ให้จอสถานะโชว์ผลเก่าเป็นผลรอบนี้
          if (ev.type !== "cancel") {
            lastDurationRef.current = 0;
            setLastDurationMs(0);
          }
          if (ownerRef.current === "camera") discardRecording();
          setAutoNote(
            ev.type === "cancel"
              ? "ผู้ทดสอบขยับตัวแต่ไม่ได้ลุกเดิน - ไม่นับรอบนี้"
              : `ไม่บันทึกรอบนี้: ${ev.reason}`,
          );
          return;
      }
    };
  }, [chair.online, chair.sessionId, chair.trialNo, chair.subjectKey, activePatientId]);

  // สลับแหล่งจับเวลา: ล้างตัวจับเวลาทุกครั้ง ถ้ากล้องกำลังจับรอบอยู่ให้ยกเลิกรอบนั้น
  // (ปกติสลับไม่ได้ระหว่างทดสอบ แต่อีกเครื่องอาจสลับได้ในจังหวะเดียวกับที่ผู้ทดสอบลุก)
  useEffect(() => {
    if (cameraTimingRef.current === cameraTiming) return;
    cameraTimingRef.current = cameraTiming;
    const wasRunning = timerRef.current.phase === "running";
    timerRef.current.reset();
    if (wasRunning) timerEventRef.current({ type: "abort", reason: "เปลี่ยนแหล่งจับเวลาระหว่างรอบ" });
  }, [cameraTiming]);

  // ช่วงพักของกล้องยาวเท่าของเก้าอี้ — เก้าอี้ที่เป็นตัวสำรองพร้อมรอบถัดไปพร้อมกัน
  useEffect(() => {
    timerRef.current.setCooldownMs((chair.cooldownSec > 0 ? chair.cooldownSec : 15) * 1000);
  }, [chair.cooldownSec]);

  useEffect(() => {
    const state = (chair.state || "").toUpperCase();
    const prev = prevChairStateRef.current;
    if (state === prev) return;
    prevChairStateRef.current = state;

    // ครั้งแรกที่ได้ยินจากบอร์ด (prev ว่าง) แค่จำสถานะไว้ ห้ามทำอะไร ไม่งั้นการเปิดหน้า
    // ตอนบอร์ดค้างอยู่ที่ COOLDOWN จะกลายเป็นการอัปโหลดผลเปล่า ๆ ทันทีที่โหลดหน้า
    if (!prev || !chair.online) return;

    const inTest = (s: string) => s === "RUNNING" || s === "RETURNING";

    // เก้าอี้เป็นสำรอง: เริ่มบันทึกเฉพาะเมื่อกล้องไม่ได้เริ่มรอบนี้ไปก่อนแล้ว
    // (ปกติกล้องเห็นก่อนเก้าอี้ราว 1 วินาที เพราะสถานะเก้าอี้ต้องเดินทางผ่านอินเทอร์เน็ต)
    if (state === "RUNNING" && !recordingRef.current && timerRef.current.phase !== "running") {
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
      ownerRef.current = "chair";
      setRecording(true);
      setFrameCount(0);
      setStepCount(0);
      setSummary(null);
      setUploaded(false);
      setAutoNote(`เริ่มบันทึกอัตโนมัติ - รอบที่ ${chair.trialNo || "?"}`);
      return;
    }

    // จบรอบ = ออกจากช่วงทดสอบ (นั่งลง → COOLDOWN หรือถูกยกเลิก/หมดเวลา)
    if (ownerRef.current === "chair" && inTest(prev) && !inTest(state)) {
      setAutoNote("จบรอบ - กำลังส่งผลวิเคราะห์ท่าเดิน");
      void finishRef.current();
    }
  }, [chair.state, chair.online, chair.sessionId, chair.trialNo]);

  const canUpload = frameCount > 0 && !uploaded;

  return (
    <div className="gc-page2">
      <div className="gc-cams">
        <CameraView view="front" label="กล้องด้านหน้า" onFrame={handleFront} />
        <CameraView view="side" label="กล้องด้านข้าง" onFrame={handleSide} onPose={handleSidePose} />
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
          {cameraTiming ? (
            <div className={`gc-timer gc-timer--${sideLive ? timerPhase : "off"}`} role="status" aria-live="polite">
              <span className="gc-timer__label">โหมดจับเวลา: กล้องด้านข้าง</span>
              <strong className="gc-timer__headline">
                {sideLive ? TIMER_HEADLINE[timerPhase] : "เปิดกล้องด้านข้างเพื่อจับเวลาจากท่าทาง"}
              </strong>
              {sideLive && timerPhase === "running" && (
                <span className="gc-timer__clock">{(elapsedMs / 1000).toFixed(1)} วินาที</span>
              )}
              {lastDurationMs > 0 && timerPhase !== "running" && (
                <span className="gc-timer__last">รอบล่าสุด {(lastDurationMs / 1000).toFixed(2)} วินาที</span>
              )}
            </div>
          ) : (
            <div className="gc-timer gc-timer--off" role="status">
              <span className="gc-timer__label">โหมดจับเวลา: ฮาร์ดแวร์ (เก้าอี้ + จุดหมุนตัว)</span>
              <strong className="gc-timer__headline">กล้องใช้บันทึกท่าเดินอย่างเดียว</strong>
              <span className="gc-timer__last">เปลี่ยนเป็นจับเวลาจากกล้องได้ที่เมนู “ตั้งค่าอุปกรณ์”</span>
            </div>
          )}
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
