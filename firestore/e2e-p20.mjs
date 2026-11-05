// Batch 19 (p20): Word / Excel / legacy .doc uploads + Super Admin HQ records, end-to-end test (phone size 390x844)
// against the LOCAL Auth + Firestore emulators (project demo-ccc). Never touches the live project.
// The ccc-ai worker (AI + R2) is MOCKED with page.route: no AI call, no bucket, no keys.
// Run: npm run test:e2e:p20
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = process.env.SHOTS_DIR || join(ROOT, 'firestore', 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const PROJECT = 'demo-ccc';
const AUTH = 'http://127.0.0.1:9099';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const PASS = 'Passw0rd!';

// Tiny static server for index.html / app.js / styles.css.
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png' };
const server = createServer((req, res) => {
  let path = new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
  // Mirror vercel.json: /join -> /join/index.html
  if (path === '/join') path = '/join/index.html';
  let body;
  try { body = readFileSync(join(ROOT, path)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[extname(path)] || 'text/plain' }); res.end(body);
}).listen(5072, '127.0.0.1');
const APP = 'http://127.0.0.1:5072/?emulator=1';

async function signUp(email, password) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  return (await r.json()).localId;
}
async function seedDoc(path, fields) {
  const f = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { stringValue: v }]));
  const r = await fetch(`${FS}/${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ fields: f }) });
  assert.ok(r.ok, 'seed ' + path);
}

const launch = {};
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
if (process.env.HTTPS_PROXY) launch.proxy = { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' };
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
// Dialogs: remember every message; answer prompts with promptAnswer.
const dialogs = [];
let promptAnswer = '';
page.on('dialog', d => { dialogs.push(d.message()); return d.type() === 'prompt' ? d.accept(promptAnswer) : d.accept(); });
const NM = join(ROOT, 'firestore', 'node_modules');
await page.route('https://cdn.tailwindcss.com/**', r => r.fulfill({ path: join(NM, '@tailwindcss/browser/dist/index.global.js'), contentType: 'text/javascript' }));
await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ path: join(NM, 'firebase', r.request().url().split('/').pop()), contentType: 'text/javascript' }));
await page.route('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/**', r => {
  const rel = new URL(r.request().url()).pathname.split('/6.4.0/')[1];
  return r.fulfill({ path: join(NM, '@fortawesome/fontawesome-free', rel) });
});
await page.route('https://cdn.jsdelivr.net/npm/**', r => r.fulfill({ path: join(NM, r.request().url().split('/npm/')[1].replace(/@[\d.]+/, '')), contentType: 'text/javascript' }));

const pageErrors = [];
page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text().slice(0, 600)); });
page.on('pageerror', e => { pageErrors.push(e.message); console.error('pageerror', e.message, e.stack); });
const shot = (name) => page.screenshot({ path: join(SHOTS, name + '.png') });
const fullShot = (name) => page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: true });

// A real, large picture to upload: a PNG screenshot drawn with a coloured canvas.
async function makeImage(label, color) {
  return page.evaluate(([label, color]) => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 1500;
    const x = c.getContext('2d');
    for (let i = 0; i < 4000; i++) { x.fillStyle = `hsl(${(i * 37) % 360},70%,${30 + (i % 50)}%)`; x.fillRect(Math.random() * 1200, Math.random() * 1500, 30, 30); }
    x.fillStyle = color; x.beginPath(); x.arc(600, 600, 380, 0, 7); x.fill();
    x.fillStyle = '#fff'; x.font = 'bold 160px sans-serif'; x.textAlign = 'center'; x.fillText(label, 600, 660);
    return c.toDataURL('image/png').split(',')[1];
  }, [label, color]).then(b64 => ({ name: label + '.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') }));
}

async function login(email) {
  await page.goto(APP);
  await page.fill('#loginEmail', email);
  await page.fill('#loginPassword', PASS);
  await page.click('#accessBtn');
  await page.waitForSelector('#mainApp:not(.hidden)');
}
async function logout() { await page.evaluate(() => logout()); await page.waitForSelector('#landingPage:not(.hidden)'); }
// Phase 10: optional parish extras sit in a collapsed <details>; tests open it to fill them.
const nav = async (id) => { await page.click('#nav-' + id); if (id === 'parishes' || id === 'settings') await page.evaluate(() => document.querySelectorAll('#np_extras, #s_extras').forEach(d => d.open = true)); };
const modalClosed = (id) => page.waitForSelector(`#${id}.hidden`, { state: 'attached', timeout: 15000 });

const noFail = (d0, re = /Not saved|not saved|failed|Not confirmed|Could not/) => assert.ok(!dialogs.slice(d0).some(m => re.test(m)), 'no failure dialog: ' + dialogs.slice(d0).join(' | '));
async function createParish(name, city, country, continent, cur, pl, cl, email) {
  await nav('parishes');
  await page.fill('#np_name', name); await page.evaluate(a => setLocationFields('np_', ...a), [country, '', city]);
  await page.selectOption('#np_continent', continent); await page.selectOption('#np_currency', cur);
  await page.fill('#np_pletters', pl); await page.fill('#np_cletters', cl); await page.fill('#np_email', email);
  await page.evaluate(() => { const r = document.getElementById('inviteResult'); r.innerHTML = ''; });
  await page.click('#createParishBtn');
  await page.waitForSelector('#inviteCode');
  return (await page.textContent('#inviteCode')).trim();
}
async function claim(email, code) {
  await page.click('#inviteToggle');
  await page.fill('#invEmail', email); await page.fill('#invCode', code); await page.fill('#invPassword', PASS);
  await page.click('#claimBtn');
  await page.waitForSelector('#mainApp:not(.hidden)');
}
async function readDoc(path) {
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: 'Bearer owner' } });
  return r.ok ? (await r.json()).fields : null;
}

// ---------------- Real Office files, made here: .docx + legacy Word 97 .doc by LibreOffice, .xlsx by SheetJS.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const XLSX = createRequire(import.meta.url)('xlsx');
const TMP = mkdtempSync(join(tmpdir(), 'ccc-p20-'));
function office(base, marker, name, phone, filter) {
  const html = join(TMP, base + '.html');
  writeFileSync(html, `<html><body><p>${marker} Ijaye member list</p><table><tr><td>Name</td><td>Phone</td></tr><tr><td>${name}</td><td>${phone}</td></tr></table></body></html>`);
  execFileSync(process.env.SOFFICE || 'soffice', ['--headless', '--convert-to', filter, '--outdir', TMP, html], { stdio: 'ignore', timeout: 120000 });
  return readFileSync(join(TMP, base + '.' + filter.split(':')[0]));
}
const DOCX = office('list-docx', 'DOCXMARK', 'Tola Wordnew', '08020000001', 'docx:MS Word 2007 XML');
const DOC = office('list-doc', 'DOCMARK', 'Bisi Wordold', '08020000003', 'doc:MS Word 97');
const HQDOCX = office('hq-docx', 'HQMARK', 'Segun Hqperson', '08020000009', 'docx:MS Word 2007 XML');
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['XLSXMARK Name', 'Phone'], ['Kemi Sheetrow', '08020000002']]), 'Members');
const XLSXBUF = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
assert.equal(DOC.readUInt32BE(0), 0xd0cf11e0, 'legacy .doc is an OLE file');
assert.equal(DOCX.readUInt32BE(0), 0x504b0304, '.docx is a zip');

// ---------------- Mock of the ccc-ai worker /classify. Answers by the marker found in the text the phone read.
const WORKER = 'https://ccc-ai.aarinat-company-limited.workers.dev';
const calls = [];
const P = (fullName, phone) => ({ fullName, phone, gender: 'Female', maritalStatus: 'Married', dobDay: 5, dobMonth: 6, track: 'member', prophet: false, departments: [], committees: [] });
const BY = { DOCXMARK: P('Tola Wordnew', '08020000001'), XLSXMARK: P('Kemi Sheetrow', '08020000002'), DOCMARK: P('Bisi Wordold', '08020000003'), HQMARK: P('Segun Hqperson', '08020000009') };
async function mockWorker(route) {
  const req = route.request(), cors = { 'access-control-allow-origin': '*' };
  if (new URL(req.url()).pathname !== '/classify') return route.fulfill({ status: 404, headers: cors, body: '{}' });
  const b = JSON.parse(req.postData()); calls.push(b);
  const k = Object.keys(BY).find(m => (b.text || '').includes(m));
  return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ people: k ? [BY[k]] : [], engine: 'mock' }) });
}

// Import members -> "Word / Excel / PDF / CSV" tab -> pick files -> people appear in the check table -> Save all.
async function importFiles(files, names) {
  await page.evaluate(() => openImport());
  await page.click('#imp_tab_csv');
  await page.setInputFiles('#imp_file', files);
  const before = calls.length;
  await page.click('#imp_csvBtn');
  await page.waitForFunction(n => document.querySelectorAll('.imp-row').length === n, names.length, { timeout: 30000 });
  assert.equal(calls.length, before + files.length, 'one AI call per file');
  const shown = await page.$$eval('.imp-row input[data-k="fullName"]', a => a.map(i => i.value));
  assert.deepEqual(shown.sort(), [...names].sort());
}
async function saveAll() {
  await page.check('#imp_consent');
  const d0 = dialogs.length;
  await page.click('#imp_saveBtn');
  await page.waitForFunction(() => /Saved \d+/.test(document.getElementById('imp_status').textContent), null, { timeout: 30000 });
  noFail(d0);
  return page.textContent('#imp_status');
}

try {
  const superUid = await signUp('bayo@test.local', PASS);
  await seedDoc(`users/${superUid}`, { role: 'super_admin', name: 'Bayo Adeyemi' });
  await login('bayo@test.local');
  const code = await createParish('TEST Ijaye Parish', 'Lagos', 'Nigeria', 'Africa', 'NGN', 'IJY', 'LAG', 'ijaye@test.local');
  await logout();
  await page.goto(APP); await claim('ijaye@test.local', code);
  await page.route(WORKER + '/**', mockWorker);
  const pid = await page.evaluate(() => localState.currentParishId);

  // ---- 0. Every upload box takes Word on Android: MIME types + extensions + */* (nothing greyed out).
  for (const id of ['imp_file', 'in_files', 'aiFile']) {
    const acc = await page.getAttribute('#' + id, 'accept');
    for (const t of ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', '.doc', '.docx',
      '.xlsx', '.xls', '.csv', '.txt', 'application/pdf', '*/*']) assert.ok(acc.split(',').includes(t), `${id} accepts ${t}`);
  }

  // ---- 1. Import members page: a real .docx (Word 2007+).
  await importFiles([{ name: 'Ijaye members.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: DOCX }], ['Tola Wordnew']);
  assert.match(calls.at(-1).text, /Tola Wordnew \| 08020000001/, 'docx table row read on the phone');
  await shot('p20-01-import-docx');
  assert.match(await saveAll(), /Saved 1 member/);
  assert.equal((await readDoc(`parishes/${pid}/members/CCC-IJY-LAG-MBR-001`)).fullName.stringValue, 'Tola Wordnew');

  // ---- 2. Excel + legacy Word 97 .doc together; the .doc arrives the Android way: no extension, no MIME type.
  await importFiles([{ name: 'members.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSXBUF },
    { name: 'document', mimeType: '', buffer: DOC }], ['Kemi Sheetrow', 'Bisi Wordold']);
  const docCall = calls.slice(-2).find(c => /DOCMARK/.test(c.text || ''));
  assert.ok(docCall && /Bisi Wordold/.test(docCall.text), 'old .doc text pulled out on the phone');
  await shot('p20-02-import-xlsx-doc');
  assert.match(await saveAll(), /Saved 2 members/);

  // ---- 3. Data Intake page: a .docx with a generic MIME type (Google Docs / WPS / Drive downloads).
  await page.evaluate(() => closeModal('importModal'));
  await nav('intake');
  await page.setInputFiles('#in_files', [{ name: 'export.docx', mimeType: 'application/octet-stream', buffer: DOCX }]);
  await page.click('#in_readBtn');
  await page.waitForFunction(() => document.querySelectorAll('.in-file[data-status="Done"]').length === 1, null, { timeout: 30000 });

  // ---- 4. AI data entry page reads the legacy .doc too (no "not supported" error).
  const aiText = await page.evaluate(async b64 => (await readListFile(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'old list.doc', { type: 'application/msword' }))).text, DOC.toString('base64'));
  assert.match(aiText, /Bisi Wordold/);
  // ---- 4b. Standard CCC weekly timetable (Bayo's): attendance preselect, website lines, roster rows, calendar.
  const tt = await page.evaluate(() => ({
    thu1: serviceFor('2026-11-05', new Date(2026, 10, 4)).key, thu2: serviceFor('2026-11-12', new Date(2026, 10, 4)).key,
    mon: servicesOn('2026-11-09').map(x => x.name + ' ' + x.time), sat: servicesOn('2026-11-14').length,
    late: serviceFor('2026-11-11', new Date(2026, 10, 11, 17, 0)).key, sun: serviceFor('2026-11-08', new Date(2026, 10, 1)).time,
    lines: timetableLines(), row1: newRow('2026-11-05', {}).service, row2: newRow('2026-11-19', {}).service,
    cal: weekServices('2026-11-01').map(x => x.key) }));
  assert.equal(tt.thu1, 'new_moon', '1st Thursday = New Moon'); assert.equal(tt.thu2, 'vigil_prophets', '2nd-5th Thursday = Prophets vigil');
  assert.deepEqual(tt.mon, ['Bible Class / Bible Study 17:00', 'Sidemen/Sidewomen Night Vigil 23:59']);
  assert.equal(tt.sat, 0, 'Saturday has no service'); assert.equal(tt.late, 'wed_evening'); assert.equal(tt.sun, '10:00');
  for (const l of ['Sunday 10:00 Sunday Service', 'Tuesday 09:00 Wakati Adura', 'Wednesday 09:00 Seekers Service', 'Wednesday 18:00 Wednesday Evening Service',
    'Thursday 22:00 New Moon Service (1st Thursday of the month)', 'Thursday 23:59 Prophets/Prophetesses Night Vigil (2nd-5th Thursday)',
    'Friday 18:00 Friday Evening Service', 'Saturday: Church cleaning (no service)']) assert.ok(tt.lines.includes(l), 'website line: ' + l);
  assert.equal(tt.row1, 'New Moon Service'); assert.equal(tt.row2, 'Prophets/Prophetesses Night Vigil');
  assert.deepEqual(tt.cal, ['sunday', 'bible', 'vigil_sidemen', 'wakati', 'seekers', 'wed_evening', 'new_moon', 'fri_evening']);
  // Free "Record a service": the picker follows the chosen date (and stays editable).
  await page.evaluate(() => { openServiceModal(); $('svc_date').value = '2026-11-05'; svcPreselect(); });
  assert.equal(await page.inputValue('#svc_key'), 'new_moon'); assert.equal(await page.inputValue('#svc_time'), '22:00');
  await page.evaluate(() => { $('svc_date').value = '2026-11-26'; svcPreselect(); });
  assert.equal(await page.inputValue('#svc_key'), 'vigil_prophets');
  await page.evaluate(() => closeModal('serviceModal'));
  // Website: empty public info is pre-filled with the whole timetable.
  await page.evaluate(() => openPublicInfo());
  await page.waitForFunction(() => /New Moon Service \(1st Thursday/.test(document.getElementById('pi_services').value));
  // A file that really is not text gives a clear message, not a silent failure.
  const bad = await page.evaluate(async () => { try { await intakeInputs(new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 1, 2])], 'empty.doc')); return ''; } catch (e) { return e.message; } });
  assert.match(bad, /Save as \.docx or PDF/);
  await logout();

  // ---- 5. Super Admin: imports into HQ's OWN records (hqMembers), never into a parish.
  await login('bayo@test.local');
  await page.route(WORKER + '/**', mockWorker);
  await nav('intake');
  await page.waitForSelector('#in_superNote:not(.hidden)');
  await page.setInputFiles('#in_files', [{ name: 'hq list.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: HQDOCX }]);
  await page.click('#in_readBtn');
  await page.waitForSelector('#in_hqBtn:not(.hidden)');
  await page.click('#in_hqBtn');
  await page.waitForSelector('#importModal:not(.hidden)');
  assert.equal(await page.textContent('#imp_title'), 'IMPORT INTO HQ RECORDS');
  await shot('p20-03-super-hq-import');
  assert.match(await saveAll(), /Saved 1 member/);
  const hm = await readDoc('hqMembers/CCC-HQ-MBR-001');
  assert.equal(hm.fullName.stringValue, 'Segun Hqperson'); assert.equal(hm.createdBy.stringValue, superUid);
  assert.equal((await readDoc('hqMeta/members')).n.integerValue, '1');
  assert.equal((await readDoc('auditLog/hqMembers_CCC-HQ-MBR-001_v1')).action.stringValue, 'import-hq-member');
  assert.equal(await readDoc(`parishes/${pid}/members/CCC-IJY-LAG-MBR-004`), null, 'nothing went into the parish');
  // Super Admin writing straight into a parish is refused by the rules.
  const denied = await page.evaluate(async p => { try { await db.collection('parishes').doc(p).collection('members').doc('CCC-IJY-LAG-MBR-004').set({ fullName: 'x' }); return 'saved'; } catch (e) { return e.code; } }, pid);
  assert.equal(denied, 'permission-denied');
  assert.deepEqual(pageErrors, [], 'no page errors');
  console.log('E2E BATCH 19 (P20) PASSED');
} catch (e) {
  console.error('E2E FAILED', e);
  await page.screenshot({ path: join(SHOTS, 'p20-zz-failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
