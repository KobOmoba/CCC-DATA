// Batch 21 (p21): audit gaps from Batch 2 (clergy) and Batch 3 (attendance).
//  1. Returning clergy: a Former clergy is "Restored to service" with the SAME CCC-CLG number. The finished period is
//     appended to servicePeriods (never removed); clergy.version = restoreCount and the audit entry
//     auditLog/parishes_{p}_clergy_{no}_v{n} is written in the same batch (never deleted). Women cannot be clergy; called to glory / posted out cannot return.
//  2. Clergy timeline on each clergy profile (ordination, ranks, postings, leaving, return) + "Clergy history" page:
//     everyone who has ever served in the parish, newest first, searchable, printable.
//  3. Transfer letter (photo or PDF) stored the free-plan Archive way: JPEG page pictures in <= 700 KB Firestore chunks.
//  4. Attendance reports as files: .xlsx (vendored SheetJS) and PDF (clean printable sheet -> Print -> Save as PDF).

const RESTORE_BLOCK = ["Called to glory", "Posting", "Converted to member"];
const canRestore = c => c.status === "Former" && c.gender === "Male" && !RESTORE_BLOCK.includes(c.leaveReason || "") && !c.deathId;
const LEAVE_TEXT = { Transfer: "Transferred", Retired: "Retired", "Called to glory": "Called to glory", Other: "Left the parish", "Converted to member": "Converted to member record" };
const leftText = (reason, to) => (LEAVE_TEXT[reason] || "Left") + (reason === "Transfer" && to ? ` to ${to}` : "");

// ================================================================= 1. RESTORED TO SERVICE
function openRestore() {
    const c = current.rec;
    if (c.gender !== "Male") return alert(FEMALE_CLERGY_MSG);
    if (!canRestore(c)) return alert("This record cannot be restored.");
    closeModal("recordModal");
    p9Modal("Restored to service", `<div class="space-y-2 text-xs">
        <p><b>${esc(c.fullName)}</b> keeps the same number <span class="font-mono">${esc(c.memberNo)}</span>. A new service period starts; the old one is kept.</p>
        <p class="text-gray-600">Left ${esc(c.leftDate || "")} · ${esc(leftText(c.leaveReason, c.transferredTo))}</p>
        <label class="block font-semibold">Back in service from *</label><input id="rs_from" type="date" class="w-full border p-2.5 rounded" value="${esc(localToday())}">
        <label class="block font-semibold">Posting / role in the parish</label><input id="rs_posting" maxlength="120" class="w-full border p-2.5 rounded" placeholder="e.g. Shepherd in charge, Assistant shepherd">
        <p id="rs_status" class="text-gray-600"></p></div>`,
        `<button id="rs_saveBtn" onclick="saveRestore()" class="px-4 py-2 bg-emerald-700 text-white rounded font-bold">Restore</button>`);
}
async function saveRestore() {
    const c = current.rec, from = $("rs_from").value, posting = val("rs_posting");
    if (!canRestore(c)) return alert("This record cannot be restored.");
    if (!from) return alert("Enter the date they are back in service.");
    if (c.leftDate && from < c.leftDate) return alert("The new start date cannot be before the date they left (" + c.leftDate + ").");
    await busy("rs_saveBtn", async () => {
        try {
            const pid = localState.currentParishId, n = (c.restoreCount || 0) + 1;
            const period = { from: c.restoredDate || c.joinedDate || "", to: c.leftDate, reason: c.leaveReason || "", transferredTo: c.transferredTo || "", letterId: c.letterId || "" };
            const record = (c.serviceRecord || []).map(r => r.to ? r : { ...r, to: c.leftDate });
            record.push({ rank: "Restored to service" + (posting ? " · " + posting : ""), from, to: from });
            if (c.rank) record.push({ rank: c.rank, from });
            const next = { ...c, status: "Active", restoreCount: n, version: n, restoredDate: from, servicePeriods: [...(c.servicePeriods || []), period],
                leftDate: "", leaveReason: "", transferredTo: "", letterId: "", serviceRecord: record.slice(-40), updatedAt: nowIso() };
            const b = db.batch();
            b.set(parishRef().collection("clergy").doc(c.memberNo), next);
            parishAudit(b, `parishes/${pid}/clergy/${c.memberNo}`, n, "clergy-restore", { status: "Former", leftDate: c.leftDate || "", leaveReason: c.leaveReason || "" },
                { status: "Active", from, posting });
            await b.commit();
            // clergyIndex already points here (the rules require it), so it is not rewritten. Counts right after (in the same batch the rules' 1000-expression budget is exceeded, as in p8 postings).
            await statsRef().set({ clergyCount: inc(1), formerClergyCount: inc(-1) }, { merge: true });
            closeModal("p9Modal");
            await loadParishData();
            await openRecord("clergy", c.memberNo);
        } catch (e) {
            $("rs_status").textContent = "Not restored: " + (e.code === "permission-denied"
                ? "the rules refused it (a woman, called to glory, posted out, or the email now belongs to another record or an app admin)." : e.message);
        }
    });
}

// Edit form: a new rank closes the open service-record line and starts a new one (shown on the timeline).
function rankChangeRecord(o, rank) {
    const day = localToday(), rec = (o.serviceRecord || []).map(r => r.to ? r : { ...r, to: day });
    rec.push({ rank, from: day });
    return rec.slice(-40);
}

// ================================================================= 2. TIMELINE + CLERGY HISTORY
function clergyEvents(c) {
    const ev = [], add = (date, kind, text) => ev.push({ date: date || "", kind, text });
    const periods = c.servicePeriods || [];
    const first = (periods[0] && periods[0].from) || c.joinedDate || "";
    if (c.formerMemberNo) add(first, "ordination", `Ordained as clergy (was member ${c.formerMemberNo})`);
    else if (!c.postedFrom) add(first, "joined", "Joined the parish clergy");
    let lastRank = "";
    for (const r of c.serviceRecord || []) {
        if (/^Posted (to|from) /.test(r.rank)) add(r.from, "posting", r.rank);
        else if (/^Restored to service/.test(r.rank)) add(r.from, "return", r.rank);
        else { if (r.rank !== lastRank) add(r.from, "rank", `Rank: ${r.rank}`); lastRank = r.rank; }
    }
    periods.forEach(p => { if (p.reason !== "Posting") add(p.to, "left", leftText(p.reason, p.transferredTo)); });
    if (c.status === "Former" && c.leaveReason !== "Posting") add(c.leftDate, "left", leftText(c.leaveReason, c.transferredTo));
    const ORDER = { ordination: 0, joined: 0, rank: 1, posting: 2, left: 3, return: 4 }; // same day: leave before return
    return ev.map((e, i) => ({ ...e, i })).sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.kind] - ORDER[b.kind] || a.i - b.i);
}
const EV_STYLE = { ordination: "border-amber-500", joined: "border-amber-500", rank: "border-blue-400", posting: "border-indigo-500", left: "border-rose-400", return: "border-emerald-500" };
function clergyTimelineHtml(c) {
    const ev = clergyEvents(c);
    return `<div class="clergy-timeline bg-white border rounded p-2 space-y-1"><p class="font-bold"><i class="fa-solid fa-timeline"></i> Timeline</p>
        ${ev.map(e => `<div class="tl-ev border-l-4 ${EV_STYLE[e.kind]} pl-2" data-kind="${e.kind}"><span class="font-mono text-gray-500">${esc(e.date || "?")}</span> ${esc(e.text)}</div>`).join("")
        || `<p class="text-gray-400 italic">Nothing recorded yet.</p>`}</div>`;
}
function servicePeriodsHtml(c) {
    const ps = c.servicePeriods || [];
    if (!ps.length) return "";
    return `<p class="font-bold mt-1">Earlier service periods</p><ul class="list-disc pl-5">${ps.map(p => `<li class="sp-row">${esc(p.from || "?")} → ${esc(p.to)}: ${esc(leftText(p.reason, p.transferredTo))}
        ${p.letterId ? ` · <button onclick="showLetter('${esc(p.letterId)}')" class="underline text-amber-800">letter</button>` : ""}</li>`).join("")}</ul>
        ${c.letterId ? "" : `<div id="letterView" class="hidden space-y-2 mt-2"></div>`}
        <p>Back in service from <b>${esc(c.restoredDate || "")}</b></p>`;
}
const tlRows = c => clergyEvents(c).map(e => `<tr><td>${esc(e.date || "?")}</td><td>${esc(e.text)}</td></tr>`).join("");
function printClergyTimeline() {
    const c = current.rec;
    showPrintSheet(`${sheetHead("Clergy Timeline")}
        <div class="ps-top"><div class="ps-photo">${c.photo ? `<img src="${esc(c.photo)}" alt="Photo">` : "Photo"}</div><div class="ps-grow">
        <p class="ps-name">${esc(c.fullName)}</p><p class="ps-no">${esc(displayNo(c))}</p><p class="ps-rank">${esc(rankText(c))}</p></div></div>
        <table class="ps-table"><tr><th>Date</th><th>Event</th></tr>${tlRows(c)}</table>
        <p class="ps-help">Printed ${esc(localToday())}. Private: keep safe.</p>`);
}

let chList = [];
const lastStart = c => c.restoredDate || c.joinedDate || "";
const servedText = c => [...(c.servicePeriods || []).map(p => `${p.from || "?"} → ${p.to}`), `${lastStart(c) || "?"} → ${c.status === "Active" ? "present" : c.leftDate || "?"}`].join(", ");
async function openClergyHistory() {
    const s = await parishRef().collection("clergy").get();
    chList = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => lastStart(b).localeCompare(lastStart(a)) || b.memberNo.localeCompare(a.memberNo));
    renderClergyHistory();
}
function chFiltered() {
    const q = ($("ch_search").value || "").trim().toLowerCase();
    return chList.filter(c => !q || (c.fullName || "").toLowerCase().includes(q) || c.memberNo.toLowerCase().includes(q));
}
function renderClergyHistory() {
    const list = chFiltered();
    $("ch_count").textContent = `${list.length} of ${chList.length} · ${chList.filter(c => c.status === "Active").length} serving now`;
    $("clergyHistoryList").innerHTML = list.map(c => `<button onclick="openRecord('clergy','${esc(c.memberNo)}')" class="ch-row w-full text-left bg-white border-l-4 ${c.status === "Active" ? "border-emerald-500" : "border-gray-400"} border rounded p-2 text-xs">
        <p><b>${esc(c.fullName)}</b> <span class="font-mono text-gray-500">${esc(displayNo(c))}</span></p>
        <p class="text-gray-600">${esc(rankText(c) || "")}${c.status === "Former" ? " · " + esc(leftText(c.leaveReason, c.transferredTo)) : " · Serving"}${c.restoreCount ? ` · returned ${c.restoreCount}×` : ""}</p>
        <p class="text-gray-500">Served: ${esc(servedText(c))}</p></button>`).join("") || `<p class="text-xs text-gray-400 italic">No clergy found.</p>`;
}
function printClergyHistory() {
    const list = chFiltered();
    showPrintSheet(`${sheetHead("Clergy History")}
        <p class="ps-help">Everyone who has served in this parish, newest first. ${list.length} clergy.</p>
        <table class="ps-table"><tr><th>Name</th><th>Number</th><th>Rank</th><th>Served</th><th>Status</th></tr>
        ${list.map(c => `<tr><td>${esc(c.fullName)}</td><td>${esc(c.memberNo)}</td><td>${esc(c.rank || "")}</td><td>${esc(servedText(c))}</td>
            <td>${c.status === "Active" ? "Serving" : esc(leftText(c.leaveReason, c.transferredTo))}</td></tr>`).join("")}</table>
        <p class="ps-help">Printed ${esc(localToday())}.</p>`);
}

// ================================================================= 3. TRANSFER LETTER (photo or PDF, Firestore chunks)
function transferReasonChanged() { $("t_letterBox").classList.toggle("hidden", $("t_reason").value !== "Transfer"); }
// Adds the letter doc + its chunks to the batch (rules accept chunks only in the letter's own create batch). Returns the id.
async function addLetterToBatch(b, file, clergyId) {
    const { pages, mime } = await archiveDemoPages(file);
    const size = pages.reduce((n, p) => n + p.length, 0);
    if (size > AR_DEMO_MAX) throw new Error("The letter is still over 5 MB after shrinking. Use fewer pages.");
    const chunks = archiveChunks(pages), ref = parishRef().collection("letters").doc();
    b.set(ref, { clergyId, storage: "firestore", mime, fileName: file.name.slice(0, 120), size, pages: pages.length, chunks: chunks.length,
        createdAt: nowIso(), createdBy: localState.user.uid });
    chunks.forEach((c, i) => b.set(ref.collection("chunks").doc(String(i)), c));
    return ref.id;
}
async function letterPageUrls(id) {
    const s = await parishRef().collection("letters").doc(id).collection("chunks").get();
    const parts = s.docs.map(d => ({ n: +d.id, ...d.data() })).sort((a, b) => a.n - b.n), pages = [];
    for (const c of parts) (pages[c.page] ||= []).push(c.data.toUint8Array());
    return pages.filter(Boolean).map(p => URL.createObjectURL(new Blob(p, { type: "image/jpeg" })));
}
function openLetterUpload() {
    closeModal("recordModal");
    p9Modal("Transfer letter", `<div class="space-y-2 text-xs"><p>${esc(current.rec.fullName)} · <span class="font-mono">${esc(current.rec.memberNo)}</span></p>
        <label class="block font-semibold">Photo or PDF of the letter (up to 10 pages)</label>
        <input id="lu_file" type="file" accept="image/*,.heic,.pdf,application/pdf" class="w-full border p-2 rounded bg-gray-50">
        <p id="lu_status" class="text-gray-600"></p></div>`,
        `<button id="lu_saveBtn" onclick="saveLetterUpload()" class="px-4 py-2 bg-amber-700 text-white rounded font-bold">Save letter</button>`);
}
async function saveLetterUpload() {
    const c = current.rec, file = $("lu_file").files[0];
    if (!file) return alert("Choose the photo or PDF first.");
    await busy("lu_saveBtn", async () => {
        try {
            $("lu_status").textContent = "Making the pictures smaller...";
            const b = db.batch(), letterId = await addLetterToBatch(b, file, c.memberNo);
            b.update(parishRef().collection("clergy").doc(c.memberNo), { letterId, updatedAt: nowIso() });
            $("lu_status").textContent = "Saving...";
            await b.commit();
            closeModal("p9Modal");
            await openRecord("clergy", c.memberNo);
        } catch (e) { $("lu_status").textContent = "Not saved: " + e.message; }
    });
}

// ================================================================= 4. ATTENDANCE REPORT FILES
const rpName = ext => `attendance-${att.reports.period === "week" ? "weekly" : "monthly"}-${localToday()}.${ext}`;
async function exportXlsx() {
    const r = att.reports;
    if (!r || !r.view) return alert("Open the report first.");
    await busy("rp_xlsxBtn", async () => {
        try {
            await loadLib(LIBS.xlsx);
            const v = r.view, wb = XLSX.utils.book_new(), sheet = rows => XLSX.utils.aoa_to_sheet(rows);
            const head = [[$("rpTitle").textContent], [$("rpSub").textContent], []];
            XLSX.utils.book_append_sheet(wb, sheet([...head, [r.period === "week" ? "Week of" : "Month", "Services", "Total", "Average"],
                ...v.bs.map(b => [b.label, b.services, b.total, b.services ? Math.round(b.total / b.services) : 0])]), "Summary");
            XLSX.utils.book_append_sheet(wb, sheet([["Service", "Held", "Men", "Women", "Children", "Visitors", "Average"],
                ...Object.entries(v.byType).map(([k, t]) => [TYPE_NAMES[k], t.s, t.m, t.w, t.c, t.v, Math.round(t.total / t.s)])]), "Per service type");
            XLSX.utils.book_append_sheet(wb, sheet([["Date", "Service", "Type", "Men", "Women", "Children", "Visitors", "Total", "Led by", "Notes"],
                ...[...v.recs].sort((a, b) => a.serviceDate.localeCompare(b.serviceDate)).map(a => [a.serviceDate, a.serviceType, TYPE_NAMES[keyOf(a)],
                    a.men ?? "", a.women ?? "", a.children ?? "", a.visitors ?? "", a.headcount, a.ledByName || "", a.notes || ""])]), "Services");
            XLSX.utils.book_append_sheet(wb, sheet([["Department", "Sessions", "Average present"],
                ...Object.entries(v.byDept).map(([k, t]) => [deptName(k), t.s, Math.round(t.p / t.s)])]), "Departments");
            XLSX.writeFile(wb, rpName("xlsx"));
        } catch (e) { alert("Could not make the Excel file: " + e.message); }
    });
}
// PDF: a clean A4 sheet with only the report; Print -> "Save as PDF" (Android Chrome: Share/Print -> Save as PDF).
function exportPdf() {
    if (!att.reports || !att.reports.view) return alert("Open the report first.");
    showPrintSheet(`${sheetHead("Attendance Report")}<div class="rp-pdf"><p class="ps-rank">${esc($("rpTitle").textContent)}</p><p class="ps-help">${esc($("rpSub").textContent)}</p>
        ${$("rpChart").innerHTML}${$("rpTable").innerHTML.replace(/<table[^>]*>/, '<table class="ps-table">')}
        <h2>Per service type</h2>${$("rpTypes").innerHTML.replace(/<table[^>]*>/, '<table class="ps-table">')}
        <h2>Per department</h2>${$("rpDepts").innerHTML.replace(/<table[^>]*>/, '<table class="ps-table">')}</div>
        <p class="ps-help no-print">Tap Print, then choose "Save as PDF" to keep the file.</p>`);
    const old = document.title;
    document.title = rpName("pdf").replace(/\.pdf$/, "");   // the suggested PDF file name
    window.addEventListener("afterprint", () => { document.title = old; }, { once: true });
    setTimeout(() => window.print(), 300);
}
