// Phase 6 (Monthly Returns) phone-size end-to-end test of the Parish Portal against the LOCAL Auth + Firestore
// emulators (project demo-ccc). Never touches the live project.
// Run: npm run test:e2e   (screenshots go to ./screenshots or $SHOTS_DIR)
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
  const path = new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
  let body;
  try { body = readFileSync(join(ROOT, path)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[extname(path)] || 'text/plain' }); res.end(body);
}).listen(5056, '127.0.0.1');
const APP = 'http://127.0.0.1:5056/?emulator=1';

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
page.on('pageerror', e => { pageErrors.push(e.message); console.error('pageerror', e.message); });
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
  await page.fill('#np_name', name); await page.fill('#np_city', city); await page.fill('#np_country', country);
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
// Files a return through the app's own form + saveReturn (same path as a tap), then pays.
async function fileMonth(m, inc, pay) {
  await page.evaluate(async ([m, inc, pay]) => {
    $('r_month').value = m; await loadReturn();
    for (const [k, v] of Object.entries(inc)) $('r_' + k).value = v;
    await saveReturn();
    if (pay) { $('pay_date').value = m + '-28'; $('pay_amount').value = pay; $('pay_method').value = 'Bank transfer'; $('pay_ref').value = 'TLR-' + m; await recordPayment(); }
  }, [m, inc, pay]);
}

try {
  const superUid = await signUp('super@test.local', PASS);
  await seedDoc(`users/${superUid}`, { role: 'super_admin' });
  await login('super@test.local');
  const codeA = await createParish('TEST Ikeja Parish', 'Ikeja', 'Nigeria', 'Africa', 'NGN', 'TIP', 'IKJ', 'ikeja@test.local');
  const codeB = await createParish('TEST London Parish', 'London', 'United Kingdom', 'Europe', 'GBP', 'TLP', 'LDN', 'london@test.local');
  await logout();

  // ---- Parish A (NGN): six normal months, then a short / falling September.
  await claim('ikeja@test.local', codeA);
  await nav('returns');
  await page.waitForFunction(() => /NGN/.test(document.getElementById('r_currencyNote').textContent));
  let d0 = dialogs.length;
  const normal = { tithes: 90000, offerings: 20000, thanksgiving: 0, harvest: 0, building: 5000, other: 0 };
  for (const m of ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07']) await fileMonth(m, normal, 30000);
  await fileMonth('2026-08', normal, 10000);   // underpaid
  noFail(d0);
  // September through the visible form: live due, receipt photo.
  await page.fill('#r_month', '2026-09'); await page.dispatchEvent('#r_month', 'change');
  await page.waitForFunction(() => document.getElementById('saveReturnBtn').textContent === 'File return');
  await page.fill('#r_tithes', '45000'); await page.fill('#r_offerings', '5000');
  await page.waitForFunction(() => /15,000/.test(document.getElementById('r_due').textContent));
  await page.setInputFiles('#r_receipt', await makeImage('RCPT', '#065f46'));
  await page.waitForSelector('#r_receiptPreview:not(.hidden)');
  await fullShot('p6-01-parish-file-return');
  await page.click('#saveReturnBtn');
  await page.waitForSelector('#r_payBox:not(.hidden)');
  assert.match(await page.textContent('#r_summary'), /Due/);
  // Payment with teller photo -> Part paid.
  await page.fill('#pay_date', '2026-10-03'); await page.fill('#pay_amount', '5000'); await page.selectOption('#pay_method', 'POS');
  await page.fill('#pay_ref', 'POS-7781');
  await page.setInputFiles('#pay_receipt', await makeImage('TLR', '#1e3a8a'));
  await page.waitForSelector('#pay_receiptPreview:not(.hidden)');
  await page.click('#payBtn');
  await page.waitForSelector('#r_payments .pay-row');
  assert.match(await page.textContent('#r_summary'), /Part paid/);
  // A wrong entry (typed 2,000 twice) and its correction: nothing deleted.
  await page.fill('#pay_amount', '2000'); await page.fill('#pay_ref', 'TLR-DUP'); await page.click('#payBtn');
  await page.waitForFunction(() => document.querySelectorAll('#r_payments .pay-row').length === 2);
  await page.check('#pay_isCorrection');
  await page.fill('#pay_amount', '2000'); await page.fill('#pay_ref', 'TLR-DUP-FIX');
  await page.selectOption('#pay_corrects', await page.$eval('#pay_corrects', s => [...s.options].find(o => /TLR-DUP/.test(o.text)).value));
  d0 = dialogs.length;
  await page.click('#payBtn');   // no reason -> refused by the app
  await page.waitForTimeout(300);
  assert.ok(dialogs.slice(d0).some(m => /needs the entry it corrects and a reason/.test(m)));
  await page.fill('#pay_reason', 'Entered twice by mistake');
  await page.click('#payBtn');
  await page.waitForFunction(() => document.querySelectorAll('#r_payments .pay-row').length === 3);
  assert.match(await page.textContent('#r_sumRemitted'), /NGN 5,000/);
  await fullShot('p6-02-parish-payments-correction');
  // Income correction needs a reason.
  await page.fill('#r_offerings', '4000');
  d0 = dialogs.length;
  await page.click('#saveReturnBtn'); await page.waitForTimeout(500);
  assert.ok(dialogs.slice(d0).some(m => /needs a reason/.test(m)));
  await page.fill('#r_reason', 'Offering count corrected after recount'); await page.click('#saveReturnBtn');
  await page.waitForFunction(() => document.getElementById('r_reason').value === '');
  await page.click('#r_summary button');
  await page.waitForSelector('#returnModal:not(.hidden) .audit-row');
  assert.equal(await page.locator('#rd_audit .audit-row').count(), 5); // file, pay, pay, correct(pay), correct(income)
  assert.match(await page.textContent('#rd_audit'), /Offering count corrected/);
  await fullShot('p6-03-parish-history-audit');
  await page.click('#returnModal button[aria-label="Close"]');
  // Parish cannot read HQ-only collections.
  const pDenied = await page.evaluate(async () => Promise.all(['returnRollups', 'alerts'].map(c => db.collection(c).get().then(() => 'READ', e => e.code))));
  assert.deepEqual(pDenied, ['permission-denied', 'permission-denied']);
  await fullShot('p6-04-parish-returns-list');
  await logout();

  // ---- Parish B (GBP): files August only, nothing for September.
  await claim('london@test.local', codeB);
  await nav('returns');
  await fileMonth('2026-08', { tithes: 3000, offerings: 900, thanksgiving: 150, harvest: 0, building: 0, other: 0 }, 1000);
  await logout();

  // ---- Super Admin
  await login('super@test.local');
  await nav('hqreturns');
  await page.waitForSelector('#hq_nameBox:not(.hidden)');
  await shot('p6-05-super-name-required');
  // Unnamed super: the rules refuse the action even if the app check is bypassed.
  const unnamed = await page.evaluate(async () => {
    const ref = db.collection('hqSettings').doc('returns');
    const b = db.batch();
    b.set(ref, { shares: DEFAULT_SHARES, version: 1, updatedAt: nowIso(), updatedBy: localState.user.uid });
    writeAudit(b, 'hqSettings/returns', 1, 'settings', null, null, 'test');
    return b.commit().then(() => 'OK', e => e.code);
  });
  assert.equal(unnamed, 'permission-denied');
  await page.fill('#hq_myName', 'Bayo Adeyemi'); await page.click('#hq_nameBox button');
  await page.waitForSelector('#hq_nameBox.hidden', { state: 'attached' });
  await page.fill('#hq_month', '2026-09'); await page.dispatchEvent('#hq_month', 'change');
  await page.waitForSelector('#hq_rollups .rollup-card');
  assert.match(await page.textContent('#hq_rollups'), /Africa[\s\S]*NGN[\s\S]*15,000[\s\S]*5,000/);
  await fullShot('p6-06-super-totals-continent');
  await page.selectOption('#hq_level', 'city');
  await page.waitForSelector('#hq_rollups :text("Ikeja")');
  await fullShot('p6-07-super-totals-city');
  // August: two currencies on their own lines, by continent.
  await page.fill('#hq_month', '2026-08'); await page.dispatchEvent('#hq_month', 'change');
  await page.selectOption('#hq_level', 'continent');
  await page.waitForSelector('#hq_rollups :text("Europe")');
  assert.match(await page.textContent('#hq_rollups'), /GBP/);
  // Rebuild from returns gives the same numbers.
  const before = await page.textContent('#hq_rollups');
  await page.click('#rebuildBtn');
  await page.waitForFunction(() => document.querySelectorAll('#hq_rollups .rollup-card').length === 2);
  await page.waitForTimeout(500);
  assert.equal(await page.textContent('#hq_rollups'), before, 'rebuild matches live rollups');
  await fullShot('p6-08-super-totals-two-currencies');
  // Parish list for September -> detail -> confirm + dispute.
  await page.fill('#hq_month', '2026-09'); await page.dispatchEvent('#hq_month', 'change');
  await page.click('.hq-tab[data-tab="parishes"]');
  await page.waitForSelector('#hq_returns .ret-row');
  await fullShot('p6-09-super-parishes-month');
  await page.click('#hq_returns .ret-row');
  await page.waitForSelector('#returnModal:not(.hidden) #rd_superActions:not(.hidden)');
  assert.equal(await page.inputValue('#rd_confirmAmt'), '5000');
  await page.click('#rd_confirmBtn');
  await page.waitForFunction(() => /NGN 5,000/.test(document.getElementById('rd_confirmed').textContent));
  await page.fill('#rd_note', 'Bank statement shows only 3,000');
  await page.click('#rd_disputeBtn');
  await page.waitForFunction(() => /Disputed/.test(document.getElementById('rd_body').textContent) && document.querySelectorAll('#rd_audit .audit-row').length === 7);
  assert.match(await page.textContent('#rd_audit'), /Bayo Adeyemi/);
  await fullShot('p6-10-super-return-detail-confirm-dispute');
  await page.click('#returnModal button[aria-label="Close"]');
  // Arrears
  await page.click('.hq-tab[data-tab="arrears"]');
  await page.waitForSelector('#hq_arrears .ret-row');
  assert.match(await page.textContent('#hq_arrears'), /TEST Ikeja Parish[\s\S]*Arrears NGN 20,000/);
  await fullShot('p6-11-super-arrears');
  // Alerts
  await page.click('.hq-tab[data-tab="alerts"]');
  await page.click('#runChecksBtn');
  await page.waitForFunction(() => document.querySelectorAll('#hq_alerts .alert-row').length === 4);
  const al = await page.textContent('#hq_alerts');
  for (const re of [/Remitted less than due/, /Tithes down 30%/, /Big one-off change/, /TEST London Parish[\s\S]*No return by the 10th/]) assert.match(al, re);
  await fullShot('p6-12-super-alerts');
  d0 = dialogs.length;
  await page.click('#runChecksBtn');   // idempotent: no duplicates
  await page.waitForTimeout(800);
  assert.ok(dialogs.slice(d0).some(m => /4 alert\(s\).*0 new/.test(m)));
  await page.click('#hq_alerts .alert-row:has-text("Tithes down")');
  await page.waitForSelector('#historyModal:not(.hidden) .ph-row');
  assert.equal(await page.locator('#ph_body .ph-row').count(), 7);
  await fullShot('p6-13-alert-drilldown-parish-totals');
  await page.click('#historyModal button[aria-label="Close"]');
  // HQ share setting (audited) + action log.
  await page.click('.hq-tab[data-tab="settings"]');
  await page.fill('#sh_building_num', '1'); await page.fill('#sh_building_den', '10');
  await page.fill('#hq_shareReason', 'Synod resolution: 10% of building fund');
  await page.click('#saveSharesBtn');
  await page.waitForFunction(() => hqSettingsVersion === 1);
  await fullShot('p6-14-super-hq-share');
  await page.click('.hq-tab[data-tab="log"]');
  await page.waitForSelector('#hq_log .audit-row');
  const log = await page.textContent('#hq_log');
  for (const re of [/settings/, /alert/, /dispute/, /confirm/, /Bayo Adeyemi/]) assert.match(log, re);
  await fullShot('p6-15-super-action-log');
  // Privacy: super never reads individual giving or other parish-private data.
  const leaks = await page.evaluate(async () => {
    const pid = localState.parishList.find(p => p.name === 'TEST Ikeja Parish').id;
    return Promise.all(['finances', 'members', 'attendance'].map(c => db.collection('parishes').doc(pid).collection(c).get().then(() => 'READ', e => e.code)));
  });
  assert.deepEqual(leaks, ['permission-denied', 'permission-denied', 'permission-denied']);
  // Nothing can be deleted, even by the Super Admin.
  const del = await page.evaluate(async () => {
    const r = (await db.collection('returns').limit(1).get()).docs[0];
    const a = (await db.collection('auditLog').limit(1).get()).docs[0];
    return Promise.all([r.ref.delete(), a.ref.delete()].map(p => p.then(() => 'DELETED', e => e.code)));
  });
  assert.deepEqual(del, ['permission-denied', 'permission-denied']);
  await logout();
  assert.deepEqual(pageErrors, [], 'no page errors');
  console.log('E2E PASS (phase 6): parish files returns (6 categories, currency, live 1/3 due, receipt photo), payments with teller photo, correction entry with reason, income correction with reason + audit trail; super named-account gate, rollups by continent/city per currency, rebuild matches, parish list + detail, confirm + dispute, arrears, 4 rule alerts (idempotent) + drill-down, HQ share setting, action log, no access to individual giving, no deletes.');
} catch (e) {
  await shot('p6-zz-failure').catch(() => {});
  console.error('E2E FAIL:', e.message);
  console.error('dialogs:', dialogs);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
