// CCC Parish Portal - Phase 9:
//  1. Sermon Library (per parish; optional "share church-wide"). Audio/video is a LINK (Firebase Storage is not
//     enabled); the transcript text is stored directly. Search by title, preacher, tag or date.
//  2. Event calendar: the weekly CCC timetable (weekServices) + special services + events with volunteer slots.
//     Month and list views. Dashboard card "This week": services, events, birthdays and wedding anniversaries.
//  3. Messages: personalised WhatsApp (one tap each, with a "next" queue) + email (mailto, BCC batches).
//     The log keeps who / when / template only. sendWhatsApp(to, text) is the adapter for the future Cloud API.
//  4. Phase 9b: member sign-up link (/join) + pending queue, editable timetable,
//     WhatsApp "send to many".

// ================================================================= shared helpers
const P9_KINDS = { meeting: "Meeting", harvest: "Harvest", anniversary: "Anniversary", crusade: "Crusade", other: "Other event" };
const monthOf = s => s.slice(0, 7);
function p9Modal(title, body, actions = "") {
    $("p9Title").textContent = title;
    $("p9Body").innerHTML = body;
    $("p9Actions").innerHTML = actions + `<button onclick="closeModal('p9Modal')" class="px-3 py-2 border rounded">Close</button>`;
    openModal("p9Modal");
}
const newId = () => db.collection("x").doc().id;
// Members of this parish by name prefix (for pickers).
async function findMembers(q, n = 8) {
    q = q.trim().toLowerCase();
    if (q.length < 2) return [];
    const s = await parishRef().collection("members").orderBy("nameLower").startAt(q).endAt(q + "").limit(n).get();
    return s.docs.map(d => d.data()).filter(m => m.status === "Active");
}

// ================================================================= 1. SERMON LIBRARY
let sermonState = { tab: "mine", list: [], editing: null };
async function openSermons() {
    const isParish = localState.role === "parish_admin";
    document.querySelectorAll(".sm-parish").forEach(el => el.classList.toggle("hidden", !isParish));
    if (!isParish) sermonState.tab = "shared";
    await loadSermons();
}
function sermonTab(t) { sermonState.tab = t; loadSermons().catch(e => alert("Could not load sermons: " + e.message)); }
async function loadSermons() {
    document.querySelectorAll(".sm-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === sermonState.tab));
    // Newest 200: enough for a parish archive; the shared list is church-wide, so it is paged by date.
    const col = sermonState.tab === "mine" ? parishRef().collection("sermons") : db.collection("sharedSermons");
    const s = await col.orderBy("date", "desc").limit(200).get();
    sermonState.list = s.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSermons();
}
function sermonMatches(x, q) {
    if (!q) return true;
    q = q.toLowerCase();
    return x.titleLower.includes(q) || (x.preacher || "").toLowerCase().includes(q) || (x.preacherNo || "").toLowerCase().includes(q)
        || (x.tags || []).some(t => t.includes(q.replace(/^#/, ""))) || x.date.includes(q) || (x.scripture || "").toLowerCase().includes(q);
}
function renderSermons() {
    const q = val("sm_q");
    const rows = sermonState.list.filter(x => sermonMatches(x, q));
    $("sm_list").innerHTML = rows.length ? rows.map(x => `<button onclick="viewSermon('${x.id}')" class="sm-row w-full text-left bg-white border rounded-xl p-3 shadow-sm">
        <p class="font-bold text-sm">${esc(x.title)}${x.shared && sermonState.tab === "mine" ? ` <span class="text-[10px] bg-emerald-100 text-emerald-800 rounded px-1">church-wide</span>` : ""}</p>
        <p class="text-gray-600">${esc(x.preacher)} · ${esc(fmtDay(x.date))} ${x.date.slice(0, 4)}${x.serviceType ? " · " + esc(x.serviceType) : ""}${sermonState.tab === "shared" ? " · " + esc(x.parishName) : ""}</p>
        <p class="text-gray-500">${x.scripture ? esc(x.scripture) + " · " : ""}${(x.tags || []).map(t => "#" + esc(t)).join(" ")}${x.mediaUrl ? ' · <i class="fa-solid fa-play"></i> media' : ""}</p></button>`).join("")
        : `<p class="text-gray-500 text-center p-4">No sermons${q ? " match \"" + esc(q) + "\"" : " yet"}.</p>`;
}
function openSermonForm(id) {
    const x = id ? sermonState.list.find(s => s.id === id) : {};
    sermonState.editing = id || null;
    const set = (k, v) => $(k).value = v ?? "";
    set("sm_title", x.title); set("sm_preacher", x.preacherNo || x.preacher); set("sm_date", x.date || localToday());
    set("sm_service", x.serviceType || "Sunday Service"); set("sm_scripture", x.scripture); set("sm_tags", (x.tags || []).join(", "));
    set("sm_media", x.mediaUrl); set("sm_text", x.text);
    $("sm_shared").checked = !!x.shared;
    closeModal("p9Modal");
    openModal("sermonModal");
}
const mediaKind = u => /youtu/.test(u) ? "YouTube" : /drive\.google/.test(u) ? "Google Drive" : /facebook|fb\.watch/.test(u) ? "Facebook" : /soundcloud/.test(u) ? "SoundCloud" : "Link";
async function saveSermon() {
    const title = val("sm_title"), who = val("sm_preacher"), date = val("sm_date"), media = val("sm_media");
    if (!title || !who || !date) return alert("Fill in title, preacher and date.");
    if (media && !/^https:\/\/\S+$/.test(media)) return alert("The audio/video must be a link starting with https:// (YouTube, Google Drive, Facebook...).");
    await busy("saveSermonBtn", async () => {
        let preacher = who, preacherNo = "";
        if (/-CLG-\d+$/i.test(who)) {
            preacherNo = who.toUpperCase();
            const c = await parishRef().collection("clergy").doc(preacherNo).get().catch(() => null);
            if (!c || !c.exists) return alert("No clergy with number " + preacherNo + " in this parish. Type the preacher's name instead.");
            preacher = c.data().fullName;
        }
        const id = sermonState.editing || newId();
        const old = sermonState.list.find(s => s.id === id) || {};
        const d = { title, titleLower: title.toLowerCase(), preacher, preacherNo, date, serviceType: val("sm_service"), scripture: val("sm_scripture"),
            tags: [...new Set(val("sm_tags").split(",").map(t => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean))].slice(0, 10),
            text: $("sm_text").value.slice(0, 200000), mediaUrl: media, shared: $("sm_shared").checked,
            parishId: localState.currentParishId, parishName: localState.parish.name || "", createdAt: old.createdAt || nowIso(), updatedAt: nowIso() };
        const b = db.batch();
        b.set(parishRef().collection("sermons").doc(id), d);
        const sh = db.collection("sharedSermons").doc(localState.currentParishId + "_" + id);
        if (d.shared) b.set(sh, d); else if (old.shared) b.delete(sh);
        await b.commit();
        closeModal("sermonModal");
        sermonState.tab = "mine";
        await loadSermons();
    }).catch(e => alert("Sermon not saved: " + e.message));
}
function viewSermon(id) {
    const x = sermonState.list.find(s => s.id === id);
    const mine = sermonState.tab === "mine";
    const body = `<p class="text-gray-600">${esc(x.preacher)}${x.preacherNo ? ` (<span class="font-mono">${esc(x.preacherNo)}</span>)` : ""} · ${esc(x.date)} · ${esc(x.serviceType || "")}</p>
        ${!mine ? `<p class="text-gray-500">${esc(x.parishName)}</p>` : ""}
        ${x.scripture ? `<p><b>Scripture:</b> ${esc(x.scripture)}</p>` : ""}
        ${(x.tags || []).length ? `<p class="text-blue-800">${x.tags.map(t => "#" + esc(t)).join(" ")}</p>` : ""}
        ${x.mediaUrl ? `<a href="${esc(x.mediaUrl)}" target="_blank" rel="noopener" class="inline-block bg-red-600 text-white rounded px-3 py-2 font-bold"><i class="fa-solid fa-play mr-1"></i> Watch / listen (${mediaKind(x.mediaUrl)})</a>` : ""}
        ${x.text ? `<div class="border rounded p-2 bg-gray-50 whitespace-pre-wrap max-h-80 overflow-y-auto">${esc(x.text)}</div>` : `<p class="text-gray-400">No transcript.</p>`}`;
    const acts = (mine ? `<button onclick="openSermonForm('${id}')" class="px-3 py-2 bg-blue-600 text-white rounded">Edit</button>` : "");
    p9Modal(x.title, body, acts);
}

// ================================================================= 2. EVENT CALENDAR
let cal = { month: "", view: "month", events: [], specials: [], day: "" };
async function openCalendar() {
    cal.month = cal.month || monthOf(localToday());
    await loadCalendar();
}
function calShift(n) { const d = parseYmd(cal.month + "-01"); d.setMonth(d.getMonth() + n); cal.month = ymd(d).slice(0, 7); cal.day = ""; loadCalendar(); }
function calView(v) { cal.view = v; renderCalendar(); }
async function loadCalendar() {
    const first = cal.month + "-01", last = addDays(ymd(new Date(parseYmd(first).getFullYear(), parseYmd(first).getMonth() + 1, 1)), -1);
    const [ev, sp] = await Promise.all([
        parishRef().collection("events").where("date", ">=", first).where("date", "<=", last).get(),
        parishRef().collection("specialServices").where("date", ">=", first).where("date", "<=", last).get()]);
    cal.events = ev.docs.map(d => ({ id: d.id, ...d.data() }));
    cal.specials = sp.docs.map(d => ({ id: d.id, ...d.data() }));
    cal.first = first; cal.last = last;
    renderCalendar();
}
// Timetable services (reused from Phase 3) + special services + events, for dates between a and b.
function itemsBetween(a, b, events, specials) {
    const out = [];
    for (let sun = weekStart(a); sun <= b; sun = addDays(sun, 7))
        for (const s of weekServices(sun, specials.filter(x => x.date >= sun && x.date <= addDays(sun, 6))))
            if (s.date >= a && s.date <= b) out.push({ ...s, type: s.key === "special" ? "special" : "service" });
    for (let d = a; d <= b; d = addDays(d, 1))   // Phase 9b: the parish's weekly activities (rehearsals, cleaning...)
        for (const x of ACTIVITIES) if (x.dow === parseYmd(d).getDay()) out.push({ id: d + "_" + x.key, name: x.name, date: d, time: x.time || "", type: "activity" });
    for (const e of events) out.push({ id: e.id, name: e.title, date: e.date, time: e.time, type: "event", kind: e.kind, ev: e });
    return out.sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
}
const dotColor = t => t === "event" ? "bg-rose-500" : t === "special" ? "bg-amber-500" : t === "activity" ? "bg-emerald-500" : "bg-blue-500";
function itemRow(it) {
    const slots = it.ev ? (it.ev.slots || []) : [];
    const need = slots.reduce((n, s) => n + Math.max(0, (s.needed || 0) - (s.assigned || []).length), 0);
    const tag = it.type === "event" ? P9_KINDS[it.kind] : it.type === "special" ? "Special service" : it.type === "activity" ? "Activity" : "Service";
    return `<div class="cal-item flex items-center gap-2 bg-white border rounded-lg p-2 ${it.type === "event" ? "cursor-pointer" : ""}" ${it.type === "event" ? `onclick="viewEvent('${it.id}')"` : ""}>
        <span class="w-2 h-2 rounded-full ${dotColor(it.type)}"></span>
        <span class="font-mono text-gray-500 w-12">${esc(it.time)}</span>
        <span class="flex-1"><b>${esc(it.name)}</b> <span class="text-gray-500">· ${esc(tag)}</span>${need ? ` <span class="text-rose-700">· ${need} volunteer${need > 1 ? "s" : ""} needed</span>` : ""}</span></div>`;
}
function renderCalendar() {
    const [y, m] = cal.month.split("-").map(Number);
    $("cal_title").textContent = `${MONTHS[m - 1]} ${y}`;
    document.querySelectorAll(".cal-view").forEach(b => b.classList.toggle("active", b.dataset.v === cal.view));
    const items = itemsBetween(cal.first, cal.last, cal.events, cal.specials);
    if (cal.view === "list") {
        let lastDay = "";
        $("cal_body").innerHTML = items.map(it => (it.date !== lastDay ? `<p class="font-bold pt-2">${esc(fmtDay(lastDay = it.date))}</p>` : "") + itemRow(it)).join("") || `<p class="text-gray-500">Nothing this month.</p>`;
        return;
    }
    const byDay = {};
    for (const it of items) (byDay[it.date] = byDay[it.date] || []).push(it);
    const lead = parseYmd(cal.first).getDay();
    let cells = DOW.map(d => `<div class="text-center text-[10px] font-semibold text-gray-500">${d}</div>`).join("") + "<div></div>".repeat(lead);
    const today = localToday();
    for (let d = cal.first; d <= cal.last; d = addDays(d, 1)) {
        const its = byDay[d] || [];
        const dots = [...new Set(its.map(i => i.type))].map(t => `<span class="w-1.5 h-1.5 rounded-full ${dotColor(t)}"></span>`).join("");
        cells += `<button onclick="calDay('${d}')" class="cal-day h-12 border rounded flex flex-col items-center justify-start pt-1 ${d === cal.day ? "ring-2 ring-blue-600" : ""} ${d === today ? "bg-yellow-50 font-bold" : "bg-white"}">
            <span>${parseYmd(d).getDate()}</span><span class="flex gap-0.5 mt-1">${dots}</span></button>`;
    }
    const day = cal.day || (today.startsWith(cal.month) ? today : cal.first);
    $("cal_body").innerHTML = `<div class="grid grid-cols-7 gap-1">${cells}</div>
        <p class="font-bold pt-3">${esc(fmtDay(day))}</p><div class="space-y-1">${(byDay[day] || []).map(itemRow).join("") || `<p class="text-gray-500">Nothing on this day.</p>`}</div>`;
}
function calDay(d) { cal.day = d; renderCalendar(); }

let evForm = { id: null, slots: [] };
function openEventForm(id) {
    const e = id ? cal.events.find(x => x.id === id) || {} : {};
    evForm = { id: id || null, slots: JSON.parse(JSON.stringify(e.slots || [])), createdAt: e.createdAt };
    $("ev_title").value = e.title || ""; $("ev_kind").value = e.kind || "meeting"; $("ev_date").value = e.date || cal.day || localToday();
    $("ev_time").value = e.time || "10:00"; $("ev_venue").value = e.venue || ""; $("ev_notes").value = e.notes || "";
    renderSlotEditor();
    closeModal("p9Modal");
    openModal("eventModal");
}
function renderSlotEditor() {
    $("ev_slots").innerHTML = evForm.slots.map((s, i) => `<div class="flex gap-1 items-center"><span class="flex-1">${esc(s.role)}</span><span>need ${s.needed}</span>
        <span class="text-gray-500">(${(s.assigned || []).length} assigned)</span><button onclick="evForm.slots.splice(${i},1);renderSlotEditor()" class="text-red-600 px-2" aria-label="Remove">✕</button></div>`).join("")
        || `<p class="text-gray-400">No volunteer roles yet.</p>`;
}
function addSlot() {
    const role = val("ev_slotRole"), needed = Number($("ev_slotNeed").value || 0);
    if (!role || needed < 1) return alert("Type the role (e.g. Ushers) and how many people are needed.");
    if (evForm.slots.length >= 20) return alert("Up to 20 roles per event.");
    evForm.slots.push({ role: role.slice(0, 60), needed: Math.min(needed, 200), assigned: [] });
    $("ev_slotRole").value = ""; $("ev_slotNeed").value = "";
    renderSlotEditor();
}
async function saveEvent() {
    const title = val("ev_title"), date = val("ev_date"), time = val("ev_time");
    if (!title || !date || !time) return alert("Fill in title, date and time.");
    await busy("saveEventBtn", async () => {
        const d = { title, kind: val("ev_kind"), date, time, venue: val("ev_venue"), notes: val("ev_notes"), slots: evForm.slots,
            createdAt: evForm.createdAt || nowIso(), updatedAt: nowIso() };
        await parishRef().collection("events").doc(evForm.id || newId()).set(d);
        closeModal("eventModal");
        cal.month = monthOf(date); cal.day = date;
        await loadCalendar();
        renderWeekCard().catch(() => {});
    }).catch(e => alert("Event not saved: " + e.message));
}
function viewEvent(id) {
    const e = cal.events.find(x => x.id === id) || (weekCache.events || []).find(x => x.id === id);
    if (!e) return;
    if (!cal.events.find(x => x.id === id)) cal.events.push(e);
    const slots = (e.slots || []).map((s, i) => `<div class="border rounded p-2 space-y-1"><p><b>${esc(s.role)}</b> · ${(s.assigned || []).length}/${s.needed}</p>
        ${(s.assigned || []).map((a, j) => `<p class="flex justify-between"><span>${esc(a.name)} <span class="font-mono text-gray-400">${esc(a.no)}</span></span><button onclick="unassign('${id}',${i},${j})" class="text-red-600">remove</button></p>`).join("")}
        ${(s.assigned || []).length < s.needed ? `<input oninput="slotSearch('${id}',${i},this.value)" class="w-full border p-2 rounded slot-q" placeholder="Add a member: type a name"><div id="slotFound${i}" class="space-y-1"></div>` : `<p class="text-emerald-700">Full</p>`}</div>`).join("");
    p9Modal(e.title, `<p class="text-gray-600">${esc(P9_KINDS[e.kind])} · ${esc(fmtDay(e.date))} ${esc(e.time)}${e.venue ? " · " + esc(e.venue) : ""}</p>
        ${e.notes ? `<p>${esc(e.notes)}</p>` : ""}<p class="font-bold">Volunteers</p>${slots || `<p class="text-gray-400">No volunteer roles.</p>`}`,
        `<button onclick="openEventForm('${id}')" class="px-3 py-2 bg-blue-600 text-white rounded">Edit</button>
         <button onclick="remindEvent('${id}')" class="px-3 py-2 bg-emerald-600 text-white rounded">Remind volunteers</button>`);
}
let slotTimer = null, slotNames = {};
function slotSearch(id, i, q) {
    clearTimeout(slotTimer);
    slotTimer = setTimeout(async () => {
        const list = await findMembers(q);
        for (const m of list) slotNames[m.memberNo] = m.fullName;
        $("slotFound" + i).innerHTML = list.map(m => `<button onclick="assign('${id}',${i},'${esc(m.memberNo)}')" class="slot-opt w-full text-left border rounded p-2 bg-blue-50">${esc(m.fullName)} <span class="font-mono text-gray-500">${esc(m.memberNo)}</span></button>`).join("");
    }, 250);
}
async function updateSlots(id, fn) {
    const ref = parishRef().collection("events").doc(id);
    await db.runTransaction(async t => {
        const e = (await t.get(ref)).data();
        fn(e.slots);
        t.update(ref, { slots: e.slots, updatedAt: nowIso() });
    });
    const fresh = (await ref.get()).data();
    Object.assign(cal.events.find(x => x.id === id), fresh);
    viewEvent(id);
    if (!$("section-calendar").classList.contains("hidden")) renderCalendar();
}
function assign(id, i, no) {
    const name = slotNames[no] || no;
    updateSlots(id, slots => {
        const s = slots[i];
        if (!s.assigned.some(a => a.no === no) && s.assigned.length < s.needed) s.assigned.push({ no, name });
    }).catch(e => alert("Not saved: " + e.message));
}
function unassign(id, i, j) { updateSlots(id, slots => slots[i].assigned.splice(j, 1)).catch(e => alert("Not saved: " + e.message)); }
async function remindEvent(id) {
    const e = cal.events.find(x => x.id === id);
    const nos = [...new Set((e.slots || []).flatMap(s => (s.assigned || []).map(a => a.no)))];
    closeModal("p9Modal");
    showSection("messages");
    msg.recipients = [];
    await addRecipientNos(nos);
    $("msg_tpl").value = "event"; msgTemplate();
    $("msg_text").value = $("msg_text").value.replace("{event}", `${e.title} (${fmtDay(e.date)} ${e.time})`);
}

// ---- Dashboard card: this week (today + 6 days)
let weekCache = {};
const inWindow = (day, month, from, to) => {
    if (!day || !month) return null;
    for (let d = from; d <= to; d = addDays(d, 1)) { const x = parseYmd(d); if (x.getMonth() + 1 === month && x.getDate() === day) return d; }
    return null;
};
async function renderWeekCard() {
    if (localState.role !== "parish_admin") return;
    const from = localToday(), to = addDays(from, 6);
    const months = [...new Set([parseYmd(from).getMonth() + 1, parseYmd(to).getMonth() + 1])];
    const m = parishRef().collection("members");
    const [ev, sp, bd, wd] = await Promise.all([
        parishRef().collection("events").where("date", ">=", from).where("date", "<=", to).get(),
        parishRef().collection("specialServices").where("date", ">=", from).where("date", "<=", to).get(),
        m.where("dobMonth", "in", months).get(), m.where("weddingMonth", "in", months).get()]);
    const events = ev.docs.map(d => ({ id: d.id, ...d.data() }));
    weekCache = { events };
    const items = itemsBetween(from, to, events, sp.docs.map(d => ({ id: d.id, ...d.data() })));
    const people = (snap, dk, mk) => snap.docs.map(d => d.data()).filter(p => p.status === "Active")
        .map(p => ({ p, on: inWindow(p[dk], p[mk], from, to) })).filter(x => x.on).sort((a, b) => a.on.localeCompare(b.on));
    const births = people(bd, "dobDay", "dobMonth"), weds = people(wd, "weddingDay", "weddingMonth");
    const person = (x, tpl) => `<div class="flex items-center justify-between gap-2"><span>${esc(x.p.fullName)} <span class="text-gray-500">· ${esc(fmtDay(x.on))}</span></span>
        <button onclick="wish('${tpl}','${esc(x.p.memberNo)}')" class="wish-btn px-2 py-1 bg-emerald-600 text-white rounded"><i class="fa-brands fa-whatsapp"></i> Wish</button></div>`;
    const svc = items.filter(i => i.type !== "event"), evs = items.filter(i => i.type === "event");
    $("weekCard").innerHTML = `<p class="font-bold text-sm"><i class="fa-solid fa-calendar-week text-blue-700 mr-1"></i> Upcoming this week</p>
        ${evs.length ? `<p class="text-[10px] uppercase font-semibold text-gray-500">Events</p>${evs.map(itemRow).join("")}` : ""}
        <p class="text-[10px] uppercase font-semibold text-gray-500">Birthdays (${births.length})</p>${births.map(x => person(x, "birthday")).join("") || `<p class="text-gray-400">None this week.</p>`}
        <p class="text-[10px] uppercase font-semibold text-gray-500">Wedding anniversaries (${weds.length})</p>${weds.map(x => person(x, "anniversary")).join("") || `<p class="text-gray-400">None this week.</p>`}
        <details><summary class="text-[10px] uppercase font-semibold text-gray-500 cursor-pointer">Services &amp; activities (${svc.length})</summary><div class="space-y-1 mt-1">${svc.map(itemRow).join("")}</div></details>`;
    $("weekCard").classList.remove("hidden");
}
async function wish(tpl, no) {
    showSection("messages");
    msg.recipients = [];
    await addRecipientNos([no]);
    $("msg_tpl").value = tpl; msgTemplate();
}

// ================================================================= 3. MESSAGES (WhatsApp + email)
const TEMPLATES = {
    birthday: { name: "Birthday", text: "Happy birthday, {name}! The whole family of {parish} celebrates you today ({date}). May the Lord bless you with long life, joy and good health. Halleluyah!" },
    anniversary: { name: "Wedding anniversary", text: "Happy wedding anniversary, {name}! {parish} rejoices with you today ({date}). May God keep your home in love and peace." },
    absent: { name: "Absent follow-up", text: "Halleluyah 🙌, {name}! We have missed you at {parish}. We hope all is well. We are praying for you. Do let us know if you need anything. God bless you." },
    event: { name: "Event reminder", text: "Halleluyah 🙌, {name}! This is a reminder from {parish}: {event}. Thank you for serving. God bless you." },
    general: { name: "General", text: "Halleluyah 🙌, {name}! From {parish}, Celestial Church of Christ ({date}). " } };
let msg = { recipients: [], queue: [], at: 0, channel: "whatsapp" };
function fill(text, r) {
    return text.replace(/\{name\}/g, r ? r.name : "Beloved").replace(/\{parish\}/g, localState.parish.name || "our parish").replace(/\{date\}/g, fmtDay(localToday()));
}
// Country dialling code from the parish country; local numbers starting with 0 get it in front.
const DIAL = { nigeria: "234", ghana: "233", benin: "229", togo: "228", "united kingdom": "44", uk: "44", "united states": "1", usa: "1", canada: "1",
    "cote d'ivoire": "225", "ivory coast": "225", cameroon: "237", "south africa": "27", ireland: "353", france: "33", germany: "49", italy: "39", netherlands: "31" };
function waNumber(phone) {
    let d = String(phone || "").replace(/[^\d+]/g, "");
    if (d.startsWith("+")) return d.slice(1);
    if (d.startsWith("00")) return d.slice(2);
    if (d.startsWith("0")) return (DIAL[(localState.parish.country || "").toLowerCase()] || "234") + d.slice(1);
    return d;
}
const waLinkP9 = (to, text) => `https://wa.me/${waNumber(to)}?text=${encodeURIComponent(text)}`;

// ---- Adapter. Phase 1 = "link" (opens wa.me; the admin taps Send). To switch to the WhatsApp Business Cloud API,
// replace send() with a call to a SERVER endpoint (e.g. the ai-worker) that holds the church's token; never put the
// token in this file. See README "WhatsApp Business Cloud API".
const MessagingAdapter = {
    whatsapp: { mode: "link", async send(to, text) { window.open(waLinkP9(to, text), "_blank", "noopener"); return { ok: true, via: "wa.me" }; } } };
async function sendWhatsApp(to, text) { return MessagingAdapter.whatsapp.send(to, text); }

async function openMessages() {
    if (!localState.units) await loadUnits().catch(() => {});
    $("msg_unit").innerHTML = `<option value="">Add a department / unit...</option>` + allUnits().map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join("");
    if (!$("msg_text").value) msgTemplate();
    renderRecipients();
    await loadMsgLog();
}
function msgTemplate() { $("msg_text").value = TEMPLATES[val("msg_tpl")].text; renderPreview(); }
function msgChannel(c) { msg.channel = c; document.querySelectorAll(".msg-ch").forEach(b => b.classList.toggle("active", b.dataset.c === c)); $("msg_many").classList.toggle("hidden", c !== "whatsapp"); renderRecipients(); }
async function addRecipientNos(nos) {
    const docs = await Promise.all(nos.map(no => parishRef().collection(noType(no) === "CLG" ? "clergy" : "members").doc(no).get().catch(() => null)));
    for (const d of docs) if (d && d.exists) addRecipient(d.data());
    renderRecipients();
}
function addRecipient(p) {
    if (msg.recipients.some(r => r.no === p.memberNo)) return;
    msg.recipients.push({ no: p.memberNo, name: p.fullName, phone: p.phone || "", email: p.email || "" });
}
let msgTimer = null;
function msgSearch(q) {
    clearTimeout(msgTimer);
    msgTimer = setTimeout(async () => {
        const list = await findMembers(q);
        $("msg_found").innerHTML = list.map(m => `<button onclick='pickRecipient(${JSON.stringify(m.memberNo)})' class="msg-opt w-full text-left border rounded p-2 bg-blue-50">${esc(m.fullName)} <span class="text-gray-500">${esc(m.phone || "no phone")}</span></button>`).join("");
    }, 250);
}
async function pickRecipient(no) { $("msg_q").value = ""; $("msg_found").innerHTML = ""; await addRecipientNos([no]); }
async function addUnitRecipients() {
    const u = val("msg_unit");
    if (!u) return;
    const s = await parishRef().collection("deptMembers").where("dept", "==", u).where("status", "==", "Current").get();
    await addRecipientNos(s.docs.map(d => d.data().memberNo));
    $("msg_unit").value = "";
}
function removeRecipient(i) { msg.recipients.splice(i, 1); renderRecipients(); }
function renderRecipients() {
    const key = msg.channel === "whatsapp" ? "phone" : "email";
    $("msg_recips").innerHTML = msg.recipients.map((r, i) => `<span class="msg-chip inline-flex items-center gap-1 rounded-full px-2 py-1 ${r[key] ? "bg-blue-100" : "bg-gray-200 text-gray-500 line-through"}">${esc(r.name)}<button onclick="removeRecipient(${i})" aria-label="Remove">✕</button></span>`).join(" ")
        || `<span class="text-gray-400">No recipients yet.</span>`;
    const missing = msg.recipients.filter(r => !r[key]).length;
    $("msg_count").textContent = `${msg.recipients.length} recipient(s)${missing ? ` · ${missing} without ${key === "phone" ? "a phone" : "an email"} (skipped)` : ""}`;
    renderPreview();
}
function renderPreview() { $("msg_preview").textContent = fill($("msg_text").value, msg.recipients[0] || { name: "Ade" }); }
async function logSent(r) {
    await parishRef().collection("messageLog").add({ template: val("msg_tpl"), channel: msg.channel, to: r.no, name: r.name,
        at: firebase.firestore.FieldValue.serverTimestamp(), by: localState.user.uid });
}
function startSending() {
    const key = msg.channel === "whatsapp" ? "phone" : "email";
    const list = msg.recipients.filter(r => r[key]);
    if (!list.length) return alert(`Pick recipients with ${key === "phone" ? "a phone number" : "an email"} first.`);
    if (msg.channel === "whatsapp") { msg.queue = list; msg.at = 0; renderQueue(); }
    else renderEmailBatches(list);
}
function renderQueue() {
    const r = msg.queue[msg.at];
    if (!r) { $("msg_queue").innerHTML = `<p class="text-emerald-700 font-bold">Done: ${msg.queue.length} message(s) opened.</p>`; return loadMsgLog(); }
    $("msg_queue").innerHTML = `<p class="font-bold">${msg.at + 1} of ${msg.queue.length}: ${esc(r.name)} <span class="text-gray-500">${esc(r.phone)}</span></p>
        <p class="bg-gray-50 border rounded p-2 whitespace-pre-wrap">${esc(fill($("msg_text").value, r))}</p>
        <div class="grid grid-cols-2 gap-2"><button id="waSendBtn" onclick="sendCurrent()" class="py-3 bg-emerald-600 text-white rounded font-bold"><i class="fa-brands fa-whatsapp"></i> Open WhatsApp</button>
        <button id="waSkipBtn" onclick="msg.at++;renderQueue()" class="py-3 border rounded font-bold">Skip</button></div>`;
}
async function sendCurrent() {
    const r = msg.queue[msg.at];
    await busy("waSendBtn", async () => {
        await sendWhatsApp(r.phone, fill($("msg_text").value, r));
        await logSent(r);
        msg.at++;
        renderQueue();
    }).catch(e => alert("Could not log the message: " + e.message));
}
// Email: one mailto per batch of 40 (BCC keeps addresses private); {name} becomes "Beloved" because one text goes to all.
const EMAIL_BATCH = 40;
function openExternal(url) { location.href = url; }
function renderEmailBatches(list) {
    msg.batches = [];
    for (let i = 0; i < list.length; i += EMAIL_BATCH) msg.batches.push(list.slice(i, i + EMAIL_BATCH));
    $("msg_queue").innerHTML = `<p class="text-gray-600">Email goes by BCC, so {name} reads "Beloved". Tap each batch once.</p>` + msg.batches.map((b, i) =>
        `<button id="mailBatch${i}" onclick="sendBatch(${i})" class="mail-batch w-full py-3 bg-blue-600 text-white rounded font-bold">Open email: batch ${i + 1} of ${msg.batches.length} (${b.length})</button>`).join("");
}
const mailtoLink = (bcc, subject, body) => `mailto:?bcc=${encodeURIComponent(bcc.join(","))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
async function sendBatch(i) {
    const b = msg.batches[i];
    await busy("mailBatch" + i, async () => {
        openExternal(mailtoLink(b.map(r => r.email), `${TEMPLATES[val("msg_tpl")].name} - ${localState.parish.name || "CCC"}`, fill($("msg_text").value, null)));
        for (const r of b) await logSent(r);
        $("mailBatch" + i).textContent = `Batch ${i + 1} opened ✓`;
        loadMsgLog();
    }).catch(e => alert("Could not log the message: " + e.message));
}
async function loadMsgLog() {
    const s = await parishRef().collection("messageLog").orderBy("at", "desc").limit(20).get();
    $("msg_log").innerHTML = s.docs.map(d => { const x = d.data(); const t = x.at && x.at.toDate ? x.at.toDate() : null;
        if (x.channel === "whatsapp_batch") return `<p class="msg-log-row">Send to many (${x.count}) · WhatsApp · ${esc(TEMPLATES[x.template]?.name || x.template)} · <span class="text-gray-500">${t ? esc(t.toLocaleString()) : ""}</span></p>`;
        return `<p class="msg-log-row">${esc(x.name)} · ${x.channel === "whatsapp" ? "WhatsApp" : "Email"} · ${esc(TEMPLATES[x.template]?.name || x.template)} · <span class="text-gray-500">${t ? esc(t.toLocaleString()) : ""}</span></p>`; }).join("")
        || `<p class="text-gray-400">Nothing sent yet.</p>`;
}

// ================================================================= 4. MEMBER SIGN-UP LINK
// The parish website is a separate project (Batch 12). This app keeps only the /join?p=<parish code> sign-up link.
const joinBase = () => location.origin + "/join?p=";
const myCode = () => localState.parish.code || "";
function copyText(t, btn) {
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { if (btn) $(btn).textContent = "Copied ✓"; })
        .catch(() => prompt("Copy this:", t));
}

// ================================================================= 4b. JOIN LINK + PENDING REGISTRATIONS (dashboard)
async function renderJoinCard() {
    if (localState.role !== "parish_admin") return;
    const card = $("joinCard");
    if (!myCode()) { card.innerHTML = `<p class="font-bold text-sm">Member sign-up link</p><p class="text-gray-500">Needs a parish code. Ask the Super Admin.</p>`; card.classList.remove("hidden"); return; }
    const [j, pend] = await Promise.all([db.collection("joinLinks").doc(myCode()).get(), parishRef().collection("pendingMembers").where("status", "in", ["Pending", "Clarify"]).get()]);
    const open = j.exists && j.data().open, link = joinBase() + myCode();
    let qr = "";
    try { const q = qrcode(0, "M"); q.addData(link); q.make(); qr = q.createSvgTag(4, 8, "QR code for the sign-up link"); } catch (e) { console.error("qr", e); }
    pendState.list = pend.docs.map(d => ({ id: d.id, ...d.data() }));
    card.innerHTML = `<p class="font-bold text-sm"><i class="fa-solid fa-user-plus text-emerald-700 mr-1"></i> Member sign-up link</p>
        <p class="text-gray-600">Members fill the form on their phone; you approve each one here. ${open ? '<span class="text-emerald-700 font-bold">Open</span>' : '<span class="text-gray-500 font-bold">Closed</span>'}</p>
        ${open ? `<div class="flex gap-3 items-center"><div id="joinQr" class="w-28 shrink-0 bg-white">${qr}</div>
            <div class="space-y-1 min-w-0"><p id="joinLink" class="font-mono break-all text-[10px]">${esc(link)}</p>
            <button id="joinCopy" onclick="copyText('${esc(link)}','joinCopy')" class="px-2 py-1 border rounded">Copy link</button>
            <a id="joinShare" href="https://wa.me/?text=${encodeURIComponent("Register as a member of " + (localState.parish.name || "our parish") + ": " + link)}" target="_blank" rel="noopener" class="inline-block px-2 py-1 bg-emerald-600 text-white rounded"><i class="fa-brands fa-whatsapp"></i> Share</a></div></div>` : ""}
        <button id="joinToggle" onclick="toggleJoin(${!open})" class="px-3 py-2 rounded ${open ? "border" : "bg-emerald-700 text-white"} font-bold">${open ? "Close the link" : "Open the sign-up link"}</button>
        <p class="font-bold pt-1">Pending registrations (${pendState.list.length})</p>
        ${pendState.list.map(p => `<div class="pend-row border rounded p-2 space-y-1"><p>${esc(p.fullName)} <span class="text-gray-500">${esc(p.phone)}</span>${p.status === "Clarify" ? ' <span class="pend-clarify text-[10px] font-bold px-1 rounded bg-amber-100 text-amber-900">Flagged</span>' : ""}</p>
            ${p.status === "Clarify" ? `<p class="pend-note text-gray-600 italic">${esc(p.clarifyReason || "Flagged")}${p.clarifyNote ? ": " + esc(p.clarifyNote) : ""}</p>${contactLinks(p)}` : ""}
            <span class="flex flex-wrap gap-1"><button onclick="reviewPending('${p.id}')" class="px-2 py-1 bg-blue-900 text-white rounded">Approve as member</button><button onclick="flagForm('${p.id}')" class="px-2 py-1 border rounded">Flag &amp; pend</button><button onclick="rejectPending('${p.id}')" class="px-2 py-1 border rounded text-red-700">Reject</button></span>
            <div id="flag_${p.id}" class="pend-flag hidden space-y-1"><select class="pend-reason w-full border p-2 rounded text-base"><option value="">Pick a reason…</option>${FLAG_REASONS.map(r => `<option>${r}</option>`).join("")}</select>
            <input class="pend-flagnote w-full border p-2 rounded text-base" maxlength="300" placeholder="Note (optional)"><button onclick="flagPending('${p.id}')" class="pend-flagsave px-2 py-1 bg-amber-600 text-white rounded font-bold">Save flag</button></div></div>`).join("") || `<p class="text-gray-400">None.</p>`}`;
    card.classList.remove("hidden");
}
let pendState = { list: [] };
async function toggleJoin(open) {
    await db.collection("joinLinks").doc(myCode()).set({ parishId: localState.currentParishId, name: localState.parish.name, open, updatedAt: nowIso() })
        .catch(e => alert("Not changed: " + e.message));
    await renderJoinCard();
}
// Opens the normal member form, pre-filled; Save creates the numbered member and marks the request Approved together.
function reviewPending(id) {
    const p = pendState.list.find(x => x.id === id);
    openPersonForm("members", null);
    const set = (k, v) => $(k).value = v ?? "";
    set("p_name", p.fullName); set("p_gender", p.gender); fillRanks(""); set("p_marital", p.maritalStatus); set("p_address", p.address);
    set("p_phone", p.phone); set("p_email", p.email); set("p_occupation", p.occupation); set("p_dobDay", p.dobDay); set("p_dobMonth", p.dobMonth);
    set("p_dobYear", p.dobYear); set("p_wedDay", p.weddingDay); set("p_wedMonth", p.weddingMonth); set("p_nokName", p.nokName); set("p_nokPhone", p.nokPhone);
    $("p_consent").checked = p.consentGiven === true;
    form.photo = p.photo || "";
    $("p_photoPreview").classList.toggle("hidden", !form.photo); if (form.photo) $("p_photoPreview").src = form.photo;
    form.pendingId = id;
    $("personModalTitle").textContent = "APPROVE SIGN-UP: CHECK, EDIT, SAVE";
}
async function rejectPending(id) {
    const reason = prompt("Reason for rejecting (kept with the request):");
    if (!reason) return;
    await parishRef().collection("pendingMembers").doc(id).update({ status: "Rejected", reason: reason.slice(0, 300), decidedAt: nowIso(), decidedBy: localState.user.uid })
        .catch(e => alert("Not saved: " + e.message));
    await renderJoinCard();
}

const FLAG_REASONS = ["May be a visitor", "May be a friend of the house", "Details look suspicious", "Other"];
// One-tap contact with the flag note prefilled.
function contactLinks(p) {
    const d = String(p.phone || "").replace(/\D/g, ""), wa = d.startsWith("0") ? "234" + d.slice(1) : d;
    const msg = "Halleluyah " + p.fullName + ", about your registration with " + (localState.parish.name || "our parish") + ": " + (p.clarifyNote || "please could you confirm a few details?");
    return `<span class="flex gap-1"><a class="pend-wa px-2 py-1 bg-emerald-700 text-white rounded" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a><a class="pend-sms px-2 py-1 border rounded" href="sms:${esc(p.phone)}?body=${encodeURIComponent(msg)}"><i class="fa-solid fa-message"></i> SMS</a><a class="px-2 py-1 border rounded" href="tel:${esc(p.phone)}"><i class="fa-solid fa-phone"></i> Call</a></span>`;
}
function flagForm(id) { $("flag_" + id).classList.toggle("hidden"); }
// Flag & pend: stays open with a reason; approve or reject later once clarified.
async function flagPending(id) {
    const box = $("flag_" + id), reason = box.querySelector(".pend-reason").value, note = box.querySelector(".pend-flagnote").value.trim();
    if (!reason) return alert("Pick a reason.");
    await parishRef().collection("pendingMembers").doc(id).update({ status: "Clarify", clarifyReason: reason, clarifyNote: note.slice(0, 300), decidedAt: nowIso(), decidedBy: localState.user.uid })
        .catch(e => alert("Not saved: " + e.message));
    await renderJoinCard();
}
// ================================================================= 4c. WEEKLY TIMETABLE EDITOR (Parish Settings)
let ttRows = [];
function openTimetable() {
    ttRows = SCHEDULE.map(s => ({ ...s, kind: "service" })).concat(ACTIVITIES.map(a => ({ ...a, kind: "activity" })));
    renderTimetable();
}
function renderTimetable() {
    const dayOpts = v => DOW.map((d, i) => `<option value="${i}" ${i === v ? "selected" : ""}>${d}</option>`).join("");
    $("tt_rows").innerHTML = ttRows.map((r, i) => `<div class="tt-row border rounded p-2 space-y-1 ${r.kind === "activity" ? "bg-emerald-50" : "bg-white"}">
        <input value="${esc(r.name)}" oninput="ttRows[${i}].name=this.value" class="tt-name w-full border p-2 rounded" placeholder="Name">
        <div class="grid grid-cols-4 gap-1"><select onchange="ttRows[${i}].dow=Number(this.value)" class="tt-day border p-2 rounded bg-white">${dayOpts(r.dow)}</select>
        <input type="time" value="${esc(r.time)}" oninput="ttRows[${i}].time=this.value" class="tt-time border p-2 rounded">
        <select onchange="ttRows[${i}].week=this.value" class="border p-2 rounded bg-white"><option value="">Every week</option><option value="first" ${r.week === "first" ? "selected" : ""}>1st of month</option><option value="other" ${r.week === "other" ? "selected" : ""}>Other weeks</option></select>
        <select onchange="ttRows[${i}].kind=this.value" class="tt-kind border p-2 rounded bg-white"><option value="service">Service</option><option value="activity" ${r.kind === "activity" ? "selected" : ""}>Activity</option></select></div>
        <button onclick="ttRows.splice(${i},1);renderTimetable()" class="tt-del text-red-600">Remove</button></div>`).join("");
    $("tt_note").textContent = TIMETABLE_CUSTOM ? "Your parish's own timetable." : "Standard CCC timetable (default).";
}
function addTimetableRow() { ttRows.push({ key: "", name: "", dow: 6, time: "18:00", week: "", kind: "service" }); renderTimetable(); }
async function saveTimetable() {
    const rows = ttRows.map(r => ({ ...r, name: String(r.name || "").trim().slice(0, 60) }));
    if (rows.some(r => !r.name || (r.kind === "service" && !/^\d\d:\d\d$/.test(r.time || "")))) return alert("Every row needs a name, and every service a time.");
    if (!rows.some(r => r.kind === "service")) return alert("Keep at least one service.");
    if (rows.length > 40) return alert("Up to 40 rows.");
    // Keys never change for existing rows, so old attendance records keep their type. New rows get c_ (service) / a_ (activity).
    for (const r of rows) if (!r.key) r.key = (r.kind === "activity" ? "a_" : "c_") + Math.random().toString(36).slice(2, 10);
    const services = rows.map(r => ({ key: r.key, name: r.name, dow: r.dow, time: r.time || "", week: r.week || "", kind: r.kind }));
    await busy("tt_save", () => parishRef().collection("settings").doc("timetable").set({ services, updatedAt: nowIso() }))
        .then(() => { setTimetable(services); openTimetable(); alert("Timetable saved. Attendance, calendar and the dashboard now use it."); })
        .catch(e => alert("Not saved: " + e.message));
}
async function resetTimetable() {
    if (!confirm("Go back to the standard CCC timetable?")) return;
    await parishRef().collection("settings").doc("timetable").delete().catch(e => alert("Not reset: " + e.message));
    setTimetable(null); openTimetable();
}

// ================================================================= 5. SUPER ADMIN: change parish admin (handover)
// Default: the old admin keeps access until the new admin claims the invite (no gap in running the parish; two admins
// for a short time). "Revoke now" is for an admin who must lose access at once. Revoked = users/{uid}.role 'revoked'
// (kept as a record, never deleted) + the adminEmails entry removed. Parish data is untouched. Every step is audited.
const HO_SNAP = ["status", "mode", "newEmail", "oldAdmins", "revokedAt"];
async function parishAdmins(pid) {
    const s = await db.collection("users").where("parishId", "==", pid).where("role", "==", "parish_admin").get();
    return s.docs.map(d => ({ uid: d.id, email: d.data().email || "" }));
}
async function changeAdmin(pid) {
    const [p, admins, hos] = await Promise.all([db.collection("parishes").doc(pid).get(), parishAdmins(pid),
        db.collection("adminHandovers").where("parishId", "==", pid).where("status", "==", "Pending").get()]);
    const pending = hos.docs.map(d => `<div class="border rounded p-2 bg-amber-50"><p>Pending: <b>${esc(d.data().newEmail)}</b> (${d.data().mode === "now" ? "old admin already revoked" : "old admin revoked when claimed"})</p>
        <p>Invite code: <span class="font-mono">${esc(d.data().inviteCode)}</span></p>
        <div class="flex gap-2 mt-1"><button onclick="finishHandover('${d.id}', true)" class="px-2 py-1 bg-emerald-600 text-white rounded">Revoke old admin now</button>
        <button onclick="cancelHandover('${d.id}')" class="px-2 py-1 border rounded">Cancel</button></div></div>`).join("");
    p9Modal("Change parish admin", `<p><b>${esc(p.data().name)}</b></p>
        <p class="text-gray-600">Current admin(s): ${admins.map(a => esc(a.email)).join(", ") || "none"}</p>${pending}
        <input id="ho_email" type="email" class="w-full border p-2.5 rounded" placeholder="New admin email (must not be clergy)">
        <input id="ho_reason" class="w-full border p-2.5 rounded" placeholder="Reason (required, goes to the audit log)">
        <label class="flex gap-2"><input type="radio" name="ho_mode" value="on_claim" checked> Keep the old admin until the new one signs up (recommended)</label>
        <label class="flex gap-2"><input type="radio" name="ho_mode" value="now"> Revoke the old admin now</label>
        <div id="ho_result"></div>`,
        `<button id="ho_btn" onclick="startHandover('${pid}')" class="px-3 py-2 bg-blue-700 text-white rounded font-bold">Create invite</button>`);
}
function revokeUsers(b, ho, hoId) {
    for (const a of ho.oldAdmins) {
        b.update(db.collection("users").doc(a.uid), { role: "revoked", handoverId: hoId, revokedAt: nowIso(), revokedBy: localState.user.uid });
        if (a.email) b.delete(db.collection("adminEmails").doc(a.email));
    }
}
async function startHandover(pid) {
    const email = val("ho_email").toLowerCase(), reason = val("ho_reason"), mode = document.querySelector("input[name=ho_mode]:checked").value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !reason) return alert("Enter the new admin's email and a reason.");
    await busy("ho_btn", async () => {
        const [p, admins] = await Promise.all([db.collection("parishes").doc(pid).get(), parishAdmins(pid)]);
        const oldAdmins = admins.filter(a => a.email !== email);
        const code = randomCode(), ref = db.collection("adminHandovers").doc();
        const ho = { parishId: pid, parishName: p.data().name, newEmail: email, inviteCode: code, oldAdmins, mode, status: "Pending", reason,
            version: 1, createdAt: nowIso(), updatedAt: nowIso(), revokedAt: mode === "now" ? nowIso() : "", by: localState.user.uid };
        const b = db.batch();
        b.set(db.collection("invites").doc(code), { email, parishId: pid, role: "parish_admin", usedBy: null, createdAt: nowIso() });
        b.set(ref, ho);
        writeAudit(b, "adminHandovers/" + ref.id, 1, "admin-handover-start", null, pick(ho, HO_SNAP), reason);
        if (mode === "now") revokeUsers(b, ho, ref.id);
        await b.commit();
        $("ho_result").innerHTML = `<div class="bg-emerald-50 border border-emerald-300 rounded p-2"><p>Invite code for ${esc(email)}:</p>
            <p id="ho_code" class="font-mono font-bold select-all">${esc(code)}</p>
            <p class="text-gray-600">${mode === "now" ? "The old admin has lost access." : "The old admin keeps access until the new admin activates the invite."}</p></div>`;
    }).catch(e => alert(e.code === "permission-denied" ? "Not created. The email must not belong to clergy, and you need a named Super Admin account." : "Not created: " + e.message));
}
async function stepHandover(id, status, action, revoke, reason) {
    const ref = db.collection("adminHandovers").doc(id);
    const ho = (await ref.get()).data();
    const next = { ...ho, status, version: ho.version + 1, updatedAt: nowIso(), revokedAt: revoke && !ho.revokedAt ? nowIso() : ho.revokedAt };
    const b = db.batch();
    b.set(ref, next);
    writeAudit(b, "adminHandovers/" + id, next.version, action, pick(ho, HO_SNAP), pick(next, HO_SNAP), reason);
    if (revoke && !ho.revokedAt) revokeUsers(b, ho, id);
    await b.commit();
}
// Completes when the new admin has claimed (mode on_claim) or on demand ("Revoke old admin now").
async function finishHandover(id, force) {
    const ho = (await db.collection("adminHandovers").doc(id).get()).data();
    const inv = await db.collection("invites").doc(ho.inviteCode).get();
    const claimed = inv.exists && inv.data().usedBy;
    if (claimed) await stepHandover(id, "Completed", "admin-handover-complete", true, "New admin " + ho.newEmail + " activated the invite");
    else if (force) await stepHandover(id, "Pending", "admin-handover-revoke-now", true, "Old admin revoked before the new admin activated");
    closeModal("p9Modal");
}
async function cancelHandover(id) {
    const reason = prompt("Why cancel this handover?");
    if (!reason) return;
    await stepHandover(id, "Cancelled", "admin-handover-cancel", false, reason).catch(e => alert("Not cancelled: " + e.message));
    const ho = (await db.collection("adminHandovers").doc(id).get()).data();
    await db.collection("invites").doc(ho.inviteCode).delete().catch(() => {});
    closeModal("p9Modal");
}
// Run when the Super Admin opens the Parishes page: complete every handover whose new admin has now claimed.
async function completeClaimedHandovers() {
    const s = await db.collection("adminHandovers").where("status", "==", "Pending").limit(50).get();
    for (const d of s.docs) {
        const inv = await db.collection("invites").doc(d.data().inviteCode).get();
        if (inv.exists && inv.data().usedBy) await stepHandover(d.id, "Completed", "admin-handover-complete", true, "New admin " + d.data().newEmail + " activated the invite");
    }
}

// ================================================================= 3b. WHATSAPP "SEND TO MANY" (one message, many chats)
// The text is written once ({name} -> "Beloved"). The phone's share sheet (or WhatsApp's share intent with no number)
// lets the admin pick several chats, a group or a broadcast list in one go. Logged as ONE batch: template, count, sender.
async function sendToMany() {
    const text = fill($("msg_text").value, null);
    let via = "wa.me";
    if (navigator.share) {
        try { await navigator.share({ text }); via = "share"; }
        catch (e) { if (e.name === "AbortError") return; openWaShare(text); }
    } else openWaShare(text);
    await parishRef().collection("messageLog").add({ template: val("msg_tpl"), channel: "whatsapp_batch", count: msg.recipients.length,
        at: firebase.firestore.FieldValue.serverTimestamp(), by: localState.user.uid }).catch(e => alert("Could not log the message: " + e.message));
    $("msg_queue").innerHTML = `<p class="text-emerald-700 font-bold">Opened ${via === "share" ? "the share sheet" : "WhatsApp"}: pick the chats, group or broadcast list, then tap Send.</p>`;
    loadMsgLog();
}
function openWaShare(text) { window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener"); }
function copyMessage() { copyText(fill($("msg_text").value, null), "msg_copy"); }
