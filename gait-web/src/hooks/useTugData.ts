// Central data layer: signs in, then keeps patients / TUG results / gait
// assessments in sync via Firestore onSnapshot (real-time). Exposes CRUD too.
import { useEffect, useState } from "react";
import {
  addPatient,
  assignGaitAssessmentToPatient,
  assignResultToPatient,
  deletePatient,
  ensureAuth,
  subscribeGaitAssessments,
  subscribePatients,
  subscribeResults,
  updatePatient,
  type GaitAssessment,
  type Patient,
  type TugResult,
} from "../lib/firebase";

export type ConnState = "pending" | "online" | "error";

export interface TugData {
  conn: ConnState;
  connLabel: string;
  patients: Patient[];
  /** Every trial, including aborted ones - for the audit table. */
  results: TugResult[];
  /**
   * Only trials the board finished properly. Aborted trials record the time
   * elapsed before cancellation, NOT a real TUG time, so including them would
   * corrupt every average and risk count (spec section 3).
   */
  completedResults: TugResult[];
  assessments: GaitAssessment[];
  assessmentsError: string | null;
  patientName: (id: string) => string | null;
  addPatient: typeof addPatient;
  updatePatient: typeof updatePatient;
  removePatient: (id: string) => Promise<void>;
  assignResult: typeof assignResultToPatient;
  assignAssessment: typeof assignGaitAssessmentToPatient;
}

export function useTugData(): TugData {
  const [conn, setConn] = useState<ConnState>("pending");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [results, setResults] = useState<TugResult[]>([]);
  const [assessments, setAssessments] = useState<GaitAssessment[]>([]);
  const [assessmentsError, setAssessmentsError] = useState<string | null>(null);

  useEffect(() => {
    let unsubs: Array<() => void> = [];
    let cancelled = false;

    ensureAuth().then((ok) => {
      if (cancelled) return;
      if (!ok) {
        setConn("error");
        return;
      }
      setConn("online");
      unsubs = [
        subscribePatients(setPatients, () => setConn("error")),
        subscribeResults(setResults, () => setConn("error")),
        subscribeGaitAssessments(
          (rows) => {
            setAssessmentsError(null);
            setAssessments(rows);
          },
          (err) => setAssessmentsError(err.message),
        ),
      ];
    });

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, []);

  const completedResults = results.filter((r) => r.status === "completed");

  const patientName = (id: string) => patients.find((p) => p.id === id)?.name ?? null;

  const connLabel =
    conn === "online"
      ? `เชื่อมต่อแล้ว - TUG ${results.length} / ประเมินโรค ${assessments.length}`
      : conn === "error"
        ? "เกิดข้อผิดพลาด"
        : "กำลังเชื่อมต่อ...";

  const removePatient = (id: string) =>
    deletePatient(
      id,
      results.filter((r) => r.patientId === id).map((r) => r.id),
      assessments.filter((a) => a.patientId === id).map((a) => a.id),
    );

  return {
    conn,
    connLabel,
    patients,
    results,
    completedResults,
    assessments,
    assessmentsError,
    patientName,
    addPatient,
    updatePatient,
    removePatient,
    assignResult: assignResultToPatient,
    assignAssessment: assignGaitAssessmentToPatient,
  };
}
