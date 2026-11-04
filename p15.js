// CCC Parish Portal - Batch 15:
//  1. Parish committees (parish admin): parishes/{p}/pcommittees. Quick-pick template or custom name, members picked
//     from this parish, roles (Chairman/Chairperson, Secretary, Treasurer, Member or custom), term start/end, so the list
//     shows Current / Upcoming / Past. Nothing is deleted: a committee is Dissolved, a member becomes Former.
//  2. Harvests + unit anniversaries: parishes/{p}/celebrations/{year}_{kind}, one per kind per year.
//     - Juvenile Harvest (kind "juvenile"): 1st Sunday of June, created automatically, led by Sunday School.
//     - Adult Harvest (kind "adult"): one Sunday the parish picks, on/before the Sunday before Christmas and on/after
//       the 2nd Sunday of the HQ start month (hqSettings/harvest.startMonth; default June, confirmed by Bayo).
//     - Unit anniversaries (kind "unit-{unitId}"): one date per unit; Sunday School and Parochial Committee have none.
//     Each can link to a planning committee, shows on the dashboard ~4 weeks ahead, and records attendance + income.
//  Every write bumps `version` and writes auditLog/{target}_v{version} in the same batch.
const PC_TEMPLATES = ["Harvest", "Building", "Welfare", "Anniversary", "Youth", "Evangelism", "Parochial Committee"];
const PC_ROLES = ["Chairman", "Chairperson", "Secretary", "Treasurer", "Member"];
const NO_ANNIV = ["parochial", "sundayschool"];
const REMIND_DAYS = 28;
const ymdOf = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
// The n-th Sunday of month m (1-12).
const nthSunday = (y, m, n) => ymdOf(y, m, 1 + (7 - new Date(y, m - 1, 1).getDay()) % 7 + 7 * (n - 1));
const sundayBeforeXmas = y => ymdOf(y, 12, 24 - new Date(y, 11, 24).getDay());
const fmtLong = s => s ? `${fmtDay(s)} ${s.slice(0, 4)}` : "";

function parishAudit(b, target, v, action, before, after, reason = "") {
    b.set(db.collection("auditLog").doc(target.replace(/\//g, "_") + "_v" + v), {
        action, target, targetVersion: v, parishId: localState.currentParishId, reason: String(reason).slice(0, 300),
        before: before || null, after: after || null, by: localState.user.uid, byEmail: (localState.user.email || "").toLowerCase(),
        byName: localState.name || "", role: localState.role, at: srv()
    });
}

// ================================================================= 1. PARISH COMMITTEES
let pcAll = [], pcSel = null;
const pcPhase = c => c.status === "Dissolved" || c.termEnd < localToday() ? "Past" : c.termStart > localToday() ? "Upcoming" : "Current";
async function loadPCommittees() {
    const s = await parishRef().collection("pcommittees").orderBy("termStart", "desc").get();
    pcAll = s.docs.map(d => ({ id: d.id, ...d.data() }));
    return pcAll;
}
async function openPCommittees() {
    await loadPCommittees();
    const row = c => `<button onclick="openPCommittee('${esc(c.id)}')" class="pc-row w-full bg-white border rounded-xl p-3 text-left">
        <b>${esc(c.name)}</b>${c.status === "Dissolved" ? ` <span class="text-[10px] bg-gray-200 rounded px-1">dissolved</span>` : ""}<br>
        <span class="text-gray-600">${esc(fmtLong(c.termStart))} to ${esc(fmtLong(c.termEnd))} · ${(c.members || []).filter(m => m.status === "Current").length} members</span></button>`;
    $("pc_list").innerHTML = ["Current", "Upcoming", "Past"].map(ph => {
        const rows = pcAll.filter(c => pcPhase(c) === ph);
        return `<p class="text-[10px] uppercase font-semibold text-gray-500 mt-2">${ph} (${rows.length})</p><div class="pc-${ph.toLowerCase()} space-y-2">${rows.map(row).join("") || `<p class="text-gray-400 italic">None.</p>`}</div>`;
    }).join("");
}
function pcTemplate(t) {
    if (!t) return;
    const y = new Date().getFullYear();
    $("pc_name").value = t === "Parochial Committee" ? t : `${t} Committee ${y}`;
    if (!val("pc_purpose")) $("pc_purpose").value = { Harvest: "Plan and run the harvest.", Building: "Oversee the building project.", Welfare: "Care for members in need.",
        Anniversary: "Plan the anniversary celebration.", Youth: "Youth activities.", Evangelism: "Outreach and crusades.", "Parochial Committee": "Run the parish." }[t] || "";
}
function openPCommitteeForm(id) {
    const c = id ? pcAll.find(x => x.id === id) : {};
    const y = new Date().getFullYear();
    p9Modal(id ? "Edit committee" : "New committee", `
        ${id ? "" : `<label class="block text-xs font-semibold">Quick pick</label><select id="pc_tpl" onchange="pcTemplate(this.value)" class="w-full border p-2 rounded">
            <option value="">Custom (type a name)</option>${PC_TEMPLATES.map(t => `<option>${t}</option>`).join("")}</select>`}
        <label class="block text-xs font-semibold">Name</label><input id="pc_name" class="w-full border p-2 rounded" value="${esc(c.name || "")}">
        <label class="block text-xs font-semibold">Purpose</label><textarea id="pc_purpose" class="w-full border p-2 rounded" rows="2">${esc(c.purpose || "")}</textarea>
        <div class="grid grid-cols-2 gap-2"><div><label class="block text-xs font-semibold">Term start</label><input id="pc_start" type="date" class="w-full border p-2 rounded" value="${esc(c.termStart || localToday())}"></div>
            <div><label class="block text-xs font-semibold">Term end</label><input id="pc_end" type="date" class="w-full border p-2 rounded" value="${esc(c.termEnd || ymdOf(y, 12, 31))}"></div></div>
        ${id ? `<label class="block text-xs font-semibold">Reason for change</label><input id="pc_reason" class="w-full border p-2 rounded">` : ""}`,
        `<button id="savePcBtn" onclick="savePCommittee('${esc(id || "")}')" class="px-3 py-2 bg-blue-900 text-white rounded font-bold">Save</button>`);
}
async function savePCommittee(id) {
    const o = id ? pcAll.find(x => x.id === id) : null;
    const f = { name: val("pc_name"), purpose: val("pc_purpose").slice(0, 1000), termStart: $("pc_start").value, termEnd: $("pc_end").value };
    if (!f.name || !f.termStart || !f.termEnd) return alert("Fill in the name and the term dates.");
    if (f.termEnd < f.termStart) return alert("The term cannot end before it starts.");
    await busy("savePcBtn", async () => {
        try {
            const ref = o ? parishRef().collection("pcommittees").doc(o.id) : parishRef().collection("pcommittees").doc();
            const { id: _, ...prev } = o || {};
            const rec = { ...prev, ...f, nameLower: f.name.toLowerCase(), template: o ? o.template || "" : $("pc_tpl").value,
                status: o ? o.status : "Active", members: o ? o.members || [] : [], version: o ? o.version + 1 : 1, updatedAt: nowIso(), updatedBy: localState.user.uid,
                ...(o ? {} : { createdAt: nowIso(), createdBy: localState.user.uid }) };
            const b = db.batch();
            b.set(ref, rec);
            parishAudit(b, `parishes/${localState.currentParishId}/pcommittees/${ref.id}`, rec.version, o ? "update" : "create",
                o ? pick(o, Object.keys(f)) : null, f, o ? val("pc_reason") : "");
            await b.commit();
            closeModal("p9Modal");
            await openPCommittees();
            await openPCommittee(ref.id);
        } catch (e) { alert("Not saved: " + e.message); }
    });
}
// One committee: details, current + former members, add a member from this parish.
async function openPCommittee(id) {
    const d = await parishRef().collection("pcommittees").doc(id).get();
    pcSel = { id, ...d.data() };
    const ms = pcSel.members || [], live = pcSel.status !== "Dissolved";
    const roleOpts = r => PC_ROLES.concat(PC_ROLES.includes(r) ? [] : [r]).map(x => `<option ${x === r ? "selected" : ""}>${esc(x)}</option>`).join("") + `<option value="__other">Other…</option>`;
    const card = (m, i) => `<div class="pc-member border rounded p-2 flex items-center gap-2"><span class="flex-1"><b>${esc(m.fullName)}</b> · ${esc(m.role)}<br>
        <span class="font-mono text-gray-500">${esc(m.memberNo)}</span> · ${esc(m.from)}${m.to ? " to " + esc(m.to) : ""}</span>
        ${m.status === "Current" && live ? `<select onchange="setPcRole(${i}, this)" class="border rounded p-1">${roleOpts(m.role)}</select>
        <button onclick="removePcMember(${i})" class="px-2 py-1 border rounded text-rose-700">Remove</button>` : ""}</div>`;
    const list = st => ms.map((m, i) => [m, i]).filter(([m]) => m.status === st).map(([m, i]) => card(m, i)).join("");
    const events = (await parishRef().collection("celebrations").where("committeeId", "==", id).get()).docs.map(x => x.data());
    p9Modal(pcSel.name, `<p><b>Term:</b> ${esc(fmtLong(pcSel.termStart))} to ${esc(fmtLong(pcSel.termEnd))} · <span id="pc_phase">${pcPhase(pcSel)}</span>${pcSel.status === "Dissolved" ? " (dissolved)" : ""}</p>
        ${pcSel.purpose ? `<p><b>Purpose:</b> ${esc(pcSel.purpose)}</p>` : ""}
        ${events.length ? `<p><b>Planning:</b> ${events.map(e => esc(e.title) + " " + esc(fmtLong(e.date))).join(", ")}</p>` : ""}
        <p class="font-bold mt-2">Current members</p><div id="pc_current" class="space-y-1">${list("Current") || `<p class="text-gray-400 italic">Nobody yet.</p>`}</div>
        ${live ? `<p class="font-bold mt-2">Add a member</p>
        <div class="flex gap-1"><input id="pc_q" oninput="findPcPeople()" class="flex-1 border p-2 rounded" placeholder="Type a name"><select id="pc_role" class="border p-2 rounded">${PC_ROLES.map(r => `<option>${r}</option>`).join("")}<option value="__other">Other…</option></select></div>
        <div id="pc_found" class="space-y-1"></div>` : ""}
        <p class="font-bold mt-2">Former members</p><div id="pc_former" class="space-y-1">${list("Former") || `<p class="text-gray-400 italic">None.</p>`}</div>`,
        `<button onclick="openPCommitteeForm('${esc(id)}')" class="px-3 py-2 border rounded font-bold">Edit</button>
        ${live ? `<button id="dissolvePcBtn" onclick="dissolvePCommittee()" class="px-3 py-2 border rounded text-rose-700">Dissolve</button>` : ""}`);
}
let pcTimer = null;
function findPcPeople() { clearTimeout(pcTimer); pcTimer = setTimeout(() => runPcFind().catch(e => alert(e.message)), 250); }
async function runPcFind() {
    const have = new Set((pcSel.members || []).filter(m => m.status === "Current").map(m => m.memberNo));
    const found = (await findMembers(val("pc_q"))).filter(m => !have.has(m.memberNo));
    $("pc_found").innerHTML = found.map(m => `<button onclick="addPcMember('${esc(m.memberNo)}')" class="pc-match w-full text-left border rounded p-2 bg-emerald-50">+ ${esc(m.fullName)} <span class="font-mono">${esc(m.memberNo)}</span></button>`).join("")
        || (val("pc_q").length >= 2 ? `<p class="text-gray-400">No match.</p>` : "");
}
function pickRole(sel) {
    if (sel.value !== "__other") return sel.value;
    const r = (prompt("Role name (e.g. Financial Secretary)") || "").trim().slice(0, 40);
    return r || null;
}
async function pcMembersSave(members, action, reason = "") {
    const { id, ...prev } = pcSel;
    const rec = { ...prev, members, version: pcSel.version + 1, updatedAt: nowIso(), updatedBy: localState.user.uid };
    try {
        const ref = parishRef().collection("pcommittees").doc(id), b = db.batch();
        b.set(ref, rec);
        parishAudit(b, `parishes/${localState.currentParishId}/pcommittees/${id}`, rec.version, action, null, { change: reason }, "");
        await b.commit();
        await openPCommittees();
        await openPCommittee(id);
    } catch (e) { alert("Not saved: " + e.message); }
}
async function addPcMember(no) {
    const role = pickRole($("pc_role"));
    if (!role) return;
    const m = (await parishRef().collection("members").doc(no).get()).data();
    if (!m || m.status !== "Active") return alert("Only active members of this parish can join.");
    const members = (pcSel.members || []).concat({ memberNo: no, fullName: m.fullName, role, status: "Current", from: localToday(), to: "" });
    if (members.length > 60) return alert("A committee keeps at most 60 member records.");
    await pcMembersSave(members, "member-add", `${m.fullName} (${no}) added as ${role}`);
}
async function setPcRole(i, sel) {
    const role = pickRole(sel);
    if (!role) return openPCommittee(pcSel.id);
    const members = pcSel.members.map((m, j) => j === i ? { ...m, role } : m);
    await pcMembersSave(members, "member-role", `${members[i].fullName}: ${pcSel.members[i].role} -> ${role}`);
}
async function removePcMember(i) {
    if (!confirm(`Remove ${pcSel.members[i].fullName}? They stay in the history as a former member.`)) return;
    const members = pcSel.members.map((m, j) => j === i ? { ...m, status: "Former", to: localToday() } : m);
    await pcMembersSave(members, "member-remove", `${members[i].fullName} left`);
}
async function dissolvePCommittee() {
    const reason = (prompt("Why is this committee being dissolved? (it stays in the history)") || "").trim();
    if (!reason) return;
    const { id, ...prev } = pcSel;
    const rec = { ...prev, status: "Dissolved", termEnd: pcSel.termEnd > localToday() ? localToday() : pcSel.termEnd,
        termStart: pcSel.termStart > localToday() ? localToday() : pcSel.termStart, version: pcSel.version + 1, updatedAt: nowIso(), updatedBy: localState.user.uid };
    try {
        const b = db.batch();
        b.set(parishRef().collection("pcommittees").doc(id), rec);
        parishAudit(b, `parishes/${localState.currentParishId}/pcommittees/${id}`, rec.version, "dissolve", { status: pcSel.status }, { status: "Dissolved" }, reason);
        await b.commit();
        await openPCommittees();
        await openPCommittee(id);
    } catch (e) { alert("Not saved: " + e.message); }
}

// ================================================================= 2. HARVESTS + UNIT ANNIVERSARIES
let hqHarvest = { startMonth: 6, version: 0 };
async function loadHarvestSetting() {
    const s = await db.collection("hqSettings").doc("harvest").get();
    hqHarvest = s.exists ? s.data() : { startMonth: 6, version: 0 };
}
const adultFrom = y => hqHarvest.startMonth ? nthSunday(y, hqHarvest.startMonth, 2) : "";
function adultDateError(y, date) {
    if (!date || date.slice(0, 4) !== String(y)) return `Pick a date in ${y}.`;
    if (parseYmd(date).getDay() !== 0) return "The Adult Harvest must be on a Sunday.";
    if (date > sundayBeforeXmas(y)) return `Too late: the last allowed date is ${fmtLong(sundayBeforeXmas(y))} (the Sunday before Christmas).`;
    if (adultFrom(y) && date < adultFrom(y)) return `Too early: the first allowed date is ${fmtLong(adultFrom(y))} (2nd Sunday of ${MONTHS[hqHarvest.startMonth - 1]}).`;
    return "";
}
const celebRef = id => parishRef().collection("celebrations").doc(id);
const celebTarget = id => `parishes/${localState.currentParishId}/celebrations/${id}`;
async function celebWrite(id, next, before, action, reason = "") {
    const b = db.batch();
    b.set(celebRef(id), next);
    parishAudit(b, celebTarget(id), next.version, action, before ? pick(before, ["date", "committeeId", "attendance", "income"]) : null,
        pick(next, ["date", "committeeId", "attendance", "income"]), reason);
    await b.commit();
}
// Juvenile Harvest: created automatically for the year (1st Sunday of June, led by Sunday School).
async function ensureJuvenile(y) {
    if (localState.role !== "parish_admin") return;
    const id = `${y}_juvenile`, d = await celebRef(id).get();
    if (d.exists) return;
    await celebWrite(id, { year: y, kind: "juvenile", unitId: "sundayschool", unitName: "Sunday School", title: "Juvenile Harvest",
        date: nthSunday(y, 6, 1), committeeId: "", notes: "", parishName: localState.parish.name || "", version: 1, updatedAt: nowIso(), updatedBy: localState.user.uid }, null, "auto-create");
}
let hvState = { year: new Date().getFullYear(), list: [] };
const celebUnits = () => allUnits().filter(([id]) => !NO_ANNIV.includes(id));
async function openHarvests() {
    await Promise.all([loadHarvestSetting(), localState.units ? null : loadUnits(), loadPCommittees()]);
    const y = hvState.year, now = new Date().getFullYear();
    if (y >= now && y <= now + 1) await ensureJuvenile(y);
    const s = await parishRef().collection("celebrations").orderBy("date", "desc").limit(500).get();
    hvState.list = s.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHarvests();
}
function hvYear(n) { hvState.year += n; openHarvests().catch(e => alert("Could not load: " + e.message)); }
function celebRow(c, label, sub, fallbackId) {
    const id = c ? c.id : fallbackId;
    const cm = c && c.committeeId ? pcAll.find(x => x.id === c.committeeId) : null;
    const done = c && c.date <= localToday();
    return `<button onclick="openCelebForm('${esc(id)}')" class="hv-row w-full bg-white border rounded-xl p-3 text-left" data-id="${esc(id)}">
        <b>${esc(label)}</b> <span class="text-gray-500">${esc(sub)}</span><br>
        ${c ? `<span class="hv-date font-semibold">${esc(fmtLong(c.date))}</span>${cm ? ` · <i class="fa-solid fa-people-group"></i> ${esc(cm.name)}` : ""}
            ${done ? `<br><span class="text-gray-600">Attendance ${c.attendance ?? "—"} · Income ${c.income != null ? money(localState.parish.currency, c.income) : "—"}</span>` : ""}`
        : `<span class="text-amber-700">No date set — tap to pick</span>`}</button>`;
}
function renderHarvests() {
    const y = hvState.year, by = k => hvState.list.find(c => c.id === `${y}_${k}`);
    $("hv_year").textContent = y;
    $("hv_window").innerHTML = hqHarvest.startMonth
        ? `Adult Harvest window ${y}: <b>${esc(fmtLong(adultFrom(y)))}</b> to <b>${esc(fmtLong(sundayBeforeXmas(y)))}</b> (Sundays only).`
        : `Adult Harvest: any Sunday up to <b>${esc(fmtLong(sundayBeforeXmas(y)))}</b> (Sunday before Christmas). <span id="hv_noStart" class="text-amber-700">Start month not set by HQ.</span>`;
    $("hv_harvests").innerHTML = celebRow(by("juvenile"), "Juvenile Harvest", "· led by Sunday School · 1st Sunday of June", `${y}_juvenile`)
        + celebRow(by("adult"), "Adult Harvest", "· parish picks the Sunday", `${y}_adult`);
    $("hv_units").innerHTML = celebUnits().map(([id, name]) => celebRow(by("unit-" + id), name + " anniversary", "", `${y}_unit-${id}`)).join("");
    // Totals per year (all harvests + anniversaries that recorded figures), newest first.
    const years = {};
    hvState.list.forEach(c => { const t = years[c.year] ||= { n: 0, att: 0, inc: 0, ah: null }; t.n++; t.att += c.attendance || 0; t.inc += c.income || 0; if (c.kind === "adult") t.ah = c; });
    $("hv_totals").innerHTML = `<table class="w-full"><tr class="text-left text-gray-500"><th class="p-1">Year</th><th class="p-1">Events</th><th class="p-1">Attendance</th><th class="p-1">Income</th></tr>
        ${Object.keys(years).sort().reverse().map(k => `<tr class="border-t"><td class="p-1">${k}</td><td class="p-1">${years[k].n}</td><td class="p-1">${years[k].att}</td><td class="p-1">${money(localState.parish.currency, years[k].inc)}</td></tr>`).join("")}</table>
        <p class="font-semibold mt-2">By event</p>${hvState.list.filter(c => c.attendance != null || c.income != null).map(c => `<p>${c.year} · ${esc(c.title)}: ${c.attendance ?? "—"} people, ${c.income != null ? money(localState.parish.currency, c.income) : "—"}</p>`).join("") || `<p class="text-gray-400 italic">No results recorded yet.</p>`}`;
}
function celebMeta(id) {
    const [y, kind] = [Number(id.split("_")[0]), id.slice(id.indexOf("_") + 1)];
    if (kind === "juvenile") return { y, kind, title: "Juvenile Harvest", unitId: "sundayschool", unitName: "Sunday School" };
    if (kind === "adult") return { y, kind, title: "Adult Harvest", unitId: "", unitName: "" };
    const unitId = kind.slice(5), unitName = deptName(unitId);
    return { y, kind, title: unitName + " Anniversary", unitId, unitName };
}
function openCelebForm(id) {
    const c = hvState.list.find(x => x.id === id) || {}, meta = celebMeta(id);
    const past = c.date && c.date <= localToday();
    const hint = meta.kind === "adult" ? `<p class="text-gray-500">Sundays from ${hqHarvest.startMonth ? esc(fmtLong(adultFrom(meta.y))) : "any date (start month not set by HQ)"} to ${esc(fmtLong(sundayBeforeXmas(meta.y)))}.</p>` : "";
    const cms = pcAll.filter(x => x.status !== "Dissolved");
    p9Modal(`${meta.title} ${meta.y}`, `
        <label class="block text-xs font-semibold">Date</label>
        <input id="hv_date" type="date" class="w-full border p-2 rounded" value="${esc(c.date || "")}" ${meta.kind === "juvenile" ? "disabled" : ""} min="${meta.y}-01-01" max="${meta.y}-12-31">
        ${meta.kind === "juvenile" ? `<p class="text-gray-500">Fixed: 1st Sunday of June, led by Sunday School.</p>` : hint}
        <label class="block text-xs font-semibold">Planning committee</label>
        <select id="hv_cm" class="w-full border p-2 rounded"><option value="">— none —</option>${cms.map(x => `<option value="${esc(x.id)}" ${x.id === c.committeeId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
        <label class="block text-xs font-semibold">Notes</label><textarea id="hv_notes" rows="2" class="w-full border p-2 rounded">${esc(c.notes || "")}</textarea>
        ${past ? `<p class="font-bold mt-2">After the event</p><div class="grid grid-cols-2 gap-2">
            <div><label class="block text-xs font-semibold">Attendance</label><input id="hv_att" type="number" min="0" class="w-full border p-2 rounded" value="${c.attendance ?? ""}"></div>
            <div><label class="block text-xs font-semibold">Income total</label><input id="hv_inc" type="number" min="0" step="0.01" class="w-full border p-2 rounded" value="${c.income ?? ""}"></div></div>` : ""}
        ${c.version ? `<label class="block text-xs font-semibold">Reason for change (optional)</label><input id="hv_reason" class="w-full border p-2 rounded">` : ""}`,
        `<button id="saveHvBtn" onclick="saveCeleb('${esc(id)}')" class="px-3 py-2 bg-blue-900 text-white rounded font-bold">Save</button>`);
}
async function saveCeleb(id) {
    const o = hvState.list.find(x => x.id === id), meta = celebMeta(id);
    const date = meta.kind === "juvenile" ? nthSunday(meta.y, 6, 1) : $("hv_date").value;
    if (meta.kind === "adult") { const err = adultDateError(meta.y, date); if (err) return alert(err); }
    else if (!date || date.slice(0, 4) !== String(meta.y)) return alert(`Pick a date in ${meta.y}.`);
    const num = (k, int) => { const el = $(k); if (!el || el.value === "") return null; const n = Number(el.value); return n >= 0 ? (int ? Math.round(n) : Math.round(n * 100) / 100) : NaN; };
    const attendance = num("hv_att", true), income = num("hv_inc", false);
    if (Number.isNaN(attendance) || Number.isNaN(income)) return alert("Attendance and income cannot be negative.");
    const { id: _, ...prev } = o || {};
    const rec = { ...prev, year: meta.y, kind: meta.kind, unitId: meta.unitId, unitName: meta.unitName, title: meta.title, date, committeeId: $("hv_cm").value,
        notes: val("hv_notes").slice(0, 1000), parishName: localState.parish.name || "", version: o ? o.version + 1 : 1, updatedAt: nowIso(), updatedBy: localState.user.uid };
    if ($("hv_att")) { rec.attendance = attendance; rec.income = income; }
    await busy("saveHvBtn", async () => {
        try {
            await celebWrite(id, rec, o, o ? "update" : "create", $("hv_reason") ? val("hv_reason") : "");
            closeModal("p9Modal");
            await openHarvests();
        } catch (e) { alert("Not saved: " + e.message); }
    });
}
// Dashboard: harvests + anniversaries within the next ~4 weeks.
async function renderCelebCard() {
    if (localState.role !== "parish_admin") return;
    await ensureJuvenile(new Date().getFullYear());
    const from = localToday(), to = addDays(from, REMIND_DAYS);
    const s = await parishRef().collection("celebrations").where("date", ">=", from).where("date", "<=", to).get();
    const rows = s.docs.map(d => d.data()).sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) return $("celebCard").classList.add("hidden");
    $("celebCard").innerHTML = `<p class="font-bold text-sm"><i class="fa-solid fa-wheat-awn text-amber-600 mr-1"></i> Coming up (next 4 weeks)</p>
        ${rows.map(c => `<p class="celeb-due"><b>${esc(c.title)}</b> · ${esc(fmtLong(c.date))} · in ${Math.round((parseYmd(c.date) - parseYmd(from)) / 864e5)} days${c.committeeId ? "" : ` <span class="text-amber-700">(no planning committee yet)</span>`}</p>`).join("")}
        <button onclick="showSection('harvests')" class="px-3 py-1.5 border rounded font-semibold">Open harvests</button>`;
    $("celebCard").classList.remove("hidden");
}

// ================================================================= 3. SUPER ADMIN: start month + all Adult Harvest dates
let hqHvYear = new Date().getFullYear();
async function openHarvestsAll() {
    $("ha_nameBox").classList.toggle("hidden", !!localState.name);
    await loadHarvestSetting();
    $("ha_month").innerHTML = MONTHS.map((m, i) => `<option value="${i + 1}" ${hqHarvest.startMonth === i + 1 ? "selected" : ""}>${m}</option>`).join("");
    $("ha_year").textContent = hqHvYear;
    const s = await db.collectionGroup("celebrations").where("kind", "==", "adult").where("year", "==", hqHvYear).get();
    const set = s.docs.map(d => ({ parishId: d.ref.parent.parent.id, ...d.data() })).sort((a, b) => a.date.localeCompare(b.date));
    const names = localState.parishNames || {};
    const missing = Object.keys(names).filter(p => !set.some(x => x.parishId === p));
    $("ha_list").innerHTML = `<table class="w-full"><tr class="text-left text-gray-500"><th class="p-1">Parish</th><th class="p-1">Adult Harvest</th><th class="p-1">Attendance</th><th class="p-1">Income</th></tr>
        ${set.map(x => `<tr class="ha-row border-t"><td class="p-1">${esc(names[x.parishId] || x.parishName || x.parishId)}</td><td class="p-1">${esc(fmtLong(x.date))}</td><td class="p-1">${x.attendance ?? "—"}</td><td class="p-1">${x.income ?? "—"}</td></tr>`).join("")}
        ${missing.map(p => `<tr class="border-t text-gray-400"><td class="p-1">${esc(names[p])}</td><td class="p-1" colspan="3">no date yet</td></tr>`).join("")}</table>`;
}
function haYear(n) { hqHvYear += n; openHarvestsAll().catch(e => alert("Could not load: " + e.message)); }
async function saveHarvestMonth() {
    if (needName()) return;
    const m = Number($("ha_month").value);
    await busy("saveHaBtn", async () => {
        try {
            const v = (hqHarvest.version || 0) + 1, b = db.batch();
            b.set(db.collection("hqSettings").doc("harvest"), { startMonth: m, version: v, updatedAt: nowIso(), updatedBy: localState.user.uid });
            writeAudit(b, "hqSettings/harvest", v, "settings", { startMonth: hqHarvest.startMonth }, { startMonth: m });
            await b.commit();
            await openHarvestsAll();
        } catch (e) { alert("Not saved: " + e.message); }
    });
}
