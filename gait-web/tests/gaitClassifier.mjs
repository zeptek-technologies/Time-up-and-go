// ทดสอบตัวจำแนกท่าเดิน (classifier) + ตัวสรุปผลรอบ (recorder) + ตัวนับก้าว ด้วยข้อมูลจำลอง
// (ไม่ต้องใช้กล้อง) — รัน: node tests/gaitClassifier.mjs
//
// สองชั้น:
//   1. ระดับฟีเจอร์ — ป้อนค่า GaitFeatures ตรง ๆ ให้ classifier/recorder เพื่อล็อกกฎแต่ละข้อ
//   2. ระดับจำลองการเดิน — สร้าง landmark 33 จุด (ภาพ + world) เป็นลำดับเฟรม 30 fps จาก
//      "โปรไฟล์ท่าเดิน" แล้ววิ่งผ่าน pipeline จริงทั้งสาย (extractor → EMA → classifier →
//      vote → recorder) เหมือนที่ CameraView ทำ เพื่อยืนยันว่าสายทั้งเส้นสรุปถูกต้องทั้งรอบ
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
};

try {
  const { RuleBasedGaitClassifier, RuleBasedSideGaitClassifier, normalizePredictionLabel, storedGaitLabel } =
    await server.ssrLoadModule('/src/lib/classifier.ts');
  const { GaitFeatureExtractor } = await server.ssrLoadModule('/src/lib/gaitFeatures.ts');
  const { FeatureSmoother, PredictionSmoother } = await server.ssrLoadModule('/src/lib/smoothers.ts');
  const { GaitSessionRecorder, RISK_MIN_SHARE } = await server.ssrLoadModule('/src/lib/recorder.ts');
  const { StepTracker } = await server.ssrLoadModule('/src/lib/stepTracker.ts');
  const { POSE_CONFIG } = await server.ssrLoadModule('/src/lib/config.ts');

  const front = new RuleBasedGaitClassifier();
  const side = new RuleBasedSideGaitClassifier();

  // ═══════════════════════════════════════════════════════════════════
  // 1) ระดับฟีเจอร์
  // ═══════════════════════════════════════════════════════════════════

  // คนเดินปกติ: ค่าทุกตัวห่างจากเกณฑ์เตือนพอสมควร
  const NORMAL = {
    leftKneeAngle: 165, rightKneeAngle: 165, leftKneeAngleMin: 150, rightKneeAngleMin: 150,
    leftHipAngle: 170, rightHipAngle: 170,
    stepLength: 0.2,
    leftArmSwing: 0.12, rightArmSwing: 0.12, meanArmSwing: 0.12, armSwingAsymmetry: 0.05,
    symmetryIndex: 0.05, trunkLean: 3,
    leftKneeLift: 0.04, rightKneeLift: 0.04,
    leftArmCloseToChest: false, rightArmCloseToChest: false, weakSide: 'unknown',
    cadence: 110, stepTime: 0.55, stepTimeVariability: 3, stepCount: 10,
  };
  const f = (over = {}) => ({ ...NORMAL, ...over });
  const WARMUP = f({
    meanArmSwing: NaN, leftArmSwing: NaN, rightArmSwing: NaN, armSwingAsymmetry: NaN,
    symmetryIndex: NaN, leftKneeLift: NaN, rightKneeLift: NaN, cadence: NaN, stepTime: NaN,
    stepTimeVariability: NaN, stepCount: 0,
  });

  console.log('classifier (กล้องหน้า)');
  await test('เดินปกติ = Normal', () => {
    const p = front.predict(f());
    assert.equal(normalizePredictionLabel(p.status), 'Normal');
  });
  await test('ไม่มีคน = No Pose Detected', () => {
    assert.match(front.predict(null).status, /No Pose/);
  });
  await test('ช่วง warm-up (ฟีเจอร์ยังเป็น NaN) ต้องไม่ถูกตีเป็นโรค', () => {
    assert.equal(normalizePredictionLabel(front.predict(WARMUP).status), 'Normal');
  });

  // ── พาร์กินสัน ──
  await test('แกว่งแขนน้อย + ก้าวสั้น = Parkinsonian', () => {
    const p = front.predict(f({ meanArmSwing: 0.04, leftArmSwing: 0.04, rightArmSwing: 0.04, stepLength: 0.08 }));
    assert.equal(normalizePredictionLabel(p.status), 'Parkinsonian');
    assert.ok(p.reasons.includes('reduced bilateral arm swing'), p.reasons.join());
    assert.ok(p.reasons.includes('short step length'), p.reasons.join());
  });
  await test('แขนแกว่งไม่เท่ากันซ้าย-ขวา + ตัวโน้มไปหน้า = Parkinsonian', () => {
    const p = front.predict(f({ leftArmSwing: 0.14, rightArmSwing: 0.04, meanArmSwing: 0.09, armSwingAsymmetry: 1.1, trunkLean: 14 }));
    assert.equal(normalizePredictionLabel(p.status), 'Parkinsonian');
    assert.ok(p.reasons.includes('asymmetric arm swing (L/R)'), p.reasons.join());
    assert.ok(p.reasons.includes('forward trunk lean'), p.reasons.join());
  });
  await test('แกว่งแขนน้อยอย่างเดียว (ก้าวยาว ตัวตรง) ยังไม่ใช่ Parkinsonian', () => {
    const p = front.predict(f({ meanArmSwing: 0.04, leftArmSwing: 0.04, rightArmSwing: 0.04 }));
    assert.equal(normalizePredictionLabel(p.status), 'Normal');
  });
  await test('ก้าวสั้นอย่างเดียว (แขนแกว่งปกติ) ยังไม่ใช่ Parkinsonian', () => {
    assert.equal(normalizePredictionLabel(front.predict(f({ stepLength: 0.08 })).status), 'Normal');
  });
  await test('ค่าพอดีเกณฑ์ (เท่ากับ threshold) ยังไม่เตือน', () => {
    const p = front.predict(f({ meanArmSwing: 0.075, stepLength: 0.115, trunkLean: 10 }));
    assert.equal(normalizePredictionLabel(p.status), 'Normal');
  });

  // ── อัมพาตครึ่งซีก ──
  const HEMI = f({
    symmetryIndex: 1.1, weakSide: 'right',
    rightArmSwing: 0.02, leftArmSwing: 0.12, meanArmSwing: 0.07, armSwingAsymmetry: 1.4,
    rightArmCloseToChest: true,
  });
  await test('ขาไม่สมมาตร + แขนข้างหนึ่งแนบตัว = Hemiplegic ระบุข้างอ่อนแรง', () => {
    const p = front.predict(HEMI);
    assert.equal(normalizePredictionLabel(p.status), 'Hemiplegic');
    assert.ok(p.reasons[0].startsWith('right leg'), p.reasons.join());
  });
  await test('ขาไม่สมมาตรแต่แขนแกว่งปกติทั้งสองข้าง = ไม่ใช่ Hemiplegic', () => {
    const p = front.predict(f({ symmetryIndex: 1.1, weakSide: 'right' }));
    assert.equal(normalizePredictionLabel(p.status), 'Normal');
  });
  await test('สัญญาณพาร์กินสันครบ แต่ขาไม่สมมาตรมาก → ตกไปกฎ Hemiplegic ไม่ใช่ Parkinsonian', () => {
    // แขนข้างเดียวแกว่งน้อยทำให้ค่าเฉลี่ยต่ำ + ก้าวสั้น = เข้าเกณฑ์ PD ถ้าไม่มี guard
    const p = front.predict({ ...HEMI, stepLength: 0.08 });
    assert.equal(normalizePredictionLabel(p.status), 'Hemiplegic');
  });
  await test('ไม่รู้ข้างอ่อนแรง = บอกว่า "one leg"', () => {
    const p = front.predict({ ...HEMI, weakSide: 'unknown' });
    assert.ok(p.reasons[0].startsWith('one leg'), p.reasons.join());
  });

  // ── เท้าตก ──
  await test('ยกเข่าสูง + เข่างอมาก (ค่าต่ำสุดในช่วง) = Steppage ระบุข้าง', () => {
    const p = front.predict(f({ leftKneeLift: 0.15, leftKneeAngleMin: 120 }));
    assert.equal(normalizePredictionLabel(p.status), 'Steppage');
    assert.ok(p.reasons.includes('high left knee lift'), p.reasons.join());
  });
  await test('ยกเข่าสูงแต่เข่าเหยียด (วิ่ง/ก้าวข้ามสิ่งกีดขวาง) = ไม่ใช่ Steppage', () => {
    assert.equal(normalizePredictionLabel(front.predict(f({ rightKneeLift: 0.15 })).status), 'Normal');
  });
  await test('เข่างอมากแต่ยกเข่าไม่สูง (ย่อตัว) = ไม่ใช่ Steppage', () => {
    assert.equal(normalizePredictionLabel(front.predict(f({ leftKneeAngleMin: 110, rightKneeAngleMin: 110 })).status), 'Normal');
  });
  await test('มุมเข่ารายเฟรมงอชั่วขณะ แต่ค่าต่ำสุดในช่วงยังปกติ = ไม่ใช่ Steppage (กฎต้องอ่านค่าช่วงเวลา)', () => {
    assert.equal(normalizePredictionLabel(front.predict(f({ leftKneeLift: 0.15, leftKneeAngle: 100 })).status), 'Normal');
  });
  await test('Steppage มาก่อน Parkinsonian เมื่อเข้าเกณฑ์ทั้งคู่', () => {
    const p = front.predict(f({ rightKneeLift: 0.15, rightKneeAngleMin: 120, meanArmSwing: 0.04, stepLength: 0.08 }));
    assert.equal(normalizePredictionLabel(p.status), 'Steppage');
  });

  console.log('classifier (กล้องข้าง)');
  await test('ไม่มีคน = No Pose Detected', () => {
    assert.match(side.predict(null).status, /No Pose/);
  });
  await test('เดินปกติ = Normal', () => {
    assert.equal(normalizePredictionLabel(side.predict(f()).status), 'Normal');
  });
  await test('ไม่ตัดสิน Hemiplegic แม้สัญญาณครบ (มุมข้างมองซ้าย-ขวาไม่ออก)', () => {
    assert.equal(normalizePredictionLabel(side.predict(HEMI).status), 'Normal');
  });
  await test('แกว่งแขนน้อย + ตัวโน้มไปหน้า = Parkinsonian', () => {
    const p = side.predict(f({ meanArmSwing: 0.04, trunkLean: 14 }));
    assert.equal(normalizePredictionLabel(p.status), 'Parkinsonian');
    assert.deepEqual(p.reasons, ['reduced arm swing', 'forward trunk lean']);
  });
  await test('แขนไม่สมมาตรอย่างเดียว (ค่าเฉลี่ยยังปกติ) ไม่พอให้มุมข้างตัดสิน Parkinsonian', () => {
    const p = side.predict(f({ armSwingAsymmetry: 1.1, stepLength: 0.08 }));
    assert.equal(normalizePredictionLabel(p.status), 'Normal');
  });
  await test('ยกเข่าสูง + เข่างอ = Steppage', () => {
    assert.equal(normalizePredictionLabel(side.predict(f({ rightKneeLift: 0.15, rightKneeAngleMin: 120 })).status), 'Steppage');
  });

  console.log('ป้ายผล');
  await test('normalizePredictionLabel แปลงข้อความ classifier เป็นป้าย 4 แบบ', () => {
    assert.equal(normalizePredictionLabel('Possible Parkinsonian Gait'), 'Parkinsonian');
    assert.equal(normalizePredictionLabel('Possible Hemiplegic Gait'), 'Hemiplegic');
    assert.equal(normalizePredictionLabel('Possible Steppage Gait'), 'Steppage');
    assert.equal(normalizePredictionLabel('Normal / No Abnormal Pattern'), 'Normal');
  });
  await test('storedGaitLabel ไม่ตี "No Data"/"Unknown" เป็นปกติ', () => {
    assert.equal(storedGaitLabel('Normal'), 'Normal');
    assert.equal(storedGaitLabel('Hemiplegic'), 'Hemiplegic');
    assert.equal(storedGaitLabel('No Data'), null);
    assert.equal(storedGaitLabel('Unknown'), null);
    assert.equal(storedGaitLabel(''), null);
  });

  // ═══════════════════════════════════════════════════════════════════
  // recorder — สรุปผลทั้งรอบ
  // ═══════════════════════════════════════════════════════════════════
  const PRED = {
    Normal: { status: 'Normal / No Abnormal Pattern', color: '', reasons: [] },
    Parkinsonian: { status: 'Possible Parkinsonian Gait', color: '', reasons: [] },
    Hemiplegic: { status: 'Possible Hemiplegic Gait', color: '', reasons: [] },
    Steppage: { status: 'Possible Steppage Gait', color: '', reasons: [] },
    NoPose: { status: 'No Pose Detected', color: '', reasons: [] },
  };
  const feed = (rec, counts) => {
    for (const [label, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i++) rec.record(label === 'NoPose' ? null : f(), PRED[label]);
    }
  };

  console.log('recorder');
  await test('ปกติ 30 เฟรม + พาร์กินสัน 3 เฟรม = ปกติ ไม่ติดธง', () => {
    const rec = new GaitSessionRecorder();
    rec.start();
    feed(rec, { Normal: 30, Parkinsonian: 3 });
    const r = rec.result();
    assert.equal(r.highestRisk, 'Normal');
    assert.equal(r.flagged, false);
    assert.ok(Math.abs(r.riskPercentage - (30 / 33) * 100) < 1e-9);
  });
  await test('พาร์กินสัน 60% ของเฟรม = ติดธง รายงานสัดส่วนจริง', () => {
    const rec = new GaitSessionRecorder();
    rec.start();
    feed(rec, { Normal: 4, Parkinsonian: 6 });
    const r = rec.result();
    assert.equal(r.highestRisk, 'Parkinsonian');
    assert.equal(r.flagged, true);
    assert.equal(r.riskPercentage, 60);
  });
  await test(`ผิดปกติมากกว่าปกติแต่ไม่ถึง ${RISK_MIN_SHARE * 100}% (กระจายหลายโรค) = ไม่ติดธง`, () => {
    const rec = new GaitSessionRecorder();
    rec.start();
    feed(rec, { Normal: 3, Parkinsonian: 3, Steppage: 2, Hemiplegic: 2 });
    assert.equal(rec.result().flagged, false);
  });
  await test('เฟรมไม่มีคนและเฟรม warm-up ไม่ถูกนับเป็นตัวหาร', () => {
    const rec = new GaitSessionRecorder();
    rec.start();
    feed(rec, { NoPose: 20, Parkinsonian: 5 });
    rec.record(WARMUP, PRED.Normal);
    assert.equal(rec.totalFrames, 5);
    assert.equal(rec.skippedFrames, 21);
    assert.equal(rec.result().highestRisk, 'Parkinsonian');
  });
  await test('ไม่มีเฟรมที่ประเมินได้เลย = No Data', () => {
    const rec = new GaitSessionRecorder();
    rec.start();
    feed(rec, { NoPose: 10 });
    assert.deepEqual(rec.result(), { highestRisk: 'No Data', riskPercentage: 0, flagged: false });
  });
  await test('ไม่ได้กดบันทึก = ไม่นับอะไร', () => {
    const rec = new GaitSessionRecorder();
    feed(rec, { Parkinsonian: 5 });
    assert.equal(rec.totalFrames, 0);
  });
  await test('นับก้าวเฉพาะช่วงที่บันทึก (stepCount ของกล้องเริ่มนับก่อนกดบันทึก)', () => {
    const rec = new GaitSessionRecorder();
    rec.start();
    rec.record(f({ stepCount: 7, cadence: 100, stepTimeVariability: 4 }), PRED.Normal);
    rec.record(f({ stepCount: 12, cadence: 120, stepTimeVariability: 6 }), PRED.Normal);
    assert.equal(rec.sessionSteps, 5);
    assert.equal(rec.avgCadence, 110);
    assert.equal(rec.avgStepTimeVariability, 5);
  });

  console.log('recorder — รวมสองกล้อง');
  const F = (label) => ({ features: f(), prediction: PRED[label] });
  await test('สองกล้องเห็นพาร์กินสันตรงกัน = นับเป็นพาร์กินสัน', () => {
    const rec = new GaitSessionRecorder();
    rec.start();
    rec.recordFused(F('Parkinsonian'), F('Parkinsonian'));
    assert.equal(rec.riskScores.Parkinsonian, 1);
  });
  await test('กล้องหน้าว่าพาร์กินสัน กล้องข้างว่าปกติ = ไม่ยืนยัน นับเป็นปกติ (ไม่ทิ้งเฟรม)', () => {
    const rec = new GaitSessionRecorder();
    rec.start();
    rec.recordFused(F('Parkinsonian'), F('Normal'));
    assert.equal(rec.riskScores.Normal, 1);
    assert.equal(rec.totalFrames, 1);
  });
  await test('Hemiplegic ใช้ผลกล้องหน้าอย่างเดียว (กล้องข้างตัดสินไม่ได้)', () => {
    const rec = new GaitSessionRecorder();
    rec.start();
    rec.recordFused(F('Hemiplegic'), F('Normal'));
    assert.equal(rec.riskScores.Hemiplegic, 1);
  });
  await test('กล้องข้างว่า Steppage แต่กล้องหน้าว่าปกติ = ไม่ยืนยัน', () => {
    const rec = new GaitSessionRecorder();
    rec.start();
    rec.recordFused(F('Normal'), F('Steppage'));
    assert.equal(rec.riskScores.Steppage, 0);
    assert.equal(rec.riskScores.Normal, 1);
  });
  await test('มีกล้องเดียว (อีกตัวหลุด/ไม่เห็นคน) = ใช้ผลกล้องนั้นตรง ๆ', () => {
    const rec = new GaitSessionRecorder();
    rec.start();
    rec.recordFused(F('Parkinsonian'), null);
    rec.recordFused(null, F('Steppage'));
    rec.recordFused(F('Parkinsonian'), { features: null, prediction: PRED.NoPose });
    assert.equal(rec.riskScores.Parkinsonian, 2);
    assert.equal(rec.riskScores.Steppage, 1);
  });
  await test('ไม่มีกล้องไหนเห็นคน = ข้ามเฟรม', () => {
    const rec = new GaitSessionRecorder();
    rec.start();
    rec.recordFused(null, null);
    assert.equal(rec.totalFrames, 0);
    assert.equal(rec.skippedFrames, 1);
  });

  // ═══════════════════════════════════════════════════════════════════
  // ตัวนับก้าว
  // ═══════════════════════════════════════════════════════════════════
  console.log('stepTracker');
  const FRAME = 1000 / 30;
  await test('สัญญาณซายน์คาบ 1.1 วิ 6 วิ = ~11 ก้าว cadence ≈ 109', () => {
    const st = new StepTracker(POSE_CONFIG.gaitWindowMs, POSE_CONFIG.minStepIntervalMs, POSE_CONFIG.stepFloorMeters);
    for (let t = 0; t <= 6000; t += FRAME) st.push(t, 0.3 * Math.sin((2 * Math.PI * t) / 1100));
    const m = st.metrics();
    assert.ok(m.stepCount >= 9 && m.stepCount <= 11, `steps ${m.stepCount}`);
    assert.ok(Math.abs(m.cadence - 109) < 8, `cadence ${m.cadence}`);
    assert.ok(m.stepTimeVariability < 10, `cv ${m.stepTimeVariability}`);
  });
  await test('ก้าวสั้นแบบลากเท้า (แอมพลิจูด 0.1 ม.) ยังนับได้', () => {
    const st = new StepTracker(POSE_CONFIG.gaitWindowMs, POSE_CONFIG.minStepIntervalMs, POSE_CONFIG.stepFloorMeters);
    for (let t = 0; t <= 6000; t += FRAME) st.push(t, 0.1 * Math.sin((2 * Math.PI * t) / 900));
    assert.ok(st.metrics().stepCount >= 10, `steps ${st.metrics().stepCount}`);
  });
  await test('ยืนนิ่งมี noise (±0.04 ม.) = 0 ก้าว cadence เป็น NaN', () => {
    const st = new StepTracker(POSE_CONFIG.gaitWindowMs, POSE_CONFIG.minStepIntervalMs, POSE_CONFIG.stepFloorMeters);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
    for (let t = 0; t <= 6000; t += FRAME) st.push(t, 0.04 * rnd());
    const m = st.metrics();
    assert.equal(m.stepCount, 0);
    assert.ok(Number.isNaN(m.cadence));
  });
  await test('reset ล้างยอดสะสม', () => {
    const st = new StepTracker(4000, 260, 0.1);
    for (let t = 0; t <= 3000; t += FRAME) st.push(t, 0.3 * Math.sin((2 * Math.PI * t) / 1000));
    assert.ok(st.metrics().stepCount > 0);
    st.reset();
    assert.equal(st.metrics().stepCount, 0);
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2) จำลองการเดินทั้งสาย (กล้องหน้า 640×480, 30 fps)
  // ═══════════════════════════════════════════════════════════════════
  //
  // โปรไฟล์ท่าเดิน (ค่าเป็นสัดส่วนของภาพ เว้นที่ระบุเป็นองศา/เมตร):
  //   stance      ครึ่งหนึ่งของระยะห่างสะโพกซ้าย-ขวา (ฐานการยืน)
  //   legX        แอมพลิจูดการแกว่งข้อเท้าซ้าย-ขวาในภาพ ต่อข้าง
  //   legZ        แอมพลิจูดข้อเท้าหน้า-หลัง (หน่วยความกว้างภาพ) → ความยาวก้าว
  //   armX        แอมพลิจูดข้อมือ ต่อข้าง
  //   kneeLift    ระยะเข่ายกขึ้นในภาพ ต่อข้าง
  //   thighDeg    มุมแกว่งต้นขาใน world (องศา) ต่อข้าง → สัญญาณนับก้าว
  //   kneeFlexDeg มุมงอเข่าสูงสุดช่วงแกว่งขาใน world (องศา) ต่อข้าง
  //   leanZ       ไหล่เลื่อนออกจากสะโพกตามแกนลึก (หน่วยความกว้างภาพ) → เอียงลำตัว
  //   armHeld     ข้าง ('left'|'right') ที่งอแขนแนบอก ไม่แกว่ง
  const L = 11, R = 12;
  const IDX = {
    left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 },
    right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 },
  };
  const side2 = (v) => (typeof v === 'object' ? v : { left: v, right: v });
  const PROFILE = {
    normal: { stance: 0.04, legX: 0.04, legZ: 0.06, armX: 0.03, kneeLift: 0.02, thighDeg: 20, kneeFlexDeg: 25, leanZ: 0, armHeld: null },
    parkinsonShuffle: { stance: 0.01, legX: 0.012, legZ: 0.01, armX: 0.006, kneeLift: 0.015, thighDeg: 6, kneeFlexDeg: 15, leanZ: 0, armHeld: null },
    parkinsonLean: { stance: 0.04, legX: 0.04, legZ: 0.06, armX: 0.006, kneeLift: 0.02, thighDeg: 20, kneeFlexDeg: 25, leanZ: 0.05, armHeld: null },
    hemiplegicRight: { stance: 0.04, legX: { left: 0.04, right: 0.01 }, legZ: 0.06, armX: { left: 0.03, right: 0 }, kneeLift: 0.02, thighDeg: { left: 20, right: 5 }, kneeFlexDeg: 25, leanZ: 0, armHeld: 'right' },
    steppageLeft: { stance: 0.04, legX: 0.04, legZ: 0.06, armX: 0.03, kneeLift: { left: 0.09, right: 0.02 }, thighDeg: 20, kneeFlexDeg: { left: 60, right: 25 }, leanZ: 0, armHeld: null },
  };

  const PERIOD_MS = 1100; // หนึ่งรอบการเดิน (2 ก้าว) ≈ 109 ก้าว/นาที
  const D2R = Math.PI / 180;

  /** สร้าง landmark ภาพ + world หนึ่งเฟรมจากโปรไฟล์ที่เวลา tMs */
  function frameAt(p, tMs) {
    const img = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
    const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
    const ph = (2 * Math.PI * tMs) / PERIOD_MS;
    const set = (arr, i, x, y, z) => { arr[i] = { x, y, z, visibility: 0.95 }; };

    for (const [sideName, sign] of [['left', +1], ['right', -1]]) {
      const ix = IDX[sideName];
      const s = Math.sin(ph) * sign; // ขาซ้าย/ขวาสลับเฟสกัน
      const swing = Math.max(0, s); // ช่วงแกว่งขา (เท้าลอย)
      const hipX = 0.5 + sign * p.stance;
      // ── ภาพ ──
      set(img, ix.shoulder, 0.5 + sign * 0.12, 0.25, p.leanZ);
      set(img, ix.hip, hipX, 0.5, 0);
      set(img, ix.knee, hipX, 0.7 - side2(p.kneeLift)[sideName] * swing, 0);
      set(img, ix.ankle, hipX + side2(p.legX)[sideName] * s, 0.9, side2(p.legZ)[sideName] * s);
      if (p.armHeld === sideName) {
        // แขนงอแนบอก: ข้อมือนิ่งอยู่หน้าลำตัวระดับอก
        set(img, ix.elbow, hipX - sign * 0.03, 0.45, 0);
        set(img, ix.wrist, hipX - sign * 0.02, 0.42, 0);
      } else {
        const armX = side2(p.armX)[sideName];
        set(img, ix.elbow, hipX + sign * 0.14, 0.42, 0);
        set(img, ix.wrist, hipX + sign * 0.12 - armX * s, 0.55, 0); // แขนแกว่งสวนขาข้างเดียวกัน
      }
      // ── world (เมตร, สะโพกเป็นศูนย์, y ลง, z ลึก) ──
      const thigh = side2(p.thighDeg)[sideName] * D2R * s;
      const flex = side2(p.kneeFlexDeg)[sideName] * D2R * swing;
      const hipW = [sign * 0.1, 0, 0];
      const kneeW = [hipW[0], hipW[1] + 0.45 * Math.cos(thigh), hipW[2] - 0.45 * Math.sin(thigh)];
      const ankleW = [kneeW[0], kneeW[1] + 0.45 * Math.cos(thigh - flex), kneeW[2] - 0.45 * Math.sin(thigh - flex)];
      set(world, ix.shoulder, sign * 0.18, -0.5, 0);
      set(world, ix.hip, ...hipW);
      set(world, ix.knee, ...kneeW);
      set(world, ix.ankle, ...ankleW);
      set(world, ix.wrist, img[ix.wrist].x - 0.5, 0.1, 0);
      set(world, ix.elbow, img[ix.elbow].x - 0.5, -0.1, 0);
    }
    set(img, 0, 0.5, 0.1, 0);
    set(world, 0, 0, -0.65, 0);
    return { img, world };
  }

  /** วิ่งโปรไฟล์ผ่าน pipeline เดียวกับ CameraView ทั้งรอบ แล้วคืน recorder + ป้ายรายเฟรม */
  function runSession(p, seconds = 6, { noise = 0, seed = 1 } = {}) {
    let rs = seed;
    const rnd = () => ((rs = (rs * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
    const extractor = new GaitFeatureExtractor({
      windowMs: POSE_CONFIG.windowMs, minReadyMs: POSE_CONFIG.minReadyMs,
      bodyHeightWindowMs: POSE_CONFIG.bodyHeightWindowMs, swingFloor: POSE_CONFIG.swingFloor,
      minVisibility: POSE_CONFIG.minVisibility, gaitWindowMs: POSE_CONFIG.gaitWindowMs,
      minStepIntervalMs: POSE_CONFIG.minStepIntervalMs, stepFloorMeters: POSE_CONFIG.stepFloorMeters,
    });
    const fs = new FeatureSmoother(POSE_CONFIG.emaTauSeconds);
    const ps = new PredictionSmoother(POSE_CONFIG.voteMs);
    const rec = new GaitSessionRecorder();
    rec.start();
    const labels = [];
    let last = -1;
    let features = null;
    for (let t = 0; t <= seconds * 1000; t += FRAME) {
      const { img, world } = frameAt(p, t);
      if (noise) for (const lm of img) { lm.x += noise * rnd(); lm.y += noise * rnd(); }
      features = fs.smooth(extractor.extract(img, world, 640, 480, t), last < 0 ? 0 : t - last);
      const pred = ps.smooth(features ? (p.classifier ?? front).predict(features) : front.predict(null), t);
      last = t;
      rec.record(features, pred);
      labels.push({ t, label: normalizePredictionLabel(pred.status), reasons: pred.reasons });
    }
    return { rec, labels, features };
  }
  /** สัดส่วนป้าย label ในช่วงหลังจากวินาทีที่ 2 (ผ่าน warm-up แล้ว) */
  const steadyShare = (labels, label) => {
    const steady = labels.filter((l) => l.t >= 2000);
    return steady.filter((l) => l.label === label).length / steady.length;
  };

  console.log('จำลองการเดิน (pipeline ทั้งสาย, กล้องหน้า)');
  await test('เดินปกติ 6 วิ = Normal ตลอด ไม่ติดธง นับก้าว/cadence ได้', () => {
    const { rec, labels, features } = runSession(PROFILE.normal);
    assert.ok(steadyShare(labels, 'Normal') >= 0.95, `normal share ${steadyShare(labels, 'Normal')}`);
    const r = rec.result();
    assert.equal(r.highestRisk, 'Normal');
    assert.equal(r.flagged, false);
    assert.ok(rec.skippedFrames > 0 && rec.skippedFrames < 20, `warm-up frames ${rec.skippedFrames}`);
    assert.ok(rec.sessionSteps >= 8 && rec.sessionSteps <= 12, `steps ${rec.sessionSteps}`);
    assert.ok(Math.abs(rec.avgCadence - 109) < 12, `cadence ${rec.avgCadence}`);
    assert.ok(features.stepLength > 0.115, `stepLength ${features.stepLength}`);
    assert.ok(features.meanArmSwing > 0.075, `armSwing ${features.meanArmSwing}`);
    assert.ok(features.symmetryIndex < 0.2, `symmetry ${features.symmetryIndex}`);
  });
  await test('เดินปกติ + landmark jitter (±0.4% ของภาพ) ยังเป็น Normal', () => {
    const { rec, labels } = runSession(PROFILE.normal, 6, { noise: 0.004 });
    assert.ok(steadyShare(labels, 'Normal') >= 0.9, `normal share ${steadyShare(labels, 'Normal')}`);
    assert.equal(rec.result().flagged, false);
  });
  await test('ลากเท้าก้าวสั้น แกว่งแขนน้อย = Parkinsonian (เหตุผล: ก้าวสั้น) ยังนับก้าวได้', () => {
    const { rec, labels, features } = runSession(PROFILE.parkinsonShuffle);
    assert.ok(steadyShare(labels, 'Parkinsonian') >= 0.9, `PD share ${steadyShare(labels, 'Parkinsonian')}`);
    const r = rec.result();
    assert.equal(r.highestRisk, 'Parkinsonian');
    assert.equal(r.flagged, true);
    const last = labels[labels.length - 1];
    assert.ok(last.reasons.includes('short step length'), last.reasons.join());
    assert.ok(!last.reasons.includes('forward trunk lean'), last.reasons.join());
    assert.ok(features.stepLength < 0.115, `stepLength ${features.stepLength}`);
    assert.ok(rec.sessionSteps >= 8, `steps ${rec.sessionSteps}`);
  });
  await test('ก้าวปกติแต่แขนไม่แกว่ง + ตัวโน้มไปหน้า = Parkinsonian (เหตุผล: เอียงลำตัว)', () => {
    const { rec, labels, features } = runSession(PROFILE.parkinsonLean);
    assert.ok(steadyShare(labels, 'Parkinsonian') >= 0.9, `PD share ${steadyShare(labels, 'Parkinsonian')}`);
    assert.equal(rec.result().highestRisk, 'Parkinsonian');
    const last = labels[labels.length - 1];
    assert.ok(last.reasons.includes('forward trunk lean'), last.reasons.join());
    assert.ok(features.trunkLean > 10, `lean ${features.trunkLean}`);
  });
  await test('ขาขวาแกว่งน้อย + แขนขวาแนบอก = Hemiplegic ข้างขวา', () => {
    const { rec, labels, features } = runSession(PROFILE.hemiplegicRight);
    assert.ok(steadyShare(labels, 'Hemiplegic') >= 0.9, `hemi share ${steadyShare(labels, 'Hemiplegic')}`);
    assert.equal(rec.result().highestRisk, 'Hemiplegic');
    assert.equal(features.weakSide, 'right');
    assert.equal(features.rightArmCloseToChest, true);
    assert.equal(features.leftArmCloseToChest, false);
    assert.ok(features.symmetryIndex > 0.45, `symmetry ${features.symmetryIndex}`);
    const last = labels[labels.length - 1];
    assert.ok(last.reasons[0].startsWith('right leg'), last.reasons.join());
  });
  await test('ยกเข่าซ้ายสูงและงอมาก = Steppage ข้างซ้าย นิ่งตลอดรอบ ติดธง', () => {
    // เคยกะพริบแค่ ~20% ของเฟรมตอนกฎอ่านมุมเข่ารายเฟรม — ตอนนี้ใช้ค่าต่ำสุดในช่วงเวลา
    const { rec, labels, features } = runSession(PROFILE.steppageLeft);
    assert.ok(steadyShare(labels, 'Steppage') >= 0.9, `steppage share ${steadyShare(labels, 'Steppage')}`);
    const r = rec.result();
    assert.equal(r.highestRisk, 'Steppage');
    assert.equal(r.flagged, true);
    assert.ok(features.leftKneeLift > 0.105, `knee lift ${features.leftKneeLift}`);
    assert.ok(features.leftKneeAngleMin < 132 && features.rightKneeAngleMin > 132, `kneeMin L ${features.leftKneeAngleMin} R ${features.rightKneeAngleMin}`);
    const last = labels[labels.length - 1];
    assert.ok(last.reasons.includes('high left knee lift'), last.reasons.join());
  });
  await test('ยกเข่าสูงแต่เข่าเหยียดตลอด (ก้าวยาว ๆ) ทั้งสายยังเป็น Normal', () => {
    const highStraight = { ...PROFILE.normal, kneeLift: 0.09, kneeFlexDeg: 20 };
    const { rec, labels } = runSession(highStraight);
    assert.ok(steadyShare(labels, 'Normal') >= 0.95, `normal share ${steadyShare(labels, 'Normal')}`);
    assert.equal(rec.result().flagged, false);
  });
  await test('ยืนนิ่ง (ไม่แกว่งอะไรเลย) = Normal ไม่มีก้าว ไม่ติดธง', () => {
    const still = { ...PROFILE.normal, legX: 0, legZ: 0, armX: 0, kneeLift: 0, thighDeg: 0, kneeFlexDeg: 0 };
    const { rec, labels, features } = runSession(still);
    assert.ok(steadyShare(labels, 'Normal') >= 0.95);
    assert.equal(rec.sessionSteps, 0);
    assert.ok(Number.isNaN(features.symmetryIndex), 'ยืนนิ่งต้องไม่คำนวณความสมมาตร (NaN)');
    assert.equal(rec.result().flagged, false);
  });
  await test('ปกติ 4 วิ แล้วลากเท้า 1.5 วิ = ทั้งรอบยังสรุปว่าปกติ', () => {
    // ต่อสองโปรไฟล์ในรอบเดียว: จำลองคนที่สะดุด/ชะลอช่วงท้ายสั้น ๆ
    const extractor = new GaitFeatureExtractor({ ...POSE_CONFIG });
    const fs = new FeatureSmoother(POSE_CONFIG.emaTauSeconds);
    const ps = new PredictionSmoother(POSE_CONFIG.voteMs);
    const rec = new GaitSessionRecorder();
    rec.start();
    let last = -1;
    for (let t = 0; t <= 5500; t += FRAME) {
      const { img, world } = frameAt(t < 4000 ? PROFILE.normal : PROFILE.parkinsonShuffle, t);
      const features = fs.smooth(extractor.extract(img, world, 640, 480, t), last < 0 ? 0 : t - last);
      rec.record(features, ps.smooth(front.predict(features), t));
      last = t;
    }
    const r = rec.result();
    assert.equal(r.highestRisk, 'Normal');
    assert.equal(r.flagged, false);
    assert.ok(rec.riskScores.Parkinsonian > 0, 'ช่วงลากเท้าควรถูกนับบ้าง');
  });
  await test('คนหายจากภาพกลางรอบ = เฟรมนั้นถูกข้าม และกลับมาประเมินต่อได้', () => {
    const extractor = new GaitFeatureExtractor({ ...POSE_CONFIG });
    const fs = new FeatureSmoother(POSE_CONFIG.emaTauSeconds);
    const ps = new PredictionSmoother(POSE_CONFIG.voteMs);
    const rec = new GaitSessionRecorder();
    rec.start();
    let last = -1;
    let noPose = 0;
    for (let t = 0; t <= 6000; t += FRAME) {
      const gone = t >= 2500 && t < 3500;
      const { img, world } = frameAt(PROFILE.normal, t);
      const features = gone ? fs.smooth(null, 0) : fs.smooth(extractor.extract(img, world, 640, 480, t), last < 0 ? 0 : t - last);
      const pred = ps.smooth(front.predict(features), t);
      if (gone) {
        noPose++;
        // majority vote ยังค้างป้ายเดิมได้ไม่เกิน voteMs หลังคนหาย
        if (t >= 2500 + POSE_CONFIG.voteMs) assert.match(pred.status, /No Pose/, `t=${t}`);
      }
      rec.record(features, pred);
      last = t;
    }
    assert.ok(rec.skippedFrames >= noPose, `skipped ${rec.skippedFrames} < noPose ${noPose}`);
    assert.equal(rec.result().highestRisk, 'Normal');
  });

  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
} finally {
  await server.close();
}
