// Batch 21 (p21): returning clergy, clergy timeline + history, transfer letter PDF/photo chunks, attendance .xlsx/PDF,
// end-to-end at phone size 390x844 against the LOCAL Auth + Firestore emulators (project demo-ccc). Never touches live data.
// Run: npm run test:e2e:p21
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
}).listen(5073, '127.0.0.1');
const APP = 'http://127.0.0.1:5073/?emulator=1';

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


import { createRequire } from 'node:module';
const XLSX = createRequire(import.meta.url)('xlsx');

async function addClergy(i, p) {
  await nav('clergy');
  await page.click('#addClergyBtn');
  await page.waitForSelector('#personModal:not(.hidden)');
  await page.fill('#p_name', p.name);
  await page.selectOption('#p_gender', 'Male');
  await page.selectOption('#p_marital', 'Married');
  await page.fill('#p_address', `${i} Ikorodu Road, Lagos`);
  await page.fill('#p_phone', '0803 222 000' + i);
  await page.fill('#p_email', p.email);
  await page.selectOption('#p_rank', p.rank);
  await page.fill('#p_occupation', 'Clergy');
  await page.selectOption('#p_dobDay', '2'); await page.selectOption('#p_dobMonth', '2');
  await page.fill('#p_nokName', 'TEST Kin ' + i); await page.fill('#p_nokAddress', 'Ibadan'); await page.fill('#p_nokPhone', '0700 000 000' + i);
  await page.check('#p_consent');
  await page.click('#savePersonBtn');
  await modalClosed('personModal');
}
const openClergy = async no => { await page.evaluate(n => openRecord('clergy', n), no); await page.waitForSelector('#recordModal:not(.hidden)'); };

// A real 2-page PDF letter, printed by Chromium itself.
async function makePdf() {
  const p2 = await browser.newPage();
  await p2.setContent(`<h1 style="font:40px sans-serif">TRANSFER LETTER page 1</h1><p style="page-break-after:always">CCC Ijaye to CCC Abuja</p><h1 style="font:40px sans-serif">page 2: signed</h1>`);
  const buf = await p2.pdf({ format: 'A4' }); await p2.close();
  return { name: 'transfer letter.pdf', mimeType: 'application/pdf', buffer: buf };
}

try {
  const superUid = await signUp('bayo@test.local', PASS);
  await seedDoc(`users/${superUid}`, { role: 'super_admin', name: 'Bayo Adeyemi' });
  await login('bayo@test.local');
  const code = await createParish('TEST Ijaye Parish', 'Lagos', 'Nigeria', 'Africa', 'NGN', 'IJY', 'LAG', 'ijaye@test.local');
  await logout();
  await page.goto(APP); await claim('ijaye@test.local', code);
  const pid = await page.evaluate(() => localState.currentParishId);
  const C1 = 'CCC-IJY-LAG-CLG-001', C2 = 'CCC-IJY-LAG-CLG-002';
  await addClergy(1, { name: 'TEST Ven Femi Bello', email: 'femi@test.local', rank: 'Evangelist' });
  await addClergy(2, { name: 'TEST Ev Gbenga Lawal', email: 'gbenga@test.local', rank: 'Evangelist' });

  // ---- 2a. Rank change through Edit goes on the timeline.
  await openClergy(C1);
  await page.click('#recordActions >> text=Edit');
  await page.waitForSelector('#personModal:not(.hidden)');
  await page.selectOption('#p_rank', 'Senior Evangelist');
  await page.click('#savePersonBtn'); await modalClosed('personModal');

  // ---- 3. Transfer to Former with a 2-page PDF letter: stored as page pictures in Firestore chunks.
  await openClergy(C1);
  await page.click('text=Transfer / move to Former');
  await page.waitForSelector('#transferModal:not(.hidden)');
  await page.selectOption('#t_reason', 'Retired');
  assert.ok(await page.isHidden('#t_letterBox'), 'letter box only for a transfer');
  await page.selectOption('#t_reason', 'Transfer');
  const TODAY = await page.evaluate(() => localToday());
  await page.fill('#t_date', TODAY);
  await page.fill('#t_to', 'TEST CCC Abuja Parish');
  await page.setInputFiles('#t_letter', await makePdf());
  let d0 = dialogs.length;
  await page.click('#saveTransferBtn');
  await modalClosed('transferModal');
  await page.waitForSelector('#recordTitle:has-text("· Former")');
  noFail(d0);
  const c1 = await readDoc(`parishes/${pid}/clergy/${C1}`);
  const letterId = c1.letterId.stringValue;
  const letter = await readDoc(`parishes/${pid}/letters/${letterId}`);
  assert.equal(letter.storage.stringValue, 'firestore'); assert.equal(letter.mime.stringValue, 'application/pdf'); assert.equal(letter.pages.integerValue, '2');
  assert.ok(await readDoc(`parishes/${pid}/letters/${letterId}/chunks/0`), 'chunk saved');
  await page.click('text=View transfer letter');
  await page.waitForFunction(() => document.querySelectorAll('#letterView img.letter-page').length === 2 && [...document.querySelectorAll('#letterView img')].every(i => i.naturalWidth > 0));
  // A later upload on the service record (photo) replaces the link; the old letter is kept.
  await page.click('text=Replace transfer letter');
  await page.setInputFiles('#lu_file', await makeImage('LETTER', '#334155'));
  await page.click('#lu_saveBtn');
  await page.waitForSelector('#recordModal:not(.hidden)');
  const l2 = (await readDoc(`parishes/${pid}/clergy/${C1}`)).letterId.stringValue;
  assert.notEqual(l2, letterId); assert.ok(await readDoc(`parishes/${pid}/letters/${letterId}`), 'old letter kept');
  await page.click('text=View transfer letter');
  await page.waitForFunction(() => document.querySelectorAll('#letterView img.letter-page').length === 1 && document.querySelector('#letterView img').naturalWidth > 0);
  await page.evaluate(() => document.querySelector('#letterView').scrollIntoView());
  await shot('p21-01-letter-view');

  // ---- 1. Restored to service: same number, new period, previous kept, audited. Called-to-glory cannot return.
  await page.click('text=Restored to service');
  await page.waitForSelector('#p9Modal:not(.hidden)');
  await page.fill('#rs_from', '2026-01-01');
  d0 = dialogs.length;
  await page.click('#rs_saveBtn');
  assert.ok(dialogs.slice(d0).some(m => /cannot be before/.test(m)), 'start before leaving refused');
  await page.fill('#rs_from', TODAY); await page.fill('#rs_posting', 'Assistant shepherd');
  await page.click('#rs_saveBtn');
  await page.waitForSelector('#recordModal:not(.hidden)');
  await page.waitForSelector(`#recordTitle:text-is("${C1}")`);
  const r1 = await readDoc(`parishes/${pid}/clergy/${C1}`);
  assert.equal(r1.status.stringValue, 'Active'); assert.equal(r1.restoreCount.integerValue, '1');
  const per = r1.servicePeriods.arrayValue.values[0].mapValue.fields;
  assert.equal(per.to.stringValue, TODAY); assert.equal(per.reason.stringValue, 'Transfer'); assert.equal(per.letterId.stringValue, l2);
  const au = await readDoc(`auditLog/parishes_${pid}_clergy_${C1}_v1`);
  assert.equal(au.action.stringValue, 'clergy-restore');
  const st = await readDoc(`parishStats/${pid}`);
  assert.equal(st.clergyCount.integerValue, '2'); assert.equal(st.formerClergyCount.integerValue, '0');
  const kinds = await page.$$eval('.tl-ev', a => a.map(e => e.dataset.kind));
  for (const k of ['joined', 'rank', 'left', 'return']) assert.ok(kinds.includes(k), 'timeline has ' + k);
  assert.match(await page.textContent('.clergy-timeline'), /Rank: Senior Evangelist[\s\S]*Transferred to TEST CCC Abuja Parish[\s\S]*Restored to service · Assistant shepherd/);
  await page.evaluate(() => document.querySelector('.clergy-timeline').scrollIntoView());
  await shot('p21-02-timeline-restored');
  // The rules refuse a quiet re-activation (no audit) and deleting; a woman can never be restored as clergy.
  await page.evaluate(() => closeModal('recordModal'));
  const raw = await page.evaluate(async ([p, no]) => {
    const ref = db.collection('parishes').doc(p).collection('clergy').doc(no);
    const out = [];
    await ref.update({ status: 'Former', joinedDate: '2020-01-01', leftDate: '2026-04-01', leaveReason: 'Retired' }).then(() => out.push('former ok'), e => out.push(e.code));
    await ref.update({ status: 'Active', leftDate: '', leaveReason: '' }).then(() => out.push('silent ok'), e => out.push(e.code));
    await ref.delete().then(() => out.push('deleted'), e => out.push(e.code));
    return out;
  }, [pid, C2]);
  assert.deepEqual(raw, ['former ok', 'permission-denied', 'permission-denied']);
  const canWoman = await page.evaluate(() => canRestore({ status: 'Former', gender: 'Female', leaveReason: 'Retired' }) || canRestore({ status: 'Former', gender: 'Male', leaveReason: 'Called to glory' }));
  assert.equal(canWoman, false);

  // ---- 2b. Clergy history page: everyone who served, newest first, searchable, printable.
  await page.evaluate(() => closeModal('recordModal'));
  await nav('clergyhistory');
  await page.waitForFunction(() => document.querySelectorAll('.ch-row').length === 2);
  const order = await page.$$eval('.ch-row', a => a.map(e => e.textContent));
  assert.match(order[0], /Femi Bello/, 'restored (newest period) first'); assert.match(order[0], /returned 1×/);
  assert.match(order[1], /Gbenga Lawal[\s\S]*Retired/);
  await shot('p21-03-clergy-history');
  await page.fill('#ch_search', 'gbenga');
  await page.waitForFunction(() => document.querySelectorAll('.ch-row').length === 1);
  await page.fill('#ch_search', '');
  await page.click('#section-clergyhistory >> text=Print');
  await page.waitForSelector('#printSheet:not(.hidden)');
  assert.match(await page.textContent('#printSheetBody'), /Clergy History[\s\S]*Femi Bello[\s\S]*Gbenga Lawal/);
  await page.evaluate(() => closePrintSheet());

  // ---- 4. Attendance reports: real .xlsx + PDF, weekly and monthly; CSV still there.
  await page.evaluate(async () => {
    const ws = weekStart(localToday());
    for (const [i, h] of [[0, 120], [7, 95], [35, 80]]) {
      const d = addDays(ws, -i), s = { date: d, name: 'Sunday Service', key: 'sunday', time: '10:00', id: d + '_sunday' };
      await parishRef().collection('attendance').doc(s.id).set(serviceDoc(s, { men: 30, women: 30, children: h - 60, headcount: h }));
    }
  });
  await nav('attendance');
  await page.click('[data-tab="reports"]');
  await page.waitForFunction(() => /Weekly/.test(document.getElementById('rpSub').textContent));
  for (const period of ['week', 'month']) {
    await page.selectOption('#rp_period', period);
    await page.waitForFunction(p => att.reports && att.reports.period === p && att.reports.view, period);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rp_xlsxBtn')]);
    assert.match(dl.suggestedFilename(), new RegExp(`attendance-${period === 'week' ? 'weekly' : 'monthly'}-\\d{4}-\\d{2}-\\d{2}\\.xlsx`));
    const wb = XLSX.read(readFileSync(await dl.path()));
    assert.deepEqual(wb.SheetNames, ['Summary', 'Per service type', 'Services', 'Departments']);
    const svc = XLSX.utils.sheet_to_json(wb.Sheets.Services);
    assert.equal(svc.length, 3); assert.equal(svc.reduce((n, r) => n + r.Total, 0), 295);
    const sum = XLSX.utils.sheet_to_json(wb.Sheets.Summary, { header: 1 }).slice(4);
    assert.equal(sum.reduce((n, r) => n + (r[2] || 0), 0), 295, period + ' summary total');
    // PDF: clean printable sheet, then the phone's Print -> Save as PDF. Here Chromium prints it to a real PDF.
    await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await page.click('#rp_pdfBtn');
    await page.waitForSelector('#printSheet:not(.hidden)');
    await page.waitForFunction(() => window.__printed === 1);
    assert.match(await page.textContent('#printSheetBody'), /Attendance Report[\s\S]*Per service type[\s\S]*Sunday Service/);
    if (period === 'month') await shot('p21-04-attendance-pdf-sheet');
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'A4' });
    await page.emulateMedia({ media: 'screen' });
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    assert.ok(pdf.length > 5000, 'pdf has content');
    await page.evaluate(() => closePrintSheet());
  }
  const [csv] = await Promise.all([page.waitForEvent('download'), page.click('text=Services CSV')]);
  assert.match(csv.suggestedFilename(), /\.csv$/);
  assert.deepEqual(pageErrors, [], 'no page errors');
  console.log('E2E BATCH 21 (P21) PASSED');
} catch (e) {
  console.error('E2E FAILED', e);
  await page.screenshot({ path: join(SHOTS, 'p21-zz-failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
