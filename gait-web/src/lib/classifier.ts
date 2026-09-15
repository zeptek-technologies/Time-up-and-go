// Port of RuleBasedGaitClassifier from main.py.
// Transparent MVP heuristics. Thresholds are starting points only — calibrate
// against labeled trials from the intended camera viewpoint before clinical use.
import type { GaitFeatures } from "./gaitFeatures";
import { maxNaN, minNaN } from "./mathUtils";

export const HEMIPLEGIC_ARM_SWING_MAX = 0.08;

// ── Thresholds ──
// Starting points grounded in published gait studies; still REQUIRE calibration
// against labeled trials from the intended camera viewpoint before clinical use.
//
// Parkinsonian gait (refs: Lewek 2010 PMC2818433; Nature Sci Rep 2021 s41598-020-80768-2):
//   reduced arm-swing amplitude, short stride, forward (stooped) trunk, AND a
//   markedly INCREASED L/R arm-swing asymmetry (controls ~5% vs PD ~14% asymmetry
//   angle). Combining step length + arm-swing asymmetry reaches AUC ~0.91.
const PARKINSONIAN_ARM_SWING_MAX = 0.075; // reduced bilateral amplitude
const PARKINSONIAN_ARM_ASYMMETRY_MIN = 0.45; // |L-R| index — elevated arm-swing asymmetry
const PARKINSONIAN_STEP_LENGTH_MAX = 0.115; // short steps (shuffling)
const PARKINSONIAN_TRUNK_LEAN_MIN = 10.0; // forward stoop (deg)

// Hemiplegic gait (post-stroke): strong unilateral leg asymmetry + one arm held
// flexed to the torso (ref: Patterson 2010 gait-symmetry standardization).
const HEMIPLEGIC_SYMMETRY_MIN = 0.45;

// Steppage / foot-drop: exaggerated hip+knee flexion to clear a dropped foot,
// usually unilateral (ref: Physiopedia "Foot drop"; StatPearls "Steppage Gait").
const STEPPAGE_KNEE_LIFT_MIN = 0.105;
const STEPPAGE_KNEE_FLEXION_MAX_ANGLE = 132.0;

export type GaitLabel = "Normal" | "Parkinsonian" | "Hemiplegic" | "Steppage";

export interface GaitPrediction {
  status: string;
  // hex color for UI accents (replaces the BGR tuples used by OpenCV)
  color: string;
  reasons: string[];
}

const NORMAL: GaitPrediction = {
  status: "Normal / No Abnormal Pattern",
  color: "#22c55e",
  reasons: ["heuristics below alert thresholds"],
};

export class RuleBasedGaitClassifier {
  predict(features: GaitFeatures | null): GaitPrediction {
    if (!features) {
      return { status: "No Pose Detected", color: "#f59e0b", reasons: ["Move fully into camera view"] };
    }

    const steppage =
      maxNaN(features.leftKneeLift, features.rightKneeLift) > STEPPAGE_KNEE_LIFT_MIN &&
      minNaN(features.leftKneeAngle, features.rightKneeAngle) < STEPPAGE_KNEE_FLEXION_MAX_ANGLE;
    if (steppage) {
      const side = features.leftKneeLift > features.rightKneeLift ? "left" : "right";
      return {
        status: "Possible Steppage Gait",
        color: "#fb923c",
        reasons: [`high ${side} knee lift`, "excessive swing-phase knee flexion"],
      };
    }

    // Parkinsonian: an arm-swing abnormality (reduced amplitude OR elevated L/R
    // asymmetry) together with a postural/spatial sign (short steps OR forward
    // lean). Guarded by "legs roughly symmetric" so strongly one-sided cases fall
    // through to the hemiplegic rule below instead of being mislabeled.
    const reducedArmSwing = features.meanArmSwing < PARKINSONIAN_ARM_SWING_MAX;
    const asymmetricArmSwing = features.armSwingAsymmetry > PARKINSONIAN_ARM_ASYMMETRY_MIN;
    const shortSteps = features.stepLength < PARKINSONIAN_STEP_LENGTH_MAX;
    const forwardLean = features.trunkLean > PARKINSONIAN_TRUNK_LEAN_MIN;
    const legsSymmetric = !(features.symmetryIndex > HEMIPLEGIC_SYMMETRY_MIN);
    const parkinsonian =
      (reducedArmSwing || asymmetricArmSwing) && (shortSteps || forwardLean) && legsSymmetric;
    if (parkinsonian) {
      const reasons: string[] = [];
      reasons.push(asymmetricArmSwing ? "asymmetric arm swing (L/R)" : "reduced bilateral arm swing");
      if (shortSteps) reasons.push("short step length");
      if (forwardLean) reasons.push("forward trunk lean");
      return { status: "Possible Parkinsonian Gait", color: "#ef4444", reasons };
    }

    const oneArmClose = features.leftArmCloseToChest || features.rightArmCloseToChest;
    const lowArmSwing = minNaN(features.leftArmSwing, features.rightArmSwing) < HEMIPLEGIC_ARM_SWING_MAX;
    const hemiplegic = features.symmetryIndex > HEMIPLEGIC_SYMMETRY_MIN && oneArmClose && lowArmSwing;
    if (hemiplegic) {
      const side = features.weakSide !== "unknown" ? features.weakSide : "one";
      return {
        status: "Possible Hemiplegic Gait",
        color: "#ef4444",
        reasons: [`${side} leg movement reduced/asymmetric`, "one arm held close to torso"],
      };
    }

    return NORMAL;
  }
}

/**
 * Side-view classifier. A camera to the side of the walkway sees the SAGITTAL
 * plane well (joint angles, step length, trunk lean, knee lift) but CANNOT judge
 * left/right symmetry — one leg occludes the other. So it uses only the
 * sagittal-reliable signals and never emits "Hemiplegic" (which needs L/R
 * distinction). That maps exactly onto the capability-aware fusion: Hemiplegic
 * is confirmed by the front camera alone, Parkinsonian/Steppage need both.
 */
export class RuleBasedSideGaitClassifier {
  predict(features: GaitFeatures | null): GaitPrediction {
    if (!features) {
      return { status: "No Pose Detected", color: "#f59e0b", reasons: ["Move fully into camera view"] };
    }

    // Steppage reads well from the side (the exaggerated hip/knee flexion to
    // clear a dropped foot is a sagittal motion) — same rule as the front.
    const steppage =
      maxNaN(features.leftKneeLift, features.rightKneeLift) > STEPPAGE_KNEE_LIFT_MIN &&
      minNaN(features.leftKneeAngle, features.rightKneeAngle) < STEPPAGE_KNEE_FLEXION_MAX_ANGLE;
    if (steppage) {
      return {
        status: "Possible Steppage Gait",
        color: "#fb923c",
        reasons: ["high knee lift", "excessive swing-phase knee flexion"],
      };
    }

    // Parkinsonian from the side relies on the signs a side view measures BEST:
    // reduced arm-swing amplitude, short step length, and forward trunk lean.
    // No L/R arm-swing asymmetry and no "legs symmetric" guard — both need a
    // front view. (Dropping the guard is fine because this classifier can't emit
    // Hemiplegic, so there's nothing to fall through to.)
    const reducedArmSwing = features.meanArmSwing < PARKINSONIAN_ARM_SWING_MAX;
    const shortSteps = features.stepLength < PARKINSONIAN_STEP_LENGTH_MAX;
    const forwardLean = features.trunkLean > PARKINSONIAN_TRUNK_LEAN_MIN;
    if (reducedArmSwing && (shortSteps || forwardLean)) {
      const reasons = ["reduced arm swing"];
      if (shortSteps) reasons.push("short step length");
      if (forwardLean) reasons.push("forward trunk lean");
      return { status: "Possible Parkinsonian Gait", color: "#ef4444", reasons };
    }

    return NORMAL;
  }
}

/**
 * ป้ายของ "ผลทำนายรายเฟรม" — ตกทุกอย่างที่ไม่เข้าเงื่อนไขเป็น Normal โดยตั้งใจ
 * เพราะ status ที่รับเข้ามาเป็นข้อความจาก classifier เท่านั้น ("Normal / No
 * Abnormal Pattern") ห้ามใช้กับค่าที่อ่านจาก Firestore — ดู storedGaitLabel()
 */
export function normalizePredictionLabel(status: string): GaitLabel {
  if (status.includes("Parkinsonian")) return "Parkinsonian";
  if (status.includes("Hemiplegic")) return "Hemiplegic";
  if (status.includes("Steppage")) return "Steppage";
  return "Normal";
}

const GAIT_LABELS: readonly string[] = ["Normal", "Parkinsonian", "Hemiplegic", "Steppage"];

/**
 * ป้ายของบันทึกใน gait_assessments — คืน null เมื่อ condition ไม่ใช่ป้ายจริง
 * ("No Data" จากรอบที่กล้องไม่ได้เฟรมที่ประเมินได้เลย หรือ "Unknown" จากเอกสารเก่า)
 *
 * ห้ามใช้ normalizePredictionLabel กับค่าพวกนี้: มันจะตี "No Data" เป็น "Normal"
 * แล้วรายงานว่าเดินปกติทั้งที่ไม่เคยวัดอะไรได้
 */
export function storedGaitLabel(condition: string): GaitLabel | null {
  return GAIT_LABELS.includes(condition) ? (condition as GaitLabel) : null;
}
