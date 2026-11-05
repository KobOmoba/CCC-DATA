// CCC Parish Portal - Batch 17: Bible readings, monthly duty roster, public church info.
//  1. Bible readings (worldwide): bibleReadings/{YYYY-MM-DD} = { date, services: [{ service, readings }] }.
//     A named Super Admin enters them (one by one or bulk paste, one line per date/service) and edits them; audited.
//     Everyone signed in reads them (and the website, without login). Parish dashboard: "This week's readings".
//     Printable month view.
//  2. Duty roster per parish: duty types (editable; defaults are a DRAFT list until Bayo confirms) in
//     parishes/{p}/rosterConfig/dutyTypes, one roster per month + revision in parishes/{p}/rosters/{YYYY-MM}_r{n}.
//     Draft -> Published. A published roster is never changed or deleted: corrections are a new revision (with a reason).
//     Clergy-only duties list only clergy (men: women are never clergy). Copy last month. Printable A4 roster.
//     Each member / clergy profile shows their upcoming duties.
//  3. Public church info: publicInfo/{parishId}. Only the fields shown on the form; the website reads it without login.

// ================================================================= 1. BIBLE READINGS
const rdState = { month: "", list: [] };
const isSuperUser = () => localState.role === "super_admin";
const monthDays = m => { const [y, mm] = m.split("-").map(Number); return new Date(y, mm, 0).getDate(); };
const prevMonth = m => { const [y, mm] = m.split("-").map(Number); return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, "0")}`; };
async function loadReadings(from, to) {
    const s = await db.collection("bibleReadings").where("date", ">=", from).where("date", "<=", to).get();
    return s.docs.map(d => d.data()).sort((a, b) => a.date.localeCompare(b.date));
}
const readingLines = r => (r.services || []).map(x => `<p><b>${esc(x.service)}:</b> ${esc(x.readings)}</p>`).join("");
async function openReadings() {
    if (!rdState.month) rdState.month = localToday().slice(0, 7);
    $("rd_month").value = rdState.month;
    $("rd_admin").classList.toggle("hidden", !isSuperUser());
    rdState.list = await loadReadings(rdState.month + "-01", rdState.month + "-31");
    $("rd_list").innerHTML = rdState.list.map(r => `<div class="rd-day bg-white border rounded-xl p-3"><div class="flex justify-between items-start gap-2">
        <p class="font-bold">${esc(fmtLong(r.date))}</p>${isSuperUser() ? `<button onclick="editReading('${esc(r.date)}')" class="rd-edit px-2 py-1 border rounded">Edit</button>` : ""}</div>
        ${readingLines(r)}</div>`).join("") || `<p class="text-gray-400 italic">No readings entered for ${esc(monthName(rdState.month))} yet.</p>`;
}
function readingsMonth() { rdState.month = $("rd_month").value || localToday().slice(0, 7); openReadings().catch(e => alert(e.message)); }
// One line per date (and service): "2026-11-08 | Sunday Service | Psalm 23; John 3:16-21". Without a service: Sunday Service.
function parseReadingLines(text) {
    const out = {}, bad = [];
    text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach((l, i) => {
        const parts = l.split("|").map(x => x.trim());
        const [date, service, readings] = parts.length >= 3 ? [parts[0], parts[1], parts.slice(2).join(" | ")] : [parts[0], "Sunday Service", parts[1]];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || isNaN(parseYmd(date)) || !readings) return bad.push(i + 1);
        (out[date] ||= []).push({ service: (service || "Sunday Service").slice(0, 80), readings: readings.slice(0, 500) });
    });
    return { out, bad };
}
// Merges the given services into the date's record (same service name = replaced). One audited write per date.
async function writeReading(date, services, replaceAll = false) {
    const ref = db.collection("bibleReadings").doc(date), snap = await ref.get(), o = snap.exists ? snap.data() : null;
    let list = replaceAll || !o ? [] : (o.services || []).filter(x => !services.some(n => n.service.toLowerCase() === x.service.toLowerCase()));
    list = [...list, ...services].slice(0, 10);
    const next = { date, services: list, version: o ? o.version + 1 : 1, updatedAt: nowIso() };
    const b = db.batch();
    b.set(ref, next);
    b.set(db.collection("auditLog").doc(`bibleReadings_${date}_v${next.version}`), { action: o ? "readings-edit" : "readings-add", target: "bibleReadings/" + date,
        targetVersion: next.version, parishId: "", reason: "", before: o ? { services: o.services } : null, after: { services: list }, by: localState.user.uid,
        byEmail: (localState.user.email || "").toLowerCase(), byName: localState.name || "", role: localState.role, at: srv() });
    await b.commit();
}
async function saveBulkReadings() {
    if (needName()) return;
    const { out, bad } = parseReadingLines($("rd_bulk").value);
    if (bad.length) return alert(`Check line ${bad.join(", ")}. Write: 2026-11-08 | Sunday Service | Psalm 23; John 3:16-21`);
    const dates = Object.keys(out).sort();
    if (!dates.length) return alert("Paste at least one line.");
    await busy("rdBulkBtn", async () => {
        let done = 0;
        try { for (const d of dates) { await writeReading(d, out[d]); done++; } $("rd_bulk").value = ""; alert(`Saved readings for ${done} date${done === 1 ? "" : "s"}.`); }
        catch (e) { alert(`Not saved after ${done}: ${e.message}`); }
        rdState.month = dates[0].slice(0, 7);
        await openReadings();
    });
}
function editReading(date) {
    const r = rdState.list.find(x => x.date === date) || { date, services: [] };
    p9Modal("Edit readings", `<p class="font-bold">${esc(fmtLong(date))}</p><p class="text-gray-500">One line per service: <b>Service | Readings</b></p>
        <textarea id="rd_edit" rows="6" class="w-full border p-2 rounded">${esc(r.services.map(x => `${x.service} | ${x.readings}`).join("\n"))}</textarea>`,
        `<button id="rdEditBtn" onclick="saveReadingEdit('${esc(date)}')" class="px-3 py-2 bg-blue-900 text-white rounded font-bold">Save</button>`);
}
async function saveReadingEdit(date) {
    if (needName()) return;
    const { out, bad } = parseReadingLines($("rd_edit").value.split(/\r?\n/).filter(l => l.trim()).map(l => `${date} | ${l.includes("|") ? l : "Sunday Service | " + l}`).join("\n"));
    if (bad.length || !out[date]) return alert("Write each line as: Service | Readings");
    await busy("rdEditBtn", async () => {
        try { await writeReading(date, out[date], true); closeModal("p9Modal"); await openReadings(); }
        catch (e) { alert("Not saved: " + e.message); }
    });
}
function printReadings() {
    showPrintSheet(`${sheetHead("Bible Readings — " + monthName(rdState.month))}
        <table class="ps-table ps-big"><tr><th>Date</th><th>Service</th><th>Readings</th></tr>
        ${rdState.list.flatMap(r => r.services.map((x, i) => `<tr><td>${i ? "" : esc(fmtLong(r.date))}</td><td>${esc(x.service)}</td><td><b>${esc(x.readings)}</b></td></tr>`)).join("")
            || `<tr><td colspan="3">No readings entered.</td></tr>`}</table>
        <p class="ps-help">Church-wide readings set by HQ. Printed ${esc(fmtLong(localToday()))}.</p>`);
}
async function renderReadingsCard() {
    const from = weekStart(localToday()), list = await loadReadings(from, addDays(from, 6));
    $("readingsCard").innerHTML = `<div class="flex justify-between items-center"><p class="font-bold text-sm"><i class="fa-solid fa-book-open text-sky-700 mr-1"></i> This week's readings</p>
        <button onclick="showSection('readings')" class="underline text-blue-800">Month</button></div>
        ${list.map(r => `<div class="rd-week"><p class="text-[10px] uppercase font-semibold text-gray-500">${esc(fmtDay(r.date))}</p>${readingLines(r)}</div>`).join("")
            || `<p class="text-gray-400">No readings set by HQ for this week yet.</p>`}`;
    $("readingsCard").classList.remove("hidden");
}

// ================================================================= 2. DUTY ROSTER (Ijaye "SERVICE ROSTER" format)
// Columns: DAY | DATE | SERVICE CONDUCTOR | 1ST LESSON | LESSON READER | 2ND LESSON | LESSON READER | PREACHER.
// Core duties are fixed; other duty types are optional extras (draft list until Bayo confirms; editable, can be clergy-only).
// Lessons come from the worldwide readings for that date ("1st; 2nd") and the admin can edit them.
const CORE_DUTIES = ["Service Conductor", "Lesson Reader 1", "Lesson Reader 2", "Preacher"];
const DEFAULT_DUTIES = [["Service Conductor", false], ["Lesson Reader 1", false], ["Lesson Reader 2", false], ["Preacher", false],
    ["Prayer", false], ["Ushering / Sidemen", false], ["Choir lead", false], ["Announcements", false], ["Sanitation", false]].map(([name, clergyOnly]) => ({ name, clergyOnly }));
const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const DEFAULT_DAYS = [0, 3, 5];   // Sunday, Wednesday, Friday; Thursdays are added when needed (or ticked in Duty types)
const roState = { month: "", types: DEFAULT_DUTIES, days: DEFAULT_DAYS, typesVer: 0, revs: [], sel: null, people: [] };
const rosterRef = id => parishRef().collection("rosters").doc(id);
const rosterTarget = id => `parishes/${localState.currentParishId}/rosters/${id}`;
const datesOf = (m, days) => { const out = []; for (let d = 1; d <= monthDays(m); d++) { const s = `${m}-${String(d).padStart(2, "0")}`; if (days.includes(parseYmd(s).getDay())) out.push(s); } return out; };
// "VEN/M/EVANG. ISSAC BABARINDE" style: rank short form + name, capitals.
const personLabel = p => `${rankText(p) ? (shortOf(p.rank) || p.rank) + (p.prophet ? "/P" : "") + " " : ""}${p.fullName}`.toUpperCase();
async function loadDutyTypes() {
    const d = await parishRef().collection("rosterConfig").doc("dutyTypes").get(), x = d.exists ? d.data() : {};
    const extra = (x.types || DEFAULT_DUTIES).filter(t => !CORE_DUTIES.includes(t.name));
    roState.types = [...CORE_DUTIES.map(n => (x.types || []).find(t => t.name === n) || { name: n, clergyOnly: false }), ...extra];
    roState.days = x.days || DEFAULT_DAYS;
    roState.typesVer = d.exists ? x.version : 0;
}
async function loadRosterPeople() {
    const [m, c] = await Promise.all([parishRef().collection("members").where("status", "==", "Active").get(),
        parishRef().collection("clergy").where("status", "==", "Active").get()]);
    roState.people = [...c.docs.map(d => ({ ...d.data(), kind: "clergy" })), ...m.docs.map(d => ({ ...d.data(), kind: "member" }))]
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
}
// Clergy-only duties: clergy records only, and never a woman (women cannot be clergy in CCC).
const canHold = (p, t) => !t?.clergyOnly || (p.kind === "clergy" && p.gender === "Male");
async function openRoster() {
    if (!roState.month) roState.month = localToday().slice(0, 7);
    $("ro_month").value = roState.month;
    await Promise.all([loadDutyTypes(), loadRosterPeople()]);
    const s = await parishRef().collection("rosters").where("month", "==", roState.month).get();
    roState.revs = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.rev - a.rev);
    roState.sel = roState.revs[0] ? JSON.parse(JSON.stringify(roState.revs[0])) : null;
    renderRoster();
}
function rosterMonth() { roState.month = $("ro_month").value || localToday().slice(0, 7); openRoster().catch(e => alert(e.message)); }
const dutyOf = (row, name) => row.duties.find(x => x.duty === name) || {};
function renderRoster() {
    const r = roState.sel, m = roState.month;
    $("ro_types").innerHTML = `<p class="text-gray-500">Days: <b>${roState.days.map(d => DAY_NAMES[d]).join(", ")}</b> · Extras: ${roState.types.filter(t => !CORE_DUTIES.includes(t.name)).map(t => esc(t.name) + (t.clergyOnly ? " (clergy only)" : "")).join(", ") || "none"}</p>`;
    $("ro_history").innerHTML = roState.revs.map(x => `<p class="ro-rev">Version ${x.rev}: <b>${esc(x.status)}</b>${x.reason ? " · " + esc(x.reason) : ""}</p>`).join("");
    if (!r) {
        $("ro_editor").innerHTML = `<p class="text-gray-500">No roster for ${esc(monthName(m))} yet.</p>
            <div class="grid grid-cols-2 gap-2"><button id="roNewBtn" onclick="newRoster(false)" class="py-2 border rounded font-bold">Start blank</button>
            <button id="roCopyBtn" onclick="newRoster(true)" class="py-2 bg-blue-900 text-white rounded font-bold">Copy last month</button></div>`;
        return;
    }
    const draft = r.status === "Draft";
    const opts = (t, cur) => `<option value="">—</option>` + roState.people.filter(p => canHold(p, t) || p.memberNo === cur)
        .map(p => `<option value="${esc(p.memberNo)}" ${p.memberNo === cur ? "selected" : ""}>${esc(personLabel(p))}</option>`).join("");
    const lesson = (i, k, label) => draft ? `<label class="flex items-center gap-2"><span class="w-32 shrink-0">${label}</span><input class="ro-lesson flex-1 min-w-0 border rounded p-1 uppercase" data-row="${i}" data-k="${k}" maxlength="80" value="${esc(r.rows[i][k] || "")}"></label>`
        : `<p>${label}: <b>${esc(r.rows[i][k] || "—")}</b></p>`;
    $("ro_editor").innerHTML = `<p class="font-bold">${esc(monthName(m))} · version ${r.rev} · <span class="${draft ? "text-amber-700" : "text-emerald-700"}">${esc(r.status)}</span></p>
        ${r.rows.map((row, i) => `<div class="ro-row bg-white border rounded-xl p-2 space-y-1"><div class="flex justify-between items-center gap-2"><p class="font-bold">${esc(row.service)} · ${esc(fmtLong(row.date))}</p>
            ${draft ? `<button onclick="removeRosterRow(${i})" class="text-rose-700 underline">Remove</button>` : ""}</div>
            ${lesson(i, "lesson1", "1st Lesson")}${lesson(i, "lesson2", "2nd Lesson")}
            ${roState.types.map(t => `<label class="flex items-center gap-2"><span class="w-32 shrink-0">${esc(t.name)}</span>${draft
                ? `<select class="ro-sel flex-1 min-w-0 border rounded p-1" data-row="${i}" data-duty="${esc(t.name)}">${opts(t, dutyOf(row, t.name).no || "")}</select>`
                : `<b>${esc(dutyOf(row, t.name).name || "—")}</b>`}</label>`).join("")}</div>`).join("")}
        ${draft ? `<div class="flex gap-2"><input id="ro_addDate" type="date" class="border p-2 rounded" min="${m}-01" max="${m}-${monthDays(m)}">
            <button onclick="addRosterRow()" class="px-3 border rounded font-bold">+ Add service (e.g. Thursday)</button></div>
            <label class="block">Secretary (rank short form + name)<input id="ro_sec" class="w-full border p-2 rounded uppercase" maxlength="160" value="${esc(r.secretary || "")}"></label>
            <label class="block">Shepherd in charge<input id="ro_shep" class="w-full border p-2 rounded uppercase" maxlength="160" value="${esc(r.shepherd || "")}"></label>
            <div class="grid grid-cols-2 gap-2"><button id="roSaveBtn" onclick="saveRoster(false)" class="py-2 border rounded font-bold">Save draft</button>
            <button id="roPubBtn" onclick="saveRoster(true)" class="py-2 bg-emerald-700 text-white rounded font-bold">Publish</button></div>`
        : `<p class="text-gray-500">Published rosters cannot be changed or deleted. To correct it, make a new version.</p>
            <button id="roFixBtn" onclick="correctRoster()" class="w-full py-2 border rounded font-bold">Make a correction (new version)</button>`}
        <button onclick="printRoster()" class="w-full py-2 bg-slate-800 text-white rounded font-bold"><i class="fa-solid fa-print"></i> Print roster (A4 landscape)</button>`;
}
// Reads the pickers, lessons and signatures into the selected roster.
function readRosterRows() {
    const r = roState.sel;
    if (r.status !== "Draft") return r.rows;
    document.querySelectorAll(".ro-lesson").forEach(el => r.rows[el.dataset.row][el.dataset.k] = el.value.trim().toUpperCase().slice(0, 80));
    document.querySelectorAll(".ro-sel").forEach(el => {
        const row = r.rows[el.dataset.row], duty = el.dataset.duty, p = roState.people.find(x => x.memberNo === el.value);
        if (p && !canHold(p, roState.types.find(x => x.name === duty))) throw new Error(`${p.fullName} cannot hold "${duty}" (clergy only).`);
        row.duties = row.duties.filter(x => x.duty !== duty);
        if (p) row.duties.push({ duty, no: p.memberNo, name: personLabel(p), kind: p.kind });
    });
    if ($("ro_sec")) { r.secretary = val("ro_sec").toUpperCase().slice(0, 160); r.shepherd = val("ro_shep").toUpperCase().slice(0, 160); }
    return r.rows;
}
// Lessons from the worldwide readings: "2 KINGS 23:4-9; EPH. 4:17-32" -> 1st / 2nd lesson.
async function lessonsFor(m) {
    const map = {};
    (await loadReadings(m + "-01", m + "-31")).forEach(r => {
        const x = r.services[0], parts = String(x.readings).split(";").map(s => s.trim()).filter(Boolean);
        map[r.date] = { lesson1: (parts[0] || "").toUpperCase(), lesson2: parts.slice(1).join("; ").toUpperCase() };
    });
    return map;
}
// Row label = the timetable services held that day (1st-Thursday rule applied), else the day name.
const newRow = (date, lessons) => ({ date, service: (servicesOn(date).map(x => x.name).join(" / ") || DAY_NAMES[parseYmd(date).getDay()]).slice(0, 80), lesson1: lessons[date]?.lesson1 || "", lesson2: lessons[date]?.lesson2 || "", duties: [] });
async function addRosterRow() {
    const date = $("ro_addDate").value;
    if (!date || date.slice(0, 7) !== roState.month) return alert("Pick a date in this month.");
    try { readRosterRows(); } catch (e) { return alert(e.message); }
    roState.sel.rows.push(newRow(date, await lessonsFor(roState.month)));
    roState.sel.rows.sort((a, b) => a.date.localeCompare(b.date));
    renderRoster();
}
function removeRosterRow(i) { try { readRosterRows(); } catch (e) { return alert(e.message); } roState.sel.rows.splice(i, 1); renderRoster(); }
async function rosterWrite(rec, action, before, reason = "") {
    const b = db.batch();
    b.set(rosterRef(`${rec.month}_r${rec.rev}`), rec);
    parishAudit(b, rosterTarget(`${rec.month}_r${rec.rev}`), rec.version, action, before, { status: rec.status, rows: rec.rows.length }, reason);
    await b.commit();
}
const rosterNos = rows => [...new Set(rows.flatMap(r => r.duties.map(x => x.no)))];
async function newRoster(copy) {
    const m = roState.month, lessons = await lessonsFor(m);
    let rows = datesOf(m, roState.days).map(d => newRow(d, lessons)), sec = "", shep = "";
    if (copy) {
        const s = await parishRef().collection("rosters").where("month", "==", prevMonth(m)).get();
        const last = s.docs.map(d => d.data()).sort((a, b) => b.rev - a.rev)[0];
        if (!last) return alert(`No roster for ${monthName(prevMonth(m))} to copy.`);
        // The k-th SUNDAY copies last month's k-th SUNDAY (and so on for each day); lessons come from this month's readings.
        const nth = (list, r) => list.filter(x => x.service === r.service && x.date <= r.date).length;
        rows = rows.map(r => { const o = last.rows.find(x => x.service === r.service && nth(last.rows, x) === nth(rows, r)); return o ? { ...r, duties: o.duties } : r; });
        sec = last.secretary || ""; shep = last.shepherd || "";
    }
    const rec = { month: m, rev: 1, status: "Draft", rows, nos: rosterNos(rows), replaces: "", reason: "", parishName: localState.parish.name || "", secretary: sec, shepherd: shep,
        version: 1, createdAt: nowIso(), createdBy: localState.user.uid, updatedAt: nowIso(), updatedBy: localState.user.uid };
    try { await rosterWrite(rec, copy ? "roster-copy" : "roster-create", null, copy ? "copied from " + prevMonth(m) : ""); await openRoster(); }
    catch (e) { alert("Not saved: " + e.message); }
}
async function saveRoster(publish) {
    let rows;
    try { rows = readRosterRows(); } catch (e) { return alert(e.message); }
    if (publish && !confirm("Publish this roster? After publishing it cannot be changed or deleted (corrections become a new version).")) return;
    await busy(publish ? "roPubBtn" : "roSaveBtn", async () => {
        try {
            const { id, ...o } = roState.sel;
            const rec = { ...o, rows, nos: rosterNos(rows), status: publish ? "Published" : "Draft", version: o.version + 1, updatedAt: nowIso(), updatedBy: localState.user.uid,
                ...(publish ? { publishedAt: nowIso() } : {}) };
            await rosterWrite(rec, publish ? "roster-publish" : "roster-save", { status: o.status });
            roState.sel = { id, ...rec };
            await openRoster();
        } catch (e) { alert("Not saved: " + e.message); }
    });
}
async function correctRoster() {
    const reason = (prompt("What needs correcting? (kept in the history)") || "").trim().slice(0, 300);
    if (!reason) return;
    const { id, publishedAt, ...o } = roState.revs[0];
    const rec = { ...o, rev: o.rev + 1, status: "Draft", replaces: id, reason, version: 1, createdAt: nowIso(), createdBy: localState.user.uid, updatedAt: nowIso(), updatedBy: localState.user.uid };
    try { await rosterWrite(rec, "roster-correct", { replaces: id }, reason); await openRoster(); }
    catch (e) { alert("Not saved: " + e.message); }
}
function openDutyTypes() {
    p9Modal("Duty types & days", `<p class="font-bold">Service days</p><div class="flex flex-wrap gap-2">${DAY_NAMES.map((d, i) => `<label><input type="checkbox" class="dt-day" value="${i}" ${roState.days.includes(i) ? "checked" : ""}> ${d.slice(0, 3)}</label>`).join("")}</div>
        <p class="text-gray-500">The 4 core duties stay. Extra duties are a draft list until confirmed: rename, add or remove. Tick "clergy only" for duties only clergy may hold.</p>
        <div id="dt_rows" class="space-y-1">${roState.types.map(dutyTypeRow).join("")}</div>
        <button onclick="addDutyTypeRow()" class="px-3 py-1 border rounded">+ Add duty</button>`,
        `<button onclick="resetDutyTypes()" class="px-3 py-2 border rounded">Defaults</button><button id="dtSaveBtn" onclick="saveDutyTypes()" class="px-3 py-2 bg-blue-900 text-white rounded font-bold">Save</button>`);
}
const dutyTypeRow = t => { const core = CORE_DUTIES.includes(t.name);
    return `<div class="dt-row flex items-center gap-2"><input class="dt-name flex-1 min-w-0 border p-2 rounded" maxlength="60" value="${esc(t.name)}" ${core ? "readonly" : ""}>
    <label class="whitespace-nowrap"><input type="checkbox" class="dt-clergy" ${t.clergyOnly ? "checked" : ""}> clergy only</label>
    ${core ? `<span class="w-4"></span>` : `<button onclick="this.parentElement.remove()" class="text-rose-700" aria-label="Remove"><i class="fa-solid fa-xmark"></i></button>`}</div>`; };
function addDutyTypeRow() { $("dt_rows").insertAdjacentHTML("beforeend", dutyTypeRow({ name: "", clergyOnly: false })); }
function resetDutyTypes() { $("dt_rows").innerHTML = DEFAULT_DUTIES.map(dutyTypeRow).join(""); }
async function saveDutyTypes() {
    const types = [...document.querySelectorAll(".dt-row")].map(r => ({ name: r.querySelector(".dt-name").value.trim().slice(0, 60), clergyOnly: r.querySelector(".dt-clergy").checked })).filter(t => t.name);
    const days = [...document.querySelectorAll(".dt-day:checked")].map(x => Number(x.value));
    if (!days.length) return alert("Tick at least one service day.");
    if (new Set(types.map(t => t.name.toLowerCase())).size !== types.length) return alert("Two duties have the same name.");
    await busy("dtSaveBtn", async () => {
        try {
            const v = roState.typesVer + 1, b = db.batch(), t = `parishes/${localState.currentParishId}/rosterConfig/dutyTypes`;
            b.set(parishRef().collection("rosterConfig").doc("dutyTypes"), { types, days, version: v, updatedAt: nowIso(), updatedBy: localState.user.uid });
            parishAudit(b, t, v, "duty-types", { types: roState.types.map(x => x.name).join(", ") }, { types: types.map(x => x.name).join(", "), days: days.join(",") });
            await b.commit();
            closeModal("p9Modal");
            await openRoster();
        } catch (e) { alert("Not saved: " + e.message); }
    });
}
// Printed exactly like the parish's paper SERVICE ROSTER: landscape A4, large text.
function printRoster() {
    const r = roState.sel;
    try { readRosterRows(); } catch (e) { return alert(e.message); }
    const [y, mm] = r.month.split("-").map(Number), d = (row, n) => esc(dutyOf(row, n).name || "");
    const extras = roState.types.filter(t => !CORE_DUTIES.includes(t.name) && r.rows.some(row => dutyOf(row, t.name).name));
    showPrintSheet(`<div class="sr-head"><img src="assets/ccc-logo.png" alt="" onerror="this.remove()"><div><p class="ps-church">Celestial Church of Christ</p><p>${esc(localState.parish.name || "")}</p>
        <h1>SERVICE ROSTER</h1><p class="sr-box">${MONTHS[mm - 1].toUpperCase()} YEAR: ${y}</p></div></div>
        ${r.status === "Draft" ? `<p class="ps-help"><b>DRAFT</b> — not yet published.</p>` : ""}
        <table class="ps-table sr-table"><tr><th>DAY</th><th>DATE</th><th>SERVICE CONDUCTOR</th><th>1ST LESSON</th><th>LESSON READER</th><th>2ND LESSON</th><th>LESSON READER</th><th>PREACHER</th>
        ${extras.map(t => `<th>${esc(t.name.toUpperCase())}</th>`).join("")}</tr>
        ${r.rows.map(row => `<tr><td>${esc(row.service)}</td><td>${parseYmd(row.date).getDate()}/${mm}/${y}</td><td>${d(row, "Service Conductor")}</td><td>${esc(row.lesson1 || "")}</td>
            <td>${d(row, "Lesson Reader 1")}</td><td>${esc(row.lesson2 || "")}</td><td>${d(row, "Lesson Reader 2")}</td><td>${d(row, "Preacher")}</td>${extras.map(t => `<td>${d(row, t.name)}</td>`).join("")}</tr>`).join("")}</table>
        <div class="sr-sign"><div><p class="sr-line">${esc(r.secretary || "")}</p><p><b>SECRETARY</b></p></div><div><p class="sr-line">${esc(r.shepherd || "")}</p><p><b>SHEPHERD IN CHARGE</b></p></div></div>
        <p class="ps-help">Version ${r.rev}${r.reason ? " (" + esc(r.reason) + ")" : ""}.</p>`);
    $("printSheetBody").classList.add("sr-landscape");
    $("pageSize").textContent = "@page { size: A4 landscape; margin: 10mm; }";
}
// Profile: the person's upcoming duties (latest version of each month's roster only).
async function renderPersonDuties(no) {
    if (localState.role !== "parish_admin") return;
    const s = await parishRef().collection("rosters").where("nos", "array-contains", no).get(), today = localToday();
    const latest = {};
    s.docs.map(d => d.data()).forEach(r => { if (!latest[r.month] || r.rev > latest[r.month].rev) latest[r.month] = r; });
    const all = await parishRef().collection("rosters").where("month", ">=", today.slice(0, 7)).get();   // a newer version may have dropped them
    all.docs.map(d => d.data()).forEach(r => { if (latest[r.month] && r.rev > latest[r.month].rev) latest[r.month] = r; });
    const list = Object.values(latest).flatMap(r => r.rows.filter(x => x.date >= today).flatMap(x => x.duties.filter(d => d.no === no)
        .map(d => ({ date: x.date, service: x.service, duty: d.duty, draft: r.status === "Draft" })))).sort((a, b) => a.date.localeCompare(b.date));
    const box = $("recordDuties");
    if (!box) return;
    box.innerHTML = `<p class="font-bold">Upcoming duties</p>${list.map(d => `<p class="rec-duty">${esc(fmtDay(d.date))} · ${esc(d.service)}: <b>${esc(d.duty)}</b>${d.draft ? " (draft)" : ""}</p>`).join("")
        || `<p class="text-gray-400">None on the roster.</p>`}`;
}

// ================================================================= 3. PUBLIC CHURCH INFO (website, no login)
async function openPublicInfo() {
    const d = await db.collection("publicInfo").doc(localState.currentParishId).get(), p = d.exists ? d.data() : {}, par = localState.parish || {};
    $("pi_services").value = (p.services || []).join("\n") || timetableLines().join("\n"); // every timetable service, not just the first 6
    $("pi_address").value = p.address ?? par.address ?? "";
    $("pi_phone").value = p.phone || "";
    $("pi_maps").value = p.mapsUrl ?? par.mapsUrl ?? "";
    $("pi_about").value = p.about || "";
    $("pi_saved").textContent = d.exists ? "Last saved " + String(p.updatedAt || "").slice(0, 10) : "Not published yet.";
}
function piFromTimetable() { $("pi_services").value = timetableLines().join("\n"); }
async function savePublicInfo() {
    const maps = val("pi_maps");
    if (maps && !/^https:\/\/\S+$/.test(maps)) return alert("The map link must start with https://");
    const rec = { parishName: (localState.parish.name || "").slice(0, 120), services: $("pi_services").value.split(/\r?\n/).map(x => x.trim().slice(0, 120)).filter(Boolean).slice(0, 20),
        address: val("pi_address").slice(0, 200), phone: val("pi_phone").slice(0, 40), mapsUrl: maps.slice(0, 500), about: val("pi_about").slice(0, 1000), updatedAt: nowIso() };
    await busy("piSaveBtn", async () => {
        try { await db.collection("publicInfo").doc(localState.currentParishId).set(rec); await openPublicInfo(); alert("Saved. The website shows this to everyone."); }
        catch (e) { alert("Not saved: " + e.message); }
    });
}
