// CCC parish website: ONE parish per site, chosen by its parish code: /site/?p=ABC123 (see vercel.json).
// The parish admin controls the content ("Our Website" in the Parish Portal). This page reads only the public projection
// publicSites/{code} (+ its events and sermons) through the Firestore REST API: no login, no cookies, no SDK.
// Structure is data-driven (PAGES below) so the menu can be redesigned later without touching the data.
const SITE = { project: "ccc-data-aarinat" };
const QS = new URLSearchParams(location.search);
const EMU = QS.has("emulator");
const CODE = (QS.get("p") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
const API = EMU ? "http://127.0.0.1:8080/v1/projects/demo-ccc/databases/(default)/documents"
    : `https://firestore.googleapis.com/v1/projects/${SITE.project}/databases/(default)/documents`;
const PAGES = [["index.html", "Home"], ["about.html", "About & beliefs"], ["services.html", "Service times"], ["events.html", "Events"],
    ["sermons.html", "Sermons"], ["contact.html", "Contact"], ["join.html", "Join us"], ["privacy.html", "Privacy"]];

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const qs = () => "?p=" + encodeURIComponent(CODE) + (EMU ? "&emulator=1" : "");
const link = f => f + qs();
function dec(v) {
    if ("stringValue" in v) return v.stringValue;
    if ("integerValue" in v) return Number(v.integerValue);
    if ("doubleValue" in v) return v.doubleValue;
    if ("booleanValue" in v) return v.booleanValue;
    if ("nullValue" in v) return null;
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
    if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
    if ("timestampValue" in v) return v.timestampValue;
    return null;
}
const docOf = d => ({ id: d.name.split("/").pop(), ...dec({ mapValue: d }) });
async function getDoc(path) {
    const r = await fetch(`${API}/${path}`);
    if (r.status === 404 || r.status === 403) return null;
    if (!r.ok) throw new Error("HTTP " + r.status);
    return docOf(await r.json());
}
// Query a subcollection of this parish's site.
async function query(sub, { where, order, dir = "ASCENDING", limit = 30 } = {}) {
    const sq = { from: [{ collectionId: sub }], limit };
    if (where) sq.where = { fieldFilter: { field: { fieldPath: where[0] }, op: where[1], value: { stringValue: where[2] } } };
    if (order) sq.orderBy = [{ field: { fieldPath: order }, direction: dir }];
    const r = await fetch(`${API}/publicSites/${CODE}:runQuery`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ structuredQuery: sq }) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return (await r.json()).filter(x => x.document).map(x => docOf(x.document));
}
const fmtDate = s => new Date(s + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

let site = null;
const ready = (async () => { if (CODE) site = await getDoc("publicSites/" + CODE).catch(() => null); return site; })();
function chrome() {
    const here = location.pathname.split("/").pop() || "index.html";
    const name = site ? site.name : "Celestial Church of Christ";
    document.title = (document.title.split(" · ")[0]) + " · " + name;
    document.body.insertAdjacentHTML("afterbegin", `<header class="top"><a class="brand" href="${link("index.html")}"><span class="logo">CCC</span>
        <span><b>CELESTIAL CHURCH OF CHRIST</b><small id="parishName">${esc(site ? site.name + (site.city ? " · " + site.city : "") : "WORLD-WIDE")}</small></span></a>
        <nav class="menu">${PAGES.map(([f, t]) => `<a href="${link(f)}" class="${f === here ? "on" : ""}">${t}</a>`).join("")}</nav></header>`);
    document.body.insertAdjacentHTML("beforeend", `<footer class="bottom">&copy; ${new Date().getFullYear()} ${esc(name)} · Celestial Church of Christ ·
        <a href="${link("privacy.html")}">Privacy notice (NDPA)</a></footer>`);
    // Body links keep the parish code.
    document.querySelectorAll('main a[href$=".html"]').forEach(a => a.setAttribute("href", link(a.getAttribute("href"))));
    if (!site && !/privacy|about|join/.test(here)) document.querySelector("main").innerHTML = `<h1>Parish website</h1><p class="empty">${CODE
        ? "This parish has not published its website yet." : "Open your parish's own link, for example <b>/site/?p=ABC123</b>. Ask your parish for it."}</p>`;
}
document.addEventListener("DOMContentLoaded", () => ready.then(chrome).then(() => { if (site && window.page) window.page(site); }));

// ---- renderers each page calls with the site record
function renderWelcome(el) { el.textContent = site.welcome || `Welcome to ${site.name}. Join us for worship this Sunday.`; }
function eventCard(e) {
    return `<div class="card ev"><h3>${esc(e.title)}</h3><p class="muted">${esc(fmtDate(e.date))} · ${esc(e.time)}${e.venue ? " · " + esc(e.venue) : ""}</p>${e.notes ? `<p>${esc(e.notes)}</p>` : ""}</div>`;
}
async function renderEvents(el, n = 30) {
    try {
        const list = await query("events", { where: ["date", "GREATER_THAN_OR_EQUAL", todayStr()], order: "date", limit: n });
        el.innerHTML = list.map(eventCard).join("") || `<p class="empty">No upcoming events yet.</p>`;
    } catch { el.innerHTML = `<p class="empty">Events could not be loaded. Please try again later.</p>`; }
}
async function renderSermons(el) {
    try {
        const list = await query("sermons", { order: "date", dir: "DESCENDING", limit: 50 });
        el.innerHTML = list.map(s => `<div class="card sermon"><h3>${esc(s.title)}</h3><p class="muted">${esc(s.preacher)} · ${esc(fmtDate(s.date))}</p>
            ${s.scripture ? `<p><b>${esc(s.scripture)}</b></p>` : ""}${s.summary ? `<p>${esc(s.summary)}${s.summary.length >= 300 ? "…" : ""}</p>` : ""}
            ${/^https:\/\//.test(s.mediaUrl || "") ? `<a class="btn" href="${esc(s.mediaUrl)}" target="_blank" rel="noopener">▶ Watch / listen</a>` : ""}</div>`).join("")
            || `<p class="empty">No sermons yet.</p>`;
    } catch { el.innerHTML = `<p class="empty">Sermons could not be loaded. Please try again later.</p>`; }
}
function renderServices(el) {
    el.innerHTML = `<table>${(site.services || []).map(s => `<tr><td>${esc(s.day)}</td><td class="t">${esc(s.time || "-")}</td><td>${esc(s.name)}</td></tr>`).join("")}</table>`;
}
function renderContact(el) {
    const parts = [];
    if (site.contactEmail) parts.push(`<a class="btn" href="mailto:${esc(site.contactEmail)}">✉ ${esc(site.contactEmail)}</a>`);
    if (site.contactPhone) parts.push(`<a class="btn alt" href="tel:${esc(site.contactPhone.replace(/[^\d+]/g, ""))}">📞 ${esc(site.contactPhone)}</a>`);
    if (/^https:\/\//.test(site.mapsUrl || "")) parts.push(`<a class="btn alt" href="${esc(site.mapsUrl)}" target="_blank" rel="noopener">📍 Map</a>`);
    el.innerHTML = `<h3>${esc(site.name)}</h3><p class="muted">${esc([site.city, site.country].filter(Boolean).join(", "))}</p><p>${parts.join(" ") || "Visit us at any service."}</p>`;
}
