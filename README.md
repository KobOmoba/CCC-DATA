# CCC Parish Portal (CCC-DATA)

A phone-friendly web portal for Celestial Church of Christ parishes: register a parish,
log in, keep members, attendance, finances, and read HQ circulars.

Built on **Firebase** (Auth + Firestore), same as the EduBloom apps.

## Who can do what
Roles are stored in Firestore `users/{uid}` as `{ role, parishId, email }`:
- **parish_admin** - reads/writes only their own parish (and only while it is `Approved`).
- **super_admin** - creates parishes and admin invites; sees per-parish totals, the clergy
  register, and members a parish flags **important**. Never ordinary members, attendance or giving.
- **hq** - per-parish totals only; publishes circulars.
- Not signed in - nothing. **Clergy can never be app admins** (enforced by the rules).

No self-registration: the Super Admin creates a parish and gets a one-time **invite code**.
The parish admin opens the portal, taps **First time? I have an invite code**, and signs up
with the invited email + code.

## Data
- `parishes/{p}` - name, logo, address, mapsUrl, city, state, country, continent, status
- `parishes/{p}/members/CCC-MBR-001`, `parishes/{p}/clergy/CCC-CLG-001` - the member form
  (photo is a ~60KB JPEG stored in the record; Firebase Storage is not enabled)
- `parishes/{p}/meta/counters` - `{ clg, mbr }`; numbers are allocated in a transaction and never reused
- `parishes/{p}/families`, `parishes/{p}/letters` (transfer letters), `attendance`, `finances`
- `parishStats/{p}` - totals only; `invites/{code}`, `adminEmails/{email}`, `clergyIndex/{email}`
- `firestore.indexes.json` - enables the Super Admin "important members" query
- **Departments** (Phase 2): `parishes/{p}/departments/{dept}` = 2-year term `{termStart, termEnd}`;
  `parishes/{p}/deptMembers/{dept}_{memberNo}` = `{status: Current|Former, role, joinedDate, leftDate}`.
  Six fixed ids: parochial, choir, ict, sidemen, prophets, sundayschool. Clergy can never join (rules: only
  an Active CCC-MBR member). Banner when an election is due within 60 days or overdue.
- **Members in Diaspora**: member `status: Diaspora` + abroadCountry/City/Parish/Since (a link, not counted as a member).
- **Transfers**: `transfers/{id}` (old parish sends with consent, new parish accepts by **parish code**,
  `parishCodes/{code}`). The new record keeps `lifeNo` + `lifeParishCode` (one member number for life).
  The old record stays as `TransferredOut`, so world totals count each person once.
- **Attendance** (Phase 3), built on the CCC weekly timetable (Sun 10:00 Sunday Service ... Fri 18:00; first Thursday
  = New Moon 22:00, other Thursdays = Prophets vigil 23:59; Saturday = cleaning rota).
  `attendance/{date}_{serviceKey}` = men/women/children/visitors + headcount (must add up), ledBy (a clergy id), notes.
  Old `{serviceDate, serviceType, headcount}` records stay valid. `specialServices/{id}` (harvest, anniversary...).
  Named attendance is per **unit**, not a whole-church tick-list: `deptAttendance/{unit}_{date}` (present list);
  `units/u_xxx` = admin-defined units. Absent 3+ weeks is worked out per unit; Follow-up rolls it up with a wa.me link.
  `visitors/{id}` (consent required; "Make member" creates the member in the same transaction). `cleaning/{saturday}`.
  `parishStats` gains `byType` (per service type) and `visitorCount`; Super Admin/HQ see only these totals.
- **Parish lettering** (Phase 4): `parishes/{p}.parishLetters` + `cityLetters` (2-4 capital letters each, e.g. IJY + ABK).
  Unique worldwide through `parishLettering/{IJY-ABK}`, written in the same batch. Super Admin sets it when creating a parish
  (or once, with "Set parish lettering", for an existing one); it never changes. Every NEW number carries it:
  `CCC-IJY-ABK-MBR-001`, `-CLG-`, `-BRT-`, `-CHD-`, `-TEN-`, `-DTH-`. No lettering, no new numbers. Old `CCC-MBR-001` records keep working.
- **Female rank line** (Phase 4): the rank dropdown shows the male line (28) for men and the female line (9) for women; the rules check it.
- **Births** (0-2) `births/{no}`, **Sunday School Children** (2-12) `children/{no}`, **Teenagers** (12-18) `teens/{no}`: each its own
  section and number series (`meta/brt|chd|ten` = `{n}`), full date of birth required. **Deaths** `deaths/{no}` (`meta/dth`).
- **Moves by age**: on load the parish admin sees "pending moves"; one tap moves them all. Each move is one transaction:
  the new record (with `fromNo`) + the old one marked `Moved`, `movedTo`, `movedAt`, `movedBy`. At 18 a teen becomes a member with a
  new CCC-MBR number. The rules re-check the age against the server date. Needs the composite indexes in `firestore.indexes.json`.
- **Called to glory**: saving a death with a church number marks that record `Called to glory` (clergy: Former, reason Called to glory)
  in the same write. It leaves the counts and is never deleted.
- **Certificates**: birth and death certificates (church name, parish logo, number, signature lines). Print / Save as PDF from the browser.
  Issued by the parish admin only. parishStats gains birthCount, childCount, teenCount, deathCount (Super Admin / HQ: totals only).
- **Phase 7 (Super Admin)**, `hq.js`:
  - **HQ Staff** (Product 2): `hqStaff/CCC-HQ-STF-001` (counter `hqMeta/staff`), postings history, `hqStaffFiles` (image/PDF <= ~250KB),
    `hqLeave`. Reports: staff per department, due to retire within 12 months (age 60, needs a full DOB). Named Super Admins only.
  - **Member directory**: `directory/{parishId}_{memberNo}` = work profile + participation (departments, attendance streak,
    rank history, anointment, regular giver + yearly totals). No address, next of kin, birth year or family. The parish writes it
    with each member save and refreshes/backfills it whenever the parish admin opens the app. Super Admin searches by name, parish,
    city, rank or occupation. Only the Super Admin changes `committees` on it.
  - **Committees**: `committees/{id}` + `committeeMembers/{committee}_{parish}_{no}` (Chair / Secretary / Member; clergy allowed by
    clergy number; former members kept). Every Super Admin change is versioned and written to `auditLog`. Nothing is deleted.
- `flows/{id}` - places + year only (no names); Super Admin's "Diaspora Flows" summary.

## Set up Firebase later (on your phone)
1. Open **Chrome** and go to `console.firebase.google.com`. Sign in.
2. Tap **Create a project** (or Add project). Name it e.g. `ccc-parish-portal`. Tap through.
3. In the menu, tap **Build > Authentication > Get started > Email/Password > Enable > Save**.
4. Tap **Build > Firestore Database > Create database**. Pick a location, start in **production mode**.
5. In Firestore, open the **Rules** tab. Paste the text of `firestore/firestore.rules`. Tap **Publish**.
6. Tap the gear **Project settings > Your apps > Web (`</>`)**. Register the app. Copy the
   `firebaseConfig` values.
7. Paste them into the `firebaseConfig` block at the top of `app.js` (replacing every `PLACEHOLDER`).
   The web config is not a secret, but keep admin keys out of this repo.
8. Make yourself super admin: **Authentication > Add user** (your email + password). Copy your
   **User UID**. In **Firestore > Start collection** `users`, document ID = that UID, field
   `role` (string) = `super_admin`.
9. To add a parish: sign in as super admin, tap **Parishes**, fill the form, send the invite code to the admin.

## NDPA 2023 (Nigeria Data Protection Act)
Member records are personal data. **Get the member's consent before entering their details.**
The app will not save a member unless the consent box is ticked; the rules also refuse any
member record without `consentGiven: true` and a `consentDate`. Only collect what you need,
and delete a member's record if they ask.

## Testing the rules (no live data touched)
```
cd firestore && npm install && npm test
```
Runs the Firestore emulator (needs Java) and `rules.test.mjs`.

Phone-size browser test (390x844) against the Auth + Firestore emulators, project `demo-ccc`:
```
cd firestore && npm run test:e2e
```
Set `CHROMIUM_PATH` to use an installed Chromium. Screenshots land in `firestore/screenshots/`.
Open the app with `?emulator=1` to point it at local emulators instead of the live project.

## AI-Assisted Data Entry (Phase 5)
- Button under **Church Members**. Upload PDF, DOCX, TXT, CSV, XLSX or a photo/scan. PDF (pdf.js), DOCX (mammoth) and
  XLSX/CSV (SheetJS) are read in the browser; photos and scanned PDFs go to vision AI.
- Worker `ccc-ai` (`ai-worker/worker.js`, deploy with `ai-worker/deploy.sh`) at
  `https://ccc-ai.aarinat-company-limited.workers.dev/extract`. Gemini (secret `GEMINI_API_KEY`), Groq fallback (`GROQ_API_KEY`).
  It verifies the admin's Firebase ID token (RS256 against Google's public keys, project ccc-data-aarinat) and rate-limits
  6/minute, 200/day per user. CORS: kobomoba.github.io (+ local test server).
- Review screen: one card per person, Edit for per-field fixes, duplicate warning (same name or phone, starts unticked),
  optional photo per card, consent required, **Save selected** uses the normal numbered `createRecord` path, so the rules apply.
- Accuracy test: `firestore/ai-test/` (3 files + truth.json; `payloads.mjs`, `send.mjs`, `score.mjs`).

## Monthly Returns (Phase 6)
- Parish: **Monthly Returns** tab. Income per month in 6 categories (tithes, offerings, thanksgiving, harvest, building fund, other)
  in the parish **currency** (set in Parish Settings; each return keeps the currency it was filed in). Optional receipt photo.
  The app works out the amount due to HQ. Payments: date, amount, method (Bank transfer / Cash / POS), reference, optional teller photo.
- `returns/{parishId}_{YYYY-MM}` (totals only, no giver names), `returns/../payments/p{v}`, `returns/../confirmations/c{v}`.
  Status: Due -> Part paid -> Paid -> Confirmed, or Disputed (HQ). Nothing is deleted: corrections are new versions / negative entries with a reason.
- `hqSettings/returns` = share per category as a fraction `{num, den}`. Default (no doc): **1/3 of tithes, 0 of the rest**. A filed return keeps its share.
- `auditLog/{collection}_{docId}_v{version}`: every Phase 6 write bumps `version` and must add this entry in the same batch
  (who: uid + email + name, when: server time, before/after, reason). Append-only. Super Admin must have a `name` on `users/{uid}`.
- `returnRollups/{YYYY-MM}_{city|country|continent}_{key}`: per-currency totals, updated by each change; Super Admin **Rebuild** recomputes a month.
- `alerts/{YYYY-MM}_{parishId}_{rule}`: **Run checks** (Super Admin) flags underpaid 2+ months, tithes -30% with attendance steady, no return by the 10th, big change.
- Tests: `npm test` (rules) and `npm run test:e2e:p6` (390x844 phone, emulators).
