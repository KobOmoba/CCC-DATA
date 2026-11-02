// CCC public website. No login, no cookies, no analytics. It reads ONLY the public projections the Super Admin
// publishes (publicParishes, publicEvents, publicSermons) through the Firestore REST API - no SDK, so it stays fast.
// Open any page with ?emulator=1 to read the local emulator (demo-ccc) instead of the live project.
const SITE = {
    project: "ccc-data-aarinat",
    contactEmail: "", // HQ to confirm: the public contact address
    base: location.pathname.startsWith("/site") ? "/site/" : "",
};
const EMU = new URLSearchParams(location.search).has("emulator");
const API = EMU ? "http://127.0.0.1:8080/v1/projects/demo-ccc/databases/(default)/documents"
    : `https://firestore.googleapis.com/v1/projects/${SITE.project}/databases/(default)/documents`;
// Same weekly timetable as the Parish Portal (app.js SCHEDULE). Keep the two in step.
const SERVICES = [["Sunday", "10:00", "Sunday Service"], ["Monday", "17:00", "Bible Class / Study"], ["Monday", "23:59", "Sidemen / Sidewomen Night Vigil"],
    ["Tuesday", "09:00", "Wakati Adura (Hour of Prayer)"], ["Wednesday", "09:00", "Seekers Service"], ["Wednesday", "18:00", "Evening Service"],
    ["Thursday (1st of month)", "22:00", "New Moon Service"], ["Thursday (other weeks)", "23:59", "Prophets / Prophetesses Night Vigil"],
    ["Friday", "18:00", "Evening Service"], ["Saturday", "", "Church cleaning"]];
const PAGES = [["index.html", "Home"], ["about.html", "About & beliefs"], ["parishes.html", "Find a parish"], ["services.html", "Service times"],
    ["events.html", "Events"], ["sermons.html", "Sermons"], ["contact.html", "Contact"], ["privacy.html", "Privacy"]];

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const link = f => SITE.base + f + (EMU ? "?emulator=1" : "");
function chrome() {
    const here = location.pathname.split("/").pop() || "index.html";
    document.body.insertAdjacentHTML("afterbegin", `<header class="top"><a class="brand" href="${link("index.html")}"><span class="logo">CCC</span>
        <span><b>CELESTIAL CHURCH OF CHRIST</b><small>WORLD-WIDE</small></span></a>
        <nav class="menu">${PAGES.map(([f, t]) => `<a href="${link(f)}" class="${f === here ? "on" : ""}">${t}</a>`).join("")}</nav></header>`);
    document.body.insertAdjacentHTML("beforeend", `<footer class="bottom">&copy; ${new Date().getFullYear()} Celestial Church of Christ World-wide ·
        <a href="${link("privacy.html")}">Privacy notice (NDPA)</a></footer>`);
}
document.addEventListener("DOMContentLoaded", chrome);

// Firestore REST: decode a typed value.
function dec(v) {
    if ("stringValue" in v) return v.stringValue;
    if ("integerValue" in v) return Number(v.integerValue);
    if ("doubleValue" in v) return v.doubleValue;
    if ("booleanValue" in v) return v.booleanValue;
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
    if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
    return null;
}
// structuredQuery against one public collection.
async function query(collection, { where = [], order, dir = "ASCENDING", limit = 30, after } = {}) {
    const sq = { from: [{ collectionId: collection }], limit };
    if (where.length) sq.where = { compositeFilter: { op: "AND", filters: where.map(([f, op, v]) => ({ fieldFilter: { field: { fieldPath: f }, op, value: { stringValue: v } } })) } };
    if (order) sq.orderBy = [{ field: { fieldPath: order }, direction: dir }];
    if (after !== undefined) sq.startAt = { values: [{ stringValue: after }], before: false };
    const r = await fetch(API.replace(/\/documents$/, "/documents:runQuery"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ structuredQuery: sq }) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return (await r.json()).filter(x => x.document).map(x => ({ id: x.document.name.split("/").pop(), ...dec({ mapValue: x.document }) }));
}
const fmtDate = s => new Date(s + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// ---- page renderers
function eventCard(e) {
    return `<div class="card ev"><h3>${esc(e.title)}</h3><p class="muted">${esc(fmtDate(e.date))} · ${esc(e.time)}${e.venue ? " · " + esc(e.venue) : ""}${e.city ? ", " + esc(e.city) : ""}</p>${e.notes ? `<p>${esc(e.notes)}</p>` : ""}</div>`;
}
async function renderEvents(el, n = 30) {
    try {
        const list = await query("publicEvents", { where: [["date", "GREATER_THAN_OR_EQUAL", todayStr()]], order: "date", limit: n });
        el.innerHTML = list.map(eventCard).join("") || `<p class="empty">No upcoming events published yet.</p>`;
    } catch { el.innerHTML = `<p class="empty">Events could not be loaded. Please try again later.</p>`; }
}
async function renderSermons(el) {
    try {
        const list = await query("publicSermons", { order: "date", dir: "DESCENDING", limit: 50 });
        el.innerHTML = list.map(s => `<div class="card sermon"><h3>${esc(s.title)}</h3><p class="muted">${esc(s.preacher)} · ${esc(fmtDate(s.date))}${s.parishName ? " · " + esc(s.parishName) : ""}</p>
            ${s.scripture ? `<p><b>${esc(s.scripture)}</b></p>` : ""}${s.summary ? `<p>${esc(s.summary)}${s.summary.length >= 300 ? "…" : ""}</p>` : ""}
            ${/^https:\/\//.test(s.mediaUrl || "") ? `<a class="btn" href="${esc(s.mediaUrl)}" target="_blank" rel="noopener">▶ Watch / listen</a>` : ""}</div>`).join("")
            || `<p class="empty">No sermons published yet.</p>`;
    } catch { el.innerHTML = `<p class="empty">Sermons could not be loaded. Please try again later.</p>`; }
}
function parishCard(p) {
    const map = /^https:\/\//.test(p.mapsUrl || "") ? `<a class="btn alt" href="${esc(p.mapsUrl)}" target="_blank" rel="noopener">📍 Map</a>` : "";
    const sun = (p.services || []).find(s => s.day === "Sun");
    return `<div class="card parish"><h3>${esc(p.name)}</h3><p class="muted">${esc([p.city, p.country].filter(Boolean).join(", "))}</p>
        ${sun ? `<p>Sunday Service ${esc(sun.time)}</p>` : ""}<details><summary>All service times</summary><table>${(p.services || []).map(s => `<tr><td>${esc(s.day)}</td><td class="t">${esc(s.time)}</td><td>${esc(s.name)}</td></tr>`).join("")}</table></details>${map}</div>`;
}
// Find a parish: prefix search on name, city or country (three small indexed queries, merged). Paged, never "load all".
let pState = { after: undefined };
async function findParishes(q, more) {
    const el = document.getElementById("results"), btn = document.getElementById("more");
    q = q.trim().toLowerCase();
    try {
        let list;
        if (!q) {
            if (!more) { pState.after = undefined; el.innerHTML = ""; }
            list = await query("publicParishes", { order: "nameLower", limit: 20, after: pState.after });
            if (list.length) pState.after = list[list.length - 1].nameLower;
            btn.hidden = list.length < 20;
        } else {
            const by = f => query("publicParishes", { where: [[f, "GREATER_THAN_OR_EQUAL", q], [f, "LESS_THAN", q + ""]], order: f, limit: 30 });
            const seen = new Map();
            for (const p of (await Promise.all(["nameLower", "cityLower", "countryLower"].map(by))).flat()) seen.set(p.id, p);
            list = [...seen.values()].sort((a, b) => a.nameLower.localeCompare(b.nameLower));
            el.innerHTML = ""; btn.hidden = true;
        }
        el.insertAdjacentHTML("beforeend", list.map(parishCard).join(""));
        if (!el.innerHTML) el.innerHTML = `<p class="empty">No parish found${q ? ` for “${esc(q)}”` : ""}.</p>`;
    } catch { el.innerHTML = `<p class="empty">The parish list could not be loaded. Please try again later.</p>`; }
}
function renderServices(el) {
    el.innerHTML = `<table>${SERVICES.map(([d, t, n]) => `<tr><td>${esc(d)}</td><td class="t">${esc(t || "-")}</td><td>${esc(n)}</td></tr>`).join("")}</table>`;
}
function renderContact(el) {
    el.innerHTML = SITE.contactEmail ? `<a class="btn" href="mailto:${esc(SITE.contactEmail)}">✉ ${esc(SITE.contactEmail)}</a>`
        : `<p class="muted">The headquarters contact address will be published here soon. Meanwhile, please visit or call your nearest parish.</p>`;
}
