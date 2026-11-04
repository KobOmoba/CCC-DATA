// CELESTIAL CHURCH OF CHRIST - Parish Portal (Firebase Auth + Firestore)

// ============================================================================
// Firebase web config for project ccc-data-aarinat (public by design; data is protected by Firestore rules).
// ============================================================================
const firebaseConfig = {
    apiKey: "AIzaSyDtu61cYVY_IZG6-AyXpSOAwW2QZxkBoaU",
    authDomain: "ccc-data-aarinat.firebaseapp.com",
    projectId: "ccc-data-aarinat",
    storageBucket: "ccc-data-aarinat.firebasestorage.app",
    messagingSenderId: "762074026179",
    appId: "1:762074026179:web:3ce45d236531e5f1fe9276"
};
const CONFIG_IS_PLACEHOLDER = firebaseConfig.apiKey.startsWith("PLACEHOLDER");
// Test mode: open the app with ?emulator=1 to use the local Auth + Firestore emulators
// under a demo project id, so nothing can ever reach the live project.
const USE_EMULATOR = new URLSearchParams(location.search).has("emulator");
const PAGE_SIZE = 20;

// The 28 ranks of the male leadership line (client brief, batch 1).
const RANKS = ["Brother", "Elder Brother", "Cape Elder Brother", "Full Elder Brother", "Senior Elder Brother",
    "Superior Senior Elder Brother", "Assistant Leader", "Leader", "Senior Leader", "Superior Senior Leader",
    "Honorary Assistant Evangelist", "Assistant Evangelist", "Honorary Evangelist", "Evangelist",
    "Honorary Senior Evangelist", "Senior Evangelist", "Special Most Senior Evangelist", "Most Senior Evangelist",
    "Special Venerable Most Senior Evangelist", "Venerable Most Senior Evangelist", "Assistant Superior Evangelist",
    "Superior Evangelist", "Assistant Venerable Superior Evangelist", "Venerable Superior Evangelist",
    "Assistant Most Superior Evangelist", "Most Superior Evangelist", "Supreme Evangelist", "Pastor Reverend"];
// The female line (batch 8, confirmed by the founder). "Lace Elder Sister / Lace Senior Elder Sister" is ONE rank
// (the name differs by region). firestore.rules holds the same two lists.
const RANKS_F = ["Sister", "Elder Sister", "Cape Elder Sister", "Senior Elder Sister", "Lace Elder Sister / Lace Senior Elder Sister",
    "Superior Senior Elder Sister", "Lace Superior Senior Elder Sister", "Assistant Mother Celestial", "Mother Celestial"];
const ranksFor = g => g === "Male" ? RANKS : g === "Female" ? RANKS_F : [];
// Rank dropdown shows only the line for the chosen gender.
function fillRanks(selected) {
    const list = ranksFor($("p_gender").value);
    $("p_rank").innerHTML = `<option value="">${list.length ? "No rank / not listed" : "Choose gender first"}</option>` +
        list.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join("");
    $("p_rank").value = list.includes(selected) ? selected : "";
}
// Number = CCC-[PARISH-CITY-]TYPE-NNN (old style has no lettering).
const NO_RE = /^CCC-(?:([A-Z]{2,4})-([A-Z]{2,4})-)?([A-Z]{3})-(\d+)$/;
const letteringOf = (parish = localState.parish || {}) => parish.parishLetters && parish.cityLetters ? `${parish.parishLetters}-${parish.cityLetters}` : "";
function numberFor(tail, n) {
    const l = letteringOf();
    if (!l) throw new Error("Your parish has no lettering yet (e.g. IJY-ABK). Ask the Super Admin to set it before new numbers are issued.");
    return `CCC-${l}-${tail}${pad3(n)}`;
}
const noType = no => (String(no).toUpperCase().match(NO_RE) || [])[3] || "";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const CURRENCIES = ["NGN", "GHS", "XOF", "XAF", "ZAR", "KES", "GBP", "EUR", "USD", "CAD", "AUD", "CHF", "SEK", "NOK", "DKK", "AED", "INR", "CNY", "JPY", "BRL"];
const COUNTRY_DEFAULTS = { nigeria: ["NGN", "Africa"], ghana: ["GHS", "Africa"], "benin": ["XOF", "Africa"], "benin republic": ["XOF", "Africa"], togo: ["XOF", "Africa"],
    "cote d'ivoire": ["XOF", "Africa"], "ivory coast": ["XOF", "Africa"], cameroon: ["XAF", "Africa"], "south africa": ["ZAR", "Africa"], kenya: ["KES", "Africa"],
    "united kingdom": ["GBP", "Europe"], uk: ["GBP", "Europe"], england: ["GBP", "Europe"], ireland: ["EUR", "Europe"], germany: ["EUR", "Europe"], france: ["EUR", "Europe"],
    italy: ["EUR", "Europe"], spain: ["EUR", "Europe"], netherlands: ["EUR", "Europe"], belgium: ["EUR", "Europe"], "united states": ["USD", "North America"],
    usa: ["USD", "North America"], canada: ["CAD", "North America"], australia: ["AUD", "Oceania"] };
const CONTINENTS = ["Africa", "Europe", "Asia", "North America", "South America", "Oceania", "Antarctica"];
// New numbers carry the parish lettering: CCC-IJY-ABK-MBR-001. Old records keep CCC-MBR-001 and still work.
const SERIES = { members: { key: "mbr", prefix: "MBR-", stat: "memberCount" }, clergy: { key: "clg", prefix: "CLG-", stat: "clergyCount" },
    // Phase 4: each has its own counter doc parishes/{p}/meta/{key} = { n }.
    births: { key: "brt", prefix: "BRT-", stat: "birthCount", own: true }, children: { key: "chd", prefix: "CHD-", stat: "childCount", own: true },
    teens: { key: "ten", prefix: "TEN-", stat: "teenCount", own: true }, deaths: { key: "dth", prefix: "DTH-", stat: "deathCount", own: true } };

// Church departments (batch 3). Ids are fixed: the Firestore rules list the same six.
const DEPTS = [
    { id: "parochial", name: "Parochial Committee", icon: "fa-landmark", color: "text-blue-300" },
    { id: "choir", name: "Choir", icon: "fa-music", color: "text-pink-300" },
    { id: "ict", name: "ICT / Media", icon: "fa-photo-film", color: "text-sky-300" },
    { id: "sidemen", name: "Sidemen / Sidewomen", icon: "fa-people-group", color: "text-emerald-300" },
    { id: "prophets", name: "Prophets / Prophetesses", icon: "fa-eye", color: "text-violet-300" },
    { id: "sundayschool", name: "Sunday School", icon: "fa-children", color: "text-amber-300" }];
const deptName = id => (DEPTS.find(d => d.id === id) || {}).name || (localState.units || {})[id] || id;
const ELECTION_WARN_DAYS = 60;

let auth = null;
let db = null;
let localState = { user: null, role: "", currentParishId: "", parish: {} };
let claiming = false;

function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
const $ = id => document.getElementById(id);
const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const inc = n => firebase.firestore.FieldValue.increment(n);
const pad3 = n => String(n).padStart(3, "0");
function closeModal(id) { $(id).classList.add("hidden"); }
function openModal(id) { $(id).classList.remove("hidden"); }

// Disable a button while its async job runs, so a double tap cannot save twice.
async function busy(btnId, fn) {
    const b = $(btnId);
    if (b) b.disabled = true;
    try { return await fn(); } finally { if (b) b.disabled = false; }
}

function fillSelects() {
    const opts = (list, first) => `<option value="">${first}</option>` + list.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("");
    const days = Array.from({ length: 31 }, (_, i) => [i + 1, i + 1]);
    const months = MONTHS.map((m, i) => [i + 1, m]);
    const yr = new Date().getFullYear();
    const years = Array.from({ length: yr - 1899 }, (_, i) => [yr - i, yr - i]);
    document.querySelectorAll(".day-select").forEach(s => s.innerHTML = opts(days, "Day"));
    document.querySelectorAll(".month-select").forEach(s => s.innerHTML = opts(months, "Month"));
    document.querySelectorAll(".year-select").forEach(s => s.innerHTML = opts(years, "Year (optional)"));
    document.querySelectorAll(".continent-select").forEach(s => s.innerHTML = opts(CONTINENTS.map(c => [c, c]), "Continent"));
    document.querySelectorAll(".currency-select").forEach(s => s.innerHTML = opts(CURRENCIES.map(c => [c, c]), "Currency"));
}

function renderDeptNav() {
    $("nav-diaspora").insertAdjacentHTML("beforebegin", DEPTS.map(d =>
        `<button onclick="openDept('${d.id}')" id="nav-dept-${d.id}" class="parish-only nav-btn px-3 py-2.5 rounded hover:bg-slate-800 flex items-center gap-2"><i class="fa-solid ${d.icon} ${d.color} w-4"></i> ${esc(d.name)}</button>`).join(""));
}

window.onload = function() {
    fillSelects();
    renderDeptNav();
    if (CONFIG_IS_PLACEHOLDER || !window.firebase) {
        console.warn("Firebase is not configured yet. Fill in firebaseConfig at the top of app.js.");
        return;
    }
    firebase.initializeApp(USE_EMULATOR ? { ...firebaseConfig, projectId: "demo-ccc" } : firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    if (USE_EMULATOR) {
        auth.useEmulator("http://127.0.0.1:9099", { disableWarnings: true });
        db.useEmulator("127.0.0.1", 8080);
    }
    auth.onAuthStateChanged(onAuthChanged);
};

function requireFirebase() {
    if (!db) { alert("The database is not configured yet (see README.md)."); return false; }
    return true;
}

// ---------------------------------------------------------------- sign-in + invites
function toggleInvite() { $("inviteFields").classList.toggle("hidden"); }

async function attemptLogin() {
    if (!requireFirebase()) return;
    const email = $("loginEmail").value.trim();
    const pass = $("loginPassword").value;
    if (!email || !pass) return alert("Enter your email and password.");
    try {
        await auth.signInWithEmailAndPassword(email, pass);
        $("loginPassword").value = "";
    } catch (e) {
        alert("Sign-in failed. Check your email and password.");
    }
}

// Invited parish admin: create the login, then claim the invite in ONE batch.
// The rules check the invite exists, matches this email, is unused, and the email is not clergy.
async function claimInvite() {
    if (!requireFirebase()) return;
    const email = $("invEmail").value.trim().toLowerCase();
    const code = $("invCode").value.trim();
    const pass = $("invPassword").value;
    if (!email || !code || pass.length < 8) return alert("Enter the invited email, the invite code and a password of at least 8 characters.");
    claiming = true;
    try {
        let cred;
        try { cred = await auth.createUserWithEmailAndPassword(email, pass); }
        catch (e) {
            if (e.code !== "auth/email-already-in-use") throw e;
            cred = await auth.signInWithEmailAndPassword(email, pass);
        }
        const uid = cred.user.uid;
        const inv = await db.collection("invites").doc(code).get();
        if (!inv.exists) throw new Error("Invite code not found for this email.");
        const { parishId, role } = inv.data();
        const batch = db.batch();
        if (role === "church_head") {
            // Church Leader: no parish, no admin email (they may be clergy); the name comes from the Super Admin's assignment.
            const l = await db.collection("leaders").doc(email).get();
            if (!l.exists || l.data().status !== "Active") throw new Error("This leadership role is not active.");
            batch.set(db.collection("users").doc(uid), { role, parishId: "", email, inviteCode: code, name: l.data().name });
            batch.update(db.collection("invites").doc(code), { usedBy: uid });
            await batch.commit();
            $("invPassword").value = ""; claiming = false;
            return await onAuthChanged(cred.user);
        }
        batch.set(db.collection("users").doc(uid), { role: "parish_admin", parishId, email, inviteCode: code });
        batch.update(db.collection("invites").doc(code), { usedBy: uid });
        batch.set(db.collection("adminEmails").doc(email), { uid });
        await batch.commit();
        $("invPassword").value = "";
        claiming = false;
        await onAuthChanged(cred.user);
    } catch (e) {
        claiming = false;
        alert("Could not activate: " + (e.code === "permission-denied" ? "the invite is not valid for this email, was already used, or the email belongs to clergy." : e.message));
        if (auth.currentUser) auth.signOut();
    }
}

// The browser only decides what to SHOW. Access is enforced by firestore/firestore.rules.
async function onAuthChanged(user) {
    if (!user || claiming) return;
    try {
        const prof = await db.collection("users").doc(user.uid).get();
        if (!prof.exists) {
            alert("This account has no parish yet. If you have an invite code, use 'First time? I have an invite code'.");
            return auth.signOut();
        }
        const { role, parishId, name } = prof.data();
        if (role === "revoked") {
            alert("Your admin access for this parish has been handed over to a new admin. Contact the Super Admin if this is wrong.");
            return auth.signOut();
        }
        localState = { user, role, currentParishId: parishId || "", parish: {}, name: name || "" };
        const isParish = role === "parish_admin";
        document.querySelectorAll(".parish-only").forEach(el => el.classList.toggle("hidden", !isParish));
        document.querySelectorAll(".super-only").forEach(el => el.classList.toggle("hidden", role !== "super_admin"));
        document.querySelectorAll(".leader-only").forEach(el => el.classList.toggle("hidden", !(role === "super_admin" || role === "church_head")));
        if (role === "super_admin" || role === "hq") $("circularComposer").classList.remove("hidden");
        if (isParish && !localState.currentParishId) {
            alert("Your account is not linked to a parish.");
            return auth.signOut();
        }
        $("landingPage").classList.add("hidden");
        $("mainApp").classList.remove("hidden");
        showSection("dashboard");
        if (isParish) await loadParishData();
        else await loadWorld();
        if (role === "church_head") await loadLeadership();
        await loadCirculars();
    } catch (e) {
        alert("Access denied: your parish may be suspended.\n" + e.message);
        auth.signOut();
    }
}

function showSection(id) {
    document.querySelectorAll("main > div > section").forEach(sec => sec.classList.add("hidden"));
    $(`section-${id}`).classList.remove("hidden");
    document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("bg-slate-800"));
    $(`nav-${id}`)?.classList.add("bg-slate-800");
    if (id === "families") loadFamilies();
    if (id === "diaspora") loadDiaspora();
    if (id === "flows") loadFlows();
    if (YOUNG[id] || id === "deaths") loadYoung(id, true).catch(e => alert("Could not load: " + e.message));
    if (id === "returns") openReturns().catch(e => alert("Could not load returns: " + e.message));
    if (id === "hqreturns") openHq().catch(e => alert("Could not load returns: " + e.message));
    if (id === "directory") loadDirectory().catch(e => alert("Could not load the directory: " + e.message));
    if (id === "staff") openStaff().catch(e => alert("Could not load staff: " + e.message));
    if (id === "ai") openAiDashboard().catch(e => alert("Could not load the AI dashboard: " + e.message));
    if (id === "postings") openPostings().catch(e => alert("Could not load postings: " + e.message));
    if (id === "committees") openCommittees().catch(e => alert("Could not load committees: " + e.message));
    if (id === "sermons") openSermons().catch(e => alert("Could not load sermons: " + e.message));
    if (id === "pcommittees") openPCommittees().catch(e => alert("Could not load committees: " + e.message)); // Batch 15
    if (id === "harvests") openHarvests().catch(e => alert("Could not load harvests: " + e.message));
    if (id === "harvestsAll") openHarvestsAll().catch(e => alert("Could not load harvest dates: " + e.message));
    if (id === "calendar") openCalendar().catch(e => alert("Could not load the calendar: " + e.message));
    if (id === "messages") openMessages().catch(e => alert("Could not load messages: " + e.message));
    if (id === "parishes" && localState.role === "super_admin") completeClaimedHandovers().catch(e => console.error("handovers", e.message));
    if (id === "settings" && localState.role === "parish_admin") openTimetable();
    if (id === "attendance") openAttendance().catch(e => alert("Could not load attendance: " + e.message));
}

const parishRef = () => db.collection("parishes").doc(localState.currentParishId);
const statsRef = () => db.collection("parishStats").doc(localState.currentParishId);
const counterRef = () => parishRef().collection("meta").doc("counters");

// ---------------------------------------------------------------- branding
// Church name and logo are fixed app-wide (CELESTIAL CHURCH OF CHRIST, assets/ccc-logo.png). Old parish logo data is ignored.
function showBranding(p) {
    $("dashParishName").textContent = p.name || "";
}

// ---------------------------------------------------------------- parish data
const pages = { members: null, clergy: null, former: null, attendance: null, finances: null };

async function loadParishData() {
    if (!db || !localState.currentParishId) return;
    const pDoc = await parishRef().get();
    localState.parish = pDoc.exists ? pDoc.data() : {};
    showBranding(localState.parish);
    fillSettingsForm(localState.parish);
    $("welcomeTitle").textContent = "Halleluyah 🙌, " + (localState.parish.name || "Parish") + "!";
    const st = await statsRef().get().catch(() => null);
    showTotals(st && st.exists ? st.data() : {});
    $("memberSearch").value = "";
    const tt = await parishRef().collection("settings").doc("timetable").get().catch(() => null);
    setTimetable(tt && tt.exists ? tt.data().services : null);
    await Promise.all([loadMembers(true), loadClergy(true), loadFormer(true), loadAttendance(true), loadFinances(true), loadDepartments()]);
    renderWeekCard().catch(e => console.error("week card", e.message)); // Phase 9
    renderCelebCard().catch(e => console.error("celebrations card", e.message)); // Batch 15
    renderJoinCard().catch(e => console.error("join card", e.message)); // Phase 9b
    await checkPendingMoves().catch(e => console.error("pending moves", e.message));
    // Phase 8: record activity for the "no activity for 30 days" alert, and apply any clergy posting now due.
    await markParishActive().catch(e => console.error("activity", e.message));
    const moved = await applyDuePostings().catch(e => { console.error("postings", e.message); return 0; });
    if (moved) await Promise.all([loadClergy(true), loadFormer(true), refreshTotals()]);
    // Phase 7: keep this parish's directory entries (Super Admin's church-wide directory) present and current.
    localState.dirSync = syncDirectory().catch(e => console.error("directory sync", e.message));
}

function showTotals(s) {
    const m = s.memberCount || 0, c = s.clergyCount || 0;
    $("metricTotal").textContent = m + c;
    $("metricClergy").textContent = c;
    $("metricMembers").textContent = m;
    $("metricServices").textContent = s.serviceCount || 0;
    $("metricGiving").textContent = "₦" + Number(s.financeTotal || 0).toLocaleString();
    $("metricBirths").textContent = s.birthCount || 0;
    $("metricChildren").textContent = s.childCount || 0;
    $("metricTeens").textContent = s.teenCount || 0;
    $("metricDeaths").textContent = s.deathCount || 0;
}

const STATUS_TAG = { Former: " · Former", Ordained: " · Ordained", Diaspora: " · Abroad", TransferredOut: " · Transferred", "Called to glory": " · Called to glory" };
function displayNo(p) { return p.memberNo + (STATUS_TAG[p.status] || ""); }
// A transferred member keeps ONE member number for life: shown on every card in the new parish.
const lifeText = p => p.lifeNo ? `Life no. ${p.lifeNo} (${p.lifeParishCode})` : "";

function personCard(kind, d) {
    const p = d.data ? d.data() : d;
    const photo = p.photo ? `<img src="${esc(p.photo)}" alt="" class="w-10 h-12 object-cover rounded">` : `<div class="w-10 h-12 rounded bg-gray-200 flex items-center justify-center text-gray-400"><i class="fa-solid fa-user"></i></div>`;
    return `<button data-no="${esc(p.memberNo)}" onclick="openRecord('${kind}','${esc(p.memberNo)}')" class="person-row w-full bg-white border rounded-xl p-2 flex items-center gap-3 text-left shadow-sm">
        ${photo}
        <div class="min-w-0 flex-1"><p class="font-bold truncate">${esc(p.fullName)}${p.important ? ' <i class="fa-solid fa-star text-amber-400"></i>' : ""}</p>
        <p class="text-[11px] text-gray-500 font-mono">${esc(displayNo(p))}</p>${p.lifeNo ? `<p class="text-[11px] text-indigo-700 font-mono font-bold">${esc(lifeText(p))}</p>` : ""}
        <p class="text-[11px] text-gray-500 truncate">${esc([p.rank, p.phone].filter(Boolean).join(" · "))}</p></div></button>`;
}

async function loadPage(key, q, listId, rowFn, reset) {
    if (reset) { pages[key] = null; $(listId).innerHTML = ""; }
    if (pages[key]) q = q.startAfter(pages[key]);
    const snap = await q.limit(PAGE_SIZE).get();
    if (snap.docs.length) pages[key] = snap.docs[snap.docs.length - 1];
    $(listId).insertAdjacentHTML("beforeend", snap.docs.map(rowFn).join("") || (reset ? `<p class="text-xs text-gray-400 italic">Nothing here yet.</p>` : ""));
    $("more-" + key).classList.toggle("hidden", snap.docs.length < PAGE_SIZE);
}

// Members list: filter = digits -> phone prefix, otherwise name prefix.
function memberQuery() {
    const term = $("memberSearch").value.trim();
    const col = parishRef().collection("members");
    const digits = term.replace(/\D/g, "");
    if (term && digits && digits.length === term.replace(/[\s+()-]/g, "").length) return col.orderBy("phoneDigits").startAt(digits).endAt(digits + "");
    if (term) { const t = term.toLowerCase(); return col.orderBy("nameLower").startAt(t).endAt(t + ""); }
    return col.where("status", "==", "Active").orderBy(firebase.firestore.FieldPath.documentId());
}
let searchTimer = null;
function searchMembers() { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadMembers(true), 300); }
const loadMembers = reset => loadPage("members", memberQuery(), "membersTable", d => personCard("members", d), reset);
const clergyQuery = status => parishRef().collection("clergy").where("status", "==", status).orderBy(firebase.firestore.FieldPath.documentId());
const loadClergy = reset => loadPage("clergy", clergyQuery("Active"), "clergyTable", d => personCard("clergy", d), reset);
const loadFormer = reset => loadPage("former", clergyQuery("Former"), "formerTable", d => personCard("clergy", d), reset);

function loadAttendance(reset) {
    return loadPage("attendance", parishRef().collection("attendance").orderBy("serviceDate", "desc"), "attendanceTable", d => {
        const a = d.data();
        return `<tr><td class="p-3 font-mono">${esc(a.serviceDate)}</td><td class="p-3 font-bold">${esc(a.serviceType)}</td><td class="p-3">${esc(a.headcount)} attendees</td></tr>`;
    }, reset);
}
function loadFinances(reset) {
    return loadPage("finances", parishRef().collection("finances").orderBy("transactionDate", "desc"), "financeTable", d => {
        const f = d.data();
        return `<tr><td class="p-3 font-mono">${esc(f.transactionDate)}</td><td class="p-3 font-bold">${esc(f.contributorName)}</td><td class="p-3">${esc(f.contributionType)}</td><td class="p-3 font-bold text-emerald-600">₦${esc(f.amount)}</td></tr>`;
    }, reset);
}

async function loadCirculars() {
    const circs = await db.collection("circulars").orderBy("createdAt", "desc").limit(PAGE_SIZE).get();
    $("circularsList").innerHTML = circs.empty ? `<p class="text-xs text-gray-400 italic">No circulars yet.</p>` :
        circs.docs.map(d => {
            const c = d.data();
            return `<div class="bg-indigo-50 border-l-4 border-indigo-600 p-4 rounded shadow-sm">
                <p class="text-[10px] font-bold text-indigo-950 uppercase tracking-widest">${esc(new Date(c.createdAt).toLocaleString())}</p>
                <p class="text-xs text-indigo-900 mt-1.5 font-medium leading-relaxed">${esc(c.body)}</p></div>`;
        }).join("");
}

// ---------------------------------------------------------------- global search
// Name prefix, phone prefix, or exact number, across members AND clergy of this parish.
let gTimer = null;
function globalSearch() { clearTimeout(gTimer); gTimer = setTimeout(runGlobalSearch, 300); }
async function runGlobalSearch() {
    const term = $("globalSearch").value.trim();
    const box = $("globalResults");
    if (!term) { box.classList.add("hidden"); return; }
    const kinds = ["members", "clergy"];
    let results = [];
    const numberMatch = ["MBR", "CLG"].includes(noType(term)) && normNo(term);
    if (numberMatch) {
        const kind = noType(term) === "MBR" ? "members" : "clergy";
        const d = await parishRef().collection(kind).doc(numberMatch).get();
        if (d.exists) results.push([kind, d]);
    } else {
        const digits = term.replace(/\D/g, "");
        const isPhone = digits && digits.length === term.replace(/[\s+()-]/g, "").length;
        const field = isPhone ? "phoneDigits" : "nameLower";
        const t = isPhone ? digits : term.toLowerCase();
        const snaps = await Promise.all(kinds.map(k => parishRef().collection(k).orderBy(field).startAt(t).endAt(t + "").limit(10).get()));
        snaps.forEach((s, i) => s.docs.forEach(d => results.push([kinds[i], d])));
    }
    box.innerHTML = results.length ? results.map(([k, d]) => personCard(k, d)).join("") : `<p class="p-3 text-gray-400 italic">No match.</p>`;
    box.classList.remove("hidden");
}
document.addEventListener("click", e => { if (!e.target.closest("#globalSearchBox")) $("globalResults")?.classList.add("hidden"); });

// ---------------------------------------------------------------- photos (no Firebase Storage: compress into Firestore)
// Shrinks an image in the browser to a JPEG data URL under maxBytes (passport photo ~60KB).
function compressImage(file, maxBytes = 60000, maxDim = 480) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let dim = maxDim, q = 0.85, out = "";
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            for (let i = 0; i < 12; i++) {
                const scale = Math.min(1, dim / Math.max(img.width, img.height));
                canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
                ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                out = canvas.toDataURL("image/jpeg", q);
                if ((out.length - 23) * 0.75 <= maxBytes) break;
                if (q > 0.5) q -= 0.1; else dim = Math.round(dim * 0.8);
            }
            URL.revokeObjectURL(img.src);
            resolve(out);
        };
        img.onerror = () => reject(new Error("That file is not an image."));
        img.src = URL.createObjectURL(file);
    });
}

// ---------------------------------------------------------------- person form
let form = { kind: "members", editingId: null, photo: "", old: null };
const val = id => $(id).value.trim();
const intOrNull = id => $(id).value ? Number($(id).value) : null;

async function pickPhoto(input) {
    if (!input.files[0]) return;
    try {
        form.photo = await compressImage(input.files[0]);
        $("p_photoPreview").src = form.photo; $("p_photoPreview").classList.remove("hidden");
    } catch (e) { alert(e.message); }
}

function openPersonForm(kind, existing) {
    form = { kind, editingId: existing ? existing.memberNo : null, photo: existing?.photo || "", old: existing || null };
    const p = existing || {};
    const set = (id, v) => $(id).value = v ?? "";
    set("p_name", p.fullName); set("p_gender", p.gender); set("p_marital", p.maritalStatus); set("p_address", p.address);
    set("p_phone", p.phone); set("p_email", p.email); fillRanks(p.rank); set("p_occupation", p.occupation);
    set("p_dobDay", p.dobDay); set("p_dobMonth", p.dobMonth); set("p_dobYear", p.dobYear);
    set("p_wedDay", p.weddingDay); set("p_wedMonth", p.weddingMonth);
    set("p_anDay", p.anointDay); set("p_anMonth", p.anointMonth); set("p_anYear", p.anointYear);
    set("p_nokName", p.nokName); set("p_nokAddress", p.nokAddress); set("p_nokPhone", p.nokPhone);
    set("p_joined", p.joinedDate || (kind === "clergy" ? today() : ""));
    $("p_photo").value = "";
    $("p_important").checked = !!p.important;
    $("p_consent").checked = p.consentGiven === true;
    $("p_photoPreview").classList.toggle("hidden", !form.photo);
    if (form.photo) $("p_photoPreview").src = form.photo;
    $("p_emailReq").classList.toggle("hidden", kind !== "clergy");
    $("p_joinedWrap").classList.toggle("hidden", kind !== "clergy");
    $("personModalTitle").textContent = (existing ? "EDIT " + existing.memberNo : kind === "clergy" ? "ADD CLERGY" : "ADD CHURCH MEMBER");
    closeModal("recordModal");
    openModal("personModal");
}

function readPersonForm() {
    const p = {
        fullName: val("p_name"), gender: val("p_gender"), maritalStatus: val("p_marital"), address: val("p_address"),
        phone: val("p_phone"), email: val("p_email").toLowerCase(), rank: val("p_rank"), occupation: val("p_occupation"),
        dobDay: intOrNull("p_dobDay"), dobMonth: intOrNull("p_dobMonth"), dobYear: intOrNull("p_dobYear"),
        weddingDay: intOrNull("p_wedDay"), weddingMonth: intOrNull("p_wedMonth"),
        anointDay: intOrNull("p_anDay"), anointMonth: intOrNull("p_anMonth"), anointYear: intOrNull("p_anYear"),
        nokName: val("p_nokName"), nokAddress: val("p_nokAddress"), nokPhone: val("p_nokPhone"),
        photo: form.photo || "", important: $("p_important").checked, consentGiven: $("p_consent").checked,
        updatedAt: nowIso()
    };
    p.nameLower = p.fullName.toLowerCase();
    p.phoneDigits = p.phone.replace(/\D/g, "");
    if (form.kind === "clergy") p.joinedDate = val("p_joined");
    return p;
}

function checkPerson(p, kind) {
    if (!p.fullName || !p.gender || !p.maritalStatus || !p.dobDay || !p.dobMonth) return "Fill in name, gender, marital status and date of birth (day + month).";
    if (kind === "clergy" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) return "Clergy need an email (it is how the app makes sure clergy are never app admins).";
    if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) return "That email does not look right.";
    if (!p.consentGiven) return "You must record consent before saving (NDPA 2023).";
    return "";
}

// New record: next number from the parish counter, inside a transaction (never reused).
async function createRecord(kind, p, extraWrites) {
    const s = SERIES[kind];
    const cRef = s.own ? parishRef().collection("meta").doc(s.key) : counterRef();
    return db.runTransaction(async t => {
        const c = await t.get(cRef);
        const n = (c.exists ? c.data()[s.own ? "n" : s.key] : 0) + 1;
        const id = numberFor(s.prefix, n);
        if (s.own) t.set(cRef, { n }); else t.update(cRef, { [s.key]: n });
        t.set(parishRef().collection(kind).doc(id), s.own ? { ...p, no: id } : { ...p, memberNo: id });
        if (kind === "clergy") t.set(db.collection("clergyIndex").doc(p.email), { parishId: localState.currentParishId, clergyId: id });
        if (kind === "members") t.set(dirRef(localState.currentParishId, id), { ...dirProfile({ ...p, memberNo: id }), updatedAt: nowIso() }, { merge: true });
        t.set(statsRef(), { [s.stat]: inc(1) }, { merge: true });
        if (extraWrites) extraWrites(t, id);
        return id;
    });
}

async function savePerson() {
    if (!requireFirebase()) return;
    const p = readPersonForm();
    const problem = checkPerson(p, form.kind);
    if (problem) return alert(problem);
    await busy("savePersonBtn", async () => {
        try {
            if (form.editingId) {
                const o = form.old;
                const merged = { ...o, ...p, memberNo: o.memberNo, consentDate: o.consentDate, createdAt: o.createdAt, status: o.status };
                const batch = db.batch();
                batch.set(parishRef().collection(form.kind).doc(o.memberNo), merged);
                if (form.kind === "clergy") batch.set(db.collection("clergyIndex").doc(p.email), { parishId: localState.currentParishId, clergyId: o.memberNo });
                if (form.kind === "members") batch.set(dirRef(localState.currentParishId, o.memberNo), { ...dirProfile(merged), updatedAt: nowIso() }, { merge: true });
                await batch.commit();
            } else {
                p.status = "Active"; p.consentDate = today(); p.createdAt = nowIso();
                if (form.kind === "clergy") p.serviceRecord = p.rank ? [{ rank: p.rank, from: p.joinedDate || today() }] : [];
                const vid = form.visitorId, pend = form.pendingId;
                if (pend) {   // Phase 9b: approving a self-registration creates the real numbered member + marks it Approved, atomically
                    form.pendingId = null;
                    await createRecord(form.kind, p, (t, id) => t.update(parishRef().collection("pendingMembers").doc(pend), { status: "Approved", memberNo: id, decidedAt: nowIso(), decidedBy: localState.user.uid }));
                    closeModal("personModal"); await loadParishData(); return;
                }
                // A visitor made member: the visitor is marked Member in the same transaction.
                await createRecord(form.kind, p, vid ? (t, id) => t.update(parishRef().collection("visitors").doc(vid), { status: "Member", memberNo: id, updatedAt: nowIso() }) : null);
                if (vid) { form.visitorId = null; closeModal("personModal"); await loadVisitors(); return; }
            }
            closeModal("personModal");
            await loadParishData();
        } catch (e) {
            console.error("savePerson", e.code, e.message);
            alert(e.code === "permission-denied" && form.kind === "clergy"
                ? "Not saved. If this email belongs to an app admin, it cannot be used for clergy (clergy cannot be admins)."
                : `Not saved: ${e.message}`);
        }
    });
}

// ---------------------------------------------------------------- record view
let current = { kind: "", rec: null };
function fmtDate(d, m, y) { return d && m ? `${d} ${MONTHS[m - 1]}${y ? " " + y : ""}` : "—"; }
const row = (k, v) => v ? `<div class="flex justify-between gap-3 border-b py-1"><span class="text-gray-500">${esc(k)}</span><span class="font-semibold text-right">${v}</span></div>` : "";

async function openRecord(kind, id) {
    $("globalResults").classList.add("hidden");
    const d = await parishRef().collection(kind).doc(id).get();
    if (!d.exists) return;
    const p = d.data();
    current = { kind, rec: p };
    $("recordTitle").textContent = displayNo(p);
    const fam = await parishRef().collection("families").where("memberNos", "array-contains", p.memberNo).limit(5).get();
    const famHtml = fam.docs.map(f => `<button onclick="showFamily('${esc(f.id)}')" class="text-pink-700 underline">${esc(f.data().name)}</button> (${esc(f.data().roles?.[p.memberNo] || "")})`).join(", ");
    let history = "";
    if (p.formerMemberNo) history = `Ordained from <button onclick="openRecord('members','${esc(p.formerMemberNo)}')" class="underline text-blue-700">${esc(p.formerMemberNo)}</button>`;
    if (p.fromNo) history = `Moved up from Teenagers: <button onclick="openYoungRecord('teens','${esc(p.fromNo)}')" class="underline text-blue-700">${esc(p.fromNo)}</button>`;
    if (p.deathId) history = `Called to glory: <button onclick="openYoungRecord('deaths','${esc(p.deathId)}')" class="underline text-blue-700">${esc(p.deathId)}</button>`;
    if (p.ordainedAs) history = `Ordained as clergy: <button onclick="openRecord('clergy','${esc(p.ordainedAs)}')" class="underline text-blue-700">${esc(p.ordainedAs)}</button>`;
    let depts = [];
    if (kind === "members") {
        const ds = await parishRef().collection("deptMembers").where("memberNo", "==", p.memberNo).where("status", "==", "Current").get();
        depts = ds.docs.map(x => deptName(x.data().dept) + (x.data().role ? ` (${x.data().role})` : ""));
    }
    let service = "";
    if (kind === "clergy") {
        const ranks = (p.serviceRecord || []).map(r => `<li>${esc(r.rank)}: ${esc(r.from || "?")} → ${esc(r.to || "present")}</li>`).join("");
        service = `<div class="bg-amber-50 border border-amber-200 rounded p-2 space-y-1"><p class="font-bold">Service record</p>
            ${row("Joined", esc(p.joinedDate || ""))}${row("Left", esc(p.leftDate || ""))}${row("Reason", esc(p.leaveReason || ""))}${row("Transferred to", esc(p.transferredTo || ""))}
            ${ranks ? `<ul class="list-disc pl-5">${ranks}</ul>` : ""}
            ${p.letterId ? `<button onclick="showLetter('${esc(p.letterId)}')" class="underline text-amber-800">View transfer letter</button><img id="letterImg" alt="Transfer letter" class="hidden w-full mt-2 border rounded">` : ""}</div>`;
    }
    $("recordBody").innerHTML = `
        <div class="flex gap-3 items-center">${p.photo ? `<img src="${esc(p.photo)}" alt="Photo" class="w-24 h-28 object-cover rounded border">` : ""}
        <div><p class="text-base font-bold">${esc(p.fullName)}</p><p class="font-mono text-gray-500">${esc(displayNo(p))}</p><p>${esc(p.rank || "")}</p></div></div>
        <div>${row("Gender", esc(p.gender))}${row("Marital status", esc(p.maritalStatus))}${row("Phone", esc(p.phone))}${row("Email", esc(p.email))}
        ${row("Address", esc(p.address))}${row("Occupation", esc(p.occupation))}${row("Date of birth", esc(fmtDate(p.dobDay, p.dobMonth, p.dobYear)))}
        ${row("Last anointment", esc(fmtDate(p.anointDay, p.anointMonth, p.anointYear)))}
        ${row("Next of kin", esc([p.nokName, p.nokPhone, p.nokAddress].filter(Boolean).join(" · ")))}
        ${row("Family", famHtml)}${row("History", history)}${row("Life-long number", esc(lifeText(p)))}
        ${row("Departments", esc(depts.join(", ")))}
        ${p.status === "Diaspora" ? row("Abroad", esc([p.abroadCity, p.abroadCountry].filter(Boolean).join(", ") + (p.abroadParish ? " · " + p.abroadParish : "") + " · since " + p.abroadSince)) : ""}</div>${service}`;
    const btn = (label, fn, cls) => `<button onclick="${fn}" class="px-3 py-2 rounded font-semibold ${cls}">${label}</button>`;
    let actions = "";
    if (p.status === "Active") actions += btn("Edit", "editCurrent()", "bg-blue-600 text-white");
    if (kind === "members" && p.status === "Active") actions += btn("Ordain as clergy", "ordainCurrent()", "bg-amber-600 text-white");
    if (kind === "clergy" && p.status === "Active") actions += btn("Transfer / move to Former", "openTransfer()", "bg-amber-700 text-white");
    if (kind === "members" && p.status === "Active") actions += btn("Moved abroad", "openAbroad()", "bg-cyan-700 text-white");
    if (kind === "members" && p.status === "Diaspora") actions += btn("Returned home", "returnHome()", "bg-emerald-600 text-white");
    if (kind === "members" && ["Active", "Diaspora"].includes(p.status)) actions += btn('<i class="fa-solid fa-envelope-open-text"></i> Letter of introduction', "openLetterForm()", "bg-blue-900 text-white");
    if (kind === "members" && ["Active", "Diaspora"].includes(p.status)) actions += btn("Transfer to another parish", "openSendTransfer()", "bg-indigo-700 text-white");
    if ((kind === "members" && ["Active", "Diaspora"].includes(p.status)) || (kind === "clergy" && p.status === "Active"))
        actions += btn("Called to glory", `openDeathForm('${kind}')`, "bg-gray-800 text-white");
    $("recordActions").innerHTML = actions + btn("Close", "closeModal('recordModal')", "border");
    openModal("recordModal");
}
function editCurrent() { openPersonForm(current.kind, current.rec); }
async function showLetter(id) {
    const l = await parishRef().collection("letters").doc(id).get();
    if (l.exists) { $("letterImg").src = l.data().image; $("letterImg").classList.remove("hidden"); }
}

// Ordination: new CCC-CLG number; the CCC-MBR number is retired (never reused) and linked both ways.
async function ordainCurrent() {
    const m = current.rec;
    const email = (prompt("Clergy need an email (it keeps clergy out of app admin). Email for " + m.fullName + ":", m.email || "") || "").trim().toLowerCase();
    if (!email) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return alert("That email does not look right.");
    const { ordainedAs, status, ...person } = m;
    const c = { ...person, email, status: "Active", formerMemberNo: m.memberNo, joinedDate: today(),
        serviceRecord: m.rank ? [{ rank: m.rank, from: today() }] : [], createdAt: nowIso(), updatedAt: nowIso(), consentDate: m.consentDate };
    try {
        const current = await currentDeptDocs(m.memberNo);
        const id = await createRecord("clergy", c, (t, newId) => {
            current.forEach(d => t.update(d.ref, { status: "Former", leftDate: today(), updatedAt: nowIso() })); // clergy cannot stay in a department
            t.update(parishRef().collection("members").doc(m.memberNo), { status: "Ordained", ordainedAs: newId, updatedAt: nowIso() });
            t.set(statsRef(), { memberCount: inc(-1) }, { merge: true });
        });
        await loadParishData();
        await openRecord("clergy", id);
    } catch (e) {
        alert(e.code === "permission-denied" ? "Not ordained. If this email belongs to an app admin it cannot be used (clergy cannot be admins)." : e.message);
    }
}

function openTransfer() {
    $("t_reason").value = "Transfer"; $("t_date").value = today(); $("t_to").value = ""; $("t_letter").value = "";
    closeModal("recordModal");
    openModal("transferModal");
}
async function saveTransfer() {
    const c = current.rec;
    const leftDate = $("t_date").value, reason = $("t_reason").value, to = val("t_to");
    if (!leftDate) return alert("Enter the date they left.");
    await busy("saveTransferBtn", async () => {
        try {
            const batch = db.batch();
            let letterId = "";
            if ($("t_letter").files[0]) {
                const image = await compressImage($("t_letter").files[0], 250000, 1400);
                const ref = parishRef().collection("letters").doc();
                letterId = ref.id;
                batch.set(ref, { clergyId: c.memberNo, image, createdAt: nowIso() });
            }
            const record = (c.serviceRecord || []).map(r => r.to ? r : { ...r, to: leftDate });
            batch.update(parishRef().collection("clergy").doc(c.memberNo), {
                status: "Former", leftDate, leaveReason: reason, transferredTo: to, letterId, serviceRecord: record, updatedAt: nowIso() });
            batch.set(statsRef(), { clergyCount: inc(-1), formerClergyCount: inc(1) }, { merge: true });
            await batch.commit();
            closeModal("transferModal");
            await loadParishData();
            await openRecord("clergy", c.memberNo);
        } catch (e) { alert("Not moved: " + e.message); }
    });
}

// ---------------------------------------------------------------- families
function openFamilyForm() { ["f_name", "f_husband", "f_wife", "f_children"].forEach(id => $(id).value = ""); openModal("familyModal"); }
const kindOf = no => noType(no) === "CLG" ? "clergy" : "members";
async function saveFamily() {
    const name = val("f_name");
    const norm = s => s.trim().toUpperCase();
    const roles = {};
    if (val("f_husband")) roles[norm(val("f_husband"))] = "Husband";
    if (val("f_wife")) roles[norm(val("f_wife"))] = "Wife";
    val("f_children").split(",").map(norm).filter(Boolean).forEach(n => roles[n] = "Child");
    const nos = Object.keys(roles);
    if (!name || nos.length < 2) return alert("Give the family a name and at least two people.");
    await busy("saveFamilyBtn", async () => {
        try {
            const found = await Promise.all(nos.map(n => parishRef().collection(kindOf(n)).doc(n).get()));
            const missing = nos.filter((n, i) => !found[i].exists);
            if (missing.length) return alert("Not found in this parish: " + missing.join(", "));
            await parishRef().collection("families").add({ name, memberNos: nos, roles, updatedAt: nowIso() });
            closeModal("familyModal");
            await loadFamilies();
        } catch (e) { alert("Not saved: " + e.message); }
    });
}
async function loadFamilies() {
    if (localState.role !== "parish_admin") return;
    const snap = await parishRef().collection("families").orderBy("name").limit(50).get();
    $("familiesList").innerHTML = snap.empty ? `<p class="text-xs text-gray-400 italic">No families linked yet.</p>` :
        (await Promise.all(snap.docs.map(familyCard))).join("");
}
async function familyCard(f) {
    const fam = f.data();
    const order = { Husband: 0, Wife: 1, Child: 2 };
    const nos = [...fam.memberNos].sort((a, b) => order[fam.roles[a]] - order[fam.roles[b]]);
    const people = await Promise.all(nos.map(n => parishRef().collection(kindOf(n)).doc(n).get()));
    return `<div id="family-${esc(f.id)}" class="family-card bg-white border rounded-xl p-3 shadow-sm space-y-2">
        <p class="font-bold text-pink-800"><i class="fa-solid fa-people-roof"></i> ${esc(fam.name)}</p>
        ${people.filter(d => d.exists).map(d => `<div class="flex items-center gap-2"><span class="text-[10px] w-14 text-gray-500 uppercase">${esc(fam.roles[d.id])}</span><div class="flex-1">${personCard(kindOf(d.id), d)}</div></div>`).join("")}
    </div>`;
}
async function showFamily(id) {
    closeModal("recordModal");
    showSection("families");
    await loadFamilies();
    $("family-" + id)?.scrollIntoView();
}

// ---------------------------------------------------------------- parish settings
function fillSettingsForm(p) {
    const set = (id, v) => $(id).value = v || "";
    set("s_name", p.name); set("s_address", p.address); set("s_maps", p.mapsUrl); set("s_city", p.city);
    set("s_state", p.state); set("s_country", p.country); set("s_continent", p.continent); set("s_currency", p.currency);
    $("s_mapsOpen").classList.toggle("hidden", !p.mapsUrl);
    if (p.mapsUrl) $("s_mapsOpen").href = p.mapsUrl;
}
function readLocation(prefix) {
    const p = { name: val(prefix + "name"), address: val(prefix + "address"), mapsUrl: val(prefix + "maps"), city: val(prefix + "city"),
        state: val(prefix + "state"), country: val(prefix + "country"), continent: val(prefix + "continent") };
    const cur = $(prefix + "currency");
    if (cur && cur.value) p.currency = cur.value;
    // Only name/city/state/country are asked for: fill currency + continent from a known country so returns work at once.
    const known = COUNTRY_DEFAULTS[p.country.toLowerCase()];
    if (known && cur && !p.currency) p.currency = known[0];
    if (known && !p.continent) p.continent = known[1];
    if (p.mapsUrl && !/^https:\/\//.test(p.mapsUrl)) return { error: "The Google Maps link must start with https://" };
    if (!p.name) return { error: "The parish name is required." };
    return p;
}
async function saveParishSettings() {
    const p = readLocation("s_");
    if (p.error) return alert(p.error);
    p.updatedAt = nowIso();
    await busy("saveParishBtn", async () => {
        try {
            await parishRef().update(p);
            await loadParishData();
            alert("Parish details saved.");
        } catch (e) { alert("Not saved: " + e.message); }
    });
}

// ---------------------------------------------------------------- super admin / HQ world view
let register = [];
async function loadWorld() {
    $("welcomeTitle").textContent = localState.role === "super_admin" ? "Halleluyah 🙌, Super Admin!" : localState.role === "church_head" ? `Halleluyah 🙌, ${localState.name || "Church Head"}!` : "Halleluyah 🙌, HQ!";
    $("welcomeSub").textContent = "Totals for all parishes. Ordinary member records stay private to each parish.";
    $("dashParishName").textContent = "World-wide";
    const [parishes, stats] = await Promise.all([db.collection("parishes").get(), db.collection("parishStats").get()]);
    const byId = Object.fromEntries(stats.docs.map(d => [d.id, d.data()]));
    const sum = { memberCount: 0, clergyCount: 0, serviceCount: 0, financeTotal: 0, diasporaCount: 0, attendanceTotal: 0,
        birthCount: 0, childCount: 0, teenCount: 0, deathCount: 0 };
    stats.docs.forEach(d => Object.keys(sum).forEach(k => sum[k] += d.data()[k] || 0));
    showTotals(sum);
    localState.worldDiaspora = sum.diasporaCount;
    localState.parishNames = Object.fromEntries(parishes.docs.map(d => [d.id, d.data().name]));
    localState.parishList = parishes.docs.map(d => ({ id: d.id, ...d.data(), logo: "" }));
    $("worldTable").innerHTML = `<table class="w-full text-left text-xs"><thead class="bg-gray-100"><tr><th class="p-2">Parish</th><th class="p-2">Place</th><th class="p-2">Clergy</th><th class="p-2">Members</th><th class="p-2">Births</th><th class="p-2">Children</th><th class="p-2">Teens</th><th class="p-2">Deaths</th><th class="p-2">Attendance</th></tr></thead><tbody class="divide-y">` +
        parishes.docs.map(d => { const p = d.data(), s = byId[d.id] || {};
            return `<tr><td class="p-2 font-bold">${esc(p.name)}${p.status !== "Approved" ? " (" + esc(p.status) + ")" : ""}</td><td class="p-2">${esc([p.city, p.country].filter(Boolean).join(", "))}</td><td class="p-2">${s.clergyCount || 0}</td><td class="p-2">${s.memberCount || 0}</td><td class="p-2">${s.birthCount || 0}</td><td class="p-2">${s.childCount || 0}</td><td class="p-2">${s.teenCount || 0}</td><td class="p-2">${s.deathCount || 0}</td><td class="p-2">${s.attendanceTotal || 0}</td></tr>`; }).join("") + `</tbody></table>` + worldByType(stats.docs.map(d => d.data()));
    $("worldTable").classList.remove("hidden");
    if (localState.role !== "super_admin") return;
    $("parishList").innerHTML = parishes.docs.map(d => { const p = d.data();
        return `<div class="bg-white border rounded-xl p-3 text-xs"><p class="font-bold">${esc(p.name)} <span class="text-gray-400">${esc(p.status)}</span></p>
            <p>Parish code: ${p.code ? `<span class="font-mono font-bold">${esc(p.code)}</span>` : `<button onclick="giveParishCode('${esc(d.id)}')" class="underline text-blue-700">Give a parish code</button>`}</p><p>Lettering: ${p.parishLetters ? `<span class="font-mono font-bold">${esc(p.parishLetters)}-${esc(p.cityLetters)}</span>` : `<button onclick="setLettering('${esc(d.id)}')" class="underline text-blue-700">Set parish lettering</button>`}</p><p class="text-gray-500">${esc([p.address, p.city, p.state, p.country, p.continent].filter(Boolean).join(", "))}</p>
            <button onclick="changeAdmin('${esc(d.id)}')" class="chg-admin mt-1 px-2 py-1 border rounded text-blue-800"><i class="fa-solid fa-user-gear"></i> Change parish admin</button></div>`; }).join("");
    const [clergy, important] = await Promise.all([
        db.collectionGroup("clergy").get(),
        db.collectionGroup("members").where("important", "==", true).get()]);
    const parishOf = d => d.ref.parent.parent.id;
    register = clergy.docs.map(d => ({ ...d.data(), parishId: parishOf(d), parish: localState.parishNames[parishOf(d)] || parishOf(d) }));
    renderRegister();
    $("importantList").innerHTML = important.empty ? `<p class="text-xs text-gray-400 italic">No members flagged yet.</p>` :
        important.docs.map(d => worldCard({ ...d.data(), parish: localState.parishNames[parishOf(d)] })).join("");
}
// Totals per service type across parishes (numbers only; HQ + Super Admin).
function worldByType(all) {
    const t = {};
    all.forEach(s => Object.entries(s.byType || {}).forEach(([k, v]) => { const x = t[k] ||= { services: 0, total: 0 }; x.services += v.services || 0; x.total += v.total || 0; }));
    const rows = Object.entries(t);
    return rows.length ? `<table id="worldByType" class="w-full text-left text-xs border-t"><thead class="bg-gray-100"><tr><th class="p-2">Service type</th><th class="p-2">Held</th><th class="p-2">Total</th><th class="p-2">Avg</th></tr></thead><tbody class="divide-y">` +
        rows.map(([k, v]) => `<tr><td class="p-2">${esc(TYPE_NAMES[k] || k)}</td><td class="p-2">${v.services}</td><td class="p-2">${v.total}</td><td class="p-2">${v.services ? Math.round(v.total / v.services) : 0}</td></tr>`).join("") + `</tbody></table>` : "";
}
function worldCard(p) {
    return `<div class="world-row bg-white border rounded-xl p-2 flex items-center gap-3 text-xs">${p.photo ? `<img src="${esc(p.photo)}" alt="" class="w-10 h-12 object-cover rounded">` : ""}
        <div><p class="font-bold">${esc(p.fullName)}</p><p class="font-mono text-gray-500">${esc(displayNo(p))}</p><p class="text-gray-500">${esc(p.rank || "")} · ${esc(p.parish || "")}</p></div></div>`;
}
function renderRegister() {
    const t = $("registerFilter").value.trim().toLowerCase();
    const list = register.filter(p => !t || [p.fullName, p.memberNo, p.parish].join(" ").toLowerCase().includes(t));
    $("registerList").innerHTML = list.length ? list.map(worldCard).join("") : `<p class="text-xs text-gray-400 italic">No clergy found.</p>`;
}

// Existing parishes: Super Admin sets the lettering once (index doc in the same write keeps it unique).
async function setLettering(parishId) {
    const v = (prompt("Parish lettering, PARISH-CITY (2-4 letters each), e.g. IJY-ABK. It cannot be changed later.") || "").trim().toUpperCase();
    if (!v) return;
    if (!/^[A-Z]{2,4}-[A-Z]{2,4}$/.test(v)) return alert("Use 2-4 letters, a dash, then 2-4 letters (e.g. IJY-ABK).");
    const [pl, cl] = v.split("-");
    try {
        if ((await db.collection("parishLettering").doc(v).get()).exists) return alert(`${v} is already used by another parish.`);
        const b = db.batch();
        b.update(db.collection("parishes").doc(parishId), { parishLetters: pl, cityLetters: cl });
        b.set(db.collection("parishLettering").doc(v), { parishId });
        await b.commit();
        await loadWorld();
    } catch (e) { alert("Not saved: " + e.message); }
}
function randomCode() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from(crypto.getRandomValues(new Uint8Array(20)), b => abc[b % abc.length]).join("").replace(/(.{5})(?!$)/g, "$1-");
}
// Super admin: parish + counters + totals + one-time admin invite, all in one batch.
async function createParish() {
    const p = readLocation("np_");
    if (p.error) return alert(p.error);
    const email = val("np_email").toLowerCase();
    const pl = val("np_pletters").toUpperCase(), cl = val("np_cletters").toUpperCase();
    if (!/^[A-Z]{2,4}$/.test(pl) || !/^[A-Z]{2,4}$/.test(cl)) return alert("Enter the parish lettering: 2-4 letters for the parish and 2-4 for the city (e.g. IJY and ABK).");
    if ((await db.collection("parishLettering").doc(`${pl}-${cl}`).get()).exists) return alert(`The lettering ${pl}-${cl} is already used by another parish.`);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return alert("Enter the parish admin's email.");
    await busy("createParishBtn", async () => {
        try {
            const ref = db.collection("parishes").doc();
            const code = randomCode();
            const pcode = parishCode();
            const batch = db.batch();
            batch.set(ref, { ...p, status: "Approved", createdAt: nowIso(), code: pcode, parishLetters: pl, cityLetters: cl });
            batch.set(db.collection("parishLettering").doc(`${pl}-${cl}`), { parishId: ref.id });
            batch.set(db.collection("parishCodes").doc(pcode), { parishId: ref.id });
            batch.set(ref.collection("meta").doc("counters"), { clg: 0, mbr: 0 });
            batch.set(db.collection("parishStats").doc(ref.id), { memberCount: 0, clergyCount: 0, formerClergyCount: 0, attendanceTotal: 0, serviceCount: 0, financeTotal: 0, financeCount: 0,
                birthCount: 0, childCount: 0, teenCount: 0, deathCount: 0 });
            batch.set(db.collection("invites").doc(code), { email, parishId: ref.id, role: "parish_admin", usedBy: null, createdAt: nowIso() });
            await batch.commit();
            $("inviteResult").innerHTML = `<p class="font-bold">Parish created. Send this to the admin:</p>
                <p class="mt-1">Email: <span class="font-mono">${esc(email)}</span></p>
                <p>Invite code: <span id="inviteCode" class="font-mono font-bold select-all">${esc(code)}</span></p>
                <p>Parish code (for member transfers): <span id="newParishCode" class="font-mono font-bold select-all">${esc(pcode)}</span></p>
                <p class="text-gray-600 mt-1">They open the portal, tap "First time? I have an invite code", and choose a password.</p>`;
            $("inviteResult").classList.remove("hidden");
            ["np_pletters", "np_cletters", "np_name", "np_address", "np_maps", "np_city", "np_state", "np_country", "np_continent", "np_email"].forEach(id => $(id).value = "");
            await loadWorld();
        } catch (e) {
            alert(e.code === "permission-denied" ? "Not created. Check the details; the admin email must not belong to clergy." : e.message);
        }
    });
}

async function logout() {
    if (auth) await auth.signOut();
    location.reload();
}

// ---------------------------------------------------------------- attendance, finance, circulars (Milestone 1)
// ---------------------------------------------------------------- attendance (Phase 3)
// The CCC weekly timetable. Keys are fixed: firestore.rules lists the same ones.
// The standard timetable is the DEFAULT; each parish may edit its own (parishes/{p}/settings/timetable, Phase 9b).
const DEFAULT_SCHEDULE = [
    { key: "sunday", name: "Sunday Service", dow: 0, time: "10:00" },
    { key: "bible", name: "Bible Class", dow: 1, time: "17:00" },
    { key: "vigil_sidemen", name: "Sidemen/Sidewomen Night Vigil", dow: 1, time: "23:59" },
    { key: "wakati", name: "Wakati Adura", dow: 2, time: "09:00" },
    { key: "seekers", name: "Seekers Service", dow: 3, time: "09:00" },
    { key: "wed_evening", name: "Wednesday Evening Service", dow: 3, time: "18:00" },
    { key: "new_moon", name: "New Moon Service", dow: 4, time: "22:00", week: "first" },
    { key: "vigil_prophets", name: "Prophets/Prophetesses Night Vigil", dow: 4, time: "23:59", week: "other" },
    { key: "fri_evening", name: "Friday Evening Service", dow: 5, time: "18:00" }];
const DEFAULT_ACTIVITIES = [{ key: "a_cleaning", name: "Church cleaning", dow: 6, time: "08:00", kind: "activity" }];
let SCHEDULE = DEFAULT_SCHEDULE, ACTIVITIES = DEFAULT_ACTIVITIES, TIMETABLE_CUSTOM = false;
// Names of every service type ever used (standard + this parish's own), so old records keep their names.
let TYPE_NAMES = { ...Object.fromEntries(DEFAULT_SCHEDULE.map(s => [s.key, s.name])), special: "Special service", other: "Other service" };
function setTimetable(list) {
    TIMETABLE_CUSTOM = !!list;
    list = list || DEFAULT_SCHEDULE.map(s => ({ ...s, kind: "service" })).concat(DEFAULT_ACTIVITIES);
    SCHEDULE = list.filter(s => s.kind !== "activity");
    ACTIVITIES = list.filter(s => s.kind === "activity");
    for (const s of SCHEDULE) TYPE_NAMES[s.key] = s.name;
}
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ABSENT_DAYS = 21;

// Local calendar dates as YYYY-MM-DD (no UTC shift).
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const localToday = () => ymd(new Date());
const weekStart = s => addDays(s, -parseYmd(s).getDay());          // the Sunday of that week
const fmtDay = s => { const d = parseYmd(s); return `${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };

// All timetable services for the week starting on Sunday `sun`, plus special services that week.
function weekServices(sun, specials = []) {
    const list = [];
    for (const s of SCHEDULE) {
        const date = addDays(sun, s.dow);
        const firstThu = parseYmd(date).getDate() <= 7;
        if (s.week === "first" && !firstThu) continue;
        if (s.week === "other" && firstThu) continue;
        list.push({ id: `${date}_${s.key}`, key: s.key, name: s.name, date, time: s.time });
    }
    for (const sp of specials) list.push({ id: `${sp.date}_special_${sp.id}`, key: "special", specialId: sp.id, name: sp.name, date: sp.date, time: sp.time });
    return list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
// Old free-text records are put into a type by name, for the reports.
function keyOf(a) {
    if (a.serviceKey) return a.serviceKey;
    const t = (a.serviceType || "").toLowerCase();
    const map = [[/sunday/, "sunday"], [/bible/, "bible"], [/wakati/, "wakati"], [/seeker/, "seekers"], [/new moon/, "new_moon"],
        [/prophet/, "vigil_prophets"], [/sidem|vigil/, "vigil_sidemen"], [/wed/, "wed_evening"], [/fri/, "fri_evening"], [/harvest|anniversary|special/, "special"]];
    return (map.find(([re]) => re.test(t)) || [, "other"])[1];
}
// Nigerian numbers 080... become 23480... for wa.me.
function waLink(phone, text) {
    let d = String(phone || "").replace(/\D/g, "");
    if (!d) return "";
    if (d.startsWith("0") && d.length === 11) d = "234" + d.slice(1);
    return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}
const missText = name => `Halleluyah 🙌, ${String(name).split(" ")[0]}! We have missed you at ${localState.parish.name || "church"}. We pray all is well with you and your family, and we look forward to seeing you in service soon. God bless you.`;
const visitText = name => `Halleluyah 🙌, ${String(name).split(" ")[0]}! Thank you for worshipping with us at ${localState.parish.name || "our parish"}. You are always welcome. God bless you.`;

let att = { week: "", specials: [], records: {}, people: [], clergy: [], svc: null, reports: null, cleaning: null };

function attTab(tab) {
    document.querySelectorAll(".att-panel").forEach(p => p.classList.toggle("hidden", p.id !== "att-" + tab));
    document.querySelectorAll(".att-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    const run = { week: loadWeek, followup: loadFollowup, visitors: loadVisitors, depts: loadDeptRoll, cleaning: loadCleaning, reports: loadReports }[tab];
    return run && run().catch(e => alert("Could not load: " + e.message));
}
async function openAttendance() {
    if (!att.week) att.week = weekStart(localToday());
    await Promise.all([loadPeople(), loadUnits()]);
    return attTab("week");
}
// Active members + active clergy: leader list, phone numbers for WhatsApp, cleaning rota.
async function loadPeople() {
    const [m, c] = await Promise.all([parishRef().collection("members").where("status", "==", "Active").get(),
        parishRef().collection("clergy").where("status", "==", "Active").get()]);
    att.clergy = c.docs.map(d => d.data());
    att.people = [...m.docs, ...c.docs].map(d => d.data()).sort((a, b) => a.fullName.localeCompare(b.fullName));
}
function shiftWeek(n) { att.week = addDays(att.week, 7 * n); loadWeek(); }
async function loadWeek() {
    const end = addDays(att.week, 6);
    $("weekLabel").textContent = `${fmtDay(att.week)} – ${fmtDay(end)}`;
    const [sp, recs] = await Promise.all([
        parishRef().collection("specialServices").where("date", ">=", att.week).where("date", "<=", end).get(),
        parishRef().collection("attendance").where("serviceDate", ">=", att.week).where("serviceDate", "<=", end).get()]);
    att.specials = sp.docs.map(d => ({ id: d.id, ...d.data() }));
    att.records = Object.fromEntries(recs.docs.map(d => [d.id, d.data()]));
    const sat = addDays(att.week, 6);
    $("weekList").innerHTML = weekServices(att.week, att.specials).map(s => {
        const r = att.records[s.id];
        const done = r ? `<span class="text-emerald-700 font-bold">${r.headcount}</span> <span class="text-gray-500">(M ${r.men} · W ${r.women} · C ${r.children} · V ${r.visitors})</span>${r.ledByName ? `<br><span class="text-gray-500">Led by ${esc(r.ledByName)}</span>` : ""}` : `<span class="text-gray-400">Not recorded yet</span>`;
        return `<div class="svc-card bg-white border rounded-xl p-3 text-xs flex items-center gap-2" data-id="${esc(s.id)}">
            <div class="w-14 text-center"><p class="font-bold text-blue-900">${esc(fmtDay(s.date).split(" ")[0])}</p><p class="text-gray-500">${esc(s.time)}</p></div>
            <div class="flex-1 min-w-0"><p class="font-bold">${esc(s.name)}${s.key === "special" ? ' <i class="fa-solid fa-star text-amber-400"></i>' : ""}</p><p>${done}</p></div>
            <button onclick="openServiceModal('${esc(s.id)}')" class="px-3 py-2 bg-blue-600 text-white rounded font-bold">${r ? "Edit" : "Record"}</button></div>`;
    }).join("") + `<button onclick="att.cleaningDate='${sat}';attTab('cleaning')" class="w-full bg-white border border-dashed rounded-xl p-3 text-xs text-left"><b>Sat ${esc(fmtDay(sat).slice(4))}</b> · Church cleaning rota <i class="fa-solid fa-broom text-gray-400"></i></button>`;
}
function openSpecialForm() { $("specialForm").classList.toggle("hidden"); $("sp_date").value = $("sp_date").value || localToday(); }
async function saveSpecial() {
    const name = val("sp_name"), date = $("sp_date").value, time = $("sp_time").value;
    if (!name || !date || !/^\d\d:\d\d$/.test(time)) return alert("Give the special service a name, date and time.");
    await busy("saveSpecialBtn", async () => {
        await parishRef().collection("specialServices").add({ name, date, time, notes: "", createdAt: nowIso() });
        $("sp_name").value = ""; $("specialForm").classList.add("hidden");
        att.week = weekStart(date);
        await loadWeek();
    });
}
function findService(id) {
    return weekServices(weekStart(id.slice(0, 10)), att.specials).find(s => s.id === id);
}
function openServiceModal(id) {
    const s = id ? findService(id) : null;
    const r = (id && att.records[id]) || {};
    att.svc = s;
    $("svc_key").innerHTML = s ? `<option value="${esc(s.key)}">${esc(s.name)}</option>`
        : SCHEDULE.concat([{ key: "other", name: "Other service" }]).map(x => `<option value="${x.key}">${esc(x.name)}</option>`).join("");
    $("svc_key").disabled = !!s;
    $("svc_date").value = s ? s.date : localToday(); $("svc_date").disabled = !!s;
    $("svc_time").value = s ? s.time : "10:00";
    for (const k of ["men", "women", "children", "visitors"]) $("svc_" + k).value = r[k] ?? "";
    $("svc_led").innerHTML = `<option value="">Not recorded</option>` + att.clergy.map(c => `<option value="${esc(c.memberNo)}">${esc([c.rank, c.fullName].filter(Boolean).join(" "))}</option>`).join("");
    $("svc_led").value = r.ledBy || "";
    $("svc_notes").value = r.notes || "";
    $("svcTitle").textContent = s ? `${s.name.toUpperCase()} · ${fmtDay(s.date)}` : "RECORD A SERVICE";
    svcTotal();
    openModal("serviceModal");
}
const num = id => Math.max(0, parseInt($(id).value, 10) || 0);
function svcTotal() { $("svc_total").textContent = ["men", "women", "children", "visitors"].reduce((t, k) => t + num("svc_" + k), 0); }
// Totals for Super Admin / HQ: overall and per service type, adjusted by the change only.
function statDelta(batch, key, headDelta, newService) {
    batch.set(statsRef(), { attendanceTotal: inc(headDelta), serviceCount: inc(newService ? 1 : 0),
        byType: { [key]: { services: inc(newService ? 1 : 0), total: inc(headDelta) } } }, { merge: true });
}
function serviceDoc(s, extra) {
    return { serviceDate: s.date, serviceType: s.name.slice(0, 60), serviceKey: s.key, serviceTime: s.time,
        men: 0, women: 0, children: 0, visitors: 0, headcount: 0, ledBy: "", ledByName: "", notes: "",
        ...(s.specialId ? { specialId: s.specialId } : {}), updatedAt: nowIso(), ...extra };
}
async function saveService() {
    let s = att.svc;
    if (!s) {
        const key = $("svc_key").value, date = $("svc_date").value;
        if (!date) return alert("Pick the date.");
        s = { id: `${date}_${key}`, key, name: TYPE_NAMES[key], date, time: $("svc_time").value };
    }
    const c = Object.fromEntries(["men", "women", "children", "visitors"].map(k => [k, num("svc_" + k)]));
    const headcount = c.men + c.women + c.children + c.visitors;
    const led = att.clergy.find(x => x.memberNo === $("svc_led").value);
    await busy("saveServiceBtn", async () => {
        try {
            const ref = parishRef().collection("attendance").doc(s.id);
            await db.runTransaction(async t => {
                const old = await t.get(ref);
                const prev = old.exists ? old.data() : null;
                t.set(ref, serviceDoc({ ...s, time: $("svc_time").value || s.time }, { ...c, headcount,
                    ledBy: led ? led.memberNo : "", ledByName: led ? [led.rank, led.fullName].filter(Boolean).join(" ").slice(0, 160) : "", notes: val("svc_notes").slice(0, 1000) }));
                statDelta(t, s.key, headcount - (prev ? prev.headcount : 0), !prev);
            });
            closeModal("serviceModal");
            if (!att.svc) att.week = weekStart(s.date);
            await Promise.all([loadWeek(), loadAttendance(true), refreshTotals()]);
        } catch (e) { alert("Not saved: " + e.message); }
    });
}
async function refreshTotals() { const st = await statsRef().get(); showTotals(st.exists ? st.data() : {}); }

// ---- unit registers (founder decision: no whole-church tick-list; named attendance lives in each unit)
const allUnits = () => DEPTS.map(d => [d.id, d.name]).concat(Object.entries(localState.units || {}));
async function loadUnits() {
    const snap = await parishRef().collection("units").get();
    localState.units = Object.fromEntries(snap.docs.map(d => [d.id, d.data().name]));
}
async function addUnit() {
    const name = val("unit_name");
    if (!name) return alert("Type the unit's name, e.g. Ushers.");
    const id = "u_" + (name.replace(/[^A-Za-z0-9]/g, "").slice(0, 24) || "unit") + Math.random().toString(36).slice(2, 6);
    await busy("addUnitBtn", async () => {
        try {
            await parishRef().collection("units").doc(id).set({ name, createdAt: nowIso() });
            $("unit_name").value = "";
            await loadUnits(); await loadDeptRoll(id);
        } catch (e) { alert("Not saved: " + e.message); }
    });
}
// For one unit: sessions in the last 12 weeks -> who is away 3+ weeks and present-in-a-row streaks.
function unitFollowup(unitId, members, sessions) {
    const cutoff = addDays(localToday(), -ABSENT_DAYS);
    const sorted = sessions.slice().sort((a, b) => b.date.localeCompare(a.date));
    if (!sorted.some(s => s.date >= cutoff)) return { absent: [], streaks: [] };   // unit has not met: nobody flagged
    return {
        absent: members.map(m => {
            const last = sorted.find(s => s.present.includes(m.memberNo));
            return { ...m, unitId, lastSeen: last ? last.date : "" };
        }).filter(m => !m.lastSeen || m.lastSeen < cutoff),
        streaks: members.map(m => { let n = 0; for (const s of sorted) { if (!s.present.includes(m.memberNo)) break; n++; } return { ...m, unitId, n }; }).filter(m => m.n > 0)
    };
}
async function unitData(unitId) {
    const since = addDays(localToday(), -84);
    const [mem, ses] = await Promise.all([
        parishRef().collection("deptMembers").where("dept", "==", unitId).where("status", "==", "Current").get(),
        parishRef().collection("deptAttendance").where("dept", "==", unitId).get()]);
    return { members: mem.docs.map(d => d.data()), sessions: ses.docs.map(d => d.data()).filter(s => s.date >= since) };
}
function absentRow(m, phones, withUnit) {
    const link = waLink(phones[m.memberNo], missText(m.fullName));
    const away = m.lastSeen ? `last present ${esc(fmtDay(m.lastSeen))}` : "not present in the last 12 weeks";
    return `<div class="absent-row bg-white border rounded-xl p-3 flex items-center gap-2"><div class="flex-1"><b>${esc(m.fullName)}</b> <span class="font-mono text-gray-500">${esc(m.memberNo)}</span><br>
        <span class="text-rose-700">${withUnit ? esc(deptName(m.unitId)) + " · " : ""}${away}</span></div>
        ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener" class="wa-link px-3 py-2 bg-green-600 text-white rounded font-bold"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a>` : `<span class="text-gray-400">No phone</span>`}</div>`;
}
const phoneMap = () => Object.fromEntries(att.people.map(p => [p.memberNo, p.phone]));
// Parish admin roll-up: absent 3+ weeks across every unit.
async function loadFollowup() {
    const all = await Promise.all(allUnits().map(([id]) => unitData(id).then(d => unitFollowup(id, d.members, d.sessions))));
    const absent = all.flatMap(x => x.absent), streaks = all.flatMap(x => x.streaks).sort((a, b) => b.n - a.n).slice(0, 10);
    const phones = phoneMap();
    $("absentList").innerHTML = absent.map(m => absentRow(m, phones, true)).join("") || `<p class="text-gray-400 italic">Nobody has been away 3+ weeks from their unit.</p>`;
    $("streakList").innerHTML = streaks.map(p => `<div class="streak-row p-3 flex justify-between"><span><b>${esc(p.fullName)}</b> <span class="text-gray-500">${esc(deptName(p.unitId))}</span></span><span class="font-bold text-amber-600">${p.n} in a row</span></div>`).join("")
        || `<p class="p-3 text-gray-400 italic">No streaks yet. Mark unit registers at each meeting.</p>`;
}

// ---- visitors
const V_STATUS = ["New", "Contacted", "Returned", "Member", "Not interested"];
async function saveVisitor() {
    const name = val("v_name"), phone = val("v_phone");
    if (!name) return alert("Enter the visitor's name.");
    if (!$("v_consent").checked) return alert("Ask the visitor's permission first (NDPA 2023), then tick the box.");
    await busy("saveVisitorBtn", async () => {
        const batch = db.batch();
        batch.set(parishRef().collection("visitors").doc(), { name, nameLower: name.toLowerCase(), phone, phoneDigits: phone.replace(/\D/g, ""),
            invitedBy: val("v_invited"), firstVisit: $("v_date").value || localToday(), serviceType: "", status: "New", notes: "",
            consentGiven: true, createdAt: nowIso(), updatedAt: nowIso() });
        batch.set(statsRef(), { visitorCount: inc(1) }, { merge: true });
        await batch.commit();
        ["v_name", "v_phone", "v_invited"].forEach(id => $(id).value = ""); $("v_consent").checked = false;
        await loadVisitors();
    });
}
async function loadVisitors() {
    $("v_date").value = $("v_date").value || localToday();
    const snap = await parishRef().collection("visitors").orderBy("firstVisit", "desc").limit(100).get();
    att.visitors = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
    $("visitorList").innerHTML = snap.docs.map(d => { const v = d.data(); const link = waLink(v.phone, visitText(v.name));
        return `<div class="visitor-row bg-white border rounded-xl p-3 space-y-2" data-id="${esc(d.id)}"><div><b>${esc(v.name)}</b> <span class="text-gray-500">${esc(v.phone)}</span><br>
            <span class="text-gray-500">First visit ${esc(fmtDay(v.firstVisit))}${v.invitedBy ? " · invited by " + esc(v.invitedBy) : ""}</span></div>
            <div class="flex gap-2 items-center">${v.status === "Member" ? `<span class="px-2 py-1 bg-emerald-100 text-emerald-800 rounded font-bold">Member ${esc(v.memberNo)}</span>`
                : `<select onchange="setVisitorStatus('${esc(d.id)}', this.value)" class="border p-2 rounded">${V_STATUS.filter(x => x !== "Member").map(x => `<option ${x === v.status ? "selected" : ""}>${x}</option>`).join("")}</select>
                   <button onclick="convertVisitor('${esc(d.id)}')" class="px-3 py-2 bg-blue-600 text-white rounded font-bold">Make member</button>`}
                ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener" class="px-3 py-2 bg-green-600 text-white rounded"><i class="fa-brands fa-whatsapp"></i></a>` : ""}</div></div>`; }).join("")
        || `<p class="text-gray-400 italic">No visitors logged yet.</p>`;
}
async function setVisitorStatus(id, status) {
    try { await parishRef().collection("visitors").doc(id).update({ status, updatedAt: nowIso() }); }
    catch (e) { alert("Not saved: " + e.message); }
}
// Opens the normal member form, pre-filled; saving it also marks the visitor as Member (one transaction).
function convertVisitor(id) {
    const v = att.visitors[id];
    openPersonForm("members", null);
    $("p_name").value = v.name; $("p_phone").value = v.phone;
    form.visitorId = id;
}

// ---- department attendance
async function loadDeptRoll(pick) {
    const keep = pick || $("da_dept").value;
    $("da_dept").innerHTML = allUnits().map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join("");
    if (keep) $("da_dept").value = keep;
    $("da_date").value = $("da_date").value || localToday();
    const dept = $("da_dept").value, date = $("da_date").value;
    const [{ members, sessions }, existing] = await Promise.all([unitData(dept), parishRef().collection("deptAttendance").doc(`${dept}_${date}`).get()]);
    const present = new Set(existing.exists ? existing.data().present : []);
    if (existing.exists) $("da_kind").value = existing.data().kind;
    $("daList").innerHTML = members.sort((a, b) => a.fullName.localeCompare(b.fullName)).map(m =>
        `<label class="da-row flex items-center gap-3 p-3"><input type="checkbox" class="w-6 h-6" value="${esc(m.memberNo)}" ${present.has(m.memberNo) ? "checked" : ""}>
            <span><b>${esc(m.fullName)}</b> <span class="font-mono text-gray-500">${esc(m.memberNo)}</span>${m.role ? ` · ${esc(m.role)}` : ""}</span></label>`).join("")
        || `<p class="p-3 text-gray-400 italic">No current members in this unit yet. <button onclick="openDept('${esc(dept)}')" class="underline text-blue-700">Add members</button></p>`;
    const f = unitFollowup(dept, members, sessions), phones = phoneMap();
    $("daAbsent").innerHTML = f.absent.length ? `<p class="font-bold text-rose-900">Absent 3+ weeks in this unit</p>` + f.absent.map(m => absentRow(m, phones, false)).join("") : "";
    $("daRecent").innerHTML = sessions.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)
        .map(r => `<p class="bg-white border rounded p-2">${esc(fmtDay(r.date))} · ${esc(r.kind)}: <b>${r.present.length}</b>${members.length ? " of " + members.length : ""} present</p>`).join("");
}
async function saveDeptAttendance() {
    const dept = $("da_dept").value, date = $("da_date").value;
    const present = [...document.querySelectorAll("#daList input:checked")].map(i => i.value);
    await busy("saveDeptAttBtn", async () => {
        try {
            await parishRef().collection("deptAttendance").doc(`${dept}_${date}`).set({ dept, date, kind: $("da_kind").value, present, notes: "", updatedAt: nowIso() });
            await loadDeptRoll();
        } catch (e) { alert("Not saved: " + e.message); }
    });
}

// ---- Saturday cleaning rota
async function loadCleaning() {
    const sat = addDays(weekStart(localToday()), 6);
    if (att.cleaningDate) { $("cl_date").value = att.cleaningDate; att.cleaningDate = ""; }
    $("cl_date").value = $("cl_date").value || sat;
    const snap = await parishRef().collection("cleaning").doc($("cl_date").value).get();
    att.cleaning = snap.exists ? snap.data() : { assigned: [], came: [], names: {} };
    renderCleaning();
}
function renderCleaning() {
    const c = att.cleaning, came = new Set(c.came);
    $("cl_list").innerHTML = c.assigned.map(no => `<label class="cl-row flex items-center gap-3 p-3"><input type="checkbox" class="w-6 h-6" value="${esc(no)}" ${came.has(no) ? "checked" : ""}
        onchange="cleaningCame('${esc(no)}', this.checked)"><span class="flex-1"><b>${esc(c.names[no] || no)}</b> <span class="font-mono text-gray-500">${esc(no)}</span></span>
        <span class="text-gray-400">${came.has(no) ? "came" : "assigned"}</span></label>`).join("")
        || `<p class="p-3 text-gray-400 italic">No one assigned yet. Search above to assign.</p>`;
}
function findForCleaning() {
    const t = $("cl_search").value.trim().toLowerCase();
    $("cl_found").innerHTML = !t ? "" : att.people.filter(p => p.nameLower.includes(t) || p.memberNo.toLowerCase().includes(t)).slice(0, 8)
        .map(p => `<button onclick="assignCleaning('${esc(p.memberNo)}')" class="w-full text-left p-2">+ ${esc(p.fullName)} <span class="font-mono text-gray-500">${esc(p.memberNo)}</span></button>`).join("");
}
function assignCleaning(no) {
    const p = att.people.find(x => x.memberNo === no);
    if (!att.cleaning.assigned.includes(no)) att.cleaning.assigned.push(no);
    att.cleaning.names[no] = p.fullName;
    $("cl_search").value = ""; $("cl_found").innerHTML = "";
    renderCleaning();
}
function cleaningCame(no, yes) {
    att.cleaning.came = att.cleaning.came.filter(x => x !== no).concat(yes ? [no] : []);
    renderCleaning();
}
async function saveCleaning() {
    const date = $("cl_date").value, c = att.cleaning;
    await busy("saveCleaningBtn", async () => {
        try {
            await parishRef().collection("cleaning").doc(date).set({ date, assigned: c.assigned, came: c.came, names: c.names, notes: "", updatedAt: nowIso() });
            alert(`Cleaning rota saved: ${c.came.length} of ${c.assigned.length} came.`);
        } catch (e) { alert("Not saved: " + e.message); }
    });
}

// ---- reports
async function loadReports() {
    const period = $("rp_period").value;
    const start = period === "week" ? addDays(weekStart(localToday()), -7 * 11) : ymd(new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1));
    const [recs, depts] = await Promise.all([
        parishRef().collection("attendance").where("serviceDate", ">=", start).get(),
        parishRef().collection("deptAttendance").where("date", ">=", start).get()]);
    att.reports = { period, start, recs: recs.docs.map(d => d.data()), depts: depts.docs.map(d => d.data()) };
    const types = [...new Set(att.reports.recs.map(keyOf))];
    const cur = $("rp_type").value;
    $("rp_type").innerHTML = `<option value="">All services</option>` + types.map(k => `<option value="${k}">${esc(TYPE_NAMES[k])}</option>`).join("");
    $("rp_type").value = types.includes(cur) ? cur : "";
    renderReports();
}
function buckets() {
    const { period, start } = att.reports;
    const out = [];
    for (let i = 0; i < 12; i++) {
        if (period === "week") { const w = addDays(start, 7 * i); out.push({ id: w, label: fmtDay(w).slice(4) }); }
        else { const d = parseYmd(start); d.setMonth(d.getMonth() + i); out.push({ id: ymd(d).slice(0, 7), label: MONTHS[d.getMonth()].slice(0, 3) }); }
    }
    return out;
}
const bucketOf = date => att.reports.period === "week" ? weekStart(date) : date.slice(0, 7);
function renderReports() {
    const r = att.reports, type = $("rp_type").value;
    const recs = r.recs.filter(a => !type || keyOf(a) === type);
    const bs = buckets().map(b => ({ ...b, total: 0, services: 0 }));
    const idx = Object.fromEntries(bs.map((b, i) => [b.id, i]));
    for (const a of recs) { const i = idx[bucketOf(a.serviceDate)]; if (i !== undefined) { bs[i].total += a.headcount; bs[i].services++; } }
    $("rpTitle").textContent = `${localState.parish.name || "Parish"} · ${type ? TYPE_NAMES[type] : "All services"}`;
    $("rpSub").textContent = `${r.period === "week" ? "Weekly, last 12 weeks" : "Monthly, last 12 months"} · printed ${localToday()}`;
    // Simple bar chart (inline SVG, no library).
    const max = Math.max(1, ...bs.map(b => b.total)), W = 340, H = 150, bw = W / bs.length;
    $("rpChart").innerHTML = `<svg viewBox="0 -12 ${W} ${H + 42}" class="w-full" role="img" aria-label="Attendance trend">
        ${bs.map((b, i) => { const h = Math.round((b.total / max) * H);
            return `<rect x="${i * bw + 3}" y="${H - h}" width="${bw - 6}" height="${h}" rx="2" style="fill:var(--rb-${i % 5 + 1})"><title>${esc(b.label)}: ${b.total}</title></rect>
            ${b.total ? `<text x="${i * bw + bw / 2}" y="${H - h - 3}" font-size="8" text-anchor="middle" fill="#374151">${b.total}</text>` : ""}
            <text x="${i * bw + bw / 2}" y="${H + 12}" font-size="7.5" text-anchor="middle" fill="#6b7280">${esc(b.label)}</text>`; }).join("")}
        <line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="#d1d5db"/></svg>`;
    const tbl = (head, rows) => `<table class="w-full text-left text-xs"><thead class="bg-gray-100"><tr>${head.map(h => `<th class="p-1.5">${h}</th>`).join("")}</tr></thead><tbody class="divide-y">${rows.join("")}</tbody></table>`;
    $("rpTable").innerHTML = tbl([r.period === "week" ? "Week of" : "Month", "Services", "Total", "Average"],
        bs.map(b => `<tr><td class="p-1.5">${esc(b.label)}</td><td class="p-1.5">${b.services}</td><td class="p-1.5 font-bold">${b.total}</td><td class="p-1.5">${b.services ? Math.round(b.total / b.services) : 0}</td></tr>`));
    const byType = {};
    for (const a of r.recs) { const k = keyOf(a), t = byType[k] ||= { s: 0, m: 0, w: 0, c: 0, v: 0, total: 0 };
        t.s++; t.total += a.headcount; t.m += a.men || 0; t.w += a.women || 0; t.c += a.children || 0; t.v += a.visitors || 0; }
    $("rpTypes").innerHTML = tbl(["Service", "Held", "Men", "Women", "Children", "Visitors", "Avg"], Object.entries(byType).map(([k, t]) =>
        `<tr><td class="p-1.5">${esc(TYPE_NAMES[k])}</td><td class="p-1.5">${t.s}</td><td class="p-1.5">${t.m}</td><td class="p-1.5">${t.w}</td><td class="p-1.5">${t.c}</td><td class="p-1.5">${t.v}</td><td class="p-1.5 font-bold">${Math.round(t.total / t.s)}</td></tr>`));
    const byDept = {};
    for (const d of r.depts) { const t = byDept[d.dept] ||= { s: 0, p: 0 }; t.s++; t.p += d.present.length; }
    $("rpDepts").innerHTML = Object.keys(byDept).length ? tbl(["Department", "Sessions", "Avg present"], Object.entries(byDept).map(([k, t]) =>
        `<tr><td class="p-1.5">${esc(deptName(k))}</td><td class="p-1.5">${t.s}</td><td class="p-1.5 font-bold">${Math.round(t.p / t.s)}</td></tr>`)) : `<p class="text-gray-400 italic">No department sessions in this period.</p>`;
}
function exportCsv(which) {
    const r = att.reports;
    const cell = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = which === "services"
        ? [["Date", "Service", "Type", "Men", "Women", "Children", "Visitors", "Total", "Led by", "Notes"],
           ...r.recs.sort((a, b) => a.serviceDate.localeCompare(b.serviceDate)).map(a => [a.serviceDate, a.serviceType, TYPE_NAMES[keyOf(a)], a.men ?? "", a.women ?? "", a.children ?? "", a.visitors ?? "", a.headcount, a.ledByName || "", a.notes || ""])]
        : [["Date", "Department", "Kind", "Present", "Member numbers"],
           ...r.depts.sort((a, b) => a.date.localeCompare(b.date)).map(d => [d.date, deptName(d.dept), d.kind, d.present.length, d.present.join(" ")])];
    const blob = new Blob([rows.map(x => x.map(cell).join(",")).join("\r\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `attendance-${which}-${localToday()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
}

// Phase 8: pick the giver from the parish member list so giving is matched by member number (name stays as typed).
let finTimer = null;
function findFinMember() {
    setFinMember("", "", true);
    clearTimeout(finTimer);
    finTimer = setTimeout(async () => {
        const t = val("fin_contrib").toLowerCase();
        if (t.length < 2) return $("fin_memberFound").innerHTML = "";
        const s = await parishRef().collection("members").orderBy("nameLower").startAt(t).endAt(t + "\uf8ff").limit(6).get();
        $("fin_memberFound").innerHTML = s.docs.map(d => d.data()).filter(m => m.status === "Active" || m.status === "Diaspora")
            .map(m => `<button type="button" data-no="${esc(m.memberNo)}" data-name="${esc(m.fullName)}" onclick="setFinMember(this.dataset.no, this.dataset.name)" class="fin-opt w-full text-left border rounded p-2 bg-emerald-50">${esc(m.fullName)} <span class="font-mono">${esc(m.memberNo)}</span></button>`).join("");
    }, 250);
}
function setFinMember(no, name, keepText) {
    $("fin_memberNo").value = no;
    if (no && !keepText) $("fin_contrib").value = name;
    $("fin_memberText").textContent = no ? "Member number: " + no : "Not linked to a member number (optional)";
    $("fin_memberFound").innerHTML = "";
}
function openFinanceModal() { document.getElementById("addFinanceModal").classList.remove('hidden'); }
function closeFinanceModal() { document.getElementById("addFinanceModal").classList.add('hidden'); }
async function saveFinance() {
    if (!requireFirebase()) return;
    const date = document.getElementById("fin_date").value;
    const contrib = document.getElementById("fin_contrib").value.trim();
    const type = document.getElementById("fin_type").value.trim();
    const amt = parseFloat(document.getElementById("fin_amount").value);
    if (!date || !contrib || !type || isNaN(amt) || amt <= 0) return alert("Fill all elements.");
    try {
        const inc = firebase.firestore.FieldValue.increment;
        const batch = db.batch();
        const memberNo = $("fin_memberNo").value;
        batch.set(parishRef().collection("finances").doc(), {
            transactionDate: date, contributorName: contrib, contributionType: type, amount: amt, ...(memberNo ? { memberNo } : {})
        });
        batch.set(statsRef(), { financeTotal: inc(amt), financeCount: inc(1) }, { merge: true });
        await batch.commit();
        closeFinanceModal();
        setFinMember("", "");
        loadParishData();
    } catch (e) {
        alert(`Failed to save transaction: ${e.message}`);
    }
}

async function postCircular() {
    if (!requireFirebase()) return;
    const body = document.getElementById("circ_body").value.trim();
    if (!body) return;
    try {
        await db.collection("circulars").add({ body, createdAt: new Date().toISOString(), author: localState.user.uid });
        document.getElementById("circ_body").value = "";
        loadParishData();
    } catch (e) {
        alert(`Failed to publish: ${e.message}`);
    }
}

// ---------------------------------------------------------------- departments
// Each department: term doc (2-year term) + one deptMembers doc per (department, member).
let deptState = { id: "", terms: {}, members: [] };
const DAY = 86400000;
function termStatus(term) {
    if (!term || !term.termEnd) return { level: "none", text: "No term dates set yet." };
    const days = Math.ceil((new Date(term.termEnd + "T00:00:00") - new Date(today() + "T00:00:00")) / DAY);
    if (days < 0) return { level: "overdue", days, text: `Election OVERDUE by ${-days} day${days === -1 ? "" : "s"} (term ended ${term.termEnd}).` };
    if (days <= ELECTION_WARN_DAYS) return { level: "due", days, text: `Election due in ${days} day${days === 1 ? "" : "s"} (term ends ${term.termEnd}).` };
    return { level: "ok", days, text: `Term ${term.termStart} to ${term.termEnd}.` };
}
function bannerHtml(deptId, st, withName) {
    if (st.level !== "due" && st.level !== "overdue") return "";
    const cls = st.level === "overdue" ? "bg-rose-50 border-rose-400 text-rose-900" : "bg-amber-50 border-amber-400 text-amber-900";
    return `<button onclick="openDept('${deptId}')" class="election-banner w-full text-left border-l-4 ${cls} p-3 rounded text-xs font-semibold"><i class="fa-solid fa-bell mr-1"></i>${withName ? esc(deptName(deptId)) + ": " : ""}${esc(st.text)}</button>`;
}
async function loadDepartments() {
    const [terms, current] = await Promise.all([parishRef().collection("departments").get(),
        parishRef().collection("deptMembers").where("status", "==", "Current").get()]);
    deptState.terms = Object.fromEntries(terms.docs.map(d => [d.id, d.data()]));
    const counts = {};
    current.docs.forEach(d => counts[d.data().dept] = (counts[d.data().dept] || 0) + 1);
    $("deptGrid").innerHTML = DEPTS.map(d => {
        const st = termStatus(deptState.terms[d.id]);
        const badge = st.level === "overdue" ? `<span class="text-[9px] bg-rose-600 text-white rounded px-1">ELECTION OVERDUE</span>` : st.level === "due" ? `<span class="text-[9px] bg-amber-500 text-white rounded px-1">ELECTION DUE</span>` : "";
        return `<button onclick="openDept('${d.id}')" id="dept-card-${d.id}" class="bg-white p-3 rounded-xl border shadow-sm text-left">
            <p class="text-gray-500 font-semibold text-[10px] uppercase"><i class="fa-solid ${d.icon} text-slate-500"></i> ${esc(d.name)}</p>
            <p class="dept-count text-xl font-bold text-blue-900">${counts[d.id] || 0}</p>${badge}</button>`;
    }).join("");
    $("electionBanners").innerHTML = DEPTS.map(d => bannerHtml(d.id, termStatus(deptState.terms[d.id]), true)).join("");
}
async function openDept(id) {
    deptState.id = id;
    showSection("dept");
    $(`nav-dept-${id}`)?.classList.add("bg-slate-800");
    $("deptTitle").textContent = deptName(id);
    $("d_find").value = ""; $("d_role").value = ""; $("d_matches").innerHTML = "";
    await refreshDept();
}
async function refreshDept() {
    const id = deptState.id;
    const [term, snap] = await Promise.all([parishRef().collection("departments").doc(id).get(),
        parishRef().collection("deptMembers").where("dept", "==", id).get()]);
    const t = term.exists ? term.data() : null;
    deptState.terms[id] = t;
    $("d_termStart").value = t?.termStart || ""; $("d_termEnd").value = t?.termEnd || "";
    const st = termStatus(t);
    $("deptBanner").innerHTML = bannerHtml(id, st, false) || `<p class="text-xs text-gray-500">${esc(st.text)}</p>`;
    const all = snap.docs.map(d => d.data()).sort((a, b) => a.memberNo.localeCompare(b.memberNo));
    const cur = all.filter(m => m.status === "Current"), former = all.filter(m => m.status === "Former");
    $("deptCount").textContent = cur.length; $("deptFormerCount").textContent = former.length;
    const card = (m, current) => `<div data-no="${esc(m.memberNo)}" class="dept-row bg-white border rounded-xl p-2 flex items-center gap-2 text-xs">
        <button onclick="openRecord('members','${esc(m.memberNo)}')" class="flex-1 min-w-0 text-left"><p class="font-bold truncate">${esc(m.fullName)}${m.role ? ` <span class="text-blue-700">· ${esc(m.role)}</span>` : ""}</p>
        <p class="font-mono text-gray-500">${esc(m.memberNo)} · ${current ? "since " + esc(m.joinedDate) : esc(m.joinedDate) + " to " + esc(m.leftDate)}</p></button>
        ${current ? `<button onclick="leaveDept('${esc(m.memberNo)}')" class="px-2 py-1.5 border rounded text-rose-700">Remove</button>` : ""}</div>`;
    $("deptMembersList").innerHTML = cur.map(m => card(m, true)).join("") || `<p class="text-xs text-gray-400 italic">No members yet.</p>`;
    $("deptFormerList").innerHTML = former.map(m => card(m, false)).join("") || `<p class="text-xs text-gray-400 italic">None.</p>`;
}
function autoTermEnd() {
    const s = $("d_termStart").value;
    if (s) { const d = new Date(s + "T00:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() + 2); $("d_termEnd").value = d.toISOString().slice(0, 10); }
}
async function saveTerm() {
    const termStart = $("d_termStart").value, termEnd = $("d_termEnd").value;
    if (!termStart || !termEnd || termEnd <= termStart) return alert("Enter a start date and an end date after it.");
    await busy("saveTermBtn", async () => {
        try {
            await parishRef().collection("departments").doc(deptState.id).set({ termStart, termEnd, updatedAt: nowIso() });
            await refreshDept(); await loadDepartments();
        } catch (e) { alert("Not saved: " + e.message); }
    });
}
// Find by number (exact) or name prefix; tap a match to add.
let dTimer = null;
function findForDept() { clearTimeout(dTimer); dTimer = setTimeout(runFindForDept, 300); }
async function runFindForDept() {
    const term = val("d_find"), box = $("d_matches");
    if (!term) { box.innerHTML = ""; return; }
    if (noType(term) === "CLG") { box.innerHTML = `<p class="text-rose-700 font-semibold">Clergy cannot join a department.</p>`; return; }
    let docs = [];
    if (noType(term) === "MBR") { const d = await parishRef().collection("members").doc(normNo(term)).get(); if (d.exists) docs = [d]; }
    else { const t = term.toLowerCase(); docs = (await parishRef().collection("members").orderBy("nameLower").startAt(t).endAt(t + "").limit(8).get()).docs; }
    box.innerHTML = docs.map(d => { const p = d.data();
        const ok = p.status === "Active";
        return `<button ${ok ? `onclick="addToDept('${esc(p.memberNo)}')"` : "disabled"} data-no="${esc(p.memberNo)}" class="dept-match w-full text-left border rounded p-2 ${ok ? "bg-emerald-50" : "bg-gray-100 text-gray-400"}">
            <i class="fa-solid ${ok ? "fa-plus text-emerald-700" : "fa-ban"}"></i> ${esc(p.fullName)} <span class="font-mono">${esc(displayNo(p))}</span>${ok ? "" : " (clergy / not active: cannot join)"}</button>`; }).join("")
        || `<p class="text-gray-400 italic">No member found.</p>`;
}
async function addToDept(memberNo) {
    if (noType(memberNo) === "CLG") return alert("Clergy cannot join a department.");
    const d = await parishRef().collection("members").doc(memberNo).get();
    if (!d.exists || d.data().status !== "Active") return alert("Only active church members can join. Clergy cannot join a department.");
    try {
        await parishRef().collection("deptMembers").doc(`${deptState.id}_${memberNo}`).set({ dept: deptState.id, memberNo, fullName: d.data().fullName,
            role: val("d_role"), status: "Current", joinedDate: today(), updatedAt: nowIso() });
        $("d_find").value = ""; $("d_role").value = ""; $("d_matches").innerHTML = "";
        await refreshDept(); await loadDepartments();
    } catch (e) { alert(e.code === "permission-denied" ? "Not added. Clergy cannot join a department." : "Not added: " + e.message); }
}
async function leaveDept(memberNo) {
    if (!confirm("Move this member to Former members?")) return;
    try {
        await parishRef().collection("deptMembers").doc(`${deptState.id}_${memberNo}`).update({ status: "Former", leftDate: today(), updatedAt: nowIso() });
        await refreshDept(); await loadDepartments();
    } catch (e) { alert("Not moved: " + e.message); }
}
async function currentDeptDocs(memberNo) {
    return (await parishRef().collection("deptMembers").where("memberNo", "==", memberNo).where("status", "==", "Current").get()).docs;
}

// ---------------------------------------------------------------- members in diaspora + transfers
function openAbroad() {
    ["ab_country", "ab_city", "ab_parish"].forEach(id => $(id).value = ""); $("ab_date").value = today();
    closeModal("recordModal"); openModal("abroadModal");
}
async function saveAbroad() {
    const m = current.rec;
    const abroadCountry = val("ab_country"), abroadCity = val("ab_city"), abroadParish = val("ab_parish"), abroadSince = $("ab_date").value;
    if (!abroadCountry || !abroadSince) return alert("Enter the country and the date they moved.");
    await busy("saveAbroadBtn", async () => {
        try {
            const depts = await currentDeptDocs(m.memberNo);
            const b = db.batch();
            b.update(parishRef().collection("members").doc(m.memberNo), { status: "Diaspora", abroadCountry, abroadCity, abroadParish, abroadSince, updatedAt: nowIso() });
            depts.forEach(d => b.update(d.ref, { status: "Former", leftDate: today(), updatedAt: nowIso() }));
            // Places only (no name, no number): lets Super Admin see where members are going.
            b.set(db.collection("flows").doc(`abroad_${localState.currentParishId}_${m.memberNo}_${abroadSince}`), { kind: "Abroad",
                fromCity: localState.parish.city || "", fromCountry: localState.parish.country || "", toCity: abroadCity, toCountry: abroadCountry, year: Number(abroadSince.slice(0, 4)) });
            b.set(statsRef(), { memberCount: inc(-1), diasporaCount: inc(1) }, { merge: true });
            await b.commit();
            closeModal("abroadModal");
            await loadParishData();
            showSection("diaspora");
        } catch (e) { alert("Not saved: " + e.message); }
    });
}
async function returnHome() {
    const m = current.rec;
    if (!confirm(m.fullName + " is back in the parish?")) return;
    try {
        const b = db.batch();
        b.update(parishRef().collection("members").doc(m.memberNo), { status: "Active", updatedAt: nowIso() });
        b.set(statsRef(), { memberCount: inc(1), diasporaCount: inc(-1) }, { merge: true });
        await b.commit();
        await loadParishData(); await openRecord("members", m.memberNo);
    } catch (e) { alert("Not saved: " + e.message); }
}
function openSendTransfer() {
    if (!localState.parish.code) return alert("Your parish has no parish code yet. Ask the Super Admin to give it one.");
    $("st_code").value = ""; $("st_consent").checked = false;
    closeModal("recordModal"); openModal("sendTransferModal");
}
async function sendTransfer() {
    const m = current.rec;
    const toCode = val("st_code").toUpperCase();
    if (!toCode) return alert("Enter the new parish's code.");
    if (!$("st_consent").checked) return alert("The member must agree to the transfer (NDPA 2023).");
    if (toCode === localState.parish.code) return alert("That is your own parish code.");
    await busy("sendTransferBtn", async () => {
        try {
            const c = await db.collection("parishCodes").doc(toCode).get();
            if (!c.exists) return alert("No parish has that code. Check it with the new parish.");
            const { status, transferId, abroadCountry, abroadCity, abroadParish, abroadSince, ordainedAs, lifeNo, lifeParishCode, ...personData } = m;
            const ref = db.collection("transfers").doc();
            const depts = await currentDeptDocs(m.memberNo);
            const b = db.batch();
            b.set(ref, { memberNo: m.memberNo, lifeNo: m.lifeNo || m.memberNo, lifeParishCode: m.lifeParishCode || localState.parish.code,
                fromParish: localState.currentParishId, fromName: localState.parish.name || "", fromCity: localState.parish.city || "",
                fromCountry: localState.parish.country || "", toParish: c.data().parishId, toCode, person: personData,
                consentGiven: true, consentDate: today(), status: "Pending", createdAt: nowIso() });
            b.update(parishRef().collection("members").doc(m.memberNo), { status: "TransferredOut", transferId: ref.id, updatedAt: nowIso() });
            depts.forEach(d => b.update(d.ref, { status: "Former", leftDate: today(), updatedAt: nowIso() }));
            b.set(statsRef(), m.status === "Diaspora" ? { diasporaCount: inc(-1) } : { memberCount: inc(-1) }, { merge: true });
            await b.commit();
            closeModal("sendTransferModal");
            await loadParishData();
            showSection("diaspora");
        } catch (e) { alert("Not sent: " + e.message); }
    });
}
async function loadDiaspora() {
    if (localState.role !== "parish_admin") return;
    $("myParishCode").textContent = localState.parish.code || "not set (ask Super Admin)";
    const pid = localState.currentParishId;
    const [abroad, incoming, outgoing] = await Promise.all([
        parishRef().collection("members").where("status", "==", "Diaspora").limit(200).get(),
        db.collection("transfers").where("toParish", "==", pid).where("status", "==", "Pending").limit(50).get(),
        db.collection("transfers").where("fromParish", "==", pid).limit(100).get()]);
    $("abroadCount").textContent = abroad.size;
    $("abroadList").innerHTML = abroad.docs.map(d => { const p = d.data();
        return `<button onclick="openRecord('members','${esc(p.memberNo)}')" data-no="${esc(p.memberNo)}" class="abroad-row w-full bg-white border rounded-xl p-2 text-left text-xs">
            <p class="font-bold">${esc(p.fullName)} <span class="font-mono text-gray-500">${esc(p.memberNo)}</span></p>
            <p><i class="fa-solid fa-location-dot text-cyan-700"></i> ${esc([p.abroadCity, p.abroadCountry].filter(Boolean).join(", "))}${p.abroadParish ? " · " + esc(p.abroadParish) : ""}</p>
            <p class="text-gray-500">Since ${esc(p.abroadSince)}</p></button>`; }).join("") || `<p class="text-xs text-gray-400 italic">No members abroad.</p>`;
    $("incomingList").innerHTML = incoming.docs.map(d => { const t = d.data();
        return `<div data-id="${esc(d.id)}" class="incoming-row bg-white border rounded-xl p-2 space-y-1">
            <p class="font-bold">${esc(t.person.fullName)} <span class="font-mono text-indigo-700">Life no. ${esc(t.lifeNo)} (${esc(t.lifeParishCode)})</span></p>
            <p class="text-gray-500">From ${esc(t.fromName)}${t.fromCity ? ", " + esc(t.fromCity) : ""} · sent ${esc(t.consentDate)}</p>
            <div class="flex gap-2"><button onclick="acceptTransfer('${esc(d.id)}')" class="flex-1 py-2 bg-emerald-600 text-white rounded font-bold">Accept</button>
            <button onclick="declineTransfer('${esc(d.id)}')" class="flex-1 py-2 border rounded">Decline</button></div></div>`; }).join("")
        || `<p class="text-gray-400 italic">No transfers waiting.</p>`;
    $("outgoingList").innerHTML = outgoing.docs.map(d => { const t = d.data();
        const act = t.status === "Pending" ? `<button onclick="cancelTransfer('${esc(d.id)}')" class="underline text-rose-700">Cancel</button>`
            : ["Declined", "Cancelled"].includes(t.status) ? `<button onclick="restoreMember('${esc(t.memberNo)}')" class="underline text-emerald-700">Bring back to members</button>` : "";
        return `<div class="outgoing-row bg-white border rounded-xl p-2 text-xs"><p class="font-bold">${esc(t.person.fullName)} <span class="font-mono text-gray-500">${esc(t.memberNo)}</span></p>
            <p>To parish ${esc(t.toCode)} · <span class="transfer-status font-bold">${esc(t.status)}</span> ${act}</p></div>`; }).join("")
        || `<p class="text-xs text-gray-400 italic">None.</p>`;
}
// New parish accepts: its own record (local number) that keeps the life-long number, plus a place-only flow.
async function acceptTransfer(id) {
    try {
        const tRef = db.collection("transfers").doc(id);
        const t0 = (await tRef.get()).data();
        const newNo = await db.runTransaction(async t => {
            const c = await t.get(counterRef());
            const n = (c.exists ? c.data().mbr : 0) + 1;
            const no = numberFor("MBR-", n);
            t.update(counterRef(), { mbr: n });
            t.set(parishRef().collection("members").doc(no), { ...t0.person, memberNo: no, status: "Active", transferId: id,
                lifeNo: t0.lifeNo, lifeParishCode: t0.lifeParishCode, important: false, updatedAt: nowIso() });
            t.update(tRef, { status: "Accepted", newMemberNo: no, decidedAt: nowIso() });
            t.set(db.collection("flows").doc(id), { kind: "Transfer", fromCity: t0.fromCity, fromCountry: t0.fromCountry,
                toCity: localState.parish.city || "", toCountry: localState.parish.country || "", year: new Date().getFullYear() });
            t.set(statsRef(), { memberCount: inc(1) }, { merge: true });
            return no;
        });
        await loadParishData(); await loadDiaspora();
        await openRecord("members", newNo);
    } catch (e) { alert("Not accepted: " + e.message); }
}
async function declineTransfer(id) {
    if (!confirm("Decline this transfer?")) return;
    try { await db.collection("transfers").doc(id).update({ status: "Declined", decidedAt: nowIso() }); await loadDiaspora(); }
    catch (e) { alert("Not saved: " + e.message); }
}
async function cancelTransfer(id) {
    if (!confirm("Cancel this transfer?")) return;
    try { await db.collection("transfers").doc(id).update({ status: "Cancelled", decidedAt: nowIso() }); await loadDiaspora(); }
    catch (e) { alert("Not saved: " + e.message); }
}
async function restoreMember(memberNo) {
    try {
        const ref = parishRef().collection("members").doc(memberNo);
        if ((await ref.get()).data().status !== "TransferredOut") return alert("Already back.");
        const b = db.batch();
        b.update(ref, { status: "Active", updatedAt: nowIso() });
        b.set(statsRef(), { memberCount: inc(1) }, { merge: true });
        await b.commit();
        await loadParishData(); await loadDiaspora();
    } catch (e) { alert("Not saved: " + e.message); }
}

// ---------------------------------------------------------------- super admin: parish codes + diaspora flows
function parishCode() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from(crypto.getRandomValues(new Uint8Array(6)), b => abc[b % abc.length]).join("");
}
async function giveParishCode(parishId) {
    const code = parishCode();
    try {
        const b = db.batch();
        b.update(db.collection("parishes").doc(parishId), { code });
        b.set(db.collection("parishCodes").doc(code), { parishId });
        await b.commit();
        await loadWorld();
    } catch (e) { alert("Not saved: " + e.message); }
}
let flows = [];
async function loadFlows() {
    if (localState.role !== "super_admin") return;
    flows = (await db.collection("flows").get()).docs.map(d => d.data());
    const years = [...new Set(flows.map(f => f.year))].sort().reverse();
    $("flowYear").innerHTML = `<option value="">All years</option>` + years.map(y => `<option>${y}</option>`).join("");
    renderFlows();
}
function renderFlows() {
    const y = $("flowYear").value;
    const place = (c, k) => [c, k].filter(Boolean).join(", ") || "Unknown";
    const groups = {};
    flows.filter(f => !y || String(f.year) === y).forEach(f => {
        const k = place(f.fromCity, f.fromCountry) + " → " + place(f.toCity, f.toCountry);
        groups[k] = (groups[k] || 0) + 1;
    });
    const rows = Object.entries(groups).sort((a, b) => b[1] - a[1]);
    $("flowsList").innerHTML = `<p class="text-xs text-gray-500">Members abroad (world total): <b>${localState.worldDiaspora || 0}</b>. Each person is counted once, in one parish only.</p>` +
        (rows.map(([k, n]) => `<div class="flow-row bg-white border rounded-xl p-3 flex justify-between items-center text-xs"><span class="font-semibold">${esc(k)}</span><span class="text-lg font-bold text-cyan-700">${n}</span></div>`).join("")
        || `<p class="text-xs text-gray-400 italic">No moves recorded yet.</p>`);
}

// ---------------------------------------------------------------- Phase 4: births, children, teenagers, deaths
// Births (0-2) -> Sunday School Children (2-12) -> Teenagers (12-18) -> Members (18, new CCC-MBR number).
// Each section is independent of Members, has its own number series, and a FULL date of birth (with year).
const YOUNG = {
    births: { title: "Births", next: "children", age: 2, nextName: "Sunday School Children" },
    children: { title: "Sunday School Children", next: "teens", age: 12, nextName: "Teenagers" },
    teens: { title: "Teenagers", next: "members", age: 18, nextName: "Church Members" } };
const KIND_OF_NO = { MBR: "members", CLG: "clergy", BRT: "births", CHD: "children", TEN: "teens", DTH: "deaths" };
const kindOfNo = no => KIND_OF_NO[noType(String(no).trim())];
const normNo = no => { const m = String(no).trim().toUpperCase().match(NO_RE); return m ? `CCC-${m[1] ? m[1] + "-" + m[2] + "-" : ""}${m[3]}-${pad3(Number(m[4]))}` : ""; };
// Ages use the UTC date, the same "today" the Firestore rules use, so the app and the rules always agree.
const yearsBefore = n => `${Number(today().slice(0, 4)) - n}${today().slice(4)}`;
function ageOf(dob, at = today()) {
    if (!dob) return null;
    let a = Number(at.slice(0, 4)) - Number(dob.slice(0, 4));
    if (at.slice(5) < dob.slice(5)) a--;
    return a;
}
// The certificate number is the record number itself: CCC-{PARISH}-{CITY}-BRT-001.
const certNoOf = no => NO_RE.test(no) && (NO_RE.exec(no) || [])[1] ? no : "";
const fmtIso = v => { if (!v) return ""; const [y, m, d] = v.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

function youngCard(kind, d) {
    const p = d.data();
    const age = ageOf(p.dob);
    const sub = kind === "deaths" ? `Died ${fmtIso(p.dateOfDeath)}${p.age != null ? " · aged " + p.age : ""}`
        : `Born ${fmtIso(p.dob)} · age ${age}` + (p.status === "Moved" ? ` · moved to ${p.movedTo}` : p.status === "Called to glory" ? " · Called to glory" : "");
    return `<button data-no="${esc(p.no)}" onclick="openYoungRecord('${kind}','${esc(p.no)}')" class="young-row w-full bg-white border rounded-xl p-2 text-left shadow-sm ${p.status && p.status !== "Active" ? "opacity-70" : ""}">
        <p class="font-bold truncate">${esc(p.fullName)}</p><p class="text-[11px] text-gray-500 font-mono">${esc(p.no)}</p>
        <p class="text-[11px] text-gray-500 truncate">${esc(sub)}</p></button>`;
}
const loadYoung = (kind, reset) => loadPage(kind, parishRef().collection(kind).orderBy(firebase.firestore.FieldPath.documentId()),
    kind + "List", d => youngCard(kind, d), reset);

// Officiating clergy: pick an Active clergy of this parish, or type a name.
async function fillOfficiants(selectId) {
    const snap = await parishRef().collection("clergy").where("status", "==", "Active").limit(100).get();
    $(selectId).innerHTML = `<option value="">Not listed (type below)</option>` + snap.docs.map(d => {
        const c = d.data(); return `<option value="${esc(c.memberNo)}">${esc([c.rank, c.fullName].filter(Boolean).join(" "))} (${esc(c.memberNo)})</option>`; }).join("");
}
function officiantOf(selectId, otherId) {
    const sel = $(selectId);
    return sel.value ? { officiant: sel.value, officiantName: sel.options[sel.selectedIndex].text.replace(/ \(CCC-[A-Z0-9-]+\)$/, "").slice(0, 160) }
        : { officiant: "", officiantName: val(otherId).slice(0, 160) };
}
// "CCC-MBR-001" (linked, must exist here) or a plain name (free text).
async function resolvePerson(text) {
    const no = normNo(text);
    if (!no) return { no: "", name: text.trim() };
    const kind = kindOfNo(no);
    if (!["members", "clergy"].includes(kind)) throw new Error(text + " is not a member or clergy number.");
    const d = await parishRef().collection(kind).doc(no).get();
    if (!d.exists) throw new Error(no + " is not in this parish.");
    return { no, name: d.data().fullName };
}

// ---- add / edit a birth, child or teenager
let yform = { kind: "births", old: null };
function openYoungForm(kind, existing) {
    yform = { kind, old: existing || null };
    const p = existing || {};
    const set = (id, v) => $(id).value = v ?? "";
    set("y_name", p.fullName); set("y_gender", p.gender); set("y_dob", p.dob); set("y_place", p.place);
    set("y_father", p.fatherNo || p.fatherName); set("y_mother", p.motherNo || p.motherName); set("y_naming", p.namingDate);
    set("y_officiantOther", p.officiant ? "" : p.officiantName);
    set("y_parent", p.parentName); set("y_parentPhone", p.parentPhone); set("y_address", p.address);
    $("y_consent").checked = p.consentGiven === true;
    document.querySelectorAll(".y-birth").forEach(el => el.classList.toggle("hidden", kind !== "births"));
    document.querySelectorAll(".y-kid").forEach(el => el.classList.toggle("hidden", kind === "births"));
    $("youngModalTitle").textContent = existing ? "EDIT " + existing.no : kind === "births" ? "RECORD A BIRTH" : "ADD TO " + YOUNG[kind].title.toUpperCase();
    closeModal("recordModal");
    openModal("youngModal");
    if (kind === "births") fillOfficiants("y_officiant").then(() => $("y_officiant").value = p.officiant || "").catch(() => {});
}
async function saveYoung() {
    const kind = yform.kind, o = yform.old;
    const p = { fullName: val("y_name"), gender: val("y_gender"), dob: $("y_dob").value, consentGiven: $("y_consent").checked, updatedAt: nowIso() };
    p.nameLower = p.fullName.toLowerCase();
    if (!p.fullName || !p.gender || !p.dob) return alert("Fill in the name, gender and full date of birth (day, month and year).");
    if (p.dob > today()) return alert("The date of birth cannot be in the future.");
    if (!p.consentGiven) return alert("You must record the parent's consent before saving (NDPA 2023).");
    await busy("saveYoungBtn", async () => {
        try {
            if (kind === "births") {
                const [f, m] = await Promise.all([resolvePerson(val("y_father")), resolvePerson(val("y_mother"))]);
                Object.assign(p, { place: val("y_place"), fatherNo: f.no, fatherName: f.name, motherNo: m.no, motherName: m.name,
                    namingDate: $("y_naming").value }, officiantOf("y_officiant", "y_officiantOther"));
            } else Object.assign(p, { parentName: val("y_parent"), parentPhone: val("y_parentPhone"), address: val("y_address") });
            let id;
            if (o) {
                id = o.no;
                await parishRef().collection(kind).doc(id).set({ ...o, ...p, no: o.no, consentDate: o.consentDate, createdAt: o.createdAt, status: o.status });
            } else {
                Object.assign(p, { status: "Active", consentDate: today(), createdAt: nowIso() });
                id = await createRecord(kind, p);
            }
            closeModal("youngModal");
            await refreshTotals();
            await loadYoung(kind, true);
            await checkPendingMoves();
            await openYoungRecord(kind, id);
        } catch (e) { alert("Not saved: " + e.message); }
    });
}

// ---- view one record (birth / child / teen / death)
async function openYoungRecord(kind, id) {
    const d = await parishRef().collection(kind).doc(id).get();
    if (!d.exists) return;
    const p = d.data();
    current = { kind, rec: p };
    const link = no => no ? `<button onclick="openAnyRecord('${esc(no)}')" class="underline text-blue-700">${esc(no)}</button>` : "";
    const who = (no, name) => [link(no), esc(name || "")].filter(Boolean).join(" ");
    $("recordTitle").textContent = p.no + (p.status && p.status !== "Active" ? " · " + p.status : "");
    let body = `<p class="text-base font-bold">${esc(p.fullName)}</p><p class="font-mono text-gray-500">${esc(p.no)}</p><div>`;
    if (kind === "deaths") {
        body += row("Linked record", link(p.personNo)) + row("Gender", esc(p.gender)) + row("Date of death", esc(fmtIso(p.dateOfDeath)))
            + row("Age", esc(p.age ?? "")) + row("Place", esc(p.place)) + row("Burial", esc(fmtIso(p.burialDate)))
            + row("Officiating clergy", who(p.officiant, p.officiantName)) + row("Informant", esc(p.informant)) + row("Notes", esc(p.notes));
    } else {
        body += row("Gender", esc(p.gender)) + row("Date of birth", esc(fmtIso(p.dob))) + row("Age", esc(ageOf(p.dob)));
        if (kind === "births") body += row("Place of birth", esc(p.place)) + row("Father", who(p.fatherNo, p.fatherName)) + row("Mother", who(p.motherNo, p.motherName))
            + row("Naming ceremony", esc(fmtIso(p.namingDate))) + row("Officiating clergy", who(p.officiant, p.officiantName));
        else body += row("Parent / guardian", esc(p.parentName)) + row("Parent phone", esc(p.parentPhone)) + row("Address", esc(p.address));
        body += row("Came from", link(p.fromNo)) + row("Moved to", link(p.movedTo)) + row("Moved on", esc((p.movedAt || "").slice(0, 10)))
            + row("Called to glory", link(p.deathId));
    }
    $("recordBody").innerHTML = body + "</div>";
    const btn = (label, fn, cls) => `<button onclick="${fn}" class="px-3 py-2 rounded font-semibold ${cls}">${label}</button>`;
    let actions = "";
    if (YOUNG[kind] && p.status === "Active") actions += btn("Edit", `openYoungForm('${kind}', current.rec)`, "bg-blue-600 text-white");
    if (kind === "births") actions += btn('<i class="fa-solid fa-print"></i> Birth certificate', `showCertificate('births','${esc(p.no)}')`, "bg-emerald-700 text-white");
    if (kind === "deaths") actions += btn('<i class="fa-solid fa-print"></i> Death certificate', `showCertificate('deaths','${esc(p.no)}')`, "bg-gray-800 text-white");
    if (YOUNG[kind] && p.status === "Active") actions += btn("Called to glory", `openDeathForm('${kind}')`, "bg-gray-800 text-white");
    $("recordActions").innerHTML = actions + btn("Close", "closeModal('recordModal')", "border");
    openModal("recordModal");
}
function openAnyRecord(no) {
    const kind = kindOfNo(no);
    return ["members", "clergy"].includes(kind) ? openRecord(kind, no) : openYoungRecord(kind, no);
}

// ---- deaths: one record, the linked person is marked "Called to glory" in the same write (never deleted)
let dform = { kind: "", rec: null };
function openDeathForm(kind) {
    dform = kind ? { kind, rec: current.rec } : { kind: "", rec: null };
    const r = dform.rec || {};
    const no = r.no || r.memberNo || "";
    ["x_name", "x_age", "x_place", "x_burial", "x_officiantOther", "x_informant", "x_notes"].forEach(id => $(id).value = "");
    $("x_link").value = no; $("x_link").readOnly = !!no;
    $("x_name").value = r.fullName || ""; $("x_gender").value = r.gender || ""; $("x_date").value = today();
    closeModal("recordModal");
    openModal("deathModal");
    fillOfficiants("x_officiant").catch(() => {});
}
async function saveDeath() {
    const dateOfDeath = $("x_date").value;
    let personNo = normNo(val("x_link"));
    if (val("x_link") && !personNo) return alert("The number should look like CCC-MBR-001 (or leave it blank).");
    if (!dateOfDeath) return alert("Enter the date of death.");
    await busy("saveDeathBtn", async () => {
        try {
            let kind = "", rec = null;
            if (personNo) {
                kind = kindOfNo(personNo);
                if (!kind || kind === "deaths") throw new Error("That number cannot be used here.");
                const d = await parishRef().collection(kind).doc(personNo).get();
                if (!d.exists) throw new Error(personNo + " is not in this parish.");
                rec = d.data();
                const ok = kind === "members" ? ["Active", "Diaspora"].includes(rec.status) : rec.status === "Active";
                if (!ok) throw new Error(personNo + " cannot be marked (status: " + rec.status + ").");
            }
            const fullName = rec ? rec.fullName : val("x_name");
            if (!fullName) throw new Error("Enter the name of the deceased.");
            let age = $("x_age").value ? Number($("x_age").value) : null;
            const dob = rec ? (rec.dob || (rec.dobYear ? `${rec.dobYear}-${String(rec.dobMonth).padStart(2, "0")}-${String(rec.dobDay).padStart(2, "0")}` : "")) : "";
            if (age == null && dob) age = ageOf(dob, dateOfDeath);
            const data = { fullName, nameLower: fullName.toLowerCase(), personNo, gender: rec ? rec.gender : val("x_gender"), dateOfDeath, age,
                place: val("x_place"), burialDate: $("x_burial").value, informant: val("x_informant"), notes: val("x_notes").slice(0, 500),
                ...officiantOf("x_officiant", "x_officiantOther"), createdAt: nowIso(), updatedAt: nowIso() };
            const depts = kind === "members" ? await currentDeptDocs(personNo) : [];
            const id = await createRecord("deaths", data, (t, newId) => {
                if (!kind) return;
                const ref = parishRef().collection(kind).doc(personNo);
                if (kind === "clergy") {
                    t.update(ref, { status: "Former", leftDate: dateOfDeath, leaveReason: "Called to glory", deathId: newId, updatedAt: nowIso(),
                        serviceRecord: (rec.serviceRecord || []).map(r => r.to ? r : { ...r, to: dateOfDeath }) });
                    t.set(statsRef(), { clergyCount: inc(-1), formerClergyCount: inc(1) }, { merge: true });
                } else {
                    t.update(ref, { status: "Called to glory", deathId: newId, updatedAt: nowIso() });
                    const stat = kind === "members" ? (rec.status === "Diaspora" ? "diasporaCount" : "memberCount") : SERIES[kind].stat;
                    t.set(statsRef(), { [stat]: inc(-1) }, { merge: true });
                    depts.forEach(x => t.update(x.ref, { status: "Former", leftDate: dateOfDeath, updatedAt: nowIso() }));
                }
            });
            closeModal("deathModal");
            await loadParishData();
            showSection("deaths");
            await openYoungRecord("deaths", id);
        } catch (e) { alert("Not saved: " + e.message); }
    });
}

// ---- printable certificates (browser print -> "Save as PDF")
async function showCertificate(kind, id) {
    const d = await parishRef().collection(kind).doc(id).get();
    if (!d.exists) return;
    const p = d.data(), parish = localState.parish || {};
    const certNo = certNoOf(p.no);
    if (!certNo) return alert("Certificates need the parish lettering (e.g. IJY-ABK). Ask the Super Admin to set it for your parish.");
    const logo = `<img src="assets/ccc-logo.png" alt="Celestial Church of Christ logo" class="ccc-logo h-20 w-auto object-contain mx-auto">`;
    const line = (k, v) => `<tr><td class="py-1 pr-2 text-gray-600 align-top w-2/5">${esc(k)}</td><td class="py-1 font-semibold border-b border-dotted border-gray-400">${esc(v || "-")}</td></tr>`;
    const isBirth = kind === "births";
    const rows = isBirth
        ? line("Name of child", p.fullName) + line("Gender", p.gender) + line("Date of birth", fmtIso(p.dob)) + line("Place of birth", p.place)
          + line("Father", [p.fatherName, p.fatherNo && `(${p.fatherNo})`].filter(Boolean).join(" ")) + line("Mother", [p.motherName, p.motherNo && `(${p.motherNo})`].filter(Boolean).join(" "))
          + line("Naming ceremony", fmtIso(p.namingDate)) + line("Officiating clergy", p.officiantName)
        : line("Name of deceased", p.fullName) + line("Church number", p.personNo) + line("Gender", p.gender) + line("Date of death", fmtIso(p.dateOfDeath))
          + line("Age", p.age ?? "") + line("Place of death", p.place) + line("Date of burial", fmtIso(p.burialDate)) + line("Officiating clergy", p.officiantName);
    $("certPrint").innerHTML = `<div class="border-4 border-double ${isBirth ? "border-emerald-800" : "border-gray-800"} p-5 space-y-3 bg-white text-gray-900">
        <div class="text-center space-y-1">${logo}
            <p class="text-lg font-black tracking-wider text-blue-950">CELESTIAL CHURCH OF CHRIST</p>
            <p class="text-[10px] tracking-[0.3em] text-gray-600">WORLD-WIDE</p>
            <p class="text-sm font-bold">${esc(parish.name || "")}</p>
            <p class="text-[11px] text-gray-600">${esc([parish.address, parish.city, parish.state, parish.country].filter(Boolean).join(", "))}</p></div>
        <p class="text-center text-xl font-serif font-bold uppercase tracking-widest ${isBirth ? "text-emerald-800" : "text-gray-800"}">${isBirth ? "Certificate of Birth" : "Certificate of Death"}</p>
        <p class="text-center text-xs">Certificate No. <span id="certNo" class="font-mono font-bold">${esc(certNo)}</span></p>
        <p class="text-xs italic text-center">${isBirth ? "This is to certify that the child named below was born and named in this parish." : "This is to certify that the person named below was called to glory and laid to rest by this parish."}</p>
        <table class="w-full text-xs">${rows}</table>
        <div class="grid grid-cols-2 gap-6 pt-10 text-[11px] text-center">
            <div><div class="border-t border-gray-700 pt-1">Shepherd-in-charge</div></div>
            <div><div class="border-t border-gray-700 pt-1">${isBirth ? "Officiating clergy" : "Parish secretary"}</div></div></div>
        <p class="text-[10px] text-gray-500 text-center">Issued ${esc(fmtIso(today()))} · Parish seal:</p></div>`;
    closeModal("recordModal");
    document.body.classList.add("cert-mode");
    openModal("certModal");
}
function closeCertificate() { document.body.classList.remove("cert-mode"); closeModal("certModal"); }

// ---- Letter of Introduction (Batch 14): members get a letter on request instead of a certificate.
// Saved as parishes/{p}/letters/CCC-{PARISH}-{CITY}-LOI-001 (own counter meta/loi) with an audit entry in the same write.
// Signatories default to Head Shepherd + Parochial Chairman; Church Secretary is optional. Titles and names are editable per letter.
const LETTER_SIGNERS = [["Head Shepherd", true], ["Parochial Chairman/Chairperson", true], ["Church Secretary", false]];
let lform = { rec: null };
async function openLetterForm() {
    lform = { rec: current.rec };
    if (!letteringOf()) return alert("Letters need the parish lettering (e.g. IJY-ABK). Ask the Super Admin to set it for your parish.");
    $("l_member").textContent = `${lform.rec.fullName} (${lform.rec.memberNo})`;
    $("l_to").value = "To whom it may concern"; $("l_purpose").value = ""; $("l_date").value = localToday();
    // Names are remembered from the last letter this parish issued.
    let last = [];
    try { const s = await parishRef().collection("letters").orderBy("issuedAt", "desc").limit(1).get(); last = s.empty ? [] : s.docs[0].data().signatories; } catch (e) { last = []; }
    LETTER_SIGNERS.forEach(([title, on], i) => {
        const prev = last.find(x => x.role === i) || {};
        $("l_sig" + i + "_on").checked = on || !!last.find(x => x.role === i && i === 2);
        $("l_sig" + i + "_title").value = prev.title || title;
        $("l_sig" + i + "_name").value = prev.name || "";
    });
    closeModal("recordModal");
    openModal("letterModal");
}
function readSigners() {
    return LETTER_SIGNERS.map((_, i) => ({ role: i, title: val("l_sig" + i + "_title").slice(0, 80), name: val("l_sig" + i + "_name").slice(0, 120), on: $("l_sig" + i + "_on").checked }))
        .filter(x => x.on).map(({ role, title, name }) => ({ role, title, name }));
}
async function issueLetter() {
    const m = lform.rec, signatories = readSigners();
    const data = { memberNo: m.memberNo, memberName: m.fullName, gender: m.gender || "", addressedTo: val("l_to").slice(0, 200),
        purpose: val("l_purpose").slice(0, 500), date: $("l_date").value, signatories };
    if (!data.addressedTo || !data.purpose || !data.date) return alert("Fill in who it is addressed to, the purpose and the date.");
    if (!signatories.length || signatories.some(x => !x.title || !x.name)) return alert("Each signatory needs a title and a name.");
    const cRef = parishRef().collection("meta").doc("loi"), pid = localState.currentParishId;
    await busy("issueLetterBtn", async () => {
        try {
            const no = await db.runTransaction(async t => {
                const c = await t.get(cRef);
                const n = (c.exists ? c.data().n : 0) + 1, id = numberFor("LOI-", n);
                const target = `parishes/${pid}/letters/${id}`;
                t.set(cRef, { n });
                t.set(parishRef().collection("letters").doc(id), { ...data, no: id, version: 1, issuedAt: nowIso(), issuedBy: localState.user.uid });
                t.set(db.collection("auditLog").doc(target.replace(/\//g, "_") + "_v1"), { action: "issue-letter", target, targetVersion: 1, parishId: pid,
                    reason: "", before: null, after: { no: id, memberNo: m.memberNo, addressedTo: data.addressedTo, date: data.date },
                    by: localState.user.uid, byEmail: (localState.user.email || "").toLowerCase(), byName: localState.name || "", role: localState.role,
                    at: firebase.firestore.FieldValue.serverTimestamp() });
                return id;
            });
            closeModal("letterModal");
            await showLetterOfIntro(no);
        } catch (e) { alert("Letter not issued: " + e.message); }
    });
}
const letterText = (l, parish) => {
    const pr = l.gender === "Female" ? ["her", "she"] : l.gender === "Male" ? ["him", "he"] : ["them", "they"];
    return [`Halleluyah 🙌!`, `We write to introduce ${l.memberName} (${l.memberNo}), a bona fide member in good standing of Celestial Church of Christ, ${parish.name || ""}.`,
        `Purpose: ${l.purpose}`, `We commend ${pr[0]} to you and pray that ${pr[1]} will be received in the Lord. Any assistance given will be appreciated.`,
        `Yours in the service of Christ,`];
};
async function showLetterOfIntro(no) {
    const d = await parishRef().collection("letters").doc(no).get();
    if (!d.exists) return;
    const l = d.data(), parish = localState.parish || {};
    const paras = letterText(l, parish);
    $("certPrint").innerHTML = `<div id="introLetter" class="border-4 border-double border-blue-950 p-5 space-y-3 bg-white text-gray-900 text-xs">
        <div class="text-center space-y-1 border-b-2 border-blue-950 pb-2"><img src="assets/ccc-logo.png" alt="Celestial Church of Christ logo" class="ccc-logo h-20 w-auto object-contain mx-auto">
            <p class="text-lg font-black tracking-wider text-blue-950">CELESTIAL CHURCH OF CHRIST</p>
            <p class="text-[10px] tracking-[0.3em] text-gray-600">WORLD-WIDE</p>
            <p class="text-sm font-bold">${esc(parish.name || "")}</p>
            <p class="text-[11px] text-gray-600">${esc([parish.address, parish.city, parish.state, parish.country].filter(Boolean).join(", "))}</p></div>
        <div class="flex justify-between"><p>Ref: <span id="letterNo" class="font-mono font-bold">${esc(l.no)}</span></p><p>${esc(fmtIso(l.date))}</p></div>
        <p class="font-semibold">${esc(l.addressedTo)}</p>
        <p class="text-center font-serif font-bold uppercase tracking-widest text-blue-950">Letter of Introduction</p>
        ${paras.map(x => `<p>${esc(x)}</p>`).join("")}
        <div class="grid grid-cols-${Math.min(l.signatories.length, 3)} gap-4 pt-10 text-[11px] text-center">
            ${l.signatories.map(x => `<div class="letter-signer"><div class="border-t border-gray-700 pt-1 font-semibold">${esc(x.name)}</div><div>${esc(x.title)}</div></div>`).join("")}</div>
        <p class="text-[10px] text-gray-500 text-center">Parish seal:</p></div>
        <button onclick="shareLetter('${esc(l.no)}')" class="no-print mt-2 w-full py-2 bg-emerald-700 text-white rounded font-bold text-xs"><i class="fa-solid fa-share-nodes"></i> Share</button>`;
    lform.last = l;
    document.body.classList.add("cert-mode");
    openModal("certModal");
}
async function shareLetter() {
    const l = lform.last, parish = localState.parish || {};
    const text = ["CELESTIAL CHURCH OF CHRIST", parish.name || "", `Ref: ${l.no} · ${fmtIso(l.date)}`, l.addressedTo, "LETTER OF INTRODUCTION",
        ...letterText(l, parish), ...l.signatories.map(x => `${x.name}, ${x.title}`)].join("\n");
    if (navigator.share) { try { await navigator.share({ title: "Letter of Introduction " + l.no, text }); return; } catch (e) { if (e.name === "AbortError") return; } }
    window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank");
}

// ---- pending moves by age. There is no server: on app load the parish admin's browser lists who is due,
// and one tap moves them all. Each move is one transaction (new record + new number + old record marked
// Moved -> new id, with movedAt / movedBy), and the Firestore rules re-check the age against the server date.
let pending = [];
async function checkPendingMoves() {
    if (localState.role !== "parish_admin") return;
    const snaps = await Promise.all(Object.entries(YOUNG).map(([kind, y]) =>
        parishRef().collection(kind).where("status", "==", "Active").where("dob", "<=", yearsBefore(y.age)).limit(50).get()
            .then(s => s.docs.map(d => ({ kind, rec: d.data() })))));
    pending = snaps.flat();
    const box = $("pendingMoves");
    box.classList.toggle("hidden", !pending.length);
    box.innerHTML = pending.length ? `<p class="font-bold"><i class="fa-solid fa-arrow-up-right-dots"></i> ${pending.length} ${pending.length === 1 ? "person is" : "people are"} due to move up by age</p>
        <div class="space-y-1">${pending.map(x => `<div class="pending-row flex justify-between gap-2 bg-white rounded p-2"><span><b>${esc(x.rec.fullName)}</b> <span class="font-mono text-gray-500">${esc(x.rec.no)}</span> · age ${ageOf(x.rec.dob)}</span><span class="text-right">→ ${esc(YOUNG[x.kind].nextName)}</span></div>`).join("")}</div>
        <button id="moveAllBtn" onclick="moveAllPending()" class="w-full py-2.5 bg-violet-700 text-white rounded-lg font-bold">Move them all now</button>` : "";
}
async function moveOne(kind, rec) {
    const y = YOUNG[kind];
    const stamp = { createdAt: nowIso(), updatedAt: nowIso(), consentGiven: true, consentDate: rec.consentDate };
    let person;
    if (y.next === "members") {
        const [yr, mo, da] = rec.dob.split("-").map(Number);
        person = { fullName: rec.fullName, nameLower: rec.nameLower, gender: rec.gender, maritalStatus: "Single", address: rec.address || "",
            phone: "", phoneDigits: "", email: "", rank: "", occupation: "", dobDay: da, dobMonth: mo, dobYear: yr,
            nokName: rec.parentName || "", nokPhone: rec.parentPhone || "", nokAddress: rec.address || "", photo: "", important: false,
            status: "Active", fromNo: rec.no, ...stamp };
    } else {
        person = { fullName: rec.fullName, nameLower: rec.nameLower, gender: rec.gender, dob: rec.dob, status: "Active", fromNo: rec.no,
            parentName: rec.parentName || [rec.fatherName, rec.motherName].filter(Boolean).join(" & ").slice(0, 250),
            parentPhone: rec.parentPhone || "", address: rec.address || "", ...stamp };
    }
    return createRecord(y.next, person, (t, newId) => {
        t.update(parishRef().collection(kind).doc(rec.no), { status: "Moved", movedTo: newId, movedAt: nowIso(), movedBy: localState.user.uid, updatedAt: nowIso() });
        t.set(statsRef(), { [SERIES[kind].stat]: inc(-1) }, { merge: true });
    });
}
async function moveAllPending() {
    if (!pending.length) return;
    await busy("moveAllBtn", async () => {
        const done = [], failed = [];
        // Oldest stage first, so a record is never moved twice in one tap.
        for (const x of [...pending].sort((a, b) => YOUNG[b.kind].age - YOUNG[a.kind].age)) {
            try { done.push(`${x.rec.no} → ${await moveOne(x.kind, x.rec)}`); }
            catch (e) { failed.push(`${x.rec.no}: ${e.message}`); }
        }
        alert(`Moved ${done.length}:\n${done.join("\n")}` + (failed.length ? `\n\nNot moved ${failed.length}:\n${failed.join("\n")}` : ""));
        await loadParishData();
    });
}

// ============================================================================ AI-Assisted Data Entry (Phase 5)
// The file is read in the browser where possible (pdf.js, mammoth, SheetJS); photos and scanned PDFs go to the
// "ccc-ai" Cloudflare Worker (Gemini). The worker needs the admin's Firebase ID token. Nothing is saved until the
// admin ticks people + consent and taps "Save selected", which uses the normal createRecord path (rules apply).
const AI_URL = "https://ccc-ai.aarinat-company-limited.workers.dev/extract";
const LIBS = {
    pdf: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
    pdfWorker: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js",
    mammoth: "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js",
    xlsx: "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"
};
const AI_FIELDS = [["fullName", "Name"], ["gender", "Gender"], ["maritalStatus", "Marital status"], ["address", "Address"],
    ["phone", "Phone"], ["email", "Email"], ["rank", "Rank"], ["occupation", "Occupation"], ["nokName", "Next of kin"],
    ["nokAddress", "Next of kin address"], ["nokPhone", "Next of kin phone"]];
let ai = { people: [] };

const loadedLibs = {};
function loadLib(url) {
    return loadedLibs[url] ||= new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = url; s.onload = resolve; s.onerror = () => reject(new Error("Could not load a reader. Check your internet and try again."));
        document.head.appendChild(s);
    });
}
const fileToBase64 = file => new Promise((resolve, reject) => {
    const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1]); r.onerror = reject; r.readAsDataURL(file);
});

function openAiEntry() {
    ai = { people: [] };
    $("aiFile").value = ""; $("aiStatus").textContent = ""; $("aiResults").innerHTML = "";
    $("ai_consent").checked = false; $("aiSaveBar").classList.add("hidden");
    openModal("aiModal");
}

// Returns { text } when the browser can read it, or { file, mime } for the vision AI.
async function readListFile(file) {
    const name = file.name.toLowerCase(), ext = name.split(".").pop();
    if (file.type.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "heic"].includes(ext)) {
        const dataUrl = await compressImage(file, 1500000, 2000); // keeps handwriting readable, under the worker limit
        return { file: dataUrl.split(",")[1], mime: "image/jpeg", how: "photo (vision AI)" };
    }
    if (["txt", "csv"].includes(ext)) return { text: await file.text(), how: ext.toUpperCase() + " text" };
    if (["xlsx", "xls"].includes(ext)) {
        await loadLib(LIBS.xlsx);
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        return { text: wb.SheetNames.map(n => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n\n"), how: "Excel sheet" };
    }
    if (ext === "docx") {
        await loadLib(LIBS.mammoth);
        const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
        // Keep table rows on one line ("cell | cell") so the AI sees each person's row together.
        const doc = new DOMParser().parseFromString(value, "text/html");
        doc.querySelectorAll("tr").forEach(tr => tr.replaceWith(doc.createTextNode([...tr.children].map(td => td.textContent.trim()).join(" | ") + "\n")));
        doc.querySelectorAll("p,li,h1,h2,h3").forEach(el => el.append("\n"));
        return { text: doc.body.textContent, how: "Word document" };
    }
    if (ext === "pdf" || file.type === "application/pdf") {
        await loadLib(LIBS.pdf);
        pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
        const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        let text = "";
        for (let i = 1; i <= pdf.numPages; i++) {
            const items = (await (await pdf.getPage(i)).getTextContent()).items;
            let lastY = null;
            for (const it of items) { // new line when the y position changes (table rows)
                const y = Math.round(it.transform[5]);
                text += lastY !== null && Math.abs(y - lastY) > 2 ? "\n" : (text && !text.endsWith("\n") ? " " : "");
                text += it.str; lastY = y;
            }
            text += "\n";
        }
        if (text.replace(/\s/g, "").length > 30) return { text, how: "PDF text" };
        if (file.size > 6000000) throw new Error("This scanned PDF is too big (over 6 MB). Take photos of the pages instead.");
        return { file: await fileToBase64(file), mime: "application/pdf", how: "scanned PDF (vision AI)" };
    }
    throw new Error("This file type is not supported. Use PDF, DOCX, TXT, CSV, XLSX, JPG or PNG.");
}

async function callAi(payload) {
    const token = await auth.currentUser.getIdToken();
    const r = await fetch(AI_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || ("AI service error " + r.status));
    return d.people || [];
}

async function runAiExtract() {
    const file = $("aiFile").files[0];
    if (!file) return alert("Choose a file first.");
    await busy("aiReadBtn", async () => {
        try {
            $("aiStatus").textContent = "Reading the file...";
            const input = await readListFile(file);
            $("aiStatus").textContent = `Read as ${input.how}. Asking the AI to find each person...`;
            delete input.how;
            const people = await callAi(input);
            ai.people = people.map(d => ({ d, selected: true, photo: "", saved: "", error: "", dup: "", editing: false }));
            await Promise.all(ai.people.map(findDuplicate));
            $("aiStatus").textContent = `Found ${people.length} ${people.length === 1 ? "person" : "people"}. Check each card, fix anything wrong, then save.`;
            renderAiCards();
        } catch (e) {
            console.error("ai extract", e.message);
            $("aiStatus").textContent = "Could not read the file: " + e.message;
        }
    });
}

// Warns when a name or phone already exists among members or clergy.
async function findDuplicate(x) {
    const hits = new Set();
    const name = x.d.fullName.trim().toLowerCase(), phone = (x.d.phone || "").replace(/\D/g, "");
    for (const col of ["members", "clergy"]) {
        const qs = [parishRef().collection(col).where("nameLower", "==", name).limit(3)];
        if (phone.length >= 7) qs.push(parishRef().collection(col).where("phoneDigits", "==", phone).limit(3));
        for (const q of qs) (await q.get().catch(() => ({ docs: [] }))).docs.forEach(doc => hits.add(`${doc.id} (${doc.data().fullName})`));
    }
    x.dup = [...hits].join(", ");
    if (x.dup) x.selected = false; // the admin must tick it on purpose
}

function aiMissing(d) {
    const m = [];
    if (!d.fullName) m.push("name"); if (!d.gender) m.push("gender"); if (!d.maritalStatus) m.push("marital status");
    if (!d.dobDay || !d.dobMonth) m.push("date of birth");
    return m;
}

function renderAiCards() {
    const opt = (list, v, first) => `<option value="">${first}</option>` + list.map(([k, t]) => `<option value="${esc(k)}"${String(k) === String(v ?? "") ? " selected" : ""}>${esc(t)}</option>`).join("");
    const days = Array.from({ length: 31 }, (_, i) => [i + 1, i + 1]), months = MONTHS.map((m, i) => [i + 1, m]);
    const yr = new Date().getFullYear(), years = Array.from({ length: yr - 1899 }, (_, i) => [yr - i, yr - i]);
    $("aiResults").innerHTML = ai.people.map((x, i) => {
        const d = x.d, missing = aiMissing(d);
        const status = x.saved ? `<div class="text-green-700 font-semibold"><i class="fa-solid fa-check"></i> Saved as ${esc(x.saved)}</div>`
            : x.error ? `<div class="text-red-700 text-xs">Not saved: ${esc(x.error)}</div>` : "";
        const summary = `<div class="text-xs text-gray-600 space-y-0.5">
            ${AI_FIELDS.slice(1).map(([k, t]) => d[k] ? `<div><span class="text-gray-400">${t}:</span> ${esc(d[k])}</div>` : "").join("")}
            ${d.rankAsWritten ? `<div class="text-amber-700">Rank written as "${esc(d.rankAsWritten)}" is not on the ${esc(d.gender || "")} rank list: pick one in Edit.</div>` : ""}
            <div><span class="text-gray-400">Date of birth:</span> ${fmtDate(d.dobDay, d.dobMonth, d.dobYear)} · <span class="text-gray-400">Last anointment:</span> ${fmtDate(d.anointDay, d.anointMonth, d.anointYear)}</div></div>`;
        const inp = (k, t) => `<label class="block text-xs">${t}<input data-k="${k}" value="${esc(d[k] || "")}" class="w-full border p-2 rounded mt-0.5"></label>`;
        const editor = `<div class="space-y-2 border-t pt-2">
            ${inp("fullName", "Name *")}
            <div class="grid grid-cols-2 gap-2">
              <label class="text-xs">Gender *<select data-k="gender" class="w-full border p-2 rounded mt-0.5 bg-white">${opt([["Male", "Male"], ["Female", "Female"]], d.gender, "Select")}</select></label>
              <label class="text-xs">Marital status *<select data-k="maritalStatus" class="w-full border p-2 rounded mt-0.5 bg-white">${opt(["Single", "Married", "Widowed", "Divorced", "Separated"].map(v => [v, v]), d.maritalStatus, "Select")}</select></label></div>
            ${inp("address", "Address")}
            <div class="grid grid-cols-2 gap-2">${inp("phone", "Phone")}${inp("email", "Email")}</div>
            <label class="block text-xs">Rank<select data-k="rank" class="w-full border p-2 rounded mt-0.5 bg-white">${opt(ranksFor(d.gender).map(r => [r, r]), d.rank, d.gender ? "No rank / not listed" : "Choose gender first")}</select></label>
            ${inp("occupation", "Occupation")}
            <div class="text-xs">Date of birth *</div><div class="grid grid-cols-3 gap-1">
              <select data-k="dobDay" class="border p-2 rounded bg-white">${opt(days, d.dobDay, "Day")}</select><select data-k="dobMonth" class="border p-2 rounded bg-white">${opt(months, d.dobMonth, "Month")}</select><select data-k="dobYear" class="border p-2 rounded bg-white">${opt(years, d.dobYear, "Year")}</select></div>
            <div class="text-xs">Last anointment</div><div class="grid grid-cols-3 gap-1">
              <select data-k="anointDay" class="border p-2 rounded bg-white">${opt(days, d.anointDay, "Day")}</select><select data-k="anointMonth" class="border p-2 rounded bg-white">${opt(months, d.anointMonth, "Month")}</select><select data-k="anointYear" class="border p-2 rounded bg-white">${opt(years, d.anointYear, "Year")}</select></div>
            ${inp("nokName", "Next of kin name")}${inp("nokAddress", "Next of kin address")}${inp("nokPhone", "Next of kin phone")}
            <button onclick="aiEdit(${i}, false)" class="w-full py-2 bg-blue-600 text-white rounded text-xs font-semibold">Done</button></div>`;
        return `<div class="ai-card border rounded-lg p-3 ${x.saved ? "bg-green-50" : x.dup ? "bg-amber-50 border-amber-300" : "bg-white"}" data-i="${i}">
            <div class="flex items-start gap-2">
              <input type="checkbox" class="ai-pick mt-1 w-5 h-5" ${x.selected ? "checked" : ""} ${x.saved ? "disabled" : ""} onchange="ai.people[${i}].selected=this.checked" aria-label="Select ${esc(d.fullName)}">
              ${x.photo ? `<img src="${x.photo}" class="w-12 h-12 rounded object-cover" alt="">` : ""}
              <div class="flex-1 min-w-0"><div class="font-bold text-base">${esc(d.fullName || "(no name)")}</div>
                <div class="text-xs text-gray-500">${esc([d.gender, d.maritalStatus, d.rank].filter(Boolean).join(" · "))}</div></div>
              ${x.saved ? "" : `<button onclick="aiEdit(${i}, ${!x.editing})" class="ai-edit px-3 py-1.5 border rounded text-xs font-semibold bg-white"><i class="fa-solid fa-pen mr-1"></i>${x.editing ? "Close" : "Edit"}</button>`}
            </div>
            ${x.dup ? `<div class="ai-dup mt-2 text-xs text-amber-800 bg-amber-100 rounded p-2"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Possible duplicate: already have ${esc(x.dup)}. Unticked; tick only if this is a different person.</div>` : ""}
            ${missing.length && !x.saved ? `<div class="mt-1 text-xs text-red-700">Missing: ${missing.join(", ")}. Tap Edit to fill in.</div>` : ""}
            <div class="mt-2">${x.editing ? editor : summary}</div>
            ${x.saved ? "" : `<label class="mt-2 block text-xs text-gray-600">Passport photo (optional)<input type="file" accept="image/*" class="ai-photo block w-full text-xs mt-0.5" onchange="aiPhoto(${i}, this)"></label>`}
            ${status}</div>`;
    }).join("");
    $("aiResults").querySelectorAll(".ai-card").forEach(card => card.querySelectorAll("[data-k]").forEach(el => el.addEventListener("change", () => {
        const x = ai.people[card.dataset.i], k = el.dataset.k;
        x.d[k] = /^(dob|anoint)/.test(k) ? (el.value ? Number(el.value) : null) : el.value.trim();
        if (k === "gender") { if (!ranksFor(x.d.gender).includes(x.d.rank)) x.d.rank = ""; renderAiCards(); }
        if (k === "rank") x.d.rankAsWritten = "";
    })));
    $("aiSaveBar").classList.toggle("hidden", !ai.people.length);
}
function aiEdit(i, open) { ai.people.forEach((x, j) => x.editing = j === i ? open : false); renderAiCards(); }
async function aiPhoto(i, input) {
    if (!input.files[0]) return;
    try { ai.people[i].photo = await compressImage(input.files[0]); renderAiCards(); } catch (e) { alert(e.message); }
}

async function saveAiSelected() {
    const picked = ai.people.filter(x => x.selected && !x.saved);
    if (!picked.length) return alert("Tick at least one person to save.");
    if (!$("ai_consent").checked) return alert("You must record consent before saving (NDPA 2023).");
    await busy("aiSaveBtn", async () => {
        let ok = 0;
        for (const x of picked) {
            const d = x.d;
            const p = { fullName: d.fullName.trim(), gender: d.gender, maritalStatus: d.maritalStatus, address: d.address || "",
                phone: d.phone || "", email: (d.email || "").toLowerCase(), rank: ranksFor(d.gender).includes(d.rank) ? d.rank : "",
                occupation: d.occupation || "", dobDay: d.dobDay || null, dobMonth: d.dobMonth || null, dobYear: d.dobYear || null,
                anointDay: d.anointDay || null, anointMonth: d.anointMonth || null, anointYear: d.anointYear || null,
                nokName: d.nokName || "", nokAddress: d.nokAddress || "", nokPhone: d.nokPhone || "",
                photo: x.photo || "", important: false, consentGiven: true, updatedAt: nowIso() };
            p.nameLower = p.fullName.toLowerCase(); p.phoneDigits = p.phone.replace(/\D/g, "");
            const problem = checkPerson(p, "members");
            if (problem) { x.error = problem; continue; }
            p.status = "Active"; p.consentDate = today(); p.createdAt = nowIso();
            try { x.saved = await createRecord("members", p); x.error = ""; x.selected = false; ok++; }
            catch (e) { console.error("ai save", e.code, e.message); x.error = e.message; }
        }
        renderAiCards();
        const failed = picked.length - ok;
        $("aiStatus").textContent = `Saved ${ok} member${ok === 1 ? "" : "s"}.` + (failed ? ` ${failed} not saved: see the red notes.` : "");
        if (ok) await loadParishData();
    });
}
