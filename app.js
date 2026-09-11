// ================================================================
// TUG Care Board — Firebase Firestore Integration
// ================================================================
// Reads TUG test results and patient data from Cloud Firestore,
// renders them in the dashboard with real-time updates,
// and provides patient management + result assignment.
// ================================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword
}
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  collection,
  onSnapshot,
  query,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── Firebase Config ──
const firebaseConfig = {
  apiKey: "AIzaSyC4dFT0u_NWRmsbuQygQhQnW6nGuRUn4D8",
  authDomain: "time-up-and-go.firebaseapp.com",
  projectId: "time-up-and-go"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ── DOM References ──
const dom = {
  totalTests: document.getElementById('totalTests'),
  avgTotalTime: document.getElementById('avgTotalTime'),
  avgCheckpointTime: document.getElementById('avgCheckpointTime'),
  latestTotalTime: document.getElementById('latestTotalTime'),
  latestTimestamp: document.getElementById('latestTimestamp'),
  latestRiskText: document.getElementById('latestRiskText'),
  lowCount: document.getElementById('lowCount'),
  modCount: document.getElementById('modCount'),
  highCount: document.getElementById('highCount'),
  lowBar: document.getElementById('lowBar'),
  modBar: document.getElementById('modBar'),
  highBar: document.getElementById('highBar'),
  resultsBody: document.getElementById('resultsBody'),
  searchInput: document.getElementById('searchInput'),
  filterChips: document.querySelectorAll('.filter-chip'),
  statusDot: document.getElementById('statusDot'),
  connectionLabel: document.getElementById('connectionLabel'),
  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebarToggle'),
  sidebarBackdrop: document.getElementById('sidebarBackdrop'),
  sideNavItems: document.querySelectorAll('.side-nav__item'),
  // Patient management
  patientsGrid: document.getElementById('patientsGrid'),
  addPatientBtn: document.getElementById('addPatientBtn'),
  patientModal: document.getElementById('patientModal'),
  closeModalBtn: document.getElementById('closeModalBtn'),
  cancelModalBtn: document.getElementById('cancelModalBtn'),
  patientForm: document.getElementById('patientForm'),
  patientName: document.getElementById('patientName'),
  patientAge: document.getElementById('patientAge'),
  patientGender: document.getElementById('patientGender'),
  patientNote: document.getElementById('patientNote'),
  activePatientSelect: document.getElementById('activePatientSelect'),
  // Disease risk assessments
  diseaseAssessmentsCount: document.getElementById('diseaseAssessmentsCount'),
  latestDiseaseCondition: document.getElementById('latestDiseaseCondition'),
  latestDiseaseConfidence: document.getElementById('latestDiseaseConfidence'),
  latestDiseasePatient: document.getElementById('latestDiseasePatient'),
  diseaseScoreGrid: document.getElementById('diseaseScoreGrid'),
  diseaseBody: document.getElementById('diseaseBody'),
};

// ── State ──
let allResults = [];
let allPatients = [];
let allGaitAssessments = [];
let gaitAssessmentsError = null;
let activeFilter = 'ALL';
let searchTerm = '';

function setSidebarOpen(isOpen) {
  dom.sidebar.classList.toggle('sidebar--open', isOpen);
  dom.sidebarToggle.setAttribute('aria-expanded', String(isOpen));
  document.body.classList.toggle('nav-open', isOpen);
  if (dom.sidebarBackdrop) dom.sidebarBackdrop.hidden = !isOpen;
}

// ── Risk Level Helpers ──
const riskMeta = {
  LOW: { th: 'ต่ำ', cls: 'low', emoji: '✅' },
  MODERATE: { th: 'ปานกลาง', cls: 'mod', emoji: '⚠️' },
  HIGH: { th: 'สูง', cls: 'high', emoji: '❌' },
};
function getRiskThai(level) { return riskMeta[level]?.th ?? level; }
function getRiskClass(level) { return riskMeta[level]?.cls ?? 'low'; }

const diseaseMeta = {
  Normal: { th: 'ปกติ', cls: 'low' },
  Parkinsonian: { th: 'เสี่ยงพาร์กินสัน', cls: 'mod' },
  Hemiplegic: { th: 'เสี่ยงอัมพาตครึ่งซีก', cls: 'high' },
  Steppage: { th: 'เสี่ยงภาวะเท้าตก', cls: 'mod' },
};

function getDiseaseMeta(condition) {
  return diseaseMeta[condition] ?? { th: condition || 'ไม่ระบุ', cls: 'mod' };
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatTimestamp(value) {
  if (!value) return 'ไม่ระบุเวลา';
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function getAssessmentTimeValue(item) {
  const date = item.timestampRaw
    ? (typeof item.timestampRaw?.toDate === 'function' ? item.timestampRaw.toDate() : new Date(item.timestampRaw))
    : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

// ── Get patient name by ID ──
function getPatientName(pid) {
  if (!pid) return null;
  const p = allPatients.find(p => p.id === pid);
  return p ? p.name : null;
}

// ── Auth ──
async function signIn() {
  try {
    const sharedAuth = window.TUG_FIREBASE_AUTH;
    if (!sharedAuth?.email || !sharedAuth?.password) {
      throw new Error('Missing firebase-auth.local.js');
    }
    await signInWithEmailAndPassword(auth, sharedAuth.email, sharedAuth.password);
    console.log('[Auth] ✅ Signed in');
    return true;
  } catch (err) {
    console.error('[Auth] ❌', err.message);
    setConnectionStatus('error', 'เข้าสู่ระบบไม่สำเร็จ');
    return false;
  }
}

function setConnectionStatus(state, label) {
  dom.statusDot.className = 'status-dot';
  if (state === 'online') dom.statusDot.classList.add('status-dot--online');
  if (state === 'error') dom.statusDot.classList.add('status-dot--error');
  dom.connectionLabel.textContent = label;
}

function updateConnectionLabel() {
  setConnectionStatus(
    'online',
    `เชื่อมต่อแล้ว — TUG ${allResults.length} / ประเมินโรค ${allGaitAssessments.length}`
  );
}

// ================================================================
// PATIENTS — Firestore CRUD
// ================================================================

function listenToPatients() {
  onSnapshot(query(collection(db, 'patients')), (snap) => {
    allPatients = [];
    snap.forEach(d => {
      const data = d.data();
      allPatients.push({
        id: d.id,
        name: data.name ?? '',
        age: data.age ?? null,
        gender: data.gender ?? '',
        note: data.note ?? '',
      });
    });
    allPatients.sort((a, b) => a.name.localeCompare(b.name, 'th'));
    renderPatients();
    updatePatientSelect();
    renderTable(); // re-render to update patient names
    renderDiseaseAssessments();
  });
}

async function addPatient(name, age, gender, note) {
  await addDoc(collection(db, 'patients'), {
    name,
    age: age ? Number(age) : null,
    gender: gender || '',
    note: note || '',
    created_at: serverTimestamp(),
  });
}

async function deletePatient(id) {
  await deleteDoc(doc(db, 'patients', id));
  // Also clear patient_id from any results linked to this patient
  allResults.filter(r => r.patient_id === id).forEach(r => {
    updateDoc(doc(db, 'tug_results', r.id), { patient_id: '' });
  });
  allGaitAssessments.filter(a => a.patient_id === id).forEach(a => {
    updateDoc(doc(db, 'gait_assessments', a.id), { patient_id: '' });
  });
}

async function assignResultToPatient(resultId, patientId) {
  await updateDoc(doc(db, 'tug_results', resultId), { patient_id: patientId });
}

async function assignGaitAssessmentToPatient(assessmentId, patientId) {
  await updateDoc(doc(db, 'gait_assessments', assessmentId), { patient_id: patientId });
}

// ── Render Patient Cards ──
function renderPatients() {
  if (allPatients.length === 0) {
    dom.patientsGrid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--clr-text-secondary)">
        <svg width="44" height="44" viewBox="0 0 24 24" style="color:#94a3b8;margin-bottom:8px">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
          <circle cx="9" cy="7" r="4" fill="none" stroke="currentColor" stroke-width="1.5"></circle>
          <path d="M19 8v6m3-3h-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
        </svg>
        <p style="font-size:.85rem">ยังไม่มีข้อมูลผู้ทดสอบ — กดปุ่ม "เพิ่มผู้ทดสอบ" เพื่อเริ่มต้น</p>
      </div>`;
    return;
  }

  const selectedPid = dom.activePatientSelect.value;

  dom.patientsGrid.innerHTML = allPatients.map(p => {
    const initials = p.name.charAt(0);
    const metaParts = [];
    if (p.age) metaParts.push(`${p.age} ปี`);
    if (p.gender) metaParts.push(p.gender);
    const testCount = allResults.filter(r => r.patient_id === p.id).length;
    const diseaseCount = allGaitAssessments.filter(a => a.patient_id === p.id).length;
    metaParts.push(`${testCount} TUG`);
    metaParts.push(`${diseaseCount} ประเมินโรค`);
    const isActive = p.id === selectedPid;

    return `
      <div class="patient-card ${isActive ? 'patient-card--active' : ''}">
        <div class="patient-card__top">
          <div class="patient-card__avatar">${initials}</div>
          <div class="patient-card__info">
            <div class="patient-card__name">${esc(p.name)}</div>
            <div class="patient-card__meta">${metaParts.join(' · ')}</div>
          </div>
        </div>
        ${p.note ? `<div class="patient-card__note">${esc(p.note)}</div>` : ''}
        <div class="patient-card__actions">
          <button class="btn--assign" onclick="window._selectPatient('${p.id}')">เลือก</button>
          <button class="btn--danger-sm" onclick="window._deletePatient('${p.id}','${esc(p.name)}')">ลบ</button>
        </div>
      </div>`;
  }).join('');
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Patient Select Dropdown ──
function updatePatientSelect() {
  const current = dom.activePatientSelect.value;
  dom.activePatientSelect.innerHTML = '<option value="">— ไม่ระบุผู้ทดสอบ —</option>' +
    allPatients.map(p => `<option value="${p.id}" ${p.id === current ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
}

// ── Global handlers (called from onclick in rendered HTML) ──
window._deletePatient = async (id, name) => {
  if (confirm(`ต้องการลบผู้ทดสอบ "${name}" จริงหรือไม่?\nผลการทดสอบที่ผูกไว้จะถูกปลดออก`)) {
    try { await deletePatient(id); } catch (e) { alert('เกิดข้อผิดพลาด: ' + e.message); }
  }
};

window._selectPatient = (id) => {
  dom.activePatientSelect.value = id;
  renderPatients();
};

window._assignResult = async (resultId, patientId) => {
  try { await assignResultToPatient(resultId, patientId); } catch (e) { console.error(e); }
};

window._assignGaitAssessment = async (assessmentId, patientId) => {
  try { await assignGaitAssessmentToPatient(assessmentId, patientId); } catch (e) { console.error(e); }
};

// ================================================================
// TUG RESULTS — Firestore Listener
// ================================================================

function listenToResults() {
  onSnapshot(query(collection(db, 'tug_results')), (snap) => {
    allResults = [];
    snap.forEach(d => {
      const data = d.data();
      allResults.push({
        id: d.id,
        checkpoint_sec: data.checkpoint_sec ?? 0,
        total_sec: data.total_sec ?? 0,
        risk_level: (data.risk_level ?? 'LOW').toUpperCase(),
        patient_id: data.patient_id ?? '',
      });
    });
    allResults.sort((a, b) => {
      const na = parseInt(a.id, 10), nb = parseInt(b.id, 10);
      if (!isNaN(na) && !isNaN(nb)) return nb - na;
      return b.id.localeCompare(a.id);
    });
    updateConnectionLabel();
    updateDashboard();
  }, (err) => {
    console.error('[Firestore]', err);
    setConnectionStatus('error', 'เกิดข้อผิดพลาด');
  });
}

// ================================================================
// GAIT ASSESSMENTS — Disease Risk Listener
// ================================================================

function listenToGaitAssessments() {
  onSnapshot(query(collection(db, 'gait_assessments')), (snap) => {
    gaitAssessmentsError = null;
    allGaitAssessments = [];
    snap.forEach(d => {
      const data = d.data();
      const highest = data.highest_risk_detected ?? {};
      const condition = highest.condition ?? data.condition ?? 'Unknown';
      const confidence = toNumber(
        highest.confidence_risk_percentage ?? data.confidence_risk_percentage,
        0
      );

      allGaitAssessments.push({
        id: d.id,
        condition,
        confidence,
        risk_scores: data.risk_scores ?? {},
        session_duration_frames: toNumber(data.session_duration_frames, 0),
        timestamp: formatTimestamp(data.timestamp),
        timestampRaw: data.timestamp,
        patient_id: data.patient_id ?? '',
      });
    });

    allGaitAssessments.sort((a, b) => {
      const byTime = getAssessmentTimeValue(b) - getAssessmentTimeValue(a);
      return byTime || b.id.localeCompare(a.id);
    });

    updateConnectionLabel();
    updateDiseaseSummary();
    renderDiseaseAssessments();
    renderPatients();
  }, (err) => {
    console.error('[Gait assessments]', err);
    gaitAssessmentsError = err;
    updateDiseaseSummary();
    renderDiseaseAssessments();
  });
}

function updateDiseaseSummary() {
  if (!dom.diseaseAssessmentsCount) return;
  if (gaitAssessmentsError) {
    dom.diseaseAssessmentsCount.textContent = '—';
    dom.latestDiseaseCondition.textContent = 'ไม่มีสิทธิ์อ่าน';
    dom.latestDiseaseConfidence.textContent = '—';
    dom.latestDiseasePatient.textContent = gaitAssessmentsError.code === 'permission-denied'
      ? 'Firestore Rules ยังไม่อนุญาต gait_assessments'
      : gaitAssessmentsError.message;
    renderDiseaseScoreCards({});
    return;
  }

  const count = allGaitAssessments.length;
  dom.diseaseAssessmentsCount.textContent = count;

  if (count === 0) {
    dom.latestDiseaseCondition.textContent = '—';
    dom.latestDiseaseConfidence.textContent = '0%';
    dom.latestDiseasePatient.textContent = 'รอข้อมูล';
    renderDiseaseScoreCards({});
    return;
  }

  const latest = allGaitAssessments[0];
  const meta = getDiseaseMeta(latest.condition);
  const pName = getPatientName(latest.patient_id);
  dom.latestDiseaseCondition.textContent = meta.th;
  dom.latestDiseaseConfidence.textContent = `${latest.confidence.toFixed(0)}%`;
  dom.latestDiseasePatient.textContent = pName ? pName : `ID: ${latest.id}`;
  renderDiseaseScoreCards(latest.risk_scores);
}

function renderDiseaseScoreCards(scores) {
  if (!dom.diseaseScoreGrid) return;
  const ordered = ['Normal', 'Parkinsonian', 'Hemiplegic', 'Steppage'];
  const maxScore = Math.max(...ordered.map(key => toNumber(scores[key], 0)), 1);
  dom.diseaseScoreGrid.innerHTML = ordered.map(key => {
    const value = toNumber(scores[key], 0);
    const percent = Math.max(0, Math.min(100, (value / maxScore) * 100));
    const meta = getDiseaseMeta(key);
    return `
      <article class="disease-score-card">
        <div class="disease-score-card__top">
          <span class="disease-score-card__label">${meta.th}</span>
          <span class="disease-score-card__value">${value}</span>
        </div>
        <div class="disease-score-card__bar" aria-hidden="true">
          <div class="disease-score-card__fill" style="width:${percent}%"></div>
        </div>
      </article>`;
  }).join('');
}

function renderDiseaseAssessments() {
  if (!dom.diseaseBody) return;

  if (allGaitAssessments.length === 0) {
    dom.diseaseBody.innerHTML = `
      <tr><td colspan="7" class="table-empty">
        <div class="table-empty__inner">
          <svg width="40" height="40" viewBox="0 0 24 24" style="color:#94a3b8">
            <path d="M4 13h3l2-6 4 12 2.5-7H20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
            <circle cx="18" cy="6" r="2" fill="currentColor"></circle>
          </svg>
          <p>ยังไม่มีข้อมูลความเสี่ยงโรคจาก gait_assessments</p>
        </div>
      </td></tr>`;
    return;
  }

  dom.diseaseBody.innerHTML = allGaitAssessments.map((item, i) => {
    const meta = getDiseaseMeta(item.condition);
    const pName = getPatientName(item.patient_id);
    const patientCell = pName
      ? `<span class="patient-name-badge">${esc(pName)}</span>`
      : `<span class="patient-name-badge patient-name-badge--empty">ไม่ระบุ</span>`;
    const patientOptions = allPatients.map(p =>
      `<option value="${p.id}" ${p.id === item.patient_id ? 'selected' : ''}>${esc(p.name)}</option>`
    ).join('');
    const scores = Object.entries(item.risk_scores ?? {})
      .sort((a, b) => toNumber(b[1]) - toNumber(a[1]))
      .map(([key, value]) => `<span class="score-pill">${esc(getDiseaseMeta(key).th)} <strong>${toNumber(value)}</strong></span>`)
      .join('');

    return `
      <tr>
        <td data-label="ลำดับ" style="font-weight:600;color:var(--clr-text-secondary)">${i + 1}</td>
        <td data-label="ผู้ป่วย">${patientCell}</td>
        <td data-label="ผลที่พบ"><span class="condition-badge condition-badge--${meta.cls}">${meta.th}</span></td>
        <td data-label="ความมั่นใจ">
          <span class="confidence-meter">
            <span class="confidence-meter__track" aria-hidden="true"><span class="confidence-meter__fill" style="width:${Math.max(0, Math.min(100, item.confidence))}%"></span></span>
            <span class="confidence-meter__value">${item.confidence.toFixed(0)}%</span>
          </span>
        </td>
        <td data-label="คะแนน"><span class="score-stack">${scores || '—'}</span></td>
        <td data-label="เวลา">${item.timestamp}</td>
        <td data-label="จัดการ">
          <select class="assign-select" onchange="window._assignGaitAssessment('${item.id}',this.value)">
            <option value="">— เลือกผู้ป่วย —</option>
            ${patientOptions}
          </select>
        </td>
      </tr>`;
  }).join('');
}

function updateDashboard() {
  updateStats();
  updateRiskCards();
  renderTable();
  renderPatients();
  updateDiseaseSummary();
  renderDiseaseAssessments();
}

// ── Stats Cards ──
function updateStats() {
  const count = allResults.length;
  dom.totalTests.textContent = count;
  if (count === 0) {
    dom.avgTotalTime.textContent = '0.00 วินาที';
    dom.avgCheckpointTime.textContent = '0.00 วินาที';
    dom.latestTotalTime.textContent = '—';
    dom.latestTimestamp.textContent = 'ยังไม่มีข้อมูล';
    dom.latestRiskText.textContent = 'รอข้อมูล...';
    return;
  }
  const avgT = allResults.reduce((s, r) => s + r.total_sec, 0) / count;
  const avgCp = allResults.reduce((s, r) => s + r.checkpoint_sec, 0) / count;
  dom.avgTotalTime.textContent = avgT.toFixed(2) + ' วินาที';
  dom.avgCheckpointTime.textContent = avgCp.toFixed(2) + ' วินาที';
  const latest = allResults[0];
  dom.latestTotalTime.textContent = latest.total_sec.toFixed(2) + ' วินาที';
  const pName = getPatientName(latest.patient_id);
  dom.latestTimestamp.textContent = pName ? pName : `ID: ${latest.id}`;
  const meta = riskMeta[latest.risk_level] ?? riskMeta.LOW;
  dom.latestRiskText.textContent = `${meta.emoji} ความเสี่ยง${meta.th}`;
}

// ── Risk Cards ──
function updateRiskCards() {
  const total = allResults.length || 1;
  const c = { LOW: 0, MODERATE: 0, HIGH: 0 };
  allResults.forEach(r => { if (c.hasOwnProperty(r.risk_level)) c[r.risk_level]++; });
  dom.lowCount.textContent = c.LOW;
  dom.modCount.textContent = c.MODERATE;
  dom.highCount.textContent = c.HIGH;
  requestAnimationFrame(() => {
    dom.lowBar.style.width = ((c.LOW / total) * 100).toFixed(1) + '%';
    dom.modBar.style.width = ((c.MODERATE / total) * 100).toFixed(1) + '%';
    dom.highBar.style.width = ((c.HIGH / total) * 100).toFixed(1) + '%';
  });
}

// ── Results Table ──
function renderTable() {
  let filtered = allResults;
  if (activeFilter !== 'ALL') filtered = filtered.filter(r => r.risk_level === activeFilter);
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    filtered = filtered.filter(r => {
      const pName = getPatientName(r.patient_id) || '';
      return r.id.toLowerCase().includes(q) ||
        r.total_sec.toFixed(2).includes(q) ||
        r.checkpoint_sec.toFixed(2).includes(q) ||
        getRiskThai(r.risk_level).includes(q) ||
        r.risk_level.toLowerCase().includes(q) ||
        pName.toLowerCase().includes(q);
    });
  }

  if (filtered.length === 0) {
    dom.resultsBody.innerHTML = `
      <tr><td colspan="6" class="table-empty">
        <div class="table-empty__inner">
          <svg width="40" height="40" viewBox="0 0 24 24" style="color:#94a3b8">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"></circle>
            <path d="M8 15s1.5-2 4-2 4 2 4 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
            <circle cx="9" cy="10" r="1" fill="currentColor"></circle>
            <circle cx="15" cy="10" r="1" fill="currentColor"></circle>
          </svg>
          <p>ไม่พบข้อมูลที่ตรงกับเงื่อนไข</p>
        </div>
      </td></tr>`;
    return;
  }

  dom.resultsBody.innerHTML = filtered.map((r, i) => {
    const cls = getRiskClass(r.risk_level);
    const th = getRiskThai(r.risk_level);
    const delay = Math.min(i * 0.04, 0.6);
    const pName = getPatientName(r.patient_id);

    // Patient name cell
    const patientCell = pName
      ? `<span class="patient-name-badge">${esc(pName)}</span>`
      : `<span class="patient-name-badge patient-name-badge--empty">ไม่ระบุ</span>`;

    // Action cell: assign dropdown
    const patientOptions = allPatients.map(p =>
      `<option value="${p.id}" ${p.id === r.patient_id ? 'selected' : ''}>${esc(p.name)}</option>`
    ).join('');

    return `
      <tr style="animation-delay:${delay}s">
        <td data-label="ลำดับ" style="font-weight:600;color:var(--clr-text-secondary)">${i + 1}</td>
        <td data-label="ผู้ทดสอบ">${patientCell}</td>
        <td data-label="เวลา Checkpoint">${r.checkpoint_sec.toFixed(2)} วินาที</td>
        <td data-label="เวลารวม"><strong>${r.total_sec.toFixed(2)} วินาที</strong></td>
        <td data-label="ระดับความเสี่ยง"><span class="risk-badge risk-badge--${cls}"><span class="risk-badge__dot"></span>${th}</span></td>
        <td data-label="จัดการ">
          <select class="assign-select" onchange="window._assignResult('${r.id}',this.value)">
            <option value="">— เลือก —</option>
            ${patientOptions}
          </select>
        </td>
      </tr>`;
  }).join('');
}

// ================================================================
// EVENT HANDLERS
// ================================================================

// Search
dom.searchInput.addEventListener('input', (e) => {
  searchTerm = e.target.value.trim();
  renderTable();
});

// Filter chips
dom.filterChips.forEach(chip => {
  chip.addEventListener('click', () => {
    dom.filterChips.forEach(c => c.classList.remove('filter-chip--active'));
    chip.classList.add('filter-chip--active');
    activeFilter = chip.dataset.filter;
    renderTable();
  });
});

// Sidebar toggle
dom.sidebarToggle.addEventListener('click', () => setSidebarOpen(!dom.sidebar.classList.contains('sidebar--open')));
dom.sidebarBackdrop?.addEventListener('click', () => setSidebarOpen(false));

// Side nav
dom.sideNavItems.forEach(item => {
  item.addEventListener('click', () => {
    dom.sideNavItems.forEach(n => n.classList.remove('side-nav__item--active'));
    item.classList.add('side-nav__item--active');
    setSidebarOpen(false);
  });
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    setSidebarOpen(false);
    if (dom.patientModal.classList.contains('modal-overlay--open')) closeModal();
  }
});

// Active patient select
dom.activePatientSelect.addEventListener('change', () => renderPatients());

// ── Modal ──
function openModal() { dom.patientModal.classList.add('modal-overlay--open'); dom.patientName.focus(); }
function closeModal() { dom.patientModal.classList.remove('modal-overlay--open'); dom.patientForm.reset(); }

dom.addPatientBtn.addEventListener('click', openModal);
dom.closeModalBtn.addEventListener('click', closeModal);
dom.cancelModalBtn.addEventListener('click', closeModal);
dom.patientModal.addEventListener('click', (e) => { if (e.target === dom.patientModal) closeModal(); });

dom.patientForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = dom.patientName.value.trim();
  const age = dom.patientAge.value;
  const gender = dom.patientGender.value;
  const note = dom.patientNote.value.trim();
  if (!name) return;
  try {
    await addPatient(name, age, gender, note);
    closeModal();
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการบันทึก: ' + err.message);
  }
});

// ================================================================
// BOOTSTRAP
// ================================================================
(async function init() {
  setConnectionStatus('pending', 'กำลังเชื่อมต่อ Firebase...');
  const ok = await signIn();
  if (ok) {
    listenToPatients();
    listenToResults();
    listenToGaitAssessments();
  } else {
    dom.resultsBody.innerHTML = `
      <tr><td colspan="6" class="table-empty">
        <div class="table-empty__inner">
          <svg width="40" height="40" viewBox="0 0 24 24" style="color:var(--clr-high)">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"></circle>
            <path d="M15 9l-6 6m0-6l6 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
          </svg>
          <p>ไม่สามารถเชื่อมต่อ Firebase ได้ — กรุณาตรวจสอบ API Key</p>
        </div>
      </td></tr>`;
    dom.patientsGrid.innerHTML = '<p style="padding:20px;color:var(--clr-high)">ไม่สามารถเชื่อมต่อได้</p>';
    if (dom.diseaseBody) {
      dom.diseaseBody.innerHTML = '<tr><td colspan="7" class="table-empty">ไม่สามารถเชื่อมต่อ Firebase ได้</td></tr>';
    }
  }
})();
