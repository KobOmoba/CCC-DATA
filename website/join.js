// Member self-registration (no login). Sends ONE Pending request to parishes/{p}/pendingMembers; only the parish admin can read it.
// The Firestore rules re-check every field, the consent, the empty honeypot, the photo size and that the parish's link is open.
let joinParish = null, joinPhoto = "";
const enc = v => typeof v === "number" ? { integerValue: String(v) } : typeof v === "boolean" ? { booleanValue: v } : { stringValue: String(v) };
// Shrink the photo to a JPEG under ~100 KB (the rules refuse anything bigger).
function shrink(file) {
    return new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => {
            let w = 480, q = 0.8, out = "";
            do {
                const s = Math.min(1, w / Math.max(img.width, img.height)), c = document.createElement("canvas");
                c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
                c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
                out = c.toDataURL("image/jpeg", q); w = Math.round(w * 0.8); q = Math.max(0.4, q - 0.1);
            } while (out.length > 100000 && w > 80);
            URL.revokeObjectURL(img.src); res(out);
        };
        img.onerror = rej; img.src = URL.createObjectURL(file);
    });
}
document.addEventListener("DOMContentLoaded", async () => {
    const intro = document.getElementById("joinIntro"), form = document.getElementById("joinForm");
    joinParish = CODE ? await getDoc("joinLinks/" + CODE).catch(() => null) : null;
    if (!joinParish || !joinParish.open) { intro.textContent = CODE ? "Sign-up for this parish is closed. Please ask the parish admin." : "Open the sign-up link your parish shared with you."; return; }
    intro.innerHTML = `Register as a member of <b>${esc(joinParish.name)}</b>. The parish admin will check and confirm it.`;
    form.hidden = false;
    form.photoFile.addEventListener("change", async () => {
        const f = form.photoFile.files[0]; joinPhoto = "";
        if (!f) return;
        try { joinPhoto = await shrink(f); const p = document.getElementById("photoPreview"); p.src = joinPhoto; p.hidden = false; }
        catch { alert("That picture could not be read. Try another one."); }
    });
    form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const g = k => form[k].value.trim(), int = k => g(k) ? Number(g(k)) : null;
        const d = { fullName: g("fullName"), gender: g("gender"), maritalStatus: g("maritalStatus"), phone: g("phone"), email: g("email").toLowerCase(),
            address: g("address"), occupation: g("occupation"), dobDay: int("dobDay"), dobMonth: int("dobMonth"), dobYear: int("dobYear"),
            weddingDay: int("weddingDay"), weddingMonth: int("weddingMonth"), nokName: g("nokName"), nokPhone: g("nokPhone"), photo: joinPhoto,
            consentGiven: form.consent.checked, status: "Pending", website: form.website.value };
        if (!d.consentGiven) return alert("Please tick the consent box.");
        const btn = document.getElementById("joinSend"); btn.disabled = true;
        try {
            const name = `projects/${EMU ? "demo-ccc" : SITE.project}/databases/(default)/documents/parishes/${joinParish.parishId}/pendingMembers/${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
            const fields = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === null ? { nullValue: null } : enc(v)]));
            const r = await fetch(API.replace(/\/documents$/, "/documents:commit"), { method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ writes: [{ update: { name, fields }, currentDocument: { exists: false },
                    updateTransforms: [{ fieldPath: "submittedAt", setToServerValue: "REQUEST_TIME" }] }] }) });
            if (!r.ok) throw new Error("HTTP " + r.status);
            form.hidden = true; document.getElementById("joinDone").hidden = false;
        } catch (e) {
            alert("Not sent. Check the required fields (name, phone, gender, marital status, date of birth, consent) and try again.");
        } finally { btn.disabled = false; }
    });
});
