import type { TugData } from "../hooks/useTugData";
import { riskMeta } from "../lib/meta";
import { riskLevelOf } from "../lib/tugRisk";
import { formatThai } from "../lib/time";

/**
 * The console strip: what staff need at a glance before touching anything -
 * the last measured value and how the caseload is distributed across risk
 * bands. Replaces the old marketing hero, which spent ~40% of the first
 * desktop screen (53% on mobile) on a banner instead of product evidence.
 */
export default function OverviewSection({ data }: { data: TugData }) {
  // Stats use completed trials only - aborted ones hold a partial time.
  const { completedResults } = data;
  const count = completedResults.length;
  const avgTotal = count ? completedResults.reduce((s, r) => s + r.totalSec, 0) / count : 0;
  const avgCp = count ? completedResults.reduce((s, r) => s + r.checkpointSec, 0) / count : 0;

  const latest = completedResults[0];
  const latestLevel = latest ? riskLevelOf(latest.totalSec) : null;
  const latestMeta = latestLevel ? riskMeta[latestLevel] : null;

  const counts = { LOW: 0, MODERATE: 0, HIGH: 0 };
  completedResults.forEach((r) => {
    counts[riskLevelOf(r.totalSec)]++;
  });
  const denom = count || 1;
  const pct = (n: number) => (n / denom) * 100;

  const bands = [
    { key: "LOW", cls: "low", name: "ต่ำ", n: counts.LOW },
    { key: "MODERATE", cls: "mod", name: "ปานกลาง", n: counts.MODERATE },
    { key: "HIGH", cls: "high", name: "สูง", n: counts.HIGH },
  ] as const;

  return (
    <>
      <section className="console" aria-label="สรุปผลล่าสุด">
        <div className={`console__readout ${latestMeta ? `console__readout--${latestMeta.cls}` : ""}`}>
          <span className="readout__label">ผลการทดสอบล่าสุด</span>
          {latest ? (
            <>
              <div>
                <span className="readout__value">{latest.totalSec.toFixed(2)}</span>
                <span className="readout__unit">วินาที</span>
              </div>
              <span className={`risk-badge risk-badge--${latestMeta!.cls}`}>
                <span className="risk-badge__dot" />
                ความเสี่ยง{latestMeta!.th}
              </span>
              <span className="readout__meta">{formatThai(latest.finishedAt)}</span>
            </>
          ) : (
            <>
              <div><span className="readout__value">-</span></div>
              <span className="readout__meta">ยังไม่มีผลการทดสอบที่สำเร็จ</span>
            </>
          )}
        </div>

        <div className="console__dist">
          <div className="dist-head">
            <span className="dist-head__label">สัดส่วนระดับความเสี่ยง</span>
            <span className="dist-head__total">
              {count > 0 ? `จากการทดสอบที่สำเร็จ ${count} ครั้ง` : "รอข้อมูล"}
            </span>
          </div>

          <div
            className="dist-bar"
            role="img"
            aria-label={`ความเสี่ยงต่ำ ${counts.LOW}, ปานกลาง ${counts.MODERATE}, สูง ${counts.HIGH}`}
          >
            {bands.map((b) =>
              b.n > 0 ? (
                <div key={b.key} className={`dist-bar__seg dist-bar__seg--${b.cls}`} style={{ width: `${pct(b.n)}%` }} />
              ) : null,
            )}
          </div>

          <div className="dist-legend">
            {bands.map((b) => (
              <div key={b.key} className="dist-legend__item">
                <span className={`dist-legend__dot dist-legend__dot--${b.cls}`} />
                <span className="dist-legend__count">{b.n}</span>
                <span className="dist-legend__name">{b.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="stat-rail" aria-label="ค่าสรุปการทดสอบ">
        <Figure label="ทดสอบสำเร็จ" value={String(count)} unit="ครั้ง" />
        <Figure label="เวลาเฉลี่ยรวม" value={avgTotal.toFixed(2)} unit="วินาที" />
        <Figure label="เฉลี่ยถึงจุดหมุนตัว" value={avgCp.toFixed(2)} unit="วินาที" />
      </section>
    </>
  );
}

function Figure({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="stat-figure">
      <span className="stat-figure__label">{label}</span>
      <span className="stat-figure__value">{value}</span>
      <span className="stat-figure__unit">{unit}</span>
    </div>
  );
}
