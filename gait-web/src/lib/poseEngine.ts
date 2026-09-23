// Thin wrapper around @mediapipe/tasks-vision PoseLandmarker.
// Replaces the `with mp_pose.Pose(...)` block in main.py. Runs in the browser
// on GPU (WebGL/WebGPU) via WASM, so all inference stays on-device (PDPA).
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { MODEL_URLS, POSE_CONFIG, WASM_BASE } from "./config";
import type { RawLandmark } from "./landmarks";

export interface PoseResult {
  landmarks: RawLandmark[] | null;
  // Metric (meters), hip-centered, perspective-corrected 3D landmarks. Used for
  // joint ANGLES, which are far more accurate than angles from the perspective-
  // distorted image landmarks. Null if the model didn't return them.
  worldLandmarks: RawLandmark[] | null;
  /**
   * true = โมเดลไม่ได้รันในเฟรมนี้ (เฟรมซ้ำ / ยังไม่พร้อม / กำลังกู้คืน) ไม่ใช่ "ไม่พบคน"
   * ผู้เรียกต้องข้ามเฟรมนี้ไปเฉย ๆ ห้ามล้างภาพโครงกระดูกทิ้ง ไม่งั้นเส้นจะกะพริบหรือหาย
   */
  skipped: boolean;
}

const EMPTY_SKIPPED: PoseResult = { landmarks: null, worldLandmarks: null, skipped: true };

// พังติดกันกี่เฟรมจึงจะสร้างโมเดลใหม่ (เผื่อกราฟภายในเข้าสถานะ error ถาวร)
const MAX_CONSECUTIVE_ERRORS = 3;

let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;

export class PoseEngine {
  private landmarker: PoseLandmarker | null = null;
  // เวลาของ "วิดีโอ" ที่ได้รับล่าสุด — ใช้จับว่าสตรีมเริ่มนับใหม่หรือเป็นเฟรมซ้ำ
  private lastInputMs = -1;
  // เวลาที่ "ส่งให้ MediaPipe" ล่าสุด — ต้องเพิ่มขึ้นอย่างเดียวเสมอ
  private lastStampMs = -1;
  private offsetMs = 0;
  private consecutiveErrors = 0;
  private reviving = false;

  async init(): Promise<void> {
    if (!filesetPromise) filesetPromise = FilesetResolver.forVisionTasks(WASM_BASE);
    const fileset = await filesetPromise;
    this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URLS[POSE_CONFIG.modelVariant],
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: POSE_CONFIG.minPoseDetectionConfidence,
      minPosePresenceConfidence: POSE_CONFIG.minTrackingConfidence,
      minTrackingConfidence: POSE_CONFIG.minTrackingConfidence,
    });
    this.consecutiveErrors = 0;
  }

  /**
   * Run pose estimation on a video frame. timestampMs is the MEDIA time of the
   * frame and may restart from 0 (สลับกล้อง, กล้องหลุดแล้วต่อใหม่, เครื่องตื่นจากสลีป).
   *
   * ⚠️ กราฟภายในของ MediaPipe จำ "เวลาสูงสุดที่เคยรับ" ไว้เอง ถ้าส่งเวลาที่น้อยกว่านั้น
   * มันจะตอบ INVALID_ARGUMENT (timestamp mismatch) ทุกเฟรมและไม่ฟื้นอีกเลย —
   * โครงกระดูกหายถาวรจนกว่าจะรีเฟรชหน้า จึงต้องแปลงเป็นเวลาที่เดินหน้าอย่างเดียวก่อนส่ง
   */
  detect(video: HTMLVideoElement, timestampMs: number): PoseResult {
    if (!this.landmarker) return EMPTY_SKIPPED;

    // เฟรมเดิมถูกส่งมาซ้ำ — ข้ามไป ไม่ต้องรันโมเดล และต้องไม่ล้างภาพเดิมทิ้ง
    if (timestampMs === this.lastInputMs) return EMPTY_SKIPPED;

    // เวลาถอยหลัง = สตรีมเริ่มนับใหม่ → เลื่อนฐานเวลาให้ต่อจากเฟรมล่าสุดที่เคยส่ง
    if (timestampMs < this.lastInputMs) this.offsetMs = this.lastStampMs + 1 - timestampMs;
    this.lastInputMs = timestampMs;

    const stamp = Math.max(this.lastStampMs + 1, Math.round(timestampMs + this.offsetMs));
    this.lastStampMs = stamp;

    try {
      const out = this.landmarker.detectForVideo(video, stamp);
      this.consecutiveErrors = 0;
      const landmarks = (out.landmarks?.[0] ?? null) as RawLandmark[] | null;
      const worldLandmarks = (out.worldLandmarks?.[0] ?? null) as RawLandmark[] | null;
      return { landmarks, worldLandmarks, skipped: false };
    } catch (err) {
      // ตาข่ายกันเหนียว: ถ้ากราฟเข้าสถานะ error ถาวรด้วยเหตุอื่น ให้สร้างโมเดลใหม่
      // ผู้ใช้จะได้โครงกระดูกกลับมาเองโดยไม่ต้องรีเฟรชหน้า
      if (++this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) void this.restart(err);
      return EMPTY_SKIPPED;
    }
  }

  /** สร้างตัวจับท่าทางใหม่ทั้งตัว — ผู้เรียกใช้เมื่อผลตรวจจับหยุดนิ่งผิดปกติ */
  async restart(cause: unknown): Promise<void> {
    if (this.reviving) return;
    this.reviving = true;
    console.warn("[PoseEngine] ตัวจับท่าทางพัง กำลังสร้างใหม่", cause);
    try {
      this.landmarker?.close();
    } catch {
      // กราฟที่พังอยู่แล้วอาจปิดไม่สำเร็จ — ปล่อยให้ตัวเก็บขยะจัดการ
    }
    this.landmarker = null;
    this.lastInputMs = -1;
    this.lastStampMs = -1;
    this.offsetMs = 0;
    try {
      await this.init();
    } catch (err) {
      console.error("[PoseEngine] สร้างตัวจับท่าทางใหม่ไม่สำเร็จ", err);
    } finally {
      this.reviving = false;
    }
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
