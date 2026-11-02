// CCC Parish Portal - Phase 7 (Super Admin side):
//  1. HQ Staff (Product 2): staff records CCC-HQ-STF-001, postings, documents, leave, reports. Named Super Admins only.
//  2. Church-wide member directory: directory/{parishId}_{memberNo}, a work-profile projection each parish writes
//     alongside its member records (no address, next of kin, birth year or family). Super Admin searches it.
//  3. Committees: picked church-wide from the directory (members) and the clergy register (clergy).
// Every Super Admin change is versioned and audited through writeAudit() from returns.js. Nothing is deleted.

const RETIRE_AGE = 60;                 // HQ retirement age used by the "due to retire" report (change here if HQ policy differs)
const DOC_MAX = 250 * 1024;            // ~250KB per staff document
const STAFF_STATUS = ["Active", "On leave", "Retired", "Left"];
const LEAVE_TYPES = ["Annual", "Sick", "Maternity", "Paternity", "Study", "Compassionate", "Other"];
const CM_ROLES = ["Chair", "Secretary", "Member"];
const STAFF_SNAP = ["fullName", "department", "jobTitle", "grade", "phone", "email", "category", "linkParishId", "linkNo", "dob",
    "employedDate", "confirmedDate", "exitDate", "status"];

// ================================================================= 2. DIRECTORY (parish side)
const dirRef = (pid, no) => db.collection("directory").doc(`${pid}_${no}`);
// Work-profile fields only. Participation history is added by syncDirectory().
function dirProfile(m) {
    const par = localState.parish || {};
    return { parishId: localState.currentParishId, memberNo: m.memberNo, fullName: m.fullName, nameLower: m.fullName.toLowerCase(),
        photo: m.photo || "", gender: m.gender || "", rank: m.rank || "", occupation: m.occupation || "",
        occLower: (m.occupation || "").toLowerCase(), phone: m.phone || "", parishName: par.name || "", city: par.city || "",
        cityLower: (par.city || "").toLowerCase(), country: par.country || "", status: m.status || "Active",
        anointed: m.anointYear || m.anointDay ? { day: m.anointDay || null, month: m.anointMonth || null, year: m.anointYear || null } : {} };
}
// Order-independent comparison (Firestore may return map keys in a different order).
const canon = v => Array.isArray(v) ? `[${v.map(canon).join(",")}]` : v && typeof v === "object"
    ? `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",")}}` : JSON.stringify(v ?? null);
const sameDir = (a, b) => ["fullName", "photo", "gender", "rank", "occupation", "phone", "parishName", "city", "country", "status",
    "departments", "attendance", "rankHistory", "anointed", "giving"].every(k => canon(a[k]) === canon(b[k]));

// Builds every member's projection and writes the ones that are missing or out of date (backfill + refresh).
// Runs each time a parish admin opens the app. Committees are never touched here (merge write; the rules forbid it).
async function syncDirectory() {
    const pid = localState.currentParishId;
    if (!pid || localState.role !== "parish_admin") return 0;
    const year = new Date().getFullYear();
    const [mem, dir, dm, da, fin] = await Promise.all([
        parishRef().collection("members").get(),
        db.collection("directory").where("parishId", "==", pid).get(),
        parishRef().collection("deptMembers").get(),
        parishRef().collection("deptAttendance").get(),
        parishRef().collection("finances").where("transactionDate", ">=", `${year - 1}-01-01`).get()]);
    const old = Object.fromEntries(dir.docs.map(d => [d.data().memberNo, d.data()]));
    const depts = {}, seen = {}, gifts = {};
    dm.docs.forEach(d => { const x = d.data(); (depts[x.memberNo] ||= []).push({ dept: deptName(x.dept), role: x.role || "", status: x.status, from: x.joinedDate || "", to: x.leftDate || "" }); });
    // Attendance per member across all units: dates present (newest first) and the best run of unbroken sessions.
    const byUnit = {};
    da.docs.forEach(d => { const x = d.data(); (byUnit[x.dept] ||= []).push(x); });
    Object.values(byUnit).forEach(list => {
        list.sort((a, b) => b.date.localeCompare(a.date));
        const run = {};
        list.forEach((s, i) => (s.present || []).forEach(no => {
            const r = seen[no] ||= { lastSeen: "", sessions12w: 0, streak: 0 };
            if (s.date > r.lastSeen) r.lastSeen = s.date;
            if (s.date >= addDays(localToday(), -84)) r.sessions12w++;
            if (run[no] === undefined || run[no].next === i) { run[no] = { n: (run[no]?.n || 0) + 1, next: i + 1 }; r.streak = Math.max(r.streak, run[no].n); }
        }));
    });
    // Giving: the finance book records the giver's name, so it is matched by name. Regular = gave in 3+ of the last 6 months.
    const since6 = addDays(localToday(), -183);
    fin.docs.forEach(d => { const f = d.data(); const k = String(f.contributorName || "").trim().toLowerCase(); if (!k) return;
        const g = gifts[k] ||= { byYear: {}, months: new Set() };
        const y = String(f.transactionDate).slice(0, 4); g.byYear[y] = (g.byYear[y] || 0) + (Number(f.amount) || 0);
        if (f.transactionDate >= since6) g.months.add(String(f.transactionDate).slice(0, 7)); });
    const writes = [];
    mem.docs.forEach(d => {
        const m = d.data(), o = old[m.memberNo] || {};
        const hist = (o.rankHistory || []).slice();
        if (m.rank && (!hist.length || hist[hist.length - 1].rank !== m.rank)) hist.push({ rank: m.rank, from: localToday() });
        const g = gifts[m.nameLower] || { byYear: {}, months: new Set() };
        const att = seen[m.memberNo] || { lastSeen: "", sessions12w: 0, streak: 0 };
        const next = { ...dirProfile(m), departments: (depts[m.memberNo] || []).slice(0, 60), attendance: att, rankHistory: hist.slice(-40),
            giving: { regular: g.months.size >= 3, byYear: { ...(o.giving?.byYear || {}), ...g.byYear } } };
        if (!old[m.memberNo] || !sameDir(o, next)) writes.push([dirRef(pid, m.memberNo), { ...next, updatedAt: nowIso() }]);
    });
    for (let i = 0; i < writes.length; i += 400) {
        const b = db.batch();
        writes.slice(i, i + 400).forEach(([ref, data]) => b.set(ref, data, { merge: true }));
        await b.commit();
    }
    return writes.length;
}

// ================================================================= 2. DIRECTORY (Super Admin)
let dirSel = null;
function dirQuery() {
    const by = $("dir_by").value, t = val("dir_q").toLowerCase();
    const c = db.collection("directory");
    if (!t) return () => c.orderBy("nameLower");
    if (by === "name") return () => c.orderBy("nameLower").startAt(t).endAt(t + "");
    if (by === "occupation") return () => c.orderBy("occLower").startAt(t).endAt(t + "");
    if (by === "city") return () => c.where("cityLower", "==", t);
    if (by === "rank") return () => c.where("rank", "==", val("dir_q"));
    const ids = (localState.parishList || []).filter(p => String(p.name).toLowerCase().includes(t)).map(p => p.id).slice(0, 10);
    return () => c.where("parishId", "in", ids.length ? ids : ["-none-"]);
}
const dirCard = d => { const x = d.data();
    return `<button onclick="openDirEntry('${esc(d.id)}')" class="dir-row w-full bg-white border rounded-xl p-2 flex items-center gap-3 text-left text-xs">
        ${x.photo ? `<img src="${esc(x.photo)}" alt="" class="w-10 h-12 object-cover rounded">` : `<span class="w-10 h-12 rounded bg-gray-100 flex items-center justify-center text-gray-400"><i class="fa-solid fa-user"></i></span>`}
        <span class="flex-1 min-w-0"><b>${esc(x.fullName)}</b> <span class="font-mono text-gray-500">${esc(x.memberNo)}</span><br>
        <span class="text-gray-600">${esc([x.rank, x.occupation].filter(Boolean).join(" · "))}</span><br><span class="text-gray-500">${esc(x.parishName)}, ${esc(x.city)}</span></span></button>`; };
function loadDirectory(more) {
    return pagedList("dir", dirQuery(), "dir_list", dirCard, more, "No members found. Parishes fill the directory when their admin opens the app.");
}
let dirTimer = null;
function searchDirectory() { clearTimeout(dirTimer); dirTimer = setTimeout(() => loadDirectory().catch(e => alert("Could not search: " + e.message)), 300); }
async function openDirEntry(id) {
    const s = await db.collection("directory").doc(id).get();
    const x = s.data(); dirSel = { id, ...x };
    const yrs = Object.entries(x.giving?.byYear || {}).sort().reverse().map(([y, v]) => `${esc(y)}: ${esc(Number(v).toLocaleString())}`).join(", ");
    const an = x.anointed || {};
    const list = (arr, f) => (arr || []).length ? arr.map(f).join("") : `<p class="text-gray-400 italic">None recorded.</p>`;
    $("dirTitle").textContent = x.memberNo;
    $("dirBody").innerHTML = `<div class="flex gap-3">${x.photo ? `<img src="${esc(x.photo)}" alt="" class="w-20 h-24 object-cover rounded">` : ""}
        <div><p class="text-base font-bold">${esc(x.fullName)}</p><p>${esc(x.rank || "No rank")} · ${esc(x.gender)}</p><p>${esc(x.occupation || "")}</p>
        <p>${esc(x.parishName)}, ${esc(x.city)}, ${esc(x.country)}</p><p>${x.phone ? `<a class="text-blue-700 underline" href="tel:${esc(x.phone)}">${esc(x.phone)}</a>` : ""}</p><p class="text-gray-500">${esc(x.status)}</p></div></div>
        <p class="font-bold mt-2">Physical</p>
        <p>Attendance: best run ${x.attendance?.streak || 0} sessions · ${x.attendance?.sessions12w || 0} in the last 12 weeks · last seen ${esc(x.attendance?.lastSeen || "—")}</p>
        ${list(x.departments, d => `<p class="dir-dept">${esc(d.dept)}${d.role ? " · " + esc(d.role) : ""} (${esc(d.status)}, ${esc(d.from)}${d.to ? " to " + esc(d.to) : ""})</p>`)}
        <p class="font-bold mt-2">Committees</p>
        ${list(x.committees, c => `<p class="dir-cmt">${esc(c.name)} · ${esc(c.role)} (${esc(c.status)}, ${esc(c.from)}${c.to ? " to " + esc(c.to) : ""})</p>`)}
        <p class="font-bold mt-2">Spiritual</p>
        ${list(x.rankHistory, r => `<p>${esc(r.rank)} from ${esc(r.from)}</p>`)}
        <p>Anointment: ${an.day || an.year ? esc(fmtDate(an.day, an.month, an.year)) : "—"}</p>
        <p class="font-bold mt-2">Financial</p>
        <p id="dirGiving">Regular giver: <b>${x.giving?.regular ? "Yes" : "No"}</b>${yrs ? ` · Totals by year: ${yrs}` : ""}</p>
        <p class="text-gray-400 mt-2">Work profile only. Address, next of kin, birth year and family stay private to the parish.</p>`;
    openModal("dirModal");
}

// ================================================================= 1. HQ STAFF
let staffAll = [], staffSel = null, staffForm = { photo: "", old: null };
const staffRef = id => db.collection("hqStaff").doc(id);
const yearsFrom = (dob, n) => { const [y, m, d] = dob.split("-").map(Number); return `${y + n}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
const retireDate = s => s.dob ? yearsFrom(s.dob, RETIRE_AGE) : "";
async function openStaff() {
    $("st_nameBox").classList.toggle("hidden", !!localState.name);
    if (!localState.name) return;
    const s = await db.collection("hqStaff").orderBy("staffNo").get();
    staffAll = s.docs.map(d => d.data());
    renderStaff();
    renderStaffReports();
}
function renderStaff() {
    const t = val("st_q").toLowerCase(), st = $("st_status").value;
    const list = staffAll.filter(s => (!st || s.status === st) && (!t || [s.fullName, s.staffNo, s.department, s.jobTitle, s.grade].join(" ").toLowerCase().includes(t)));
    $("st_list").innerHTML = list.map(s => `<button onclick="openStaffRecord('${esc(s.staffNo)}')" class="staff-row w-full bg-white border rounded-xl p-2 flex items-center gap-3 text-left text-xs">
        ${s.photo ? `<img src="${esc(s.photo)}" alt="" class="w-10 h-12 object-cover rounded">` : `<span class="w-10 h-12 rounded bg-gray-100 flex items-center justify-center text-gray-400"><i class="fa-solid fa-user-tie"></i></span>`}
        <span class="flex-1"><b>${esc(s.fullName)}</b> <span class="font-mono text-gray-500">${esc(s.staffNo)}</span><br>${esc(s.jobTitle)} · ${esc(s.department)}${s.grade ? " · " + esc(s.grade) : ""}</span>
        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${s.status === "Active" ? "bg-emerald-100" : s.status === "On leave" ? "bg-amber-100" : "bg-gray-200"}">${esc(s.status)}</span></button>`).join("")
        || `<p class="text-xs text-gray-400 italic">No staff found.</p>`;
}
function renderStaffReports() {
    const active = staffAll.filter(s => s.status === "Active" || s.status === "On leave");
    const byDept = {};
    active.forEach(s => byDept[s.department] = (byDept[s.department] || 0) + 1);
    $("st_byDept").innerHTML = Object.entries(byDept).sort().map(([d, n]) => `<tr class="dept-count"><td class="p-2">${esc(d)}</td><td class="p-2 text-right font-bold">${n}</td></tr>`).join("")
        || `<tr><td class="p-2 text-gray-400 italic">No staff yet.</td></tr>`;
    const until = yearsFrom(localToday(), 1);
    const due = active.filter(s => s.dob && retireDate(s) <= until).sort((a, b) => retireDate(a).localeCompare(retireDate(b)));
    const noDob = active.filter(s => !s.dob).length;
    $("st_retire").innerHTML = due.map(s => `<p class="retire-row">${esc(s.fullName)} <span class="font-mono text-gray-500">${esc(s.staffNo)}</span> · ${esc(s.department)} · retires <b>${esc(retireDate(s))}</b></p>`).join("")
        || `<p class="text-gray-400 italic">Nobody is due to retire in the next 12 months.</p>`;
    $("st_noDob").textContent = noDob ? `${noDob} staff have no full date of birth, so they cannot be checked.` : "";
}
function openStaffForm(existing) {
    if (needName()) return;
    const s = existing || {};
    staffForm = { photo: s.photo || "", old: existing || null };
    const set = (id, v) => $(id).value = v ?? "";
    set("sf_name", s.fullName); set("sf_dept", s.department); set("sf_title", s.jobTitle); set("sf_grade", s.grade); set("sf_phone", s.phone);
    set("sf_email", s.email); set("sf_category", s.category || "member"); set("sf_dob", s.dob); set("sf_employed", s.employedDate);
    set("sf_confirmed", s.confirmedDate); set("sf_exit", s.exitDate); set("sf_status", s.status || "Active"); set("sf_reason", "");
    $("sf_link").value = s.linkNo ? `${s.linkParishId}|${s.linkNo}` : ""; $("sf_linkText").textContent = s.linkNo ? `Linked: ${s.linkNo}` : "Not linked";
    $("sf_linkFound").innerHTML = ""; $("sf_linkQ").value = "";
    $("sf_consent").checked = !!s.consentGiven; $("sf_photo").value = "";
    $("sf_photoPreview").classList.toggle("hidden", !staffForm.photo); if (staffForm.photo) $("sf_photoPreview").src = staffForm.photo;
    $("sf_reasonWrap").classList.toggle("hidden", !existing);
    $("staffFormTitle").textContent = existing ? "EDIT " + s.staffNo : "ADD HQ STAFF";
    closeModal("staffModal"); openModal("staffFormModal");
}
async function pickStaffPhoto(input) {
    if (!input.files[0]) return;
    try { staffForm.photo = await compressImage(input.files[0]); $("sf_photoPreview").src = staffForm.photo; $("sf_photoPreview").classList.remove("hidden"); }
    catch (e) { alert(e.message); }
}
// Link to the person's parish record: clergy from the clergy register, members from the directory.
async function findStaffLink() {
    const t = val("sf_linkQ").toLowerCase();
    if (t.length < 2) return $("sf_linkFound").innerHTML = "";
    const opts = $("sf_category").value === "clergy"
        ? register.filter(c => c.nameLower?.includes(t)).slice(0, 6).map(c => [c.parishId, c.memberNo, c.fullName, c.parish])
        : (await db.collection("directory").orderBy("nameLower").startAt(t).endAt(t + "").limit(6).get()).docs.map(d => [d.data().parishId, d.data().memberNo, d.data().fullName, d.data().parishName]);
    $("sf_linkFound").innerHTML = opts.map(([p, no, n, pn]) => `<button type="button" onclick="setStaffLink('${esc(p)}','${esc(no)}')" class="link-opt w-full text-left border rounded p-2">${esc(n)} <span class="font-mono">${esc(no)}</span> · ${esc(pn)}</button>`).join("")
        || `<p class="text-gray-400">No match.</p>`;
}
function setStaffLink(p, no) { $("sf_link").value = p ? `${p}|${no}` : ""; $("sf_linkText").textContent = no ? `Linked: ${no}` : "Not linked"; $("sf_linkFound").innerHTML = ""; }
function readStaffForm() {
    const [lp, ln] = ($("sf_link").value || "|").split("|");
    return { fullName: val("sf_name"), nameLower: val("sf_name").toLowerCase(), photo: staffForm.photo || "", department: val("sf_dept"),
        jobTitle: val("sf_title"), grade: val("sf_grade"), phone: val("sf_phone"), email: val("sf_email").toLowerCase(), category: $("sf_category").value,
        linkParishId: lp || "", linkNo: ln || "", dob: val("sf_dob"), employedDate: val("sf_employed"), confirmedDate: val("sf_confirmed"),
        exitDate: val("sf_exit"), status: $("sf_status").value, consentGiven: $("sf_consent").checked };
}
async function saveStaff() {
    if (needName()) return;
    const f = readStaffForm(), o = staffForm.old;
    if (!f.fullName || !f.department || !f.jobTitle || !f.employedDate) return alert("Fill in name, department, job title and date employed.");
    if (!f.consentGiven) return alert("You must record consent before saving (NDPA 2023).");
    if ((f.status === "Retired" || f.status === "Left") && !f.exitDate) return alert("Enter the date they retired or left.");
    if (f.linkNo && !f.linkNo.includes(f.category === "clergy" ? "-CLG-" : "-MBR-")) return alert("The linked record does not match the category. Pick it again.");
    const reason = val("sf_reason");
    if (o && !reason) return alert("Give a reason for this change (it goes in the audit log).");
    await busy("saveStaffBtn", async () => {
        try {
            const by = { updatedAt: nowIso(), updatedBy: localState.user.uid };
            if (o) {
                const postings = (o.postings || []).slice();
                if (f.department !== o.department || f.jobTitle !== o.jobTitle) {
                    if (postings.length) postings[postings.length - 1] = { ...postings[postings.length - 1], to: localToday() };
                    postings.push({ department: f.department, jobTitle: f.jobTitle, from: localToday(), to: "" });
                }
                const next = { ...o, ...f, ...by, postings, version: o.version + 1 };
                const b = db.batch();
                b.set(staffRef(o.staffNo), next);
                writeAudit(b, "hqStaff/" + o.staffNo, next.version, "update", pick(o, STAFF_SNAP), pick(next, STAFF_SNAP), reason);
                await b.commit();
                staffSel = next.staffNo;
            } else {
                const cRef = db.collection("hqMeta").doc("staff");
                staffSel = await db.runTransaction(async t => {
                    const c = await t.get(cRef);
                    const n = (c.exists ? c.data().n : 0) + 1, id = "CCC-HQ-STF-" + pad3(n);
                    const rec = { ...f, ...by, staffNo: id, consentDate: localToday(), createdAt: nowIso(), version: 1,
                        postings: [{ department: f.department, jobTitle: f.jobTitle, from: f.employedDate, to: "" }] };
                    t.set(cRef, { n });
                    t.set(staffRef(id), rec);
                    writeAudit(t, "hqStaff/" + id, 1, "create", null, pick(rec, STAFF_SNAP));
                    return id;
                });
            }
            closeModal("staffFormModal");
            await openStaff();
            await openStaffRecord(staffSel);
        } catch (e) { alert("Not saved: " + e.message); }
    });
}
async function openStaffRecord(id) {
    const [s, files, leave, log] = await Promise.all([staffRef(id).get(),
        db.collection("hqStaffFiles").where("staffNo", "==", id).get(),
        db.collection("hqLeave").where("staffNo", "==", id).get(),
        db.collection("auditLog").where("target", "==", "hqStaff/" + id).get()]);
    const x = s.data(); staffSel = id;
    $("staffTitle").textContent = x.staffNo;
    $("staffBody").innerHTML = `<div class="flex gap-3">${x.photo ? `<img src="${esc(x.photo)}" alt="" class="w-20 h-24 object-cover rounded">` : ""}
        <div><p class="text-base font-bold">${esc(x.fullName)}</p><p>${esc(x.jobTitle)} · ${esc(x.department)}</p><p>Grade ${esc(x.grade || "—")} · <b id="staffStatus">${esc(x.status)}</b></p>
        <p>${esc(x.category === "clergy" ? "Clergy" : "Member")}${x.linkNo ? ` · <span class="font-mono">${esc(x.linkNo)}</span>` : ""}</p></div></div>
        ${row("Phone", esc(x.phone))}${row("Email", esc(x.email))}${row("Date of birth", esc(x.dob))}${row("Retirement due", esc(retireDate(x)))}
        ${row("Employed", esc(x.employedDate))}${row("Confirmed", esc(x.confirmedDate))}${row("Retired / left", esc(x.exitDate))}
        <p class="font-bold mt-2">Postings inside HQ</p>${(x.postings || []).map(p => `<p class="posting-row">${esc(p.jobTitle)} · ${esc(p.department)} (${esc(p.from)}${p.to ? " to " + esc(p.to) : " to date"})</p>`).join("")}
        <p class="font-bold mt-2">Documents</p>
        ${files.docs.map(d => { const f = d.data(); return `<p class="file-row"><a download="${esc(f.name)}" href="${esc(f.data)}" class="text-blue-700 underline">${esc(f.kind)}: ${esc(f.name)}</a> · ${Math.round(f.data.length * 0.75 / 1024)}KB</p>`; }).join("") || `<p class="text-gray-400 italic">None yet.</p>`}
        <div class="flex gap-1 flex-wrap items-center"><select id="sd_kind" class="border p-2 rounded">${["CV", "Appointment letter", "ID", "Other"].map(k => `<option>${k}</option>`).join("")}</select>
        <label class="px-3 py-2 border rounded bg-white">Upload (photo or PDF)<input id="sd_file" type="file" accept="image/*,application/pdf" class="hidden" onchange="uploadStaffDoc(this)"></label></div>
        <p class="font-bold mt-2">Leave</p>
        ${leave.docs.map(d => d.data()).sort((a, b) => b.from.localeCompare(a.from)).map(l => `<p class="leave-row">${esc(l.type)}: ${esc(l.from)} to ${esc(l.to)}${l.note ? " · " + esc(l.note) : ""}</p>`).join("") || `<p class="text-gray-400 italic">No leave recorded.</p>`}
        <div class="grid grid-cols-2 gap-1"><select id="lv_type" class="border p-2 rounded">${LEAVE_TYPES.map(k => `<option>${k}</option>`).join("")}</select><input id="lv_note" class="border p-2 rounded" placeholder="Note">
        <input id="lv_from" type="date" class="border p-2 rounded"><input id="lv_to" type="date" class="border p-2 rounded"></div>
        <button id="leaveBtn" onclick="addLeave()" class="w-full py-2 border rounded bg-white font-bold">Record leave</button>
        <p class="font-bold mt-2">Change history</p>
        <div id="staffAudit" class="space-y-1">${log.docs.map(d => d.data()).sort((a, b) => b.targetVersion - a.targetVersion).map(a => `<div class="audit-row border-l-4 border-indigo-300 pl-2"><p><b>${esc(a.action)}</b> v${a.targetVersion} · ${esc(a.byName)}</p>
            <p class="text-gray-500">${esc(STAFF_SNAP.filter(k => a.before && JSON.stringify(a.before[k]) !== JSON.stringify(a.after?.[k])).map(k => `${k}: ${a.before[k] || "—"} → ${a.after[k] || "—"}`).join("; "))}${a.reason ? " · Reason: " + esc(a.reason) : ""}</p></div>`).join("")}</div>`;
    $("staffActions").innerHTML = `<button onclick="openStaffForm(staffAll.find(s => s.staffNo === staffSel))" class="px-3 py-2 bg-blue-900 text-white rounded font-bold">Edit / change status</button>`;
    openModal("staffModal");
}
const readDataUrl = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
async function uploadStaffDoc(input) {
    const file = input.files[0];
    if (!file || needName()) return;
    try {
        let data;
        if (file.type === "application/pdf") {
            if (file.size > DOC_MAX) return alert("That PDF is over 250KB. Scan it smaller or upload photos of the pages.");
            data = await readDataUrl(file);
        } else data = await compressImage(file, DOC_MAX - 10000, 1600);
        const ref = db.collection("hqStaffFiles").doc();
        const meta = { staffNo: staffSel, kind: $("sd_kind").value, name: file.name.slice(0, 120) };
        const b = db.batch();
        b.set(ref, { ...meta, data, version: 1, at: srv(), by: localState.user.uid, byName: localState.name });
        writeAudit(b, "hqStaffFiles/" + ref.id, 1, "upload", null, meta);
        await b.commit();
        await openStaffRecord(staffSel);
    } catch (e) { alert("Not saved: " + e.message); }
}
async function addLeave() {
    if (needName()) return;
    const l = { staffNo: staffSel, type: $("lv_type").value, from: val("lv_from"), to: val("lv_to"), note: val("lv_note").slice(0, 300) };
    if (!l.from || !l.to || l.to < l.from) return alert("Enter the leave dates (the end cannot be before the start).");
    try {
        const ref = db.collection("hqLeave").doc();
        const b = db.batch();
        b.set(ref, { ...l, version: 1, at: srv(), by: localState.user.uid });
        writeAudit(b, "hqLeave/" + ref.id, 1, "leave", null, l);
        await b.commit();
        await openStaffRecord(staffSel);
    } catch (e) { alert("Not saved: " + e.message); }
}

// ================================================================= 3. COMMITTEES
let cmtAll = [], cmtSel = null;
async function openCommittees() {
    $("cm_nameBox").classList.toggle("hidden", !!localState.name);
    if (!localState.name) return;
    const s = await db.collection("committees").orderBy("nameLower").get();
    cmtAll = s.docs.map(d => ({ id: d.id, ...d.data() }));
    $("cm_list").innerHTML = cmtAll.map(c => `<button onclick="openCommittee('${esc(c.id)}')" class="cmt-row w-full bg-white border rounded-xl p-3 text-left text-xs">
        <b>${esc(c.name)}</b> <span class="text-gray-500">${esc(c.status)}</span><br>${esc(c.termStart)} to ${esc(c.termEnd)}<br><span class="text-gray-600">${esc(c.purpose || "")}</span></button>`).join("")
        || `<p class="text-xs text-gray-400 italic">No committees yet.</p>`;
}
function openCommitteeForm(existing) {
    if (needName()) return;
    const c = existing || {};
    const set = (id, v) => $(id).value = v ?? "";
    set("cf_name", c.name); set("cf_purpose", c.purpose); set("cf_duties", c.duties); set("cf_start", c.termStart); set("cf_end", c.termEnd);
    set("cf_status", c.status || "Active"); set("cf_reason", "");
    $("cf_reasonWrap").classList.toggle("hidden", !existing);
    $("cmtFormTitle").textContent = existing ? "EDIT COMMITTEE" : "NEW COMMITTEE";
    $("cmtFormModal").dataset.id = existing ? existing.id : "";
    closeModal("cmtModal"); openModal("cmtFormModal");
}
async function saveCommittee() {
    if (needName()) return;
    const id = $("cmtFormModal").dataset.id, o = cmtAll.find(c => c.id === id);
    const f = { name: val("cf_name"), purpose: val("cf_purpose"), duties: val("cf_duties"), termStart: val("cf_start"), termEnd: val("cf_end"), status: $("cf_status").value };
    if (!f.name || !f.termStart || !f.termEnd) return alert("Fill in the name and the term dates.");
    if (f.termEnd <= f.termStart) return alert("The term must end after it starts.");
    if (o && !val("cf_reason")) return alert("Give a reason for this change.");
    await busy("saveCmtBtn", async () => {
        try {
            const ref = o ? db.collection("committees").doc(o.id) : db.collection("committees").doc();
            const v = o ? o.version + 1 : 1;
            const { id: _, ...prev } = o || {};
            const rec = { ...prev, ...f, nameLower: f.name.toLowerCase(), version: v, updatedAt: nowIso(), updatedBy: localState.user.uid,
                ...(o ? {} : { createdAt: nowIso(), createdBy: localState.user.uid }) };
            const b = db.batch();
            b.set(ref, rec);
            writeAudit(b, "committees/" + ref.id, v, o ? "update" : "create", o ? pick(o, Object.keys(f)) : null, f, val("cf_reason"));
            await b.commit();
            closeModal("cmtFormModal");
            await openCommittees();
            await openCommittee(ref.id);
        } catch (e) { alert("Not saved: " + e.message); }
    });
}
async function openCommittee(id) {
    const [c, ms] = await Promise.all([db.collection("committees").doc(id).get(), db.collection("committeeMembers").where("committeeId", "==", id).get()]);
    cmtSel = { id, ...c.data(), members: ms.docs.map(d => ({ id: d.id, ...d.data() })) };
    const order = { Chair: 0, Secretary: 1, Member: 2 };
    const mem = st => cmtSel.members.filter(m => m.status === st).sort((a, b) => order[a.role] - order[b.role] || a.fullName.localeCompare(b.fullName));
    const card = m => `<div class="cm-member border rounded p-2 flex items-center gap-2"><span class="flex-1"><b>${esc(m.fullName)}</b> · ${esc(m.role)}${m.isClergy ? " · Clergy" : ""}<br>
        <span class="font-mono text-gray-500">${esc(m.personNo)}</span> · ${esc(m.parishName)} · ${esc(m.joinedDate)}${m.leftDate ? " to " + esc(m.leftDate) : ""}</span>
        ${m.status === "Current" ? `<select onchange="setCmRole('${esc(m.id)}', this.value)" class="border rounded p-1">${CM_ROLES.map(r => `<option ${r === m.role ? "selected" : ""}>${r}</option>`).join("")}</select>
        <button onclick="leaveCommittee('${esc(m.id)}')" class="px-2 py-1 border rounded text-rose-700">Remove</button>` : ""}</div>`;
    $("cmtTitle").textContent = cmtSel.name;
    $("cmtBody").innerHTML = `<p><b>Term:</b> ${esc(cmtSel.termStart)} to ${esc(cmtSel.termEnd)} · ${esc(cmtSel.status)}</p>
        <p><b>Purpose:</b> ${esc(cmtSel.purpose || "—")}</p><p class="whitespace-pre-line"><b>Duties:</b> ${esc(cmtSel.duties || "—")}</p>
        <p class="font-bold mt-2">Current members</p><div id="cm_current" class="space-y-1">${mem("Current").map(card).join("") || `<p class="text-gray-400 italic">Nobody yet.</p>`}</div>
        <p class="font-bold mt-2">Add a member or clergy</p>
        <div class="flex gap-1"><input id="cm_q" oninput="findCmPeople()" class="flex-1 border p-2 rounded" placeholder="Type a name"><select id="cm_role" class="border p-2 rounded">${CM_ROLES.map(r => `<option>${r}</option>`).join("")}</select></div>
        <div id="cm_found" class="space-y-1"></div>
        <p class="font-bold mt-2">Former members</p><div id="cm_former" class="space-y-1">${mem("Former").map(card).join("") || `<p class="text-gray-400 italic">None.</p>`}</div>`;
    $("cmtActions").innerHTML = `<button onclick="openCommitteeForm(cmtAll.find(c => c.id === cmtSel.id))" class="px-3 py-2 border rounded font-bold">Edit committee</button>`;
    openModal("cmtModal");
}
let cmTimer = null;
function findCmPeople() { clearTimeout(cmTimer); cmTimer = setTimeout(() => runCmFind().catch(e => alert(e.message)), 250); }
async function runCmFind() {
    const t = val("cm_q").toLowerCase();
    if (t.length < 2) return $("cm_found").innerHTML = "";
    const dir = await db.collection("directory").orderBy("nameLower").startAt(t).endAt(t + "").limit(8).get();
    const people = dir.docs.map(d => d.data()).filter(x => x.status === "Active").map(x => [x.parishId, x.memberNo, x.fullName, x.parishName, x.rank])
        .concat(register.filter(c => c.status === "Active" && c.nameLower?.includes(t)).slice(0, 5).map(c => [c.parishId, c.memberNo, c.fullName, c.parish, c.rank]));
    const already = new Set(cmtSel.members.filter(m => m.status === "Current").map(m => m.parishId + "_" + m.personNo));
    $("cm_found").innerHTML = people.map(([p, no, n, pn, r]) => already.has(p + "_" + no) ? "" :
        `<button onclick="addToCommittee('${esc(p)}','${esc(no)}')" class="cm-match w-full text-left border rounded p-2 bg-emerald-50">+ ${esc(n)} <span class="font-mono">${esc(no)}</span> · ${esc([r, pn].filter(Boolean).join(" · "))}</button>`).join("")
        || `<p class="text-gray-400">No match.</p>`;
}
// The committee membership, its audit entry and (for members) the directory's "committees served", in one batch.
function cmWrite(b, rec, before, action) {
    const ref = db.collection("committeeMembers").doc(`${rec.committeeId}_${rec.parishId}_${rec.personNo}`);
    b.set(ref, rec);
    writeAudit(b, "committeeMembers/" + ref.id, rec.version, action, before ? pick(before, ["role", "status", "leftDate"]) : null, pick(rec, ["role", "status", "leftDate", "personNo", "parishId"]));
}
async function syncDirCommittees(b, rec) {
    if (rec.isClergy) return;
    const ref = dirRef(rec.parishId, rec.personNo);
    const cur = ((await ref.get()).data().committees || []).filter(c => c.id !== rec.committeeId);
    cur.push({ id: rec.committeeId, name: rec.committeeName, role: rec.role, status: rec.status, from: rec.joinedDate, to: rec.leftDate || "" });
    b.update(ref, { committees: cur.slice(-60) });
}
async function addToCommittee(parishId, no) {
    if (needName()) return;
    const isClergy = no.includes("-CLG-");
    const src = isClergy ? register.find(c => c.parishId === parishId && c.memberNo === no) : (await dirRef(parishId, no).get()).data();
    const id = `${cmtSel.id}_${parishId}_${no}`, prev = cmtSel.members.find(m => m.id === id);
    const rec = { committeeId: cmtSel.id, committeeName: cmtSel.name, parishId, parishName: (localState.parishNames || {})[parishId] || src.parishName || "",
        personNo: no, fullName: src.fullName, isClergy, role: $("cm_role").value, status: "Current", joinedDate: prev ? prev.joinedDate : localToday(), leftDate: "",
        version: prev ? prev.version + 1 : 1, updatedAt: nowIso(), updatedBy: localState.user.uid };
    await cmCommit(rec, prev, prev ? "rejoin" : "add");
}
async function setCmRole(id, role) {
    const m = cmtSel.members.find(x => x.id === id);
    const { id: _, ...prev } = m;
    await cmCommit({ ...prev, role, version: m.version + 1, updatedAt: nowIso(), updatedBy: localState.user.uid }, m, "role");
}
async function leaveCommittee(id) {
    const m = cmtSel.members.find(x => x.id === id);
    const { id: _, ...prev } = m;
    await cmCommit({ ...prev, status: "Former", leftDate: localToday(), version: m.version + 1, updatedAt: nowIso(), updatedBy: localState.user.uid }, m, "remove");
}
async function cmCommit(rec, before, action) {
    if (needName()) return;
    try {
        const b = db.batch();
        cmWrite(b, rec, before, action);
        await syncDirCommittees(b, rec);
        await b.commit();
        await openCommittee(rec.committeeId);
    } catch (e) { alert("Not saved: " + e.message); }
}
