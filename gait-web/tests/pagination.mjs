import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { paginate } = await server.ssrLoadModule('/src/lib/pagination.ts');
  for (const total of [0, 1, 5, 6, 100, 120]) {
    const data = Array.from({ length: total }, (_, id) => ({ id }));
    for (const size of [5, 10, 20]) {
      const all = [];
      const pages = paginate(data, 1, size).pageCount;
      for (let page = 1; page <= pages; page++) {
        const slice = paginate(data, page, size);
        assert.ok(slice.items.length <= size);
        all.push(...slice.items);
      }
      assert.deepEqual(all, data, `no missing/duplicated items: ${total}/${size}`);
      assert.equal(paginate(data, 999, size).page, pages);
    }
  }
  assert.equal(paginate([1], 20, 5).page, 1, 'clamp after deletion/filter');
  assert.equal(paginate([], 20, 5).start, 0);
  const patients = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, name: `QA ${i}`, age: '65', gender: '', note: '' }));
  const results = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, patientId: `p${i}`, status: 'completed', totalSec: 12, checkpointSec: 5, returnSec: 7, trialNo: 1, subjectKey: '', sessionId: '', finishedAt: null }));
  const assessments = Array.from({ length: 120 }, (_, i) => ({ id: `a${i}`, patientId: 'p0', condition: 'Normal', confidence: 80, stepCount: 10, cadenceAvg: 60, riskScores: { Normal: 8 }, timestamp: '2026-09-11T00:00:00Z' }));
  const data = { patients, results, assessments, completedResults: results, assessmentsError: null, conn: 'online', patientName: id => patients.find(p => p.id === id)?.name ?? null };
  for (const [name, expectedTotal, marker] of [['PatientsSection',100,'patient-card__top'],['RecordsSection',100,'data-label="ลำดับ"'],['DiseaseSection',120,'data-label="ลำดับ"']]) {
    const { default: Component } = await server.ssrLoadModule(`/src/components/${name}.tsx`);
    const html = renderToStaticMarkup(createElement(Component, { data, activePatientId: '', setActivePatientId: () => {} }));
    assert.equal(html.split(marker).length - 1, 5, `${name}: only 5 visible records`);
    assert.ok(html.includes(`1-5 จาก ${expectedTotal} รายการ`), `${name}: full count retained`);
    assert.ok(html.includes('data-viewport'), `${name}: bounded viewport`);
  }
  console.log('PASS: pagination boundaries, 100 patients, 100 results, 120 assessments; no omitted/duplicate records across pages.');
} finally {
  await server.close();
}
