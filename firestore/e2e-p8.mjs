// Phase 8 (postings, Church Head, AI dashboard, founder fixes) phone-size end-to-end test of the Parish Portal against the LOCAL Auth + Firestore
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
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
  let body;
  try { body = readFileSync(join(ROOT, path)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[extname(path)] || 'text/plain' }); res.end(body);
}).listen(5058, '127.0.0.1');
const APP = 'http://127.0.0.1:5058/?emulator=1';

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

// Adds a person through the app's own form + savePerson (the same code a tap runs).
async function addPerson(kind, p) {
  await page.evaluate(async ([kind, p]) => {
    openPersonForm(kind);
    $('p_name').value = p.name; $('p_gender').value = p.gender; fillRanks(p.rank || ''); $('p_rank').value = p.rank || '';
    $('p_marital').value = 'Married'; $('p_address').value = 'SECRET ADDRESS 1'; $('p_phone').value = p.phone || '';
    $('p_email').value = p.email || ''; $('p_occupation').value = p.occupation || '';
    $('p_dobDay').value = '4'; $('p_dobMonth').value = '7'; $('p_dobYear').value = '1980';
    if (p.anoint) { $('p_anDay').value = '1'; $('p_anMonth').value = '3'; $('p_anYear').value = '2015'; }
    $('p_nokName').value = 'SECRET KIN'; $('p_consent').checked = true;
    await savePerson();
  }, [kind, p]);
}

// Firestore REST value encoder for seeding the emulator (Bearer owner bypasses the rules; test data only).
const enc = v => v === null ? { nullValue: null } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
async function seedRaw(path, obj) {
  const r = await fetch(`${FS}/${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, enc(v)])) }) });
  assert.ok(r.ok, 'seed ' + path + ' ' + r.status);
}
const addM = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const TODAY = new Date().toISOString().slice(0, 10), M = TODAY.slice(0, 7);
async function claimFresh(email, code) { await page.goto(APP); await claim(email, code); }

try {
  const superUid = await signUp('bayo@test.local', PASS);
  await seedDoc(`users/${superUid}`, { role: 'super_admin', name: 'Bayo Adeyemi' });
  await login('bayo@test.local');
  const codeA = await createParish('TEST Ikeja Parish', 'Ikeja', 'Nigeria', 'Africa', 'NGN', 'TIP', 'IKJ', 'ikeja@test.local');
  const codeB = await createParish('TEST London Parish', 'London', 'United Kingdom', 'Europe', 'GBP', 'TLP', 'LDN', 'london@test.local');
  const [pidA, pidB] = await page.evaluate(async () => (await db.collection('parishes').get()).docs.map(d => ({ id: d.id, name: d.data().name })).sort((a, b) => a.name.localeCompare(b.name)).map(p => p.id));
  await logout();

  // ---- 1b. Parish A: clergy + member; giving picked from the member list carries the member number.
  await claimFresh('ikeja@test.local', codeA);
  let d0 = dialogs.length;
  await addPerson('members', { name: 'Adaeze Okafor', gender: 'Female', rank: 'Elder Sister', occupation: 'Civil Engineer', phone: '08030000001' });
  await addPerson('clergy', { name: 'Olumide Ajayi', gender: 'Male', rank: 'Evangelist', email: 'olumide@test.local', phone: '08030000003' });
  noFail(d0);
  await nav('finance');
  await page.evaluate(() => openFinanceModal());
  await page.fill('#fin_date', TODAY);
  await page.fill('#fin_contrib', 'adae');
  await page.waitForSelector('#fin_memberFound .fin-opt');
  await page.click('#fin_memberFound .fin-opt');
  assert.equal(await page.inputValue('#fin_contrib'), 'Adaeze Okafor');
  await page.fill('#fin_type', 'Tithe'); await page.fill('#fin_amount', '12000');
  await shot('p8-01-giving-member-number');
  await page.click('#addFinanceModal button:has-text("Save")');
  await page.waitForSelector('#addFinanceModal.hidden', { state: 'attached' });
  const fin = await page.evaluate(async () => (await parishRef().collection('finances').get()).docs.map(d => d.data()));
  assert.equal(fin.length, 1); assert.match(fin[0].memberNo, /^CCC-TIP-IKJ-MBR-001$/);
  // Older entry without a member number, under a different spelling: not matched by number, still matched by name.
  await page.evaluate(async (t) => parishRef().collection('finances').add({ transactionDate: t, contributorName: 'Adaeze Okafor', contributionType: 'Offering', amount: 3000 }), TODAY);
  await logout();
  await login('ikeja@test.local');
  await page.waitForFunction(() => !!localState.dirSync); await page.evaluate(() => localState.dirSync);
  const giving = await page.evaluate(async () => (await db.collection('directory').where('parishId', '==', localState.currentParishId).get()).docs[0].data().giving);
  assert.equal(giving.byYear[TODAY.slice(0, 4)], 15000, 'member-number entry + older name-only entry both counted');
  await logout();
  await claimFresh('london@test.local', codeB);
  await logout();

  // ---- 1a. Retirement: no fixed age; report hidden until HQ sets one.
  await login('bayo@test.local');
  await nav('staff');
  await page.click('#addStaffBtn');
  await page.fill('#sf_name', 'Kemi Adesanya'); await page.fill('#sf_dept', 'Finance'); await page.fill('#sf_title', 'Accountant');
  await page.fill('#sf_dob', `${Number(TODAY.slice(0, 4)) - 60}-06-15`); await page.fill('#sf_employed', '2008-02-01'); await page.check('#sf_consent');
  await page.click('#saveStaffBtn'); await page.waitForSelector('#staffModal:not(.hidden)');
  assert.doesNotMatch(await page.textContent('#staffBody'), /Retirement due/);
  await page.click('#staffModal button[aria-label="Close"]');
  assert.ok(await page.locator('#st_retireBox').isHidden(), 'no retirement report without a retirement age');
  await fullShot('p8-02-staff-no-retirement-age');
  await page.fill('#st_retireAge', '60'); await page.fill('#st_retireReason', 'Board resolution (test)');
  await page.click('#st_retireSave');
  await page.waitForSelector('#st_retireBox:not(.hidden) .retire-row');
  assert.match(await page.textContent('#st_retireHead'), /age 60/);
  await page.fill('#st_retireAge', ''); await page.fill('#st_retireReason', 'Policy withdrawn (test)'); await page.click('#st_retireSave');
  await page.waitForSelector('#st_retireBox.hidden', { state: 'attached' });

  // ---- 3. Church Head: assigned by the Super Admin (title configurable), invite code.
  await nav('postings');
  await page.waitForSelector('#po_list');
  await page.fill('#ld_title', 'Church Head'); await page.fill('#ld_name', 'Rev. Emmanuel Pastor'); await page.fill('#ld_email', 'pastor@test.local');
  await page.fill('#ld_reason', 'Appointed by the Supreme Council (test)');
  await page.click('#assignLeaderBtn');
  await page.waitForSelector('#leaderCode');
  const leaderCode = (await page.textContent('#leaderCode')).trim();
  await page.waitForSelector('#ld_list .ld-row');
  assert.match(await page.textContent('#po_rule'), /need approval by the Church Head/);

  // ---- 2. Posting: Olumide (Ikeja) -> London, today, with a letter. Waits for the Church Head.
  await page.fill('#po_q', 'olumide'); await page.waitForSelector('#po_found .po-opt'); await page.click('#po_found .po-opt');
  await page.selectOption('#po_to', pidB);
  await page.fill('#po_date', TODAY); await page.fill('#po_reason', 'Shepherd needed in London');
  await page.setInputFiles('#po_letter', await makeImage('POST', '#92400e'));
  await page.waitForSelector('#po_letterPreview:not(.hidden)');
  await fullShot('p8-03-posting-form');
  d0 = dialogs.length; await page.click('#savePostingBtn'); await page.waitForSelector('#po_list .po-row'); noFail(d0);
  assert.match(await page.textContent('#po_list .po-status'), /Pending approval/);
  await fullShot('p8-04-posting-pending-and-leadership');

  // ---- 4. AI dashboard: the scheduled server job (worker code, run against the emulator), then the browser fallback.
  // History so the new checks have something to find: Ikeja had 20 members and steady attendance; a third parish is silent.
  for (const [i, att, mem] of [[4, 0, 20], [3, 400, 20], [2, 800, 20], [1, 1000, 19]])
    await seedRaw(`parishMonthly/${pidA}_${addM(M, -i)}`, { parishId: pidA, month: addM(M, -i), memberCount: mem, clergyCount: 1, attendanceTotal: att, serviceCount: 0, birthCount: 0, deathCount: 0, lastActive: '', city: 'Ikeja', country: 'Nigeria', continent: 'Africa', updatedAt: 'seed' });
  await seedRaw('parishes/TESTSILENT', { name: 'TEST Silent Parish', city: 'Accra', country: 'Ghana', continent: 'Africa', status: 'Approved', createdAt: '2026-01-01T00:00:00Z', currency: 'GHS' });
  await seedRaw('parishStats/TESTSILENT', { memberCount: 30, clergyCount: 2, attendanceTotal: 900, lastActive: '2026-06-01' });
  const worker = (await import('../ai-worker/worker.js')).default;
  const job = await worker.runChecks({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIRESTORE_PROJECT: PROJECT });
  assert.equal(job.parishes, 3); assert.ok(job.fresh >= 3, 'server job wrote alerts: ' + JSON.stringify(job));
  const noCred = await worker.runChecks({});
  assert.equal(noCred.skipped, 'FIREBASE_SERVICE_ACCOUNT not set');
  // Summary route: totals only. The AI call is answered locally; the payload must carry no person or parish names.
  let sent = null;
  await page.route('**/summary', async r => { sent = r.request().postData(); await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ text: 'This month 3 alerts need attention, mostly in Nigeria: membership and attendance fell in one parish. One parish in Ghana has been silent for months. Start with a call to those parishes.', engine: 'test' }) }); });
  await nav('ai');
  await page.waitForSelector('#ai_alerts .ai-alert');
  const dlg = page.waitForEvent('dialog', { timeout: 30000 }); await page.click('#ai_runBtn'); await dlg; await page.waitForTimeout(200);
  assert.match(dialogs.at(-1), /Checked 3 parishes: \d+ alert\(s\), 0 new/, 'fallback finds the same alerts, no duplicates');
  const feed = await page.textContent('#ai_alerts');
  for (const re of [/Attendance down 30%/, /Membership down 10%/, /No activity for 30 days/, /server/]) assert.match(feed, re);
  await page.click('#ai_summaryBtn');
  await page.waitForFunction(() => /3 alerts need attention/.test(document.getElementById('ai_summary').textContent));
  for (const bad of ['Olumide', 'Adaeze', 'Ikeja', 'London Parish', 'Silent', 'Bayo']) assert.ok(!sent.includes(bad), 'no names to the AI: ' + bad);
  assert.match(sent, /alertsByType/);
  assert.match(await page.textContent('#ai_members'), /\d/);
  await fullShot('p8-05-ai-dashboard-super');
  await page.selectOption('#ai_level', 'country'); await page.waitForSelector('#ai_levels .lvl-row');
  await logout();

  // ---- 3. Church Head: claims the invite; read-only church-wide; approves the posting.
  await page.goto(APP);
  await claim('pastor@test.local', leaderCode);
  assert.ok(await page.locator('#nav-ai').isVisible()); assert.ok(await page.locator('#nav-postings').isVisible());
  for (const id of ['parishes', 'staff', 'directory', 'members', 'hqreturns']) assert.ok(await page.locator('#nav-' + id).isHidden(), 'hidden for Church Head: ' + id);
  assert.match(await page.textContent('#welcomeTitle'), /Rev. Emmanuel Pastor/);
  await shot('p8-06-church-head-dashboard');
  await nav('ai'); await page.waitForSelector('#ai_alerts .ai-alert');
  assert.ok(await page.locator('#ai_runBox').isHidden());
  assert.match(await page.textContent('#ai_summary'), /3 alerts need attention/);
  await fullShot('p8-07-ai-dashboard-church-head');
  const chWrites = await page.evaluate(async ([a]) => Promise.all([
    db.collection('parishes').doc(a).update({ name: 'X' }).then(() => 'WROTE', e => e.code),
    db.collection('parishStats').doc(a).set({ memberCount: 1 }, { merge: true }).then(() => 'WROTE', e => e.code),
    db.collection('hqStaff').get().then(() => 'READ', e => e.code),
    db.collection('directory').get().then(() => 'READ', e => e.code)]), [pidA]);
  assert.deepEqual(chWrites, ['permission-denied', 'permission-denied', 'permission-denied', 'permission-denied']);
  await nav('postings'); await page.waitForSelector('#po_list .po-approve');
  assert.ok(await page.locator('.po-super').first().isHidden());
  promptAnswer = 'Approved after consultation';
  await page.click('#po_list .po-approve');
  await page.waitForFunction(() => /Approved by Rev. Emmanuel Pastor/.test(document.getElementById('po_list').textContent));
  await fullShot('p8-08-church-head-approved');
  await logout();

  // ---- 2. Applied when each parish admin opens the app.
  await login('ikeja@test.local');
  await page.waitForSelector('#parishPostings:not(.hidden)');
  assert.match(await page.textContent('#parishPostings'), /posted OUT to TEST London Parish/);
  const oldRec = await page.evaluate(async () => (await parishRef().collection('clergy').doc('CCC-TIP-IKJ-CLG-001').get()).data());
  assert.equal(oldRec.status, 'Former'); assert.equal(oldRec.leaveReason, 'Posting');
  assert.match(JSON.stringify(oldRec.serviceRecord), /Posted to TEST London Parish/);
  await shot('p8-09-old-parish-posting-applied');
  await page.evaluate(() => openRecord('clergy', 'CCC-TIP-IKJ-CLG-001'));
  await page.waitForSelector('#recordModal:not(.hidden)');
  assert.match(await page.textContent('#recordBody'), /Posting/);
  await fullShot('p8-10-old-parish-former-record');
  await page.evaluate(() => closeModal('recordModal'));
  await logout();
  await login('london@test.local');
  await page.waitForSelector('#parishPostings:not(.hidden)');
  assert.match(await page.textContent('#parishPostings'), /CCC-TLP-LDN-CLG-001/);
  const nu = await page.evaluate(async () => (await parishRef().collection('clergy').doc('CCC-TLP-LDN-CLG-001').get()).data());
  assert.equal(nu.status, 'Active'); assert.equal(nu.postedFrom, 'CCC-TIP-IKJ-CLG-001'); assert.equal(nu.fullName, 'Olumide Ajayi');
  assert.match(JSON.stringify(nu.serviceRecord), /Posted from TEST Ikeja Parish/);
  assert.equal(await page.textContent('#metricClergy'), '1');
  await page.evaluate(() => openRecord('clergy', 'CCC-TLP-LDN-CLG-001'));
  await page.waitForSelector('#recordModal:not(.hidden)');
  await fullShot('p8-11-new-parish-clergy-record');
  await logout();

  // ---- Super Admin: posting shows Applied; audit log has every step by name.
  await login('bayo@test.local');
  await nav('postings'); await page.waitForSelector('#po_list .po-row');
  assert.match(await page.textContent('#po_list .po-status'), /Applied/);
  await nav('hqreturns'); await page.click('.hq-tab[data-tab="log"]'); await page.waitForSelector('#hq_log .audit-row');
  const log = await page.textContent('#hq_log');
  for (const re of [/posting-arrive/, /posting-depart/, /posting-approve/, /Rev. Emmanuel Pastor/, /leader-assign/, /hqSettings\/staff/]) assert.match(log, re);
  await fullShot('p8-12-audit-log');
  const del = await page.evaluate(async () => Promise.all(['postings', 'leaders', 'statsRollups', 'parishMonthly'].map(async c => (await db.collection(c).limit(1).get()).docs[0].ref.delete().then(() => 'DELETED', e => e.code))));
  assert.deepEqual(del, Array(4).fill('permission-denied'));
  await logout();
  assert.deepEqual(pageErrors, [], 'no page errors');
  console.log('E2E PASS (phase 8): giving by member number (+ name fallback); retirement age optional and blank by default; Church Head assigned + invited, read-only, approves; posting pending -> approved -> old parish Former/Posting + new parish CCC-TLP-LDN-CLG-001 linked, service record appended; server job (worker code) + browser fallback write rollups/alerts without duplicates; AI summary gets totals only; everything audited; nothing deleted.');
} catch (e) {
  await shot('p8-zz-failure').catch(() => {});
  console.error('E2E FAIL:', e.stack);
  console.error('dialogs:', dialogs);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
