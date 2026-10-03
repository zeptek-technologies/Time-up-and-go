// Port of GaitFeatureExtractor from main.py, hardened for accuracy/reproducibility.
// Extracts biometric gait metrics from MediaPipe landmarks. Distances are
// normalized by a STABLE (median, windowed) body-height estimate so heuristic
// thresholds are less dependent on camera resolution and per-frame jitter.
import { LM, type RawLandmark } from "./landmarks";
import {
  type Vec3,
  angle3d,
  distanceXZ,
  inferWeakSide,
  meanNaN,
  median,
  midpoint,
  norm2,
  symmetryIndexFromRanges,
  TimeWindowBuffer,
  trunkLeanDegrees,
} from "./mathUtils";
import { HEMIPLEGIC_ARM_SWING_MAX } from "./classifier";
import { StepTracker } from "./stepTracker";

export interface GaitFeatures {
  leftKneeAngle: number;
  rightKneeAngle: number;
  // Smallest knee angle over the feature window (= peak swing-phase flexion).
  // The instantaneous angle only dips while the foot is in the air, so a rule
  // reading it flickers on/off every stride; the windowed minimum is steady for
  // as long as the pattern persists — same basis as the (windowed) knee lift.
  leftKneeAngleMin: number;
  rightKneeAngleMin: number;
  leftHipAngle: number;
  rightHipAngle: number;
  stepLength: number;
  leftArmSwing: number;
  rightArmSwing: number;
  meanArmSwing: number;
  armSwingAsymmetry: number;
  symmetryIndex: number;
  trunkLean: number;
  leftKneeLift: number;
  rightKneeLift: number;
  leftArmCloseToChest: boolean;
  rightArmCloseToChest: boolean;
  weakSide: string;
  // Real gait-cycle metrics (rates are NaN until a few steps accumulate).
  cadence: number; // steps / minute
  stepTime: number; // seconds between steps
  stepTimeVariability: number; // coefficient of variation (%)
  stepCount: number; // cumulative steps since the camera started
}

export interface ExtractorOptions {
  windowMs: number;
  minReadyMs: number;
  bodyHeightWindowMs: number;
  swingFloor: number;
  minVisibility: number;
  gaitWindowMs: number;
  minStepIntervalMs: number;
  stepFloorMeters: number;
}

const REQUIRED = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
];

export class GaitFeatureExtractor {
  // Raw pixel signals are buffered; ranges are divided by ONE windowed scale,
  // so the normalizer factors out as a constant instead of jittering per frame.
  private leftWristRelX: TimeWindowBuffer;
  private rightWristRelX: TimeWindowBuffer;
  private leftAnkleX: TimeWindowBuffer;
  private rightAnkleX: TimeWindowBuffer;
  private leftKneeY: TimeWindowBuffer;
  private rightKneeY: TimeWindowBuffer;
  private leftKneeAngleBuf: TimeWindowBuffer;
  private rightKneeAngleBuf: TimeWindowBuffer;
  private bodyHeight: TimeWindowBuffer;
  private stepTracker: StepTracker;

  constructor(private readonly opts: ExtractorOptions) {
    const mk = () => new TimeWindowBuffer(opts.windowMs, opts.minReadyMs);
    this.leftWristRelX = mk();
    this.rightWristRelX = mk();
    this.leftAnkleX = mk();
    this.rightAnkleX = mk();
    this.leftKneeY = mk();
    this.rightKneeY = mk();
    this.leftKneeAngleBuf = mk();
    this.rightKneeAngleBuf = mk();
    this.bodyHeight = new TimeWindowBuffer(opts.bodyHeightWindowMs, 0);
    this.stepTracker = new StepTracker(opts.gaitWindowMs, opts.minStepIntervalMs, opts.stepFloorMeters);
  }

  extract(
    landmarks: RawLandmark[],
    worldLandmarks: RawLandmark[] | null,
    width: number,
    height: number,
    tMs: number,
  ): GaitFeatures | null {
    const points = this.landmarkDict(landmarks, width, height);
    if (!REQUIRED.every((idx) => points.has(idx))) return null;
    // World landmarks (meters, hip-centered, perspective-corrected) — used for
    // JOINT ANGLES only. Fall back to image landmarks per-joint if unavailable.
    const world = this.worldDict(worldLandmarks);

    const p = (i: number) => points.get(i)!;
    const leftShoulder = p(LM.LEFT_SHOULDER);
    const rightShoulder = p(LM.RIGHT_SHOULDER);
    const leftHip = p(LM.LEFT_HIP);
    const rightHip = p(LM.RIGHT_HIP);
    const leftKnee = p(LM.LEFT_KNEE);
    const rightKnee = p(LM.RIGHT_KNEE);
    const leftAnkle = p(LM.LEFT_ANKLE);
    const rightAnkle = p(LM.RIGHT_ANKLE);
    const leftWrist = p(LM.LEFT_WRIST);
    const rightWrist = p(LM.RIGHT_WRIST);

    const frameBodyHeight = this.estimateBodyHeight(points);
    if (frameBodyHeight <= 1.0) return null;
    // Stable scale = median body-height over a short window. Using the per-frame
    // value made every normalized feature jitter (and drift as the subject walks
    // toward/away from the camera); the median tracks the genuine scale change
    // while suppressing landmark jitter.
    this.bodyHeight.push(tMs, frameBodyHeight);
    const scale = Math.max(this.bodyHeight.median() || frameBodyHeight, 1);

    const shoulderMid = midpoint(leftShoulder, rightShoulder);
    const hipMid = midpoint(leftHip, rightHip);

    // Joint angles from world landmarks (perspective-corrected) when available,
    // else from image landmarks. Angles stay in degrees either way, so existing
    // angle thresholds remain valid — just measured more accurately.
    const angleAt = (ia: number, ib: number, ic: number, ai: Vec3, bi: Vec3, ci: Vec3): number => {
      const a = world.get(ia);
      const b = world.get(ib);
      const c = world.get(ic);
      return a && b && c ? angle3d(a, b, c) : angle3d(ai, bi, ci);
    };
    const leftKneeAngle = angleAt(LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE, leftHip, leftKnee, leftAnkle);
    const rightKneeAngle = angleAt(LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE, rightHip, rightKnee, rightAnkle);
    const leftHipAngle = angleAt(LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_KNEE, leftShoulder, leftHip, leftKnee);
    const rightHipAngle = angleAt(LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_KNEE, rightShoulder, rightHip, rightKnee);
    // Step length from ANKLES (always present per REQUIRED). The old code fell
    // back from heel to ankle per-side independently, which silently mixed two
    // measurement bases and biased L/R asymmetry; ankles are consistent.
    const stepLength = distanceXZ(leftAnkle, rightAnkle) / scale;
    const trunkLean = trunkLeanDegrees(shoulderMid, hipMid);

    // Feed the step detector the METRIC fore-aft ankle separation from world
    // landmarks (leftAnkle.z − rightAnkle.z, meters) → step count, cadence, and
    // step-time variability. This forward-motion signal is far stronger than the
    // old image x-separation for a frontal camera (see stepTracker.ts). When the
    // world ankles aren't available this frame, we simply don't push — the
    // detector is time-windowed, so a dropped sample is harmless.
    const wLeftAnkle = world.get(LM.LEFT_ANKLE);
    const wRightAnkle = world.get(LM.RIGHT_ANKLE);
    if (wLeftAnkle && wRightAnkle) {
      this.stepTracker.push(tMs, wLeftAnkle[2] - wRightAnkle[2]);
    }
    const gait = this.stepTracker.metrics();

    // Buffer RAW pixel signals (time-windowed); divide ranges by the stable scale.
    this.leftWristRelX.push(tMs, leftWrist[0] - leftHip[0]);
    this.rightWristRelX.push(tMs, rightWrist[0] - rightHip[0]);
    this.leftAnkleX.push(tMs, leftAnkle[0]);
    this.rightAnkleX.push(tMs, rightAnkle[0]);
    this.leftKneeY.push(tMs, leftKnee[1]);
    this.rightKneeY.push(tMs, rightKnee[1]);
    if (Number.isFinite(leftKneeAngle)) this.leftKneeAngleBuf.push(tMs, leftKneeAngle);
    if (Number.isFinite(rightKneeAngle)) this.rightKneeAngleBuf.push(tMs, rightKneeAngle);
    const leftKneeAngleMin = this.leftKneeAngleBuf.min();
    const rightKneeAngleMin = this.rightKneeAngleBuf.min();

    const leftArmSwing = this.leftWristRelX.range() / scale;
    const rightArmSwing = this.rightWristRelX.range() / scale;
    const meanArmSwing = meanNaN(leftArmSwing, rightArmSwing);
    const armSwingAsymmetry = symmetryIndexFromRanges(leftArmSwing, rightArmSwing, this.opts.swingFloor);

    const leftLegSwing = this.leftAnkleX.range() / scale;
    const rightLegSwing = this.rightAnkleX.range() / scale;
    const symmetryIndex = symmetryIndexFromRanges(leftLegSwing, rightLegSwing, this.opts.swingFloor);

    const leftKneeLift = this.leftKneeY.range() / scale;
    const rightKneeLift = this.rightKneeY.range() / scale;

    const leftArmClose = isArmHeldCloseToChest(leftWrist, leftShoulder, leftHip, scale, leftArmSwing);
    const rightArmClose = isArmHeldCloseToChest(rightWrist, rightShoulder, rightHip, scale, rightArmSwing);
    const weakSide = inferWeakSide(leftLegSwing, rightLegSwing);

    return {
      leftKneeAngle, rightKneeAngle, leftKneeAngleMin, rightKneeAngleMin, leftHipAngle, rightHipAngle,
      stepLength, leftArmSwing, rightArmSwing, meanArmSwing, armSwingAsymmetry,
      symmetryIndex, trunkLean, leftKneeLift, rightKneeLift,
      leftArmCloseToChest: leftArmClose,
      rightArmCloseToChest: rightArmClose,
      weakSide,
      cadence: gait.cadence,
      stepTime: gait.stepTime,
      stepTimeVariability: gait.stepTimeVariability,
      stepCount: gait.stepCount,
    };
  }

  reset() {
    this.leftWristRelX.clear();
    this.rightWristRelX.clear();
    this.leftAnkleX.clear();
    this.rightAnkleX.clear();
    this.leftKneeY.clear();
    this.rightKneeY.clear();
    this.leftKneeAngleBuf.clear();
    this.rightKneeAngleBuf.clear();
    this.bodyHeight.clear();
    this.stepTracker.reset();
  }

  private landmarkDict(landmarks: RawLandmark[], width: number, height: number): Map<number, Vec3> {
    const points = new Map<number, Vec3>();
    landmarks.forEach((lm, idx) => {
      if ((lm.visibility ?? 0) < this.opts.minVisibility) return;
      points.set(idx, [lm.x * width, lm.y * height, lm.z * width]);
    });
    return points;
  }

  // World landmarks are already in metric, hip-centered, perspective-corrected
  // space — no width/height scaling. Gated by the same visibility threshold.
  private worldDict(landmarks: RawLandmark[] | null): Map<number, Vec3> {
    const points = new Map<number, Vec3>();
    if (!landmarks) return points;
    landmarks.forEach((lm, idx) => {
      if ((lm.visibility ?? 0) < this.opts.minVisibility) return;
      points.set(idx, [lm.x, lm.y, lm.z]);
    });
    return points;
  }

  private estimateBodyHeight(points: Map<number, Vec3>): number {
    const ls = points.get(LM.LEFT_SHOULDER);
    const rs = points.get(LM.RIGHT_SHOULDER);
    const lh = points.get(LM.LEFT_HIP);
    const rh = points.get(LM.RIGHT_HIP);
    const la = points.get(LM.LEFT_ANKLE);
    const ra = points.get(LM.RIGHT_ANKLE);
    if (!ls || !rs || !lh || !rh || !la || !ra) return 0;
    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const ankleMid = midpoint(la, ra);
    const torso = norm2(shoulderMid[0] - hipMid[0], shoulderMid[1] - hipMid[1]);
    const lowerBody = norm2(hipMid[0] - ankleMid[0], hipMid[1] - ankleMid[1]);
    return torso + lowerBody;
  }
}

function isArmHeldCloseToChest(
  wrist: Vec3,
  shoulder: Vec3,
  hip: Vec3,
  scale: number,
  armSwing: number,
): boolean {
  const torsoMid = midpoint(shoulder, hip);
  const wristToTorso = norm2((wrist[0] - torsoMid[0]) / scale, (wrist[1] - torsoMid[1]) / scale);
  const between =
    Math.min(shoulder[1], hip[1]) <= wrist[1] &&
    wrist[1] <= Math.max(shoulder[1], hip[1]) + 0.12 * scale;
  const reducedSwing = Number.isFinite(armSwing) && armSwing < HEMIPLEGIC_ARM_SWING_MAX;
  return wristToTorso < 0.28 && between && reducedSwing;
}

// Re-exported for potential external use / tests.
export { median };
