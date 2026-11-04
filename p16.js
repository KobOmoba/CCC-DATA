// CCC Parish Portal - Batch 16: anointment / rank promotions + printable member forms.
//  1. Rank abbreviations: M/C = Mother Celestial, L/S/S/E = Lace Superior Senior Elder Sister, Sup. Evang. = Superior Evangelist ...
//     Entry (short-form box on the member form, AI data entry) and search accept them; the app always shows the full name.
//  2. Rank history: parishes/{p}/rankHistory/{memberNo}. Everyone starts as Brother / Sister; each anointment adds
//     one entry (date, old rank -> new rank, parish, anointing pastor, approved by). Append-only, never deleted, audited.
//  3. Anointing events: parishes/{p}/anointings/{id}. Date + state, candidates, amount paid per candidate (no fee split),
//     "Mark anointed" updates every ticked candidate's rank + history in one tap. Candidates anointed less than 3 years
//     ago are flagged, never blocked.
//  4. HQ certificates: certificates/{parishId}_{eventId}_{memberNo}. The parish requests, the Super Admin issues (number + date).
//  5. Super Admin: Anointing card at the top of the dashboard + HQ page to issue certificates.
//  6. Printables: blank one-page member data form, one-page member profile (large, plain words).
const MIN_GAP_YEARS = 3;

// ================================================================= 1. RANK ABBREVIATIONS
// [short form shown in the help list, full rank, other spellings people write]
const RANK_SHORT = {
    Male: [["Bro.", "Brother", "BR"], ["E/B", "Elder Brother"], ["C/E/B", "Cape Elder Brother"], ["F/E/B", "Full Elder Brother"],
        ["S/E/B", "Senior Elder Brother"], ["S/S/E/B", "Superior Senior Elder Brother"], ["A/L", "Assistant Leader", "Asst. Leader", "Asst. Ldr"],
        ["Ldr.", "Leader"], ["S/L", "Senior Leader", "Snr. Leader", "Snr. Ldr"], ["S/S/L", "Superior Senior Leader"],
        ["H/A/E", "Honorary Assistant Evangelist", "Hon. Asst. Evang."], ["A/E", "Assistant Evangelist", "Asst. Evang."],
        ["H/E", "Honorary Evangelist", "Hon. Evang."], ["Evang.", "Evangelist", "Evan.", "Ev."], ["H/S/E", "Honorary Senior Evangelist", "Hon. Snr. Evang."],
        ["S/E", "Senior Evangelist", "Snr. Evang."], ["S/M/S/E", "Special Most Senior Evangelist"], ["M/S/E", "Most Senior Evangelist"],
        ["S/V/M/S/E", "Special Venerable Most Senior Evangelist"], ["V/M/S/E", "Venerable Most Senior Evangelist", "Ven. M/S/E"],
        ["A/S/E", "Assistant Superior Evangelist", "Asst. Sup. Evang."], ["Sup. Evang.", "Superior Evangelist", "Sup. Evan.", "Sup/E"],
        ["A/V/S/E", "Assistant Venerable Superior Evangelist"], ["V/S/E", "Venerable Superior Evangelist", "Ven. Sup. Evang."],
        ["A/M/Sup/E", "Assistant Most Superior Evangelist", "Asst. Most Sup. Evang."], ["M/Sup/E", "Most Superior Evangelist", "Most Sup. Evang."],
        ["Supreme Evang.", "Supreme Evangelist", "Supr. Evang."], ["Pastor", "Pastor Reverend", "Rev.", "Past. Rev."]],
    Female: [["Sis.", "Sister", "SR"], ["E/S", "Elder Sister"], ["C/E/S", "Cape Elder Sister"], ["S/E/S", "Senior Elder Sister"],
        ["L/E/S", "Lace Elder Sister / Lace Senior Elder Sister", "L/S/E/S", "Lace Elder Sister", "Lace Senior Elder Sister"],
        ["S/S/E/S", "Superior Senior Elder Sister", "S/S/E"],
        ["L/S/S/E", "Lace Superior Senior Elder Sister", "L/S/S/E/S"],
        ["A/M/C", "Assistant Mother Celestial", "Asst. M/C"], ["M/C", "Mother Celestial"]]
};
const abbrKey = t => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const RANK_ABBR = Object.fromEntries(Object.entries(RANK_SHORT).map(([g, rows]) => {
    const m = {};
    rows.forEach(([short, full, ...more]) => [short, full, ...more].forEach(x => m[abbrKey(x)] = full));
    return [g, m];
}));
// Prophet / Prophetess (P) is a yes/no designation added to the rank, not a rank of its own.
// A short form ending in "/P" (e.g. L/S/S/E/P) = the base rank + the designation.
const PROPHET_RE = /\s*\/\s*P\.?\s*$/i;
const hasProphet = t => PROPHET_RE.test(String(t || ""));
const prophetWord = g => g === "Female" ? "Prophetess" : "Prophet";
// Rank as shown everywhere: "Lace Superior Senior Elder Sister Prophetess".
// With P the word Sister / Brother becomes Prophetess / Prophet: "Lace Superior Senior Elder Prophetess".
// A rank without Sister / Brother keeps its name with the word added after it.
const rankText = (p, fallback = "") => {
    const r = p?.rank || fallback;
    if (!r || !p?.prophet) return r;
    const w = prophetWord(p.gender), re = p.gender === "Female" ? /\bSister\b/g : /\bBrother\b/g;
    return re.test(r) ? r.replace(re, w) : `${r} ${w}`;
};
// Tracks: men = clergy, prophet or ordinary member; women = prophetess or ordinary member. Women are never clergy.
const FEMALE_CLERGY_MSG = "Women cannot be clergy in CCC. Add her as a member (tick Prophetess if she is one).";
// Full rank name for a short form or full name. Without a gender, only an answer both lines agree on is returned.
function rankFromText(t, g) {
    const own = rankFromText1(t, g);
    return own || (hasProphet(t) ? rankFromText1(String(t).replace(PROPHET_RE, ""), g) : "");
}
function rankFromText1(t, g) {
    const k = abbrKey(t);
    if (!k) return "";
    if (g === "Male" || g === "Female") return RANK_ABBR[g][k] || "";
    const m = RANK_ABBR.Male[k], f = RANK_ABBR.Female[k];
    return m && f ? "" : m || f || "";
}
const genderOfRank = r => RANKS.includes(r) ? "Male" : RANKS_F.includes(r) ? "Female" : "";
const shortOf = r => { for (const rows of Object.values(RANK_SHORT)) { const x = rows.find(y => y[1] === r); if (x) return x[0]; } return ""; };
// Member form: the short-form box picks the rank (and the gender, when it is still empty).
function rankShortInput() {
    const t = val("p_rankShort"), g = $("p_gender").value, r = rankFromText(t, g);
    const p = !!r && hasProphet(t);
    $("p_rankShortHint").textContent = !t ? "" : r ? "= " + (p ? rankText({ rank: r, gender: g || genderOfRank(r), prophet: true }) : r) : g ? `Not a ${g.toLowerCase()} rank short form` : "Choose gender first, or type a fuller short form";
    if (!r) return;
    if (!g) $("p_gender").value = genderOfRank(r);
    fillRanks(r);
    if (p) $("p_prophet").checked = true;
    prophetLabel();
}
// AI data entry: a rank the reader could not match is tried against the short forms.
function applyRankAbbr(d) {
    if (!d || !d.rankAsWritten) return;
    const r = rankFromText(d.rankAsWritten, d.gender);
    if (!r) return;
    if (hasProphet(d.rankAsWritten)) d.prophet = true;
    d.rank = r; d.rankAsWritten = "";
    if (!d.gender) d.gender = genderOfRank(r);
}
// Member form: the tick box reads "Prophetess" for women, "Prophet" for men.
function prophetLabel() { const el = $("p_prophetWord"); if (el) el.textContent = $("p_gender").value === "Female" ? "Prophetess" : $("p_gender").value === "Male" ? "Prophet" : "Prophet / Prophetess"; }
function rankShortHelp() {
    p9Modal("Rank short forms", Object.entries(RANK_SHORT).map(([g, rows]) => `<p class="font-bold mt-1">${g === "Male" ? "Men" : "Women"}</p>
        <table class="w-full">${rows.map(([s, f]) => `<tr class="border-t"><td class="p-1 font-mono">${esc(s)}</td><td class="p-1">${esc(f)}</td></tr>`).join("")}</table>`).join("") +
        `<p class="mt-2">Add <b>/P</b> at the end for a Prophet (men) or Prophetess (women), e.g. <span class="font-mono">L/S/S/E/P</span>.</p>`);
}

// ================================================================= 2. RANK HISTORY
const baseRank = g => g === "Female" ? "Sister" : "Brother";
const rhRef = no => parishRef().collection("rankHistory").doc(no);
const rhTarget = no => `parishes/${localState.currentParishId}/rankHistory/${no}`;
async function loadRankHist(no) { const d = await rhRef(no).get(); return d.exists ? d.data() : null; }
// Entries a member has before the first saved history: the Brother/Sister start, and the rank on the record if higher.
function startEntries(m) {
    const by = localState.user.uid, parish = localState.parish.name || "", start = String(m.consentDate || m.createdAt || localToday()).slice(0, 10);
    const e = [{ date: start, from: "", to: baseRank(m.gender), parish, pastor: "", approvedBy: "", eventId: "", kind: "start", by }];
    if (m.rank && m.rank !== baseRank(m.gender)) {
        const d = m.anointYear ? ymdOf(m.anointYear, m.anointMonth || 1, m.anointDay || 1) : start;
        e.push({ date: d, from: baseRank(m.gender), to: m.rank, parish, pastor: "", approvedBy: "", eventId: "", kind: "record", by });
    }
    return e;
}
// Adds one entry to the batch (history doc + audit). Returns the new history doc.
function rankHistWrite(b, m, old, entry) {
    const entries = old ? old.entries.concat(entry) : startEntries(m).concat(entry);
    const next = { memberNo: m.memberNo, fullName: m.fullName, gender: m.gender, entries, version: old ? old.version + 1 : 1,
        updatedAt: nowIso(), updatedBy: localState.user.uid };
    b.set(rhRef(m.memberNo), next);
    parishAudit(b, rhTarget(m.memberNo), next.version, entry.kind === "anointment" ? "anoint" : "rank-record", { rank: entry.from || null }, { rank: entry.to, date: entry.date });
    return next;
}
// The member record + directory follow the latest rank.
function memberRankWrite(b, m, rank, date) {
    const [y, mo, d] = date.split("-").map(Number);
    const next = { ...m, rank, anointDay: d, anointMonth: mo, anointYear: y, updatedAt: nowIso() };
    b.set(parishRef().collection("members").doc(m.memberNo), next);
    b.set(dirRef(localState.currentParishId, m.memberNo), { ...dirProfile(next), updatedAt: nowIso() }, { merge: true });
    return next;
}
// Date of the last anointment: history first, else the "last anointment" on the record.
function lastAnointed(m, h) {
    const e = (h?.entries || []).filter(x => x.kind !== "start").map(x => x.date).sort().pop();
    if (e) return e;
    return m.anointYear ? ymdOf(m.anointYear, m.anointMonth || 1, m.anointDay || 1) : "";
}
const minusYears = (date, n) => `${Number(date.slice(0, 4)) - n}${date.slice(4)}`;
const tooSoon = (last, date) => !!last && last > minusYears(date, MIN_GAP_YEARS);
const nextRank = (g, r) => { const l = ranksFor(g), i = l.indexOf(r || baseRank(g)); return l[Math.min(i + 1, l.length - 1)] || l[1]; };

async function openRankHistory() {
    const m = current.rec, h = await loadRankHist(m.memberNo);
    const entries = h ? h.entries : startEntries(m);
    p9Modal(`Rank history: ${m.fullName}`, `<p class="text-gray-500">Kept for ever. Nothing here can be deleted.</p>
        <div id="rh_list" class="space-y-1">${entries.slice().reverse().map(e => `<div class="rh-entry border rounded p-2"><b>${esc(fmtLong(e.date))}</b>:
            ${e.from ? esc(e.from) + " → " : ""}<b>${esc(e.to)}</b>${e.kind === "start" ? " (start)" : ""}<br>
            <span class="text-gray-600">${esc([e.parish, e.pastor && "Anointed by " + e.pastor, e.approvedBy && "Approved by " + e.approvedBy].filter(Boolean).join(" · "))}</span></div>`).join("")}</div>
        ${h ? "" : `<p class="text-amber-700">Not saved yet: this is worked out from the member record.</p>`}
        ${m.status === "Active" ? `<p class="font-bold mt-2">Add an anointment that happened before</p>
        <div class="grid grid-cols-2 gap-2"><div><label class="block font-semibold">Date</label><input id="rh_date" type="date" max="${localToday()}" class="w-full border p-2 rounded"></div>
        <div><label class="block font-semibold">New rank</label><select id="rh_to" class="w-full border p-2 rounded">${ranksFor(m.gender).map(r => `<option ${r === nextRank(m.gender, m.rank) ? "selected" : ""}>${esc(r)}</option>`).join("")}</select></div></div>
        <label class="block font-semibold">Parish</label><input id="rh_parish" class="w-full border p-2 rounded" value="${esc(localState.parish.name || "")}">
        <label class="block font-semibold">Anointing pastor</label><input id="rh_pastor" class="w-full border p-2 rounded">
        <label class="block font-semibold">Approved by</label><input id="rh_appr" class="w-full border p-2 rounded">` : ""}`,
        m.status === "Active" ? `<button id="saveRhBtn" onclick="savePastAnointment()" class="px-3 py-2 bg-blue-900 text-white rounded font-bold">Add</button>` : "");
}
async function savePastAnointment() {
    const m = current.rec, date = $("rh_date").value, to = $("rh_to").value;
    if (!date || date > localToday()) return alert("Pick the date of the anointment (not in the future).");
    await busy("saveRhBtn", async () => {
        try {
            const h = await loadRankHist(m.memberNo), last = (h ? h.entries : startEntries(m)).map(e => e.date).sort().pop();
            const entry = { date, from: m.rank || baseRank(m.gender), to, parish: val("rh_parish").slice(0, 120), pastor: val("rh_pastor").slice(0, 120),
                approvedBy: val("rh_appr").slice(0, 120), eventId: "", kind: "record", by: localState.user.uid };
            const b = db.batch();
            rankHistWrite(b, m, h, entry);
            if (date >= last) current.rec = memberRankWrite(b, m, to, date);   // only the newest anointment changes today's rank
            await b.commit();
            await openRankHistory();
        } catch (e) { alert("Not saved: " + e.message); }
    });
}

// ================================================================= 3. ANOINTING EVENTS (parish)
let anState = { list: [], sel: null, certs: {}, hist: {} };
const anRef = id => parishRef().collection("anointings").doc(id);
const anTarget = id => `parishes/${localState.currentParishId}/anointings/${id}`;
async function openAnointing() {
    const s = await parishRef().collection("anointings").orderBy("date", "desc").limit(200).get();
    anState.list = s.docs.map(d => ({ id: d.id, ...d.data() }));
    const row = e => `<button onclick="openAnointEvent('${esc(e.id)}')" class="an-row w-full bg-white border rounded-xl p-3 text-left">
        <b>${esc(fmtLong(e.date))}</b> · ${esc(e.state || "")}${e.status === "Done" ? ` <span class="text-[10px] bg-emerald-100 rounded px-1">done</span>` : ""}<br>
        <span class="text-gray-600">${(e.candidates || []).length} candidates · ${(e.candidates || []).filter(c => c.anointed).length} anointed${(e.candidates || []).some(c => c.flagged) ? ` · <span class="text-amber-700">⚠ ${(e.candidates || []).filter(c => c.flagged).length} under 3 years</span>` : ""}</span></button>`;
    const up = anState.list.filter(e => e.date >= localToday()).reverse(), past = anState.list.filter(e => e.date < localToday());
    $("an_list").innerHTML = `<p class="text-[10px] uppercase font-semibold text-gray-500">Coming up (${up.length})</p><div class="an-up space-y-2">${up.map(row).join("") || `<p class="text-gray-400 italic">None.</p>`}</div>
        <p class="text-[10px] uppercase font-semibold text-gray-500 mt-2">Past (${past.length})</p><div class="an-past space-y-2">${past.map(row).join("") || `<p class="text-gray-400 italic">None.</p>`}</div>`;
}
function openAnointForm(id) {
    const e = id ? anState.list.find(x => x.id === id) : {};
    p9Modal(id ? "Edit anointing" : "New anointing", `
        <label class="block font-semibold">Date</label><input id="an_date" type="date" class="w-full border p-2 rounded" value="${esc(e.date || "")}">
        <label class="block font-semibold">State</label><input id="an_state" class="w-full border p-2 rounded" value="${esc(e.state ?? localState.parish.state ?? "")}">
        <label class="block font-semibold">Anointing pastor</label><input id="an_pastor" class="w-full border p-2 rounded" value="${esc(e.pastor || "")}">
        <label class="block font-semibold">Approved by (e.g. Shepherd in charge)</label><input id="an_appr" class="w-full border p-2 rounded" value="${esc(e.approvedBy || "")}">
        <label class="block font-semibold">Notes</label><textarea id="an_notes" rows="2" class="w-full border p-2 rounded">${esc(e.notes || "")}</textarea>`,
        `<button id="saveAnBtn" onclick="saveAnointEvent('${esc(id || "")}')" class="px-3 py-2 bg-blue-900 text-white rounded font-bold">Save</button>`);
}
async function anWrite(id, next, before, action, reason = "") {
    const b = db.batch();
    b.set(anRef(id), next);
    parishAudit(b, anTarget(id), next.version, action, before, pick(next, ["date", "state", "pastor", "approvedBy", "status"]), reason);
    return b;
}
async function saveAnointEvent(id) {
    const o = id ? anState.list.find(x => x.id === id) : null;
    const f = { date: $("an_date").value, state: val("an_state").slice(0, 60), pastor: val("an_pastor").slice(0, 120), approvedBy: val("an_appr").slice(0, 120), notes: val("an_notes").slice(0, 1000) };
    if (!f.date) return alert("Pick the anointing date.");
    await busy("saveAnBtn", async () => {
        try {
            const ref = o ? anRef(o.id) : parishRef().collection("anointings").doc();
            const { id: _, ...prev } = o || {};
            const rec = { ...prev, ...f, parishName: localState.parish.name || "", status: o ? o.status : "Planned", candidates: o ? o.candidates : [],
                version: o ? o.version + 1 : 1, updatedAt: nowIso(), updatedBy: localState.user.uid, ...(o ? {} : { createdAt: nowIso(), createdBy: localState.user.uid }) };
            await (await anWrite(ref.id, rec, o ? pick(o, Object.keys(f)) : null, o ? "update" : "create")).commit();
            closeModal("p9Modal");
            await openAnointing();
            await openAnointEvent(ref.id);
        } catch (e) { alert("Not saved: " + e.message); }
    });
}
async function openAnointEvent(id) {
    const d = await anRef(id).get();
    anState.sel = { id, ...d.data() };
    const e = anState.sel, cur = localState.parish.currency;
    const cs = await db.collection("certificates").where("parishId", "==", localState.currentParishId).where("eventId", "==", id).get();
    anState.certs = Object.fromEntries(cs.docs.map(x => [x.data().memberNo, x.data()]));
    const certTxt = c => { const x = anState.certs[c.memberNo]; return !c.anointed ? "" : !x ? `<span class="text-gray-500">Certificate: not requested</span>`
        : x.status === "Issued" ? `<span class="text-emerald-700">Certificate issued: <b>${esc(x.certNo)}</b> (${esc(fmtLong(x.issuedDate))})</span>` : `<span class="text-blue-700">Certificate requested from HQ</span>`; };
    const card = (c, i) => `<div class="an-cand border rounded p-2 space-y-1 ${c.flagged ? "border-amber-400 bg-amber-50" : ""}" data-no="${esc(c.memberNo)}">
        <div class="flex items-start gap-2">${c.anointed ? `<i class="fa-solid fa-circle-check text-emerald-600 mt-0.5"></i>` : `<input type="checkbox" class="an-tick mt-0.5" data-i="${i}" checked aria-label="Tick to anoint">`}
        <div class="flex-1"><b>${esc(c.fullName)}</b> <span class="font-mono text-gray-500">${esc(c.memberNo)}</span><br>
        ${esc(c.fromRank)} → ${c.anointed ? `<b>${esc(c.toRank)}</b>` : `<select class="an-to border rounded p-1" data-i="${i}">${ranksFor(c.gender).map(r => `<option ${r === c.toRank ? "selected" : ""}>${esc(r)}</option>`).join("")}</select>`}
        ${c.flagged ? `<br><span class="an-flag text-amber-800">⚠ Last anointed ${esc(fmtLong(c.lastAnointed))}: under ${MIN_GAP_YEARS} years ago (allowed, please check)</span>` : ""}
        <br>Amount paid: ${c.anointed ? (c.amount != null ? esc(money(cur, c.amount)) : "—") : `<input type="number" min="0" step="0.01" class="an-amt border rounded p-1 w-28" data-i="${i}" value="${c.amount ?? ""}">`}
        <br>${certTxt(c)}</div></div></div>`;
    const cands = e.candidates || [], waiting = cands.some(c => !c.anointed), noCert = cands.filter(c => c.anointed && !anState.certs[c.memberNo]).length;
    p9Modal(`Anointing ${fmtLong(e.date)}`, `<p><b>${esc(e.state || "")}</b> · ${esc(e.parishName || "")}${e.pastor ? " · Pastor: " + esc(e.pastor) : ""}${e.approvedBy ? " · Approved by " + esc(e.approvedBy) : ""}</p>
        <p>${cands.length} candidates · total paid ${esc(money(cur, cands.reduce((t, c) => t + (c.amount || 0), 0)))}</p>
        <div id="an_cands" class="space-y-1">${cands.map(card).join("") || `<p class="text-gray-400 italic">No candidates yet.</p>`}</div>
        <p class="font-bold mt-2">Add a candidate</p><input id="an_q" oninput="findAnPeople()" class="w-full border p-2 rounded" placeholder="Type a name"><div id="an_found" class="space-y-1"></div>`,
        `<button onclick="openAnointForm('${esc(id)}')" class="px-3 py-2 border rounded font-bold">Edit</button>
        ${waiting ? `<button id="saveCandBtn" onclick="saveCandidates()" class="px-3 py-2 border rounded font-bold">Save amounts</button>
        <button id="anointBtn" onclick="markAnointed()" class="px-3 py-2 bg-emerald-700 text-white rounded font-bold">Mark ticked as anointed</button>` : ""}
        ${noCert ? `<button id="certReqBtn" onclick="requestCerts()" class="px-3 py-2 bg-blue-900 text-white rounded font-bold">Request ${noCert} HQ certificate${noCert > 1 ? "s" : ""}</button>` : ""}`);
}
let anTimer = null;
function findAnPeople() { clearTimeout(anTimer); anTimer = setTimeout(() => runAnFind().catch(e => alert(e.message)), 250); }
async function runAnFind() {
    const have = new Set((anState.sel.candidates || []).map(c => c.memberNo));
    const found = (await findMembers(val("an_q"))).filter(m => !have.has(m.memberNo));
    $("an_found").innerHTML = found.map(m => `<button onclick="addCandidate('${esc(m.memberNo)}')" class="an-match w-full text-left border rounded p-2 bg-emerald-50">+ ${esc(m.fullName)} <span class="text-gray-500">${esc(m.rank || baseRank(m.gender))}</span></button>`).join("")
        || (val("an_q").length >= 2 ? `<p class="text-gray-400">No match.</p>` : "");
}
// Reads the amount + new-rank boxes into the candidate list.
function readCandidates() {
    const cands = (anState.sel.candidates || []).map(c => ({ ...c }));
    document.querySelectorAll(".an-amt").forEach(el => { const n = el.value === "" ? null : Math.round(Number(el.value) * 100) / 100; cands[el.dataset.i].amount = n; });
    document.querySelectorAll(".an-to").forEach(el => cands[el.dataset.i].toRank = el.value);
    if (cands.some(c => c.amount != null && !(c.amount >= 0))) throw new Error("Amounts cannot be negative.");
    return cands;
}
async function candSave(cands, action, reason, after, extra = {}) {
    const { id, ...prev } = anState.sel;
    const rec = { ...prev, ...extra, candidates: cands, version: anState.sel.version + 1, updatedAt: nowIso(), updatedBy: localState.user.uid };
    const b = await anWrite(id, rec, null, action, reason);
    if (after) after(b, rec);
    await b.commit();
    anState.sel = { id, ...rec };
    return rec;
}
async function addCandidate(no) {
    try {
        const cands = readCandidates();
        if (cands.length >= 100) return alert("An anointing keeps at most 100 candidates.");
        const m = (await parishRef().collection("members").doc(no).get()).data();
        if (!m || m.status !== "Active") return alert("Only active members of this parish can be candidates.");
        const last = lastAnointed(m, await loadRankHist(no)), from = m.rank || baseRank(m.gender);
        cands.push({ memberNo: no, fullName: m.fullName, gender: m.gender, fromRank: from, toRank: nextRank(m.gender, from), amount: null,
            flagged: tooSoon(last, anState.sel.date), lastAnointed: last, anointed: false });
        await candSave(cands, "candidate-add", `${m.fullName} (${no})`);
        await openAnointEvent(anState.sel.id);
    } catch (e) { alert("Not saved: " + e.message); }
}
async function saveCandidates() {
    await busy("saveCandBtn", async () => {
        try { await candSave(readCandidates(), "candidates", "amounts / ranks"); await openAnointEvent(anState.sel.id); }
        catch (e) { alert("Not saved: " + e.message); }
    });
}
// One tap: every ticked candidate gets the new rank, a rank-history entry and the anointment date.
// One small batch per person (Firestore limits how many records the rules may check in one write), so a
// dropped connection can simply be retried: people already done stay done.
async function markAnointed() {
    let cands;
    try { cands = readCandidates(); } catch (e) { return alert(e.message); }
    const ticks = [...document.querySelectorAll(".an-tick:checked")].map(el => Number(el.dataset.i));
    if (!ticks.length) return alert("Tick the people who were anointed.");
    if (anState.sel.date > localToday() && !confirm("This anointing date is in the future. Mark them anointed anyway?")) return;
    const flagged = ticks.filter(i => cands[i].flagged).length;
    if (!confirm(`Mark ${ticks.length} ${ticks.length === 1 ? "person" : "people"} as anointed on ${fmtLong(anState.sel.date)}?${flagged ? `\n${flagged} of them were anointed under ${MIN_GAP_YEARS} years ago.` : ""}\nTheir rank changes now and goes into their history.`)) return;
    await busy("anointBtn", async () => {
        let done = 0;
        try {
            for (const i of ticks) {
                const c = cands[i];
                const m = (await parishRef().collection("members").doc(c.memberNo).get()).data();
                if (!m || m.status !== "Active") throw new Error(`${c.fullName} is no longer an active member here.`);
                const h = await loadRankHist(c.memberNo);
                cands[i] = { ...c, fromRank: m.rank || baseRank(m.gender), anointed: true };
                const left = cands.some(x => !x.anointed);
                await candSave(cands, "anoint", `${c.fullName}: ${cands[i].fromRank} -> ${c.toRank}`, b => {
                    rankHistWrite(b, m, h, { date: anState.sel.date, from: cands[i].fromRank, to: c.toRank, parish: localState.parish.name || "",
                        pastor: anState.sel.pastor || "", approvedBy: anState.sel.approvedBy || "", eventId: anState.sel.id, kind: "anointment", by: localState.user.uid });
                    memberRankWrite(b, m, c.toRank, anState.sel.date);
                }, left ? {} : { status: "Done" });
                done++;
            }
        } catch (e) { alert(`Stopped after ${done}: ${e.message}`); }
        await openAnointing();
        await openAnointEvent(anState.sel.id);
        loadMembers(true).catch(() => {});
    });
}
async function requestCerts() {
    const e = anState.sel, list = (e.candidates || []).filter(c => c.anointed && !anState.certs[c.memberNo]);
    await busy("certReqBtn", async () => {
        try {
            for (const c of list) {
                const id = `${localState.currentParishId}_${e.id}_${c.memberNo}`, t = "certificates/" + id, b = db.batch();
                b.set(db.collection("certificates").doc(id), { parishId: localState.currentParishId, parishName: localState.parish.name || "", eventId: e.id,
                    eventDate: e.date, memberNo: c.memberNo, fullName: c.fullName, rank: c.toRank, status: "Requested", version: 1, updatedAt: nowIso(), updatedBy: localState.user.uid });
                parishAudit(b, t, 1, "cert-request", null, { rank: c.toRank });
                await b.commit();
            }
        } catch (err) { alert("Not saved: " + err.message); }
        await openAnointEvent(e.id);
    });
}

// ================================================================= 4. SUPER ADMIN
async function renderAnointDash() {
    if (localState.role !== "super_admin") return;
    const [ev, certs] = await Promise.all([db.collectionGroup("anointings").get(), db.collection("certificates").get()]);
    const names = localState.parishNames || {}, today = localToday();
    const all = ev.docs.map(d => ({ parishId: d.ref.parent.parent.id, ...d.data() }));
    const up = all.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const byState = {};
    up.forEach(e => (byState[e.state || "State not set"] ||= []).push(e));
    const cs = certs.docs.map(d => d.data()), pending = cs.filter(c => c.status === "Requested").length;
    const flagged = up.flatMap(e => (e.candidates || []).filter(c => c.flagged && !c.anointed).map(c => ({ ...c, parish: names[e.parishId] || e.parishName, date: e.date })));
    // Rank counts church-wide (active members in the directory). count() keeps this cheap at any size.
    const ranks = [...RANKS_F, ...RANKS];
    const counts = await Promise.all(ranks.map(r => { const q = db.collection("directory").where("status", "==", "Active").where("rank", "==", r);
        return q.count ? q.count().get().then(s => s.data().count) : q.get().then(s => s.size); }));
    const rc = ranks.map((r, i) => [r, counts[i]]).filter(x => x[1]);
    $("anointDash").innerHTML = `<div class="flex justify-between items-center"><p class="font-bold text-sm"><i class="fa-solid fa-oil-can text-amber-600 mr-1"></i> Anointing</p>
        <button onclick="showSection('anointingAll')" class="px-3 py-1.5 bg-blue-900 text-white rounded font-semibold">Open</button></div>
        <div class="grid grid-cols-3 gap-2 text-center">
            <div class="bg-white rounded border p-2"><p class="text-[9px] uppercase text-gray-500 font-semibold">Upcoming</p><p id="ad_up" class="text-lg font-bold">${up.length}</p></div>
            <div class="bg-white rounded border p-2"><p class="text-[9px] uppercase text-gray-500 font-semibold">Certs pending</p><p id="ad_pending" class="text-lg font-bold text-blue-800">${pending}</p></div>
            <div class="bg-white rounded border p-2"><p class="text-[9px] uppercase text-gray-500 font-semibold">Certs issued</p><p id="ad_issued" class="text-lg font-bold text-emerald-700">${cs.length - pending}</p></div></div>
        <p class="font-semibold">Upcoming dates by state</p>
        ${Object.keys(byState).sort().map(s => `<p class="ad-state"><b>${esc(s)}</b>: ${byState[s].map(e => `${esc(names[e.parishId] || e.parishName)} ${esc(fmtLong(e.date))} (${(e.candidates || []).length} candidates)`).join("; ")}</p>`).join("") || `<p class="text-gray-400 italic">No anointing dates set yet.</p>`}
        <p class="font-semibold">Flagged: anointed under ${MIN_GAP_YEARS} years ago (${flagged.length})</p>
        ${flagged.slice(0, 20).map(c => `<p class="ad-flag text-amber-800">⚠ ${esc(c.fullName)}, ${esc(c.parish)}: last ${esc(fmtLong(c.lastAnointed))}, due ${esc(fmtLong(c.date))}</p>`).join("") || `<p class="text-gray-400 italic">None.</p>`}
        <details><summary class="font-semibold">Rank counts church-wide</summary>
        <table class="w-full">${rc.map(([r, n]) => `<tr class="border-t"><td class="p-1">${esc(r)}</td><td class="p-1 text-right font-bold">${n}</td></tr>`).join("") || `<tr><td class="p-1 text-gray-400">No ranks recorded yet.</td></tr>`}</table></details>`;
    $("anointDash").classList.remove("hidden");
}
async function openAnointingAll() {
    $("aa_nameBox").classList.toggle("hidden", !!localState.name);
    const s = await db.collection("certificates").get();
    const list = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.status === b.status ? a.eventDate.localeCompare(b.eventDate) : a.status === "Requested" ? -1 : 1));
    $("aa_certs").innerHTML = list.map(c => `<div class="aa-cert bg-white border rounded-xl p-3"><b>${esc(c.fullName)}</b> · ${esc(c.rank)}<br>
        <span class="text-gray-600">${esc(c.parishName)} · anointed ${esc(fmtLong(c.eventDate))}</span><br>
        ${c.status === "Issued" ? `<span class="text-emerald-700">Issued <b>${esc(c.certNo)}</b> on ${esc(fmtLong(c.issuedDate))}</span>`
            : `<button onclick="openIssueCert('${esc(c.id)}')" class="aa-issue mt-1 px-3 py-1.5 bg-blue-900 text-white rounded font-semibold">Issue certificate</button>`}</div>`).join("")
        || `<p class="text-gray-400 italic">No certificate requests yet.</p>`;
    await renderAnointDash();
}
function openIssueCert(id) {
    p9Modal("Issue certificate", `<label class="block font-semibold">Certificate number</label><input id="aa_no" class="w-full border p-2 rounded" maxlength="40">
        <label class="block font-semibold">Date issued</label><input id="aa_date" type="date" class="w-full border p-2 rounded" value="${localToday()}">`,
        `<button id="issueCertBtn" onclick="issueCert('${esc(id)}')" class="px-3 py-2 bg-blue-900 text-white rounded font-bold">Issue</button>`);
}
async function issueCert(id) {
    if (needName()) return;
    const no = val("aa_no"), date = $("aa_date").value;
    if (!no || !date) return alert("Fill in the certificate number and date.");
    await busy("issueCertBtn", async () => {
        try {
            const ref = db.collection("certificates").doc(id), o = (await ref.get()).data();
            const next = { ...o, status: "Issued", certNo: no.slice(0, 40), issuedDate: date, version: o.version + 1, updatedAt: nowIso(), updatedBy: localState.user.uid };
            const b = db.batch();
            b.set(ref, next);
            b.set(db.collection("auditLog").doc(`certificates_${id}_v${next.version}`), { action: "cert-issue", target: "certificates/" + id, targetVersion: next.version,
                parishId: o.parishId, reason: "", before: { status: o.status }, after: { certNo: next.certNo, issuedDate: date }, by: localState.user.uid,
                byEmail: (localState.user.email || "").toLowerCase(), byName: localState.name || "", role: localState.role, at: srv() });
            await b.commit();
            closeModal("p9Modal");
            await openAnointingAll();
        } catch (e) { alert("Not saved: " + e.message); }
    });
}

// ================================================================= 5. PRINTABLES
function showPrintSheet(html) {
    $("printSheetBody").innerHTML = html;
    $("printSheet").classList.remove("hidden");
    document.body.classList.add("p16-print");
}
function closePrintSheet() { $("printSheet").classList.add("hidden"); document.body.classList.remove("p16-print"); }
const line = (label, value = "") => `<div class="ps-line"><span class="ps-label">${esc(label)}</span><span class="ps-val">${esc(value)}</span></div>`;
const boxes = (opts, chosen) => `<span class="ps-boxes">${opts.map(o => `<span>${o === chosen ? "☑" : "☐"} ${esc(o)}</span>`).join("")}</span>`;
function sheetHead(title) {
    const p = localState.parish || {};
    return `<div class="ps-head"><img src="assets/ccc-logo.png" alt="" onerror="this.remove()"><div><p class="ps-church">Celestial Church of Christ</p>
        <p>${esc(p.name || "Parish: ____________________")}</p></div></div><h1>${esc(title)}</h1>`;
}
function printBlankForm() {
    showPrintSheet(`${sheetHead("Member Data Form")}
        <p class="ps-help">Please write clearly in CAPITAL LETTERS. Tick ☑ the right box. Stick or attach a passport photo.</p>
        <div class="ps-top"><div class="ps-photo">Passport<br>photo</div><div class="ps-grow">${line("Full name")}${line("Member number (church office)")}
            <div class="ps-line"><span class="ps-label">Man or woman</span>${boxes(["Male", "Female"])}</div></div></div>
        <div class="ps-line"><span class="ps-label">Married?</span>${boxes(["Single", "Married", "Widowed", "Divorced", "Separated"])}</div>
        ${line("Home address")}${line("")}${line("Phone number")}${line("Email (if any)")}${line("Work / occupation")}
        ${line("Church rank now (e.g. Sister, Elder Brother, M/C)")}
        <div class="ps-line"><span class="ps-label">Birthday</span><span class="ps-val">Day ____ Month ________ Year ______</span></div>
        <div class="ps-line"><span class="ps-label">Wedding anniversary</span><span class="ps-val">Day ____ Month ________</span></div>
        <div class="ps-line"><span class="ps-label">Last anointment</span><span class="ps-val">Day ____ Month ________ Year ______</span></div>
        <h2>Next of kin (person to call if needed)</h2>${line("Name")}${line("Address")}${line("Phone number")}
        <h2>Agreement</h2><p class="ps-help">I agree that the church keeps these details safely, for church use only.</p>
        <div class="ps-sign">${line("Signature or thumbprint")}${line("Date")}</div>`);
}
async function printProfile() {
    const p = current.rec, h = await loadRankHist(p.memberNo).catch(() => null);
    const entries = h ? h.entries : startEntries(p);
    showPrintSheet(`${sheetHead("Member Profile")}
        <div class="ps-top"><div class="ps-photo">${p.photo ? `<img src="${esc(p.photo)}" alt="Photo">` : "Photo"}</div><div class="ps-grow">
            <p class="ps-name">${esc(p.fullName)}</p><p class="ps-no">${esc(displayNo(p))}</p><p class="ps-rank">${esc(rankText(p, baseRank(p.gender)))}</p></div></div>
        ${line("Man or woman", p.gender)}${line("Married?", p.maritalStatus)}${line("Home address", p.address)}${line("Phone number", p.phone)}
        ${line("Email", p.email)}${line("Work / occupation", p.occupation)}${line("Birthday", fmtDate(p.dobDay, p.dobMonth, p.dobYear))}
        ${line("Wedding anniversary", p.weddingDay ? fmtDate(p.weddingDay, p.weddingMonth) : "")}${line("Last anointment", fmtDate(p.anointDay, p.anointMonth, p.anointYear))}
        <h2>Next of kin</h2>${line("Name", p.nokName)}${line("Address", p.nokAddress)}${line("Phone number", p.nokPhone)}
        <h2>Rank history</h2><table class="ps-table"><tr><th>Date</th><th>Rank</th><th>Parish</th></tr>
        ${entries.map(e => `<tr><td>${esc(fmtLong(e.date))}</td><td>${e.from ? esc(e.from) + " → " : ""}<b>${esc(e.to)}</b></td><td>${esc(e.parish || "")}</td></tr>`).join("")}</table>
        <p class="ps-help">Printed ${esc(fmtLong(localToday()))}. Private: keep safe.</p>`);
}
