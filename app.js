let localState = {
    supabaseUrl: "https://your-project.supabase.co", // Replace with your master Supabase URL
    supabaseKey: "your-anon-public-key", // Replace with your master Supabase key
    currentParishId: "",
    parishes: []
};
let supa = null;

window.onload = function() {
    const saved = localStorage.getItem("ccc_parish_app_state");
    if (saved) {
        localState = JSON.parse(saved);
    }
    initSupa();
    populateEntranceSelector();
    handleEntranceChange();
};

function initSupa() {
    if (localState.supabaseUrl && localState.supabaseKey && window.supabase) {
        supa = window.supabase.createClient(localState.supabaseUrl, localState.supabaseKey);
        syncParishes();
    }
}

async function syncParishes() {
    if (!supa) return;
    const { data } = await supa.from('parishes').select('*');
    if (data) {
        localState.parishes = data;
        populateEntranceSelector();
    }
}

function populateEntranceSelector() {
    const sel = document.getElementById("entranceSelector");
    sel.innerHTML = `<option value="new_parish">+ Register New Parish</option>`;
    localState.parishes.forEach(p => {
        const lockStr = p.status === 'Suspended' ? ' (LICENSE SUSPENDED)' : '';
        sel.innerHTML += `<option value="${p.id}">${p.name}${lockStr}</option>`;
    });
    sel.addEventListener('change', handleEntranceChange);
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
    if (!supa) return;
    const name = document.getElementById("regName").value.trim();
    const pass = document.getElementById("regPassword").value.trim();
    if (!name || !pass) return alert("Fill in the fields to proceed.");

    const { data, error } = await supa.from('parishes').insert([{
        name: name,
        admin_password: pass,
        status: 'Pending'
    }]).select();

    if (data && !error) {
        alert("Parish Registered! Access is currently Pending. Please request Super Admin activation.");
        syncParishes();
    } else {
        alert("Registration failed. Try a different parish name.");
    }
}

async function attemptLogin() {
    const pId = document.getElementById("entranceSelector").value;
    const pass = document.getElementById("adminPasswordInput").value.trim();
    
    if (pId === 'new_parish') return;

    // Hardcoded master bypass override
    const parish = localState.parishes.find(p => p.id === pId);
    if (parish) {
        if (parish.status !== 'Approved' && pass.toLowerCase() !== 'admin') {
            alert("Entrance blocked. License verification required.");
            return;
        }

        if (pass.toLowerCase() === 'admin' || pass === parish.admin_password) {
            localState.currentParishId = parish.id;
            localStorage.setItem("ccc_parish_app_state", JSON.stringify(localState));
            document.getElementById("landingPage").classList.add("hidden");
            document.getElementById("mainApp").classList.remove("hidden");
            document.getElementById("dashParishName").innerText = parish.name;
            loadParishData();
        } else {
            alert("Incorrect password.");
        }
    }
}

function showSection(id) {
    document.querySelectorAll('main > section').forEach(sec => sec.classList.add('hidden'));
    document.getElementById(`section-${id}`).classList.remove('hidden');
}

async function loadParishData() {
    if (!supa || !localState.currentParishId) return;
    
    // Query Partitioned Members
    const { data: members } = await supa.from('members').select('*').eq('parish_id', localState.currentParishId);
    const mTable = document.getElementById("membersTable");
    mTable.innerHTML = "";
    if (members) {
        document.getElementById("metricMembers").innerText = members.length;
        members.forEach(m => {
            mTable.innerHTML += `<tr><td class="p-3 font-bold">${m.name}</td><td class="p-3">${m.classification}</td><td class="p-3">${m.rank}</td><td class="p-3">${m.phone || ''}</td></tr>`;
        });
    }

    // Query Partitioned Attendance
    const { data: att } = await supa.from('attendance').select('*').eq('parish_id', localState.currentParishId);
    const aTable = document.getElementById("attendanceTable");
    aTable.innerHTML = "";
    if (att) {
        att.forEach(a => {
            aTable.innerHTML += `<tr><td class="p-3">${a.service_date}</td><td class="p-3">${a.service_type}</td><td class="p-3">${a.headcount}</td></tr>`;
        });
    }

    // Query Partitioned Finances
    const { data: fin } = await supa.from('finances').select('*').eq('parish_id', localState.currentParishId);
    const fTable = document.getElementById("financeTable");
    fTable.innerHTML = "";
    if (fin) {
        fin.forEach(f => {
            fTable.innerHTML += `<tr><td class="p-3">${f.transaction_date}</td><td class="p-3">${f.contributor_name}</td><td class="p-3">${f.contribution_type}</td><td class="p-3">${f.amount}</td></tr>`;
        });
    }

    // Query HQ Circulars (Shared globally, not partitioned)
    const { data: circs } = await supa.from('circulars').select('*').order('created_at', { ascending: false });
    const cList = document.getElementById("circularsList");
    cList.innerHTML = "";
    if (circs) {
        circs.forEach(c => {
            cList.innerHTML += `
                <div class="bg-indigo-50 border-l-4 border-indigo-600 p-4 rounded shadow-sm">
                    <p class="text-[10px] font-bold text-indigo-900">${new Date(c.created_at).toLocaleString()}</p>
                    <p class="text-xs text-gray-700 mt-1">${c.body}</p>
                </div>
            `;
        });
    }
}

// Modal Handlers
function openAddModal() { document.getElementById("addMemberModal").classList.remove('hidden'); }
function closeAddModal() { document.getElementById("addMemberModal").classList.add('hidden'); }
async function saveMember() {
    const name = document.getElementById("m_name").value.trim();
    const cls = document.getElementById("m_class").value;
    const rnk = document.getElementById("m_rank").value.trim();
    const phn = document.getElementById("m_phone").value.trim();
    const dob = document.getElementById("m_dob").value.trim();

    if (!name || !rnk || !dob) return alert("Fill required inputs.");

    const memberId = 'CCC-' + (cls === 'CLERGY' ? 'CLG' : 'MBR') + '-' + Math.floor(10000 + Math.random() * 90000);
    await supa.from('members').insert([{
        id: memberId,
        parish_id: localState.currentParishId,
        classification: cls,
        name: name,
        rank: rnk,
        phone: phn,
        dob: dob
    }]);
    closeAddModal();
    loadParishData();
}

function openAttendanceModal() { document.getElementById("addAttendanceModal").classList.remove('hidden'); }
function closeAttendanceModal() { document.getElementById("addAttendanceModal").classList.add('hidden'); }
async function saveAttendance() {
    const date = document.getElementById("att_date").value;
    const type = document.getElementById("att_type").value.trim();
    const count = parseInt(document.getElementById("att_headcount").value);

    await supa.from('attendance').insert([{
        parish_id: localState.currentParishId,
        service_date: date,
        service_type: type,
        headcount: count
    }]);
    closeAttendanceModal();
    loadParishData();
}

function openFinanceModal() { document.getElementById("addFinanceModal").classList.remove('hidden'); }
function closeFinanceModal() { document.getElementById("addFinanceModal").classList.add('hidden'); }
async function saveFinance() {
    const date = document.getElementById("fin_date").value;
    const contrib = document.getElementById("fin_contrib").value.trim();
    const type = document.getElementById("fin_type").value.trim();
    const amt = parseFloat(document.getElementById("fin_amount").value);

    await supa.from('finances').insert([{
        parish_id: localState.currentParishId,
        transaction_date: date,
        contributor_name: contrib,
        contribution_type: type,
        amount: amt
    }]);
    closeFinanceModal();
    loadParishData();
}

function logout() {
    location.reload();
}
