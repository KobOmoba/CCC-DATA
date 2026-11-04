// Full dress rehearsal: one church story (super admin -> parish admin -> join link -> messages -> HQ -> tenant check), phone size, emulators only.
// emulators (project demo-ccc). Never touches the live project.
// Run: npm run test:e2e   (screenshots go to ./screenshots or $SHOTS_DIR)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = process.env.SHOTS_DIR || join(ROOT, 'firestore', 'screenshots', 'rehearsal');
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
  await page.goto(APP); await page.fill('#loginEmail', email); await page.fill('#loginPassword', PASS);
  await page.click('#accessBtn'); await page.waitForSelector('#mainApp:not(.hidden)');
}
async function logout() { await page.evaluate(() => logout()); await page.waitForSelector('#landingPage:not(.hidden)'); }
const nav = async (id) => { await page.click('#nav-' + id); await page.waitForTimeout(400); };
const modalClosed = (id) => page.waitForSelector(`#${id}.hidden`, { state: 'attached', timeout: 15000 });
const issues = [];
const consoleErrors = [];
page.on('response', r => { if (r.status() >= 400) consoleErrors.push('HTTP ' + r.status() + ' ' + r.url()); });
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
let n = 0;
async function step(name, full = false) {
  await page.waitForTimeout(300);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth);
  if (ov > 392) issues.push(`${name}: page is ${ov}px wide (horizontal scroll)`);
  const nm = String(++n).padStart(2, '0') + '-' + name;
  await page.screenshot({ path: join(SHOTS, nm + '.png'), fullPage: full });
  console.log('shot', nm);
}
async function claim(email, code) {
  await page.goto(APP); await page.click('#inviteToggle');
  await page.fill('#invEmail', email); await page.fill('#invCode', code); await page.fill('#invPassword', PASS);
  await page.click('#claimBtn'); await page.waitForSelector('#mainApp:not(.hidden)');
}
async function createParish(name, city, state, country, pl, cl, email) {
  await nav('parishes');
  await page.fill('#np_name', name); await page.evaluate(a => setLocationFields('np_', ...a), [country, state, city]);
  await page.fill('#np_pletters', pl); await page.fill('#np_cletters', cl); await page.fill('#np_email', email);
  await page.evaluate(() => { document.getElementById('inviteResult').innerHTML = ''; });
  await page.click('#createParishBtn'); await page.waitForSelector('#inviteCode');
  return (await page.textContent('#inviteCode')).trim();
}
async function addPerson(kind, p, shotName) {
  await nav(kind);
  await page.click(kind === 'clergy' ? '#addClergyBtn' : '#addMemberBtn');
  await page.waitForSelector('#personModal:not(.hidden)');
  await page.setInputFiles('#p_photo', await makeImage(p.ini, p.color));
  await page.waitForSelector('#p_photoPreview:not(.hidden)');
  await page.fill('#p_name', p.name); await page.selectOption('#p_gender', p.gender); await page.selectOption('#p_marital', 'Married');
  await page.fill('#p_address', '12 Church Street'); await page.fill('#p_phone', p.phone);
  if (p.email) await page.fill('#p_email', p.email);
  if (p.rank) await page.selectOption('#p_rank', p.rank);
  await page.fill('#p_occupation', p.occ || 'Trader');
  await page.selectOption('#p_dobDay', String(p.dob[0])); await page.selectOption('#p_dobMonth', String(p.dob[1])); await page.selectOption('#p_dobYear', String(p.dob[2]));
  await page.fill('#p_nokName', 'Kin of ' + p.name); await page.check('#p_consent');
  if (shotName) await step(shotName, true);
  const d0 = dialogs.length;
  await page.click('#savePersonBtn'); await modalClosed('personModal');
  if (dialogs.slice(d0).some(m => /not saved|failed|could not/i.test(m))) issues.push('save person: ' + dialogs.slice(d0).join('|'));
}
const today = new Date(); const T = { d: today.getDate(), m: today.getMonth() + 1 };
const ISO = `${today.getFullYear()}-${String(T.m).padStart(2, '0')}-${String(T.d).padStart(2, '0')}`;
const PREV = (() => { const d = new Date(today.getFullYear(), today.getMonth() - 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();

try {
  // ===== 1. Super Admin
  const superUid = await signUp('hq@test.local', PASS);
  await seedDoc(`users/${superUid}`, { role: 'super_admin', name: 'Bayo Adeyemi' });
  await page.goto(APP); await step('sign-in-page');
  await login('hq@test.local');
  if (!/^Halleluyah 🙌/.test(await page.textContent('#welcomeTitle'))) issues.push('super greeting: ' + await page.textContent('#welcomeTitle'));
  await step('super-dashboard');
  await nav('parishes');
  await page.fill('#np_name', 'Ikeja Cathedral Parish'); await page.selectOption('#np_country_sel', 'Nigeria'); await page.selectOption('#np_state_sel', 'Lagos'); await page.selectOption('#np_city_sel', 'Ikeja');
  await page.fill('#np_pletters', 'ICP'); await page.fill('#np_cletters', 'IKJ'); await page.fill('#np_email', 'ikeja.admin@test.local');
  await step('super-new-parish-form', true);
  await page.click('#createParishBtn'); await page.waitForSelector('#inviteCode');
  const codeA = (await page.textContent('#inviteCode')).trim();
  await step('super-parish-created-invite', true);
  const codeB = await createParish('Abeokuta Central Parish', 'Abeokuta', 'Ogun', 'Nigeria', 'ACP', 'ABK', 'abk.admin@test.local');
  const pa = await page.evaluate(async () => (await db.collection('parishes').get()).docs.map(d => ({ id: d.id, ...d.data() })).find(p => p.name.startsWith('Ikeja')));
  if (pa.church && pa.church !== 'CELESTIAL CHURCH OF CHRIST') issues.push('church name stored as ' + pa.church);
  await logout();

  // ===== 2. Parish admin
  await claim('ikeja.admin@test.local', codeA);
  const wt = await page.textContent('#welcomeTitle');
  if (!/^Halleluyah 🙌/.test(wt)) issues.push('parish greeting: ' + wt);
  await step('parish-admin-first-dashboard');
  await addPerson('members', { name: 'Adaeze Okafor', gender: 'Female', rank: 'Senior Elder Sister', phone: '08030000001', dob: [T.d, T.m, 1980], ini: 'AO', color: '#1e3a8a', occ: 'Nurse' }, 'member-form-female-rank');
  await addPerson('members', { name: 'Tunde Bakare', gender: 'Male', rank: 'Leader', phone: '08030000002', dob: [3, 3, 1975], ini: 'TB', color: '#065f46', occ: 'Accountant' });
  await addPerson('members', { name: 'Bisola Ogun', gender: 'Female', rank: 'Mother Celestial', phone: '08030000004', dob: [9, 9, 1960], ini: 'BO', color: '#7c2d12' });
  await addPerson('clergy', { name: 'Olumide Ajayi', gender: 'Male', rank: 'Evangelist', email: 'olumide@test.local', phone: '08030000003', dob: [1, 6, 1970], ini: 'OA', color: '#92400e' }, 'clergy-form');
  await nav('members'); await step('members-list-with-numbers', true);
  await nav('clergy'); await step('clergy-list-with-numbers', true);
  // Department
  await page.evaluate(async () => { await openDept('choir'); const nos = (await parishRef().collection('members').get()).docs.map(d => d.id); for (const no of nos.slice(0, 2)) await addToDept(no); });
  await step('department-choir', true);
  await page.evaluate(() => { const m = document.querySelector('.modal:not(.hidden) button[aria-label="Close"]'); if (m) m.click(); });
  // Birth certificate
  await nav('births'); await page.click('#add-births'); await page.waitForSelector('#youngModal:not(.hidden)');
  await page.fill('#y_name', 'Baby Ayomide Okafor'); await page.selectOption('#y_gender', 'Female');
  const d1 = new Date(today.getTime() - 30 * 864e5).toISOString().slice(0, 10);
  await page.fill('#y_dob', d1); await page.fill('#y_place', 'Ikeja General Hospital'); await page.fill('#y_mother', 'Adaeze Okafor');
  await page.waitForFunction(() => document.querySelectorAll('#y_officiant option').length > 1);
  await page.selectOption('#y_officiant', { index: 1 }); await page.check('#y_consent');
  await page.click('#saveYoungBtn'); await page.waitForSelector('#recordModal:not(.hidden)');
  await page.click('#recordActions button:has-text("Birth certificate")'); await page.waitForSelector('#certModal:not(.hidden)');
  await step('birth-certificate');
  await page.click('#certModal button:has-text("Close")');
  await page.evaluate(() => closeModal('recordModal'));
  // Attendance
  await nav('attendance'); await page.waitForSelector('#att-week .svc-card');
  const sunId = await page.evaluate(() => weekServices(weekStart(localToday())).find(s => s.key === 'sunday').id);
  await page.click(`.svc-card[data-id="${sunId}"] button:has-text("Record")`);
  await page.fill('#svc_men', '40'); await page.fill('#svc_women', '55'); await page.fill('#svc_children', '20'); await page.fill('#svc_visitors', '6');
  await page.selectOption('#svc_led', { index: 1 });
  await step('attendance-record-sunday');
  await page.click('#saveServiceBtn'); await modalClosed('serviceModal');
  await step('attendance-week', true);
  // Timetable
  await nav('settings'); await page.waitForSelector('#tt_rows .tt-row');
  await page.fill('#tt_rows .tt-row >> nth=0 >> .tt-time', '09:00');
  await page.click('#tt_add');
  const last = page.locator('#tt_rows .tt-row').last();
  await last.locator('.tt-name').fill('Youth Fellowship'); await last.locator('.tt-day').selectOption('6'); await last.locator('.tt-time').fill('16:00'); await last.locator('.tt-kind').selectOption('activity');
  await page.click('#tt_save'); await page.waitForTimeout(800);
  await page.locator('#tt_rows').scrollIntoViewIfNeeded(); await step('timetable-edited');
  // Giving
  await nav('finance'); await page.evaluate(() => openFinanceModal());
  await page.fill('#fin_date', ISO); await page.fill('#fin_contrib', 'adae');
  await page.waitForSelector('#fin_memberFound .fin-opt'); await page.click('#fin_memberFound .fin-opt');
  await page.fill('#fin_type', 'Tithe'); await page.fill('#fin_amount', '12000');
  await step('giving-tithe-form');
  await page.click('#addFinanceModal button:has-text("Save")'); await modalClosed('addFinanceModal');
  await step('giving-list', true);
  // Monthly return
  await nav('returns');
  await page.fill('#r_month', PREV); await page.dispatchEvent('#r_month', 'change');
  await page.waitForFunction(() => document.getElementById('saveReturnBtn').textContent === 'File return');
  await page.waitForTimeout(1000);   await page.fill('#r_tithes', '90000'); await page.fill('#r_offerings', '30000');
  await page.waitForFunction(() => /30,000/.test(document.getElementById('r_due').textContent)).catch(() => issues.push('1/3 HQ due on tithes not 30,000: ' + 'see return shot'));
  await step('monthly-return-form', true);
  await page.click('#saveReturnBtn'); await page.waitForSelector('#r_payBox:not(.hidden)');
  await page.fill('#pay_date', ISO); await page.fill('#pay_amount', '40000'); await page.selectOption('#pay_method', 'Bank transfer'); await page.fill('#pay_ref', 'TRF-001');
  await page.click('#payBtn'); await page.waitForSelector('#r_payments .pay-row');
  await step('monthly-return-paid', true);

  // ===== 3. Join link
  await nav('dashboard'); await page.click('#joinToggle'); await page.waitForSelector('#joinQr svg');
  const joinLink = (await page.textContent('#joinLink')).trim();
  await page.locator('#joinCard').scrollIntoViewIfNeeded(); await step('join-link-qr');
  await logout();
  for (const nm of ['Ngozi Eze', 'Spam Person']) {
    await page.goto(joinLink + '&emulator=1'); await page.waitForSelector('#joinForm:not([hidden])');
    await page.fill('[name=fullName]', nm); await page.selectOption('[name=gender]', 'Female'); await page.selectOption('[name=maritalStatus]', 'Single');
    await page.fill('[name=phone]', '08035550000'); await page.fill('[name=dobDay]', '9'); await page.fill('[name=dobMonth]', '9'); await page.fill('[name=address]', 'Somewhere');
    await page.check('[name=consent]');
    if (nm === 'Ngozi Eze') await step('join-form', true);
    await page.click('#joinSend'); await page.waitForSelector('#joinDone:not([hidden])');
    if (nm === 'Ngozi Eze') await step('join-sent');
  }
  await login('ikeja.admin@test.local');
  await page.waitForFunction(() => document.querySelectorAll('#joinCard .pend-row').length === 2);
  const ng = '#joinCard .pend-row:has-text("Ngozi Eze")', sp = '#joinCard .pend-row:has-text("Spam Person")';
  await page.click(ng + ' button:has-text("Flag & pend")');
  await page.selectOption(ng + ' .pend-reason', { index: 1 }); await page.fill(ng + ' .pend-flagnote', 'Which parish did you attend before?');
  await page.click(ng + ' .pend-flagsave'); await page.waitForSelector(ng + ' .pend-note');
  await page.locator('#joinCard').scrollIntoViewIfNeeded(); await step('signup-flagged-pended');
  await page.click(ng + ' button:has-text("Approve as member")'); await page.waitForSelector('#personModal:not(.hidden)');
  await step('signup-approve-form');
  await page.click('#savePersonBtn'); await modalClosed('personModal');
  promptAnswer = 'Not known to the parish';
  await page.click(sp + ' button:has-text("Reject")');
  await page.waitForFunction(() => document.querySelectorAll('#joinCard .pend-row').length === 0); promptAnswer = '';
  await step('signups-done');

  // ===== 4. Messages, sermons, calendar
  await nav('messages'); await page.evaluate(() => { window.open = () => null; window.openExternal = () => {}; });
  await page.selectOption('#msg_tpl', 'general'); await page.selectOption('#msg_unit', 'choir'); await page.click('#msg_unitBtn');
  await page.waitForSelector('#msg_recips .msg-chip');
  await step('messages-whatsapp-compose', true);
  const prev = await page.textContent('#msg_preview');
  if (!/^Halleluyah 🙌/.test(prev.trim())) issues.push('message greeting: ' + prev.slice(0, 60));
  await page.click('.msg-ch[data-c="email"]'); await step('messages-email-compose', true);
  await nav('sermons'); await page.click('#addSermonBtn');
  await page.fill('#sm_title', 'Walk in the Light'); await page.fill('#sm_preacher', 'Olumide Ajayi'); await page.fill('#sm_date', ISO);
  await page.fill('#sm_scripture', 'John 8:12'); await page.fill('#sm_text', 'Beloved, walk in the light.');
  await step('sermon-form');
  await page.click('#saveSermonBtn'); await modalClosed('sermonModal'); await step('sermon-library');
  await nav('calendar'); await page.click('#addEventBtn');
  await page.fill('#ev_title', 'Harvest Thanksgiving'); await page.selectOption('#ev_kind', 'harvest');
  await page.fill('#ev_date', ISO); await page.fill('#ev_time', '10:00'); await page.fill('#ev_venue', 'Main church');
  await step('calendar-event-form');
  await page.click('#saveEventBtn'); await modalClosed('eventModal');
  await page.click('.cal-view[data-v="list"]'); await step('calendar-list', true);
  await nav('dashboard'); await step('parish-dashboard-end', true);
  await logout();

  // ===== 5. Super Admin
  await login('hq@test.local');
  await nav('hqreturns');
  if (await page.locator('#hq_nameBox:not(.hidden)').count()) { await page.fill('#hq_myName', 'Bayo Adeyemi'); await page.click('#hq_nameBox button'); }
  await page.fill('#hq_month', PREV); await page.dispatchEvent('#hq_month', 'change');
  await page.click('.hq-tab[data-tab="parishes"]'); await page.waitForSelector('#hq_returns .ret-row');
  await step('super-returns-list', true);
  await page.click('#hq_returns .ret-row'); await page.waitForSelector('#returnModal:not(.hidden) #rd_superActions:not(.hidden)');
  await page.click('#rd_confirmBtn'); await page.waitForTimeout(800);
  await step('super-remittance-confirmed', true);
  await page.click('#returnModal button[aria-label="Close"]');
  await page.click('.hq-tab[data-tab="alerts"]'); await page.click('#runChecksBtn'); await page.waitForTimeout(1500);
  await step('super-alerts', true);
  await nav('directory'); await page.waitForSelector('#dir_list .dir-row');
  await step('super-directory', true);
  await page.click('#dir_list .dir-row:has-text("Adaeze")'); await page.waitForSelector('#dirModal:not(.hidden)');
  await step('super-directory-participation', true);
  await page.click('#dirModal button[aria-label="Close"]');
  await nav('committees'); await page.click('#newCmtBtn');
  await page.fill('#cf_name', 'Harvest 2027 Committee'); await page.fill('#cf_purpose', 'Plan harvest'); await page.fill('#cf_start', ISO); await page.fill('#cf_end', '2027-10-31');
  await page.click('#saveCmtBtn'); await page.waitForSelector('#cmtModal:not(.hidden)');
  await page.selectOption('#cm_role', 'Chair'); await page.fill('#cm_q', 'adaeze'); await page.waitForSelector('#cm_found .cm-match'); await page.click('#cm_found .cm-match');
  await page.waitForSelector('#cm_current .cm-member'); await step('super-committee', true);
  await page.click('#cmtModal button[aria-label="Close"]');
  await nav('staff'); await page.click('#addStaffBtn');
  await page.fill('#sf_name', 'Kemi Adesanya'); await page.fill('#sf_dept', 'Finance'); await page.fill('#sf_title', 'Accountant'); await page.fill('#sf_employed', '2015-02-01'); await page.check('#sf_consent');
  await page.click('#saveStaffBtn'); await page.waitForSelector('#staffModal:not(.hidden)');
  await step('super-hq-staff', true); await page.click('#staffModal button[aria-label="Close"]');
  await nav('postings'); await page.waitForSelector('#po_list');
  await page.fill('#po_q', 'olumide'); await page.waitForSelector('#po_found .po-opt'); await page.click('#po_found .po-opt');
  const pidB = await page.evaluate(async () => (await db.collection('parishes').get()).docs.find(d => d.data().name.startsWith('Abeokuta')).id);
  await page.selectOption('#po_to', pidB); await page.fill('#po_date', ISO); await page.fill('#po_reason', 'Needed in Abeokuta');
  await page.click('#savePostingBtn'); await page.waitForSelector('#po_list .po-row');
  await step('super-clergy-posting', true);
  await nav('hqreturns'); await page.click('.hq-tab[data-tab="log"]'); await page.waitForSelector('#hq_log .audit-row');
  await step('super-audit-log', true);
  await logout();

  // ===== 6. Tenant isolation
  await claim('abk.admin@test.local', codeB);
  await step('parish2-dashboard');
  const leak = await page.evaluate(async (pid) => Promise.all(['members', 'clergy', 'finances', 'attendance', 'pendingMembers'].map(c =>
    db.collection('parishes').doc(pid).collection(c).get().then(() => 'READ ' + c, e => e.code))), pa.id);
  if (leak.some(x => x !== 'permission-denied')) issues.push('TENANT LEAK: ' + leak.join(','));
  await nav('members'); await step('parish2-members-empty', true);
  console.log('isolation', leak.join(','));
  await logout();
} catch (e) {
  issues.push('STOPPED: ' + e.message.split('\n')[0]);
  await page.screenshot({ path: join(SHOTS, 'zz-failure.png'), fullPage: true }).catch(() => {});
} finally {
  console.log('ISSUES', JSON.stringify(issues, null, 1));
  console.log('CONSOLE', JSON.stringify([...new Set(consoleErrors)], null, 1));
  console.log('PAGEERR', JSON.stringify(pageErrors));
  console.log('DIALOGS', JSON.stringify(dialogs));
  await browser.close(); server.close();
}
