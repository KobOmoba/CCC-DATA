// Unit tests for the ccc-ai worker helpers and the shared alert core. Run: node --test ai-worker/
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { default: w } = await import('./worker.js');
const A = globalThis.AlertsCore;

test('origins: production + this project\'s Vercel previews only', () => {
  for (const o of ['https://ccc-parish-portal.vercel.app', 'https://kobomoba.github.io', 'https://ccc-parish-portal-git-main-aadesanya173-gmailcoms-projects.vercel.app'])
    assert.ok(w.allowedOrigin(o), o);
  for (const o of ['https://ccc-parish-portal-x-aadesanya173-gmailcoms-projects.vercel.app.evil.com', 'https://evil-ccc-parish-portal-x-aadesanya173-gmailcoms-projects.vercel.app',
    'https://ccc-parish-portal-x-someone-projects.vercel.app', 'http://ccc-parish-portal.vercel.app', 'https://ccc-parish-portal.vercel.app.evil.com'])
    assert.ok(!w.allowedOrigin(o), o);
});
test('summary totals: numbers only, never names', () => {
  const t = w.cleanTotals({ month: 'November 2026', alerts: 3, name: 'Olumide Ajayi', alertsByCountry: { Nigeria: 2, '<b>': 1 }, world: { members: 5, parish: 'Ikeja' } });
  assert.deepEqual(t, { month: 'November 2026', alerts: 3, alertsByCountry: { Nigeria: 2 }, world: { members: 5 } });
});
test('alerts core: returns gap, membership decline, attendance drop, inactive', () => {
  const p = [{ id: 'P', name: 'P', status: 'Approved', createdAt: '2025-01-01' }];
  const gap = A.returnAlerts('2026-10', p, { P: { '2026-08': { income: { tithes: 1 }, attendance: 1, outstanding: 0, currency: 'NGN' } } }, '2026-11-20');
  assert.ok(gap.some(a => a.rule === 'returnsGap'));
  const sn = { P: { '2026-07': { month: '2026-07', attendanceTotal: 0, memberCount: 50 }, '2026-08': { month: '2026-08', attendanceTotal: 400, memberCount: 50 },
    '2026-09': { month: '2026-09', attendanceTotal: 800, memberCount: 50 }, '2026-10': { month: '2026-10', attendanceTotal: 900, memberCount: 45 },
    '2026-11': { month: '2026-11', attendanceTotal: 950, memberCount: 40, lastActive: '2026-09-01' } } };
  assert.deepEqual(A.statsAlerts('2026-11', p, sn, '2026-11-20').map(a => a.rule).sort(), ['attendanceDrop', 'inactive', 'memberDecline']);
  sn.P['2026-11'].lastActive = '2026-11-19';
  assert.ok(!A.statsAlerts('2026-11', p, sn, '2026-11-20').some(a => a.rule === 'inactive'));
});

// ---------------- Batch 18: intake placement + R2 archive (all external calls mocked) ----------------
const UNITS = w.cleanUnits([{ id: 'choir', name: 'Choir' }, { id: 'sidemen', name: 'Sidemen' }, { id: 'u_Ushers1a2b', name: 'Ushers' },
  { id: '../evil', name: 'X' }, { id: 'prophets', name: '' }]);
test('classify: only real unit ids are offered to the AI', () => {
  assert.deepEqual(UNITS.map(u => u.id), ['choir', 'sidemen', 'u_Ushers1a2b']);
  const p = w.classifyPrompt(UNITS, ['Harvest Committee 2026']);
  assert.match(p, /choir = Choir/); assert.match(p, /Harvest Committee 2026/); assert.match(p, /NEVER clergy/);
});
test('classify: women are never clergy; clergy never in departments; unknown units/committees dropped', () => {
  const cm = ['Harvest Committee 2026', 'Welfare Committee'];
  const f = w.cleanPlacement({ fullName: 'Ade Test', gender: 'Female', rank: 'Mother Celestial', track: 'clergy', prophet: true,
    departments: ['choir', 'madeup'], deptRole: 'Choir Mistress', committees: [{ name: 'harvest committee 2026', role: 'Secretary' }, { name: 'Ghost', role: 'X' }] }, UNITS, cm);
  assert.equal(f.track, 'member'); assert.match(f.placementNote, /never clergy/);
  assert.equal(f.prophet, true); assert.equal(f.rank, 'Mother Celestial');
  assert.deepEqual(f.departments, ['choir']); assert.equal(f.deptRole, 'Choir Mistress');
  assert.deepEqual(f.committees, [{ name: 'Harvest Committee 2026', role: 'Secretary' }]);
  const m = w.cleanPlacement({ fullName: 'Olu Test', gender: 'Male', rank: 'Evangelist', track: 'clergy', departments: ['choir'], committees: ['Welfare Committee'] }, UNITS, cm);
  assert.equal(m.track, 'clergy'); assert.deepEqual(m.departments, []); assert.equal(m.deptRole, '');
  assert.deepEqual(m.committees, [{ name: 'Welfare Committee', role: 'Member' }]);
  assert.equal(w.cleanPlacement({ fullName: 'X', track: 'anything' }, UNITS, cm).track, 'member');
});

// Fake R2 bucket + a fetch that plays Firestore (REST) and Gemini.
function fakeBucket() {
  const m = new Map();
  return { m, async put(k, v, o) { m.set(k, { bytes: new Uint8Array(v), ...o }); }, async get(k) { const x = m.get(k); return x ? { body: x.bytes, httpMetadata: x.httpMetadata } : null; } };
}
const fsDocs = {};
const toF = o => ({ fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { stringValue: v }])) });
let geminiReply = null;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes('generativelanguage')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(geminiReply) }] } }] }), { status: 200 });
  const m = url.match(/documents\/(.+)$/);
  if (m) {
    const tok = (init.headers || {}).Authorization || '';
    const d = fsDocs[m[1]];
    // "Rules": a token may read its own users doc, its parish when Approved, and archive docs of its parish (super: all).
    const who = tok.replace('Bearer ', ''), me = fsDocs['users/' + who];
    const ok = d && me && (m[1] === 'users/' + who || me.role === 'super_admin'
      || (m[1].startsWith('parishes/') && me.parishId === m[1].split('/')[1] && d.status === 'Approved')
      || (m[1].startsWith('archive/') && d.parishId === me.parishId));
    return ok ? new Response(JSON.stringify(toF(d)), { status: 200 }) : new Response('{}', { status: d ? 403 : 404 });
  }
  throw new Error('unexpected fetch ' + url);
};
Object.assign(fsDocs, {
  'users/uA': { role: 'parish_admin', parishId: 'A' }, 'users/uS': { role: 'parish_admin', parishId: 'S' }, 'users/uSup': { role: 'super_admin' },
  'parishes/A': { status: 'Approved' }, 'parishes/S': { status: 'Suspended' },
});
w.deps.verify = async t => { if (!fsDocs['users/' + t] && t !== 'uNone') throw new Error('bad'); return t; }; // token == uid in tests
const ORIGIN = 'https://ccc-parish-portal.vercel.app';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
const PDF = new TextEncoder().encode('%PDF-1.4 fake');
const up = (tok, parish, body, type = 'image/jpeg') => w.fetch(new Request('https://w/archive/upload', { method: 'POST', body,
  headers: { Origin: ORIGIN, Authorization: 'Bearer ' + tok, 'Content-Type': type, 'X-Parish-Id': parish, 'X-File-Name': 'Minutes 1990.jpg' } }), env);
const env = { ARCHIVE: fakeBucket(), GEMINI_API_KEY: 'test-not-a-key' };

test('archive upload: own parish only, Super Admin for HQ, type + size + magic bytes checked', async () => {
  let r = await up('uA', 'A', JPEG);
  assert.equal(r.status, 200); const out = await r.json();
  assert.match(out.key, /^A\/\d{4}\/[0-9a-f-]{36}\.jpg$/); assert.equal(out.size, JPEG.length);
  assert.equal(env.ARCHIVE.m.get(out.key).customMetadata.uid, 'uA');
  assert.equal((await up('uA', 'B', JPEG)).status, 403, 'other parish');
  assert.equal((await up('uA', 'HQ', JPEG)).status, 403, 'parish admin cannot write HQ');
  assert.equal((await up('uS', 'S', JPEG)).status, 403, 'suspended parish');
  assert.equal((await up('uNone', 'A', JPEG)).status, 403, 'no profile');
  assert.equal((await up('uSup', 'HQ', PDF, 'application/pdf')).status, 200, 'super admin HQ pdf');
  assert.equal((await up('uA', 'A', PDF, 'image/jpeg')).status, 415, 'content does not match the type');
  assert.equal((await up('uA', 'A', JPEG, 'text/html')).status, 415, 'html refused');
  assert.equal((await up('uA', 'A', new Uint8Array(15 * 1024 * 1024 + 1).fill(0xff))).status, 413, 'too big');
  assert.equal((await up('uA', '../x', JPEG)).status, 400);
  assert.equal((await up('bad', 'A', JPEG)).status, 401);
  assert.equal((await w.fetch(new Request('https://w/archive/upload', { method: 'POST', body: JPEG, headers: { Origin: 'https://evil.com', Authorization: 'Bearer uA', 'Content-Type': 'image/jpeg', 'X-Parish-Id': 'A' } }), env)).status, 403);
  const noR2 = await w.fetch(new Request('https://w/archive/upload', { method: 'POST', body: JPEG, headers: { Origin: ORIGIN, Authorization: 'Bearer uA', 'Content-Type': 'image/jpeg', 'X-Parish-Id': 'A' } }), {});
  assert.equal(noR2.status, 503);
});
test('archive download: proxied, only when Firestore lets the caller read the index doc', async () => {
  const r = await up('uA', 'A', JPEG); const { key } = await r.json();
  fsDocs['archive/doc1'] = { parishId: 'A', fileKey: key };
  fsDocs['archive/doc2'] = { parishId: 'B', fileKey: key };     // key of another parish: refused
  fsDocs['users/uB'] = { role: 'parish_admin', parishId: 'B' };
  const get = (tok, id) => w.fetch(new Request('https://w/archive/file?id=' + id, { headers: { Origin: ORIGIN, Authorization: 'Bearer ' + tok } }), env);
  let g = await get('uA', 'doc1');
  assert.equal(g.status, 200); assert.equal(g.headers.get('content-type'), 'image/jpeg'); assert.equal(g.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(new Uint8Array(await g.arrayBuffer()), JPEG);
  assert.equal((await get('uB', 'doc1')).status, 404, 'other parish cannot read');
  assert.equal((await get('uB', 'doc2')).status, 404, 'index pointing at another parish key');
  assert.equal((await get('uSup', 'doc1')).status, 200, 'super admin');
  assert.equal((await get('uA', '../../x')).status, 400);
});
test('classify route: AI reply cleaned into placements (Gemini mocked)', async () => {
  geminiReply = { people: [{ fullName: 'Bola Fake', gender: 'F', rank: 'L/S/S/E/P', track: 'clergy', departments: ['choir'], committees: [] },
    { fullName: 'Kunle Fake', gender: 'Male', rank: 'Evangelist', track: 'clergy', prophet: true, departments: ['choir'] }] };
  const r = await w.fetch(new Request('https://w/classify', { method: 'POST', headers: { Origin: ORIGIN, Authorization: 'Bearer uA', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'list', units: [{ id: 'choir', name: 'Choir' }], committees: [] }) }), env);
  assert.equal(r.status, 200);
  const { people } = await r.json();
  assert.equal(people[0].track, 'member'); assert.deepEqual(people[0].departments, ['choir']); assert.equal(people[0].rankAsWritten, 'L/S/S/E/P');
  assert.equal(people[1].track, 'clergy'); assert.equal(people[1].prophet, true); assert.deepEqual(people[1].departments, []);
});
