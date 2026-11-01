# CCC Parish Portal (CCC-DATA)

A phone-friendly web portal for Celestial Church of Christ parishes: register a parish,
log in, keep members, attendance, finances, and read HQ circulars.

Built on **Firebase** (Auth + Firestore), same as the EduBloom apps.

## Who can do what
Roles are stored in Firestore `users/{uid}` as `{ role, parishId }`:
- **parish_admin** - reads/writes only their own parish (and only while it is `Approved`).
- **hq** - reads parish names and per-parish totals (`parishStats`) only, never member,
  attendance or giving records (NDPA); publishes circulars.
- **super_admin** - everything, including approving parishes and giving roles.
- Not logged in - nothing.

These rules are enforced by the server in `firestore/firestore.rules`, not by the browser.
Passwords are held by Firebase Auth; the app never stores or shows them.

## Data
- `parishes/{parishId}` - `{ name, status: Pending | Approved | Suspended }`
- `parishes/{parishId}/members` - fullName, gender, phone, address, dateJoined, rank,
  household, consentGiven, consentDate
- `parishes/{parishId}/attendance`, `parishes/{parishId}/finances`
- `circulars` - HQ bulletins
- `parishRequests/{uid}` - new parish sign-ups waiting for approval

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
9. To approve a parish: log in as super admin, tap **Parish Approvals**, tap **Approve**.

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
