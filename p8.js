// CCC Parish Portal - Phase 8:
//  1. Clergy postings: Super Admin posts a clergy from parish X to parish Y (date, reason, optional letter). With a
//     Church Head, a posting waits for approval. On/after the effective date each half is applied: old parish -> Former
//     (reason Posting); new parish -> a new lettered CLG number linked to the old one. Service record appended. Audited.
//  2. Church Leader role ("Church Head"; title configurable, several holders, assigned only by a Super Admin, audited):
//     read-only church-wide dashboards + alerts + posting approval. No parish editing.
//  3. AI dashboard (Super Admin + Church Head): precomputed rollups, alert feed, AI summary from totals only.
//     The checks normally run in the scheduled server job (ai-worker, Cron Trigger); "Run checks now" is the browser fallback.

const AI_SUMMARY_URL = AI_URL.replace(/\/extract$/, "/summary");
const P8_PAGE = 20;
const isLeaderRole = () => localState.role === "super_admin" || localState.role === "church_head";
const thisMonth = () => localToday().slice(0, 7);
let leadership = { roleName: "Church Head", active: 0, version: 0 };

async function loadLeadership() {
    const s = await db.collection("hqSettings").doc("leadership").get().catch(() => null);
    leadership = s && s.exists ? s.data() : { roleName: "Church Head", active: 0, version: 0 };
    document.querySelectorAll(".leader-title").forEach(el => el.textContent = leadership.roleName);
    return leadership;
}

// ================================================================= PARISH SIDE (applied when the admin opens the app)
async function markParishActive() {
    const st = await statsRef().get();
    if (st.exists && st.data().lastActive === localToday()) return;
    await statsRef().set({ lastActive: localToday() }, { merge: true });
}
async function parishPostings() {
    const pid = localState.currentParishId;
    const [out, inn] = await Promise.all([db.collection("postings").where("fromParishId", "==", pid).get(), db.collection("postings").where("toParishId", "==", pid).get()]);
    return [...out.docs, ...inn.docs].map(d => ({ id: d.id, ...d.data() }));
}
async function applyDuePostings() {
    const pid = localState.currentParishId;
    const list = await parishPostings();
    let n = 0;
    for (const po of list) {
        if (po.status !== "Approved" || po.effectiveDate > localToday()) continue;
        if (po.fromParishId === pid && !po.departedAt) { await postingDepart(po.id); n++; }
        if (po.toParishId === pid && !po.newClergyNo) { await postingArrive(po.id); n++; }
    }
    await renderParishPostings();
    return n;
}
async function renderParishPostings() {
    const pid = localState.currentParishId;
    const list = (await parishPostings()).filter(p => !["Cancelled", "Rejected"].includes(p.status)).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate)).slice(0, 10);
    $("parishPostings").classList.toggle("hidden", !list.length);
    $("parishPostings").innerHTML = `<p class="font-bold">Clergy postings</p>` + list.map(p => `<div class="pp-row border-l-4 ${p.status === "Applied" ? "border-emerald-400" : "border-amber-400"} pl-2">
        <p><b>${esc(p.fullName)}</b> · ${p.fromParishId === pid ? `posted OUT to ${esc(p.toParishName)}` : `posted IN from ${esc(p.fromParishName)}`}</p>
        <p class="text-gray-600">Effective ${esc(p.effectiveDate)} · ${esc(p.status)}${p.newClergyNo ? ` · new number <span class="font-mono">${esc(p.newClergyNo)}</span>` : ""} · ${esc(p.reason)}</p></div>`).join("");
}

// ---- The two halves. Each is one transaction: clergy record(s) + stats + posting (version bump) + audit entry.
function postingNext(po, extra) {
    const next = { ...po, ...extra, version: po.version + 1, updatedAt: nowIso(), updatedBy: localState.user.uid };
    next.status = next.departedAt && next.newClergyNo ? "Applied" : "Approved";
    delete next.id;
    return next;
}
const POST_SNAP = ["status", "departedAt", "newClergyNo", "approvedByName", "decisionNote", "effectiveDate", "fromParishId", "toParishId", "clergyNo"];
async function postingDepart(id) {
    const ref = db.collection("postings").doc(id);
    await db.runTransaction(async t => {
        const po = { id, ...(await t.get(ref)).data() };
        if (po.status !== "Approved" || po.departedAt) return;
        const cRef = db.collection("parishes").doc(po.fromParishId).collection("clergy").doc(po.clergyNo);
        const c = (await t.get(cRef)).data();
        const eff = po.effectiveDate;
        const record = (c.serviceRecord || []).map(r => r.to ? r : { ...r, to: eff });
        record.push({ rank: `Posted to ${po.toParishName}`, from: eff, to: eff });
        t.update(cRef, { status: "Former", leftDate: eff, leaveReason: "Posting", transferredTo: po.toParishName, postingId: id,
            serviceRecord: record.slice(-40), updatedAt: nowIso() });
        t.set(db.collection("parishStats").doc(po.fromParishId), { clergyCount: inc(-1), formerClergyCount: inc(1) }, { merge: true });
        const next = postingNext(po, { departedAt: eff });
        t.set(ref, next);
        writeAudit(t, "postings/" + id, next.version, "posting-depart", pick(po, POST_SNAP), pick(next, POST_SNAP));
    });
}
async function postingArrive(id) {
    const ref = db.collection("postings").doc(id);
    // The new parish's clergy count is bumped right after (in the same transaction it exceeds the rules' 1000-expression budget).
    const to = await db.runTransaction(async t => {
        const po = { id, ...(await t.get(ref)).data() };
        if (po.status !== "Approved" || po.newClergyNo) return "";
        const pRef = db.collection("parishes").doc(po.toParishId), cntRef = pRef.collection("meta").doc("counters");
        const [par, cnt] = [(await t.get(pRef)).data(), (await t.get(cntRef)).data()];
        if (!par.parishLetters) throw new Error(`${po.toParishName} has no lettering yet, so no clergy number can be issued.`);
        const n = cnt.clg + 1, no = `CCC-${par.parishLetters}-${par.cityLetters}-CLG-${pad3(n)}`;
        const eff = po.effectiveDate, p = po.person || {};
        const record = (p.serviceRecord || []).map(r => r.to ? r : { ...r, to: eff });
        record.push({ rank: `Posted from ${po.fromParishName} (${po.clergyNo})`, from: eff, to: eff });
        if (p.rank) record.push({ rank: p.rank, from: eff });
        const { postingId, postedFrom, postedFromParishId, leftDate, leaveReason, transferredTo, letterId, deathId, ...person } = p;
        const rec = { ...person, memberNo: no, status: "Active", joinedDate: eff, serviceRecord: record.slice(-40), postingId: id,
            postedFrom: po.clergyNo, postedFromParishId: po.fromParishId, createdAt: nowIso(), updatedAt: nowIso() };
        t.update(cntRef, { clg: n });
        t.set(pRef.collection("clergy").doc(no), rec);
        t.set(db.collection("clergyIndex").doc(po.email), { parishId: po.toParishId, clergyId: no });
        const next = postingNext(po, { newClergyNo: no });
        t.set(ref, next);
        writeAudit(t, "postings/" + id, next.version, "posting-arrive", pick(po, POST_SNAP), pick(next, POST_SNAP));
        return po.toParishId;
    });
    if (to) await db.collection("parishStats").doc(to).set({ clergyCount: inc(1) }, { merge: true });
}

// ================================================================= POSTINGS SCREEN (Super Admin + Church Head)
let postForm = { letter: "" }, postCursor = null;
async function openPostings() {
    await loadLeadership();
    const isSup = localState.role === "super_admin";
    $("po_nameBox").classList.toggle("hidden", !!localState.name || !isSup);
    document.querySelectorAll(".po-super").forEach(el => el.classList.toggle("hidden", !isSup));
    if (isSup) {
        if (!register.length) await loadWorld();
        $("po_to").innerHTML = `<option value="">Pick the new parish</option>` + (localState.parishList || []).filter(p => p.status === "Approved")
            .map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.city ? " · " + esc(p.city) : ""}</option>`).join("");
        if (!$("po_date").value) $("po_date").value = localToday();
        $("po_rule").textContent = leadership.active > 0 ? `Postings need approval by the ${leadership.roleName} before they take effect.`
            : `No ${leadership.roleName} is assigned, so postings take effect on the date without approval.`;
        await renderLeaders();
    }
    await loadPostings();
}
function findPostClergy() {
    const t = val("po_q").toLowerCase();
    $("po_found").innerHTML = t.length < 2 ? "" : register.filter(c => c.status === "Active" && [c.fullName, c.memberNo, c.parish].join(" ").toLowerCase().includes(t)).slice(0, 6)
        .map(c => `<button type="button" data-p="${esc(c.parishId)}" data-no="${esc(c.memberNo)}" onclick="pickPostClergy(this.dataset.p, this.dataset.no)" class="po-opt w-full text-left border rounded p-2 bg-emerald-50">${esc(c.fullName)} <span class="font-mono">${esc(c.memberNo)}</span> · ${esc(c.parish)}</button>`).join("")
        || `<p class="text-gray-400">No active clergy found.</p>`;
}
function pickPostClergy(pid, no) {
    $("po_clergy").value = `${pid}|${no}`;
    const c = register.find(x => x.parishId === pid && x.memberNo === no);
    $("po_clergyText").textContent = `${c.fullName} (${no}) · from ${c.parish}`;
    $("po_found").innerHTML = ""; $("po_q").value = "";
}
async function pickPostLetter(input) {
    if (!input.files[0]) return;
    try { postForm.letter = await compressImage(input.files[0], 250000, 1400); $("po_letterPreview").src = postForm.letter; $("po_letterPreview").classList.remove("hidden"); }
    catch (e) { alert(e.message); }
}
async function savePosting() {
    if (needName()) return;
    const [fromId, no] = ($("po_clergy").value || "|").split("|"), toId = $("po_to").value;
    const eff = $("po_date").value, reason = val("po_reason");
    if (!no || !toId || !eff || !reason) return alert("Pick the clergy, the new parish, the effective date and give a reason.");
    if (fromId === toId) return alert("The new parish must be different from the current one.");
    await busy("savePostingBtn", async () => {
        try {
            await loadLeadership();
            const c = (await db.collection("parishes").doc(fromId).collection("clergy").doc(no).get()).data();
            if (c.status !== "Active") throw new Error("This clergy is not active in that parish any more.");
            const names = localState.parishNames || {};
            const ref = db.collection("postings").doc();
            const rec = { clergyNo: no, fullName: c.fullName, email: c.email, person: c, fromParishId: fromId, fromParishName: names[fromId] || fromId,
                toParishId: toId, toParishName: names[toId] || toId, effectiveDate: eff, reason: reason.slice(0, 300), letter: postForm.letter || "",
                status: leadership.active > 0 ? "Pending approval" : "Approved", departedAt: "", newClergyNo: "", approvedBy: "", approvedByName: "", decisionNote: "",
                version: 1, createdAt: nowIso(), createdBy: localState.user.uid, createdByName: localState.name, updatedAt: nowIso(), updatedBy: localState.user.uid };
            const b = db.batch();
            b.set(ref, rec);
            writeAudit(b, "postings/" + ref.id, 1, "posting", null, pick(rec, POST_SNAP), reason);
            await b.commit();
            ["po_clergy", "po_reason", "po_letter"].forEach(id => $(id).value = ""); $("po_clergyText").textContent = "No clergy picked";
            postForm.letter = ""; $("po_letterPreview").classList.add("hidden");
            await loadPostings();
        } catch (e) { alert("Not saved: " + e.message); }
    });
}
async function loadPostings(more) {
    let q = db.collection("postings").orderBy("createdAt", "desc").limit(P8_PAGE);
    if (more && postCursor) q = q.startAfter(postCursor);
    const s = await q.get();
    if (s.docs.length) postCursor = s.docs[s.docs.length - 1];
    const html = s.docs.map(d => postingCard({ id: d.id, ...d.data() })).join("");
    if (more) $("po_list").insertAdjacentHTML("beforeend", html);
    else $("po_list").innerHTML = html || `<p class="text-gray-400 italic">No postings yet.</p>`;
    $("po_more").classList.toggle("hidden", s.size < P8_PAGE);
}
const PO_COLOR = { "Pending approval": "bg-amber-100", Approved: "bg-blue-100", Applied: "bg-emerald-100", Rejected: "bg-rose-100", Cancelled: "bg-gray-200" };
function postingCard(p) {
    const head = localState.role === "church_head", sup = localState.role === "super_admin";
    const due = p.effectiveDate <= localToday();
    let act = "";
    if (head && p.status === "Pending approval") act = `<button onclick="decidePosting('${esc(p.id)}', true)" class="po-approve px-3 py-1 bg-emerald-700 text-white rounded font-bold">Approve</button>
        <button onclick="decidePosting('${esc(p.id)}', false)" class="po-reject px-3 py-1 border rounded text-rose-700">Reject</button>`;
    if (sup && ["Pending approval", "Approved"].includes(p.status) && !p.departedAt && !p.newClergyNo) act += `<button onclick="cancelPosting('${esc(p.id)}')" class="po-cancel px-3 py-1 border rounded">Cancel</button>`;
    if (sup && p.status === "Approved" && due) act += `<button onclick="applyPostingNow('${esc(p.id)}')" class="po-apply px-3 py-1 bg-blue-900 text-white rounded font-bold">Apply now</button>`;
    return `<div class="po-row bg-white border rounded-xl p-2 space-y-1"><div class="flex justify-between items-center"><p class="font-bold">${esc(p.fullName)} <span class="font-mono text-gray-500">${esc(p.clergyNo)}</span></p>
        <span class="po-status px-2 py-0.5 rounded text-[10px] font-bold ${PO_COLOR[p.status] || ""}">${esc(p.status)}</span></div>
        <p>${esc(p.fromParishName)} <i class="fa-solid fa-arrow-right"></i> ${esc(p.toParishName)} · effective <b>${esc(p.effectiveDate)}</b></p>
        <p class="text-gray-600">Reason: ${esc(p.reason)} · posted by ${esc(p.createdByName)}</p>
        ${p.approvedByName ? `<p class="text-gray-600">${p.status === "Rejected" ? "Rejected" : "Approved"} by ${esc(p.approvedByName)}${p.decisionNote ? ": " + esc(p.decisionNote) : ""}</p>` : p.decisionNote ? `<p class="text-gray-600">${esc(p.decisionNote)}</p>` : ""}
        <p class="text-gray-600">Old parish: ${p.departedAt ? "moved to Former" : "waiting"} · New parish: ${p.newClergyNo ? `<span class="font-mono">${esc(p.newClergyNo)}</span>` : "waiting"}</p>
        ${p.letter ? `<details><summary class="underline text-blue-700">Posting letter</summary><img src="${esc(p.letter)}" alt="Posting letter" class="w-full border rounded mt-1"></details>` : ""}
        <div class="flex gap-1 flex-wrap">${act}</div></div>`;
}
async function changePosting(id, fn, action, reason) {
    const ref = db.collection("postings").doc(id);
    await db.runTransaction(async t => {
        const po = (await t.get(ref)).data();
        const next = { ...po, ...fn(po), version: po.version + 1, updatedAt: nowIso(), updatedBy: localState.user.uid };
        t.set(ref, next);
        writeAudit(t, "postings/" + id, next.version, action, pick(po, POST_SNAP), pick(next, POST_SNAP), reason);
    });
}
async function decidePosting(id, yes) {
    if (!localState.name) return alert("Your account has no name on record; ask the Super Admin.");
    const note = (prompt(yes ? "Note for the record (optional):" : "Why is this posting rejected?") ?? null);
    if (note === null || (!yes && !note.trim())) return;
    try {
        await changePosting(id, () => ({ status: yes ? "Approved" : "Rejected", approvedBy: localState.user.uid, approvedByName: localState.name, decisionNote: note.trim().slice(0, 300) }),
            yes ? "posting-approve" : "posting-reject", note.trim());
        await loadPostings();
    } catch (e) { alert("Not saved: " + e.message); }
}
async function cancelPosting(id) {
    if (needName()) return;
    const note = (prompt("Why is this posting cancelled?") || "").trim();
    if (!note) return;
    try { await changePosting(id, () => ({ status: "Cancelled", decisionNote: note.slice(0, 300) }), "posting-cancel", note); await loadPostings(); }
    catch (e) { alert("Not saved: " + e.message); }
}
async function applyPostingNow(id) {
    if (needName()) return;
    try { await postingDepart(id); await postingArrive(id); await loadWorld(); await loadPostings(); }
    catch (e) { alert("Not applied: " + e.message); }
}

// ---- Leadership (Super Admin): title, holders, invite. Every change audited; nothing deleted (holders are Revoked).
async function renderLeaders() {
    const s = await db.collection("leaders").get();
    $("ld_title").value = leadership.roleName;
    $("ld_list").innerHTML = s.docs.map(d => d.data()).map(l => `<div class="ld-row border rounded p-2 flex items-center gap-2"><span class="flex-1"><b>${esc(l.name)}</b> · ${esc(l.email)} · ${esc(l.status)}</span>
        ${l.status === "Active" ? `<button data-e="${esc(l.email)}" onclick="setLeader(this.dataset.e, false)" class="px-2 py-1 border rounded text-rose-700">Revoke</button>` : `<button data-e="${esc(l.email)}" data-n="${esc(l.name)}" onclick="setLeader(this.dataset.e, true, this.dataset.n)" class="px-2 py-1 border rounded">Restore</button>`}</div>`).join("")
        || `<p class="text-gray-400 italic">Nobody holds this role.</p>`;
}
async function saveLeaderTitle() {
    if (needName()) return;
    const name = val("ld_title"), reason = val("ld_reason");
    if (!name || !reason) return alert("Enter the title and a reason.");
    try { await leadershipTx(null, name, reason); await openPostings(); } catch (e) { alert("Not saved: " + e.message); }
}
// One transaction: leaders/{email} (optional) + hqSettings/leadership (active count, title) + audit entries (+ invite).
async function leadershipTx(leader, roleName, reason, invite) {
    const lRef = db.collection("hqSettings").doc("leadership");
    await db.runTransaction(async t => {
        const o = await t.get(lRef), od = o.exists ? o.data() : { roleName: "Church Head", active: 0, version: 0 };
        let active = od.active, lastLeader = od.lastLeader || "";
        if (leader) {
            const ref = db.collection("leaders").doc(leader.email), prev = await t.get(ref), pd = prev.exists ? prev.data() : null;
            const rec = { name: leader.name, email: leader.email, status: leader.status, note: reason.slice(0, 300), version: pd ? pd.version + 1 : 1, updatedAt: nowIso(), updatedBy: localState.user.uid };
            t.set(ref, rec);
            writeAudit(t, "leaders/" + leader.email, rec.version, leader.status === "Active" ? "leader-assign" : "leader-revoke", pd ? { status: pd.status } : null, { status: rec.status, name: rec.name }, reason);
            active += leader.status === "Active" ? 1 : -1; lastLeader = leader.email;
        }
        const next = { roleName: roleName || od.roleName, active, lastLeader, version: od.version + 1, updatedAt: nowIso(), updatedBy: localState.user.uid };
        t.set(lRef, next);
        writeAudit(t, "hqSettings/leadership", next.version, "leadership", { roleName: od.roleName, active: od.active }, { roleName: next.roleName, active }, reason);
        if (invite) t.set(db.collection("invites").doc(invite), { email: leader.email, parishId: "", role: "church_head", usedBy: null, createdAt: nowIso() });
    });
}
async function assignLeader() {
    if (needName()) return;
    const name = val("ld_name"), email = val("ld_email").toLowerCase(), reason = val("ld_reason");
    if (name.length < 3 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !reason) return alert("Enter the full name, email and a reason.");
    const code = randomCode();
    await busy("assignLeaderBtn", async () => {
        try {
            await leadershipTx({ name, email, status: "Active" }, null, reason, code);
            $("ld_result").innerHTML = `<p class="font-bold">Assigned. Send this to ${esc(name)}:</p><p>Email: <span class="font-mono">${esc(email)}</span></p>
                <p>Invite code: <span id="leaderCode" class="font-mono font-bold select-all">${esc(code)}</span></p><p class="text-gray-600">They open the portal, tap "First time? I have an invite code", and choose a password.</p>`;
            ["ld_name", "ld_email", "ld_reason"].forEach(id => $(id).value = "");
            await openPostings();
        } catch (e) { alert("Not saved: " + e.message); }
    });
}
async function setLeader(email, on, name) {
    if (needName()) return;
    const reason = (prompt(on ? "Why is this person restored?" : "Why is this person's role revoked?") || "").trim();
    if (!reason) return;
    const l = name ? { name } : (await db.collection("leaders").doc(email).get()).data();
    try { await leadershipTx({ name: l.name, email, status: on ? "Active" : "Revoked" }, null, reason, on ? randomCode() : null); await openPostings(); }
    catch (e) { alert("Not saved: " + e.message); }
}

// ================================================================= AI DASHBOARD
let aiDash = { month: "", cursor: null, rule: "" };
async function openAiDashboard() {
    aiDash.month = thisMonth();
    $("ai_runBox").classList.toggle("hidden", localState.role !== "super_admin");
    if (!localState.parishList) await loadWorld();
    const months = Array.from({ length: 6 }, (_, i) => AlertsCore.addMonths(aiDash.month, i - 5));
    const world = await Promise.all(months.map(m => db.collection("statsRollups").doc(`${m}_world_all`).get()));
    const w = world.map((d, i) => ({ month: months[i], ...(d.exists ? d.data() : {}) }));
    const cur = w[5], prev = w[4];
    const tile = (label, k, id) => { const v = cur[k] ?? 0, p = prev[k], d = p === undefined ? "" : v - p;
        return `<div class="bg-white p-2 rounded-xl border text-center"><p class="text-[9px] uppercase text-gray-500 font-semibold">${label}</p><p id="${id}" class="text-lg font-bold">${Number(v).toLocaleString()}</p>
        <p class="text-[10px] ${d < 0 ? "text-rose-700" : "text-emerald-700"}">${d === "" ? "—" : (d >= 0 ? "▲ " : "▼ ") + Math.abs(d).toLocaleString() + " vs last month"}</p></div>`; };
    $("ai_tiles").innerHTML = tile("Parishes", "parishes", "ai_parishes") + tile("Members", "members", "ai_members") + tile("Clergy", "clergy", "ai_clergy")
        + tile("Attendance (month)", "attendance", "ai_att") + tile("Births (month)", "birthsMonth", "ai_births") + tile("Deaths (month)", "deathsMonth", "ai_deaths")
        + tile("Returns filed", "returnsFiled", "ai_returns");
    $("ai_updated").textContent = cur.updatedAt ? `Totals last computed ${cur.updatedAt.replace("T", " ").slice(0, 16)} UTC.` : "No totals computed yet this month. The daily server job (or Run checks now) fills them.";
    $("ai_trend").innerHTML = ["members", "attendance", "birthsMonth", "deathsMonth"].map(k => bars({ members: "Members", attendance: "Attendance", birthsMonth: "Births", deathsMonth: "Deaths" }[k], w.map(x => [x.month, x[k] || 0]))).join("");
    await Promise.all([loadAiLevels(), loadAiAlerts(), loadAiSummary()]);
}
// Simple bar chart (no library): one bar per month, value on top. Totals only.
function bars(title, rows) {
    const max = Math.max(1, ...rows.map(r => r[1]));
    return `<div class="trend bg-white border rounded-xl p-2"><p class="font-bold mb-1">${esc(title)}</p><div class="flex items-end gap-1 h-24">` +
        rows.map(([m, v]) => `<div class="flex-1 flex flex-col items-center justify-end h-full"><span class="text-[9px]">${Number(v).toLocaleString()}</span>
        <div class="w-full bg-indigo-500 rounded-t" style="height:${Math.round(70 * v / max)}%"></div><span class="text-[9px] text-gray-500">${MONTHS[Number(m.slice(5)) - 1].slice(0, 3)}</span></div>`).join("") + `</div></div>`;
}
async function loadAiLevels() {
    const level = $("ai_level").value, m = aiDash.month, pm = AlertsCore.addMonths(m, -1);
    const [now, before] = await Promise.all([db.collection("statsRollups").where("month", "==", m).where("level", "==", level).orderBy("members", "desc").limit(30).get(),
        db.collection("statsRollups").where("month", "==", pm).where("level", "==", level).get()]);
    const old = Object.fromEntries(before.docs.map(d => [d.data().key, d.data()]));
    const ch = (a, b) => b === undefined ? "" : `<span class="${a - b < 0 ? "text-rose-700" : "text-emerald-700"}">${a - b >= 0 ? "+" : ""}${a - b}</span>`;
    $("ai_levels").innerHTML = now.empty ? `<tr><td class="p-2 text-gray-400 italic" colspan="5">No totals yet.</td></tr>` : now.docs.map(d => { const r = d.data(), o = old[r.key] || {};
        return `<tr class="lvl-row"><td class="p-1 font-bold">${esc(r.name)}${r.country ? ` <span class="text-gray-400 font-normal">${esc(r.country)}</span>` : ""}</td><td class="p-1 text-right">${r.parishes}</td>
        <td class="p-1 text-right">${r.members} ${ch(r.members, o.members)}</td><td class="p-1 text-right">${r.attendance} ${ch(r.attendance, o.attendance)}</td><td class="p-1 text-right">${r.birthsMonth}/${r.deathsMonth}</td></tr>`; }).join("");
}
async function loadAiAlerts(more) {
    const m = aiDash.month;
    let q = db.collection("alerts").where("month", "in", [m, AlertsCore.addMonths(m, -1)]);
    if ($("ai_rule").value) q = q.where("rule", "==", $("ai_rule").value);
    q = q.orderBy(firebase.firestore.FieldPath.documentId()).limit(P8_PAGE);
    if (more && aiDash.cursor) q = q.startAfter(aiDash.cursor);
    const s = await q.get();
    if (s.docs.length) aiDash.cursor = s.docs[s.docs.length - 1];
    const html = s.docs.map(d => { const a = d.data();
        return `<div class="ai-alert bg-white border-l-4 ${a.status === "Open" ? "border-rose-500" : "border-gray-300"} rounded-xl p-2"><p class="font-bold">${esc(a.parishName)} <span class="text-[10px] font-normal text-gray-500">${esc(a.month)} · ${esc(a.status)}${a.by === "server-job" ? " · server" : ""}</span></p>
        <p class="text-rose-800">${esc(AlertsCore.RULE_NAMES[a.rule] || a.rule)}</p><p class="text-gray-500">${esc(a.detail)}</p></div>`; }).join("");
    if (more) $("ai_alerts").insertAdjacentHTML("beforeend", html);
    else $("ai_alerts").innerHTML = html || `<p class="text-gray-400 italic">No alerts this month or last month.</p>`;
    $("ai_alertsMore").classList.toggle("hidden", s.size < P8_PAGE);
}
async function loadAiSummary() {
    const s = await db.collection("aiSummaries").doc(aiDash.month).get();
    $("ai_summary").textContent = s.exists ? s.data().text : "No summary yet for this month. Tap Write summary.";
    $("ai_summaryMeta").textContent = s.exists ? `${s.data().alertCount} alerts · ${s.data().engine} · ${String(s.data().at).replace("T", " ").slice(0, 16)}` : "";
}
// Totals only go to the AI: counts by alert type and by country + world totals. No parish or person names.
async function summaryPayload() {
    const m = aiDash.month;
    const [al, w] = await Promise.all([readAll(db.collection("alerts").where("month", "in", [m, AlertsCore.addMonths(m, -1)]).orderBy(firebase.firestore.FieldPath.documentId())),
        db.collection("statsRollups").doc(`${m}_world_all`).get()]);
    const country = Object.fromEntries((localState.parishList || []).map(p => [p.id, p.country || "Unknown"]));
    const alerts = al.map(d => ({ rule: d.data().rule, country: country[d.data().parishId] }));
    return { totals: AlertsCore.summaryTotals(m, alerts, w.exists ? w.data() : {}), count: alerts.length };
}
async function writeAiSummary() {
    await busy("ai_summaryBtn", async () => {
        try {
            const { totals, count } = await summaryPayload();
            const token = await auth.currentUser.getIdToken();
            const r = await fetch(AI_SUMMARY_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ totals }) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.text) throw new Error(d.error || "AI service error " + r.status);
            await db.collection("aiSummaries").doc(aiDash.month).set({ month: aiDash.month, text: String(d.text).slice(0, 3000), engine: d.engine || "", alertCount: count, at: nowIso(), by: localState.user.uid });
            await loadAiSummary();
        } catch (e) { alert("Could not write the summary: " + e.message); }
    });
}

// ---- Browser fallback of the scheduled job (Super Admin): same AlertsCore functions as the server.
async function runAiChecks() {
    if (needName()) return;
    await busy("ai_runBtn", async () => {
        try {
            const r = await runChecksIn(db, localToday(), localState.user.uid);
            await openAiDashboard();
            alert(`Checked ${r.parishes} parishes: ${r.alerts} alert(s), ${r.fresh} new.`);
        } catch (e) { alert("Checks failed: " + e.message); }
    });
}
async function runChecksIn(db, today, uid) {
    const A = AlertsCore, m = today.slice(0, 7), now = nowIso();
    const [parishes, stats, rets, snaps] = await Promise.all([readAll(db.collection("parishes").orderBy(firebase.firestore.FieldPath.documentId())),
        readAll(db.collection("parishStats").orderBy(firebase.firestore.FieldPath.documentId())),
        readAll(db.collection("returns").where("month", ">=", A.addMonths(m, -7)).orderBy("month")),
        readAll(db.collection("parishMonthly").where("month", ">=", A.addMonths(m, -5)).orderBy("month"))]);
    const plist = parishes.map(d => { const { logo, ...p } = d.data(); return { id: d.id, ...p }; });
    const st = Object.fromEntries(stats.map(d => [d.id, d.data()]));
    const byParish = {}, sn = {};
    rets.forEach(x => { const r = x.data(); (byParish[r.parishId] ||= {})[r.month] = r; });
    snaps.forEach(x => { const s = x.data(); (sn[s.parishId] ||= {})[s.month] = s; });
    const nowSnap = {}, prevSnap = {};
    plist.forEach(p => { nowSnap[p.id] = A.snapshot(p, st[p.id], m, now); (sn[p.id] ||= {})[m] = nowSnap[p.id]; prevSnap[p.id] = sn[p.id][A.addMonths(m, -1)]; });
    const lm = A.addMonths(m, -1);
    const filed = new Set(plist.filter(p => byParish[p.id]?.[lm]).map(p => p.id));
    const roll = A.rollups(m, plist, nowSnap, Object.fromEntries(Object.entries(prevSnap).filter(([, v]) => v)), filed, now);
    const found = [...A.returnAlerts(lm, plist, byParish, today).map(a => ({ ...a, month: lm })), ...A.statsAlerts(m, plist, sn, today).map(a => ({ ...a, month: m }))];
    const existing = new Set((await readAll(db.collection("alerts").where("month", "in", [m, lm]).orderBy(firebase.firestore.FieldPath.documentId()))).map(x => x.id));
    const fresh = found.filter(a => !existing.has(`${a.month}_${a.parishId}_${a.rule}`));
    await commitChunks([
        ...plist.map(p => b => b.set(db.collection("parishMonthly").doc(`${p.id}_${m}`), nowSnap[p.id])),
        ...Object.entries(roll).map(([id, r]) => b => b.set(db.collection("statsRollups").doc(id), r)),
        ...fresh.map(a => b => {
            const id = `${a.month}_${a.parishId}_${a.rule}`;
            b.set(db.collection("alerts").doc(id), { ...a, detail: a.detail.slice(0, 300), status: "Open", version: 1, at: now, by: uid });
            writeAudit(b, "alerts/" + id, 1, "alert", null, { rule: a.rule, parishId: a.parishId });
        })]);
    return { parishes: plist.length, alerts: found.length, fresh: fresh.length };
}
