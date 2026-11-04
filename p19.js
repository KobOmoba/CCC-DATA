// Batch 18 (p19): DATA INTAKE AGENT + ARCHIVE (mobile-first).
//  1. Data Intake (parish admin; Super Admin reads + downloads CSV only, member records are parish-private):
//     many files at once. DOCX / XLSX / CSV / TXT are turned into text on the phone (vendored mammoth + SheetJS);
//     photos (HEIC tried as JPEG first) and PDFs go to the ccc-ai worker route /classify, which returns people WITH
//     placement (member / clergy, prophet, departments, committees). Results feed the p18 import preview (extra
//     placement columns, red problems, duplicates held back) and "Save all" creates each record, its import log,
//     its department places (same transaction) and then the committee places (one audited write per committee).
//  2. Archive: archive/{id} in Firestore is the index; the file itself is in Cloudflare R2 behind the ccc-ai worker
//     (POST /archive/upload, GET /archive/file?id=). Never deleted: hidden / shown again with a reason, audited.
//     Batch 18b DEMO storage: while R2 is not switched on (worker answers 503, or ARCHIVE_STORAGE = "firestore"),
//     files go into Firestore instead (free plan): JPEGs (long side ~1600 px) split into <= 700 KB chunks in
//     archive/{id}/chunks/{n}; a PDF becomes up to 10 page pictures (vendored pdf.js). Max 5 MB per item.
//     The doc says storage: "r2" | "firestore" so scripts/archive-migrate-r2.mjs can move demo items to R2 later.

const AI_BASE = AI_URL.replace(/\/extract$/, "");
const CLASSIFY_URL = AI_BASE + "/classify";
const MAX_AI_FILE = 6000000;
const TEXT_CHUNK = 50000;

// ================================================================= 1. DATA INTAKE
let intake = { files: [], people: [] };
const inIsSuper = () => localState.role === "super_admin";

function openIntake() {
    $("in_superNote").classList.toggle("hidden", !inIsSuper());
    $("in_previewBtn").classList.toggle("hidden", inIsSuper());
    renderIntake();
}
const intakeUnits = () => (inIsSuper() ? DEPTS.map(d => [d.id, d.name]) : allUnits()).map(([id, name]) => ({ id, name }));
const intakeCommittees = () => inIsSuper() ? [] : pcAll.filter(c => c.status === "Active" && pcPhase(c) !== "Past");

// One file -> list of inputs for the worker: [{text}] or [{file, mime}].
async function intakeInputs(file) {
    const name = file.name.toLowerCase(), ext = name.split(".").pop();
    const isHeic = /hei[cf]$/.test(ext) || /hei[cf]/.test(file.type);
    if (file.type.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext)) {
        try { // HEIC -> JPEG where the phone can decode it; otherwise send the HEIC itself (the AI reads it).
            const dataUrl = await compressImage(file, 1500000, 2000);
            return [{ file: dataUrl.split(",")[1], mime: "image/jpeg" }];
        } catch (e) {
            if (!isHeic) throw e;
            if (file.size > MAX_AI_FILE) throw new Error("This HEIC photo is too big. Share it as JPG instead.");
            return [{ file: await fileToBase64(file), mime: "image/heic" }];
        }
    }
    if (ext === "pdf" || file.type === "application/pdf") {
        if (file.size > MAX_AI_FILE) throw new Error("PDF over 6 MB. Split it or take photos of the pages.");
        return [{ file: await fileToBase64(file), mime: "application/pdf" }];
    }
    if (["txt", "csv", "xlsx", "xls", "docx"].includes(ext)) return textChunks((await readListFile(file)).text);
    throw new Error("Not supported. Use photos, PDF, DOCX, XLSX, CSV or TXT.");
}
// Long text goes in pieces, cut at blank lines, so nobody is lost at the AI's size limit.
function textChunks(text) {
    const parts = [], blocks = String(text || "").split(/\n\s*\n/);
    let cur = "";
    for (const b of blocks) {
        if (cur && (cur.length + b.length + 2) > TEXT_CHUNK) { parts.push(cur); cur = ""; }
        cur += (cur ? "\n\n" : "") + b.slice(0, TEXT_CHUNK);
    }
    if (cur.trim()) parts.push(cur);
    return parts.map(t => ({ text: t }));
}
async function callClassify(input) {
    const token = await auth.currentUser.getIdToken();
    const body = { ...input, units: intakeUnits(), committees: intakeCommittees().map(c => c.name) };
    const r = await fetch(CLASSIFY_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || ("AI service error " + r.status));
    return d.people || [];
}

async function intakeRun(extraFiles) {
    const files = extraFiles || [...$("in_files").files], text = extraFiles ? "" : val("in_text");
    if (!files.length && !text) return alert("Choose one or more files, or paste some text.");
    if (files.length > 30) return alert("At most 30 files at a time.");
    if (!inIsSuper()) await Promise.all([loadUnits(), loadPCommittees()]).catch(() => {});
    intake = { files: files.map(f => ({ name: f.name, status: "Waiting", count: 0, error: "" })), people: [] };
    if (text) intake.files.push({ name: "Pasted text", status: "Waiting", count: 0, error: "" });
    renderIntake();
    await busy("in_readBtn", async () => {
        const jobs = files.map((f, i) => [i, () => intakeInputs(f)]);
        if (text) jobs.push([files.length, async () => textChunks(text)]);
        for (const [i, get] of jobs) { // one by one: the worker allows a few requests a minute per person
            const st = intake.files[i];
            try {
                st.status = "Reading"; renderIntake();
                for (const input of await get()) {
                    const people = await callClassify(input);
                    people.forEach(p => { applyRankAbbr(p); intake.people.push({ ...p, sourceFile: st.name }); });
                    st.count += people.length;
                }
                st.status = "Done";
            } catch (e) { st.status = "Failed"; st.error = e.message; }
            renderIntake();
        }
    });
    const failed = intake.files.filter(f => f.status === "Failed").length;
    $("in_status").textContent = `Found ${intake.people.length} ${intake.people.length === 1 ? "person" : "people"} in ${intake.files.length - failed} of ${intake.files.length} files.`
        + (intake.people.length ? (inIsSuper() ? " Download the CSV for the parish admin." : " Tap Check and save.") : "");
    renderIntake();
}
function renderIntake() {
    const icon = { Waiting: "fa-clock text-gray-400", Reading: "fa-spinner fa-spin text-violet-600", Done: "fa-check text-emerald-600", Failed: "fa-triangle-exclamation text-red-600" };
    $("in_fileList").innerHTML = intake.files.map(f => `<div class="in-file flex items-center gap-2 bg-white border rounded-lg p-2" data-status="${f.status}">
        <i class="fa-solid ${icon[f.status]} w-4"></i><span class="flex-1 min-w-0 truncate font-semibold">${esc(f.name)}</span>
        <span class="${f.status === "Failed" ? "text-red-700" : "text-gray-600"}">${f.status === "Done" ? f.count + " found" : f.status === "Failed" ? esc(f.error).slice(0, 80) : f.status}</span></div>`).join("");
    $("in_result").classList.toggle("hidden", !intake.people.length);
    const unit = id => deptName(id);
    $("in_people").innerHTML = intake.people.map(p => `<div class="in-person bg-white border rounded-lg p-2">
        <p class="font-bold">${esc(p.fullName)} <span class="font-normal text-gray-500">· ${esc(p.gender || "?")} · ${p.track === "clergy" ? "Clergy" : "Member"}${p.prophet ? (p.gender === "Female" ? " · Prophetess" : " · Prophet") : ""}</span></p>
        <p class="text-gray-600">${esc(p.rank || p.rankAsWritten || "No rank written")}${(p.departments || []).length ? " · " + p.departments.map(unit).map(esc).join(", ") : ""}${(p.committees || []).length ? " · " + p.committees.map(c => esc(c.name + " (" + c.role + ")")).join(", ") : ""}</p>
        ${p.placementNote ? `<p class="text-amber-700">${esc(p.placementNote)}</p>` : ""}<p class="text-[10px] text-gray-400">${esc(p.sourceFile)}</p></div>`).join("");
}

// AI person -> a p18 import row with placement.
const dmText = (d, m, y) => d && m ? `${d} ${MONTHS[m - 1]}${y ? " " + y : ""}` : y ? String(y) : "";
function intakeRow(p) {
    const r = { raw: null, intake: true, fullName: p.fullName || "", gender: p.gender || "", maritalStatus: p.maritalStatus || "", address: p.address || "",
        phone: String(p.phone || "").replace(/[^\d+]/g, ""), email: (p.email || "").toLowerCase(), rankText: p.rank || p.rankAsWritten || "", rank: "", prophet: false,
        occupation: p.occupation || "", dobText: dmText(p.dobDay, p.dobMonth, p.dobYear), anointText: dmText(p.anointDay, p.anointMonth, p.anointYear),
        nokName: p.nokName || "", nokAddress: p.nokAddress || "", nokPhone: String(p.nokPhone || "").replace(/[^\d+]/g, ""),
        track: p.track === "clergy" ? "Clergy" : "Member", prophetFlag: p.prophet ? "Yes" : "No",
        deptText: (p.departments || []).map(deptName).join(", "), deptRole: p.deptRole || "",
        cmtText: (p.committees || []).map(c => `${c.name}: ${c.role || "Member"}`).join("; "), placementNote: p.placementNote || "", sourceFile: p.sourceFile || "" };
    return resolveRow(r);
}
// Called by p18 resolveRow() for intake rows: department / committee names -> ids, and the placement rules.
const loose = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function matchUnit(t) {
    const k = loose(t);
    const hit = allUnitsAny().find(([id, name]) => loose(id) === k || loose(name) === k || name.split("/").some(n => loose(n) === k) || loose(name).startsWith(k) && k.length >= 4);
    return hit ? hit[0] : "";
}
const allUnitsAny = () => inIsSuper() ? DEPTS.map(d => [d.id, d.name]) : allUnits();
function resolvePlacement(r) {
    const pr = r.problems;
    if (r.prophetFlag === "Yes") r.prophet = true;
    const depts = String(r.deptText || "").split(",").map(s => s.trim()).filter(Boolean);
    r.deptIds = [...new Set(depts.map(matchUnit).filter(Boolean))];
    const unknownD = depts.filter(d => !matchUnit(d));
    if (unknownD.length) pr.deptText = `Not a unit of this parish: ${unknownD.join(", ")}`;
    r.cmts = [];
    const unknownC = [];
    String(r.cmtText || "").split(";").map(s => s.trim()).filter(Boolean).forEach(s => {
        const [name, role] = s.split(":").map(x => (x || "").trim());
        const c = intakeCommittees().find(x => loose(x.name) === loose(name));
        if (c) r.cmts.push({ id: c.id, name: c.name, role: (role || "Member").slice(0, 40) }); else unknownC.push(name);
    });
    if (unknownC.length) pr.cmtText = `No current committee called: ${unknownC.join(", ")}`;
    if (r.track === "Clergy") {
        if (r.gender === "Female") pr.track = "Women are never clergy. Choose Member.";
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email || "")) pr.email = "Clergy need an email";
        if (r.deptIds.length) pr.deptText = "Clergy cannot join a department";
    }
    return r;
}
function intakePreview() {
    if (!intake.people.length) return;
    imp = { rows: intake.people.map(intakeRow), source: "intake" };
    $("imp_text").value = ""; $("imp_file").value = ""; $("imp_consent").checked = false;
    impTab("intake");
    impCheckDuplicates().then(() => { saveImpState(); renderImport(); });
    $("imp_status").textContent = `${imp.rows.length} people from the Data Intake. Check the red cells and the placement columns, then tap Save all.`;
    renderImport();
    openModal("importModal");
}
// After Save all: add the saved people to their committees, one audited write per committee.
async function intakeSaveCommittees(saved) {
    const byC = {};
    saved.forEach(r => (r.cmts || []).filter(c => !(r.cmtDone || []).includes(c.id)).forEach(c => (byC[c.id] ||= []).push({ r, c })));
    const notes = [];
    for (const [id, list] of Object.entries(byC)) {
        try {
            await db.runTransaction(async t => {
                const ref = parishRef().collection("pcommittees").doc(id), d = await t.get(ref);
                if (!d.exists) throw new Error("committee not found");
                const o = d.data(), have = new Set((o.members || []).filter(m => m.status === "Current").map(m => m.memberNo));
                const add = list.filter(x => !have.has(x.r.saved)).map(x => ({ memberNo: x.r.saved, fullName: x.r.fullName, role: x.c.role, status: "Current", from: localToday(), to: "" }));
                const members = (o.members || []).concat(add);
                if (members.length > 60) throw new Error("a committee keeps at most 60 member records");
                const rec = { ...o, members, version: o.version + 1, updatedAt: nowIso(), updatedBy: localState.user.uid };
                t.set(ref, rec);
                parishAudit(t, `parishes/${localState.currentParishId}/pcommittees/${id}`, rec.version, "member-add", null,
                    { change: `Data Intake: ${add.map(a => `${a.fullName} (${a.memberNo}) as ${a.role}`).join(", ")}`.slice(0, 900) });
            });
            list.forEach(({ r, c }) => (r.cmtDone ||= []).push(c.id));
        } catch (e) { notes.push(`${list[0].c.name}: ${e.message}`); }
    }
    imp.cmtNote = notes.length ? "Committee places not saved: " + notes.join("; ") : Object.keys(byC).length ? `Committee places saved (${Object.keys(byC).length} committees).` : "";
    loadPCommittees().catch(() => {});
}
function intakeCsv() {
    const cols = [...CSV_COLS, "Track", "Prophet", "Departments", "Role in unit", "Committees", "Source file"];
    const rows = intake.people.map(p => [p.fullName, p.gender, p.maritalStatus, p.address, p.phone, p.email, p.rank || p.rankAsWritten, p.occupation,
        dmText(p.dobDay, p.dobMonth, p.dobYear), dmText(p.anointDay, p.anointMonth, p.anointYear), p.nokName, p.nokAddress, p.nokPhone,
        p.track === "clergy" ? "Clergy" : "Member", p.prophet ? "Yes" : "No", (p.departments || []).map(deptName).join(", "), p.deptRole,
        (p.committees || []).map(c => `${c.name}: ${c.role}`).join("; "), p.sourceFile].map(v => String(v ?? "")));
    const csv = [cols, ...rows].map(r => r.map(c => /[",;\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(",")).join("\r\n") + "\r\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = "ccc-intake.csv";
    document.body.appendChild(a); a.click(); a.remove();
}

// ================================================================= 2. ARCHIVE
const AR_CATS = ["History", "Minutes", "Registers", "Certificates", "Photos", "Letters", "Other"];
const AR_MAX = 15 * 1024 * 1024;
let arch = { list: [], urls: {}, mode: "" };
// "auto" = ask the worker once (503 means R2 is not set up yet -> demo storage); "firestore" or "r2" forces a mode.
const ARCHIVE_STORAGE = window.CCC_ARCHIVE_STORAGE || "auto";
const AR_DEMO_MAX = 5 * 1024 * 1024, AR_CHUNK = 700 * 1024, AR_PAGES = 10, AR_DIM = 1600;
async function archiveMode() {
    if (arch.mode) return arch.mode;
    if (ARCHIVE_STORAGE !== "auto") return (arch.mode = ARCHIVE_STORAGE);
    try {
        const token = await auth.currentUser.getIdToken();
        const r = await fetch(`${AI_BASE}/archive/file?id=_probe`, { headers: { Authorization: "Bearer " + token } });
        return (arch.mode = r.status === 503 ? "firestore" : "r2");
    } catch { return "firestore"; } // worker unreachable: demo storage still works (not remembered, asked again next time)
}
const archWriter = () => localState.role === "parish_admin" || (inIsSuper() && (localState.name || "").length >= 3);
const archParishName = pid => pid === "HQ" ? "Headquarters" : pid === localState.currentParishId ? (localState.parish.name || "") : ((localState.parishNames || {})[pid] || pid);

async function openArchive() {
    const sel = $("ar_cat");
    if (sel.options.length === 1) sel.insertAdjacentHTML("beforeend", AR_CATS.map(c => `<option>${c}</option>`).join(""));
    const wide = localState.role !== "parish_admin";
    $("ar_parish").classList.toggle("hidden", !wide);
    if (wide && !$("ar_parish").options.length)
        $("ar_parish").innerHTML = `<option value="">All parishes + HQ</option><option value="HQ">Headquarters (HQ)</option>` +
            Object.entries(localState.parishNames || {}).sort((a, b) => String(a[1]).localeCompare(b[1])).map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join("");
    $("ar_addBtn").classList.toggle("hidden", !archWriter());
    $("ar_hiddenBox").classList.toggle("hidden", !archWriter());
    $("ar_demoNote").classList.toggle("hidden", !archWriter() || (await archiveMode()) !== "firestore");
    let q = db.collection("archive");
    if (!wide) q = q.where("parishId", "==", localState.currentParishId);
    else if ($("ar_parish").value) q = q.where("parishId", "==", $("ar_parish").value);
    const s = await q.limit(500).get();
    arch.list = s.docs.map(d => ({ id: d.id, ...d.data() }));
    renderArchive();
}
function renderArchive() {
    const q = val("ar_q").toLowerCase(), cat = $("ar_cat").value, yr = val("ar_year"), showHidden = $("ar_showHidden").checked;
    const rows = arch.list.filter(a => (!a.hidden || showHidden) && (!cat || a.category === cat) && (!yr || String(a.year || "") === yr || String(a.date || "").startsWith(yr))
        && (!q || [a.title, a.description, (a.tags || []).join(" "), a.parishName].join(" ").toLowerCase().includes(q)))
        .sort((a, b) => String(b.date || b.year || "").localeCompare(String(a.date || a.year || "")) || a.title.localeCompare(b.title));
    $("ar_count").textContent = `${rows.length} item${rows.length === 1 ? "" : "s"}`;
    const ic = m => m === "application/pdf" ? "fa-file-pdf text-red-600" : "fa-image text-blue-600";
    $("ar_list").innerHTML = rows.map(a => `<button onclick="archiveView('${esc(a.id)}')" class="ar-row w-full text-left bg-white border rounded-xl p-3 flex gap-3 items-start ${a.hidden ? "opacity-60" : ""}" data-id="${esc(a.id)}">
        <i class="fa-solid ${ic(a.mime)} text-2xl w-7 shrink-0"></i>
        <span class="flex-1 min-w-0"><span class="block font-bold">${esc(a.title)}${a.hidden ? ` <span class="text-[10px] bg-gray-200 rounded px-1">hidden</span>` : ""}</span>
        <span class="block text-gray-600">${esc(a.category)} · ${esc(a.date || "No date")} · ${esc(a.parishName || archParishName(a.parishId))}</span>
        ${(a.tags || []).length ? `<span class="block mt-1">${a.tags.map(t => `<span class="inline-block bg-amber-50 border border-amber-200 rounded px-1.5 mr-1 mb-1">${esc(t)}</span>`).join("")}</span>` : ""}</span></button>`).join("")
        || `<p class="text-gray-400 italic">Nothing in the archive yet${archWriter() ? ". Tap + Add to keep the first document." : "."}</p>`;
}

// Fetches the file through the worker (the token proves who is asking; Firestore rules decide).
async function archiveBlob(id) {
    if (arch.urls[id]) return arch.urls[id];
    if ((arch.list.find(x => x.id === id) || {}).storage === "firestore") return archivePagesBlob(id);
    const token = await auth.currentUser.getIdToken();
    const r = await fetch(`${AI_BASE}/archive/file?id=${encodeURIComponent(id)}`, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not open the file (" + r.status + ")");
    const blob = await r.blob();
    return (arch.urls[id] = { blob, url: URL.createObjectURL(blob) });
}
// Demo storage: read the chunks, join the parts of each page back into one JPEG per page.
async function archivePagesBlob(id) {
    const s = await db.collection("archive").doc(id).collection("chunks").get();
    const parts = s.docs.map(d => ({ n: +d.id, ...d.data() })).sort((a, b) => a.n - b.n), pages = [];
    for (const c of parts) (pages[c.page] ||= []).push(c.data.toUint8Array());
    const blobs = pages.filter(Boolean).map(p => new Blob(p, { type: "image/jpeg" }));
    return (arch.urls[id] = { blob: blobs[0], blobs, url: URL.createObjectURL(blobs[0]), urls: blobs.map(b => URL.createObjectURL(b)) });
}
async function archiveView(id) {
    const a = arch.list.find(x => x.id === id);
    if (!a) return;
    const can = archWriter() && (a.parishId !== "HQ" || inIsSuper());
    p9Modal(a.title, `<div id="ar_viewer" class="bg-gray-100 rounded min-h-[160px] flex items-center justify-center text-gray-500"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Loading...</div>
        <div class="text-xs space-y-1 mt-2"><p><b>${esc(a.category)}</b> · ${esc(a.date || "No date")} · ${esc(a.parishName || archParishName(a.parishId))}</p>
        ${a.description ? `<p class="whitespace-pre-wrap">${esc(a.description)}</p>` : ""}
        ${(a.tags || []).length ? `<p>Tags: ${a.tags.map(esc).join(", ")}</p>` : ""}
        <p class="text-gray-500">${esc(a.fileName || "")} · ${(a.size / 1024 / 1024).toFixed(2)} MB${a.hidden ? ` · hidden (${esc(a.hiddenReason || "")})` : ""}</p></div>`,
        `${can ? `<button onclick="archiveForm('${esc(id)}')" class="px-3 py-2 border rounded">Edit</button>
           <button id="ar_hideBtn" onclick="archiveHide('${esc(id)}')" class="px-3 py-2 border rounded ${a.hidden ? "text-emerald-700" : "text-rose-700"}">${a.hidden ? "Show again" : "Hide"}</button>` : ""}
         ${archWriter() ? `<button id="ar_extractBtn" onclick="archiveExtract('${esc(id)}')" class="px-3 py-2 bg-violet-700 text-white rounded font-bold"><i class="fa-solid fa-wand-magic-sparkles"></i> Extract people</button>` : ""}`);
    try {
        const { url, urls } = await archiveBlob(id);
        $("ar_viewer").innerHTML = urls
            ? `<div class="w-full space-y-2 p-2">${urls.map((u, i) => `<img src="${u}" alt="${esc(a.title)} page ${i + 1}" class="ar-page w-full rounded bg-white">`).join("")}
               <p class="text-center text-gray-500">${a.mime === "application/pdf" ? `PDF kept as ${urls.length} page picture${urls.length === 1 ? "" : "s"} · ` : ""}demo storage</p></div>`
            : a.mime === "application/pdf"
            ? `<div class="w-full space-y-2 p-2"><iframe src="${url}" title="${esc(a.title)}" class="w-full h-[60vh] bg-white rounded"></iframe><a href="${url}" target="_blank" rel="noopener" class="block text-center py-2 border rounded bg-white font-semibold">Open the PDF full screen</a></div>`
            : `<img id="ar_img" src="${url}" alt="${esc(a.title)}" class="max-w-full max-h-[60vh] rounded">`;
    } catch (e) { $("ar_viewer").textContent = e.message; }
}
async function archiveExtract(id) {
    const a = arch.list.find(x => x.id === id);
    try {
        const { blob, blobs } = await archiveBlob(id);
        closeModal("p9Modal"); showSection("intake");
        const base = (a.fileName || a.title).replace(/\.[a-z0-9]+$/i, "");
        await intakeRun(blobs ? blobs.map((b, i) => new File([b], `${base}${blobs.length > 1 ? "-p" + (i + 1) : ""}.jpg`, { type: "image/jpeg" }))
            : [new File([blob], a.fileName || a.title, { type: a.mime })]);
    } catch (e) { alert("Could not read it: " + e.message); }
}

function archiveForm(id) {
    const a = id ? arch.list.find(x => x.id === id) : {};
    if (!archWriter()) return alert(inIsSuper() ? "Add your full name (Committees page) first." : "Only parish admins can add to the archive.");
    const parishPick = inIsSuper() && !id ? `<label class="block text-xs font-semibold">Archive of</label><select id="af_parish" class="w-full border p-2 rounded">
        <option value="HQ">Headquarters (HQ)</option>${Object.entries(localState.parishNames || {}).map(([pid, n]) => `<option value="${esc(pid)}">${esc(n)}</option>`).join("")}</select>` : "";
    p9Modal(id ? "Edit archive item" : "Add to the archive", `<div class="space-y-2 text-xs">
        ${id ? "" : `<label class="block font-semibold">File * (photo, scan or PDF, max ${arch.mode === "firestore" ? "5 MB, PDF up to 10 pages" : "15 MB"})</label><input type="file" id="af_file" accept="image/*,.heic,.pdf,application/pdf" class="w-full border p-2 rounded bg-gray-50">`}
        ${parishPick}
        <label class="block font-semibold">Title *</label><input id="af_title" maxlength="160" class="w-full border p-2.5 rounded" value="${esc(a.title || "")}" placeholder="e.g. Parochial Committee minutes, May 1990">
        <label class="block font-semibold">Category *</label><select id="af_cat" class="w-full border p-2 rounded">${AR_CATS.map(c => `<option ${a.category === c ? "selected" : ""}>${c}</option>`).join("")}</select>
        <label class="block font-semibold">Date or year</label><input id="af_date" class="w-full border p-2.5 rounded" value="${esc(a.date || "")}" placeholder="1990, 1990-05 or 1990-05-14">
        <label class="block font-semibold">Tags (comma between)</label><input id="af_tags" class="w-full border p-2.5 rounded" value="${esc((a.tags || []).join(", "))}" placeholder="harvest, founder, building">
        <label class="block font-semibold">Description</label><textarea id="af_desc" rows="3" maxlength="2000" class="w-full border p-2 rounded">${esc(a.description || "")}</textarea>
        <p id="af_status" class="text-gray-600"></p></div>`,
        `<button id="af_saveBtn" onclick="archiveSave(${id ? `'${esc(id)}'` : ""})" class="px-4 py-2 bg-blue-900 text-white rounded font-bold">Save</button>`);
}
// Photos are made into a sharp JPEG under ~3 MB; PDFs go as they are.
async function archivePrepare(file) {
    const ext = file.name.toLowerCase().split(".").pop();
    if (file.type === "application/pdf" || ext === "pdf") {
        if (file.size > AR_MAX) throw new Error("PDF over 15 MB.");
        return { body: file, mime: "application/pdf" };
    }
    let dataUrl;
    try { dataUrl = await compressImage(file, 3000000, 2600); } catch { throw new Error("This photo type cannot be read on this phone. Share it as JPG and try again."); }
    const bin = atob(dataUrl.split(",")[1]), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { body: new Blob([bytes], { type: "image/jpeg" }), mime: "image/jpeg" };
}
// Demo storage: one JPEG per page (photo = 1 page, PDF = up to 10 pages rendered by pdf.js), each made to fit the
// 5 MB item cap, then split into <= 700 KB chunks.
const dataUrlBytes = u => { const bin = atob(u.split(",")[1]), b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; };
async function archiveDemoPages(file) {
    const ext = file.name.toLowerCase().split(".").pop();
    if (file.type === "application/pdf" || ext === "pdf") {
        await loadLib(LIBS.pdf);
        pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
        const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        if (pdf.numPages > AR_PAGES) throw new Error(`This PDF has ${pdf.numPages} pages. Demo storage keeps up to ${AR_PAGES}: split it and add the parts.`);
        const budget = Math.min(1500000, Math.floor((AR_DEMO_MAX - 50000) / pdf.numPages)), pages = [];
        for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p), v0 = page.getViewport({ scale: 1 });
            const vp = page.getViewport({ scale: AR_DIM / Math.max(v0.width, v0.height) });
            const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
            const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
            await page.render({ canvasContext: x, viewport: vp }).promise;
            const png = await new Promise(r => c.toBlob(r, "image/png"));
            pages.push(dataUrlBytes(await compressImage(png, budget, AR_DIM)));
        }
        return { pages, mime: "application/pdf" };
    }
    let dataUrl;
    try { dataUrl = await compressImage(file, 2500000, AR_DIM); } catch { throw new Error("This photo type cannot be read on this phone. Share it as JPG and try again."); }
    return { pages: [dataUrlBytes(dataUrl)], mime: "image/jpeg" };
}
function archiveChunks(pages) {
    const out = [];
    pages.forEach((b, page) => { for (let i = 0; i < b.length; i += AR_CHUNK) out.push({ page, data: firebase.firestore.Blob.fromUint8Array(b.subarray(i, i + AR_CHUNK)) }); });
    return out;
}
function archiveFields() {
    const title = val("af_title"), date = val("af_date");
    if (!title) throw new Error("Type a title.");
    if (date && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(date)) throw new Error("Date: write 1990, 1990-05 or 1990-05-14.");
    const tags = [...new Set(val("af_tags").split(",").map(t => t.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 12);
    return { title, titleLower: title.toLowerCase(), category: $("af_cat").value, date, year: date ? +date.slice(0, 4) : null, tags, description: val("af_desc") };
}
function archiveAudit(b, id, v, action, parishId, after, reason = "") {
    b.set(db.collection("auditLog").doc(`archive_${id}_v${v}`), { action, target: "archive/" + id, targetVersion: v, parishId, reason: String(reason).slice(0, 300),
        before: null, after, by: localState.user.uid, byEmail: (localState.user.email || "").toLowerCase(), byName: localState.name || "", role: localState.role, at: srv() });
}
async function archiveSave(id) {
    let f;
    try { f = archiveFields(); } catch (e) { return alert(e.message); }
    await busy("af_saveBtn", async () => {
        try {
            if (id) {
                const ref = db.collection("archive").doc(id), b = db.batch();
                const o = (await ref.get()).data(), rec = { ...o, ...f, version: o.version + 1, updatedAt: nowIso(), updatedBy: localState.user.uid };
                b.set(ref, rec); archiveAudit(b, id, rec.version, "archive-edit", o.parishId, { title: f.title, category: f.category, date: f.date });
                await b.commit();
            } else {
                const file = $("af_file").files[0];
                if (!file) throw new Error("Choose the file first.");
                const parishId = inIsSuper() ? $("af_parish").value : localState.currentParishId;
                $("af_status").textContent = "Preparing the file...";
                if ((await archiveMode()) === "firestore") { await archiveSaveDemo(f, file, parishId); closeModal("p9Modal"); return openArchive(); }
                const { body, mime } = await archivePrepare(file);
                if (body.size > AR_MAX) throw new Error("File over 15 MB.");
                $("af_status").textContent = "Uploading...";
                const token = await auth.currentUser.getIdToken();
                const r = await fetch(`${AI_BASE}/archive/upload`, { method: "POST", body, headers: { Authorization: "Bearer " + token, "Content-Type": mime,
                    "X-Parish-Id": parishId, "X-File-Name": file.name.replace(/[^\w .()-]/g, "_").slice(0, 120) } });
                const up = await r.json().catch(() => ({}));
                if (r.status === 503 && ARCHIVE_STORAGE === "auto") { arch.mode = "firestore"; await archiveSaveDemo(f, file, parishId); closeModal("p9Modal"); return openArchive(); }
                if (!r.ok) throw new Error(up.error || "Upload failed (" + r.status + ")");
                const ref = db.collection("archive").doc(), b = db.batch();
                b.set(ref, { ...f, parishId, parishName: archParishName(parishId), storage: "r2", fileKey: up.key, fileName: file.name.slice(0, 120), mime: up.mime, size: up.size,
                    hidden: false, hiddenReason: "", version: 1, createdAt: nowIso(), createdBy: localState.user.uid, updatedAt: nowIso(), updatedBy: localState.user.uid });
                archiveAudit(b, ref.id, 1, "archive-add", parishId, { title: f.title, category: f.category, fileKey: up.key });
                await b.commit();
            }
            closeModal("p9Modal"); await openArchive();
        } catch (e) { $("af_status") ? $("af_status").textContent = "Not saved: " + e.message : alert("Not saved: " + e.message); }
    });
}
// One batch: the index doc, every chunk and the audit entry (rules accept chunks only in the parent's create batch).
async function archiveSaveDemo(f, file, parishId) {
    $("af_status").textContent = "Demo storage: making the pictures smaller...";
    const { pages, mime } = await archiveDemoPages(file);
    const size = pages.reduce((n, p) => n + p.length, 0);
    if (size > AR_DEMO_MAX) throw new Error("Still over 5 MB after shrinking. Use fewer pages.");
    const chunks = archiveChunks(pages);
    $("af_status").textContent = `Saving ${pages.length} picture${pages.length === 1 ? "" : "s"} (${(size / 1024 / 1024).toFixed(1)} MB)...`;
    const ref = db.collection("archive").doc(), b = db.batch();
    b.set(ref, { ...f, parishId, parishName: archParishName(parishId), storage: "firestore", fileKey: "", fileName: file.name.slice(0, 120), mime, size,
        chunks: chunks.length, pages: pages.length, hidden: false, hiddenReason: "", version: 1, createdAt: nowIso(), createdBy: localState.user.uid,
        updatedAt: nowIso(), updatedBy: localState.user.uid });
    chunks.forEach((c, i) => b.set(ref.collection("chunks").doc(String(i)), c));
    archiveAudit(b, ref.id, 1, "archive-add", parishId, { title: f.title, category: f.category, storage: "firestore", pages: pages.length });
    await b.commit();
}
async function archiveHide(id) {
    const a = arch.list.find(x => x.id === id), hide = !a.hidden;
    const reason = (prompt(hide ? "Why hide this item? (it is kept, never deleted)" : "Why show it again?") || "").trim();
    if (!reason) return;
    try {
        const ref = db.collection("archive").doc(id), b = db.batch();
        const o = (await ref.get()).data(), rec = { ...o, hidden: hide, hiddenReason: reason.slice(0, 300), version: o.version + 1, updatedAt: nowIso(), updatedBy: localState.user.uid };
        b.set(ref, rec); archiveAudit(b, id, rec.version, hide ? "archive-hide" : "archive-show", o.parishId, { hidden: hide }, reason);
        await b.commit();
        closeModal("p9Modal"); await openArchive();
    } catch (e) { alert("Not changed: " + e.message); }
}
