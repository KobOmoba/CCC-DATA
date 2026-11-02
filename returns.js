// CCC Parish Portal - Phase 6: Monthly Returns (HQ financial visibility).
// Parish: income per category per month (+ currency), payments to HQ, receipts.
// Super Admin: expected vs remitted vs confirmed, arrears, rollups by city/country/continent, alerts, action log.
// Privacy: only parish-level money totals live here. Individual giving stays in parishes/{p}/finances.
// Every write bumps `version` and adds auditLog/{collection}_{docId}_v{version} in the same batch (rules enforce it).

const CATS = [["tithes", "Tithes"], ["offerings", "Offerings"], ["thanksgiving", "Thanksgiving"], ["harvest", "Harvest"], ["building", "Building fund"], ["other", "Other"]];
const DEFAULT_SHARES = { tithes: { num: 1, den: 3 }, offerings: { num: 0, den: 1 }, thanksgiving: { num: 0, den: 1 }, harvest: { num: 0, den: 1 }, building: { num: 0, den: 1 }, other: { num: 0, den: 1 } };
const METHODS = ["Bank transfer", "Cash", "POS"];
const LEVELS = [["continent", "Continent"], ["country", "Country"], ["city", "City"]];
const ALERT_NAMES = AlertsCore.RULE_NAMES;
const STATUS_COLOR = { Due: "bg-gray-200", "Part paid": "bg-amber-200", Paid: "bg-blue-200", Confirmed: "bg-emerald-200", Disputed: "bg-rose-200" };
const RET_PAGE = 20;

const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
const money = (cur, x) => `${cur || ""} ${r2(x).toLocaleString(undefined, { maximumFractionDigits: 2 })}`.trim();
const slug = v => String(v || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
const addMonths = (m, n) => { const [y, mo] = m.split("-").map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const lastMonth = () => addMonths(localToday().slice(0, 7), -1);
const monthName = m => { const [y, mo] = m.split("-").map(Number); return `${MONTHS[mo - 1]} ${y}`; };
const totalIncome = inc => r2(CATS.reduce((t, [k]) => t + (inc[k] || 0), 0));
const dueOf = (inc, sh) => r2(CATS.reduce((t, [k]) => t + (inc[k] || 0) * sh[k].num / sh[k].den, 0));
const statusOf = d => d.disputed ? "Disputed"
    : (d.confirmations > 0 && d.confirmed + 0.006 >= d.due && d.remitted + 0.006 >= d.due) ? "Confirmed"
    : d.remitted + 0.006 >= d.due ? "Paid" : d.remitted > 0 ? "Part paid" : "Due";
const badge = st => `<span class="ret-status px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_COLOR[st] || "bg-gray-200"}">${esc(st)}</span>`;
const fracText = s => s.num === 0 ? "none" : `${s.num}/${s.den}`;
const srv = () => firebase.firestore.FieldValue.serverTimestamp();
const auditRef = (target, v) => db.collection("auditLog").doc(target.replace("/", "_") + "_v" + v);
const pick = (d, keys) => d ? Object.fromEntries(keys.filter(k => k in d).map(k => [k, d[k]])) : null;
const SNAP = ["income", "due", "remitted", "confirmed", "status", "disputed", "disputeReason", "currency"];

// One audit entry, written in the same batch/transaction as the change.
function writeAudit(w, target, version, action, before, after, reason = "") {
    w.set(auditRef(target, version), {
        action, target, targetVersion: version, parishId: target.startsWith("returns/") ? target.split("/")[1].split("_")[0] : "",
        reason: String(reason).slice(0, 300), before: before || null, after: after || null,
        by: localState.user.uid, byEmail: (localState.user.email || "").toLowerCase(), byName: localState.name || "",
        role: localState.role, at: srv()
    });
}

let hqShares = DEFAULT_SHARES, hqSettingsVersion = 0;
async function loadShares() {
    const s = await db.collection("hqSettings").doc("returns").get();
    hqShares = s.exists ? s.data().shares : DEFAULT_SHARES;
    hqSettingsVersion = s.exists ? s.data().version : 0;
}

// Rollups: add this change's deltas to the city / country / continent docs for the month (per currency, never converted).
function rollupKeys(r) {
    return [
        { level: "city", key: slug(r.country) + "--" + slug(r.city), name: r.city || "Unknown city" },
        { level: "country", key: slug(r.country), name: r.country || "Unknown country" },
        { level: "continent", key: slug(r.continent), name: r.continent || "Unknown continent" }];
}
function rollupDelta(w, r, delta) {
    const inc = firebase.firestore.FieldValue.increment;
    const body = Object.fromEntries(Object.entries(delta).filter(([, v]) => v).map(([k, v]) => [k, inc(r2(v))]));
    if (!Object.keys(body).length) return;
    for (const k of rollupKeys(r)) {
        w.set(db.collection("returnRollups").doc(`${r.month}_${k.level}_${k.key}`), {
            month: r.month, level: k.level, key: k.key, name: k.name, country: r.country || "", continent: r.continent || "",
            cur: { [r.currency]: body }, updatedAt: nowIso()
        }, { merge: true });
    }
}

// ================================================================= PARISH SIDE
let ret = { month: "", doc: null, receipt: "", payReceipt: "", payments: [] };
const retRef = (pid, m) => db.collection("returns").doc(`${pid}_${m}`);

async function openReturns() {
    if (!$("r_month").value) $("r_month").value = lastMonth();
    await loadShares();
    const cur = localState.parish.currency;
    $("r_currencyNote").innerHTML = cur ? `Currency: <b>${esc(cur)}</b> (change it in Parish Settings; filed returns keep theirs).`
        : `<span class="text-rose-700 font-bold">Set your parish currency in Parish Settings first.</span>`;
    await loadReturn();
    await loadReturnHistory();
}

async function monthAttendance(m) {
    const s = await parishRef().collection("attendance").where("serviceDate", ">=", m + "-01").where("serviceDate", "<=", m + "-31").get();
    return { attendance: s.docs.reduce((t, d) => t + (d.data().headcount || 0), 0), services: s.size };
}

async function loadReturn() {
    const m = $("r_month").value;
    if (!m) return;
    ret = { month: m, doc: null, receipt: "", payReceipt: "", payments: [] };
    const snap = await retRef(localState.currentParishId, m).get();
    ret.doc = snap.exists ? snap.data() : null;
    const d = ret.doc;
    CATS.forEach(([k]) => $("r_" + k).value = d ? d.income[k] : "");
    $("r_note").value = d ? d.note || "" : "";
    $("r_reason").value = "";
    $("r_reasonBox").classList.toggle("hidden", !d);
    $("r_receipt").value = "";
    $("r_receiptPreview").classList.toggle("hidden", !(d && d.receipt));
    if (d && d.receipt) $("r_receiptPreview").src = d.receipt;
    const a = await monthAttendance(m);
    $("r_attendance").textContent = `${a.attendance} (${a.services} services)`;
    ret.att = a;
    $("saveReturnBtn").textContent = d ? "Save correction" : "File return";
    $("r_payBox").classList.toggle("hidden", !d);
    returnDuePreview();
    renderReturnSummary();
    if (d) {
        const p = await retRef(localState.currentParishId, m).collection("payments").orderBy("at").get();
        ret.payments = p.docs.map(x => ({ id: x.id, ...x.data() }));
        $("pay_corrects").innerHTML = ret.payments.filter(x => x.amount > 0).map(x => `<option value="${esc(x.id)}">${esc(x.date)} · ${esc(money(d.currency, x.amount))} · ${esc(x.reference)}</option>`).join("");
        $("r_payments").innerHTML = paymentsHtml(ret.payments, d.currency);
        if (!$("pay_date").value) $("pay_date").value = localToday();
    } else $("r_payments").innerHTML = "";
}

function readIncome() {
    return Object.fromEntries(CATS.map(([k]) => [k, r2(Math.max(0, parseFloat($("r_" + k).value) || 0))]));
}
function returnDuePreview() {
    const sh = ret.doc ? ret.doc.shares : hqShares;
    const inc = readIncome(), cur = ret.doc ? ret.doc.currency : localState.parish.currency;
    $("r_due").textContent = money(cur, dueOf(inc, sh));
    $("r_shareNote").textContent = "HQ share: " + CATS.filter(([k]) => sh[k].num > 0).map(([k, n]) => `${n} ${fracText(sh[k])}`).join(", ");
}
function renderReturnSummary() {
    const d = ret.doc;
    $("r_summary").innerHTML = !d ? `<p class="text-gray-500">No return filed for ${esc(monthName(ret.month))} yet.</p>` :
        `<div class="flex items-center justify-between"><p class="font-bold">${esc(monthName(d.month))}</p>${badge(d.status)}</div>
        <div class="grid grid-cols-3 gap-2 text-center mt-2">
          <div><p class="text-[10px] text-gray-500 uppercase">Due to HQ</p><p id="r_sumDue" class="font-bold">${esc(money(d.currency, d.due))}</p></div>
          <div><p class="text-[10px] text-gray-500 uppercase">Remitted</p><p id="r_sumRemitted" class="font-bold">${esc(money(d.currency, d.remitted))}</p></div>
          <div><p class="text-[10px] text-gray-500 uppercase">Confirmed</p><p class="font-bold">${esc(money(d.currency, d.confirmed))}</p></div></div>
        ${d.disputed ? `<p class="mt-2 text-rose-700">Disputed by HQ: ${esc(d.disputeReason)}</p>` : ""}
        <button onclick="openReturnDetail('${esc(localState.currentParishId)}_${esc(d.month)}')" class="mt-2 underline text-blue-700">History of changes</button>`;
}
async function pickReturnReceipt(input, which) {
    if (!input.files[0]) return;
    try {
        const img = await compressImage(input.files[0], 60000, 900);
        ret[which] = img;
        const prev = which === "receipt" ? "r_receiptPreview" : "pay_receiptPreview";
        $(prev).src = img; $(prev).classList.remove("hidden");
    } catch (e) { alert(e.message); }
}

async function saveReturn() {
    const m = $("r_month").value, pid = localState.currentParishId, p = localState.parish;
    if (!m) return alert("Pick the month.");
    if (!p.currency) return alert("Set your parish currency in Parish Settings first.");
    if (m > localToday().slice(0, 7)) return alert("You cannot file a return for a future month.");
    const income = readIncome(), reason = val("r_reason"), a = await monthAttendance(m);
    const ref = retRef(pid, m);
    await busy("saveReturnBtn", async () => {
        try {
            await db.runTransaction(async t => {
                const snap = await t.get(ref);
                const o = snap.exists ? snap.data() : null;
                if (o && !reason) throw new Error("A correction needs a reason.");
                const base = o || { parishId: pid, parishName: p.name, city: p.city || "", country: p.country || "", continent: p.continent || "",
                    month: m, currency: p.currency, shares: hqShares, remitted: 0, confirmed: 0, confirmations: 0, disputed: false,
                    disputeReason: "", version: 0, filedAt: nowIso(), filedBy: localState.user.uid };
                const d = { ...base, income, due: dueOf(income, base.shares), attendance: a.attendance, services: a.services,
                    note: val("r_note").slice(0, 300), version: base.version + 1, updatedAt: nowIso() };
                if (ret.receipt) d.receipt = ret.receipt;
                d.outstanding = r2(d.due - d.remitted);
                d.status = statusOf(d);
                t.set(ref, d);
                writeAudit(t, "returns/" + ref.id, d.version, o ? "correct" : "file", pick(o, SNAP), pick(d, SNAP), reason);
                rollupDelta(t, d, { due: d.due - (o ? o.due : 0), tithes: income.tithes - (o ? o.income.tithes : 0),
                    income: totalIncome(income) - (o ? totalIncome(o.income) : 0), returns: o ? 0 : 1 });
            });
            await loadReturn(); await loadReturnHistory();
        } catch (e) { alert("Not saved: " + e.message); }
    });
}

function togglePayCorrection() {
    const on = $("pay_isCorrection").checked;
    $("pay_correctionBox").classList.toggle("hidden", !on);
}
async function recordPayment() {
    const id = `${localState.currentParishId}_${ret.month}`, ref = db.collection("returns").doc(id);
    const corr = $("pay_isCorrection").checked;
    let amount = r2(parseFloat($("pay_amount").value));
    const date = $("pay_date").value, method = $("pay_method").value, reference = val("pay_ref"), reason = val("pay_reason");
    if (!(amount > 0)) return alert("Enter the amount paid.");
    if (!date || !METHODS.includes(method) || !reference) return alert("Enter the date, method and reference / teller number.");
    if (corr && (!reason || !$("pay_corrects").value)) return alert("A correction needs the entry it corrects and a reason.");
    if (corr) amount = -amount;
    await busy("payBtn", async () => {
        try {
            await db.runTransaction(async t => {
                const o = (await t.get(ref)).data();
                const d = { ...o, remitted: r2(o.remitted + amount), version: o.version + 1, updatedAt: nowIso() };
                d.outstanding = r2(d.due - d.remitted);
                d.status = statusOf(d);
                const pay = { returnId: id, amount, date, method, reference: reference.slice(0, 60), by: localState.user.uid,
                    byEmail: (localState.user.email || "").toLowerCase(), at: srv() };
                if (ret.payReceipt) pay.receipt = ret.payReceipt;
                if (corr) { pay.reason = reason.slice(0, 300); pay.corrects = $("pay_corrects").value; }
                t.update(ref, d);
                t.set(ref.collection("payments").doc("p" + d.version), pay);
                writeAudit(t, "returns/" + id, d.version, corr ? "correct" : "pay", pick(o, SNAP),
                    { ...pick(d, SNAP), payment: { amount, date, method, reference } }, corr ? reason : "");
                rollupDelta(t, d, { remitted: amount });
            });
            ["pay_amount", "pay_ref", "pay_reason", "pay_receipt"].forEach(x => $(x).value = "");
            $("pay_isCorrection").checked = false; togglePayCorrection();
            $("pay_receiptPreview").classList.add("hidden");
            await loadReturn(); await loadReturnHistory();
        } catch (e) { alert("Payment not saved: " + e.message); }
    });
}

function paymentsHtml(list, cur) {
    if (!list.length) return `<p class="text-gray-400 italic">No payments recorded yet.</p>`;
    return list.map(x => `<div class="pay-row border rounded p-2 flex gap-2 items-center ${x.amount < 0 ? "bg-rose-50" : ""}">
        ${x.receipt ? `<img src="${esc(x.receipt)}" alt="Receipt" class="w-10 h-10 object-cover rounded border">` : ""}
        <div class="flex-1"><p class="font-bold">${esc(money(cur, x.amount))} <span class="font-normal text-gray-500">· ${esc(x.method)} · ${esc(x.date)}</span></p>
        <p class="text-gray-500">Ref ${esc(x.reference)}${x.reason ? ` · Correction: ${esc(x.reason)}` : ""}</p></div></div>`).join("");
}

let retHist = { last: null };
async function loadReturnHistory(more) {
    let q = db.collection("returns").where("parishId", "==", localState.currentParishId).orderBy("month", "desc").limit(12);
    if (more && retHist.last) q = q.startAfter(retHist.last);
    const s = await q.get();
    retHist.last = s.docs[s.docs.length - 1] || retHist.last;
    const rows = s.docs.map(x => x.data()).map(d => `<tr class="hist-row" onclick="$('r_month').value='${esc(d.month)}';loadReturn()">
        <td class="p-2">${esc(d.month)}</td><td class="p-2">${esc(money(d.currency, d.due))}</td><td class="p-2">${esc(money(d.currency, d.remitted))}</td><td class="p-2">${badge(d.status)}</td></tr>`).join("");
    if (!more) $("r_history").innerHTML = rows || `<tr><td class="p-2 text-gray-400 italic" colspan="4">Nothing filed yet.</td></tr>`;
    else $("r_history").insertAdjacentHTML("beforeend", rows);
    $("r_histMore").classList.toggle("hidden", s.size < 12);
}

// ================================================================= DETAIL (both roles)
let detail = null;
async function openReturnDetail(id) {
    const ref = db.collection("returns").doc(id);
    const [r, p, c, a] = await Promise.all([ref.get(), ref.collection("payments").orderBy("at").get(), ref.collection("confirmations").orderBy("at").get(),
        db.collection("auditLog").where("parishId", "==", id.split("_")[0]).where("target", "==", "returns/" + id).get()]);
    if (!r.exists) return alert("No return for that month.");
    const d = r.data();
    detail = { id, d };
    const isSuper = localState.role === "super_admin";
    const audits = a.docs.map(x => x.data()).sort((x, y) => x.targetVersion - y.targetVersion);
    $("rd_title").textContent = `${d.parishName} · ${monthName(d.month)}`;
    $("rd_body").innerHTML = `
      <div class="flex items-center justify-between"><p>${esc([d.city, d.country, d.continent].filter(Boolean).join(", "))}</p>${badge(d.status)}</div>
      <table class="w-full mt-2"><tbody class="divide-y">
        ${CATS.map(([k, n]) => `<tr><td class="py-1 text-gray-500">${n}</td><td class="py-1 text-right">${esc(money(d.currency, d.income[k]))}</td></tr>`).join("")}
        <tr><td class="py-1 font-bold">Total income</td><td class="py-1 text-right font-bold">${esc(money(d.currency, totalIncome(d.income)))}</td></tr>
        <tr><td class="py-1 font-bold">Expected (HQ share)</td><td id="rd_due" class="py-1 text-right font-bold">${esc(money(d.currency, d.due))}</td></tr>
        <tr><td class="py-1">Remitted</td><td id="rd_remitted" class="py-1 text-right">${esc(money(d.currency, d.remitted))}</td></tr>
        <tr><td class="py-1">Confirmed by HQ</td><td id="rd_confirmed" class="py-1 text-right">${esc(money(d.currency, d.confirmed))}</td></tr>
        <tr><td class="py-1">Arrears</td><td class="py-1 text-right ${d.outstanding > 0 ? "text-rose-700 font-bold" : ""}">${esc(money(d.currency, Math.max(0, d.outstanding)))}</td></tr>
        <tr><td class="py-1 text-gray-500">Attendance (month)</td><td class="py-1 text-right">${d.attendance} · ${d.services} services</td></tr>
      </tbody></table>
      ${d.receipt ? `<img src="${esc(d.receipt)}" alt="Return receipt" class="mt-2 max-h-40 rounded border">` : ""}
      ${d.disputed ? `<p class="mt-2 text-rose-700 font-bold">Disputed: ${esc(d.disputeReason)}</p>` : ""}
      <p class="font-bold mt-3">Payments</p><div class="space-y-1">${paymentsHtml(p.docs.map(x => x.data()), d.currency)}</div>
      <p class="font-bold mt-3">HQ confirmations</p>
      ${c.empty ? `<p class="text-gray-400 italic">None yet.</p>` : c.docs.map(x => x.data()).map(x => `<p>${esc(money(d.currency, x.amount))} by ${esc(x.byName)}${x.note ? " · " + esc(x.note) : ""}</p>`).join("")}
      <p class="font-bold mt-3">Change history (audit)</p>
      <div id="rd_audit" class="space-y-1">${audits.map(auditLine).join("") || `<p class="text-gray-400 italic">None.</p>`}</div>`;
    $("rd_superActions").classList.toggle("hidden", !isSuper);
    if (isSuper) {
        $("rd_confirmAmt").value = r2(Math.max(0, d.remitted - d.confirmed)) || "";
        $("rd_note").value = "";
        $("rd_disputeBtn").textContent = d.disputed ? "Clear dispute" : "Mark disputed";
    }
    openModal("returnModal");
}
function auditLine(x) {
    const when = x.at && x.at.toDate ? x.at.toDate().toISOString().replace("T", " ").slice(0, 16) : "";
    const after = x.after || {}, before = x.before || {};
    const changes = ["due", "remitted", "confirmed", "status"].filter(k => before && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
        .map(k => `${k}: ${before[k] ?? "—"} → ${after[k] ?? "—"}`).join("; ");
    return `<div class="audit-row border-l-4 border-indigo-300 pl-2"><p><b>${esc(x.action)}</b> v${x.targetVersion} · ${esc(x.byName || x.byEmail)} (${esc(x.role)}) · ${esc(when)}</p>
        <p class="text-gray-500">${esc(changes)}${x.reason ? ` · Reason: ${esc(x.reason)}` : ""}</p></div>`;
}

// ================================================================= SUPER ADMIN
let hq = { month: "", tab: "overview", cursors: {} };
function needName() {
    if (localState.name && localState.name.length >= 3) return false;
    alert("Add your full name first (named accounts only).");
    return true;
}
async function saveMyName() {
    const name = val("hq_myName");
    if (name.length < 3) return alert("Enter your full name.");
    try {
        await db.collection("users").doc(localState.user.uid).update({ name });
        localState.name = name;
        await openHq();
    } catch (e) { alert("Not saved: " + e.message); }
}
async function openHq() {
    if (!$("hq_month").value) $("hq_month").value = lastMonth();
    hq.month = $("hq_month").value;
    $("hq_nameBox").classList.toggle("hidden", !!localState.name);
    $("hq_me").textContent = localState.name ? `Signed in as ${localState.name}` : "";
    await loadShares();
    hqTab(hq.tab);
}
function hqTab(tab) {
    hq.tab = tab;
    hq.month = $("hq_month").value;
    document.querySelectorAll(".hq-tab").forEach(b => b.classList.toggle("bg-blue-900", b.dataset.tab === tab));
    document.querySelectorAll(".hq-tab").forEach(b => b.classList.toggle("text-white", b.dataset.tab === tab));
    document.querySelectorAll(".hq-pane").forEach(p => p.classList.toggle("hidden", p.id !== "hq-" + tab));
    const run = { overview: () => loadRollups(), parishes: () => loadMonthReturns(), arrears: () => loadArrears(), alerts: () => loadAlerts(),
        log: () => loadAuditLog(), settings: () => fillShareForm() }[tab];
    run && run().catch(e => alert("Could not load: " + e.message));
}

// Paged list helper: q is a query factory; rowFn renders one doc.
async function pagedList(key, q, listId, rowFn, more, empty) {
    let query = q().limit(RET_PAGE);
    if (more && hq.cursors[key]) query = query.startAfter(hq.cursors[key]);
    const s = await query.get();
    if (s.docs.length) hq.cursors[key] = s.docs[s.docs.length - 1];
    const html = s.docs.map(d => rowFn(d)).join("");
    if (more) $(listId).insertAdjacentHTML("beforeend", html);
    else $(listId).innerHTML = html || `<p class="text-gray-400 italic p-2">${empty}</p>`;
    $(listId + "More").classList.toggle("hidden", s.size < RET_PAGE);
}

function curRows(cur) {
    return Object.entries(cur || {}).map(([c, v]) => `<tr><td class="p-1 font-mono">${esc(c)}</td><td class="p-1 text-right">${esc(money("", v.due))}</td>
        <td class="p-1 text-right">${esc(money("", v.remitted))}</td><td class="p-1 text-right">${esc(money("", v.confirmed))}</td>
        <td class="p-1 text-right ${(v.due || 0) - (v.remitted || 0) > 0.005 ? "text-rose-700 font-bold" : ""}">${esc(money("", Math.max(0, (v.due || 0) - (v.remitted || 0))))}</td><td class="p-1 text-right">${v.returns || 0}</td></tr>`).join("");
}
const CUR_HEAD = `<thead class="text-[10px] text-gray-500 uppercase"><tr><th class="p-1 text-left">Cur</th><th class="p-1 text-right">Expected</th><th class="p-1 text-right">Remitted</th><th class="p-1 text-right">Confirmed</th><th class="p-1 text-right">Arrears</th><th class="p-1 text-right">Returns</th></tr></thead>`;
function loadRollups(more) {
    const level = $("hq_level").value;
    return pagedList("rollups", () => db.collection("returnRollups").where("month", "==", hq.month).where("level", "==", level).orderBy("key"), "hq_rollups",
        d => { const r = d.data();
            return `<div class="rollup-card bg-white border rounded-xl p-2"><p class="font-bold">${esc(r.name)}${level === "city" ? ` <span class="text-gray-400 font-normal">${esc(r.country)}</span>` : ""}</p>
                <table class="w-full">${CUR_HEAD}<tbody>${curRows(r.cur)}</tbody></table></div>`; }, more, "No returns filed for this month yet.");
}
function retRow(d) {
    const r = d.data();
    return `<button onclick="openReturnDetail('${esc(d.id)}')" class="ret-row w-full text-left bg-white border rounded-xl p-2 block">
        <div class="flex justify-between items-center"><p class="font-bold">${esc(r.parishName)}</p>${badge(r.status)}</div>
        <p class="text-gray-500">${esc(monthName(r.month))} · ${esc([r.city, r.country].filter(Boolean).join(", "))}</p>
        <p>Expected <b>${esc(money(r.currency, r.due))}</b> · Remitted <b>${esc(money(r.currency, r.remitted))}</b> · Confirmed <b>${esc(money(r.currency, r.confirmed))}</b></p></button>`;
}
const loadMonthReturns = more => pagedList("month", () => db.collection("returns").where("month", "==", hq.month).orderBy("parishName"), "hq_returns", retRow, more, "No returns filed for this month.");
const loadArrears = more => pagedList("arrears", () => db.collection("returns").where("outstanding", ">", 0.005).orderBy("outstanding", "desc"), "hq_arrears",
    d => { const r = d.data(); return retRow(d).replace("</button>", `<p class="text-rose-700 font-bold">Arrears ${esc(money(r.currency, r.outstanding))}</p></button>`); }, more, "No arrears.");
const loadAlerts = more => pagedList("alerts", () => db.collection("alerts").where("month", "==", hq.month).orderBy(firebase.firestore.FieldPath.documentId()), "hq_alerts",
    d => { const a = d.data();
        return `<button onclick="openParishHistory('${esc(a.parishId)}')" class="alert-row w-full text-left bg-white border-l-4 ${a.status === "Open" ? "border-rose-500" : "border-gray-300"} rounded-xl p-2 block">
            <p class="font-bold">${esc(a.parishName)} <span class="text-[10px] font-normal text-gray-500">${esc(a.status)}</span></p>
            <p class="text-rose-800">${esc(ALERT_NAMES[a.rule] || a.rule)}</p><p class="text-gray-500">${esc(a.detail)}</p></button>`; }, more, "No alerts for this month. Tap Run checks.");
const loadAuditLog = more => pagedList("log", () => db.collection("auditLog").orderBy("at", "desc"), "hq_log", d => auditLine(d.data()).replace("<p><b>", `<p class="text-gray-400">${esc(d.data().target)}</p><p><b>`), more, "No actions yet.");

// Alert drill-down: that parish's totals month by month.
async function openParishHistory(parishId) {
    const s = await db.collection("returns").where("parishId", "==", parishId).orderBy("month", "desc").limit(12).get();
    const name = (localState.parishNames || {})[parishId] || parishId;
    $("ph_title").textContent = name;
    $("ph_body").innerHTML = s.empty ? `<p class="text-gray-400 italic">No returns filed.</p>` :
        `<table class="w-full"><thead class="text-[10px] text-gray-500 uppercase"><tr><th class="p-1 text-left">Month</th><th class="p-1 text-right">Tithes</th><th class="p-1 text-right">Expected</th><th class="p-1 text-right">Remitted</th><th class="p-1 text-right">Confirmed</th><th class="p-1">Status</th></tr></thead><tbody class="divide-y">` +
        s.docs.map(x => { const r = x.data();
            return `<tr class="ph-row" onclick="closeModal('historyModal');openReturnDetail('${esc(x.id)}')"><td class="p-1">${esc(r.month)}</td><td class="p-1 text-right">${esc(money("", r.income.tithes))}</td><td class="p-1 text-right">${esc(money("", r.due))}</td><td class="p-1 text-right">${esc(money("", r.remitted))}</td><td class="p-1 text-right">${esc(money("", r.confirmed))}</td><td class="p-1">${badge(r.status)}</td></tr>`; }).join("") +
        `</tbody></table><p class="text-gray-500 mt-1">Amounts in ${esc(s.docs[0].data().currency)}.</p>`;
    openModal("historyModal");
}

async function confirmReceipt() {
    if (needName()) return;
    const amount = r2(parseFloat($("rd_confirmAmt").value)), note = val("rd_note");
    if (!amount) return alert("Enter the amount received.");
    if (amount < 0 && !note) return alert("A negative confirmation (correction) needs a note.");
    const ref = db.collection("returns").doc(detail.id);
    await busy("rd_confirmBtn", async () => {
        try {
            await db.runTransaction(async t => {
                const o = (await t.get(ref)).data();
                const d = { ...o, confirmed: r2(o.confirmed + amount), confirmations: o.confirmations + 1, version: o.version + 1, updatedAt: nowIso() };
                d.status = statusOf(d);
                t.update(ref, d);
                t.set(ref.collection("confirmations").doc("c" + d.version), { returnId: detail.id, amount, note: note.slice(0, 300),
                    by: localState.user.uid, byName: localState.name, at: srv() });
                writeAudit(t, "returns/" + detail.id, d.version, "confirm", pick(o, SNAP), pick(d, SNAP), note);
                rollupDelta(t, d, { confirmed: amount });
            });
            await openReturnDetail(detail.id);
            if (hq.tab) hqTab(hq.tab);
        } catch (e) { alert("Not confirmed: " + e.message); }
    });
}
async function toggleDispute() {
    if (needName()) return;
    const ref = db.collection("returns").doc(detail.id);
    const reason = val("rd_note");
    if (!reason) return alert(detail.d.disputed ? "Say why the dispute is cleared." : "Say what is disputed.");
    await busy("rd_disputeBtn", async () => {
        try {
            await db.runTransaction(async t => {
                const o = (await t.get(ref)).data();
                const d = { ...o, disputed: !o.disputed, disputeReason: o.disputed ? "" : reason.slice(0, 300), version: o.version + 1, updatedAt: nowIso() };
                d.status = statusOf(d);
                t.update(ref, d);
                writeAudit(t, "returns/" + detail.id, d.version, d.disputed ? "dispute" : "undispute", pick(o, SNAP), pick(d, SNAP), reason);
            });
            await openReturnDetail(detail.id);
            if (hq.tab) hqTab(hq.tab);
        } catch (e) { alert("Not saved: " + e.message); }
    });
}

// ---- HQ share settings ----
function fillShareForm() {
    $("hq_shares").innerHTML = CATS.map(([k, n]) => `<label class="flex items-center gap-2"><span class="w-28">${n}</span>
        <input id="sh_${k}_num" type="number" min="0" class="w-16 border p-2 rounded" value="${hqShares[k].num}"> /
        <input id="sh_${k}_den" type="number" min="1" class="w-16 border p-2 rounded" value="${hqShares[k].den}"></label>`).join("");
    return Promise.resolve();
}
async function saveShares() {
    if (needName()) return;
    const shares = Object.fromEntries(CATS.map(([k]) => [k, { num: parseInt($(`sh_${k}_num`).value, 10) || 0, den: Math.max(1, parseInt($(`sh_${k}_den`).value, 10) || 1) }]));
    if (CATS.some(([k]) => shares[k].num > shares[k].den)) return alert("A share cannot be more than 1 (e.g. 1/3).");
    const reason = val("hq_shareReason");
    if (!reason) return alert("Say why the share is changing.");
    const ref = db.collection("hqSettings").doc("returns");
    await busy("saveSharesBtn", async () => {
        try {
            await db.runTransaction(async t => {
                const o = await t.get(ref);
                const v = o.exists ? o.data().version + 1 : 1;
                t.set(ref, { shares, version: v, updatedAt: nowIso(), updatedBy: localState.user.uid });
                writeAudit(t, "hqSettings/returns", v, "settings", o.exists ? { shares: o.data().shares } : { shares: DEFAULT_SHARES }, { shares }, reason);
            });
            $("hq_shareReason").value = "";
            await loadShares();
            alert("Saved. New returns use the new share; returns already filed keep theirs.");
        } catch (e) { alert("Not saved: " + e.message); }
    });
}

// ---- Rebuild one month's rollups from the returns themselves (fixes any drift) ----
async function readAll(q) {
    const out = [];
    let last = null;
    for (;;) {
        let qq = q.limit(500);
        if (last) qq = qq.startAfter(last);
        const s = await qq.get();
        out.push(...s.docs);
        if (s.size < 500) return out;
        last = s.docs[s.docs.length - 1];
    }
}
async function commitChunks(writes) {
    for (let i = 0; i < writes.length; i += 400) {
        const b = db.batch();
        writes.slice(i, i + 400).forEach(fn => fn(b));
        await b.commit();
    }
}
async function rebuildRollups() {
    if (needName()) return;
    const m = hq.month;
    await busy("rebuildBtn", async () => {
        try {
            const docs = await readAll(db.collection("returns").where("month", "==", m).orderBy(firebase.firestore.FieldPath.documentId()));
            const agg = {};
            for (const x of docs) {
                const r = x.data();
                for (const k of rollupKeys(r)) {
                    const id = `${m}_${k.level}_${k.key}`;
                    const a = agg[id] ||= { month: m, level: k.level, key: k.key, name: k.name, country: r.country || "", continent: r.continent || "", cur: {}, updatedAt: nowIso() };
                    const c = a.cur[r.currency] ||= { due: 0, remitted: 0, confirmed: 0, tithes: 0, income: 0, returns: 0 };
                    c.due = r2(c.due + r.due); c.remitted = r2(c.remitted + r.remitted); c.confirmed = r2(c.confirmed + r.confirmed);
                    c.tithes = r2(c.tithes + r.income.tithes); c.income = r2(c.income + totalIncome(r.income)); c.returns += 1;
                }
            }
            const writes = Object.entries(agg).map(([id, a]) => b => b.set(db.collection("returnRollups").doc(id), a));
            await commitChunks(writes);
            const runRef = db.collection("rollupRuns").doc(m);
            await db.runTransaction(async t => {
                const o = await t.get(runRef);
                const v = o.exists ? o.data().version + 1 : 1;
                t.set(runRef, { version: v, returns: docs.length, at: nowIso(), by: localState.user.uid });
                writeAudit(t, "rollupRuns/" + m, v, "rebuild", null, { returns: docs.length, rollups: writes.length });
            });
            await loadRollups();
            alert(`Rebuilt ${writes.length} totals from ${docs.length} returns.`);
        } catch (e) { alert("Rebuild failed: " + e.message); }
    });
}

// ---- Rule-based alerts: the checks live in alerts-core.js (shared with the scheduled server job, Phase 8). ----
const computeAlerts = (m, parishes, returnsByParish, today) => AlertsCore.returnAlerts(m, parishes, returnsByParish, today);
async function runAlertChecks() {
    if (needName()) return;
    const m = hq.month;
    await busy("runChecksBtn", async () => {
        try {
            if (!localState.parishList) await loadWorld();
            const docs = await readAll(db.collection("returns").where("month", ">=", addMonths(m, -6)).where("month", "<=", m).orderBy("month"));
            const byParish = {};
            docs.forEach(x => { const r = x.data(); (byParish[r.parishId] ||= {})[r.month] = r; });
            const found = computeAlerts(m, localState.parishList, byParish, localToday());
            const existing = new Set((await readAll(db.collection("alerts").where("month", "==", m).orderBy(firebase.firestore.FieldPath.documentId()))).map(x => x.id));
            const fresh = found.filter(a => !existing.has(`${m}_${a.parishId}_${a.rule}`));
            await commitChunks(fresh.map(a => b => {
                const id = `${m}_${a.parishId}_${a.rule}`;
                const doc = { month: m, ...a, detail: a.detail.slice(0, 300), status: "Open", version: 1, at: nowIso(), by: localState.user.uid };
                b.set(db.collection("alerts").doc(id), doc);
                writeAudit(b, "alerts/" + id, 1, "alert", null, { rule: a.rule, parishId: a.parishId });
            }));
            await loadAlerts();
            alert(`${found.length} alert(s) for ${monthName(m)}; ${fresh.length} new.`);
        } catch (e) { alert("Checks failed: " + e.message); }
    });
}
