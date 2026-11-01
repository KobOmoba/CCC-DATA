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
