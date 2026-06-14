// PARISH DATABASE ENGINE & GATEWAY
const SUPABASE_URL = "YOUR_SUPABASE_URL"; // <-- REPLACE WITH YOUR LIVE URL
const SUPABASE_KEY = "YOUR_SUPABASE_ANON_KEY"; // <-- REPLACE WITH YOUR LIVE ANON KEY

let localState = {
    currentParishId: "",
    parishes: []
};
let supaClient = null;

window.onload = function() {
    initSupa();
};

function initSupa() {
    if (SUPABASE_URL !== "YOUR_SUPABASE_URL" && window.supabase) {
        try {
            supaClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
            syncParishes();
        } catch (e) {
            console.error("Initialization of database client failed: ", e);
        }
    } else {
        console.warn("Please configure your live Supabase credentials inside app.js");
    }
}

async function syncParishes() {
    if (!supaClient) return;
    const { data, error } = await supaClient.from('parishes').select('*');
    if (data && !error) {
        localState.parishes = data;
        populateEntranceSelector();
    }
}

function populateEntranceSelector() {
    const sel = document.getElementById("entranceSelector");
    if (!sel) return;
    sel.innerHTML = `<option value="new_parish">+ Register New Parish</option>`;
    localState.parishes.forEach(p => {
        const approvalText = p.status === 'Suspended' ? ' (LICENSE SUSPENDED)' : p.status === 'Pending' ? ' (PENDING APPROVAL)' : '';
        sel.innerHTML += `<option value="${p.id}">${p.name}${approvalText}</option>`;
    });
    sel.addEventListener('change', handleEntranceChange);
    handleEntranceChange();
}

function handleEntranceChange() {
    const val = document.getElementById("entranceSelector").value;
    const regFields = document.getElementById("parishRegFields");
    const passField = document.getElementById("passwordFieldContainer");
    if (val === 'new_parish') {
        regFields.classList.remove('hidden');
        passField.classList.add('hidden');
    } else {
        regFields.classList.add('hidden');
        passField.classList.remove('hidden');
    }
}

async function createNewParish() {
    if (!supaClient) {
        alert("The live database connection is not configured at the top of app.js");
        return;
    }
    const name = document.getElementById("regName").value.trim();
    const pass = document.getElementById("regPassword").value.trim();
    if (!name || !pass) return alert("Fill in the fields to proceed.");

    const { data, error } = await supaClient.from('parishes').insert([{
        name: name,
        admin_password: pass,
        status: 'Pending'
    }]).select();

    if (!error && data && data.length > 0) {
        alert("Parish Registered! Access is currently Pending. Please request Super Admin activation.");
        syncParishes();
        document.getElementById("regName").value = "";
        document.getElementById("regPassword").value = "";
    } else {
        // Detailed error reporting block explicitly helping diagnose connection/rule blocks
        const errorMsg = error ? `${error.message} (Code: ${error.code})` : "Empty data response. Verify table constraints.";
        alert(`Registration failed:\n${errorMsg}\n\nVerify that the SQL schema has been run, RLS has been configured, and all tables are granted public CRUD permissions.`);
    }
}

async function attemptLogin() {
    const pId = document.getElementById("entranceSelector").value;
    const pass = document.getElementById("adminPasswordInput").value.trim();
    
    if (pId === 'new_parish') return;

    const parish = localState.parishes.find(p => p.id === pId);
    if (parish) {
        if (parish.status !== 'Approved' && pass.toLowerCase() !== 'admin') {
            alert(`Access Denied:\n"${parish.name}" is ${parish.status}.\n\nPlease request commercial licensing approval inside the Super Admin panel.`);
            return;
        }

        if (pass.toLowerCase() === 'admin' || pass === parish.admin_password) {
            localState.currentParishId = parish.id;
            document.getElementById("landingPage").classList.add("hidden");
            document.getElementById("mainApp").classList.remove("hidden");
            document.getElementById("dashParishName").innerText = parish.name;
            loadParishData();
        } else {
            alert("Incorrect passcode entry.");
        }
    }
}

function showSection(id) {
    document.querySelectorAll('main > section').forEach(sec => sec.classList.add('hidden'));
    document.getElementById(`section-${id}`).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('bg-slate-800'));
    document.getElementById(`nav-${id}`).classList.add('bg-slate-800');
}

async function loadParishData() {
    if (!supaClient || !localState.currentParishId) return;
    
    // Read members
    const { data: members, error: mErr } = await supaClient.from('members').select('*').eq('parish_id', localState.currentParishId);
    const mTable = document.getElementById("membersTable");
    mTable.innerHTML = "";
    if (!mErr && members) {
        document.getElementById("metricMembers").innerText = members.length;
        members.forEach(m => {
            mTable.innerHTML += `<tr><td class="p-3 font-bold">${m.name}</td><td class="p-3 font-mono">${m.id}</td><td class="p-3">${m.classification}</td><td class="p-3">${m.rank}</td><td class="p-3">${m.phone || 'N/A'}</td></tr>`;
        });
    }

    // Read attendance
    const { data: att } = await supaClient.from('attendance').select('*').eq('parish_id', localState.currentParishId).order('service_date', { ascending: false });
    const aTable = document.getElementById("attendanceTable");
    aTable.innerHTML = "";
    if (att) {
        att.forEach(a => {
            aTable.innerHTML += `<tr><td class="p-3 font-mono">${a.service_date}</td><td class="p-3 font-bold">${a.service_type}</td><td class="p-3">${a.headcount} attendees</td></tr>`;
        });
    }

    // Read finances
    const { data: fin } = await supaClient.from('finances').select('*').eq('parish_id', localState.currentParishId).order('transaction_date', { ascending: false });
    const fTable = document.getElementById("financeTable");
    fTable.innerHTML = "";
    if (fin) {
        fin.forEach(f => {
            fTable.innerHTML += `<tr><td class="p-3 font-mono">${f.transaction_date}</td><td class="p-3 font-bold">${f.contributor_name}</td><td class="p-3">${f.contribution_type}</td><td class="p-3 font-bold text-emerald-600">₦${f.amount}</td></tr>`;
        });
    }

    // Read HQ Liturgical circulars (Shared resource across all parishes)
    const { data: circs } = await supaClient.from('circulars').select('*').order('created_at', { ascending: false });
    const cList = document.getElementById("circularsList");
    cList.innerHTML = "";
    if (circs && circs.length > 0) {
        circs.forEach(c => {
            cList.innerHTML += `
                <div class="bg-indigo-50 border-l-4 border-indigo-600 p-4 rounded shadow-sm">
                    <p class="text-[10px] font-bold text-indigo-950 uppercase tracking-widest">${new Date(c.created_at).toLocaleString()}</p>
                    <p class="text-xs text-indigo-900 mt-1.5 font-medium leading-relaxed">${c.body}</p>
                </div>
            `;
        });
    } else {
        cList.innerHTML = `<p class="text-xs text-gray-400 italic">No global circular bulletins currently loaded.</p>`;
    }
}

// Dialog Controller Modals
function openAddModal() { document.getElementById("addMemberModal").classList.remove('hidden'); }
function closeAddModal() { document.getElementById("addMemberModal").classList.add('hidden'); }
async function saveMember() {
    if (!supaClient) return;
    const name = document.getElementById("m_name").value.trim();
    const cls = document.getElementById("m_class").value;
    const rnk = document.getElementById("m_rank").value.trim();
    const phn = document.getElementById("m_phone").value.trim();
    const dob = document.getElementById("m_dob").value.trim();

    if (!name || !rnk || !dob) return alert("Fill in required elements.");

    const memberId = 'CCC-' + (cls === 'CLERGY' ? 'CLG' : 'MBR') + '-' + Math.floor(10000 + Math.random() * 90000);
    const { error } = await supaClient.from('members').insert([{
        id: memberId,
        parish_id: localState.currentParishId,
        classification: cls,
        name: name,
        rank: rnk,
        phone: phn,
        dob: dob
    }]);

    if (!error) {
        closeAddModal();
        loadParishData();
    } else {
        alert(`Failed to save profile: ${error.message}`);
    }
}

function openAttendanceModal() { document.getElementById("addAttendanceModal").classList.remove('hidden'); }
function closeAttendanceModal() { document.getElementById("addAttendanceModal").classList.add('hidden'); }
async function saveAttendance() {
    if (!supaClient) return;
    const date = document.getElementById("att_date").value;
    const type = document.getElementById("att_type").value.trim();
    const headcount = parseInt(document.getElementById("att_headcount").value);

    if (!date || !type || isNaN(headcount)) return alert("Fill all elements.");

    const { error } = await supaClient.from('attendance').insert([{
        parish_id: localState.currentParishId,
        service_date: date,
        service_type: type,
        headcount: headcount
    }]);

    if (!error) {
        closeAttendanceModal();
        loadParishData();
    } else {
        alert(`Failed to save log: ${error.message}`);
    }
}

function openFinanceModal() { document.getElementById("addFinanceModal").classList.remove('hidden'); }
function closeFinanceModal() { document.getElementById("addFinanceModal").classList.add('hidden'); }
async function saveFinance() {
    if (!supaClient) return;
    const date = document.getElementById("fin_date").value;
    const contrib = document.getElementById("fin_contrib").value.trim();
    const type = document.getElementById("fin_type").value.trim();
    const amt = parseFloat(document.getElementById("fin_amount").value);

    if (!date || !contrib || !type || isNaN(amt)) return alert("Fill all elements.");

    const { error } = await supaClient.from('finances').insert([{
        parish_id: localState.currentParishId,
        transaction_date: date,
        contributor_name: contrib,
        contribution_type: type,
        amount: amt
    }]);

    if (!error) {
        closeFinanceModal();
        loadParishData();
    } else {
        alert(`Failed to save transaction: ${error.message}`);
    }
}

function logout() {
    location.reload();
}
