// ตั้งค่าระยะเซนเซอร์ของอุปกรณ์เก้าอี้และจุดหมุนตัว
//
// เว็บบันทึก "ค่าที่ขอ" ลง device_commands/<อุปกรณ์> → อุปกรณ์ตรวจช่วงค่า จำลง flash แล้วรายงาน
// "ค่าที่ใช้อยู่จริง" กลับใน device_status/<อุปกรณ์> (cfg_*) - การ์ดเทียบสองค่านี้เพื่อบอกว่าอุปกรณ์รับแล้วหรือยัง
// ช่องกรอกตามค่าล่าสุดจาก Firestore เองจนกว่าเจ้าหน้าที่จะเริ่มแก้ (draft) จะได้ไม่ทับค่าที่อีกเครื่องเพิ่งบันทึก
import { useId, useState } from "react";
import { useDeviceStatus, type DeviceView } from "../hooks/useDeviceStatus";
import { useDeviceConfig } from "../hooks/useDeviceConfig";
import { useCameraStatus } from "../hooks/useCameraStatus";
import { useTimingSource } from "../hooks/useTimingSource";
import { saveChairDistances, saveCheckpointDistances, saveTimingSource, type TimingSource } from "../lib/firebase";
import {
  CHAIR_DEFAULTS,
  CHECKPOINT_DEFAULTS,
  LIMITS,
  SCALE_MAX_CM,
  chairError,
  checkpointError,
  type ChairDistances,
  type CheckpointDistances,
} from "../lib/deviceConfig";
import "./device-settings.css";

const same = (a: number, b: number) => Math.abs(a - b) < 0.05;

export default function DeviceSettingsSection() {
  return (
    <>
      <div className="section-header">
        <div>
          <span className="section-header__eyebrow">Device settings</span>
          <h2 className="section-header__title">ตั้งค่าอุปกรณ์</h2>
        </div>
      </div>
      <p className="devset-intro">
        เลือกตัวจับเวลา และปรับระยะที่อุปกรณ์ใช้ตัดสินว่าผู้ทดสอบนั่ง ลุก หรือเดินมาถึงจุดหมุนตัว ให้ผู้ทดสอบอยู่ในท่าจริงก่อน
        แล้วดู “ระยะที่อ่านได้ตอนนี้” ประกอบการตั้งค่า อุปกรณ์จะใช้ค่าใหม่เมื่อไม่ได้อยู่ระหว่างรอบทดสอบ
      </p>
      <TimingSourceCard />
      <div className="devset-grid">
        <ChairCard />
        <CheckpointCard />
      </div>
    </>
  );
}

// ─────────────────────────── แหล่งจับเวลา ───────────────────────────
const TIMING_OPTIONS: Array<{ value: TimingSource; title: string; detail: string }> = [
  {
    value: "camera",
    title: "กล้อง",
    detail: "เริ่มเมื่อกล้องด้านข้างเห็นผู้ทดสอบลุก หยุดเมื่อนั่งลง · เซนเซอร์เก้าอี้เป็นตัวสำรอง ต้องเปิดหน้ากล้องไว้",
  },
  {
    value: "hardware",
    title: "ฮาร์ดแวร์",
    detail: "ใช้เซนเซอร์ระยะที่เก้าอี้และจุดหมุนตัว · กล้องใช้บันทึกท่าเดินอย่างเดียว",
  },
];

function TimingSourceCard() {
  const { source, loaded } = useTimingSource();
  const chair = useDeviceStatus("chair");
  const camera = useCameraStatus();
  const [saving, setSaving] = useState<TimingSource | null>(null);
  const [failed, setFailed] = useState(false);
  const name = useId();

  // สลับกลางรอบ = รอบนั้นเสีย (หน้ากล้องจะยกเลิกรอบที่กล้องจับอยู่) จึงล็อกไว้ระหว่างทดสอบ
  const testing =
    (camera.fresh && camera.phase === "running") ||
    (chair.online && ["RUNNING", "RETURNING"].includes(chair.state.toUpperCase()));
  const shown = saving ?? source;

  const choose = async (next: TimingSource) => {
    if (next === source || testing || saving) return;
    setSaving(next);
    setFailed(false);
    try {
      await saveTimingSource(next);
    } catch (err) {
      console.error("[TimingSource]", err);
      setFailed(true);
    } finally {
      setSaving(null);
    }
  };

  const note: Sync = failed
    ? { tone: "warn", text: "บันทึกไม่สำเร็จ ลองอีกครั้ง" }
    : testing
      ? { tone: "wait", text: "กำลังทดสอบอยู่ - เปลี่ยนได้หลังจบรอบ" }
      : saving
        ? { tone: "wait", text: "กำลังบันทึก…" }
        : { tone: "ok", text: "มีผลตั้งแต่รอบถัดไป ทั้งหน้ากล้องและจอสถานะ · ผลรอบก่อนหน้าไม่เปลี่ยน" };

  return (
    <article className="devset-card devset-timing" aria-labelledby="devset-timing-title">
      <header className="devset-card__head">
        <div>
          <h3 id="devset-timing-title">จับเวลาจาก</h3>
          <p>เลือกว่าจะใช้อะไรเป็นตัวจับเวลาหลักของการทดสอบ</p>
        </div>
      </header>
      <div className="devset-timing__options" role="radiogroup" aria-labelledby="devset-timing-title">
        {TIMING_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`devset-timing__option${shown === opt.value ? " is-selected" : ""}${testing ? " is-locked" : ""}`}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={shown === opt.value}
              disabled={!loaded || testing || saving !== null}
              onChange={() => void choose(opt.value)}
            />
            <span>
              <strong>{opt.title}</strong>
              <small>{opt.detail}</small>
            </span>
          </label>
        ))}
      </div>
      <p className={`devset-sync devset-sync--${note.tone}`} role="status">
        {note.text}
      </p>
    </article>
  );
}

// ─────────────────────────── เก้าอี้ ───────────────────────────
function ChairCard() {
  const status = useDeviceStatus("chair");
  const requested = useDeviceConfig("chair");

  const applied: ChairDistances | null =
    status.cfgSitCm > 0 && status.cfgStandCm > 0 ? { sitCm: status.cfgSitCm, standCm: status.cfgStandCm } : null;
  const saved: ChairDistances | null =
    requested?.sitCm != null && requested.standCm != null
      ? { sitCm: requested.sitCm, standCm: requested.standCm }
      : null;
  const remote = saved ?? applied ?? CHAIR_DEFAULTS;

  const [draft, setDraft] = useState<ChairDistances | null>(null);
  const value = draft ?? remote;
  const dirty = draft !== null && !(same(draft.sitCm, remote.sitCm) && same(draft.standCm, remote.standCm));
  const error = chairError(value);
  const save = useSave(() => saveChairDistances(value), () => setDraft(null));
  const pending =
    saved !== null && (applied === null || !(same(saved.sitCm, applied.sitCm) && same(saved.standCm, applied.standCm)));
  const atDefaults = same(value.sitCm, CHAIR_DEFAULTS.sitCm) && same(value.standCm, CHAIR_DEFAULTS.standCm);

  const reading = status.online ? status.distanceCm : null;
  const live = status.distanceLive;
  const sit = Number.isFinite(value.sitCm) ? value.sitCm : 0;
  const stand = Number.isFinite(value.standCm) ? value.standCm : sit;
  // ไม่ได้รับเสียงสะท้อน = ไม่มีวัตถุในระยะ → อุปกรณ์นับเป็น "ลุกแล้ว/เก้าอี้ว่าง" (ดู READY ใน ESP_Chair_v2.ino)
  const verdict =
    reading === null || reading < 0
      ? null
      : !live
        ? "อุปกรณ์มองว่า: ไม่มีคนนั่ง"
        : reading <= sit
          ? "อุปกรณ์มองว่า: นั่งอยู่"
          : reading > stand
            ? "อุปกรณ์มองว่า: ลุกแล้ว"
            : "อยู่ในช่วงกันสั่น (ยังไม่เปลี่ยนสถานะ)";

  return (
    <article className="devset-card" aria-labelledby="devset-chair-title">
      <header className="devset-card__head">
        <div>
          <h3 id="devset-chair-title">
            เก้าอี้ <small>จุดเริ่ม / จุดสิ้นสุด</small>
          </h3>
          <p>เซนเซอร์วัดระยะถึงตัวผู้ทดสอบที่นั่งอยู่</p>
        </div>
        <Reading status={status} reading={reading} live={live} verdict={verdict} />
      </header>

      <ZoneBar
        label={`นั่งเมื่อระยะไม่เกิน ${sit} ซม. ลุกเมื่อระยะมากกว่า ${stand} ซม.`}
        reading={reading}
        live={live}
        thresholds={[sit, stand]}
        zones={[
          { from: 0, to: sit, tone: "sit", label: `นั่ง 0-${sit} ซม.` },
          { from: sit, to: stand, tone: "gap", label: `ช่วงกันสั่น ${sit}-${stand} ซม.` },
          { from: stand, to: SCALE_MAX_CM, tone: "stand", label: `ลุก มากกว่า ${stand} ซม.` },
        ]}
      />

      <DistanceField
        label="ถือว่านั่งอยู่ เมื่อระยะไม่เกิน"
        hint={`ค่าเริ่มต้น ${CHAIR_DEFAULTS.sitCm} ซม. · ตั้งให้มากกว่าระยะที่อ่านได้ตอนนั่งเล็กน้อย`}
        value={value.sitCm}
        min={LIMITS.sit.min}
        max={LIMITS.sit.max}
        onChange={(sitCm) => setDraft({ ...value, sitCm })}
      />
      <DistanceField
        label="ถือว่าลุกแล้ว เมื่อระยะมากกว่า"
        hint={`ค่าเริ่มต้น ${CHAIR_DEFAULTS.standCm} ซม. · ต้องมากกว่าระยะนั่งอย่างน้อย ${LIMITS.gap} ซม.`}
        value={value.standCm}
        min={LIMITS.stand.min}
        max={LIMITS.stand.max}
        onChange={(standCm) => setDraft({ ...value, standCm })}
      />

      <CardActions
        error={error}
        dirty={dirty}
        saveState={save.state}
        sync={syncNote(status, applied !== null, pending)}
        atDefaults={atDefaults}
        onSave={save.submit}
        onCancel={() => setDraft(null)}
        onDefaults={() => setDraft({ ...CHAIR_DEFAULTS })}
      />
    </article>
  );
}

// ─────────────────────────── จุดหมุนตัว ───────────────────────────
function CheckpointCard() {
  const status = useDeviceStatus("checkpoint");
  const requested = useDeviceConfig("checkpoint");

  const applied: CheckpointDistances | null = status.cfgDetectCm > 0 ? { detectCm: status.cfgDetectCm } : null;
  const saved: CheckpointDistances | null = requested?.detectCm != null ? { detectCm: requested.detectCm } : null;
  const remote = saved ?? applied ?? CHECKPOINT_DEFAULTS;

  const [draft, setDraft] = useState<CheckpointDistances | null>(null);
  const value = draft ?? remote;
  const dirty = draft !== null && !same(draft.detectCm, remote.detectCm);
  const error = checkpointError(value);
  const save = useSave(() => saveCheckpointDistances(value), () => setDraft(null));
  const pending = saved !== null && (applied === null || !same(saved.detectCm, applied.detectCm));
  const atDefaults = same(value.detectCm, CHECKPOINT_DEFAULTS.detectCm);

  const reading = status.online ? status.distanceCm : null;
  const live = status.distanceLive;
  const detect = Number.isFinite(value.detectCm) ? value.detectCm : 0;
  const verdict =
    reading === null || reading < 0
      ? null
      : live && reading < detect
        ? "อุปกรณ์มองว่า: มีคนมาถึงแล้ว"
        : "อุปกรณ์มองว่า: ยังไม่มีคน";

  return (
    <article className="devset-card" aria-labelledby="devset-checkpoint-title">
      <header className="devset-card__head">
        <div>
          <h3 id="devset-checkpoint-title">
            จุดหมุนตัว <small>ระยะ 3 เมตร</small>
          </h3>
          <p>เซนเซอร์ตรวจว่าผู้ทดสอบเดินมาถึงแล้ว</p>
        </div>
        <Reading status={status} reading={reading} live={live} verdict={verdict} />
      </header>

      <ZoneBar
        label={`ถือว่ามาถึงเมื่อระยะน้อยกว่า ${detect} ซม.`}
        reading={reading}
        live={live}
        thresholds={[detect]}
        zones={[
          { from: 0, to: detect, tone: "near", label: `มาถึง น้อยกว่า ${detect} ซม.` },
          { from: detect, to: SCALE_MAX_CM, tone: "far", label: `ยังไม่ถึง ${detect} ซม. ขึ้นไป` },
        ]}
      />

      <DistanceField
        label="ถือว่าผู้ทดสอบมาถึง เมื่อระยะน้อยกว่า"
        hint={`ค่าเริ่มต้น ${CHECKPOINT_DEFAULTS.detectCm} ซม. · ถ้าผู้ทดสอบหมุนตัวห่างจากเซนเซอร์ ให้เพิ่มค่านี้`}
        value={value.detectCm}
        min={LIMITS.detect.min}
        max={LIMITS.detect.max}
        onChange={(detectCm) => setDraft({ detectCm })}
      />

      <CardActions
        error={error}
        dirty={dirty}
        saveState={save.state}
        sync={syncNote(status, applied !== null, pending)}
        atDefaults={atDefaults}
        onSave={save.submit}
        onCancel={() => setDraft(null)}
        onDefaults={() => setDraft({ ...CHECKPOINT_DEFAULTS })}
      />
    </article>
  );
}

// ─────────────────────────── ส่วนประกอบร่วม ───────────────────────────
type SaveState = "idle" | "saving" | "error";

function useSave(run: () => Promise<void>, onDone: () => void) {
  const [state, setState] = useState<SaveState>("idle");
  const submit = async () => {
    setState("saving");
    try {
      await run();
      onDone();
      setState("idle");
    } catch (err) {
      console.error("[DeviceSettings]", err);
      setState("error");
    }
  };
  return { state, submit };
}

type Sync = { tone: "ok" | "wait" | "warn"; text: string };

function syncNote(status: DeviceView, supported: boolean, pending: boolean): Sync {
  if (!status.known) return { tone: "warn", text: "ยังไม่เคยได้รับข้อมูลจากอุปกรณ์นี้" };
  if (!supported) return { tone: "warn", text: "อุปกรณ์ยังใช้ซอฟต์แวร์รุ่นเก่า ต้องอัปเดตก่อน ค่าที่ตั้งจึงจะมีผล" };
  if (!status.online) {
    return { tone: "warn", text: pending ? "อุปกรณ์ออฟไลน์ - จะใช้ค่าที่บันทึกไว้เมื่อกลับมาออนไลน์" : "อุปกรณ์ออฟไลน์" };
  }
  if (pending) return { tone: "wait", text: "บันทึกแล้ว รออุปกรณ์รับค่า… (ถ้ากำลังทดสอบ จะใช้ค่าใหม่หลังจบรอบ)" };
  return { tone: "ok", text: "อุปกรณ์ใช้ค่านี้อยู่" };
}

const fmtCm = (cm: number) => (cm > SCALE_MAX_CM ? `>${SCALE_MAX_CM} ซม.` : `${cm.toFixed(0)} ซม.`);

function Reading({
  status,
  reading,
  live,
  verdict,
}: {
  status: DeviceView;
  reading: number | null;
  live: boolean;
  verdict: string | null;
}) {
  // ไม่ได้รับเสียงสะท้อนเป็นเรื่องปกติเมื่อไม่มีคน/ของอยู่หน้าเซนเซอร์ จึงแสดงแบบเรียบ ๆ ไม่ใช่สีเตือน
  let muted = false;
  let value = "-";
  let sub = "อัปเดตประมาณทุก 15 วินาที";
  if (!status.known || !status.online) sub = "อุปกรณ์ออฟไลน์";
  else if (reading === null) sub = "อุปกรณ์ยังไม่ได้ส่งค่า";
  else if (reading < 0) {
    muted = true;
    value = "ไม่มีเสียงสะท้อน";
    sub = "ยังไม่เคยวัดได้ตั้งแต่เปิดเครื่อง - ถ้ามีคนอยู่หน้าเซนเซอร์แล้วยังขึ้นแบบนี้ ให้เช็คสายและทิศทาง";
  } else if (!live) {
    muted = true;
    value = "ไม่มีเสียงสะท้อน";
    sub = `${verdict ? `${verdict} · ` : ""}ค่าล่าสุดที่วัดได้ ${fmtCm(reading)}`;
  } else {
    value = fmtCm(reading);
    if (verdict) sub = verdict;
  }
  return (
    <div className={`devset-reading ${muted ? "devset-reading--muted" : ""}`}>
      <span>ระยะที่อ่านได้ตอนนี้</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}

type Zone = { from: number; to: number; tone: "sit" | "gap" | "stand" | "near" | "far"; label: string };

function ZoneBar({
  zones,
  reading,
  live,
  thresholds,
  label,
}: {
  zones: Zone[];
  reading: number | null;
  live: boolean;
  thresholds: number[];
  label: string;
}) {
  const pos = (cm: number) => (Math.min(SCALE_MAX_CM, Math.max(0, cm)) / SCALE_MAX_CM) * 100;
  const marker = reading !== null && reading >= 0 ? pos(reading) : null;
  const edge =
    (marker === null ? "" : marker < 12 ? " devset-zones__marker--start" : marker > 88 ? " devset-zones__marker--end" : "") +
    (live ? "" : " devset-zones__marker--stale");
  // เส้นบนแถบคือ "ระยะที่เซนเซอร์อ่านได้" ส่วนเกณฑ์ที่ตั้งเป็นตัวเลขหนาใต้แถบ - แยกให้ชัดว่าอันไหนคืออะไร
  const markerText = reading === null ? "" : live ? `เซนเซอร์ ${fmtCm(reading)}` : `ค่าล่าสุด ${fmtCm(reading)}`;
  const th = thresholds.filter(Number.isFinite).map((v) => ({ v, at: pos(v), strong: true }));
  const ticks = [
    ...[0, SCALE_MAX_CM].map((v) => ({ v, at: pos(v), strong: false })).filter((e) => th.every((t) => Math.abs(t.at - e.at) > 7)),
    ...th,
  ];

  return (
    <div className="devset-zones" role="img" aria-label={label}>
      <div className="devset-zones__track" aria-hidden="true">
        <div className="devset-zones__bar">
          {zones.map((z) => (
            <span
              key={z.tone}
              className={`devset-zones__seg devset-zones__seg--${z.tone}`}
              style={{ left: `${pos(z.from)}%`, width: `${Math.max(0, pos(z.to) - pos(z.from))}%` }}
            />
          ))}
        </div>
        {marker !== null && (
          <span className={`devset-zones__marker${edge}`} style={{ left: `${marker}%` }}>
            <span>{markerText}</span>
          </span>
        )}
      </div>
      <div className="devset-zones__ticks" aria-hidden="true">
        {ticks.map((t) => (
          <span
            key={`${t.strong ? "th" : "end"}-${t.v}`}
            className={`devset-zones__tick${t.strong ? " devset-zones__tick--th" : ""}${
              t.at < 3 ? " devset-zones__tick--start" : t.at > 97 ? " devset-zones__tick--end" : ""
            }`}
            style={{ left: `${t.at}%` }}
          >
            {t.v}
          </span>
        ))}
      </div>
      <ul className="devset-zones__legend" aria-hidden="true">
        {zones.map((z) => (
          <li key={z.tone}>
            <i className={`devset-zones__swatch devset-zones__seg--${z.tone}`} />
            {z.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DistanceField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (cm: number) => void;
}) {
  const id = useId();
  const valid = Number.isFinite(value);
  const base = valid ? Math.round(value) : min;
  return (
    <div className="devset-field">
      <label htmlFor={id}>{label}</label>
      <div className="devset-field__row">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={Math.min(max, Math.max(min, base))}
          aria-label={`${label} (แถบเลื่อน)`}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <div className="devset-number">
          <button type="button" aria-label="ลด 1 เซนติเมตร" disabled={base <= min} onClick={() => onChange(Math.max(min, base - 1))}>
            −
          </button>
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={1}
            value={valid ? value : ""}
            onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
          />
          <span>ซม.</span>
          <button type="button" aria-label="เพิ่ม 1 เซนติเมตร" disabled={base >= max} onClick={() => onChange(Math.min(max, base + 1))}>
            +
          </button>
        </div>
      </div>
      <small>{hint}</small>
    </div>
  );
}

function CardActions({
  error,
  dirty,
  saveState,
  sync,
  atDefaults,
  onSave,
  onCancel,
  onDefaults,
}: {
  error: string | null;
  dirty: boolean;
  saveState: SaveState;
  sync: Sync;
  atDefaults: boolean;
  onSave: () => void;
  onCancel: () => void;
  onDefaults: () => void;
}) {
  const saving = saveState === "saving";
  const note: Sync = saveState === "error"
    ? { tone: "warn", text: "บันทึกไม่สำเร็จ ลองอีกครั้ง" }
    : dirty
      ? { tone: "wait", text: "ยังไม่ได้บันทึก" }
      : sync;
  return (
    <>
      {error && (
        <p className="devset-error" role="alert">
          {error}
        </p>
      )}
      <div className="devset-actions">
        <button type="button" className="btn btn--primary" disabled={!dirty || !!error || saving} onClick={onSave}>
          {saving ? "กำลังบันทึก…" : "บันทึกค่า"}
        </button>
        {dirty ? (
          <button type="button" className="devset-link" onClick={onCancel} disabled={saving}>
            ยกเลิกการแก้ไข
          </button>
        ) : (
          <button type="button" className="devset-link" onClick={onDefaults} disabled={atDefaults || saving}>
            ใช้ค่าเริ่มต้น
          </button>
        )}
        <p className={`devset-sync devset-sync--${note.tone}`} role="status">
          {note.text}
        </p>
      </div>
    </>
  );
}
