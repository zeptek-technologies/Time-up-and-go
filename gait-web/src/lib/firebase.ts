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
  patientId: string; // legacy: manual web-side assignment
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
      const rows: TugResult[] = [];
      snap.forEach((d) => {
        const data = d.data() as DocumentData;
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
          subjectKey: data.subject_key ?? "",
          sessionId: data.session_id ?? "",
          trialNo: num(data.trial_no),
          fwVersion: data.fw_version ?? "",
          patientId: data.patient_id ?? "",
        });
      });
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
}

const EMPTY_DEVICE: DeviceStatus = {
  exists: false, lastSeen: 0, state: "", rssi: 0, fwVersion: "", uptimeSec: 0,
  checkpointOnline: false, pendingUploads: 0, armed: false,
  subjectKey: "", sessionId: "", trialNo: 0, chairOnline: false,
  light: "", chairState: "",
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

export async function uploadAssessment(
  recorder: GaitSessionRecorder,
  patientId = "",
  cameraMode: "front" | "front+side" = "front",
): Promise<UploadOutcome> {
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
