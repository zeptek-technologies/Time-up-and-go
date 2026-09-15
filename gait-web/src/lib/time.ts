// Time helpers for values written by the ESP32 boards.
//
// Two traps the firmware spec calls out (section 8):
//   8.2 - the boards write epoch SECONDS, JS Date wants milliseconds.
//         new Date(finished_at)        -> year 1970  ❌
//         new Date(finished_at * 1000) -> correct    ✅
//   8.3 - the boards call configTime(0, 0, ...) i.e. UTC. Without an explicit
//         timeZone a 15:00 test would render as 08:00.

const BANGKOK = "Asia/Bangkok"; // UTC+7

const dateTimeFmt = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: BANGKOK,
});

const timeOnlyFmt = new Intl.DateTimeFormat("th-TH", {
  timeStyle: "short",
  timeZone: BANGKOK,
});

/** epoch seconds -> Date. Returns null for 0 / missing / invalid. */
export function epochToDate(sec: number | undefined | null): Date | null {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return null;
  const d = new Date(sec * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Full date+time in Thai locale, Bangkok time.
 * started_at can legitimately be 0 when the board began a test before NTP had
 * synced (spec section 3) - show that honestly rather than "1 ม.ค. 1970".
 */
export function formatThai(sec: number | undefined | null): string {
  const d = epochToDate(sec);
  return d ? dateTimeFmt.format(d) : "ไม่ทราบเวลา";
}

/** Time only (no date) - for compact table cells. */
export function formatThaiTime(sec: number | undefined | null): string {
  const d = epochToDate(sec);
  return d ? timeOnlyFmt.format(d) : "-";
}

/**
 * Format an ISO-8601 timestamp (or a Firestore Timestamp) in Bangkok time.
 *
 * `gait_assessments` stores an ISO string rather than an epoch, written by two
 * different producers:
 *   • the web camera - new Date().toISOString()      → "2026-06-20T06:09:01.165Z"
 *   • main.py        - datetime.now(timezone.utc)    → "2026-05-08T08:56:00.671507+00:00"
 * Both carry an explicit UTC marker, so Date parses them correctly; we only
 * have to pin the *display* zone so the reader sees Thai local time.
 */
export function formatIsoThai(value: unknown): string {
  if (!value) return "ไม่ทราบเวลา";
  const maybeTs = value as { toDate?: () => Date };
  const d = typeof maybeTs.toDate === "function" ? maybeTs.toDate() : new Date(value as string);
  if (Number.isNaN(d.getTime())) return "ไม่ทราบเวลา";
  return dateTimeFmt.format(d);
}
