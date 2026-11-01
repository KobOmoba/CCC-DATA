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

// The 28 ranks of the male leadership line (client brief, batch 1). Female line pending.
const RANKS = ["Brother", "Elder Brother", "Cape Elder Brother", "Full Elder Brother", "Senior Elder Brother",
    "Superior Senior Elder Brother", "Assistant Leader", "Leader", "Senior Leader", "Superior Senior Leader",
    "Honorary Assistant Evangelist", "Assistant Evangelist", "Honorary Evangelist", "Evangelist",
    "Honorary Senior Evangelist", "Senior Evangelist", "Special Most Senior Evangelist", "Most Senior Evangelist",
    "Special Venerable Most Senior Evangelist", "Venerable Most Senior Evangelist", "Assistant Superior Evangelist",
    "Superior Evangelist", "Assistant Venerable Superior Evangelist", "Venerable Superior Evangelist",
    "Assistant Most Superior Evangelist", "Most Superior Evangelist", "Supreme Evangelist", "Pastor Reverend"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const CONTINENTS = ["Africa", "Europe", "Asia", "North America", "South America", "Oceania", "Antarctica"];
const SERIES = { members: { key: "mbr", prefix: "CCC-MBR-", stat: "memberCount" }, clergy: { key: "clg", prefix: "CCC-CLG-", stat: "clergyCount" } };

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
    document.querySelectorAll(".rank-select").forEach(s => s.innerHTML = opts(RANKS.map(r => [r, r]), "No rank / not listed"));
    document.querySelectorAll(".continent-select").forEach(s => s.innerHTML = opts(CONTINENTS.map(c => [c, c]), "Continent"));
}

window.onload = function() {
    fillSelects();
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
        const { parishId } = inv.data();
        const batch = db.batch();
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
        const { role, parishId } = prof.data();
        localState = { user, role, currentParishId: parishId || "", parish: {} };
        const isParish = role === "parish_admin";
        document.querySelectorAll(".parish-only").forEach(el => el.classList.toggle("hidden", !isParish));
        document.querySelectorAll(".super-only").forEach(el => el.classList.toggle("hidden", role !== "super_admin"));
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
    $(`nav-${id}`).classList.add("bg-slate-800");
    if (id === "families") loadFamilies();
}

const parishRef = () => db.collection("parishes").doc(localState.currentParishId);
const statsRef = () => db.collection("parishStats").doc(localState.currentParishId);
const counterRef = () => parishRef().collection("meta").doc("counters");

// ---------------------------------------------------------------- branding
function showBranding(p) {
    $("dashParishName").textContent = p.name || "";
    for (const id of ["parishLogo", "settingsLogo"]) {
        const img = $(id);
        if (p.logo) { img.src = p.logo; img.classList.remove("hidden"); } else img.classList.add("hidden");
    }
    $("logoFallback").classList.toggle("hidden", !!p.logo);
}

// ---------------------------------------------------------------- parish data
const pages = { members: null, clergy: null, former: null, attendance: null, finances: null };

async function loadParishData() {
    if (!db || !localState.currentParishId) return;
    const pDoc = await parishRef().get();
    localState.parish = pDoc.exists ? pDoc.data() : {};
    showBranding(localState.parish);
    fillSettingsForm(localState.parish);
    $("welcomeTitle").textContent = "Shalom, " + (localState.parish.name || "Parish") + "!";
    const st = await statsRef().get().catch(() => null);
    showTotals(st && st.exists ? st.data() : {});
    $("memberSearch").value = "";
    await Promise.all([loadMembers(true), loadClergy(true), loadFormer(true), loadAttendance(true), loadFinances(true)]);
}

function showTotals(s) {
    const m = s.memberCount || 0, c = s.clergyCount || 0;
    $("metricTotal").textContent = m + c;
    $("metricClergy").textContent = c;
    $("metricMembers").textContent = m;
    $("metricServices").textContent = s.serviceCount || 0;
    $("metricGiving").textContent = "₦" + Number(s.financeTotal || 0).toLocaleString();
}

function displayNo(p) { return p.memberNo + (p.status === "Former" ? " · Former" : p.status === "Ordained" ? " · Ordained" : ""); }

function personCard(kind, d) {
    const p = d.data ? d.data() : d;
    const photo = p.photo ? `<img src="${esc(p.photo)}" alt="" class="w-10 h-12 object-cover rounded">` : `<div class="w-10 h-12 rounded bg-gray-200 flex items-center justify-center text-gray-400"><i class="fa-solid fa-user"></i></div>`;
    return `<button data-no="${esc(p.memberNo)}" onclick="openRecord('${kind}','${esc(p.memberNo)}')" class="person-row w-full bg-white border rounded-xl p-2 flex items-center gap-3 text-left shadow-sm">
        ${photo}
        <div class="min-w-0 flex-1"><p class="font-bold truncate">${esc(p.fullName)}${p.important ? ' <i class="fa-solid fa-star text-amber-400"></i>' : ""}</p>
        <p class="text-[11px] text-gray-500 font-mono">${esc(displayNo(p))}</p>
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
    const numberMatch = term.toUpperCase().match(/^CCC-(MBR|CLG)-(\d+)$/);
    if (numberMatch) {
        const kind = numberMatch[1] === "MBR" ? "members" : "clergy";
        const d = await parishRef().collection(kind).doc(`CCC-${numberMatch[1]}-${pad3(Number(numberMatch[2]))}`).get();
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
    set("p_phone", p.phone); set("p_email", p.email); set("p_rank", p.rank); set("p_occupation", p.occupation);
    set("p_dobDay", p.dobDay); set("p_dobMonth", p.dobMonth); set("p_dobYear", p.dobYear);
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
    return db.runTransaction(async t => {
        const c = await t.get(counterRef());
        const n = (c.exists ? c.data()[s.key] : 0) + 1;
        const id = s.prefix + pad3(n);
        t.update(counterRef(), { [s.key]: n });
        t.set(parishRef().collection(kind).doc(id), { ...p, memberNo: id });
        if (kind === "clergy") t.set(db.collection("clergyIndex").doc(p.email), { parishId: localState.currentParishId, clergyId: id });
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
                await batch.commit();
            } else {
                p.status = "Active"; p.consentDate = today(); p.createdAt = nowIso();
                if (form.kind === "clergy") p.serviceRecord = p.rank ? [{ rank: p.rank, from: p.joinedDate || today() }] : [];
                await createRecord(form.kind, p);
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
    if (p.ordainedAs) history = `Ordained as clergy: <button onclick="openRecord('clergy','${esc(p.ordainedAs)}')" class="underline text-blue-700">${esc(p.ordainedAs)}</button>`;
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
        ${row("Family", famHtml)}${row("History", history)}</div>${service}`;
    const btn = (label, fn, cls) => `<button onclick="${fn}" class="px-3 py-2 rounded font-semibold ${cls}">${label}</button>`;
    let actions = "";
    if (p.status === "Active") actions += btn("Edit", "editCurrent()", "bg-blue-600 text-white");
    if (kind === "members" && p.status === "Active") actions += btn("Ordain as clergy", "ordainCurrent()", "bg-amber-600 text-white");
    if (kind === "clergy" && p.status === "Active") actions += btn("Transfer / move to Former", "openTransfer()", "bg-amber-700 text-white");
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
        const id = await createRecord("clergy", c, (t, newId) => {
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
const kindOf = no => no.startsWith("CCC-CLG-") ? "clergy" : "members";
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
    set("s_state", p.state); set("s_country", p.country); set("s_continent", p.continent);
    $("s_mapsOpen").classList.toggle("hidden", !p.mapsUrl);
    if (p.mapsUrl) $("s_mapsOpen").href = p.mapsUrl;
    pendingLogo = null;
}
let pendingLogo = null;
async function pickLogo(input) {
    if (!input.files[0]) return;
    try {
        pendingLogo = await compressImage(input.files[0], 60000, 256);
        $("settingsLogo").src = pendingLogo; $("settingsLogo").classList.remove("hidden");
    } catch (e) { alert(e.message); }
}
function readLocation(prefix) {
    const p = { name: val(prefix + "name"), address: val(prefix + "address"), mapsUrl: val(prefix + "maps"), city: val(prefix + "city"),
        state: val(prefix + "state"), country: val(prefix + "country"), continent: val(prefix + "continent") };
    if (p.mapsUrl && !/^https:\/\//.test(p.mapsUrl)) return { error: "The Google Maps link must start with https://" };
    if (!p.name) return { error: "The parish name is required." };
    return p;
}
async function saveParishSettings() {
    const p = readLocation("s_");
    if (p.error) return alert(p.error);
    if (pendingLogo) p.logo = pendingLogo;
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
    $("welcomeTitle").textContent = localState.role === "super_admin" ? "Shalom, Super Admin!" : "Shalom, HQ!";
    $("welcomeSub").textContent = "Totals for all parishes. Ordinary member records stay private to each parish.";
    $("dashParishName").textContent = "World-wide";
    const [parishes, stats] = await Promise.all([db.collection("parishes").get(), db.collection("parishStats").get()]);
    const byId = Object.fromEntries(stats.docs.map(d => [d.id, d.data()]));
    const sum = { memberCount: 0, clergyCount: 0, serviceCount: 0, financeTotal: 0 };
    stats.docs.forEach(d => Object.keys(sum).forEach(k => sum[k] += d.data()[k] || 0));
    showTotals(sum);
    localState.parishNames = Object.fromEntries(parishes.docs.map(d => [d.id, d.data().name]));
    $("worldTable").innerHTML = `<table class="w-full text-left text-xs"><thead class="bg-gray-100"><tr><th class="p-2">Parish</th><th class="p-2">Place</th><th class="p-2">Clergy</th><th class="p-2">Members</th></tr></thead><tbody class="divide-y">` +
        parishes.docs.map(d => { const p = d.data(), s = byId[d.id] || {};
            return `<tr><td class="p-2 font-bold">${esc(p.name)}${p.status !== "Approved" ? " (" + esc(p.status) + ")" : ""}</td><td class="p-2">${esc([p.city, p.country].filter(Boolean).join(", "))}</td><td class="p-2">${s.clergyCount || 0}</td><td class="p-2">${s.memberCount || 0}</td></tr>`; }).join("") + `</tbody></table>`;
    $("worldTable").classList.remove("hidden");
    if (localState.role !== "super_admin") return;
    $("parishList").innerHTML = parishes.docs.map(d => { const p = d.data();
        return `<div class="bg-white border rounded-xl p-3 text-xs"><p class="font-bold">${esc(p.name)} <span class="text-gray-400">${esc(p.status)}</span></p><p class="text-gray-500">${esc([p.address, p.city, p.state, p.country, p.continent].filter(Boolean).join(", "))}</p></div>`; }).join("");
    const [clergy, important] = await Promise.all([
        db.collectionGroup("clergy").get(),
        db.collectionGroup("members").where("important", "==", true).get()]);
    const parishOf = d => d.ref.parent.parent.id;
    register = clergy.docs.map(d => ({ ...d.data(), parish: localState.parishNames[parishOf(d)] || parishOf(d) }));
    renderRegister();
    $("importantList").innerHTML = important.empty ? `<p class="text-xs text-gray-400 italic">No members flagged yet.</p>` :
        important.docs.map(d => worldCard({ ...d.data(), parish: localState.parishNames[parishOf(d)] })).join("");
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

function randomCode() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from(crypto.getRandomValues(new Uint8Array(20)), b => abc[b % abc.length]).join("").replace(/(.{5})(?!$)/g, "$1-");
}
// Super admin: parish + counters + totals + one-time admin invite, all in one batch.
async function createParish() {
    const p = readLocation("np_");
    if (p.error) return alert(p.error);
    const email = val("np_email").toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return alert("Enter the parish admin's email.");
    await busy("createParishBtn", async () => {
        try {
            const ref = db.collection("parishes").doc();
            const code = randomCode();
            const batch = db.batch();
            batch.set(ref, { ...p, status: "Approved", createdAt: nowIso() });
            batch.set(ref.collection("meta").doc("counters"), { clg: 0, mbr: 0 });
            batch.set(db.collection("parishStats").doc(ref.id), { memberCount: 0, clergyCount: 0, formerClergyCount: 0, attendanceTotal: 0, serviceCount: 0, financeTotal: 0, financeCount: 0 });
            batch.set(db.collection("invites").doc(code), { email, parishId: ref.id, role: "parish_admin", usedBy: null, createdAt: nowIso() });
            await batch.commit();
            $("inviteResult").innerHTML = `<p class="font-bold">Parish created. Send this to the admin:</p>
                <p class="mt-1">Email: <span class="font-mono">${esc(email)}</span></p>
                <p>Invite code: <span id="inviteCode" class="font-mono font-bold select-all">${esc(code)}</span></p>
                <p class="text-gray-600 mt-1">They open the portal, tap "First time? I have an invite code", and choose a password.</p>`;
            $("inviteResult").classList.remove("hidden");
            ["np_name", "np_address", "np_maps", "np_city", "np_state", "np_country", "np_continent", "np_email"].forEach(id => $(id).value = "");
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
function openAttendanceModal() { document.getElementById("addAttendanceModal").classList.remove('hidden'); }
function closeAttendanceModal() { document.getElementById("addAttendanceModal").classList.add('hidden'); }
async function saveAttendance() {
    if (!requireFirebase()) return;
    const date = document.getElementById("att_date").value;
    const type = document.getElementById("att_type").value.trim();
    const headcount = parseInt(document.getElementById("att_headcount").value);
    if (!date || !type || isNaN(headcount) || headcount < 0) return alert("Fill all elements.");
    try {
        const inc = firebase.firestore.FieldValue.increment;
        const batch = db.batch();
        batch.set(parishRef().collection("attendance").doc(), { serviceDate: date, serviceType: type, headcount });
        batch.set(statsRef(), { attendanceTotal: inc(headcount), serviceCount: inc(1) }, { merge: true });
        await batch.commit();
        closeAttendanceModal();
        loadParishData();
    } catch (e) {
        alert(`Failed to save log: ${e.message}`);
    }
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
        batch.set(parishRef().collection("finances").doc(), {
            transactionDate: date, contributorName: contrib, contributionType: type, amount: amt
        });
        batch.set(statsRef(), { financeTotal: inc(amt), financeCount: inc(1) }, { merge: true });
        await batch.commit();
        closeFinanceModal();
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
