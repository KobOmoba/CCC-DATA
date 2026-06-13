/**
 * AARINAT SYSTEM - PARISH ONBOARDING & LICENSING ENGINE (app.js)
 * Consolidated logic file strictly separated from presentation and styling.
 * Manages remote license requests, authorization switches, and client activations.
 */

// ==========================================
// 1. CENTRAL ENGINE STATE
// ==========================================
let hqState = {
    supabaseUrl: "",
    supabaseKey: "",
    isLoggedIn: false,
    parishes: []
};

let supabaseClient = null;

// ==========================================
// 2. LIFECYCLE INITIALIZATION
// ==========================================
window.onload = async function() {
    const saved = localStorage.getItem("aarinat_licensing_state");
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === "object") {
                hqState = { ...hqState, ...parsed };
            }
        } catch (e) {
            console.error("Master registry data corruption detected. Rebuilding configuration.", e);
        }
    }

    // Default configuration inputs
    document.getElementById("configSupaUrl").value = hqState.supabaseUrl || "";
    document.getElementById("configSupaKey").value = hqState.supabaseKey || "";

    if (!Array.isArray(hqState.parishes)) {
        hqState.parishes = [];
    }

    initSupabaseClient();
    applyStateToDOM();

    if (hqState.isLoggedIn) {
        document.getElementById("landingPage").classList.add("hidden");
        document.getElementById("mainApp").classList.remove("hidden");
        
        if (supabaseClient) {
            await fetchCloudParishes();
        }
        renderTables();
    }
};

// ==========================================
// 3. DATABASE CONFIGURATIONS & SYNC
// ==========================================
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function initSupabaseClient() {
    if (hqState.supabaseUrl && hqState.supabaseKey && window.supabase) {
        try {
            supabaseClient = window.supabase.createClient(hqState.supabaseUrl, hqState.supabaseKey);
            console.log("Aarinat master Supabase client connection authenticated.");
        } catch (e) {
            console.error("Supabase engine failed to validate connection parameters: ", e);
            supabaseClient = null;
        }
    } else {
        supabaseClient = null;
    }
}

function saveStateToStorage() {
    localStorage.setItem("aarinat_licensing_state", JSON.stringify(hqState));
    applyStateToDOM();
}

function clearLocalStorage() {
    if (confirm("Reset Aarinat master control node cache?")) {
        localStorage.removeItem("aarinat_licensing_state");
        location.reload();
    }
}

async function fetchCloudParishes() {
    if (!supabaseClient) return;
    try {
        const { data: parishes, error } = await supabaseClient.from('parishes').select('*');
        if (parishes && !error) {
            // Re-map column names if cloud table uses different schema fields
            hqState.parishes = parishes.map(p => ({
                id: p.id,
                name: p.name,
                password: p.admin_password || p.password,
                status: p.status || 'Pending'
            }));
            saveStateToStorage();
        }
    } catch (e) {
        console.error("Cloud synchronization halted due to authorization limits: ", e);
    }
}

// ==========================================
// 4. AUTHENTICATION & VIEWS
// ==========================================
function handleModeChange() {
    const mode = document.getElementById("portalModeSelect").value;
    const regPanel = document.getElementById("registrationPanel");
    const adminPanel = document.getElementById("adminPanel");
    
    if (mode === "register") {
        regPanel.classList.remove("hidden");
        adminPanel.classList.add("hidden");
    } else {
        regPanel.classList.add("hidden");
        adminPanel.classList.remove("hidden");
    }
}

function togglePasswordVisibility() {
    const pInput = document.getElementById("adminPasswordInput");
    const icon = document.getElementById("passwordEyeIcon");
    if (!pInput || !icon) return;
    
    if (pInput.type === "password") {
        pInput.type = "text";
        icon.className = "fa-solid fa-eye-slash text-sm";
    } else {
        pInput.type = "password";
        icon.className = "fa-solid fa-eye text-sm";
    }
}

function attemptLogin() {
    const pInput = document.getElementById("adminPasswordInput");
    const passwordEntered = pInput.value.trim();
    
    if (passwordEntered.toLowerCase() === 'aarinat') {
        hqState.isLoggedIn = true;
        saveStateToStorage();
        
        document.getElementById("landingPage").classList.add("hidden");
        document.getElementById("mainApp").classList.remove("hidden");
        renderTables();
        pInput.value = "";
    } else {
        alert("Aarinat console authorization credentials rejected.");
    }
}

function logout() {
    hqState.isLoggedIn = false;
    saveStateToStorage();
    location.reload();
}

function showSection(sectionId) {
    document.querySelectorAll('[id^="section-"]').forEach(sec => sec.classList.add("hidden"));
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('bg-slate-800'));
    
    const activeSection = document.getElementById(`section-${sectionId}`);
    if (activeSection) {
        activeSection.classList.remove("hidden");
    }
    
    const viewTitle = document.getElementById("viewTitle");
    if (viewTitle) {
        if (sectionId === 'approvals') viewTitle.innerText = "Onboarding Queue";
        else if (sectionId === 'activeParishes') viewTitle.innerText = "Active Nodes";
        else if (sectionId === 'config') viewTitle.innerText = "System Connections";
    }

    if (sectionId === 'approvals' || sectionId === 'activeParishes') {
        renderTables();
    }
}

// ==========================================
// 5. ONBOARDING & APPROVAL SERVICES
// ==========================================
async function createNewParish() {
    const nameInput = document.getElementById("regParishName");
    const passInput = document.getElementById("regParishPassword");
    const name = nameInput.value.trim();
    const password = passInput.value.trim();

    if (!name || !password) {
        alert("Please input all required parish database values.");
        return;
    }

    const newId = generateUUID();
    const newParish = {
        id: newId,
        name: name,
        password: password,
        status: "Pending"
    };

    hqState.parishes.push(newParish);
    saveStateToStorage();

    if (supabaseClient) {
        try {
            await supabaseClient.from('parishes').insert([{
                id: newId,
                name: name,
                admin_password: password,
                status: "Pending"
            }]);
        } catch (e) {
            console.error("Cloud registration request cached locally due to connectivity issues: ", e);
        }
    }

    alert(`License request submitted successfully.\n\nParish Node: ${name}\nAssigned Key: ${newId}\n\nAuthorization must be approved by system administration before clients can initialize.`);
    
    nameInput.value = "";
    passInput.value = "";
    renderTables();
}

async function approveParishLicense(id) {
    const parish = hqState.parishes.find(p => p.id === id);
    if (parish) {
        parish.status = 'Approved';
        saveStateToStorage();
        
        if (supabaseClient) {
            try {
                await supabaseClient.from('parishes').upsert([{ id: id, status: 'Approved' }]);
            } catch (e) {
                console.error("Cloud licensing update deferred: ", e);
            }
        }
        renderTables();
        alert(`Access Key active for "${parish.name}". Node is now online.`);
    }
}

async function suspendParishLicense(id) {
    if (confirm("Revoke authorization key for this node? Client applications will lose sync permissions.")) {
        const parish = hqState.parishes.find(p => p.id === id);
        if (parish) {
            parish.status = 'Suspended';
            saveStateToStorage();
            
            if (supabaseClient) {
                try {
                    await supabaseClient.from('parishes').upsert([{ id: id, status: 'Suspended' }]);
                } catch (e) {
                    console.error("Cloud licensing update deferred: ", e);
                }
            }
            renderTables();
            alert(`Authorization suspended for "${parish.name}". Access blocked.`);
        }
    }
}

// ==========================================
// 6. DOM RENDERING UTILITIES
// ==========================================
function renderTables() {
    const pendingBody = document.getElementById("pendingApprovalsTableBody");
    const activeBody = document.getElementById("activeLicensesTableBody");
    if (!pendingBody || !activeBody) return;

    pendingBody.innerHTML = "";
    activeBody.innerHTML = "";

    let pendingCount = 0;
    let activeCount = 0;

    hqState.parishes.forEach(p => {
        if (p.status === "Approved") {
            activeCount++;
            activeBody.innerHTML += `
                <tr class="text-xs border-b border-slate-800 hover:bg-slate-900/50 transition">
                    <td class="p-3 font-bold">${p.name}</td>
                    <td class="p-3 font-mono text-slate-400">${p.id}</td>
                    <td class="p-3 text-emerald-400 font-semibold flex items-center gap-1.5">
                        <span class="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span> Active Authorized Node
                    </td>
                    <td class="p-3 text-right">
                        <button onclick="suspendParishLicense('${p.id}')" class="px-2.5 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/20 rounded font-semibold transition">
                            Suspend Node
                        </button>
                    </td>
                </tr>
            `;
        } else {
            pendingCount++;
            pendingBody.innerHTML += `
                <tr class="text-xs border-b border-slate-800 hover:bg-slate-900/50 transition">
                    <td class="p-3 font-bold">${p.name}</td>
                    <td class="p-3 font-mono text-slate-400">${p.id}</td>
                    <td class="p-3 text-amber-500 font-semibold animate-pulse flex items-center gap-1.5">
                        <span class="w-1.5 h-1.5 bg-amber-500 rounded-full"></span> ${p.status || 'Pending'}
                    </td>
                    <td class="p-3 text-right">
                        <button onclick="approveParishLicense('${p.id}')" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold transition">
                            Approve License
                        </button>
                    </td>
                </tr>
            `;
        }
    });

    if (pendingCount === 0) {
        pendingBody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500 italic">No pending authorization requests.</td></tr>`;
    }
    if (activeCount === 0) {
        activeBody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500 italic">No authorized nodes active.</td></tr>`;
    }
}

function applyStateToDOM() {
    const syncInd = document.getElementById("syncIndicator");
    const badge = document.getElementById("cloudStatusBadge");
    
    if (supabaseClient) {
        syncInd.innerHTML = `<span class="text-emerald-400"><i class="fa-solid fa-cloud"></i> Cloud Connected</span>`;
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Cloud Synced`;
        badge.className = "text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-500/20 px-2.5 py-1.5 rounded-full font-bold flex items-center gap-1.5";
    } else {
        syncInd.innerHTML = `<span class="text-amber-400"><i class="fa-solid fa-wifi"></i> Local Storage Mode</span>`;
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span> Local Only`;
        badge.className = "text-[10px] bg-amber-950 text-amber-400 border border-amber-500/20 px-2.5 py-1.5 rounded-full font-bold flex items-center gap-1.5";
    }
}

function saveDashboardConfig() {
    hqState.supabaseUrl = document.getElementById("configSupaUrl").value.trim();
    hqState.supabaseKey = document.getElementById("configSupaKey").value.trim();

    saveStateToStorage();
    initSupabaseClient();
    location.reload();
}
