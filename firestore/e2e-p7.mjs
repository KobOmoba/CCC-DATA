// Phase 7 (HQ Staff, member directory, committees) phone-size end-to-end test of the Parish Portal against the LOCAL Auth + Firestore
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
}).listen(5057, '127.0.0.1');
const APP = 'http://127.0.0.1:5057/?emulator=1';

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

try {
  const superUid = await signUp('bayo@test.local', PASS);
  await seedDoc(`users/${superUid}`, { role: 'super_admin', name: 'Bayo Adeyemi' });
  const unnamedUid = await signUp('unnamed@test.local', PASS);
  await seedDoc(`users/${unnamedUid}`, { role: 'super_admin' });
  await login('bayo@test.local');
  const codeA = await createParish('TEST Ikeja Parish', 'Ikeja', 'Nigeria', 'Africa', 'NGN', 'TIP', 'IKJ', 'ikeja@test.local');
  const codeB = await createParish('TEST London Parish', 'London', 'United Kingdom', 'Europe', 'GBP', 'TLP', 'LDN', 'london@test.local');
  await logout();

  // ---- Parish A: members through the form (directory written alongside), clergy, a department, attendance, giving.
  await claim('ikeja@test.local', codeA);
  let d0 = dialogs.length;
  await addPerson('members', { name: 'Adaeze Okafor', gender: 'Female', rank: 'Elder Sister', occupation: 'Civil Engineer', phone: '08030000001', anoint: true });
  await addPerson('members', { name: 'Tunde Bakare', gender: 'Male', rank: 'Leader', occupation: 'Accountant', phone: '08030000002' });
  await addPerson('clergy', { name: 'Olumide Ajayi', gender: 'Male', rank: 'Evangelist', email: 'olumide@test.local', phone: '08030000003' });
  noFail(d0);
  const nos = await page.evaluate(async () => (await parishRef().collection('members').get()).docs.map(d => d.id).sort());
  assert.equal(nos.length, 2);
  const dirNow = await page.evaluate(async () => (await db.collection('directory').where('parishId', '==', localState.currentParishId).get()).size);
  assert.equal(dirNow, 2, 'directory doc written alongside each new member');
  // Participation: choir membership, 3 sessions in a row, tithes in 3 of the last 6 months (all through the rules).
  await page.evaluate(async (no) => {
    const today = localToday();
    await parishRef().collection('deptMembers').doc('choir_' + no).set({ dept: 'choir', memberNo: no, fullName: 'Adaeze Okafor', role: 'Soprano lead', status: 'Current', joinedDate: '2025-01-05', updatedAt: nowIso() });
    for (const n of [7, 14, 21]) { const d = addDays(today, -n); await parishRef().collection('deptAttendance').doc('choir_' + d).set({ dept: 'choir', date: d, kind: 'Practice', present: [no], notes: '', updatedAt: nowIso() }); }
    for (const n of [20, 50, 80]) await parishRef().collection('finances').add({ transactionDate: addDays(today, -n), contributorName: 'Adaeze Okafor', contributionType: 'Tithe', amount: 15000 });
  }, nos[0]);
  // Backfill: an older member saved before Phase 7 (no directory doc), written the old way.
  await page.evaluate(async () => {
    const cRef = counterRef();
    await db.runTransaction(async t => {
      const n = (await t.get(cRef)).data().mbr + 1, id = numberFor('MBR-', n);
      t.update(cRef, { mbr: n });
      t.set(parishRef().collection('members').doc(id), { memberNo: id, fullName: 'Grace Old-Record', nameLower: 'grace old-record', gender: 'Female', maritalStatus: 'Widowed',
        address: 'SECRET ADDRESS 2', phone: '0805', phoneDigits: '0805', email: '', rank: 'Sister', occupation: 'Retired Teacher', dobDay: 1, dobMonth: 1, dobYear: 1950,
        anointDay: null, anointMonth: null, anointYear: null, nokName: 'SECRET KIN 2', nokAddress: '', nokPhone: '', photo: '', important: false, status: 'Active',
        consentGiven: true, consentDate: localToday(), createdAt: nowIso(), updatedAt: nowIso() });
    });
  });
  assert.equal(await page.evaluate(async () => (await db.collection('directory').where('parishId', '==', localState.currentParishId).get()).size), 2);
  await logout();
  await login('ikeja@test.local');                       // opening the app backfills + refreshes
  await page.waitForFunction(() => !!localState.dirSync);
  await page.evaluate(() => localState.dirSync);
  const own = await page.evaluate(async () => (await db.collection('directory').where('parishId', '==', localState.currentParishId).get()).docs.map(d => d.data()));
  assert.equal(own.length, 3, 'backfill wrote the missing directory doc');
  const ada = own.find(x => x.fullName === 'Adaeze Okafor');
  assert.equal(ada.attendance.streak, 3); assert.equal(ada.giving.regular, true); assert.equal(ada.departments[0].role, 'Soprano lead');
  for (const k of ['address', 'nokName', 'nokAddress', 'dobYear', 'dobDay', 'maritalStatus', 'email']) assert.ok(!(k in ada), 'no private field ' + k);
  await shot('p7-01-parish-dashboard-after-backfill');
  await logout();

  // ---- Parish B: one member; cannot read Parish A's directory entries.
  await claim('london@test.local', codeB);
  await addPerson('members', { name: 'Adebayo Williams', gender: 'Male', rank: 'Brother', occupation: 'Software Engineer', phone: '07700900001' });
  const bRead = await page.evaluate(async (pid) => Promise.all([
    db.collection('directory').where('parishId', '==', pid).get().then(() => 'READ', e => e.code),
    db.collection('directory').get().then(() => 'READ', e => e.code)]), ada.parishId);
  assert.deepEqual(bRead, ['permission-denied', 'permission-denied']);
  await logout();

  // ---- Unnamed Super Admin: no HQ staff, no committees.
  await login('unnamed@test.local');
  await nav('staff');
  await page.waitForSelector('#st_nameBox:not(.hidden)');
  const unnamed = await page.evaluate(async () => Promise.all(['hqStaff', 'committees'].map(c => db.collection(c).get().then(() => 'READ', e => e.code))));
  assert.deepEqual(unnamed, ['permission-denied', 'permission-denied']);
  await shot('p7-02-unnamed-super-blocked');
  await logout();

  // ---- Named Super Admin: directory.
  await login('bayo@test.local');
  await nav('directory');
  await page.waitForFunction(() => document.querySelectorAll('#dir_list .dir-row').length === 4);
  await shot('p7-03-directory-all');
  const search = async (by, q, n) => { await page.selectOption('#dir_by', by); await page.fill('#dir_q', q);
    await page.waitForFunction(([n, by, q]) => { const rows = [...document.querySelectorAll('#dir_list .dir-row')];
      return rows.length === n && (by !== 'name' || rows.every(r => r.textContent.toLowerCase().includes(q))); }, [n, by, q]); };
  await search('name', 'ad', 2);
  await search('occupation', 'software', 1);
  await search('city', 'london', 1);
  await search('rank', 'Leader', 1);
  await search('parish', 'ikeja', 3);
  await shot('p7-04-directory-search-parish');
  await search('name', 'adaeze', 1);
  await page.click('#dir_list .dir-row');
  await page.waitForSelector('#dirModal:not(.hidden)');
  const card = await page.textContent('#dirBody');
  assert.match(card, /Soprano lead/); assert.match(card, /best run 3/); assert.match(card, /Regular giver: Yes/); assert.match(card, /Elder Sister/); assert.match(card, /Civil Engineer/);
  assert.ok(!/SECRET/.test(card), 'no address / next of kin on the card');
  await fullShot('p7-05-directory-participation');
  await page.click('#dirModal button[aria-label="Close"]');

  // ---- Committees.
  await nav('committees');
  await page.click('#newCmtBtn');
  await page.fill('#cf_name', 'Harvest 2027 Planning'); await page.fill('#cf_purpose', 'Plan the 2027 world harvest');
  await page.fill('#cf_duties', 'Budget\nVenue\nProgramme'); await page.fill('#cf_start', '2026-11-01'); await page.fill('#cf_end', '2027-10-31');
  await fullShot('p7-06-committee-form');
  await page.click('#saveCmtBtn');
  await page.waitForSelector('#cmtModal:not(.hidden)');
  const addCm = async (q, role, n) => { await page.selectOption('#cm_role', role); await page.fill('#cm_q', q); await page.waitForSelector('#cm_found .cm-match');
    await page.click('#cm_found .cm-match'); await page.waitForFunction(n => document.querySelectorAll('#cm_current .cm-member').length === n, n); };
  await addCm('adaeze', 'Chair', 1);
  await addCm('olumide', 'Secretary', 2);   // clergy may join committees
  await addCm('adebayo', 'Member', 3);       // a member from another parish
  assert.match(await page.textContent('#cm_current'), /CLG/);
  await fullShot('p7-07-committee-members');
  // Remove Adebayo: kept as a former member.
  await page.locator('#cm_current .cm-member', { hasText: 'Adebayo' }).locator('button', { hasText: 'Remove' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#cm_former .cm-member').length === 1);
  await fullShot('p7-08-committee-former-kept');
  await page.click('#cmtModal button[aria-label="Close"]');
  // Directory "committees served" updated.
  await nav('directory'); await search('name', 'adebayo', 1);
  await page.click('#dir_list .dir-row'); await page.waitForSelector('#dirModal:not(.hidden) .dir-cmt');
  assert.match(await page.textContent('#dirBody'), /Harvest 2027 Planning · Member \(Former/);
  await page.click('#dirModal button[aria-label="Close"]');
  await search('name', 'adaeze', 1);
  await page.click('#dir_list .dir-row'); await page.waitForSelector('#dirModal:not(.hidden) .dir-cmt');
  assert.match(await page.textContent('#dirBody'), /Harvest 2027 Planning · Chair \(Current/);
  await fullShot('p7-09-directory-committees-served');
  await page.click('#dirModal button[aria-label="Close"]');

  // ---- HQ Staff.
  await nav('staff');
  await page.waitForSelector('#st_nameBox.hidden', { state: 'attached' });
  const addStaff = async (s) => {
    await page.click('#addStaffBtn');
    await page.fill('#sf_name', s.name); await page.fill('#sf_dept', s.dept); await page.fill('#sf_title', s.title); await page.fill('#sf_grade', s.grade);
    await page.fill('#sf_phone', '0809'); await page.selectOption('#sf_category', s.cat);
    if (s.link) { await page.fill('#sf_linkQ', s.link); await page.waitForSelector('#sf_linkFound .link-opt'); await page.click('#sf_linkFound .link-opt'); }
    if (s.dob) await page.fill('#sf_dob', s.dob);
    await page.fill('#sf_employed', s.employed);
    if (s.photo) { await page.setInputFiles('#sf_photo', await makeImage('KA', '#7c2d12')); await page.waitForSelector('#sf_photoPreview:not(.hidden)'); }
    await page.check('#sf_consent');
    if (s.shot) await fullShot(s.shot);
    await page.click('#saveStaffBtn');
    await page.waitForSelector('#staffModal:not(.hidden)');
    return (await page.textContent('#staffTitle')).trim();
  };
  const y = new Date().getFullYear();
  const s1 = await addStaff({ name: 'Kemi Adesanya', dept: 'Finance', title: 'Accountant', grade: 'GL-08', cat: 'member', link: 'tunde', dob: `${y - 60}-06-15`, employed: '2008-02-01', photo: true, shot: 'p7-10-staff-form' });
  assert.equal(s1, 'CCC-HQ-STF-001');
  await page.click('#staffModal button[aria-label="Close"]');
  const s2 = await addStaff({ name: 'Ven. Olumide Ajayi', dept: 'Secretariat', title: 'Chaplain', grade: 'GL-10', cat: 'clergy', link: 'olumide', dob: '1985-01-01', employed: '2019-05-01' });
  assert.equal(s2, 'CCC-HQ-STF-002');
  assert.match(await page.textContent('#staffBody'), /CCC-TIP-IKJ-CLG-001/);
  // Document upload (compressed photo) and leave.
  await page.selectOption('#sd_kind', 'Appointment letter');
  await page.setInputFiles('#sd_file', await makeImage('LETTER', '#1e3a8a'));
  await page.waitForSelector('#staffBody .file-row');
  const kb = Number((await page.textContent('#staffBody .file-row')).match(/(\d+)KB/)[1]);
  assert.ok(kb <= 250, 'document compressed to <= 250KB, got ' + kb);
  await page.selectOption('#lv_type', 'Annual'); await page.fill('#lv_from', '2026-12-01'); await page.fill('#lv_to', '2026-12-20'); await page.fill('#lv_note', 'Christmas');
  await page.click('#leaveBtn');
  await page.waitForSelector('#staffBody .leave-row');
  // Edit: transfer to another office (posting history) + status change; needs a reason; audited.
  await page.click('#staffActions button');
  await page.waitForSelector('#staffFormModal:not(.hidden)');
  await page.fill('#sf_dept', 'Pastor\'s Office'); await page.selectOption('#sf_status', 'On leave');
  d0 = dialogs.length; await page.click('#saveStaffBtn'); await page.waitForTimeout(300);
  assert.ok(dialogs.slice(d0).some(m => /reason/.test(m)));
  await page.fill('#sf_reason', 'Posted to the Pastor\'s Office; annual leave');
  await page.click('#saveStaffBtn');
  await page.waitForSelector('#staffModal:not(.hidden) .posting-row >> nth=1');
  const body = await page.textContent('#staffBody');
  assert.match(body, /On leave/); assert.match(body, /Posted to the Pastor's Office/); assert.match(body, /department: Secretariat → Pastor's Office/);
  await fullShot('p7-11-staff-record');
  await page.click('#staffModal button[aria-label="Close"]');
  await fullShot('p7-12-staff-list-reports');
  // Phase 8: CCC has no fixed retirement age; the report appears once HQ sets one.
  assert.ok(await page.locator('#st_retireBox').isHidden());
  await page.fill('#st_retireAge', '60'); await page.fill('#st_retireReason', 'Test policy'); await page.click('#st_retireSave');
  await page.waitForSelector('#st_retireBox:not(.hidden) .retire-row');
  assert.match(await page.textContent('#st_retire'), /Kemi Adesanya/);
  assert.equal(await page.locator('#st_byDept .dept-count').count(), 2);
  await page.fill('#st_q', 'chaplain');
  await page.waitForFunction(() => document.querySelectorAll('#st_list .staff-row').length === 1);
  // Action log shows Phase 7 actions by name.
  await nav('hqreturns'); await page.click('.hq-tab[data-tab="log"]'); await page.waitForSelector('#hq_log .audit-row');
  const log = await page.textContent('#hq_log');
  for (const re of [/hqStaff\/CCC-HQ-STF-002/, /committeeMembers\//, /committees\//, /hqLeave\//, /hqStaffFiles\//, /Bayo Adeyemi/]) assert.match(log, re);
  await fullShot('p7-13-action-log');
  // Nothing is ever deleted.
  const del = await page.evaluate(async () => Promise.all(['hqStaff', 'committees', 'committeeMembers', 'directory', 'hqLeave', 'hqStaffFiles']
    .map(async c => (await db.collection(c).limit(1).get()).docs[0].ref.delete().then(() => 'DELETED', e => e.code))));
  assert.deepEqual(del, Array(6).fill('permission-denied'));
  // The Super Admin still cannot read ordinary member records directly.
  const leak = await page.evaluate(async (pid) => db.collection('parishes').doc(pid).collection('members').get().then(() => 'READ', e => e.code), ada.parishId);
  assert.equal(leak, 'permission-denied');
  await logout();
  assert.deepEqual(pageErrors, [], 'no page errors');
  console.log('E2E PASS (phase 7): directory written alongside members + backfill on open, participation (dept role, streak, regular giver), no private fields, parish isolation; super search by name/occupation/city/rank/parish; committees with member chair, clergy secretary, cross-parish member, former kept, directory committees served; HQ staff numbers, photo, clergy/member links, document <=250KB, leave, posting history, audited edit with reason, dept + retirement reports; unnamed super blocked; no deletes.');
} catch (e) {
  await shot('p7-zz-failure').catch(() => {});
  console.error('E2E FAIL:', e.stack);
  console.error('dialogs:', dialogs);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
