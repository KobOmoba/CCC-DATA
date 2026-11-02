// Phase 9 (sermons, calendar, messages, public website) phone-size end-to-end test of the Parish Portal against the LOCAL Auth + Firestore
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
  let path = new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
  // Mirror vercel.json: /site -> /website
  if (path === '/site' || path === '/site/') path = '/website/index.html'; else if (path.startsWith('/site/')) path = '/website/' + path.slice(6);
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
const nav = (id) => page.click('#nav-' + id);
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
async function claimFresh(email, code) { await page.goto(APP); await claim(email, code); }

// Local calendar date n days from today, plus its day + month.
const dayPlus = n => { const d = new Date(); d.setDate(d.getDate() + n); return { iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, day: d.getDate(), month: d.getMonth() + 1 }; };
const T0 = dayPlus(0), T2 = dayPlus(2), T3 = dayPlus(3), T40 = dayPlus(40);
async function addPerson(kind, p) {
  await page.evaluate(async ([kind, p]) => {
    openPersonForm(kind);
    $('p_name').value = p.name; $('p_gender').value = p.gender; fillRanks(''); $('p_marital').value = 'Married';
    $('p_address').value = 'SECRET ADDRESS 1'; $('p_phone').value = p.phone || ''; $('p_email').value = p.email || '';
    $('p_dobDay').value = String(p.dob.day); $('p_dobMonth').value = String(p.dob.month); $('p_dobYear').value = '1980';
    if (p.wed) { $('p_wedDay').value = String(p.wed.day); $('p_wedMonth').value = String(p.wed.month); }
    $('p_nokName').value = 'SECRET KIN'; $('p_consent').checked = true;
    await savePerson();
  }, [kind, p]);
}
const stubLinks = () => page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; window.openExternal = (u) => window.__opened.push(u); });
const opened = () => page.evaluate(() => window.__opened);

try {
  const superUid = await signUp('bayo@test.local', PASS);
  await seedDoc(`users/${superUid}`, { role: 'super_admin', name: 'Bayo Adeyemi' });
  await login('bayo@test.local');
  const codeA = await createParish('TEST Ikeja Parish', 'Ikeja', 'Nigeria', 'Africa', 'NGN', 'TIP', 'IKJ', 'ikeja@test.local');
  const codeB = await createParish('TEST London Parish', 'London', 'United Kingdom', 'Europe', 'GBP', 'TLP', 'LDN', 'london@test.local');
  const [pidA] = await page.evaluate(async () => (await db.collection('parishes').get()).docs.map(d => ({ id: d.id, name: d.data().name })).sort((a, b) => a.name.localeCompare(b.name)).map(p => p.id));
  await page.evaluate(async (id) => db.collection('parishes').doc(id).update({ mapsUrl: 'https://maps.app.goo.gl/ikeja', address: 'SECRET ADDRESS PARISH' }), pidA);
  await logout();

  // ---- Parish A: people with a birthday today and a wedding anniversary in 2 days.
  await claimFresh('ikeja@test.local', codeA);
  let d0 = dialogs.length;
  await addPerson('members', { name: 'Adaeze Okafor', gender: 'Female', phone: '08030000001', email: 'ada@test.local', dob: T0 });
  await addPerson('members', { name: 'Bola Tinubu-Test', gender: 'Male', phone: '+44 7700 900123', email: 'bola@test.local', dob: T40, wed: T2 });
  await addPerson('members', { name: 'Chidi NoPhone', gender: 'Male', dob: T40 });
  await addPerson('clergy', { name: 'Olumide Ajayi', gender: 'Male', email: 'olumide@test.local', phone: '08030000003', dob: T40 });
  noFail(d0);
  const nos = await page.evaluate(async () => Object.fromEntries((await parishRef().collection('members').get()).docs.map(d => [d.data().fullName.split(' ')[0], d.id])));
  const clg = await page.evaluate(async () => (await parishRef().collection('clergy').get()).docs[0].id);
  await page.evaluate(async (list) => { await openDept('choir'); for (const no of list) await addToDept(no); }, [nos.Adaeze, nos.Bola, nos.Chidi]);
  noFail(d0);

  // ---- 2b. Dashboard card: this week.
  await logout(); await login('ikeja@test.local');
  await page.waitForSelector('#weekCard:not(.hidden)');
  const wk = await page.textContent('#weekCard');
  assert.match(wk, /Birthdays \(1\)[\s\S]*Adaeze Okafor/);
  assert.match(wk, /Wedding anniversaries \(1\)[\s\S]*Bola Tinubu-Test/);
  assert.match(wk, /Services \(\d+\)/);
  await page.locator('#weekCard').scrollIntoViewIfNeeded();
  await page.locator('#weekCard').screenshot({ path: join(SHOTS, 'p9-01-dashboard-this-week.png') });

  // ---- 2. Calendar: timetable auto-filled; add a harvest with volunteer slots; assign a member.
  await nav('calendar');
  await page.waitForSelector('#cal_body .cal-day');
  await page.click(`#cal_body .cal-day >> nth=${T0.day - 1}`);
  await shot('p9-02-calendar-month');
  await page.click('#addEventBtn');
  await page.fill('#ev_title', 'Harvest Thanksgiving 2026'); await page.selectOption('#ev_kind', 'harvest');
  await page.fill('#ev_date', T3.iso); await page.fill('#ev_time', '10:00'); await page.fill('#ev_venue', 'Main church');
  await page.fill('#ev_slotRole', 'Ushers'); await page.fill('#ev_slotNeed', '2'); await page.click('#ev_slotAdd');
  await page.fill('#ev_slotRole', 'Choir'); await page.fill('#ev_slotNeed', '1'); await page.click('#ev_slotAdd');
  await shot('p9-03-event-form');
  await page.click('#saveEventBtn'); await modalClosed('eventModal');
  await page.click('.cal-view[data-v="list"]');
  await page.waitForSelector('#cal_body .cal-item:has-text("Harvest Thanksgiving 2026")');
  const listTxt = await page.textContent('#cal_body');
  assert.match(listTxt, /Sunday Service/); assert.match(listTxt, /Wakati Adura/); assert.match(listTxt, /3 volunteers needed/);
  await shot('p9-04-calendar-list');
  await page.click('#cal_body .cal-item:has-text("Harvest Thanksgiving 2026")');
  await page.fill('#p9Body .slot-q >> nth=0', 'adae');
  await page.waitForSelector('#slotFound0 .slot-opt'); await page.click('#slotFound0 .slot-opt');
  await page.waitForSelector('#p9Body:has-text("1/2")');
  const ev = await page.evaluate(async () => (await parishRef().collection('events').get()).docs[0].data());
  assert.equal(ev.slots[0].assigned[0].name, 'Adaeze Okafor');
  await shot('p9-05-event-volunteers');
  await page.click('#p9Modal footer button:has-text("Close")');

  // ---- 1. Sermons: preacher by clergy number, link not file, share church-wide, search.
  await nav('sermons');
  await page.click('#addSermonBtn');
  await page.fill('#sm_title', 'Walk in the Light'); await page.fill('#sm_preacher', clg); await page.fill('#sm_date', T0.iso);
  await page.fill('#sm_scripture', 'John 8:12'); await page.fill('#sm_tags', 'Faith, #light');
  await page.fill('#sm_media', 'http://not-secure.example'); d0 = dialogs.length;
  await page.click('#saveSermonBtn');
  assert.ok(dialogs.slice(d0).some(m => /https:\/\//.test(m)), 'http link refused');
  await page.fill('#sm_media', 'https://youtu.be/dQw4w9WgXcQ'); await page.fill('#sm_text', 'Beloved in Christ, walk in the light as He is in the light.');
  await page.check('#sm_shared');
  await page.click('#saveSermonBtn'); await modalClosed('sermonModal');
  await page.click('#addSermonBtn');
  await page.fill('#sm_title', 'Parish Only Notes'); await page.fill('#sm_preacher', 'Elder Visiting Preacher'); await page.fill('#sm_date', '2026-01-04');
  await page.fill('#sm_tags', 'healing'); await page.click('#saveSermonBtn'); await modalClosed('sermonModal');
  await page.waitForSelector('#sm_list .sm-row >> nth=1');
  const s1 = await page.evaluate(async () => (await parishRef().collection('sermons').where('shared', '==', true).get()).docs[0].data());
  assert.equal(s1.preacher, 'Olumide Ajayi'); assert.deepEqual(s1.tags, ['faith', 'light']);
  for (const [q, n] of [['#faith', 1], ['olumide', 1], ['2026-01', 1], ['light', 1], ['zzz', 0], ['', 2]]) {
    await page.fill('#sm_q', q); await page.dispatchEvent('#sm_q', 'input');
    assert.equal(await page.locator('#sm_list .sm-row').count(), n, 'search ' + q);
  }
  await page.fill('#sm_q', ''); await page.dispatchEvent('#sm_q', 'input');
  await shot('p9-06-sermon-library');
  await page.click('#sm_list .sm-row:has-text("Walk in the Light")');
  assert.match(await page.textContent('#p9Body'), /Watch \/ listen \(YouTube\)/);
  await shot('p9-07-sermon-view');
  await page.click('#p9Modal footer button:has-text("Close")');

  // ---- 3. Messages: "Wish" from the dashboard -> birthday template -> wa.me queue; log has no content.
  await nav('dashboard');
  await page.click('#weekCard .wish-btn >> nth=0');
  await page.waitForSelector('#section-messages:not(.hidden) .msg-chip');
  assert.equal(await page.inputValue('#msg_tpl'), 'birthday');
  assert.match(await page.textContent('#msg_preview'), /Happy birthday, Adaeze Okafor! The whole family of TEST Ikeja Parish/);
  await stubLinks();
  await page.click('#msg_start');
  await page.waitForSelector('#waSendBtn');
  await shot('p9-08-whatsapp-queue');
  await page.click('#waSendBtn');
  await page.waitForSelector('#msg_queue:has-text("Done: 1")');
  let urls = await opened();
  assert.match(urls[0], /^https:\/\/wa\.me\/2348030000001\?text=Happy%20birthday%2C%20Adaeze%20Okafor/);
  // A whole unit: Chidi has no phone (skipped); Bola's +44 number kept as is.
  await page.evaluate(() => { msg.recipients = []; renderRecipients(); });
  await page.selectOption('#msg_tpl', 'general');
  await page.fill('#msg_text', 'Dear {name}, choir rehearsal is on Saturday at {parish}.'); await page.dispatchEvent('#msg_text', 'input');
  await page.selectOption('#msg_unit', 'choir'); await page.click('#msg_unitBtn');
  await page.waitForSelector('#msg_recips .msg-chip >> nth=2');
  assert.match(await page.textContent('#msg_count'), /3 recipient\(s\) · 1 without a phone/);
  await page.click('#msg_start');
  await page.click('#waSendBtn'); await page.waitForSelector('#msg_queue:has-text("2 of 2")');
  await shot('p9-09-whatsapp-next');
  await page.click('#waSendBtn'); await page.waitForSelector('#msg_queue:has-text("Done: 2")');
  urls = await opened();
  assert.equal(urls.length, 3); assert.match(urls[2], /^https:\/\/wa\.me\/447700900123\?text=Dear%20Bola/);
  // Email: BCC batch, {name} -> Beloved.
  await page.click('.msg-ch[data-c="email"]');
  await page.click('#msg_start');
  await page.click('#mailBatch0'); await page.waitForSelector('#mailBatch0:has-text("opened")');
  urls = await opened();
  assert.match(urls[3], /^mailto:\?bcc=ada%40test\.local%2Cbola%40test\.local&subject=General/);
  assert.match(decodeURIComponent(urls[3]), /Dear Beloved, choir rehearsal/);
  await page.waitForFunction(() => document.querySelectorAll('#msg_log .msg-log-row').length === 5);
  await shot('p9-10-messages-log');
  const logs = await page.evaluate(async () => (await parishRef().collection('messageLog').get()).docs.map(d => d.data()));
  assert.equal(logs.length, 5);
  for (const l of logs) assert.deepEqual(Object.keys(l).sort(), ['at', 'by', 'channel', 'name', 'template', 'to']);
  await logout();

  // ---- Parish B sees the shared sermon only (not A's private one).
  await claimFresh('london@test.local', codeB);
  await nav('sermons');
  await page.click('.sm-tab[data-tab="shared"]');
  await page.waitForSelector('#sm_list .sm-row');
  const shared = await page.textContent('#sm_list');
  assert.match(shared, /Walk in the Light[\s\S]*TEST Ikeja Parish/); assert.doesNotMatch(shared, /Parish Only Notes/);
  await shot('p9-11-parish-b-church-wide-sermons');
  await logout();

  // ---- 4. Super Admin: church-wide sermons, publish parish + event + sermon to the website.
  await login('bayo@test.local');
  await nav('sermonsAll');
  await page.waitForSelector('#sm_list .sm-row');
  await page.click('#sm_list .sm-row');
  await page.click('#pubSermonBtn'); await page.waitForSelector('#pubSermonBtn:has-text("On the website")');
  await page.click('#p9Modal footer button:has-text("Close")');
  await nav('website');
  await page.waitForSelector('#web_parishes .web-row');
  await page.click(`#web_${pidA} .pub-btn`);
  await page.waitForSelector(`#web_${pidA}:has-text("Live")`);
  await page.fill('#we_title', 'Annual Lagos Crusade'); await page.fill('#we_date', T3.iso); await page.fill('#we_time', '16:00');
  await page.fill('#we_venue', 'Teslim Balogun Stadium'); await page.fill('#we_city', 'Lagos'); await page.click('#we_add');
  await page.waitForSelector('#web_events:has-text("Annual Lagos Crusade")');
  await fullShot('p9-12-super-website');
  const pub = await page.evaluate(async (id) => (await db.collection('publicParishes').doc(id).get()).data(), pidA);
  assert.deepEqual(Object.keys(pub).sort(), ['city', 'cityLower', 'country', 'countryLower', 'mapsUrl', 'name', 'nameLower', 'services', 'updatedAt']);
  await logout();

  // ---- 5. Change parish admin: keep the old admin until the new one claims; then revoke (audited).
  await login('bayo@test.local');
  await nav('parishes');
  await page.click('#parishList .chg-admin >> nth=' + (await page.evaluate((id) => [...document.querySelectorAll('#parishList .chg-admin')].findIndex(b => b.getAttribute('onclick').includes(id)), pidA)));
  await page.fill('#ho_email', 'newikeja@test.local'); await page.fill('#ho_reason', 'Real parish secretary appointed');
  await page.click('#ho_btn'); await page.waitForSelector('#ho_code');
  const hoCode = (await page.textContent('#ho_code')).trim();
  await shot('p9-18-change-admin');
  await logout();
  await claimFresh('newikeja@test.local', hoCode);
  assert.match(await page.textContent('#welcomeTitle'), /^Halleluyah, TEST Ikeja Parish!/);
  await logout();
  await login('ikeja@test.local');                       // still works during the handover
  await logout();
  await login('bayo@test.local');
  assert.match(await page.textContent('#welcomeTitle'), /Halleluyah, Super Admin!/);
  await nav('parishes');
  for (let i = 0; i < 40 && !(await page.evaluate(async () => (await db.collection('adminHandovers').where('status', '==', 'Completed').get()).size === 1)); i++) await page.waitForTimeout(250);
  const audits = await page.evaluate(async () => (await db.collection('auditLog').get()).docs.map(d => d.data()).filter(a => a.target.startsWith('adminHandovers/')).map(a => a.action).sort());
  assert.deepEqual(audits, ['admin-handover-complete', 'admin-handover-start']);
  await logout();
  d0 = dialogs.length;
  await page.goto(APP); await page.fill('#loginEmail', 'ikeja@test.local'); await page.fill('#loginPassword', PASS); await page.click('#accessBtn');
  await page.waitForTimeout(1500);
  assert.ok(dialogs.slice(d0).some(m => /handed over to a new admin/.test(m)), 'old admin told and signed out');
  assert.ok(await page.locator('#mainApp').isHidden());

  // ---- 4b. Public website (no login), served at /site like vercel.json.
  const SITE = 'http://127.0.0.1:5058/site/';
  await page.goto(SITE + '?emulator=1');
  await page.waitForSelector('#events .ev');
  assert.match(await page.textContent('#events'), /Annual Lagos Crusade/);
  await fullShot('p9-13-site-home');
  for (const f of ['about', 'services', 'contact', 'privacy']) { await page.goto(SITE + f + '.html?emulator=1'); await page.waitForSelector('header.top'); await fullShot('p9-14-site-' + f); }
  await page.goto(SITE + 'parishes.html?emulator=1');
  await page.waitForSelector('#results .parish');
  let txt = await page.textContent('#results');
  assert.match(txt, /TEST Ikeja Parish[\s\S]*Ikeja, Nigeria/); assert.doesNotMatch(txt, /London/); assert.doesNotMatch(txt, /SECRET/);
  await page.fill('#q', 'nige'); await page.waitForTimeout(800);
  assert.match(await page.textContent('#results'), /TEST Ikeja Parish/);
  await page.fill('#q', 'zzz'); await page.waitForSelector('#results:has-text("No parish found")');
  await page.fill('#q', 'ike'); await page.waitForSelector('#results .parish');
  await page.click('#results details summary');
  await fullShot('p9-15-site-find-parish');
  await page.goto(SITE + 'events.html?emulator=1'); await page.waitForSelector('#events .ev'); await fullShot('p9-16-site-events');
  await page.goto(SITE + 'sermons.html?emulator=1'); await page.waitForSelector('#sermons .sermon');
  assert.match(await page.textContent('#sermons'), /Walk in the Light[\s\S]*Olumide Ajayi/);
  await fullShot('p9-17-site-sermons');
  // No horizontal scroll at 390px on the public pages.
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'no horizontal scroll');
  // Private data stays closed to an anonymous visitor.
  for (const path of [`parishes/${pidA}`, `parishStats/${pidA}`, 'sharedSermons', `parishes/${pidA}/sermons`]) {
    const r = await fetch(`${FS}/${path}`);
    assert.equal(r.status, 403, 'anonymous read refused: ' + path);
  }
  assert.deepEqual(pageErrors, [], 'no page errors');
  console.log('E2E PHASE 9 PASSED');
} catch (e) {
  console.error('E2E FAILED', e);
  await page.screenshot({ path: join(SHOTS, 'p9-zz-failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
