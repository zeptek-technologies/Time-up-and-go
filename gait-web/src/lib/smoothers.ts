// Ports of FeatureSmoother and PredictionSmoother from main.py, made
// frame-rate-invariant (time-based time constants instead of per-frame ones).
import type { GaitFeatures } from "./gaitFeatures";
import type { GaitPrediction } from "./classifier";

const NUMERIC_FIELDS: (keyof GaitFeatures)[] = [
  "leftKneeAngle", "rightKneeAngle", "leftKneeAngleMin", "rightKneeAngleMin", "leftHipAngle", "rightHipAngle",
  "stepLength", "leftArmSwing", "rightArmSwing", "meanArmSwing", "armSwingAsymmetry",
  "symmetryIndex", "trunkLean", "leftKneeLift", "rightKneeLift",
];

// Ignore absurd dt (tab backgrounded, stalls) so one long gap can't blow the
// EMA all the way to the new value or freeze it.
const MAX_DT_S = 0.25;

/**
 * Exponential moving-average filter over scalar features. The original used a
 * fixed per-frame alpha, so the smoothing time constant silently changed with
 * frame rate. Here alpha = 1 - exp(-dt/tau) for a fixed tau in seconds, giving
 * the same wall-clock lag on a 24fps phone and a 60fps laptop.
 */
export class FeatureSmoother {
  private state = new Map<keyof GaitFeatures, number>();
  constructor(private tauSeconds = 0.065) {}

  reset() {
    this.state.clear();
  }

  smooth(features: GaitFeatures | null, dtMs: number): GaitFeatures | null {
    // Lost pose: clear state so re-entry starts fresh instead of blending
    // against stale values from a previous position.
    if (!features) {
      this.reset();
      return null;
    }
    const dt = Math.min(Math.max(dtMs, 0) / 1000, MAX_DT_S);
    const alpha = dt > 0 ? 1 - Math.exp(-dt / this.tauSeconds) : 1;
    for (const field of NUMERIC_FIELDS) {
      const value = features[field] as number;
      if (!Number.isFinite(value)) continue;
      const previous = this.state.get(field);
      const smoothed = previous === undefined ? value : alpha * value + (1 - alpha) * previous;
      this.state.set(field, smoothed);
      (features[field] as number) = smoothed;
    }
    return features;
  }
}

/**
 * Majority-vote filter over predictions within the last `voteMs` (was a fixed
 * frame count, so the vote covered a different time span at different fps).
 */
export class PredictionSmoother {
  private history: { t: number; prediction: GaitPrediction }[] = [];
  constructor(private voteMs = 300) {}

  reset() {
    this.history = [];
  }

  smooth(prediction: GaitPrediction, tMs: number): GaitPrediction {
    this.history.push({ t: tMs, prediction });
    const cutoff = tMs - this.voteMs;
    while (this.history.length && this.history[0].t < cutoff) this.history.shift();

    const counts = new Map<string, number>();
    for (const h of this.history) counts.set(h.prediction.status, (counts.get(h.prediction.status) ?? 0) + 1);
    let majority = prediction.status;
    let best = -1;
    for (const [status, c] of counts) {
      if (c > best) {
        best = c;
        majority = status;
      }
    }
    // Return the most recent prediction carrying the majority status so the
    // reasons/color shown stay consistent with the chosen label.
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].prediction.status === majority) return this.history[i].prediction;
    }
    return prediction;
  }
}
