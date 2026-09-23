// One camera = one self-contained pose pipeline (capture → pose → features →
// classify → overlay). The two-camera rig is just two <CameraView> instances
// with different `view` props; each owns its own engine + smoothers so they
// never interfere.
import { useEffect, useRef, useState } from "react";
import { PoseEngine } from "../lib/poseEngine";
import { GaitFeatureExtractor, type GaitFeatures } from "../lib/gaitFeatures";
import { RuleBasedGaitClassifier, RuleBasedSideGaitClassifier, type GaitPrediction } from "../lib/classifier";
import { FeatureSmoother, PredictionSmoother } from "../lib/smoothers";
import { POSE_CONFIG, type CameraView as CameraRole } from "../lib/config";
import { drawSkeleton } from "../lib/drawing";
import { useCameraDevices } from "../hooks/useCameraDevices";
import { classifyPosture, type PostureSample } from "../lib/postureDetector";

export interface FrameData {
  features: GaitFeatures | null;
  prediction: GaitPrediction;
}

interface Props {
  view: CameraRole;
  label: string;
  // Called every processed frame. Keep this stable (useRef/useCallback) — it
  // runs at camera frame rate, so do not trigger React renders inside it.
  onFrame?: (data: FrameData) => void;
  // ท่านั่ง/ยืนของทุกเฟรมที่ประมวลผล (ใช้กับตัวจับเวลาจากกล้อง) — ต้องเสถียรและเบา
  // เหมือน onFrame เพราะถูกเรียกตามอัตราเฟรมของกล้อง
  onPose?: (sample: PostureSample) => void;
}

type Status = "off" | "loading" | "ready" | "error";

// ป้ายสถานะกล้องที่แสดงบนหัวกล่อง — ค่า status เป็นรหัสภายใน ห้ามโชว์ตรง ๆ
const STATUS_TH: Record<Status, string> = {
  off: "ปิด",
  loading: "กำลังเปิด",
  ready: "พร้อม",
  error: "ผิดพลาด",
};

// video.requestVideoFrameCallback isn't in older TS DOM libs; type it narrowly.
type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    cb: (now: number, meta: { mediaTime: number; captureTime?: number }) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export default function CameraView({ view, label, onFrame, onPose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const onPoseRef = useRef(onPose);
  useEffect(() => {
    onPoseRef.current = onPose;
  }, [onPose]);

  // Camera starts OFF by default: this component is always mounted (the whole
  // app is one long scrolling page), so auto-starting would prompt for camera
  // permission and run MediaPipe inference the instant the page loads, even if
  // the user never scrolls to the camera section.
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState<Status>("off");
  const [errorMsg, setErrorMsg] = useState("");

  const { devices, refresh: refreshDevices } = useCameraDevices();
  // Remembered per camera role, so a fixed rig doesn't have to be re-picked
  // every visit. "" means "let the browser choose".
  const storageKey = `gc-camera-device:${view}`;
  const [deviceId, setDeviceId] = useState<string>(
    () => localStorage.getItem(storageKey) ?? "",
  );

  const chooseDevice = (id: string) => {
    setDeviceId(id);
    if (id) localStorage.setItem(storageKey, id);
    else localStorage.removeItem(storageKey);
  };

  useEffect(() => {
    if (!on) {
      setStatus("off");
      return;
    }

    let stream: MediaStream | null = null;
    let stopped = false;

    function clearOverlay() {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // ล้างเส้นเก่าทิ้งทุกครั้งที่เริ่มรอบใหม่ (เปิดกล้อง สลับกล้อง หรือโค้ดถูกโหลดใหม่ตอนพัฒนา)
    // React ใช้ canvas ตัวเดิม ภาพโครงกระดูกของรอบก่อนจึงค้างทาบตัวคนระหว่างรอโมเดลพร้อม
    clearOverlay();
    let rafId = 0;
    let rvfcId = 0;
    let lastTMs = -1; // media time of the last PROCESSED frame
    let lastFreshMs = 0; // performance.now() ของผลตรวจจับสด ๆ ล่าสุด (0 = ยังไม่เคยได้)
    let lastMediaTime = -1; // for the rAF fallback's new-frame check

    const engine = new PoseEngine();
    const extractor = new GaitFeatureExtractor({
      windowMs: POSE_CONFIG.windowMs,
      minReadyMs: POSE_CONFIG.minReadyMs,
      bodyHeightWindowMs: POSE_CONFIG.bodyHeightWindowMs,
      swingFloor: POSE_CONFIG.swingFloor,
      minVisibility: POSE_CONFIG.minVisibility,
      gaitWindowMs: POSE_CONFIG.gaitWindowMs,
      minStepIntervalMs: POSE_CONFIG.minStepIntervalMs,
      stepFloorMeters: POSE_CONFIG.stepFloorMeters,
    });
    // The side camera sees the sagittal plane but not L/R symmetry, so it uses a
    // classifier that only reads sagittal-reliable features (see classifier.ts).
    const classifier = view === "side" ? new RuleBasedSideGaitClassifier() : new RuleBasedGaitClassifier();
    const featureSmoother = new FeatureSmoother(POSE_CONFIG.emaTauSeconds);
    const predictionSmoother = new PredictionSmoother(POSE_CONFIG.voteMs);

    // Process exactly one camera frame. tMs is the MEDIA frame time (monotonic),
    // so the feature windows, EMA dt, and vote window all track true capture
    // time rather than render time.
    // clockMs = เวลาที่กล้องถ่ายเฟรมนี้ (ฐาน performance.now) ใช้กับตัวจับเวลา — ต่างจาก tMs
    // (เวลาของวิดีโอ) ตรงที่ไม่ย้อนกลับเป็น 0 เมื่อสตรีมเริ่มใหม่ และไม่รวมเวลาที่รอประมวลผล
    let lastClockMs = -Infinity;
    function processFrame(tMs: number, clockMs: number) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || stopped) return;
      if (video.readyState < 2 || video.videoWidth === 0) return;

      const w = video.videoWidth;
      const h = video.videoHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const result = engine.detect(video, tMs);
      // เฟรมซ้ำ/โมเดลยังไม่พร้อม — ไม่ใช่ "ไม่พบคน" จึงคงภาพโครงกระดูกเดิมไว้ ไม่ล้าง canvas
      // (ถ้าค้างนานผิดปกติ ตัวเฝ้าระวังด้านล่างจะลบเส้นทิ้งและกู้โมเดลให้เอง)
      if (result.skipped) return;
      lastFreshMs = performance.now();

      const { landmarks, worldLandmarks } = result;
      let features: GaitFeatures | null = landmarks ? extractor.extract(landmarks, worldLandmarks, w, h, tMs) : null;
      const dtMs = lastTMs < 0 ? 0 : tMs - lastTMs;
      features = featureSmoother.smooth(features, dtMs);
      const prediction = predictionSmoother.smooth(classifier.predict(features), tMs);
      lastTMs = tMs;

      const ctx = canvas.getContext("2d");
      if (ctx) drawSkeleton(ctx, landmarks, w, h, POSE_CONFIG.minVisibility, prediction.color);

      onFrameRef.current?.({ features, prediction });

      if (onPoseRef.current) {
        const clock = Math.max(lastClockMs + 1, clockMs); // กันนาฬิกาเฟรมเหลื่อมถอยหลัง
        lastClockMs = clock;
        onPoseRef.current(classifyPosture(landmarks, worldLandmarks, w, h, clock));
      }
    }

    // ── ตัวเฝ้าระวังภาพค้าง ──
    // โครงกระดูกที่ค้างทาบตัวคนอ่านผิดได้ง่ายกว่าไม่มีเส้นเลย จึงต้องลบทิ้งเมื่อผลตรวจจับ
    // หยุดนิ่ง ไม่ว่าจะเพราะกล้องหยุดส่งเฟรม ลูปหยุด หรือโมเดลพัง แล้วพยายามกู้โมเดลให้เอง
    const STALE_CLEAR_MS = 1000;
    const STALE_RESTART_MS = 2500;
    let restarting = false;
    const watchdog = window.setInterval(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (stopped || !video || !canvas || !lastFreshMs) return;
      // แท็บถูกซ่อน/วิดีโอหยุดเอง = เบราว์เซอร์หยุดส่งเฟรมตามปกติ ไม่ใช่ระบบพัง
      // ห้ามนับเป็นภาพค้างและห้ามกู้โมเดล ไม่งั้นสลับแท็บทีก็สร้างโมเดลใหม่ทุกครั้ง
      if (document.hidden || video.paused || video.ended) {
        lastFreshMs = performance.now();
        return;
      }
      const idleMs = performance.now() - lastFreshMs;
      if (idleMs > STALE_CLEAR_MS) clearOverlay();
      if (idleMs > STALE_RESTART_MS && !restarting) {
        restarting = true;
        void engine.restart(`ไม่มีผลตรวจจับใหม่ ${Math.round(idleMs)} ms`).finally(() => {
          restarting = false;
          lastFreshMs = performance.now(); // ให้โอกาสโมเดลใหม่ก่อนจะนับรอบถัดไป
        });
      }
    }, 500);

    // ข้อผิดพลาดของเฟรมเดียวต้องไม่ทำให้ลูปตาย: ถ้า processFrame โยน error ออกมา
    // ใน callback ของ requestVideoFrameCallback ตัวลูปจะไม่ลงทะเบียนรอบถัดไป
    // การประมวลผลจะหยุดถาวรทั้งที่ภาพกล้องยังมาอยู่ — โครงกระดูกค้างแล้วหายไป
    let frameErrorLogged = false;
    function safeProcessFrame(tMs: number, clockMs: number) {
      try {
        processFrame(tMs, clockMs);
      } catch (err) {
        if (!frameErrorLogged) {
          frameErrorLogged = true;
          console.error(`[CameraView:${view}] ประมวลผลเฟรมไม่สำเร็จ`, err);
        }
      }
    }

    function startLoop() {
      const video = videoRef.current as RVFCVideo | null;
      if (!video) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        // Preferred: fires once per actual decoded camera frame.
        const cb = (now: number, meta: { mediaTime: number; captureTime?: number }) => {
          if (stopped) return;
          safeProcessFrame(meta.mediaTime * 1000, meta.captureTime ?? now);
          rvfcId = (videoRef.current as RVFCVideo).requestVideoFrameCallback!(cb);
        };
        rvfcId = video.requestVideoFrameCallback(cb);
      } else {
        // Fallback: rAF, but only process when the video actually advanced, so
        // we don't re-run inference on a frame the camera never re-delivered.
        const loop = () => {
          if (stopped) return;
          const v = videoRef.current;
          if (v && v.readyState >= 2 && v.currentTime !== lastMediaTime) {
            lastMediaTime = v.currentTime;
            safeProcessFrame(v.currentTime * 1000, performance.now());
          }
          rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
      }
    }

    async function start() {
      setStatus("loading");
      try {
        await engine.init();

        const size = { width: { ideal: 960 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: deviceId
              ? { deviceId: { exact: deviceId }, ...size }
              : { facingMode: "user", ...size },
          });
        } catch (err) {
          // A remembered camera that has since been unplugged throws
          // OverconstrainedError. Forget it and fall back to the default rather
          // than leaving the user stuck on an error they can't clear.
          if (deviceId && (err as Error).name === "OverconstrainedError") {
            setDeviceId("");
            localStorage.removeItem(storageKey);
            stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: { facingMode: "user", ...size },
            });
          } else {
            throw err;
          }
        }
        if (stopped) return;
        // Labels are only exposed once permission has been granted, so re-read
        // the list now that it has — this is what turns "กล้อง 1" into the real
        // device name in the picker.
        refreshDevices();
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        if (stopped) return;
        setStatus("ready");
        startLoop();
      } catch (err) {
        if (stopped) return;
        setErrorMsg((err as Error).message);
        setStatus("error");
      }
    }

    start();

    return () => {
      stopped = true;
      window.clearInterval(watchdog);
      clearOverlay(); // ปิดกล้องแล้วต้องไม่เหลือโครงกระดูกค้างบนจอ
      cancelAnimationFrame(rafId);
      const v = videoRef.current as RVFCVideo | null;
      if (v && rvfcId && typeof v.cancelVideoFrameCallback === "function") v.cancelVideoFrameCallback(rvfcId);
      stream?.getTracks().forEach((t) => t.stop());
      engine.close();
    };
    // deviceId is a dependency so switching cameras tears the old stream and
    // pose graph down through the cleanup below, then rebuilds on the new one.
  }, [view, on, deviceId, storageKey, refreshDevices]);

  return (
    <div className="gc-cam">
      <div className="gc-cam__header">
        <span>{label}</span>
        <div className="gc-cam__header-right">
          {/* Always shown so staff can assign which physical camera is this
              role, even before granting permission (labels fill in after). */}
          <select
            className="gc-cam__device"
            value={deviceId}
            onChange={(e) => chooseDevice(e.target.value)}
            title="เลือกอุปกรณ์กล้อง"
            aria-label="เลือกอุปกรณ์กล้อง"
          >
            <option value="">กล้องเริ่มต้น</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
            ))}
          </select>
          {status !== "off" && <span className={`gc-cam__badge gc-cam__badge--${status}`}>{STATUS_TH[status]}</span>}
          {on && (
            <button type="button" className="gc-cam__stop-btn" onClick={() => setOn(false)}>
              ปิดกล้อง
            </button>
          )}
        </div>
      </div>
      <div className="gc-cam__stage">
        {on ? (
          <>
            <video ref={videoRef} className="gc-cam__video" muted playsInline />
            <canvas ref={canvasRef} className="gc-cam__overlay" />
            {status === "loading" && <div className="gc-cam__hint">กำลังเตรียมกล้อง…</div>}
            {status === "error" && <div className="gc-cam__hint gc-cam__hint--error">กล้องผิดพลาด: {errorMsg}</div>}
          </>
        ) : (
          <div className="gc-cam__off">
            <button type="button" className="gc-cam__start-btn" onClick={() => setOn(true)}>
              เปิดกล้อง
            </button>
            <p className="gc-cam__off-hint">กล้องยังไม่เปิด กดเพื่อเริ่มตรวจจับท่าทางการเดิน</p>
          </div>
        )}
      </div>
    </div>
  );
}
