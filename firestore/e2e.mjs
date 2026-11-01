// Phone-size end-to-end test of the Parish Portal against the LOCAL Auth + Firestore
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
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
  let body;
  try { body = readFileSync(join(ROOT, path)); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[extname(path)] || 'text/plain' }); res.end(body);
}).listen(5055, '127.0.0.1');
const APP = 'http://127.0.0.1:5055/?emulator=1';

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
const nav = (id) => page.click('#nav-' + id);
const modalClosed = (id) => page.waitForSelector(`#${id}.hidden`, { state: 'attached', timeout: 15000 });

async function addPerson(kind, i, p, expectRefused = false) {
  await nav(kind);
  await page.click(kind === 'clergy' ? '#addClergyBtn' : '#addMemberBtn');
  await page.waitForSelector('#personModal:not(.hidden)');
  await page.setInputFiles('#p_photo', await makeImage(p.initials, p.color));
  await page.waitForSelector('#p_photoPreview:not(.hidden)');
  await page.fill('#p_name', p.name);
  await page.selectOption('#p_gender', p.gender);
  await page.selectOption('#p_marital', p.marital);
  await page.fill('#p_address', `${i} Ikorodu Road, Lagos`);
  await page.fill('#p_phone', p.phone);
  if (p.email) await page.fill('#p_email', p.email);
  if (p.rank) await page.selectOption('#p_rank', p.rank);
  await page.fill('#p_occupation', p.occupation);
  await page.selectOption('#p_dobDay', String(p.dob[0]));
  await page.selectOption('#p_dobMonth', String(p.dob[1]));
  if (p.dob[2]) await page.selectOption('#p_dobYear', String(p.dob[2]));
  await page.selectOption('#p_anDay', '25'); await page.selectOption('#p_anMonth', '12'); await page.selectOption('#p_anYear', '2025');
  await page.fill('#p_nokName', 'TEST Kin ' + i);
  await page.fill('#p_nokAddress', 'Ibadan');
  await page.fill('#p_nokPhone', '0700 000 000' + i);
  if (p.important) await page.check('#p_important');
  await page.check('#p_consent');
  if (p.shot) await fullShot(p.shot);
  await page.click('#savePersonBtn');
  if (expectRefused) { await page.waitForTimeout(2000); return; }
  await modalClosed('personModal');
}

try {
  // 1. The only seeded account: a super_admin (emulator only).
  const superUid = await signUp('super@test.local', PASS);
  await seedDoc(`users/${superUid}`, { role: 'super_admin' });

  // 2. Get Started page has no self-registration.
  await page.goto(APP);
  await page.waitForSelector('#accessBtn');
  assert.equal(await page.locator('text=Register New Parish').count(), 0, 'no self-registration');
  assert.match(await page.title(), /CELESTIAL CHURCH OF CHRIST/);
  await shot('01-get-started');

  // 3. Super admin creates a parish (with location) + invite.
  await login('super@test.local');
  await nav('parishes');
  await page.fill('#np_name', 'TEST Cathedral Parish');
  await page.fill('#np_address', '1 Church Street');
  await page.fill('#np_maps', 'https://maps.app.goo.gl/test123');
  await page.fill('#np_city', 'Ikeja'); await page.fill('#np_state', 'Lagos'); await page.fill('#np_country', 'Nigeria');
  await page.selectOption('#np_continent', 'Africa');
  await page.fill('#np_email', 'admin@test.local');
  await page.click('#createParishBtn');
  await page.waitForSelector('#inviteCode');
  const code = (await page.textContent('#inviteCode')).trim();
  assert.match(code, /^[A-Z2-9-]{20,}$/);
  await fullShot('02-super-creates-parish-invite');
  await logout();

  // 4. Invited admin activates with email + code, and lands in the parish.
  await page.click('#inviteToggle');
  await page.fill('#invEmail', 'admin@test.local');
  await page.fill('#invCode', code);
  await page.fill('#invPassword', PASS);
  await shot('03-admin-activates-invite');
  await page.click('#claimBtn');
  await page.waitForSelector('#mainApp:not(.hidden)');
  await page.waitForFunction(() => document.getElementById('dashParishName').textContent === 'TEST Cathedral Parish');
  // Code cannot be used twice.
  await logout();
  await page.click('#inviteToggle');
  await page.fill('#invEmail', 'admin@test.local'); await page.fill('#invCode', code); await page.fill('#invPassword', PASS);
  const d0 = dialogs.length;
  await page.click('#claimBtn');
  await page.waitForFunction(() => !document.getElementById('claimBtn').disabled && document.getElementById('mainApp').classList.contains('hidden'));
  await page.waitForTimeout(1500);
  assert.ok(dialogs.slice(d0).some(m => /Could not activate/.test(m)), 'invite reuse refused');
  await login('admin@test.local');

  // 5. Admin edits the parish name and uploads a logo -> shown at the top.
  await nav('settings');
  await page.fill('#s_name', 'TEST Grace Cathedral Parish');
  await page.setInputFiles('#s_logo', await makeImage('CCC', '#1e3a8a'));
  await page.waitForSelector('#settingsLogo:not(.hidden)');
  await page.click('#saveParishBtn');
  await page.waitForFunction(() => document.getElementById('dashParishName').textContent === 'TEST Grace Cathedral Parish');
  await page.waitForSelector('#parishLogo:not(.hidden)');
  await fullShot('04-parish-name-logo');

  // 6. Five church members with photos (member 1 flagged important).
  const members = [
    { name: 'TEST Adebayo Ogun', gender: 'Male', marital: 'Married', phone: '0803 111 0001', rank: 'Senior Leader', occupation: 'Engineer', dob: [12, 3, 1975], initials: 'AO', color: '#065f46', important: true, shot: '05-member-form' },
    { name: 'TEST Bisola Ogun', gender: 'Female', marital: 'Married', phone: '0803 111 0002', rank: '', occupation: 'Teacher', dob: [5, 8], initials: 'BO', color: '#9d174d' },
    { name: 'TEST Chidi Ogun', gender: 'Male', marital: 'Single', phone: '0803 111 0003', rank: 'Brother', occupation: 'Student', dob: [1, 1, 2008], initials: 'CO', color: '#1d4ed8' },
    { name: 'TEST Damilola Ade', gender: 'Female', marital: 'Widowed', phone: '0803 111 0004', rank: '', occupation: 'Trader', dob: [30, 11], initials: 'DA', color: '#7c2d12' },
    { name: 'TEST Emeka Obi', gender: 'Male', marital: 'Single', phone: '0803 111 0005', rank: 'Elder Brother', occupation: 'Driver', dob: [9, 9, 1990], initials: 'EO', color: '#4c1d95' },
  ];
  for (let i = 0; i < members.length; i++) await addPerson('members', i + 1, members[i]);
  await nav('members');
  await page.waitForFunction(() => document.querySelectorAll('#membersTable .person-row').length === 5);
  const nos = await page.$$eval('#membersTable .person-row', els => els.map(e => e.dataset.no));
  assert.deepEqual(nos, ['CCC-MBR-001', 'CCC-MBR-002', 'CCC-MBR-003', 'CCC-MBR-004', 'CCC-MBR-005']);
  await fullShot('06-members-list');

  // Photos really were compressed to ~60KB JPEG and stored in Firestore.
  const sizes = await page.evaluate(async () => {
    const s = await db.collection('parishes').doc(localState.currentParishId).collection('members').get();
    return s.docs.map(d => ({ type: d.data().photo.slice(0, 23), bytes: Math.round((d.data().photo.length - 23) * 0.75) }));
  });
  for (const s of sizes) { assert.equal(s.type, 'data:image/jpeg;base64,'); assert.ok(s.bytes <= 60000 && s.bytes > 3000, 'photo ' + s.bytes); }

  // 7. Two clergy, separate numbering.
  await addPerson('clergy', 6, { name: 'TEST Ven Femi Bello', gender: 'Male', marital: 'Married', phone: '0803 222 0001', email: 'femi@test.local', rank: 'Most Senior Evangelist', occupation: 'Clergy', dob: [2, 2, 1960], initials: 'FB', color: '#92400e', shot: '07-clergy-form' });
  await addPerson('clergy', 7, { name: 'TEST Ev Gbenga Lawal', gender: 'Male', marital: 'Married', phone: '0803 222 0002', email: 'gbenga@test.local', rank: 'Evangelist', occupation: 'Clergy', dob: [7, 4], initials: 'GL', color: '#a16207' });
  await nav('clergy');
  await page.waitForFunction(() => document.querySelectorAll('#clergyTable .person-row').length === 2);
  assert.deepEqual(await page.$$eval('#clergyTable .person-row', els => els.map(e => e.dataset.no)), ['CCC-CLG-001', 'CCC-CLG-002']);
  await fullShot('08-clergy-list');

  // Clergy-not-admin: the admin's own email cannot be used for clergy.
  const before = dialogs.length;
  await addPerson('clergy', 8, { name: 'TEST Admin As Clergy', gender: 'Male', marital: 'Single', phone: '0803 222 0009', email: 'admin@test.local', rank: 'Leader', occupation: 'x', dob: [1, 1], initials: 'X', color: '#000' }, true);
  assert.ok(dialogs.slice(before).some(m => /clergy cannot be admins/.test(m)), 'admin email refused for clergy: ' + dialogs.slice(before));
  await page.evaluate(() => closeModal('personModal'));

  // 8. Transfer clergy 001 to Former, with a letter photo. Number kept, shown "· Former".
  await nav('clergy');
  await page.click('#clergyTable .person-row[data-no="CCC-CLG-001"]');
  await page.waitForSelector('#recordModal:not(.hidden)');
  await page.click('text=Transfer / move to Former');
  await page.waitForSelector('#transferModal:not(.hidden)');
  await page.selectOption('#t_reason', 'Transfer');
  await page.fill('#t_date', '2026-11-01');
  await page.fill('#t_to', 'TEST CCC Abuja Parish');
  await page.setInputFiles('#t_letter', await makeImage('LETTER', '#334155'));
  await shot('09-transfer-form');
  await page.click('#saveTransferBtn');
  await modalClosed('transferModal');
  await page.waitForSelector('#recordModal:not(.hidden)');
  await page.waitForSelector('#recordTitle:has-text("CCC-CLG-001 · Former")');
  await page.click('text=View transfer letter');
  await page.waitForSelector('#letterImg:not(.hidden)');
  await fullShot('10-former-service-record');
  await page.evaluate(() => closeModal('recordModal'));
  await nav('former');
  await page.waitForSelector('#formerTable .person-row[data-no="CCC-CLG-001"]');
  assert.match(await page.textContent('#formerTable'), /CCC-CLG-001 · Former/);
  await nav('clergy');
  await page.waitForFunction(() => document.querySelectorAll('#clergyTable .person-row').length === 1);
  await shot('11-former-clergy-list');

  // 9. Ordain member 005: new CCC-CLG-003, MBR-005 retired with a history link.
  await nav('members');
  await page.click('#membersTable .person-row[data-no="CCC-MBR-005"]');
  await page.waitForSelector('#recordModal:not(.hidden)');
  promptAnswer = 'emeka@test.local';
  await page.click('text=Ordain as clergy');
  await page.waitForSelector('#recordTitle:has-text("CCC-CLG-003")');
  assert.match(await page.textContent('#recordBody'), /Ordained from CCC-MBR-005/);
  await shot('12-ordained-new-number');
  await page.evaluate(() => closeModal('recordModal'));

  // 10. Link a family: husband 001, wife 002, child 003.
  await nav('families');
  await page.click('#addFamilyBtn');
  await page.fill('#f_name', 'TEST Ogun family');
  await page.fill('#f_husband', 'CCC-MBR-001');
  await page.fill('#f_wife', 'ccc-mbr-002');
  await page.fill('#f_children', 'CCC-MBR-003');
  await page.click('#saveFamilyBtn');
  await modalClosed('familyModal');
  await page.waitForFunction(() => document.querySelectorAll('.family-card .person-row').length === 3);
  await fullShot('13-family-view');
  await page.click('.family-card .person-row[data-no="CCC-MBR-003"]');           // each member separately
  await page.waitForSelector('#recordBody:has-text("TEST Ogun family")');
  await shot('14-family-member-alone');
  await page.evaluate(() => closeModal('recordModal'));

  // 11. Global search: name, phone, number (members + clergy).
  const gsearch = async (term, expectNos, name) => {
    await page.fill('#globalSearch', term);
    await page.waitForFunction(n => { const r = [...document.querySelectorAll('#globalResults .person-row')].map(e => e.dataset.no).sort(); return JSON.stringify(r) === JSON.stringify(n); }, [...expectNos].sort(), { timeout: 10000 });
    await shot(name);
  };
  await gsearch('test ogun', [], '15a-search-none');      // prefix search: "test ogun" is not a name prefix
  await gsearch('TEST Adebayo', ['CCC-MBR-001'], '15-search-name');
  await gsearch('0803 222 0002', ['CCC-CLG-002'], '16-search-phone');
  await gsearch('ccc-mbr-4', ['CCC-MBR-004'], '17-search-number');
  await gsearch('TEST Ven', ['CCC-CLG-001'], '17b-search-former-clergy');
  await page.fill('#globalSearch', '');

  // 12. Dashboard counts: 4 members (005 ordained), 2 active clergy (001 former), total 6.
  await nav('dashboard');
  await page.evaluate(() => loadParishData());
  await page.waitForFunction(() => ['metricTotal', 'metricClergy', 'metricMembers'].map(i => document.getElementById(i).textContent).join() === '6,2,4');
  await shot('18-parish-dashboard');
  const parishId = await page.evaluate(() => localState.currentParishId);

  // ---------------- PHASE 2: departments ----------------
  // Six departments as dashboard buttons AND sidebar buttons.
  assert.equal(await page.locator('#deptGrid > button').count(), 6, 'six dept buttons on dashboard');
  for (const d of ['parochial', 'choir', 'ict', 'sidemen', 'prophets', 'sundayschool']) assert.equal(await page.locator('#nav-dept-' + d).count(), 1);
  const deptAdd = async (term, no, role = '') => {
    await page.fill('#d_role', role);
    await page.fill('#d_find', term);
    await page.waitForSelector(`#d_matches .dept-match[data-no="${no}"]`);
    await page.click(`#d_matches .dept-match[data-no="${no}"]`);
    await page.waitForSelector(`#deptMembersList .dept-row[data-no="${no}"]`);
  };
  await page.click('#nav-dept-choir');
  await page.waitForSelector('#section-dept:not(.hidden)');
  await deptAdd('TEST Bisola', 'CCC-MBR-002', 'Head');
  await deptAdd('ccc-mbr-1', 'CCC-MBR-001');
  await deptAdd('CCC-MBR-004', 'CCC-MBR-004');
  // Clergy cannot join: CLG number refused, ordained member (005, now clergy) disabled.
  await page.fill('#d_find', 'CCC-CLG-002');
  await page.waitForSelector('#d_matches:has-text("Clergy cannot join a department")');
  await page.fill('#d_find', 'TEST Emeka');
  await page.waitForSelector('#d_matches .dept-match[data-no="CCC-MBR-005"][disabled]');
  await shot('22-dept-clergy-refused');
  // Rules refuse it too, even if the UI were bypassed.
  const bypass = await page.evaluate(() => parishRef().collection('deptMembers').doc('choir_CCC-CLG-002').set({ dept: 'choir', memberNo: 'CCC-CLG-002', fullName: 'x', role: '', status: 'Current', joinedDate: today(), updatedAt: nowIso() }).then(() => 'WROTE', e => e.code));
  assert.equal(bypass, 'permission-denied', 'clergy blocked by rules');
  await page.fill('#d_find', '');
  // Choir term ended 1 Oct 2026 -> overdue banner. Move 001 to Former members.
  await page.fill('#d_termStart', '2024-10-01');
  await page.dispatchEvent('#d_termStart', 'change');
  assert.equal(await page.inputValue('#d_termEnd'), '2026-10-01', 'term end = start + 2 years');
  await page.click('#saveTermBtn');
  await page.waitForSelector('#deptBanner:has-text("OVERDUE")');
  await page.click('#deptMembersList .dept-row[data-no="CCC-MBR-001"] button:has-text("Remove")');
  await page.waitForFunction(() => document.getElementById('deptFormerCount').textContent === '1' && document.getElementById('deptCount').textContent === '2');
  await page.click('#section-dept details summary');
  await fullShot('23-dept-choir-members-former');
  // Parochial: term ends 1 Dec 2026 -> due within 60 days.
  await page.click('#nav-dept-parochial');
  await page.waitForFunction(() => document.getElementById('deptTitle').textContent === 'Parochial Committee');
  await deptAdd('TEST Adebayo', 'CCC-MBR-001', 'Chairman');
  await page.fill('#d_termStart', '2024-12-01'); await page.dispatchEvent('#d_termStart', 'change');
  await page.click('#saveTermBtn');
  await page.waitForSelector('#deptBanner:has-text("Election due in")');
  await shot('24-dept-parochial-due');
  await nav('dashboard');
  await page.waitForFunction(() => document.querySelector('#dept-card-choir .dept-count').textContent === '2' && document.querySelector('#dept-card-parochial .dept-count').textContent === '1');
  assert.equal(await page.locator('#electionBanners .election-banner').count(), 2);
  await fullShot('25-dashboard-departments');

  // ---------------- PHASE 2: members in diaspora ----------------
  await nav('members');
  await page.click('#membersTable .person-row[data-no="CCC-MBR-004"]');
  await page.waitForSelector('#recordBody:has-text("Choir")');
  await page.click('#recordActions button:has-text("Moved abroad")');
  await page.fill('#ab_country', 'United Kingdom'); await page.fill('#ab_city', 'Manchester'); await page.fill('#ab_parish', 'CCC Manchester Parish');
  await page.fill('#ab_date', '2026-10-15');
  await shot('26-moved-abroad-form');
  await page.click('#saveAbroadBtn');
  await page.waitForSelector('#section-diaspora:not(.hidden) .abroad-row[data-no="CCC-MBR-004"]');
  await page.waitForFunction(() => document.getElementById('abroadCount').textContent === '1');
  await fullShot('27-diaspora-list');
  await page.evaluate(() => loadParishData());
  await page.waitForFunction(() => ['metricTotal', 'metricMembers'].map(i => document.getElementById(i).textContent).join() === '5,3');
  await page.waitForFunction(() => document.querySelector('#dept-card-choir .dept-count').textContent === '1'); // left choir when abroad
  await logout();

  // 13. Super admin: totals, clergy register, important members only.
  await login('super@test.local');
  await page.waitForFunction(() => document.getElementById('metricTotal').textContent === '5');
  await shot('19-super-dashboard');
  await nav('register');
  await page.waitForFunction(() => document.querySelectorAll('#registerList .world-row').length === 3);
  assert.match(await page.textContent('#registerList'), /CCC-CLG-001 · Former/);
  await fullShot('20-super-clergy-register');
  await nav('important');
  await page.waitForFunction(() => document.querySelectorAll('#importantList .world-row').length === 1);
  assert.match(await page.textContent('#importantList'), /TEST Adebayo Ogun/);
  await shot('21-super-important-only');
  const leak = await page.evaluate(async (p) => {
    const r = {};
    for (const [k, fn] of Object.entries({
      ordinaryMember: () => db.collection('parishes').doc(p).collection('members').doc('CCC-MBR-002').get(),
      allMembers: () => db.collection('parishes').doc(p).collection('members').get(),
      finances: () => db.collection('parishes').doc(p).collection('finances').get(),
      families: () => db.collection('parishes').doc(p).collection('families').get(),
    })) { try { await fn(); r[k] = 'READ'; } catch (e) { r[k] = e.code; } }
    return r;
  }, parishId);
  for (const [k, v] of Object.entries(leak)) assert.equal(v, 'permission-denied', 'super blocked from ' + k);
  // Clergy-not-admin: a clergy email cannot be invited as a parish admin.
  await nav('parishes');
  const b2 = dialogs.length;
  await page.fill('#np_name', 'TEST Second Parish');
  await page.fill('#np_email', 'gbenga@test.local');
  await page.click('#createParishBtn');
  await page.waitForFunction(() => !document.getElementById('createParishBtn').disabled);
  await page.waitForTimeout(500);
  assert.ok(dialogs.slice(b2).some(m => /must not belong to clergy/.test(m)), 'clergy email refused as admin');

  // ---------------- PHASE 2: member transfer between parishes ----------------
  await page.fill('#np_name', 'TEST London Parish');
  await page.fill('#np_city', 'London'); await page.fill('#np_country', 'United Kingdom'); await page.selectOption('#np_continent', 'Europe');
  await page.fill('#np_email', 'london@test.local');
  await page.click('#createParishBtn');
  await page.waitForSelector('#newParishCode');
  const code2 = (await page.textContent('#inviteCode')).trim();
  const londonCode = (await page.textContent('#newParishCode')).trim();
  assert.match(londonCode, /^[A-Z0-9]{6}$/);
  await logout();
  await page.click('#inviteToggle');
  await page.fill('#invEmail', 'london@test.local'); await page.fill('#invCode', code2); await page.fill('#invPassword', PASS);
  await page.click('#claimBtn');
  await page.waitForFunction(() => document.getElementById('dashParishName').textContent === 'TEST London Parish');
  await logout();

  // Old parish sends member 003 with consent, by the London parish code.
  await login('admin@test.local');
  await nav('members');
  await page.click('#membersTable .person-row[data-no="CCC-MBR-003"]');
  await page.waitForSelector('#recordModal:not(.hidden)');
  await page.click('#recordActions button:has-text("Transfer to another parish")');
  await page.fill('#st_code', londonCode.toLowerCase());
  await page.check('#st_consent');
  await shot('28-send-transfer');
  await page.click('#sendTransferBtn');
  await page.waitForSelector('#section-diaspora:not(.hidden) .outgoing-row:has-text("Pending")');
  await fullShot('29-transfer-sent');
  await logout();

  // New parish accepts: own record, same life-long number shown.
  await login('london@test.local');
  await nav('diaspora');
  await page.waitForSelector('.incoming-row');
  assert.match(await page.textContent('#incomingList'), /Life no\. CCC-MBR-003/);
  await shot('30-incoming-transfer');
  await page.click('.incoming-row button:has-text("Accept")');
  await page.waitForSelector('#recordModal:not(.hidden) #recordBody:has-text("Life-long number")');
  assert.match(await page.textContent('#recordBody'), /CCC-MBR-003 \(/);
  assert.match(await page.textContent('#recordTitle'), /^CCC-MBR-001$/);
  await shot('31-accepted-life-number');
  await page.evaluate(() => closeModal('recordModal'));
  await nav('members');
  await page.waitForSelector('#membersTable .person-row:has-text("Life no. CCC-MBR-003")');
  await shot('32-new-parish-members');
  await logout();

  // Super: world totals count each person once; flow summary has places + counts only.
  await login('super@test.local');
  // Old parish: 2 members (001, 002) + 2 clergy; London: 1 member. 004 abroad, 003 counted once (in London).
  await page.waitForFunction(() => ['metricTotal', 'metricMembers'].map(i => document.getElementById(i).textContent).join() === '5,3');
  await nav('flows');
  await page.waitForFunction(() => document.querySelectorAll('#flowsList .flow-row').length === 2);
  const flowText = await page.textContent('#flowsList');
  assert.match(flowText, /Ikeja, Nigeria → Manchester, United Kingdom/);
  assert.match(flowText, /Ikeja, Nigeria → London, United Kingdom/);
  assert.ok(!/TEST /.test(flowText), 'no names in flows');
  await shot('33-super-diaspora-flows');
  const leak2 = await page.evaluate(async () => { try { await db.collection('transfers').get(); return 'READ'; } catch (e) { return e.code; } });
  assert.equal(leak2, 'permission-denied', 'super cannot read transfers');


  // ---------------------------------------------------------------- Phase 3: attendance
  await logout();
  await login('admin@test.local');
  // An old simple record (Phase 1 shape) must still show.
  await page.evaluate(() => parishRef().collection('attendance').doc('legacy1').set({ serviceDate: '2026-10-04', serviceType: 'Sunday Service', headcount: 88 }));
  await nav('attendance');
  await page.waitForSelector('#att-week .svc-card');
  const wk = await page.evaluate(() => weekServices(weekStart(localToday())).map(s => s.key));
  assert.ok(wk.includes('sunday') && wk.includes('wakati') && wk.includes('fri_evening'), 'timetable generated');
  assert.ok(wk.includes('new_moon') !== wk.includes('vigil_prophets'), 'Thursday: New Moon OR Prophets vigil');
  assert.deepEqual(await page.evaluate(() => weekServices('2026-11-01').filter(s => s.date === '2026-11-05').map(s => s.key)), ['new_moon'], 'first Thursday = New Moon 22:00');
  assert.deepEqual(await page.evaluate(() => weekServices('2026-11-08').filter(s => s.date === '2026-11-12').map(s => s.key)), ['vigil_prophets']);
  await page.waitForSelector('#attendanceTable:has-text("88 attendees")');
  await fullShot('40-att-week-timetable');
  // Record Sunday: split headcount + clergy leader + notes.
  const sunId = await page.evaluate(() => weekServices(weekStart(localToday())).find(s => s.key === 'sunday').id);
  await page.click(`.svc-card[data-id="${sunId}"] button:has-text("Record")`);
  await page.fill('#svc_men', '40'); await page.fill('#svc_women', '55'); await page.fill('#svc_children', '20'); await page.fill('#svc_visitors', '6');
  await page.selectOption('#svc_led', { index: 1 });
  await page.fill('#svc_notes', 'Theme: walking in the light');
  assert.equal(await page.textContent('#svc_total'), '121');
  await shot('41-att-record-service');
  await page.click('#saveServiceBtn');
  await modalClosed('serviceModal');
  await page.waitForSelector(`.svc-card[data-id="${sunId}"]:has-text("121")`);
  assert.match(await page.textContent(`.svc-card[data-id="${sunId}"]`), /Led by/);
  // Special service.
  await page.click('button:has-text("Special service")');
  await page.fill('#sp_name', 'Harvest Thanksgiving');
  await page.fill('#sp_date', await page.evaluate(() => addDays(weekStart(localToday()), 6)));
  await page.click('#saveSpecialBtn');
  await page.waitForSelector('.svc-card:has-text("Harvest Thanksgiving")');
  await fullShot('42-att-week-recorded-special');
  // No whole-church tick-list (founder decision).
  assert.equal(await page.locator('[data-tab="checkin"]').count(), 0, 'no whole-church check-in');

  // Unit register: choir marks its own short list; an admin-defined unit too.
  await page.click('[data-tab="depts"]');
  await page.waitForSelector('#daList .da-row');
  await page.selectOption('#da_dept', 'choir');
  await page.waitForSelector('#daList .da-row');
  const old = await page.evaluate(() => addDays(localToday(), -35));
  await page.evaluate(d => parishRef().collection('deptAttendance').doc('choir_' + d).set({ dept: 'choir', date: d, kind: 'Practice', present: ['CCC-MBR-002'], notes: '', updatedAt: nowIso() }), old);
  await page.selectOption('#da_kind', 'Practice');
  await page.click('#saveDeptAttBtn');  // nobody ticked today
  await page.waitForSelector('#daAbsent .absent-row');
  await fullShot('43-unit-register-choir');
  await page.fill('#unit_name', 'Ushers');
  await page.click('#addUnitBtn');
  await page.waitForFunction(() => [...document.querySelectorAll('#da_dept option')].some(o => o.textContent === 'Ushers'));
  // Roll-up across units with one-tap WhatsApp.
  await page.click('[data-tab="followup"]');
  await page.waitForSelector('#absentList .absent-row');
  const wa = await page.getAttribute('#absentList .wa-link', 'href');
  assert.match(wa, /^https:\/\/wa\.me\/\d+\?text=Shalom/);
  assert.match(await page.textContent('#absentList'), /Choir/);
  await fullShot('44-followup-rollup-whatsapp');

  // Visitors: log, follow-up status, convert to member.
  await page.click('[data-tab="visitors"]');
  await page.fill('#v_name', 'TEST Kemi Visitor'); await page.fill('#v_phone', '08031234567'); await page.fill('#v_invited', 'TEST Bisola');
  const d1 = dialogs.length;
  await page.click('#saveVisitorBtn');
  await page.waitForTimeout(300);
  assert.ok(dialogs.length > d1 && /permission/.test(dialogs.at(-1)), 'consent required');
  await page.check('#v_consent');
  await page.click('#saveVisitorBtn');
  await page.waitForSelector('.visitor-row:has-text("TEST Kemi Visitor")');
  await page.selectOption('.visitor-row select', 'Contacted');
  await page.waitForTimeout(500);
  await shot('45-visitors-log');
  await page.click('.visitor-row button:has-text("Make member")');
  await page.waitForSelector('#personModal:not(.hidden)');
  assert.equal(await page.inputValue('#p_name'), 'TEST Kemi Visitor');
  await page.selectOption('#p_gender', 'Female'); await page.selectOption('#p_marital', 'Single');
  await page.selectOption('#p_dobDay', '5'); await page.selectOption('#p_dobMonth', '5');
  await page.check('#p_consent');
  await page.click('#savePersonBtn');
  await page.waitForSelector('.visitor-row:has-text("Member CCC-MBR-")');
  await shot('46-visitor-converted');

  // Saturday cleaning rota.
  await page.click('[data-tab="cleaning"]');
  await page.fill('#cl_search', 'TEST Bisola');
  await page.click('#cl_found button');
  await page.check('#cl_list .cl-row input');
  await page.click('#saveCleaningBtn');
  await page.waitForFunction(() => true);
  await page.waitForTimeout(500);
  assert.match(dialogs.at(-1), /1 of 1 came/);
  await shot('47-cleaning-rota');

  // Reports: chart, CSV, print.
  await page.click('[data-tab="reports"]');
  await page.waitForSelector('#rpChart svg rect', { state: 'attached' });
  assert.match(await page.textContent('#rpTypes'), /Sunday Service/);
  assert.match(await page.textContent('#rpDepts'), /Choir/);
  await fullShot('48-reports-weekly');
  await page.selectOption('#rp_period', 'month');
  await page.waitForSelector('#rpTable:has-text("Month")');
  await shot('49-reports-monthly');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Services CSV")')]);
  const csv = readFileSync(await dl.path(), 'utf8');
  assert.match(csv, /^Date,Service,Type,Men,Women,Children,Visitors,Total/);
  assert.match(csv, /,40,55,20,6,121,/);
  assert.match(csv, /2026-10-04,Sunday Service/, 'old records exported too');
  await page.emulateMedia({ media: 'print' });
  await fullShot('50-report-print-view');
  await page.emulateMedia({ media: 'screen' });
  await logout();

  // Super Admin / HQ: totals per service type, never the records.
  await login('super@test.local');
  await page.waitForSelector('#worldByType:has-text("Sunday Service")');
  await fullShot('51-super-attendance-totals');
  const leak3 = await page.evaluate(async (p) => { try { await db.collection('parishes').doc(p).collection('attendance').get(); return 'READ'; } catch (e) { return e.code; } }, parishId);
  assert.equal(leak3, 'permission-denied', 'super cannot read attendance records');
  const leak4 = await page.evaluate(async (p) => { try { await db.collection('parishes').doc(p).collection('visitors').get(); return 'READ'; } catch (e) { return e.code; } }, parishId);
  assert.equal(leak4, 'permission-denied', 'super cannot read visitors');
  console.log('E2E PASS (phase 3): timetable week, split headcount + leader + notes, special service, unit registers + admin unit, absent 3+ weeks roll-up with WhatsApp, visitors + convert, cleaning rota, reports chart/CSV/print, super totals only.');

  assert.deepEqual(pageErrors, [], 'no page errors');
  console.log('E2E PASS (phase 2): departments (6 buttons, members + former, terms, due/overdue banners, clergy ban UI + rules), moved abroad, transfer by parish code with life-long number, world totals once, super flow summary without names. ');
  console.log('E2E PASS: super created parish + invite; admin activated, renamed + logo; 5 members with ~60KB photos; 2 clergy; transfer to Former with letter; ordination; family; global search by name/phone/number; dashboard 6/2/4; super sees totals + clergy + important only; clergy-not-admin enforced both ways.');
} catch (e) {
  await shot('zz-failure').catch(() => {});
  console.error('E2E FAIL:', e.message);
  console.error('dialogs:', dialogs);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
