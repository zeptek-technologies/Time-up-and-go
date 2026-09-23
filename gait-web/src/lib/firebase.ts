// Firebase / Firestore integration for the whole app (camera + dashboard).
// Mirrors the existing web_dashboard: signs in with the shared ESP32 service
// account so the EXISTING Firestore security rules apply (no need to open them).
// Writes gait results to `gait_assessments` with the same schema main.py used.
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";
import type { GaitSessionRecorder } from "./recorder";
import type { ChairDistances, CheckpointDistances } from "./deviceConfig";
import { mergeCameraTimings } from "./timingMerge";
import type { ClockSample } from "./checkpointSync";
import { riskLevelOf } from "./tugRisk";

const firebaseConfig = {
  apiKey: "AIzaSyC4dFT0u_NWRmsbuQygQhQnW6nGuRUn4D8",
  authDomain: "time-up-and-go.firebaseapp.com",
  projectId: "time-up-and-go",
  storageBucket: "time-up-and-go.firebasestorage.app",
  messagingSenderId: "349614723887",
  appId: "1:349614723887:web:871e36ae680382e726c7da",
  measurementId: "G-ZQ3THM0376",
};

// Local development credentials live in gait-web/.env.local, which is ignored
// by Git. This still produces client-visible credentials in a deployed bundle;
// production should use individual staff accounts instead of a shared login.
const AUTH_EMAIL = import.meta.env.VITE_FIREBASE_AUTH_EMAIL;
const AUTH_PASSWORD = import.meta.env.VITE_FIREBASE_AUTH_PASSWORD;

const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
const auth = getAuth(app);
export const db = getFirestore(app);

let authPromise: Promise<boolean> | null = null;

/** Sign in once (idempotent). Resolves true on success. */
export function ensureAuth(): Promise<boolean> {
  if (!AUTH_EMAIL || !AUTH_PASSWORD) {
    console.error("[Auth] Missing VITE_FIREBASE_AUTH_EMAIL/PASSWORD");
    return Promise.resolve(false);
  }
  if (!authPromise) {
    authPromise = signInWithEmailAndPassword(auth, AUTH_EMAIL, AUTH_PASSWORD)
      .then(() => true)
      .catch((err) => {
        console.error("[Auth]", err.message);
        authPromise = null; // allow retry
        return false;
      });
  }
  return authPromise;
}

// ── Domain types ──
export interface Patient {
  id: string;
  name: string;
  age: number | null;
  gender: string;
  note: string;
  conditions: string[];
}

// One document = one TRIAL (not a whole session). Firmware v2 adds 9 fields on
// top of the original checkpoint_sec / total_sec / risk_level.
export interface TugResult {
  id: string;
  checkpointSec: number;
  returnSec: number;
  totalSec: number;
  /** As stored by the board. Prefer riskLevelOf(totalSec) — see lib/tugRisk.ts. */
  riskLevel: "LOW" | "MODERATE" | "HIGH";
  status: "completed" | "aborted";
  startedAt: number; // epoch sec, 0 when the board had no NTP time yet
  finishedAt: number; // epoch sec, guaranteed > 0 on v2
  subjectKey: string; // "unassigned" until the web starts naming subjects
  sessionId: string;
  trialNo: number;
  fwVersion: string;
  // Explicit web-side assignment, or subject_key when the ESP32 created the
  // result. The firmware intentionally stores the patient document id in
  // subject_key and does not write patient_id.
  patientId: string;
  /** ที่มาของเวลารวม: กล้อง (หลัก) หรือเซนเซอร์เก้าอี้ (สำรอง) — ดู lib/timingMerge.ts */
  timingSource: "camera" | "chair";
  /** เวลาที่กล้องวัดได้ (null = กล้องไม่ได้จับรอบนี้) */
  cameraTotalSec: number | null;
  /** เวลาที่เก้าอี้วัดได้ (null = ไม่มีผลจากเก้าอี้ในรอบนี้) */
  chairTotalSec: number | null;
}

export interface GaitAssessment {
  id: string;
  condition: string;
  confidence: number;
  riskScores: Record<string, number>;
  sessionDurationFrames: number;
  timestamp: string;
  timestampRaw: unknown;
  patientId: string;
  // Which TUG trial this walk belongs to. Empty / 0 on records written before
  // the camera was driven by the chair — those can only be matched by time.
  sessionId: string;
  trialNo: number;
  // Camera gait metrics. null on records written before step counting existed.
  stepCount: number | null;
  cadenceAvg: number | null;
  stepTimeCvAvg: number | null;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Distinguishes "field absent / not measured" (null) from a real 0. */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Real-time subscriptions (onSnapshot) ──
export function subscribePatients(cb: (rows: Patient[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    query(collection(db, "patients")),
    (snap) => {
      const rows: Patient[] = [];
      snap.forEach((d) => {
        const data = d.data() as DocumentData;
        rows.push({
          id: d.id,
          name: data.name ?? "",
          age: data.age ?? null,
          gender: data.gender ?? "",
          note: data.note ?? "",
          conditions: Array.isArray(data.conditions)
            ? data.conditions.filter((item): item is string => typeof item === "string")
            : [],
        });
      });
      rows.sort((a, b) => a.name.localeCompare(b.name, "th"));
      cb(rows);
    },
    (err) => onError?.(err),
  );
}

export function subscribeResults(cb: (rows: TugResult[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    query(collection(db, "tug_results")),
    (snap) => {
      const chairRows: TugResult[] = [];
      const cameraRows: TugResult[] = [];
      snap.forEach((d) => {
        const data = d.data() as DocumentData;
        const fromCamera = data.device === "camera";
        const rows = fromCamera ? cameraRows : chairRows;
        const subjectKey = typeof data.subject_key === "string" ? data.subject_key : "";
        // Results created by the chair contain subject_key but no patient_id.
        // subject_key is the pseudonymous Firestore patient document id, so use
        // it as the relation unless patient_id exists (including an intentional
        // empty string written when staff manually unassign a legacy result).
        const patientId = typeof data.patient_id === "string"
          ? data.patient_id
          : (subjectKey && subjectKey !== "unassigned" ? subjectKey : "");
        rows.push({
          id: d.id,
          checkpointSec: num(data.checkpoint_sec),
          returnSec: num(data.return_sec),
          totalSec: num(data.total_sec),
          riskLevel: ((data.risk_level ?? "LOW") as string).toUpperCase() as TugResult["riskLevel"],
          // Legacy rows (firmware v1) have no `status`. Treating a missing value
          // as "completed" keeps existing history in the stats instead of
          // silently dropping every pre-v2 record.
          status: data.status === "aborted" ? "aborted" : "completed",
          startedAt: num(data.started_at),
          finishedAt: num(data.finished_at),
          subjectKey,
          sessionId: data.session_id ?? "",
          trialNo: num(data.trial_no),
          fwVersion: data.fw_version ?? "",
          patientId,
          timingSource: fromCamera ? "camera" : "chair",
          cameraTotalSec: fromCamera ? num(data.total_sec) : null,
          chairTotalSec: fromCamera ? null : num(data.total_sec),
        });
      });
      const rows = mergeCameraTimings(chairRows, cameraRows);
      // Newest first by real wall-clock time. The old sort parsed the doc ID,
      // which no longer works: v1 IDs were millis-since-boot, v2 IDs are
      // "<epoch>_<trial>" — the two aren't comparable. Rows with no timestamp
      // (legacy) sort to the bottom.
      rows.sort((a, b) => {
        if (a.finishedAt !== b.finishedAt) return b.finishedAt - a.finishedAt;
        return b.id.localeCompare(a.id);
      });
      cb(rows);
    },
    (err) => onError?.(err),
  );
}

export function subscribeGaitAssessments(
  cb: (rows: GaitAssessment[]) => void,
  onError?: (e: Error) => void,
) {
  return onSnapshot(
    query(collection(db, "gait_assessments")),
    (snap) => {
      const rows: GaitAssessment[] = [];
      snap.forEach((d) => {
        const data = d.data() as DocumentData;
        const highest = data.highest_risk_detected ?? {};
        rows.push({
          id: d.id,
          condition: highest.condition ?? data.condition ?? "Unknown",
          confidence: num(highest.confidence_risk_percentage ?? data.confidence_risk_percentage),
          riskScores: data.risk_scores ?? {},
          sessionDurationFrames: num(data.session_duration_frames),
          timestamp: data.timestamp ?? "",
          timestampRaw: data.timestamp,
          patientId: data.patient_id ?? "",
          sessionId: data.session_id ?? "",
          trialNo: num(data.trial_no),
          stepCount: numOrNull(data.step_count),
          cadenceAvg: numOrNull(data.cadence_avg),
          stepTimeCvAvg: numOrNull(data.step_time_cv_avg),
        });
      });
      rows.sort((a, b) => assessmentTime(b) - assessmentTime(a) || b.id.localeCompare(a.id));
      cb(rows);
    },
    (err) => onError?.(err),
  );
}

function assessmentTime(item: GaitAssessment): number {
  if (!item.timestampRaw) return 0;
  const raw = item.timestampRaw as { toDate?: () => Date };
  const date = typeof raw.toDate === "function" ? raw.toDate() : new Date(item.timestampRaw as string);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

// ── ESP32 board presence (device_status/chair and device_status/checkpoint) ──
export type DeviceId = "chair" | "checkpoint";

export interface DeviceStatus {
  exists: boolean;
  lastSeen: number; // epoch seconds written by the board's heartbeat
  state: string; // chair: CALIBRATE|WAIT_SIT|READY|RUNNING|RETURNING|COOLDOWN
  //               checkpoint: IDLE|DETECTING|RESULT
  rssi: number; // WiFi signal (dBm)
  fwVersion: string;
  uptimeSec: number;
  // chair only
  checkpointOnline: boolean; // chair↔checkpoint link, straight from ESP-NOW
  pendingUploads: number; // results buffered on the board, not yet uploaded
  armed: boolean;
  subjectKey: string;
  sessionId: string;
  trialNo: number;
  // checkpoint only
  chairOnline: boolean;
  light: string; // สีไฟที่หลอดกำลังแสดงจริง: not_ready|ready|stand_up|walking|passed|result_*
  chairState: string; // สถานะเก้าอี้ที่ checkpoint ได้ยินทาง ESP-NOW — เร็วกว่า device_status/chair
  //                     ตลอดช่วง RETURNING เพราะช่วงนั้นเก้าอี้หยุดคุย Firestore ไม่ให้จับเวลาเพี้ยน
  // ค่าระยะที่บอร์ด "ใช้อยู่จริง" (0 = เฟิร์มแวร์รุ่นเก่า ยังไม่รายงาน)
  cfgSitCm: number; // chair
  cfgStandCm: number; // chair
  cfgDetectCm: number; // checkpoint
  /** ระยะที่อ่านได้ถูกต้องครั้งล่าสุด · -1 = ยังไม่เคยได้ echo ตั้งแต่บูต · null = บอร์ดไม่รายงาน */
  distanceCm: number | null;
  /** false = ช่วงนี้ไม่ได้รับเสียงสะท้อน (distanceCm เป็นค่าเก่า) · เฟิร์มแวร์เก่าไม่ส่งมา → ถือว่า true */
  distanceLive: boolean;
  /** chair: epoch วินาทีที่เข้าสถานะปัจจุบัน — ใช้นับถอยหลังช่วงพัก (0 = ไม่รู้) */
  stateSince: number;
  /** chair: ความยาวช่วงพักหลังจบรอบ (วินาที) · 0 = ไม่รายงาน */
  cooldownSec: number;
  /** checkpoint: เวลามาตรฐาน (epoch ms) ของครั้งล่าสุดที่เห็นคนเดินผ่าน · 0 = ยังไม่เคย/เฟิร์มแวร์เก่า */
  passAtMs: number;
  /** checkpoint: กำลังเฝ้าตลอด (โหมดกล้อง / ไม่มีเก้าอี้) */
  freeRun: boolean;
}

export const EMPTY_DEVICE: DeviceStatus = {
  exists: false, lastSeen: 0, state: "", rssi: 0, fwVersion: "", uptimeSec: 0,
  checkpointOnline: false, pendingUploads: 0, armed: false,
  subjectKey: "", sessionId: "", trialNo: 0, chairOnline: false,
  light: "", chairState: "",
  cfgSitCm: 0, cfgStandCm: 0, cfgDetectCm: 0, distanceCm: null, distanceLive: false, stateSince: 0, cooldownSec: 0,
  passAtMs: 0, freeRun: false,
};

export function subscribeDeviceStatus(
  deviceId: DeviceId,
  cb: (s: DeviceStatus) => void,
  onError?: (e: Error) => void,
) {
  return onSnapshot(
    doc(db, "device_status", deviceId),
    (snap) => {
      if (!snap.exists()) {
        cb(EMPTY_DEVICE);
        return;
      }
      const d = snap.data() as DocumentData;
      cb({
        exists: true,
        lastSeen: num(d.last_seen),
        state: d.state ?? "",
        rssi: num(d.rssi),
        fwVersion: d.fw_version ?? "",
        uptimeSec: num(d.uptime_sec),
        checkpointOnline: d.checkpoint_online === true,
        pendingUploads: num(d.pending_uploads),
        armed: d.armed === true,
        subjectKey: d.subject_key ?? "",
        sessionId: d.session_id ?? "",
        trialNo: num(d.trial_no),
        chairOnline: d.chair_online === true,
        light: d.light ?? "",
        chairState: d.chair_state ?? "",
        cfgSitCm: num(d.cfg_sit_cm),
        cfgStandCm: num(d.cfg_stand_cm),
        cfgDetectCm: num(d.cfg_detect_cm),
        distanceCm: numOrNull(d.distance_cm),
        distanceLive: d.distance_live !== false,
        stateSince: num(d.state_since),
        cooldownSec: num(d.cooldown_sec),
        passAtMs: num(d.pass_at_ms),
        freeRun: d.free_run === true,
      });
    },
    (err) => onError?.(err),
  );
}

// ── ESP32 chair remote reset ──
// Web writes reset_requested_at; the ESP polls device_commands/chair, echoes it
// back as reset_handled_at right before ESP.restart() (see ESP_Chair.ino), so
// this doc doubles as the ack channel — the web knows the reboot actually
// started once handledAt catches up to requestedAt.
export interface DeviceCommand {
  requestedAt: number; // epoch seconds
  handledAt: number; // epoch seconds
}

export function subscribeDeviceCommand(
  cb: (c: DeviceCommand) => void,
  onError?: (e: Error) => void,
) {
  return onSnapshot(
    doc(db, "device_commands", "chair"),
    (snap) => {
      const d = (snap.data() as DocumentData) ?? {};
      cb({ requestedAt: num(d.reset_requested_at), handledAt: num(d.reset_handled_at) });
    },
    (err) => onError?.(err),
  );
}

export async function requestReset(): Promise<void> {
  await ensureAuth();
  const nowSec = Math.floor(Date.now() / 1000);
  await setDoc(doc(db, "device_commands", "chair"), { reset_requested_at: nowSec }, { merge: true });
}

// ── Camera-based TUG timing ──
// เวลาที่กล้องวัดได้ เก็บเป็นเอกสาร cam_* ใน tug_results (collection ที่กฎอนุญาตอยู่แล้ว)
// แล้วให้ subscribeResults จับคู่กับผลของเก้าอี้ฝั่งเว็บ — ดู lib/timingMerge.ts
export interface CameraTiming {
  durationMs: number;
  startedAtMs: number; // epoch ms
  finishedAtMs: number; // epoch ms
  sessionId: string;
  trialNo: number; // 0 = ไม่รู้เลขรอบ (เก้าอี้ออฟไลน์) → เป็นแถวของกล้องอย่างเดียว
  subjectKey: string;
  /** ขาไปจากบอร์ด checkpoint (วินาที) · 0 = ไม่มี (ไม่ได้เปิด checkpoint / ไม่เห็นคนผ่าน) */
  checkpointSec: number;
}

export async function saveCameraTiming(t: CameraTiming): Promise<void> {
  await ensureAuth();
  const totalSec = t.durationMs / 1000;
  const checkpointSec = t.checkpointSec > 0 && t.checkpointSec < totalSec ? t.checkpointSec : 0;
  const finishedSec = Math.floor(t.finishedAtMs / 1000);
  await setDoc(doc(db, "tug_results", `cam_${finishedSec}_${t.trialNo || 0}`), {
    device: "camera",
    timing_source: "camera",
    total_sec: totalSec,
    checkpoint_sec: checkpointSec,
    return_sec: checkpointSec > 0 ? totalSec - checkpointSec : 0,
    risk_level: riskLevelOf(totalSec),
    status: "completed",
    started_at: Math.floor(t.startedAtMs / 1000),
    finished_at: finishedSec,
    started_at_ms: Math.round(t.startedAtMs),
    finished_at_ms: Math.round(t.finishedAtMs),
    subject_key: t.subjectKey || "unassigned",
    session_id: t.sessionId || "unassigned",
    trial_no: t.trialNo || 0,
    fw_version: "web-camera-2",
  });
}

// สถานะของตัวจับเวลาจากกล้อง ให้จอสถานะ (อีกเครื่อง) เห็นได้ทันทีที่ผู้ทดสอบลุก
// ไม่ต้องรอเก้าอี้ ส่ง elapsed_ms (ไม่ใช่เวลาเริ่ม) เพราะนาฬิกาสองเครื่องอาจต่างกันหลายวินาที
// off = โหมดฮาร์ดแวร์ · no_side = เปิดหน้ากล้องแล้วแต่ยังไม่ได้ภาพจากกล้องด้านข้าง
// hidden = หน้ากล้องถูกซ่อน (สลับแท็บ/ย่อหน้าต่าง) เบราว์เซอร์หยุดประมวลผลภาพ จับเวลาไม่ได้
export type CameraPhase = "off" | "no_side" | "hidden" | "waiting" | "ready" | "running" | "cooldown";

export interface CameraStatus {
  exists: boolean;
  phase: CameraPhase;
  elapsedMs: number;
  lastDurationMs: number;
  /** เวลาพักที่เหลือก่อนรอบถัดไป (ms) ณ ตอนที่หน้ากล้องส่งมา */
  cooldownLeftMs: number;
  /** หน้ากล้องที่ส่งค่านี้ ("" = เวอร์ชันเก่าที่ยังไม่ระบุ) — เปิดกล้องได้หลายหน้า/หลายเครื่อง */
  clientId: string;
  /** Date.now() ของหน้าที่เขียน — หน้ารุ่นใหม่เปลี่ยนทุกครั้ง ค่าซ้ำ = หน้ารุ่นเก่าเขียนทับ (id ค้างจากคนก่อน) */
  clientMs: number;
}

/** ระบุหน้ากล้องแต่ละหน้า — ตัวอย่างเทียบนาฬิกาต้องเป็นของหน้านี้เองเท่านั้น */
export const CAMERA_CLIENT_ID = Math.random().toString(36).slice(2, 10);

export async function publishCameraStatus(
  phase: CameraPhase,
  elapsedMs: number,
  lastDurationMs: number,
  cooldownLeftMs: number,
): Promise<void> {
  await ensureAuth();
  await setDoc(
    doc(db, "device_status", "camera"),
    {
      device: "camera",
      phase,
      elapsed_ms: Math.round(elapsedMs),
      last_duration_ms: Math.round(lastDurationMs),
      cooldown_left_ms: Math.round(cooldownLeftMs),
      last_seen: Math.floor(Date.now() / 1000),
      // เทียบนาฬิกาเครื่องนี้กับเซิร์ฟเวอร์ (ดู lib/checkpointSync.ts) — ใช้คิดขาไปกับเวลาของ checkpoint
      client_id: CAMERA_CLIENT_ID,
      client_ms: Date.now(),
      server_ts: serverTimestamp(),
    },
    { merge: true },
  );
}

/** ตัวอย่างเทียบนาฬิกาจากการส่งสถานะของหน้ากล้องหน้านี้ (ได้ทุกครั้งที่เซิร์ฟเวอร์ยืนยันการเขียน) */
export function subscribeClockSamples(cb: (s: ClockSample) => void, onError?: (e: Error) => void) {
  let lastClientMs = 0;
  return onSnapshot(
    doc(db, "device_status", "camera"),
    { includeMetadataChanges: true },
    (snap) => {
      if (snap.metadata.hasPendingWrites || snap.metadata.fromCache) return;
      const d = snap.data() as DocumentData | undefined;
      const ts = d?.server_ts;
      if (!d || d.client_id !== CAMERA_CLIENT_ID || !ts?.toMillis) return;
      const sentMs = num(d.client_ms);
      if (sentMs === lastClientMs) return; // ยืนยันของการเขียนเดิม มาซ้ำจาก metadata
      lastClientMs = sentMs;
      cb({ sentMs, serverMs: ts.toMillis(), recvMs: Date.now() });
    },
    (err) => onError?.(err),
  );
}

// ── แหล่งจับเวลา (กล้อง / ฮาร์ดแวร์) ──
// ค่าเดียวใช้ร่วมกันทุกเครื่อง (หน้ากล้องกับจอสถานะมักเปิดคนละเครื่อง) จึงเก็บใน Firestore
// อยู่ใน device_commands ซึ่งกฎอนุญาตอยู่แล้ว — บอร์ดอ่านเฉพาะเอกสารของตัวเอง จึงไม่เห็นเอกสารนี้
export type TimingSource = "camera" | "hardware";
export const DEFAULT_TIMING_SOURCE: TimingSource = "camera";

export function subscribeTimingSource(cb: (s: TimingSource) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    doc(db, "device_commands", "settings"),
    (snap) => {
      const v = (snap.data() as DocumentData | undefined)?.timing_source;
      cb(v === "hardware" || v === "camera" ? v : DEFAULT_TIMING_SOURCE);
    },
    (err) => onError?.(err),
  );
}

export async function saveTimingSource(source: TimingSource): Promise<void> {
  await ensureAuth();
  await setDoc(
    doc(db, "device_commands", "settings"),
    { timing_source: source, timing_source_set_at: Math.floor(Date.now() / 1000) },
    { merge: true },
  );
}

export function subscribeCameraStatus(cb: (s: CameraStatus) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    doc(db, "device_status", "camera"),
    (snap) => {
      const d = (snap.data() as DocumentData) ?? {};
      cb({
        exists: snap.exists(),
        phase: (d.phase as CameraPhase) ?? "off",
        elapsedMs: num(d.elapsed_ms),
        lastDurationMs: num(d.last_duration_ms),
        cooldownLeftMs: num(d.cooldown_left_ms),
        clientId: typeof d.client_id === "string" ? d.client_id : "",
        clientMs: num(d.client_ms),
      });
    },
    (err) => onError?.(err),
  );
}

// ── Sensor distance settings ──
// เว็บเขียน "ค่าที่ขอให้ใช้" ลง device_commands/<บอร์ด> ซึ่งบอร์ด poll อยู่แล้ว (เก้าอี้ทุก 4 วิ,
// จุดหมุนตัวทุก 6 วิ) จึงไม่เพิ่มการอ่าน Firestore — บอร์ดตรวจช่วงค่า จำลง flash แล้วรายงาน
// "ค่าที่ใช้อยู่จริง" กลับใน device_status/<บอร์ด> (cfg_*) หน้าเว็บเทียบสองค่าเพื่อบอกว่ารับแล้วหรือยัง
// บอร์ดจะไม่เปลี่ยนเกณฑ์ระหว่างรอบทดสอบ — ค่าที่ขอค้างอยู่ในเอกสาร และถูกหยิบไปใช้หลังจบรอบเอง
export interface DeviceConfigRequest {
  sitCm: number | null;
  standCm: number | null;
  detectCm: number | null;
  setAt: number; // epoch วินาทีที่บันทึกล่าสุด
}

export function subscribeDeviceConfig(
  deviceId: DeviceId,
  cb: (c: DeviceConfigRequest) => void,
  onError?: (e: Error) => void,
) {
  return onSnapshot(
    doc(db, "device_commands", deviceId),
    (snap) => {
      const d = (snap.data() as DocumentData) ?? {};
      cb({
        sitCm: numOrNull(d.cfg_sit_cm),
        standCm: numOrNull(d.cfg_stand_cm),
        detectCm: numOrNull(d.cfg_detect_cm),
        setAt: num(d.cfg_set_at),
      });
    },
    (err) => onError?.(err),
  );
}

export async function saveChairDistances(v: ChairDistances): Promise<void> {
  await ensureAuth();
  await setDoc(
    doc(db, "device_commands", "chair"),
    { cfg_sit_cm: v.sitCm, cfg_stand_cm: v.standCm, cfg_set_at: Math.floor(Date.now() / 1000) },
    { merge: true },
  );
}

export async function saveCheckpointDistances(v: CheckpointDistances): Promise<void> {
  await ensureAuth();
  await setDoc(
    doc(db, "device_commands", "checkpoint"),
    { cfg_detect_cm: v.detectCm, cfg_set_at: Math.floor(Date.now() / 1000) },
    { merge: true },
  );
}

// ── Who is being tested right now ──
// The camera tab and the live-status screen are separate pages (often separate
// devices), so "the selected subject" cannot live in React state — it has to
// travel through Firestore.
//
// It rides on device_commands/chair rather than a new collection because the
// board ALREADY reads subject_key and session_id from there (see checkCommands()
// in ESP_Chair_v2.ino). Writing them here means the board stamps tug_results
// with the same subject on its own — no firmware change, no new rules needed.
// patient_id / patient_name are extra fields the board simply ignores.
export interface ActiveSubject {
  patientId: string;
  patientName: string;
  sessionId: string;
}

const NO_SUBJECT: ActiveSubject = { patientId: "", patientName: "", sessionId: "" };

export function subscribeActiveSubject(
  cb: (s: ActiveSubject) => void,
  onError?: (e: Error) => void,
) {
  return onSnapshot(
    doc(db, "device_commands", "chair"),
    (snap) => {
      const d = (snap.data() as DocumentData) ?? {};
      cb({
        patientId: d.patient_id ?? "",
        patientName: d.patient_name ?? "",
        sessionId: d.session_id ?? "",
      });
    },
    (err) => onError?.(err),
  );
}

/**
 * Announce which subject the next trials belong to. Returns the new session id.
 *
 * ⚠️ Every call starts a NEW session, and the board resets trial_no to 1 whenever
 * session_id changes — so call this on an actual staff selection, never on every
 * render, and never mid-session.
 */
export async function setActiveSubject(patientId: string, patientName = ""): Promise<ActiveSubject> {
  await ensureAuth();
  const nowSec = Math.floor(Date.now() / 1000);
  // The board stores these in char[32], so keep them short. Firestore auto-ids
  // are 20 chars and "session_<10-digit epoch>" is 18 — both fit with room spare.
  const next: ActiveSubject = patientId
    ? { patientId, patientName, sessionId: `session_${nowSec}` }
    : NO_SUBJECT;

  await setDoc(
    doc(db, "device_commands", "chair"),
    {
      subject_key: patientId || "unassigned",
      session_id: next.sessionId || "unassigned",
      patient_id: next.patientId,
      patient_name: next.patientName,
      subject_set_at: nowSec,
    },
    { merge: true },
  );
  return next;
}

// ── Patient CRUD ──
export async function addPatient(
  name: string,
  age: string,
  gender: string,
  note: string,
  conditions: string[] = [],
) {
  await ensureAuth();
  await addDoc(collection(db, "patients"), {
    name,
    age: age ? Number(age) : null,
    gender: gender || "",
    note: note || "",
    conditions,
    created_at: serverTimestamp(),
  });
}

/** ฟิลด์ที่แก้ได้จากหน้าจัดการผู้ทดสอบ (id/created_at แก้ไม่ได้) */
export interface PatientEdit {
  name: string;
  age: string;
  gender: string;
  note: string;
  conditions: string[];
}

// แก้ทะเบียนเดิมแทนการลบแล้วสร้างใหม่ — deletePatient() ตัด patient_id ของผลเก่า
// ทิ้งทั้งหมด การ "แก้ด้วยการสร้างใหม่" จึงเท่ากับทำประวัติหาย
export async function updatePatient(id: string, fields: PatientEdit) {
  await ensureAuth();
  await updateDoc(doc(db, "patients", id), {
    name: fields.name,
    age: fields.age ? Number(fields.age) : null,
    gender: fields.gender,
    note: fields.note,
    conditions: fields.conditions,
    updated_at: serverTimestamp(),
  });
}

export async function deletePatient(id: string, linkedResultIds: string[], linkedAssessmentIds: string[]) {
  await ensureAuth();
  await deleteDoc(doc(db, "patients", id));
  await Promise.all([
    ...linkedResultIds.map((rid) => updateDoc(doc(db, "tug_results", rid), { patient_id: "" })),
    ...linkedAssessmentIds.map((aid) => updateDoc(doc(db, "gait_assessments", aid), { patient_id: "" })),
  ]);
}

export async function assignResultToPatient(resultId: string, patientId: string) {
  await ensureAuth();
  await updateDoc(doc(db, "tug_results", resultId), { patient_id: patientId });
}

export async function assignGaitAssessmentToPatient(assessmentId: string, patientId: string) {
  await ensureAuth();
  await updateDoc(doc(db, "gait_assessments", assessmentId), { patient_id: patientId });
}

// ── Gait assessment upload (web port of FirebaseGaitLogger) ──
export interface UploadOutcome {
  status: string;
  documentId: string | null;
}

export interface AssessmentContext {
  patientId?: string;
  cameraMode?: "front" | "front+side";
  /** TUG trial this walk belongs to — captured when the chair said RUNNING. */
  sessionId?: string;
  trialNo?: number;
}

export async function uploadAssessment(
  recorder: GaitSessionRecorder,
  ctx: AssessmentContext = {},
): Promise<UploadOutcome> {
  const { patientId = "", cameraMode = "front", sessionId = "", trialNo = 0 } = ctx;
  const { highestRisk, riskPercentage } = recorder.result();
  const round1 = (n: number) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
  const payload = {
    timestamp: new Date().toISOString(),
    session_duration_frames: recorder.totalFrames,
    risk_scores: { ...recorder.riskScores },
    highest_risk_detected: {
      condition: highestRisk,
      confidence_risk_percentage: Math.round(riskPercentage * 100) / 100,
    },
    // Camera-measured gait metrics. null (not 0) when never established, so a
    // reading of "no data" is distinguishable from a genuine zero.
    step_count: recorder.sessionSteps,
    cadence_avg: round1(recorder.avgCadence),
    step_time_cv_avg: round1(recorder.avgStepTimeVariability),
    // "front" = single camera; "front+side" = risk scores were cross-confirmed
    // by both cameras (see recorder.recordFused).
    camera_mode: cameraMode,
    patient_id: patientId,
    // Ties this walk to one TUG trial so the live screen can show the time and
    // the gait reading from the SAME round instead of guessing by timestamp.
    session_id: sessionId,
    trial_no: trialNo,
    source: "web",
  };
  try {
    if (!(await ensureAuth())) return { status: "Firebase upload failed: not authenticated", documentId: null };
    const ref = await addDoc(collection(db, "gait_assessments"), payload);
    return { status: "Successfully uploaded to Firebase!", documentId: ref.id };
  } catch (err) {
    return { status: `Firebase upload failed: ${(err as Error).message}`, documentId: null };
  }
}
