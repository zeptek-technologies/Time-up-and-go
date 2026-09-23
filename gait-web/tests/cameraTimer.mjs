// ทดสอบตัวตัดสินท่าทาง + ตัวจับเวลาจากกล้อง ด้วยข้อมูลจำลอง (ไม่ต้องใช้กล้อง)
// รัน: node tests/cameraTimer.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
};

try {
  const { classifyPosture } = await server.ssrLoadModule('/src/lib/postureDetector.ts');
  const { CameraTugTimer } = await server.ssrLoadModule('/src/lib/cameraTugTimer.ts');

  // ── ตัวตัดสินท่าทาง: สร้างโครงกระดูกจำลองมุมข้าง (ภาพ 640×480, หันขวา) ──
  const LEFT = { shoulder: 11, hip: 23, knee: 25, ankle: 27 };
  const RIGHT = { shoulder: 12, hip: 24, knee: 26, ankle: 28 };
  const skeleton = (pts, side = LEFT, vis = 0.9) => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.1 }));
    for (const [k, [x, y]] of Object.entries(pts)) lm[side[k]] = { x, y, z: 0, visibility: vis };
    return lm;
  };
  const SIT = { shoulder: [0.5, 0.30], hip: [0.5, 0.55], knee: [0.70, 0.56], ankle: [0.70, 0.85] };
  const STAND = { shoulder: [0.5, 0.20], hip: [0.5, 0.50], knee: [0.51, 0.70], ankle: [0.50, 0.90] };
  // กึ่งลุก: มุมสะโพก ≈ 135°, มุมเข่า ≈ 135°, ต้นขาเอียงลง 37° (ความสูงสะโพก ≈ 0.6)
  const HALF = { shoulder: [0.4736, 0.2525], hip: [0.5, 0.50], knee: [0.625, 0.625], ankle: [0.6402, 0.9138] };

  console.log('postureDetector');
  await test('ท่านั่งมุมข้าง = sitting', () => {
    const s = classifyPosture(skeleton(SIT), null, 640, 480, 0);
    assert.equal(s.posture, 'sitting');
    assert.ok(s.hipAngle > 80 && s.hipAngle < 100, `hip ${s.hipAngle}`);
    assert.ok(s.hipLift < 0.2, `lift ${s.hipLift}`);
  });
  await test('ท่ายืนตรง = standing', () => {
    const s = classifyPosture(skeleton(STAND), null, 640, 480, 0);
    assert.equal(s.posture, 'standing');
    assert.ok(s.hipLift > 0.9, `lift ${s.hipLift}`);
  });
  await test('ท่ากึ่งลุก = transition', () => {
    assert.equal(classifyPosture(skeleton(HALF), null, 640, 480, 0).posture, 'transition');
  });
  await test('ใช้ขาข้างที่เห็นชัดกว่า (ขาขวา)', () => {
    assert.equal(classifyPosture(skeleton(STAND, RIGHT), null, 640, 480, 0).posture, 'standing');
  });
  await test('จุดข้อต่อไม่ชัด / ไม่มีคน = none', () => {
    assert.equal(classifyPosture(skeleton(SIT, LEFT, 0.3), null, 640, 480, 0).posture, 'none');
    assert.equal(classifyPosture(null, null, 640, 480, 0).posture, 'none');
  });

  // ── ตัวจับเวลา: ป้อนลำดับท่าทางจำลองที่ 30 เฟรม/วินาที ──
  const FRAME = 1000 / 30;
  const seq = () => {
    const out = [];
    let t = 1000;
    const api = {
      hold(posture, ms, lift, angle) {
        for (const end = t + ms; t < end; t += FRAME) out.push({ tMs: t, posture, hipLift: lift, hipAngle: angle, kneeAngle: angle });
        return api;
      },
      // ค่อย ๆ เปลี่ยนจากท่าหนึ่งไปอีกท่า (ลุก/นั่ง)
      ramp(ms, fromLift, toLift, fromDeg, toDeg) {
        const t0 = t;
        for (const end = t + ms; t < end; t += FRAME) {
          const k = (t - t0) / ms;
          const lift = fromLift + (toLift - fromLift) * k;
          const deg = fromDeg + (toDeg - fromDeg) * k;
          const posture = deg < 120 && lift < 0.45 ? 'sitting' : deg > 150 && lift > 0.75 ? 'standing' : 'transition';
          out.push({ tMs: t, posture, hipLift: lift, hipAngle: deg, kneeAngle: deg });
        }
        return api;
      },
      now: () => t,
      samples: out,
    };
    return api;
  };
  const run = (samples, config) => {
    const timer = new CameraTugTimer(config);
    const events = [];
    for (const s of samples) { const e = timer.push(s); if (e) events.push({ ...e, at: s.tMs }); }
    return { events, timer };
  };
  const type = (events) => events.map((e) => e.type);

  console.log('cameraTugTimer');
  await test('รอบปกติ: ลุก → ออกนอกภาพ → กลับมานั่ง', () => {
    const s = seq().hold('sitting', 2000, 0.05, 95);
    const riseAt = s.now();
    s.ramp(600, 0.05, 1.0, 95, 170).hold('standing', 500, 1.0, 172).hold('none', 6000)
      .hold('standing', 1000, 1.0, 172);
    const sitStart = s.now();
    s.ramp(600, 1.0, 0.05, 170, 95);
    const seatedAt = s.now();
    s.hold('sitting', 2000, 0.05, 95);
    const { events } = run(s.samples);
    assert.deepEqual(type(events), ['ready', 'start', 'finish']);
    const start = events[1], finish = events[2];
    // เวลาเริ่มย้อนไปจังหวะที่สะโพกพ้นเก้าอี้จริง (ภายใน ~2 เฟรมหลังเริ่มยก) ไม่ใช่ตอนยืนยัน
    assert.ok(start.startMs - riseAt >= 0 && start.startMs - riseAt < 3 * FRAME, `start ${start.startMs - riseAt}ms`);
    assert.ok(start.detectedMs > start.startMs + 100, 'ยืนยันช้ากว่าจังหวะจริง แต่เวลาที่ได้ย้อนกลับไปแล้ว');
    // เวลาจบ = ตอนสะโพกกลับลงถึงระดับนั่ง (ช่วงท้ายของการนั่งลง)
    assert.ok(finish.endMs > sitStart && finish.endMs <= seatedAt + FRAME, `end ${finish.endMs - sitStart}ms after sit start`);
    const expected = (finish.endMs - start.startMs) / 1000;
    assert.ok(Math.abs(finish.durationMs / 1000 - expected) < 0.001);
    assert.ok(finish.durationMs > 8000 && finish.durationMs < 9500, `duration ${finish.durationMs}`);
  });

  await test('ผู้สูงอายุยืนหลังงอ (ไม่เคยเข้าเกณฑ์ยืน) ยังจบรอบได้', () => {
    const s = seq().hold('sitting', 2000, 0.05, 95)
      .ramp(800, 0.05, 0.7, 95, 140).hold('transition', 7000, 0.7, 140)
      .ramp(800, 0.7, 0.05, 140, 95).hold('sitting', 1500, 0.05, 95);
    assert.deepEqual(type(run(s.samples).events), ['ready', 'start', 'finish']);
  });

  await test('ขยับตัว/โน้มตัว แล้วนั่งกลับเร็ว = ยกเลิก ไม่บันทึก', () => {
    const s = seq().hold('sitting', 2000, 0.05, 95)
      .ramp(300, 0.05, 0.5, 95, 125).ramp(300, 0.5, 0.05, 125, 95).hold('sitting', 1500, 0.05, 95);
    assert.deepEqual(type(run(s.samples).events), ['ready', 'start', 'cancel']);
  });

  await test('ขยับเล็กน้อย (สะโพกยกนิดเดียว) = ไม่เริ่มจับเวลา', () => {
    const s = seq().hold('sitting', 2000, 0.05, 95).hold('sitting', 500, 0.25, 100).hold('sitting', 1000, 0.05, 95);
    assert.deepEqual(type(run(s.samples).events), ['ready']);
  });

  await test('รอบสั้นผิดปกติ = reject ไม่บันทึก', () => {
    const s = seq().hold('sitting', 2000, 0.05, 95)
      .ramp(300, 0.05, 1.0, 95, 170).hold('standing', 2000, 1.0, 172)
      .ramp(300, 1.0, 0.05, 170, 95).hold('sitting', 1500, 0.05, 95);
    const { events } = run(s.samples);
    assert.deepEqual(type(events), ['ready', 'start', 'reject']);
    assert.ok(events[2].durationMs < 4000);
  });

  await test('ไม่มีคนนั่ง = ไม่มีเหตุการณ์ใด ๆ', () => {
    const s = seq().hold('none', 3000).hold('standing', 2000, 1.0, 172).hold('none', 3000);
    assert.deepEqual(type(run(s.samples).events), []);
  });

  await test('นั่งพร้อมแล้วคนหายไปจากภาพ = กลับไปรอ (ไม่เริ่มรอบ)', () => {
    const s = seq().hold('sitting', 2000, 0.05, 95).hold('none', 3000);
    assert.deepEqual(type(run(s.samples).events), ['ready', 'lost']);
  });

  await test('เกิน 120 วินาทีไม่กลับมานั่ง = ยกเลิกรอบ', () => {
    const s = seq().hold('sitting', 2000, 0.05, 95).ramp(500, 0.05, 1.0, 95, 170).hold('none', 121000);
    assert.deepEqual(type(run(s.samples).events), ['ready', 'start', 'abort']);
  });

  await test('รอบถัดไปเริ่มได้หลังช่วงพัก', () => {
    const s = seq().hold('sitting', 2000, 0.05, 95)
      .ramp(500, 0.05, 1.0, 95, 170).hold('none', 6000).ramp(500, 1.0, 0.05, 170, 95)
      .hold('sitting', 4500, 0.05, 95)
      .ramp(500, 0.05, 1.0, 95, 170).hold('none', 7000).ramp(500, 1.0, 0.05, 170, 95)
      .hold('sitting', 1500, 0.05, 95);
    assert.deepEqual(type(run(s.samples).events), ['ready', 'start', 'finish', 'ready', 'start', 'finish']);
  });

  await test('ตั้งช่วงพักให้ยาวเท่าเก้าอี้ (15 วิ) = รอบถัดไปเริ่มได้หลังพักครบเท่านั้น', () => {
    const timer = new CameraTugTimer();
    timer.setCooldownMs(15000);
    const s = seq().hold('sitting', 2000, 0.05, 95)
      .ramp(500, 0.05, 1.0, 95, 170).hold('none', 6000).ramp(500, 1.0, 0.05, 170, 95)
      .hold('sitting', 1000, 0.05, 95);
    const events = [];
    for (const smp of s.samples) { const e = timer.push(smp); if (e) events.push(e.type); }
    assert.deepEqual(events, ['ready', 'start', 'finish']);
    assert.equal(timer.phase, 'cooldown');
    const left = timer.cooldownLeftMs(s.now());
    assert.ok(left > 13000 && left <= 15000, `cooldown left ${left}`);
    // ลุกยืนระหว่างพัก 5 วินาทีต่อมา = ยังไม่เริ่มรอบใหม่
    let t = s.now();
    for (let i = 0; i < 150; i++, t += FRAME) timer.push({ tMs: t, posture: 'standing', hipLift: 1, hipAngle: 170, kneeAngle: 170 });
    assert.equal(timer.phase, 'cooldown');
  });

  await test('มองไม่เห็นต้นขา (ไม่มีค่าความสูงสะโพก) ยังจับเวลาได้จากมุม', () => {
    const s = seq().hold('sitting', 2000, NaN, 95).hold('standing', 500, NaN, 170)
      .hold('none', 6000).hold('sitting', 1500, NaN, 95);
    assert.deepEqual(type(run(s.samples).events), ['ready', 'start', 'finish']);
  });

  // ── รวมเวลากล้องกับผลของเก้าอี้ ──
  const { mergeCameraTimings } = await server.ssrLoadModule('/src/lib/timingMerge.ts');
  const row = (o) => ({
    id: 'x', checkpointSec: 0, returnSec: 0, totalSec: 0, riskLevel: 'LOW', status: 'completed',
    startedAt: 0, finishedAt: 0, subjectKey: 'p1', sessionId: 's1', trialNo: 1, fwVersion: '',
    patientId: 'p1', timingSource: 'chair', cameraTotalSec: null, chairTotalSec: null, ...o,
  });
  const chairRow = (o) => row({ timingSource: 'chair', chairTotalSec: o.totalSec, ...o });
  const camRow = (o) => row({ timingSource: 'camera', cameraTotalSec: o.totalSec, ...o });

  console.log('timingMerge');
  await test('รอบเดียวกัน = แถวเดียว ใช้เวลากล้อง เก็บเวลาเก้าอี้ไว้เทียบ', () => {
    const out = mergeCameraTimings(
      [chairRow({ id: 'c1', totalSec: 12.6, checkpointSec: 5.1, returnSec: 7.5, finishedAt: 1000 })],
      [camRow({ id: 'cam_1', totalSec: 12.2, finishedAt: 1002 })],
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'c1', 'คงเอกสารของเก้าอี้ไว้ (การเลือกผู้ทดสอบเขียนลงเอกสารนี้)');
    assert.equal(out[0].totalSec, 12.2);
    assert.equal(out[0].chairTotalSec, 12.6);
    assert.equal(out[0].timingSource, 'camera');
    assert.ok(Math.abs(out[0].returnSec - 7.1) < 1e-9, 'ไป + กลับ = เวลารวมของกล้อง');
  });
  await test('เก้าอี้ออฟไลน์ = แถวของกล้องอย่างเดียว', () => {
    const out = mergeCameraTimings([], [camRow({ id: 'cam_1', totalSec: 9.8, trialNo: 0, finishedAt: 1000 })]);
    assert.equal(out.length, 1);
    assert.equal(out[0].timingSource, 'camera');
  });
  await test('กล้องไม่ได้จับ = ใช้เวลาเก้าอี้ (สำรอง)', () => {
    const out = mergeCameraTimings([chairRow({ id: 'c1', totalSec: 11, finishedAt: 1000 })], []);
    assert.equal(out[0].totalSec, 11);
    assert.equal(out[0].timingSource, 'chair');
  });
  await test('เลขรอบเดียวกันแต่ห่างกันหลายนาที = ไม่จับคู่ (คนละวัน/เก้าอี้รีบูต)', () => {
    const out = mergeCameraTimings(
      [chairRow({ id: 'c1', totalSec: 11, finishedAt: 1000 })],
      [camRow({ id: 'cam_1', totalSec: 10, finishedAt: 5000 })],
    );
    assert.equal(out.length, 2);
  });
  await test('เก้าอี้ยกเลิก แต่กล้องเห็นครบรอบ = ใช้ผลของกล้อง', () => {
    const out = mergeCameraTimings(
      [chairRow({ id: 'c1', totalSec: 120, status: 'aborted', finishedAt: 1000 })],
      [camRow({ id: 'cam_1', totalSec: 14.3, finishedAt: 1010 })],
    );
    assert.equal(out[0].status, 'completed');
    assert.equal(out[0].totalSec, 14.3);
  });

  await test('ไม่มีเก้าอี้แต่กล้องคิดขาไปจาก checkpoint ได้ = ใช้ขาไปของกล้อง', () => {
    const out = mergeCameraTimings(
      [chairRow({ id: 'c1', totalSec: 12, checkpointSec: 0, finishedAt: 1000 })],
      [camRow({ id: 'cam_1', totalSec: 11, checkpointSec: 5.2, finishedAt: 1001 })],
    );
    assert.equal(out[0].checkpointSec, 5.2);
    assert.ok(Math.abs(out[0].returnSec - 5.8) < 1e-9);
  });
  await test('เก้าอี้วัดขาไปได้ = ใช้ของเก้าอี้ก่อน', () => {
    const out = mergeCameraTimings(
      [chairRow({ id: 'c1', totalSec: 12, checkpointSec: 5.6, finishedAt: 1000 })],
      [camRow({ id: 'cam_1', totalSec: 11, checkpointSec: 5.2, finishedAt: 1001 })],
    );
    assert.equal(out[0].checkpointSec, 5.6);
  });

  // ── ขาไปจากเวลาที่ checkpoint เห็นคนผ่าน + เทียบนาฬิกา ──
  const { ClockOffset, pickCheckpointSplit } = await server.ssrLoadModule('/src/lib/checkpointSync.ts');
  console.log('checkpointSync');
  await test('เลือกครั้งแรกที่อยู่ในรอบ ข้ามคนเดินผ่านก่อนเริ่ม/ติดจบ', () => {
    const start = 1_000_000, end = start + 12_000;
    // ก่อนเริ่ม (เจ้าหน้าที่), 0.5 วิหลังเริ่ม (เร็วเกิน), ขาไปจริง 5.3 วิ, ครั้งซ้ำตอนหมุนตัว, ติดจบ
    const passes = [start - 4000, start + 500, start + 5300, start + 6100, end - 300];
    assert.equal(pickCheckpointSplit(passes, start, end), 5.3);
  });
  await test('ไม่มีครั้งไหนอยู่ในรอบ = null (กล้องอย่างเดียว)', () => {
    assert.equal(pickCheckpointSplit([], 0, 10_000), null);
    assert.equal(pickCheckpointSplit([20_000], 0, 10_000), null);
  });
  await test('เทียบนาฬิกา: เลือกตัวอย่างที่เน็ตเร็วที่สุด', () => {
    const c = new ClockOffset();
    assert.equal(c.offsetMs, null);
    // นาฬิกาเครื่องนี้ช้ากว่าเซิร์ฟเวอร์ 2 วิ · ตัวอย่างแรกเน็ตช้า (ไม่สมมาตร) ตัวที่สองเร็ว
    c.add({ sentMs: 10_000, serverMs: 12_900, recvMs: 11_000 });
    c.add({ sentMs: 20_000, serverMs: 22_050, recvMs: 20_100 });
    assert.equal(c.offsetMs, 2000);
    assert.equal(c.uncertaintyMs, 50);
  });
  await test('เทียบนาฬิกา: ทิ้งตัวอย่างผิดปกติ (ย้อนเวลา/ช้าเกิน)', () => {
    const c = new ClockOffset();
    c.add({ sentMs: 5000, serverMs: 5000, recvMs: 4000 });
    c.add({ sentMs: 5000, serverMs: 5000, recvMs: 20_000 });
    assert.equal(c.offsetMs, null);
  });

  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
} finally {
  await server.close();
}
