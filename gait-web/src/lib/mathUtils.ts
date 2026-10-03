// Geometry + NaN-aware helpers ported from main.py.
// A point is a 3D vector in pixel-ish units: [x*width, y*height, z*width].
export type Vec3 = [number, number, number];

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function midpoint(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

export function norm3(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function norm2(x: number, y: number): number {
  return Math.hypot(x, y);
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Angle ABC in degrees for 3D points (vertex at b). */
export function angle3d(a: Vec3, b: Vec3, c: Vec3): number {
  const ba = sub(a, b);
  const bc = sub(c, b);
  const denom = norm3(ba) * norm3(bc);
  if (denom < 1e-6) return NaN;
  let cosine = dot3(ba, bc) / denom;
  cosine = Math.min(1, Math.max(-1, cosine));
  return (Math.acos(cosine) * 180) / Math.PI;
}

/** Distance using x and z only (sagittal plane proxy for step length). */
export function distanceXZ(a: Vec3, b: Vec3): number {
  return norm2(a[0] - b[0], a[2] - b[2]);
}

/**
 * Estimate trunk lean angle relative to vertical. Uses image-plane shoulder-vs-hip
 * displacement plus z displacement as a practical MVP estimate (same as main.py).
 */
export function trunkLeanDegrees(shoulderMid: Vec3, hipMid: Vec3): number {
  const vertical = Math.abs(shoulderMid[1] - hipMid[1]);
  const horizontalDepth = Math.hypot(
    shoulderMid[0] - hipMid[0],
    shoulderMid[2] - hipMid[2],
  );
  if (vertical < 1e-6) return 0;
  return (Math.atan2(horizontalDepth, vertical) * 180) / Math.PI;
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Arm/leg swing asymmetry (|L-R| normalized). Returns NaN when BOTH sides are
 * below `floor` — i.e. the person is essentially standing still — because the
 * ratio explodes toward random large values for two tiny near-equal numbers,
 * which previously produced false "asymmetric" (Parkinsonian/hemiplegic) flags.
 */
export function symmetryIndexFromRanges(left: number, right: number, floor = 0): number {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return NaN;
  if (Math.abs(left) < floor && Math.abs(right) < floor) return NaN;
  const denom = 0.5 * (Math.abs(left) + Math.abs(right)) + 1e-6;
  return Math.abs(left - right) / denom;
}

export function inferWeakSide(leftLegSwing: number, rightLegSwing: number): string {
  if (!Number.isFinite(leftLegSwing) || !Number.isFinite(rightLegSwing)) return "unknown";
  if (Math.abs(leftLegSwing - rightLegSwing) < 0.025) return "unknown";
  return leftLegSwing < rightLegSwing ? "left" : "right";
}

export function minNaN(a: number, b: number): number {
  const vals = [a, b].filter(Number.isFinite);
  return vals.length ? Math.min(...vals) : NaN;
}

export function maxNaN(a: number, b: number): number {
  const vals = [a, b].filter(Number.isFinite);
  return vals.length ? Math.max(...vals) : NaN;
}

export function meanNaN(a: number, b: number): number {
  const vals = [a, b].filter(Number.isFinite);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : NaN;
}

/**
 * Time-windowed sample buffer (replaces the fixed-count RingBuffer).
 *
 * Dynamic gait features are ranges over a *time* window (~1.5 s ≈ a couple of
 * strides). Indexing by sample COUNT made the covered time — and therefore the
 * measured feature — depend on the device frame rate. This buffer evicts samples
 * older than `windowMs`, so the window is the same wall-clock duration on a
 * 24fps phone and a 60fps laptop. `range()` returns NaN until the buffer spans
 * at least `minReadyMs` (the warm-up gate, now in time not frames).
 */
export class TimeWindowBuffer {
  private times: number[] = [];
  private values: number[] = [];

  constructor(
    public windowMs: number,
    public minReadyMs: number,
  ) {}

  push(tMs: number, value: number) {
    this.times.push(tMs);
    this.values.push(value);
    const cutoff = tMs - this.windowMs;
    let drop = 0;
    while (drop < this.times.length && this.times[drop] < cutoff) drop++;
    if (drop > 0) {
      this.times.splice(0, drop);
      this.values.splice(0, drop);
    }
  }

  private spanMs(): number {
    return this.times.length ? this.times[this.times.length - 1] - this.times[0] : 0;
  }

  private ready(): boolean {
    return this.values.length >= 5 && this.spanMs() >= this.minReadyMs;
  }

  /** Peak-to-peak range over the window, or NaN if not enough data yet. */
  range(): number {
    if (!this.ready()) return NaN;
    let mn = Infinity;
    let mx = -Infinity;
    for (const v of this.values) {
      if (!Number.isFinite(v)) continue;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    return mn === Infinity ? NaN : mx - mn;
  }

  /** Smallest value over the window, or NaN if not enough data yet. */
  min(): number {
    if (!this.ready()) return NaN;
    let mn = Infinity;
    for (const v of this.values) if (Number.isFinite(v) && v < mn) mn = v;
    return mn === Infinity ? NaN : mn;
  }

  median(): number {
    return median(this.values);
  }

  clear() {
    this.times = [];
    this.values = [];
  }
}
