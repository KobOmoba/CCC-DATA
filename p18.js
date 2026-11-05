// Batch 18: ONBOARDING for a new parish + BULK MEMBER IMPORT (mobile-first).
//  1. "Get started" card at the top of the parish dashboard: 6 steps, each ticked automatically when the data exists.
//     Hides itself when all steps are done (or the admin taps Hide); Parish Settings > "Show Get started" brings it back.
//  2. Import members: paste many WhatsApp messages OR upload a CSV (template provided). Parsed LOCALLY (no AI needed),
//     shown in an editable preview with problems highlighted, then saved one by one through createRecord() (same rules
//     and number series as a single add). Each saved member gets parishes/{p}/importLog/{no} + an auditLog entry in the
//     same transaction. The import is kept in this browser so "Save all" can be resumed after a drop in network.
//  3. Passport photos afterwards: tap an imported member, pick camera/gallery, compressed like the normal photo upload.

// ================================================================= 1. GET STARTED
const OB_KEY = () => "ccc-onboarding-hidden-" + localState.currentParishId;
const OB_WEB_KEY = () => "ccc-onboarding-web-" + localState.currentParishId;
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } };

const OB_STEPS = [
    { id: "info", title: "Public info & service times", hint: "Address, phone and service times for the website.", btn: "Open Parish Settings", go: "obGo('info')" },
    { id: "clergy", title: "Add clergy", hint: "Your shepherd and other clergy (men only).", btn: "Add clergy", go: "obGo('clergy')" },
    { id: "members", title: "Add members", hint: "Paste WhatsApp forms or upload a CSV in one go.", btn: "Import members", go: "openImport()" },
    { id: "depts", title: "Departments", hint: "Put members in the Choir, Sidemen, Prophets ...", btn: "Open Departments", go: "obGo('depts')" },
    { id: "roster", title: "Set this month's roster", hint: "Who leads, reads and preaches each service.", btn: "Open Duty Roster", go: "obGo('roster')" },
    { id: "web", title: "Issue website logins", hint: "Members sign in to the church website.", btn: "How to issue logins", go: "obWebHelp()" }];

async function onboardingStatus() {
    const pid = localState.currentParishId, month = localToday().slice(0, 7), any = q => q.limit(1).get().then(s => !s.empty).catch(() => false);
    const [info, st, depts, roster, web] = await Promise.all([
        db.collection("publicInfo").doc(pid).get().then(d => d.exists && (d.data().services || []).length > 0).catch(() => false),
        statsRef().get().then(d => d.exists ? d.data() : {}).catch(() => ({})),
        any(parishRef().collection("deptMembers")),
        any(parishRef().collection("rosters").where("month", "==", month)),
        any(db.collection("webAccounts").where("parishId", "==", pid))]);
    return { info, clergy: (st.clergyCount || 0) > 0, members: (st.memberCount || 0) > 0, depts, roster, web: web || lsGet(OB_WEB_KEY()) === "1" };
}

async function renderOnboarding(force) {
    const el = $("onboardCard");
    if (!el || localState.role !== "parish_admin") return;
    if (force) lsSet(OB_KEY(), null);
    const done = await onboardingStatus(), n = OB_STEPS.filter(s => done[s.id]).length, all = n === OB_STEPS.length;
    if (!force && (all || lsGet(OB_KEY()) === "1")) { el.classList.add("hidden"); el.innerHTML = ""; return; }
    const pct = Math.round(100 * n / OB_STEPS.length);
    el.innerHTML = `<div class="flex items-start justify-between gap-2">
        <div><p class="font-bold text-base text-blue-950"><i class="fa-solid fa-rocket text-blue-600 mr-1"></i> Get started</p>
          <p class="text-gray-600">Get your parish records in, step by step. ${n} of ${OB_STEPS.length} done.</p></div>
        <button onclick="hideOnboarding()" class="text-gray-500 underline whitespace-nowrap">Hide</button></div>
      <div class="w-full h-2.5 bg-blue-100 rounded-full overflow-hidden" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <div id="obBar" class="h-full bg-emerald-500" style="width:${pct}%"></div></div>
      <ol class="space-y-2">${OB_STEPS.map((s, i) => `<li class="ob-step flex items-center gap-2 ${done[s.id] ? "ob-done" : ""}" data-step="${s.id}">
          <span class="shrink-0 w-7 h-7 rounded-full flex items-center justify-center font-bold ${done[s.id] ? "bg-emerald-500 text-white" : "bg-white border-2 border-blue-300 text-blue-800"}">${done[s.id] ? '<i class="fa-solid fa-check"></i>' : i + 1}</span>
          <div class="flex-1 min-w-0"><p class="font-semibold ${done[s.id] ? "line-through text-gray-400" : ""}">${esc(s.title)}</p><p class="text-gray-500 text-[11px]">${esc(s.hint)}</p></div>
          <button onclick="${s.go}" class="ob-btn shrink-0 px-3 py-2.5 rounded-lg font-semibold ${done[s.id] ? "bg-white border text-gray-600" : "bg-blue-600 text-white shadow"}">${esc(s.btn)}</button></li>`).join("")}</ol>`;
    el.classList.remove("hidden");
}
function hideOnboarding() { lsSet(OB_KEY(), "1"); $("onboardCard").classList.add("hidden"); }
function showOnboarding() { showSection("dashboard"); renderOnboarding(true).catch(e => alert(e.message)); }
function obGo(id) {
    if (id === "info") { showSection("settings"); setTimeout(() => $("pi_services")?.scrollIntoView({ behavior: "smooth", block: "center" }), 300); }
    if (id === "clergy") { showSection("clergy"); openPersonForm("clergy"); }
    if (id === "depts") openDept("parochial");
    if (id === "roster") showSection("roster");
}
function obWebHelp() {
    p9Modal("Website logins", `<p>Website logins let your members sign in to the church website (members' wall, roster).</p>
        <ol class="list-decimal ml-5 space-y-1 mt-2"><li>Add your members first (step 3), with a phone or email each.</li>
        <li>Website logins are issued by the <b>Ijaye parish admin</b> on the website's <b>Parish office</b> page (not by the Super Admin). Send them your member list.</li>
        <li>Each member gets a first-time password and must change it at first sign-in.</li></ol>
        <p class="mt-2 text-gray-500">When the logins are out, tap "Mark as done".</p>`,
        `<button onclick="lsSet(OB_WEB_KEY(),'1');closeModal('p9Modal');renderOnboarding()" class="w-full py-2.5 bg-emerald-600 text-white font-bold rounded">Mark as done</button>`);
}

// ================================================================= 2. PARSING (local, no AI)
const IMP_LABELS = [
    ["nokName", "next\\s*of\\s*kin(?:'?s)?(?:\\s*(?:full\\s*)?name)?"], ["marital", "marital\\s*status|marital"],
    ["rank", "church\\s*rank|rank"], ["dob", "date\\s*of\\s*birth|d\\.?\\s?o\\.?\\s?b\\.?|birth\\s*day|birthday"],
    ["anoint", "last\\s*anointment(?:\\s*date)?|anointment(?:\\s*date)?|anointed"], ["phone", "phone\\s*(?:number|no\\.?)?|tel(?:ephone)?|mobile"],
    ["address", "(?:home\\s*)?address"], ["occupation", "occupation|profession"], ["gender", "gender|sex"], ["email", "e-?mail"],
    ["name", "(?:full\\s*)?name"]];
const IMP_RE = new RegExp(`(^|[^A-Za-z])(${IMP_LABELS.map(([k, r]) => `(?<${k}>${r})`).join("|")})\\s*([:\\-–=]|(?=\\s))`, "gi");
const NO_COLON_OK = ["gender", "marital"];
// A WhatsApp timestamp + sender that ends up stuck to the last value of the previous message.
const WA_STAMP = /\s*\[?\d{1,2}[/.]\d{1,2}[/.]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?\]?\s*(?:-\s*)?[^:\n]{0,40}:?\s*$/;
const MONTH_RE = MONTHS.map(m => m.slice(0, 3).toLowerCase());

function findLabels(text) {
    const out = [];
    IMP_RE.lastIndex = 0;
    for (let m; (m = IMP_RE.exec(text));) {
        const key = Object.keys(m.groups).find(k => m.groups[k]);
        const colon = !!m[m.length - 1];
        if (!colon && !NO_COLON_OK.includes(key)) continue;
        out.push({ key, start: m.index + m[1].length, end: m.index + m[0].length });
    }
    return out;
}
// Splits pasted text into one block per person: a new block starts at every "Name:" (not "Next of kin name:").
function splitWhatsApp(text) {
    const starts = findLabels(text).filter(l => l.key === "name").map(l => l.start);
    if (!starts.length) return [];
    return starts.map((s, i) => text.slice(s, starts[i + 1] ?? text.length));
}
function parseDayMonth(t) {
    const s = String(t || "").toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/,/g, " ").trim();
    let m;
    const mon = w => { const i = MONTH_RE.indexOf(w.slice(0, 3)); return i < 0 ? null : i + 1; };
    if ((m = s.match(/^(\d{1,2})\s*(?:of\s+)?([a-z]{3,})\.?\s*(\d{4})?$/)) && mon(m[2])) return { day: +m[1], month: mon(m[2]), year: m[3] ? +m[3] : null };
    if ((m = s.match(/^([a-z]{3,})\.?\s*(\d{1,2})\s*(\d{4})?$/)) && mon(m[1])) return { day: +m[2], month: mon(m[1]), year: m[3] ? +m[3] : null };
    if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?$/))) {
        let y = m[3] ? +m[3] : null; if (y && y < 100) y += y > (new Date().getFullYear() % 100) ? 1900 : 2000;
        return { day: +m[1], month: +m[2], year: y };
    }
    if ((m = s.match(/^(\d{4})$/))) return { day: null, month: null, year: +m[1] };
    if ((m = s.match(/^([a-z]{3,})\.?\s*(\d{4})$/)) && mon(m[1])) return { day: null, month: mon(m[1]), year: +m[2] };
    return null;
}
const validDM = d => d && d.day >= 1 && d.day <= 31 && d.month >= 1 && d.month <= 12 && (!d.year || (d.year >= 1900 && d.year <= 2100));
function genderOf(t) {
    const s = String(t || "").trim().toLowerCase();
    return /^(m|male|man|brother|bro)\b/.test(s) ? "Male" : /^(f|female|woman|sister|sis)\b/.test(s) ? "Female" : "";
}
function maritalOf(t) {
    const s = String(t || "").trim().toLowerCase();
    return /^single/.test(s) ? "Single" : /^married/.test(s) ? "Married" : /^widow/.test(s) ? "Widowed" : /^divorc/.test(s) ? "Divorced" : /^separat/.test(s) ? "Separated" : "";
}
const cleanVal = v => String(v || "").replace(WA_STAMP, "").replace(/\s+/g, " ").replace(/^[\s:,.\-–*_]+|[\s,;*_…]+$/g, "").replace(/\.\.\.$/, "").trim();

// One WhatsApp block -> raw fields as written.
function parseBlock(text) {
    const labels = findLabels(text), raw = { name: "", gender: "", marital: "", address: "", phone: "", email: "", rank: "", occupation: "", dob: "", anoint: "", nokName: "", nokAddress: "", nokPhone: "" };
    let kin = false;
    labels.forEach((l, i) => {
        const v = cleanVal(text.slice(l.end, labels[i + 1]?.start ?? text.length));
        let k = l.key;
        if (k === "nokName") kin = true;
        else if (kin && (k === "address" || k === "phone")) k = k === "address" ? "nokAddress" : "nokPhone";
        if (k === "name" && kin) k = "nokName";
        if (!raw[k]) raw[k] = v;
    });
    return raw;
}
// Raw fields -> a member draft + its problems. Same field names as the member form.
function rowFrom(raw) {
    const gender = genderOf(raw.gender);
    const r = { raw, fullName: raw.name.replace(/\s+/g, " ").trim(), gender, maritalStatus: maritalOf(raw.marital), address: raw.address,
        phone: raw.phone.replace(/[^\d+]/g, ""), email: (raw.email || "").toLowerCase(), rankText: raw.rank, rank: "", prophet: false,
        occupation: raw.occupation, dobText: raw.dob, anointText: raw.anoint, nokName: raw.nokName, nokAddress: raw.nokAddress,
        nokPhone: raw.nokPhone.replace(/[^\d+]/g, "") };
    resolveRow(r);
    return r;
}
// Recomputes rank / dates / problems after a parse or an edit.
function resolveRow(r) {
    const exact = [...RANKS, ...RANKS_F].find(x => x.toLowerCase() === String(r.rankText).trim().toLowerCase());
    r.rank = ""; r.prophet = false;
    if (r.rankText) {
        const found = exact || rankFromText(r.rankText, r.gender);
        if (found && (!r.gender || ranksFor(r.gender).includes(found))) { r.rank = found; r.prophet = !exact && hasProphet(r.rankText); if (!r.gender) r.gender = genderOfRank(found); }
    }
    const dob = parseDayMonth(r.dobText), an = parseDayMonth(r.anointText);
    r.dobDay = validDM(dob) ? dob.day : null; r.dobMonth = validDM(dob) ? dob.month : null; r.dobYear = validDM(dob) ? dob.year : null;
    r.anointDay = an && an.day && an.month ? an.day : null; r.anointMonth = an && an.month ? an.month : null; r.anointYear = an && an.year ? an.year : null;
    const pr = {};
    if (!r.fullName) pr.fullName = "Name missing";
    if (!r.gender) pr.gender = "Male or Female?";
    if (!r.maritalStatus) pr.maritalStatus = "Single / Married / Widowed / Divorced / Separated";
    if (!r.dobDay) pr.dobText = r.dobText ? "Write day + month, e.g. 15 April" : "Birthday missing (day + month)";
    if (r.rankText && !r.rank) pr.rankText = `Rank "${r.rankText}" not recognised for ${r.gender ? r.gender.toLowerCase() : "this person"}`;
    if (r.anointText && !an) pr.anointText = "Write a year (2005) or a date";
    if (r.phone.length > 20) pr.phone = "Phone too long";
    if (r.nokPhone.length > 20) pr.nokPhone = "Phone too long";
    if (r.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) pr.email = "Email does not look right";
    r.problems = pr;
    if (r.intake && typeof resolvePlacement === "function") resolvePlacement(r); // Batch 18 (p19.js)
    return r;
}
function parseWhatsApp(text) { return splitWhatsApp(String(text || "")).map(parseBlock).map(rowFrom).filter(r => r.fullName || Object.values(r.raw).some(Boolean)); }

// ---- CSV
const CSV_COLS = ["Name", "Gender", "Marital Status", "Address", "Phone", "Email", "Church Rank", "Occupation", "Date of birth", "Last Anointment", "Next of kin name", "Next of kin address", "Next of kin phone"];
const CSV_MAP = { name: "name", fullname: "name", gender: "gender", sex: "gender", maritalstatus: "marital", marital: "marital", address: "address", homeaddress: "address",
    phone: "phone", phonenumber: "phone", mobile: "phone", email: "email", churchrank: "rank", rank: "rank", occupation: "occupation", dateofbirth: "dob", dob: "dob", birthday: "dob",
    lastanointment: "anoint", lastanointmentdate: "anoint", anointment: "anoint", nextofkinname: "nokName", nextofkin: "nokName", nextofkinaddress: "nokAddress", nextofkinphone: "nokPhone",
    nextofkinphonenumber: "nokPhone" };
function csvRows(text) {
    text = String(text || "").replace(/^﻿/, "");
    const first = text.split(/\r?\n/)[0] || "", sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
        else if (c === '"') q = true;
        else if (c === sep) { row.push(cell); cell = ""; }
        else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
        else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim()));
}
function parseCsv(text) {
    const rows = csvRows(text);
    if (rows.length < 2) return [];
    const keys = rows[0].map(h => CSV_MAP[h.toLowerCase().replace(/[^a-z]/g, "")] || "");
    if (!keys.includes("name")) throw new Error('The first row must be the column names, with a "Name" column. Download the template.');
    return rows.slice(1).map(cells => {
        const raw = { name: "", gender: "", marital: "", address: "", phone: "", email: "", rank: "", occupation: "", dob: "", anoint: "", nokName: "", nokAddress: "", nokPhone: "" };
        keys.forEach((k, i) => { if (k && !raw[k]) raw[k] = String(cells[i] || "").trim(); });
        return rowFrom(raw);
    });
}
function downloadImportTemplate() {
    const sample = ["Ade Example", "Male", "Married", "1 Sample Street", "08000000001", "", "Elder Brother", "Trader", "15 April", "2005", "Bola Example", "1 Sample Street", "08000000002"];
    const csv = [CSV_COLS, sample].map(r => r.map(c => /[",;\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(",")).join("\r\n") + "\r\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = "ccc-members-template.csv";
    document.body.appendChild(a); a.click(); a.remove();
}

// ================================================================= 3. IMPORT UI
let imp = { rows: [], source: "whatsapp" };
const impHq = () => localState.role === "super_admin"; // Super Admin imports into HQ's own records only
const IMP_STORE = () => "ccc-import-" + (impHq() ? "HQ" : localState.currentParishId);
const saveImpState = () => lsSet(IMP_STORE(), JSON.stringify({ rows: imp.rows.map(({ photoBusy, ...r }) => r), source: imp.source, hq: !!imp.hq }));
function openImport() {
    imp = { rows: [], source: "whatsapp", hq: impHq() };
    try { const s = JSON.parse(lsGet(IMP_STORE()) || "null"); if (s && s.rows && s.rows.some(r => !r.saved)) imp = { ...s, hq: impHq() }; } catch { /* ignore */ }
    $("imp_text").value = ""; $("imp_file").value = ""; $("imp_consent").checked = false;
    $("imp_status").textContent = imp.rows.length ? `You have an unfinished import (${imp.rows.filter(r => !r.saved).length} not saved yet). Fix and tap Save all to continue, or Start over.` : "";
    impTab(["csv", "intake"].includes(imp.source) ? imp.source : "whatsapp");
    renderImport();
    openModal("importModal");
}
function impTab(t) {
    imp.source = t;
    $("imp_tabs").classList.toggle("hidden", t === "intake");
    ["whatsapp", "csv"].forEach(x => { $("imp_tab_" + x).classList.toggle("bg-blue-600", x === t); $("imp_tab_" + x).classList.toggle("text-white", x === t); $("imp_pane_" + x).classList.toggle("hidden", x !== t); });
}
function impReset() { imp.rows = []; lsSet(IMP_STORE(), null); $("imp_status").textContent = ""; renderImport(); }
async function impParsePaste() {
    const rows = parseWhatsApp($("imp_text").value);
    if (!rows.length) return alert('No records found. Each person must start with "Name:".');
    imp.rows = rows; imp.source = "whatsapp";
    await impCheckDuplicates(); saveImpState(); renderImport();
    $("imp_status").textContent = `Found ${rows.length} ${rows.length === 1 ? "person" : "people"}. Check the red cells, then tap Save all.`;
}
async function impReadWithIntake(files) {
    $("imp_status").textContent = `Reading ${files.length} file${files.length === 1 ? "" : "s"} with the AI... this can take a minute.`;
    await busy("imp_csvBtn", () => intakeRun(files));
    const failed = intake.files.filter(x => x.status === "Failed");
    if (!intake.people.length) {
        $("imp_status").textContent = "No people found. " + failed.map(x => `${x.name}: ${x.error}`).join(" ");
        return;
    }
    intakePreview();
    if (failed.length) $("imp_status").textContent += " Not read: " + failed.map(x => `${x.name} (${x.error})`).join("; ");
}
async function impParseCsv() {
    const files = [...$("imp_file").files], f = files[0];
    if (!f) return alert("Choose a file first.");
    // Word / Excel / PDF / photos (and CSVs that are not the template) go through the Data Intake reader (p19.js).
    let rows = null;
    if (files.length === 1 && ["csv", "txt"].includes(await sniffKind(f))) { try { rows = parseCsv(await f.text()); } catch { rows = null; } }
    if (!rows || !rows.length) return impReadWithIntake(files);
    imp.rows = rows;
    if (!imp.rows.length) return alert("The file has no member rows.");
    imp.source = "csv";
    await impCheckDuplicates(); saveImpState(); renderImport();
    $("imp_status").textContent = `Read ${imp.rows.length} rows. Check the red cells, then tap Save all.`;
}
async function findHqDuplicate(x) {
    const hits = new Set(), name = x.d.fullName.trim().toLowerCase(), phone = (x.d.phone || "").replace(/\D/g, "");
    const qs = [db.collection("hqMembers").where("nameLower", "==", name).limit(3)];
    if (phone.length >= 7) qs.push(db.collection("hqMembers").where("phoneDigits", "==", phone).limit(3));
    for (const q of qs) (await q.get().catch(() => ({ docs: [] }))).docs.forEach(d => hits.add(`${d.id} (${d.data().fullName})`));
    x.dup = [...hits].join(", ");
}
// HQ's own member record: CCC-HQ-MBR-001.., counter hqMeta/members, audited (see firestore.rules hqMembers).
function createHqMember(p, source) {
    const cRef = db.collection("hqMeta").doc("members");
    return db.runTransaction(async t => {
        const c = await t.get(cRef);
        const n = (c.exists ? c.data().n : 0) + 1, id = "CCC-HQ-MBR-" + pad3(n);
        const rec = { ...p, memberNo: id, source, version: 1, createdBy: localState.user.uid };
        t.set(cRef, { n });
        t.set(db.collection("hqMembers").doc(id), rec);
        writeAudit(t, "hqMembers/" + id, 1, "import-hq-member", null, { memberNo: id, fullName: p.fullName, source });
        return id;
    });
}
// Duplicates by phone or name: against members/clergy already saved, and inside this import.
async function impCheckDuplicates() {
    const seenN = {}, seenP = {};
    for (const [i, r] of imp.rows.entries()) {
        if (r.saved) continue;
        const x = { d: { fullName: r.fullName || "", phone: r.phone } };
        if (imp.hq) await findHqDuplicate(x); else await findDuplicate(x);
        const n = r.fullName.toLowerCase(), p = r.phone.replace(/\D/g, ""), inside = [];
        if (n && seenN[n] != null) inside.push(`row ${seenN[n] + 1} (same name)`);
        if (p.length >= 7 && seenP[p] != null) inside.push(`row ${seenP[p] + 1} (same phone)`);
        if (n) seenN[n] ??= i; if (p.length >= 7) seenP[p] ??= i;
        r.dup = [x.dup, inside.join(", ")].filter(Boolean).join("; ");
        if (r.dup && r.keepDup == null) r.keepDup = false;
    }
}
const IMP_COLS = [["fullName", "Name *", "w-40"], ["gender", "Gender *", "w-24"], ["maritalStatus", "Marital *", "w-28"], ["phone", "Phone", "w-32"],
    ["rankText", "Rank (M/C, E/B ...)", "w-28"], ["dobText", "Birthday * (15 April)", "w-32"], ["address", "Address", "w-44"], ["occupation", "Occupation", "w-28"],
    ["anointText", "Last anointment", "w-24"], ["email", "Email", "w-36"], ["nokName", "Next of kin", "w-36"], ["nokAddress", "Kin address", "w-40"], ["nokPhone", "Kin phone", "w-32"]];
// Batch 18: rows from the Data Intake agent carry placement columns too (see p19.js).
const IMP_X_COLS = [["track", "Member / Clergy", "w-28"], ["prophetFlag", "Prophet(ess)?", "w-24"], ["deptText", "Departments (Choir, Sidemen)", "w-44"],
    ["deptRole", "Role in unit", "w-28"], ["cmtText", "Committees (name: role; ...)", "w-56"]];
const impCols = () => imp.source !== "intake" || imp.hq ? IMP_COLS : [IMP_COLS[0], IMP_COLS[1], ...IMP_X_COLS, ...IMP_COLS.slice(2)];
function renderImport() {
    $("imp_title").textContent = imp.hq ? "IMPORT INTO HQ RECORDS" : "IMPORT MEMBERS";
    $("imp_head").innerHTML = `<th class="p-1 sticky left-0 bg-gray-100 text-left">#</th>` + impCols().map(([, l]) => `<th class="p-1 text-left">${esc(l)}</th>`).join("");
    const rows = imp.rows, saved = rows.filter(r => r.saved).length, bad = rows.filter(r => !r.saved && Object.keys(r.problems).length).length;
    $("imp_preview").classList.toggle("hidden", !rows.length);
    $("imp_summary").innerHTML = rows.length ? `<b>${rows.length}</b> rows · <span class="text-emerald-700 font-semibold">${saved} saved</span> · <span class="${bad ? "text-red-700 font-semibold" : ""}">${bad} with problems</span> · ${rows.filter(r => !r.saved && r.dup).length} possible duplicates` : "";
    const cell = (r, i, [k, , w]) => {
        const p = r.problems[k], ro = r.saved ? "disabled" : "";
        const base = `data-i="${i}" data-k="${k}" ${ro} title="${esc(p || "")}" class="imp-in ${w} border rounded p-2 text-xs ${p ? "imp-bad bg-red-50 border-red-500" : "bg-white"}"`;
        const opts = k === "track" ? ["Member", "Clergy"] : k === "prophetFlag" ? ["No", "Yes"] : null;
        const input = opts ? `<select ${base}>${opts.map(v => `<option${r[k] === v ? " selected" : ""}>${v}</option>`).join("")}</select>`
            : k === "gender" ? `<select ${base}>${["", "Male", "Female"].map(v => `<option${r[k] === v ? " selected" : ""} value="${v}">${v || "?"}</option>`).join("")}</select>`
            : k === "maritalStatus" ? `<select ${base}>${["", "Single", "Married", "Widowed", "Divorced", "Separated"].map(v => `<option${r[k] === v ? " selected" : ""} value="${v}">${v || "?"}</option>`).join("")}</select>`
            : `<input ${base} value="${esc(r[k] || "")}">`;
        const note = k === "rankText" && r.rank ? `<div class="text-[10px] text-emerald-700 mt-0.5">= ${esc(rankText(r))}</div>`
            : k === "dobText" && r.dobDay ? `<div class="text-[10px] text-emerald-700 mt-0.5">= ${fmtDate(r.dobDay, r.dobMonth, r.dobYear)}</div>`
            : p ? `<div class="text-[10px] text-red-700 mt-0.5">${esc(p)}</div>`
            : k === "track" && r.placementNote ? `<div class="text-[10px] text-amber-700 mt-0.5">${esc(r.placementNote)}</div>` : "";
        return `<td class="p-1 align-top">${input}${note}</td>`;
    };
    $("imp_rows").innerHTML = rows.map((r, i) => `<tr class="imp-row border-t ${r.saved ? "bg-emerald-50" : r.dup ? "bg-amber-50" : ""}" data-i="${i}">
        <td class="p-1 align-top sticky left-0 ${r.saved ? "bg-emerald-50" : r.dup ? "bg-amber-50" : "bg-white"} text-[11px] w-24">
          <div class="font-bold">${i + 1}</div>
          ${r.saved ? `<div class="imp-saved text-emerald-700 font-semibold break-all"><i class="fa-solid fa-check"></i> ${esc(r.saved)}</div>`
            : r.error ? `<div class="imp-err text-red-700">${esc(r.error)}</div>` : ""}
          ${r.dup && !r.saved ? `<div class="imp-dup text-amber-800">Possible duplicate: ${esc(r.dup)}</div><label class="flex gap-1 items-center mt-0.5"><input type="checkbox" ${r.keepDup ? "checked" : ""} onchange="imp.rows[${i}].keepDup=this.checked;saveImpState()"> Save anyway</label>` : ""}
          ${!r.saved ? `<label class="flex gap-1 items-center mt-0.5 text-gray-500"><input type="checkbox" ${r.skip ? "checked" : ""} onchange="imp.rows[${i}].skip=this.checked;saveImpState()"> Skip</label>` : ""}
        </td>${impCols().map(c => cell(r, i, c)).join("")}</tr>`).join("");
    $("imp_rows").querySelectorAll(".imp-in").forEach(el => el.addEventListener("change", () => {
        const r = imp.rows[el.dataset.i]; r[el.dataset.k] = el.value.trim();
        if (el.dataset.k === "phone" || el.dataset.k === "nokPhone") r[el.dataset.k] = r[el.dataset.k].replace(/[^\d+]/g, "");
        resolveRow(r); saveImpState(); renderImport();
    }));
    $("imp_aiBtn").classList.toggle("hidden", imp.source === "intake" || !rows.some(r => !r.saved && Object.keys(r.problems).length && r.raw));
    renderImportPhotos();
}

// Optional helper: send only the UNSURE rows' original text to the AI worker and fill in blanks it is sure about.
async function impAskAi() {
    const unsure = imp.rows.filter(r => !r.saved && Object.keys(r.problems).length);
    if (!unsure.length) return;
    await busy("imp_aiBtn", async () => {
        try {
            const text = unsure.map(r => Object.entries(r.raw).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n")).join("\n\n");
            const people = await callAi({ text });
            unsure.forEach((r, i) => {
                const d = people[i]; if (!d) return;
                applyRankAbbr(d);
                if (!r.gender && d.gender) r.gender = d.gender;
                if (!r.maritalStatus && d.maritalStatus) r.maritalStatus = d.maritalStatus;
                if (!r.dobDay && d.dobDay && d.dobMonth) r.dobText = `${d.dobDay} ${MONTHS[d.dobMonth - 1]}${d.dobYear ? " " + d.dobYear : ""}`;
                if (!r.rank && d.rank) r.rankText = d.rank;
                resolveRow(r);
            });
            saveImpState(); renderImport();
            $("imp_status").textContent = "The AI filled what it could. Check the red cells again.";
        } catch (e) { $("imp_status").textContent = "AI helper not available (" + e.message + "). You can still fix the red cells by hand."; }
    });
}

// Save one by one through the normal createRecord path. Safe to tap again: saved rows are skipped.
async function impSaveAll() {
    if (!requireFirebase()) return;
    if (!$("imp_consent").checked) return alert("You must record consent before saving (NDPA 2023).");
    const todo = imp.rows.filter(r => !r.saved && !r.skip);
    if (!todo.length) return alert("Nothing left to save.");
    await busy("imp_saveBtn", async () => {
        let ok = 0, n = 0;
        for (const r of todo) {
            n++; $("imp_status").textContent = `Saving ${n} of ${todo.length}...`;
            resolveRow(r);
            if (Object.keys(r.problems).length) { r.error = "Fix the red cells first."; continue; }
            if (r.dup && !r.keepDup) { r.error = "Possible duplicate: tick Save anyway, or Skip."; continue; }
            const p = { fullName: r.fullName, gender: r.gender, maritalStatus: r.maritalStatus, address: (r.address || "").slice(0, 200), phone: r.phone, email: r.email || "",
                rank: r.rank, prophet: !!r.prophet, occupation: (r.occupation || "").slice(0, 80), dobDay: r.dobDay, dobMonth: r.dobMonth, dobYear: r.dobYear || null,
                anointDay: r.anointDay, anointMonth: r.anointMonth, anointYear: r.anointYear, nokName: (r.nokName || "").slice(0, 120), nokAddress: (r.nokAddress || "").slice(0, 200),
                nokPhone: r.nokPhone, photo: "", important: false, consentGiven: true, updatedAt: nowIso() };
            p.nameLower = p.fullName.toLowerCase(); p.phoneDigits = p.phone.replace(/\D/g, "");
            const kind = r.intake && r.track === "Clergy" && !imp.hq ? "clergy" : "members", source = ["csv", "intake"].includes(imp.source) ? imp.source : "whatsapp";
            const problem = checkPerson(p, kind);
            if (problem) { r.error = problem; continue; }
            p.status = "Active"; p.consentDate = today(); p.createdAt = nowIso();
            if (kind === "clergy") p.serviceRecord = p.rank ? [{ rank: p.rank, from: today() }] : [];
            if (imp.hq) {
                try { r.saved = await createHqMember(p, source); r.error = ""; ok++; }
                catch (e) { console.error("hq import save", e.code, e.message); r.error = "Not saved: " + e.message; }
                saveImpState(); renderImport(); continue;
            }
            try {
                r.saved = await createRecord(kind, p, (t, id) => {
                    const target = `parishes/${localState.currentParishId}/importLog/${id}`;
                    t.set(parishRef().collection("importLog").doc(id), { memberNo: id, source, version: 1, at: srv(), by: localState.user.uid });
                    parishAudit(t, target, 1, kind === "clergy" ? "import-clergy" : "import-member", null, { memberNo: id, fullName: p.fullName, source, departments: r.deptIds || [] });
                    // Batch 18: department places in the same transaction (members only; clergy never join a department).
                    if (kind === "members") (r.deptIds || []).forEach(dept => t.set(parishRef().collection("deptMembers").doc(`${dept}_${id}`),
                        { dept, memberNo: id, fullName: p.fullName, role: (r.deptRole || "").slice(0, 40), status: "Current", joinedDate: today(), updatedAt: nowIso() }));
                });
                r.error = ""; ok++;
            } catch (e) { console.error("import save", e.code, e.message); r.error = "Not saved: " + e.message; }
            saveImpState(); renderImport();
        }
        if (ok && imp.source === "intake" && !imp.hq && typeof intakeSaveCommittees === "function") await intakeSaveCommittees(todo.filter(x => x.saved)); // Batch 18
        saveImpState(); renderImport();
        const left = imp.rows.filter(x => !x.saved && !x.skip).length;
        $("imp_status").textContent = `Saved ${ok} member${ok === 1 ? "" : "s"}.` + (left ? ` ${left} still to fix - see the notes on the left, then tap Save all again.` : " All done. Add passport photos below.")
            + (imp.cmtNote ? " " + imp.cmtNote : "");
        if (!left) lsSet(IMP_STORE(), JSON.stringify({ rows: [], source: imp.source }));
        if (ok && !imp.hq) { await Promise.all([loadMembers(true), refreshTotals()]).catch(() => {}); renderOnboarding().catch(() => {}); }
    });
}

// ================================================================= 4. PASSPORT PHOTOS AFTERWARDS
function renderImportPhotos() {
    const saved = imp.rows.map((r, i) => ({ r, i })).filter(x => x.r.saved);
    $("imp_photos").classList.toggle("hidden", !saved.length || !!imp.hq);
    $("imp_photoList").innerHTML = saved.map(({ r, i }) => `<label class="imp-photo flex items-center gap-3 border rounded-lg p-2 bg-white active:bg-blue-50 cursor-pointer" data-no="${esc(r.saved)}">
        ${r.hasPhoto ? `<span class="w-12 h-12 rounded bg-emerald-100 flex items-center justify-center text-emerald-700"><i class="fa-solid fa-check"></i></span>` : `<span class="w-12 h-12 rounded bg-gray-100 flex items-center justify-center text-gray-500"><i class="fa-solid fa-camera"></i></span>`}
        <span class="flex-1 min-w-0"><span class="block font-semibold truncate">${esc(r.fullName)}</span><span class="block text-[11px] text-gray-500">${esc(r.saved)} · ${r.hasPhoto ? "Photo added (tap to change)" : "Tap to add passport photo"}</span></span>
        <input type="file" accept="image/*" class="hidden" onchange="impPhoto(${i}, this)"></label>`).join("");
}
async function impPhoto(i, input) {
    const r = imp.rows[i], file = input.files[0];
    if (!file || !r.saved) return;
    try {
        const photo = await compressImage(file);
        const mRef = parishRef().collection("members").doc(r.saved), lRef = parishRef().collection("importLog").doc(r.saved);
        await db.runTransaction(async t => {
            const [m, l] = await Promise.all([t.get(mRef), t.get(lRef)]);
            if (!m.exists) throw new Error("Member not found.");
            const merged = { ...m.data(), photo, updatedAt: nowIso() }, v = (l.exists ? l.data().version : 0) + 1;
            t.set(mRef, merged);
            t.set(dirRef(localState.currentParishId, r.saved), { ...dirProfile(merged), updatedAt: nowIso() }, { merge: true });
            if (l.exists) {
                t.update(lRef, { version: v, at: srv(), by: localState.user.uid });
                parishAudit(t, `parishes/${localState.currentParishId}/importLog/${r.saved}`, v, "import-photo", null, { memberNo: r.saved });
            }
        });
        r.hasPhoto = true; saveImpState(); renderImportPhotos();
    } catch (e) { alert("Photo not saved: " + e.message); }
}
