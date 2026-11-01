// PARISH DATABASE ENGINE & GATEWAY (Firebase)

// ============================================================================
// PLACEHOLDER FIREBASE CONFIG - NOT A REAL PROJECT.
// Replace every value below with the config of your own Firebase project
// (Firebase console > Project settings > Your apps > Web app). See README.md.
// ============================================================================
const firebaseConfig = {
    apiKey: "PLACEHOLDER_API_KEY",
    authDomain: "PLACEHOLDER_PROJECT_ID.firebaseapp.com",
    projectId: "PLACEHOLDER_PROJECT_ID",
    storageBucket: "PLACEHOLDER_PROJECT_ID.appspot.com",
    messagingSenderId: "PLACEHOLDER_SENDER_ID",
    appId: "PLACEHOLDER_APP_ID"
};
const CONFIG_IS_PLACEHOLDER = firebaseConfig.apiKey.startsWith("PLACEHOLDER");

let auth = null;
let db = null;
let localState = { user: null, role: "", currentParishId: "" };

// Escape user text before it goes into HTML.
function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
}

window.onload = function() {
    if (CONFIG_IS_PLACEHOLDER || !window.firebase) {
        console.warn("Firebase is not configured yet. Fill in firebaseConfig at the top of app.js.");
        return;
    }
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    auth.onAuthStateChanged(onAuthChanged);
};

function requireFirebase() {
    if (!db) { alert("The database is not configured yet (see README.md)."); return false; }
    return true;
}

function toggleRegister() {
    document.getElementById("parishRegFields").classList.toggle("hidden");
}

// New parish: creates a Firebase Auth account (password is held by Firebase, never
// stored by us) and files a Pending request. Super Admin approves it later.
async function createNewParish() {
    if (!requireFirebase()) return;
    const name = document.getElementById("regName").value.trim();
    const email = document.getElementById("regEmail").value.trim();
    const pass = document.getElementById("regPassword").value;
    if (!name || !email || pass.length < 8) return alert("Fill in all fields (password at least 8 characters).");
    try {
        const cred = await auth.createUserWithEmailAndPassword(email, pass);
        await db.collection("parishRequests").doc(cred.user.uid).set({
            parishName: name, email: email, status: "Pending",
            createdAt: new Date().toISOString()
        });
        document.getElementById("regName").value = "";
        document.getElementById("regPassword").value = "";
        alert("Parish request sent. Access is Pending until the Super Admin approves it.");
        await auth.signOut();
    } catch (e) {
        alert("Registration failed: " + e.message);
    }
}

async function attemptLogin() {
    if (!requireFirebase()) return;
    const email = document.getElementById("loginEmail").value.trim();
    const pass = document.getElementById("loginPassword").value;
    if (!email || !pass) return alert("Enter your email and password.");
    try {
        await auth.signInWithEmailAndPassword(email, pass);
        document.getElementById("loginPassword").value = "";
    } catch (e) {
        alert("Login failed. Check your email and password.");
    }
}

// The browser only decides what to SHOW. What a user can actually read or
// write is enforced by firestore/firestore.rules on the server.
async function onAuthChanged(user) {
    if (!user) return;
    try {
        const prof = await db.collection("users").doc(user.uid).get();
        if (!prof.exists) {
            alert("Your account has no access yet. Ask the Super Admin to approve your parish.");
            return auth.signOut();
        }
        const { role, parishId } = prof.data();
        localState = { user, role, currentParishId: parishId || "" };

        if (role === "super_admin" || role === "hq") {
            await fillParishPicker();
            document.getElementById("circularComposer").classList.remove("hidden");
        }
        if (!localState.currentParishId && role === "parish_admin") {
            alert("Your account is not linked to a parish.");
            return auth.signOut();
        }
        document.getElementById("landingPage").classList.add("hidden");
        document.getElementById("mainApp").classList.remove("hidden");
        await loadParishData();
    } catch (e) {
        alert("Access denied: your parish may be pending or suspended.\n" + e.message);
        auth.signOut();
    }
}

async function fillParishPicker() {
    const sel = document.getElementById("parishPicker");
    const snap = await db.collection("parishes").get();
    sel.textContent = "";
    snap.forEach(d => {
        const p = d.data();
        const opt = document.createElement("option");
        opt.value = d.id;
        opt.textContent = (p.name || d.id) + (p.status && p.status !== "Approved" ? " (" + p.status + ")" : "");
        sel.appendChild(opt);
    });
    sel.classList.remove("hidden");
    if (!localState.currentParishId && sel.options.length) localState.currentParishId = sel.options[0].value;
    sel.value = localState.currentParishId;
}

function pickParish(id) {
    localState.currentParishId = id;
    loadParishData();
}

function showSection(id) {
    document.querySelectorAll('main > div > section').forEach(sec => sec.classList.add('hidden'));
    document.getElementById(`section-${id}`).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('bg-slate-800'));
    document.getElementById(`nav-${id}`).classList.add('bg-slate-800');
}

function parishRef() {
    return db.collection("parishes").doc(localState.currentParishId);
}

async function loadParishData() {
    if (!db || !localState.currentParishId) return;
    const pDoc = await parishRef().get();
    document.getElementById("dashParishName").textContent = pDoc.exists ? pDoc.data().name : "";

    const members = await parishRef().collection("members").orderBy("fullName").get();
    const mTable = document.getElementById("membersTable");
    document.getElementById("metricMembers").textContent = members.size;
    mTable.innerHTML = members.docs.map(d => {
        const m = d.data();
        return `<tr><td class="p-3 font-bold">${esc(m.fullName)}</td><td class="p-3">${esc(m.gender)}</td><td class="p-3">${esc(m.household)}</td><td class="p-3">${esc(m.rank)}</td><td class="p-3">${esc(m.phone || 'N/A')}</td></tr>`;
    }).join("");

    const att = await parishRef().collection("attendance").orderBy("serviceDate", "desc").get();
    document.getElementById("attendanceTable").innerHTML = att.docs.map(d => {
        const a = d.data();
        return `<tr><td class="p-3 font-mono">${esc(a.serviceDate)}</td><td class="p-3 font-bold">${esc(a.serviceType)}</td><td class="p-3">${esc(a.headcount)} attendees</td></tr>`;
    }).join("");

    const fin = await parishRef().collection("finances").orderBy("transactionDate", "desc").get();
    document.getElementById("financeTable").innerHTML = fin.docs.map(d => {
        const f = d.data();
        return `<tr><td class="p-3 font-mono">${esc(f.transactionDate)}</td><td class="p-3 font-bold">${esc(f.contributorName)}</td><td class="p-3">${esc(f.contributionType)}</td><td class="p-3 font-bold text-emerald-600">₦${esc(f.amount)}</td></tr>`;
    }).join("");

    const circs = await db.collection("circulars").orderBy("createdAt", "desc").get();
    const cList = document.getElementById("circularsList");
    if (!circs.empty) {
        cList.innerHTML = circs.docs.map(d => {
            const c = d.data();
            return `
                <div class="bg-indigo-50 border-l-4 border-indigo-600 p-4 rounded shadow-sm">
                    <p class="text-[10px] font-bold text-indigo-950 uppercase tracking-widest">${esc(new Date(c.createdAt).toLocaleString())}</p>
                    <p class="text-xs text-indigo-900 mt-1.5 font-medium leading-relaxed">${esc(c.body)}</p>
                </div>`;
        }).join("");
    } else {
        cList.innerHTML = `<p class="text-xs text-gray-400 italic">No global circular bulletins currently loaded.</p>`;
    }
}

// Dialog Controller Modals
function openAddModal() { document.getElementById("addMemberModal").classList.remove('hidden'); }
function closeAddModal() { document.getElementById("addMemberModal").classList.add('hidden'); }
async function saveMember() {
    if (!requireFirebase()) return;
    const val = id => document.getElementById(id).value.trim();
    const consent = document.getElementById("m_consent").checked;
    const member = {
        fullName: val("m_name"),
        gender: val("m_gender"),
        rank: val("m_rank"),
        phone: val("m_phone"),
        address: val("m_address"),
        dateJoined: val("m_joined"),
        household: val("m_household"),
        consentGiven: consent,
        consentDate: consent ? new Date().toISOString().slice(0, 10) : null
    };
    if (!member.fullName || !member.gender || !member.rank || !member.dateJoined) return alert("Fill in required elements.");
    if (!consent) return alert("You must record the member's consent before saving (NDPA 2023).");
    try {
        await parishRef().collection("members").add(member);
        closeAddModal();
        loadParishData();
    } catch (e) {
        alert(`Failed to save profile: ${e.message}`);
    }
}

function openAttendanceModal() { document.getElementById("addAttendanceModal").classList.remove('hidden'); }
function closeAttendanceModal() { document.getElementById("addAttendanceModal").classList.add('hidden'); }
async function saveAttendance() {
    if (!requireFirebase()) return;
    const date = document.getElementById("att_date").value;
    const type = document.getElementById("att_type").value.trim();
    const headcount = parseInt(document.getElementById("att_headcount").value);
    if (!date || !type || isNaN(headcount)) return alert("Fill all elements.");
    try {
        await parishRef().collection("attendance").add({ serviceDate: date, serviceType: type, headcount });
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
    if (!date || !contrib || !type || isNaN(amt)) return alert("Fill all elements.");
    try {
        await parishRef().collection("finances").add({
            transactionDate: date, contributorName: contrib, contributionType: type, amount: amt
        });
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

async function logout() {
    if (auth) await auth.signOut();
    location.reload();
}
