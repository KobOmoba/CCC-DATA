// CCC AI data entry — Cloudflare Worker "ccc-ai" (v1, Nov 2026).
// Modelled on the EduBloom OCR worker (bloom-portal/ocr-worker/worker.js).
// Reads a member list (text, photo or scanned PDF) and returns people in the exact member-form fields.
// Secrets: GEMINI_API_KEY (required), GROQ_API_KEY (optional backup, images/text only).
// Optional secret ACCURACY_TEST_KEY: lets a one-off accuracy test skip the Firebase login. Delete it after the test.
// Route: POST /extract  JSON {text} or {file: <base64>, mime}
// Route: POST /summary  JSON {totals}: counts only (Phase 8). Returns {text}: a short plain-language summary of the month's alerts.
// Cron Trigger (Phase 8): daily church-wide checks -> parishMonthly, statsRollups, alerts (+ audit) in Firestore via the REST API.
//   Needs secret FIREBASE_SERVICE_ACCOUNT (service-account JSON with Cloud Datastore User role). Without it the job does nothing.
// Header: Authorization: Bearer <Firebase ID token of project ccc-data-aarinat>

import './alerts-core.js'; // symlink to ../alerts-core.js (shared with the browser)
const FIREBASE_PROJECT = 'ccc-data-aarinat';
const ALLOWED = ['https://kobomoba.github.io', 'https://ccc-parish-portal.vercel.app', 'http://127.0.0.1:5055', 'http://localhost:5055'];
// Vercel preview deployments of the same project and team only.
const PREVIEW = /^https:\/\/ccc-parish-portal-[a-z0-9-]+-aadesanya173-gmailcoms-projects\.vercel\.app$/;
const allowedOrigin = o => ALLOWED.includes(o) || PREVIEW.test(o);
const GEMINI_MODELS = ['gemini-3-flash-preview', 'gemini-3.8-flash', 'gemini-flash-latest'];
const GROQ_MODEL = 'qwen/qwen3.8-27b';
const MAX_FILE_CHARS = 8_000_000; // ~6 MB
const MAX_TEXT_CHARS = 60_000;
const RATE = { perMinute: 6, perDay: 200 }; // per signed-in user, per worker instance

const RANKS_M = ["Brother", "Elder Brother", "Cape Elder Brother", "Full Elder Brother", "Senior Elder Brother",
  "Superior Senior Elder Brother", "Assistant Leader", "Leader", "Senior Leader", "Superior Senior Leader",
  "Honorary Assistant Evangelist", "Assistant Evangelist", "Honorary Evangelist", "Evangelist",
  "Honorary Senior Evangelist", "Senior Evangelist", "Special Most Senior Evangelist", "Most Senior Evangelist",
  "Special Venerable Most Senior Evangelist", "Venerable Most Senior Evangelist", "Assistant Superior Evangelist",
  "Superior Evangelist", "Assistant Venerable Superior Evangelist", "Venerable Superior Evangelist",
  "Assistant Most Superior Evangelist", "Most Superior Evangelist", "Supreme Evangelist", "Pastor Reverend"];
const RANKS_F = ["Sister", "Elder Sister", "Cape Elder Sister", "Senior Elder Sister", "Lace Elder Sister / Lace Senior Elder Sister",
  "Superior Senior Elder Sister", "Lace Superior Senior Elder Sister", "Assistant Mother Celestial", "Mother Celestial"];
const MARITAL = ['Single', 'Married', 'Widowed', 'Divorced', 'Separated'];

const PROMPT = 'This is a member list from a Nigerian Celestial Church of Christ parish (typed, a table, or a photo of a '
  + 'handwritten/printed page). Find EVERY person. Most names are Yoruba: copy each name EXACTLY as written, never correct '
  + 'or swap it. Return JSON only: {"people":[{"fullName":"","gender":"Male|Female|","maritalStatus":"Single|Married|Widowed|Divorced|Separated|",'
  + '"address":"","phone":"","email":"","rank":"","occupation":"","dobDay":null,"dobMonth":null,"dobYear":null,'
  + '"anointDay":null,"anointMonth":null,"anointYear":null,"nokName":"","nokAddress":"","nokPhone":""}]}. '
  + 'Rules: use "" or null when a field is not written; never invent data. Dates: day and month as numbers (month 1-12), year only if written. '
  + '"Last anointment" goes in anoint*. Gender: from the list, from a title (Bro/Brother/Mr = Male, Sis/Sister/Mrs/Mother/Mama = Female) or from the rank. '
  + 'rank must be copied as one of these church ranks if one is written. Male: ' + RANKS_M.join('; ')
  + '. Female: ' + RANKS_F.join('; ') + '. Next of kin = nok*.';

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(origin) ? origin : ALLOWED[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}
const json = (obj, status, origin) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });

// ---------- Firebase ID token check (RS256, Google's public keys, cached) ----------
let jwks = { keys: null, until: 0 };
const b64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function googleKeys() {
  if (jwks.keys && Date.now() < jwks.until) return jwks.keys;
  const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!r.ok) throw new Error('key fetch ' + r.status);
  const maxAge = Number((r.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  jwks = { keys: (await r.json()).keys, until: Date.now() + maxAge * 1000 };
  return jwks.keys;
}
async function verifyIdToken(token) {
  const [h, p, sig] = String(token).split('.');
  if (!sig) throw new Error('malformed token');
  const header = JSON.parse(new TextDecoder().decode(b64url(h)));
  const claims = JSON.parse(new TextDecoder().decode(b64url(p)));
  if (header.alg !== 'RS256') throw new Error('bad alg');
  const jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('unknown key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(h + '.' + p));
  const now = Date.now() / 1000;
  if (!ok) throw new Error('bad signature');
  if (claims.aud !== FIREBASE_PROJECT || claims.iss !== 'https://securetoken.google.com/' + FIREBASE_PROJECT) throw new Error('wrong project');
  if (!(claims.exp > now) || !(claims.iat < now + 300) || !claims.sub) throw new Error('expired');
  return claims.sub;
}

// ---------- simple rate limit (per isolate; good enough to stop a runaway loop) ----------
const hits = new Map();
function limited(uid) {
  const now = Date.now(), h = (hits.get(uid) || []).filter(t => now - t < 86_400_000);
  const lastMin = h.filter(t => now - t < 60_000).length;
  if (lastMin >= RATE.perMinute || h.length >= RATE.perDay) { hits.set(uid, h); return true; }
  h.push(now); hits.set(uid, h); return false;
}

function parseJSON(text) {
  const t = String(text || '');
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('no JSON in reply');
  return JSON.parse(t.slice(s, e + 1));
}

async function callGemini(env, input) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const parts = [{ text: PROMPT }];
  if (input.text) parts.push({ text: 'THE LIST:\n' + input.text });
  else parts.push({ inline_data: { mime_type: input.mime, data: input.file } });
  let last = 'no model tried';
  const attempts = [...GEMINI_MODELS, ...GEMINI_MODELS];
  for (let i = 0; i < attempts.length; i++) {
    const model = attempts[i];
    if (i === GEMINI_MODELS.length) await new Promise(r => setTimeout(r, 2500));
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
    });
    if (r.ok) {
      const d = await r.json();
      const out = d?.candidates?.[0]?.content?.parts || [];
      return { data: parseJSON(out.map(p => p.text || '').join('')), engine: model };
    }
    last = model + ' ' + r.status;
    if (![429, 500, 503, 404].includes(r.status)) break;
  }
  throw new Error('Gemini failed: ' + last);
}

async function callGroq(env, input) {
  if (!env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
  if (input.mime === 'application/pdf') throw new Error('Groq cannot read PDF');
  const content = input.text ? [{ type: 'text', text: PROMPT + '\n\nTHE LIST:\n' + input.text }]
    : [{ type: 'image_url', image_url: { url: `data:${input.mime};base64,${input.file}` } }, { type: 'text', text: PROMPT }];
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.GROQ_API_KEY },
    body: JSON.stringify({ model: GROQ_MODEL, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'user', content }] }),
  });
  if (!r.ok) throw new Error('Groq ' + r.status);
  const d = await r.json();
  return { data: parseJSON(d?.choices?.[0]?.message?.content), engine: GROQ_MODEL };
}
const ENGINES = [callGemini, callGroq];

// ---------- clean the AI reply into exactly the member-form fields ----------
const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const intIn = (v, lo, hi) => { const n = parseInt(v, 10); return n >= lo && n <= hi ? n : null; };
const norm = s => s.toLowerCase().replace(/[^a-z]/g, '');
function cleanPerson(x) {
  const g = /^m/i.test(x.gender || '') ? 'Male' : /^f/i.test(x.gender || '') ? 'Female' : '';
  const rawRank = str(x.rank, 80);
  const findIn = list => list.find(r => norm(r) === norm(rawRank) || r.split(' / ').some(a => norm(a) === norm(rawRank)));
  let gender = g, rank = '';
  if (rawRank) {
    rank = findIn(g === 'Female' ? RANKS_F : g === 'Male' ? RANKS_M : [...RANKS_M, ...RANKS_F]) || '';
    if (rank && !gender) gender = RANKS_F.includes(rank) ? 'Female' : 'Male';
  }
  const marital = MARITAL.find(m => norm(m) === norm(str(x.maritalStatus, 20))) || '';
  const yr = new Date().getFullYear();
  return {
    fullName: str(x.fullName, 120), gender, maritalStatus: marital, address: str(x.address, 200),
    phone: str(x.phone, 20), email: str(x.email, 120).toLowerCase(), rank, rankAsWritten: rank ? '' : rawRank,
    occupation: str(x.occupation, 80),
    dobDay: intIn(x.dobDay, 1, 31), dobMonth: intIn(x.dobMonth, 1, 12), dobYear: intIn(x.dobYear, 1900, yr),
    anointDay: intIn(x.anointDay, 1, 31), anointMonth: intIn(x.anointMonth, 1, 12), anointYear: intIn(x.anointYear, 1900, yr),
    nokName: str(x.nokName, 120), nokAddress: str(x.nokAddress, 200), nokPhone: str(x.nokPhone, 20),
  };
}

// ---------- Phase 8: AI summary (totals only) ----------
// Keeps only numbers under short label keys (alert types, countries, world totals). Every string VALUE is dropped,
// so a name can never reach the AI even if a client sends one.
const KEY_OK = /^[A-Za-z0-9 _.,'()%+\/-]{1,60}$/;
function cleanTotals(t, depth = 0) {
  const out = {};
  if (!t || typeof t !== 'object' || Array.isArray(t)) return out;
  for (const [k, v] of Object.entries(t).slice(0, 120)) {
    if (!KEY_OK.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (depth < 2 && v && typeof v === 'object') out[k] = cleanTotals(v, depth + 1);
    else if (k === 'month' && typeof v === 'string' && /^[A-Za-z]+ \d{4}$/.test(v)) out[k] = v;
  }
  return out;
}
const SUMMARY_PROMPT = 'You help the HQ of the Celestial Church of Christ, a worldwide church. Below are ONLY totals for one month: '
  + 'counts of automatic alerts by type and by country, and church-wide totals. Write 3 to 5 short, plain sentences for a busy '
  + 'church leader reading on a phone: what stands out, where to look first, and one practical next step. Be neutral and factual; '
  + 'do not invent numbers or names; do not take sides in any leadership matter. Plain text, no lists, no markdown. Totals: ';
async function summarize(env, totals) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const body = JSON.stringify({ contents: [{ parts: [{ text: SUMMARY_PROMPT + JSON.stringify(totals) }] }], generationConfig: { temperature: 0.2 } });
  let last = '';
  for (const model of GEMINI_MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body });
    if (r.ok) {
      const d = await r.json();
      const text = (d?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
      if (text) return { text: text.slice(0, 2000), engine: model };
    }
    last = model + ' ' + r.status;
  }
  throw new Error('Gemini failed: ' + last);
}

// ---------- Phase 8: scheduled church-wide checks (Firestore REST + service account) ----------
async function saToken(sa) {
  const enc = o => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  const jwt = unsigned + '.' + btoa(String.fromCharCode(...sig)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt });
  if (!r.ok) throw new Error('token ' + r.status);
  return (await r.json()).access_token;
}
const fromValue = v => 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue
  : 'booleanValue' in v ? v.booleanValue : 'nullValue' in v ? null : 'timestampValue' in v ? v.timestampValue
  : 'mapValue' in v ? fromFields(v.mapValue.fields || {}) : 'arrayValue' in v ? (v.arrayValue.values || []).map(fromValue) : null;
const fromFields = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)]));
const toValue = v => v === null || v === undefined ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'string' ? { stringValue: v }
  : Array.isArray(v) ? { arrayValue: { values: v.map(toValue) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };

// Firestore REST client. In tests, env.FIRESTORE_EMULATOR_HOST points it at the local emulator (no credential needed).
async function firestore(env) {
  const project = env.FIRESTORE_PROJECT || FIREBASE_PROJECT;
  const emu = env.FIRESTORE_EMULATOR_HOST;
  const root = `${emu ? 'http://' + emu : 'https://firestore.googleapis.com'}/v1/projects/${project}/databases/(default)/documents`;
  const token = emu ? 'owner' : await saToken(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT));
  const call = async (url, init = {}) => {
    const r = await fetch(url, { ...init, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
    if (!r.ok) throw new Error(`firestore ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };
  const name = d => d.name.split('/documents/')[1];
  return {
    root,
    async list(col) {
      const out = []; let page = '';
      do {
        const d = await call(`${root}/${col}?pageSize=300${page ? '&pageToken=' + page : ''}`);
        (d.documents || []).forEach(x => out.push({ id: name(x).split('/').pop(), ...fromFields(x.fields || {}) }));
        page = d.nextPageToken || '';
      } while (page);
      return out;
    },
    async query(col, field, op, value) {
      const rows = await call(`${root}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: col }],
        where: { fieldFilter: { field: { fieldPath: field }, op, value: toValue(value) } } } }) });
      return rows.filter(x => x.document).map(x => ({ id: name(x.document).split('/').pop(), ...fromFields(x.document.fields || {}) }));
    },
    async commit(writes) {
      for (let i = 0; i < writes.length; i += 400) {
        await call(`${root}:commit`, { method: 'POST', body: JSON.stringify({ writes: writes.slice(i, i + 400).map(([path, data, serverAt]) => ({
          update: { name: `projects/${project}/databases/(default)/documents/${path}`, fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)])) },
          ...(serverAt ? { updateTransforms: [{ fieldPath: serverAt, setToServerValue: 'REQUEST_TIME' }] } : {}) })) }) });
      }
    },
  };
}

// The daily job: same AlertsCore functions as the browser fallback. Returns counts (logged by the Cron Trigger).
async function runChecks(env, today = new Date().toISOString().slice(0, 10)) {
  if (!env.FIREBASE_SERVICE_ACCOUNT && !env.FIRESTORE_EMULATOR_HOST) return { skipped: 'FIREBASE_SERVICE_ACCOUNT not set' };
  const A = globalThis.AlertsCore, fs = await firestore(env), m = today.slice(0, 7), lm = A.addMonths(m, -1), now = new Date().toISOString();
  const [parishes, stats, rets, snaps, al1, al2] = await Promise.all([fs.list('parishes'), fs.list('parishStats'),
    fs.query('returns', 'month', 'GREATER_THAN_OR_EQUAL', A.addMonths(m, -7)), fs.query('parishMonthly', 'month', 'GREATER_THAN_OR_EQUAL', A.addMonths(m, -5)),
    fs.query('alerts', 'month', 'EQUAL', m), fs.query('alerts', 'month', 'EQUAL', lm)]);
  const plist = parishes.map(({ logo, ...p }) => p);
  const st = Object.fromEntries(stats.map(s => [s.id, s]));
  const byParish = {}, sn = {};
  rets.forEach(r => { (byParish[r.parishId] ||= {})[r.month] = r; });
  snaps.forEach(s => { (sn[s.parishId] ||= {})[s.month] = s; });
  const nowSnap = {}, prevSnap = {};
  plist.forEach(p => { nowSnap[p.id] = A.snapshot(p, st[p.id], m, now); (sn[p.id] ||= {})[m] = nowSnap[p.id]; if (sn[p.id][lm]) prevSnap[p.id] = sn[p.id][lm]; });
  const filed = new Set(plist.filter(p => byParish[p.id]?.[lm]).map(p => p.id));
  const roll = A.rollups(m, plist, nowSnap, prevSnap, filed, now);
  const found = [...A.returnAlerts(lm, plist, byParish, today).map(a => ({ ...a, month: lm })), ...A.statsAlerts(m, plist, sn, today).map(a => ({ ...a, month: m }))];
  const existing = new Set([...al1, ...al2].map(a => a.id));
  const fresh = found.filter(a => !existing.has(`${a.month}_${a.parishId}_${a.rule}`));
  const writes = [
    ...plist.map(p => [`parishMonthly/${p.id}_${m}`, nowSnap[p.id]]),
    ...Object.entries(roll).map(([id, r]) => [`statsRollups/${id}`, r]),
  ];
  for (const a of fresh) {
    const id = `${a.month}_${a.parishId}_${a.rule}`;
    writes.push([`alerts/${id}`, { ...a, detail: a.detail.slice(0, 300), status: 'Open', version: 1, at: now, by: 'server-job' }]);
    writes.push([`auditLog/alerts_${id}_v1`, { action: 'alert', target: 'alerts/' + id, targetVersion: 1, parishId: '', reason: '', before: null,
      after: { rule: a.rule, parishId: a.parishId }, by: 'server-job', byEmail: '', byName: 'Scheduled check', role: 'server' }, 'at']);
  }
  await fs.commit(writes);
  // AI summary of this month's alerts, from totals only.
  let summary = 'skipped';
  if (env.GEMINI_API_KEY) {
    try {
      const country = Object.fromEntries(plist.map(p => [p.id, p.country || 'Unknown']));
      const all = [...found, ...[...al1, ...al2].filter(a => !found.some(f => `${f.month}_${f.parishId}_${f.rule}` === a.id))].map(a => ({ rule: a.rule, country: country[a.parishId] }));
      const s = await summarize(env, cleanTotals(A.summaryTotals(m, all, roll[`${m}_world_all`])));
      await fs.commit([[`aiSummaries/${m}`, { month: m, text: s.text, engine: s.engine, alertCount: all.length, at: now, by: 'server-job' }]]);
      summary = 'written';
    } catch (e) { summary = 'failed: ' + e.message; }
  }
  return { parishes: plist.length, alerts: found.length, fresh: fresh.length, rollups: Object.keys(roll).length, summary };
}

export default {
  runChecks, cleanTotals, allowedOrigin, // exposed for the emulator test (ai-worker/checks.test.mjs)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runChecks(env).then(r => console.log('ccc checks', JSON.stringify(r)), e => console.error('ccc checks failed', e.message)));
  },
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    const route = new URL(req.url).pathname.replace(/^\/+/, '');
    if (req.method === 'GET') return json({ name: 'CCC AI data entry', version: 1, engines: ['gemini', 'groq'] }, 200, origin);
    if (route !== 'extract' && route !== 'summary') return json({ error: 'unknown route' }, 404, origin);

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const testKey = req.headers.get('X-Test-Key');
    let uid;
    if (env.ACCURACY_TEST_KEY && testKey && testKey === env.ACCURACY_TEST_KEY) uid = 'accuracy-test';
    else {
      if (!allowedOrigin(origin)) return json({ error: 'origin not allowed' }, 403, origin);
      if (!token) return json({ error: 'sign in first' }, 401, origin);
      try { uid = await verifyIdToken(token); } catch (e) { return json({ error: 'invalid login: ' + e.message }, 401, origin); }
    }
    if (limited(uid)) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429, origin);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'bad JSON' }, 400, origin); }
    if (route === 'summary') {
      try { return json(await summarize(env, cleanTotals(body.totals)), 200, origin); }
      catch (e) { return json({ error: 'summary failed: ' + String(e.message || e) }, 502, origin); }
    }
    const input = {};
    if (body.text) {
      input.text = String(body.text).slice(0, MAX_TEXT_CHARS);
    } else {
      input.file = String(body.file || '').replace(/^data:[^,]+,/, '');
      input.mime = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(body.mime) ? body.mime : 'image/jpeg';
      if (!input.file || input.file.length > MAX_FILE_CHARS) return json({ error: 'missing or too large file' }, 400, origin);
    }

    const errors = [];
    for (const engine of ENGINES) {
      try {
        const { data, engine: used } = await engine(env, input);
        const people = (Array.isArray(data) ? data : data.people || []).map(cleanPerson).filter(p => p.fullName);
        if (!people.length) throw new Error('0 people');
        return json({ people, engine: used }, 200, origin);
      } catch (e) { errors.push(String(e.message || e)); }
    }
    return json({ error: 'all engines failed', details: errors }, 502, origin);
  },
};
