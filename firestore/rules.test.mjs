// CCC Firestore rules tests. Runs against the local Firestore emulator only.
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, collectionGroup, getDocs, query, where, orderBy, limit, writeBatch, increment, runTransaction } from 'firebase/firestore';

let env;
const ctx = (uid, email) => env.authenticatedContext(uid, email ? { email } : {}).firestore();
const as = {
  stranger: () => env.unauthenticatedContext().firestore(),
  superA: () => ctx('uSuper', 'super@x.org'),
  hq: () => ctx('uHQ'),
  adminA: () => ctx('uA', 'a@x.org'),
  adminB: () => ctx('uB', 'b@x.org'),
  adminS: () => ctx('uS'),       // parish is Suspended
  noRole: () => ctx('uX'),       // signed in, no users doc
  selfPromoter: () => ctx('uP'),
};
const person = (no, extra = {}) => ({ memberNo: no, fullName: 'Ade Bisi', nameLower: 'ade bisi', gender: 'Female',
  maritalStatus: 'Married', address: 'Lagos', phone: '080', phoneDigits: '080', email: '', rank: '', occupation: 'Trader',
  dobDay: 4, dobMonth: 7, dobYear: null, anointDay: null, anointMonth: null, anointYear: null,
  nokName: 'Tunde Bisi', nokAddress: 'Lagos', nokPhone: '081', photo: '', important: false, status: 'Active',
  consentGiven: true, consentDate: '2026-11-01', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', ...extra });
const member = person('CCC-MBR-001');
const clergy = (no, email, extra = {}) => person(no, { gender: 'Male', fullName: 'Ven Olu', nameLower: 'ven olu', rank: 'Evangelist',
  email, joinedDate: '2020-01-01', serviceRecord: [{ rank: 'Evangelist', from: '2020-01-01' }], ...extra });
const att = { serviceDate: '2026-11-01', serviceType: 'Sunday Service', headcount: 100 };
const fin = { transactionDate: '2026-11-01', contributorName: 'Ade Bisi', contributionType: 'Tithe', amount: 5000 };
const PHOTO = 'data:image/jpeg;base64,' + 'A'.repeat(80000);

// Allocate the next number in a transaction, exactly like the app does.
async function addRecord(db, parish, kind, data) {
  const key = kind === 'clergy' ? 'clg' : 'mbr';
  const prefix = kind === 'clergy' ? 'CCC-CLG-' : 'CCC-MBR-';
  return runTransaction(db, async (t) => {
    const cRef = doc(db, `parishes/${parish}/meta/counters`);
    const n = (await t.get(cRef)).data()[key] + 1;
    const id = prefix + String(n).padStart(3, '0');
    t.update(cRef, { [key]: n });
    t.set(doc(db, `parishes/${parish}/${kind}/${id}`), { ...data, memberNo: id });
    t.set(doc(db, `parishStats/${parish}`), { [kind === 'clergy' ? 'clergyCount' : 'memberCount']: increment(1) }, { merge: true });
    if (kind === 'clergy' && data.email) t.set(doc(db, `clergyIndex/${data.email}`), { parishId: parish, clergyId: id });
    return id;
  });
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'ccc-rules-lab',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users/uSuper'), { role: 'super_admin' });
    await setDoc(doc(db, 'users/uHQ'), { role: 'hq' });
    await setDoc(doc(db, 'users/uA'), { role: 'parish_admin', parishId: 'A', email: 'a@x.org' });
    await setDoc(doc(db, 'users/uB'), { role: 'parish_admin', parishId: 'B', email: 'b@x.org' });
    await setDoc(doc(db, 'users/uS'), { role: 'parish_admin', parishId: 'S' });
    await setDoc(doc(db, 'adminEmails/a@x.org'), { uid: 'uA' });
    await setDoc(doc(db, 'adminEmails/b@x.org'), { uid: 'uB' });
    for (const p of ['A', 'B', 'S']) {
      await setDoc(doc(db, `parishes/${p}`), { name: 'Parish ' + p, status: p === 'S' ? 'Suspended' : 'Approved' });
      await setDoc(doc(db, `parishes/${p}/meta/counters`), { clg: 1, mbr: 2 });
    }
    await setDoc(doc(db, 'parishes/A/members/CCC-MBR-001'), member);
    await setDoc(doc(db, 'parishes/A/members/CCC-MBR-002'), person('CCC-MBR-002', { important: true, fullName: 'Head Choir', nameLower: 'head choir' }));
    await setDoc(doc(db, 'parishes/A/clergy/CCC-CLG-001'), clergy('CCC-CLG-001', 'olu@x.org'));
    await setDoc(doc(db, 'clergyIndex/olu@x.org'), { parishId: 'A', clergyId: 'CCC-CLG-001' });
    await setDoc(doc(db, 'parishes/A/finances/f1'), fin);
    await setDoc(doc(db, 'parishes/A/attendance/t1'), att);
    await setDoc(doc(db, 'parishStats/A'), { memberCount: 2, clergyCount: 1, attendanceTotal: 0, serviceCount: 0, financeTotal: 5000, financeCount: 1 });
    await setDoc(doc(db, 'parishes/S/members/CCC-MBR-001'), member);
    await setDoc(doc(db, 'circulars/c1'), { body: 'Notice' });
    await setDoc(doc(db, 'invites/INVITECODE-0000000001'), { email: 'new@x.org', parishId: 'B', role: 'parish_admin', usedBy: null });
  });
});

// ---- Base access (Milestone 1, kept) ----
test('stranger cannot read or write anything', async () => {
  await assertFails(getDoc(doc(as.stranger(), 'parishes/A')));
  await assertFails(getDoc(doc(as.stranger(), 'parishes/A/members/CCC-MBR-001')));
  await assertFails(getDoc(doc(as.stranger(), 'circulars/c1')));
  await assertFails(getDoc(doc(as.stranger(), 'users/uA')));
  await assertFails(setDoc(doc(as.stranger(), 'parishes/X'), { name: 'x', status: 'Approved' }));
  await assertFails(setDoc(doc(as.stranger(), 'circulars/c2'), { body: 'x' }));
});
test('parish admin reads and writes own parish', async () => {
  await assertSucceeds(getDoc(doc(as.adminA(), 'parishes/A')));
  await assertSucceeds(getDocs(collection(as.adminA(), 'parishes/A/members')));
  await assertSucceeds(getDocs(collection(as.adminA(), 'parishes/A/clergy')));
  await assertSucceeds(addRecord(as.adminA(), 'A', 'members', person('x')));
  await assertSucceeds(setDoc(doc(as.adminA(), 'parishes/A/attendance/a1'), att));
  await assertSucceeds(setDoc(doc(as.adminA(), 'parishes/A/finances/f2'), fin));
});
test('parish privacy: admin cannot touch another parish', async () => {
  const b = as.adminB();
  await assertFails(getDoc(doc(b, 'parishes/A')));
  await assertFails(getDoc(doc(b, 'parishes/A/members/CCC-MBR-001')));
  await assertFails(getDoc(doc(b, 'parishes/A/clergy/CCC-CLG-001')));
  await assertFails(getDoc(doc(b, 'parishes/A/finances/f1')));
  await assertFails(getDoc(doc(b, 'parishes/A/meta/counters')));
  await assertFails(getDocs(collection(b, 'parishes/A/families')));
  await assertFails(getDoc(doc(b, 'parishStats/A')));
  await assertFails(addRecord(b, 'A', 'members', person('x')));
  await assertFails(updateDoc(doc(b, 'parishes/A/members/CCC-MBR-001'), { phone: '1' }));
  await assertFails(getDocs(collectionGroup(b, 'members')));
});
test('member without consent is refused (NDPA)', async () => {
  await assertFails(addRecord(as.adminA(), 'A', 'members', { ...member, consentGiven: false }));
  const { consentDate, ...noDate } = member;
  await assertFails(addRecord(as.adminA(), 'A', 'members', noDate));
});
test('parish admin cannot change status, roles, or post circulars', async () => {
  await assertFails(updateDoc(doc(as.adminA(), 'parishes/A'), { status: 'Suspended' }));
  await assertFails(setDoc(doc(as.adminA(), 'users/uA'), { role: 'super_admin' }));
  await assertFails(setDoc(doc(as.selfPromoter(), 'users/uP'), { role: 'super_admin' }));
  await assertFails(setDoc(doc(as.adminA(), 'circulars/c2'), { body: 'x' }));
  await assertSucceeds(getDoc(doc(as.adminA(), 'circulars/c1')));
});
test('suspended parish admin is locked out', async () => {
  await assertFails(getDoc(doc(as.adminS(), 'parishes/S')));
  await assertFails(getDoc(doc(as.adminS(), 'parishes/S/members/CCC-MBR-001')));
});
test('signed-in user with no role sees nothing', async () => {
  await assertFails(getDoc(doc(as.noRole(), 'parishes/A')));
  await assertFails(getDoc(doc(as.noRole(), 'circulars/c1')));
});
test('NDPA: hq reads totals only', async () => {
  await assertSucceeds(getDoc(doc(as.hq(), 'parishes/A')));
  await assertSucceeds(getDoc(doc(as.hq(), 'parishStats/A')));
  await assertFails(setDoc(doc(as.hq(), 'parishStats/A'), { memberCount: 99 }));
  await assertFails(getDocs(collection(as.hq(), 'parishes/A/members')));
  await assertFails(getDocs(collection(as.hq(), 'parishes/A/clergy')));
  await assertFails(getDocs(collection(as.hq(), 'parishes/A/finances')));
  await assertFails(getDocs(collection(as.hq(), 'parishes/A/attendance')));
  await assertSucceeds(setDoc(doc(as.hq(), 'circulars/c2'), { body: 'HQ notice' }));
});
test('totals: parish keeps own; bad values refused', async () => {
  await assertSucceeds(setDoc(doc(as.adminA(), 'parishStats/A'), { memberCount: increment(1), clergyCount: increment(1) }, { merge: true }));
  await assertFails(setDoc(doc(as.adminA(), 'parishStats/B'), { memberCount: 1 }));
  await assertFails(setDoc(doc(as.adminA(), 'parishStats/A'), { memberCount: -1 }, { merge: true }));
  await assertFails(setDoc(doc(as.adminA(), 'parishStats/A'), { memberNames: ['x'] }, { merge: true }));
});
test('finance + attendance validation kept', async () => {
  const f = (id) => doc(as.adminA(), 'parishes/A/finances/' + id);
  await assertFails(setDoc(f('x1'), { ...fin, amount: -50 }));
  await assertFails(setDoc(f('x3'), { ...fin, amount: '5000' }));
  await assertFails(setDoc(f('x7'), { ...fin, extra: true }));
  await assertSucceeds(setDoc(f('x8'), { ...fin, amount: 2500.5 }));
  const a = (id) => doc(as.adminA(), 'parishes/A/attendance/' + id);
  await assertFails(setDoc(a('y2'), { ...att, headcount: 10.5 }));
  await assertFails(setDoc(a('y4'), { ...att, serviceDate: '01/11/2026' }));
  await assertSucceeds(setDoc(a('y6'), { ...att, headcount: 0 }));
});
test('member search by name prefix and phone, own parish only', async () => {
  const col = collection(as.adminA(), 'parishes/A/members');
  await assertSucceeds(getDocs(query(col, orderBy('nameLower'), where('nameLower', '>=', 'ade'), where('nameLower', '<=', 'ade'), limit(20))));
  await assertSucceeds(getDocs(query(col, where('phoneDigits', '==', '080'), limit(20))));
  await assertFails(getDocs(query(collection(as.adminB(), 'parishes/A/members'), limit(20))));
});

// ---- Phase 1: member record ----
test('member record: full form accepted, bad fields refused', async () => {
  const a = as.adminA();
  await assertSucceeds(addRecord(a, 'A', 'members', person('x', { photo: PHOTO, dobYear: 1980, anointDay: 1, anointMonth: 5, anointYear: 2024, rank: 'Senior Leader', email: 'ade@x.org' })));
  await assertFails(addRecord(a, 'A', 'members', person('x', { rank: 'Archbishop' })));
  await assertFails(addRecord(a, 'A', 'members', person('x', { dobMonth: 13 })));
  await assertFails(addRecord(a, 'A', 'members', person('x', { dobDay: '4' })));
  await assertFails(addRecord(a, 'A', 'members', person('x', { maritalStatus: 'Complicated' })));
  await assertFails(addRecord(a, 'A', 'members', person('x', { photo: 'data:text/html;base64,AAAA' })));
  await assertFails(addRecord(a, 'A', 'members', person('x', { photo: 'data:image/jpeg;base64,' + 'A'.repeat(120000) })));
  await assertFails(addRecord(a, 'A', 'members', person('x', { religionSecret: 'x' })));
  await assertFails(updateDoc(doc(a, 'parishes/A/members/CCC-MBR-001'), { fullName: 'X', nameLower: 'wrong' }));
  await assertSucceeds(updateDoc(doc(a, 'parishes/A/members/CCC-MBR-001'), { fullName: 'Ade Bisi Jr', nameLower: 'ade bisi jr' }));
});

// ---- Phase 1: number allocation ----
test('numbers: next number taken in a transaction, two series', async () => {
  const a = as.adminA();
  assert(await addRecord(a, 'A', 'members', person('x')), 'CCC-MBR-003');
  assert(await addRecord(a, 'A', 'clergy', clergy('x', 'new.clergy@x.org')), 'CCC-CLG-002');
  assert(await addRecord(a, 'A', 'members', person('x')), 'CCC-MBR-004');
  const c = await getDoc(doc(a, 'parishes/A/meta/counters'));
  assert(JSON.stringify(c.data()), JSON.stringify({ clg: 2, mbr: 4 }));
});
test('numbers: cannot skip, reuse, rewind, or delete', async () => {
  const a = as.adminA();
  const raw = (id, cnt) => { const b = writeBatch(a); b.set(doc(a, `parishes/A/members/${id}`), person(id)); if (cnt) b.update(doc(a, 'parishes/A/meta/counters'), cnt); return b.commit(); };
  await assertFails(raw('CCC-MBR-003'));                              // no counter move
  await assertFails(raw('CCC-MBR-009', { mbr: 9 }));                  // skip ahead
  await assertFails(raw('CCC-MBR-005', { mbr: 3 }));                  // id does not match counter
  await assertFails(raw('CCC-MBR-002', { mbr: 2 }));                  // reuse (counter not moved)
  await assertFails(updateDoc(doc(a, 'parishes/A/meta/counters'), { mbr: 1 }));   // rewind
  await assertFails(updateDoc(doc(a, 'parishes/A/meta/counters'), { mbr: 3 }));   // bump without record
  await assertFails(deleteDoc(doc(a, 'parishes/A/members/CCC-MBR-001')));
  await assertFails(deleteDoc(doc(a, 'parishes/A/clergy/CCC-CLG-001')));
  await assertFails(updateDoc(doc(a, 'parishes/A/members/CCC-MBR-001'), { memberNo: 'CCC-MBR-099' }));
  await assertSucceeds(raw('CCC-MBR-003', { mbr: 3 }));
});
test('clergy transfer keeps number, needs a leave date', async () => {
  const a = as.adminA();
  const r = doc(a, 'parishes/A/clergy/CCC-CLG-001');
  await assertFails(updateDoc(r, { status: 'Former' }));
  await assertSucceeds(updateDoc(r, { status: 'Former', leftDate: '2026-11-01', leaveReason: 'Transfer', transferredTo: 'Parish B', letterId: 'L1' }));
  assert((await getDoc(r)).data().memberNo, 'CCC-CLG-001');
  await assertSucceeds(setDoc(doc(a, 'parishes/A/letters/L1'), { clergyId: 'CCC-CLG-001', image: PHOTO, createdAt: 'now' }));
  await assertFails(getDoc(doc(as.adminB(), 'parishes/A/letters/L1')));
});
test('ordination: member retired as Ordained, new CLG number, history link', async () => {
  const a = as.adminA();
  await assertFails(updateDoc(doc(a, 'parishes/A/members/CCC-MBR-001'), { status: 'Ordained' })); // must link
  const id = await addRecord(a, 'A', 'clergy', clergy('x', 'ade@x.org', { formerMemberNo: 'CCC-MBR-001' }));
  await assertSucceeds(updateDoc(doc(a, 'parishes/A/members/CCC-MBR-001'), { status: 'Ordained', ordainedAs: id }));
  await assertFails(updateDoc(doc(a, 'parishes/A/members/CCC-MBR-001'), { status: 'Active' }));    // stays retired
});

// ---- Phase 1: clergy cannot be app admins ----
test('clergy-not-admin: clergy needs email; admin email cannot be clergy', async () => {
  const a = as.adminA();
  await assertFails(addRecord(a, 'A', 'clergy', clergy('x', '')));
  await assertFails(addRecord(a, 'A', 'clergy', clergy('x', 'a@x.org')));      // parish A's own admin
  await assertFails(addRecord(a, 'A', 'clergy', clergy('x', 'b@x.org')));      // another parish's admin
  await assertFails(updateDoc(doc(a, 'parishes/A/clergy/CCC-CLG-001'), { email: 'b@x.org' }));
});
test('clergy-not-admin: clergy email cannot be invited or made admin', async () => {
  const s = as.superA();
  await assertFails(setDoc(doc(s, 'invites/INVITECODE-0000000099'), { email: 'olu@x.org', parishId: 'A', role: 'parish_admin', usedBy: null }));
  await assertFails(setDoc(doc(s, 'users/uOlu'), { role: 'parish_admin', parishId: 'A', email: 'olu@x.org' }));
  await assertFails(setDoc(doc(s, 'users/uNoEmail'), { role: 'parish_admin', parishId: 'A' }));
  await assertSucceeds(setDoc(doc(s, 'users/uOk'), { role: 'parish_admin', parishId: 'A', email: 'ok@x.org' }));
  // A clergy who signs up with their own email cannot claim an admin profile.
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'invites/INVITECODE-0000000077'), { email: 'olu@x.org', parishId: 'A', role: 'parish_admin', usedBy: null }));
  await assertFails(claim(ctx('uOlu', 'olu@x.org'), 'uOlu', 'olu@x.org', 'INVITECODE-0000000077', 'A'));
});

// ---- Phase 1: invites (no self-registration) ----
function claim(db, uid, email, code, parishId) {
  const b = writeBatch(db);
  b.set(doc(db, `users/${uid}`), { role: 'parish_admin', parishId, email, inviteCode: code });
  b.update(doc(db, `invites/${code}`), { usedBy: uid });
  b.set(doc(db, `adminEmails/${email}`), { uid });
  return b.commit();
}
test('invite: super creates parish + invite in one batch', async () => {
  const s = as.superA();
  const b = writeBatch(s);
  b.set(doc(s, 'parishes/N'), { name: 'New Parish', status: 'Approved', address: '1 Road', city: 'Ikeja', state: 'Lagos', country: 'Nigeria', continent: 'Africa', mapsUrl: 'https://maps.google.com/?q=1', createdAt: 'now' });
  b.set(doc(s, 'parishes/N/meta/counters'), { clg: 0, mbr: 0 });
  b.set(doc(s, 'parishStats/N'), { memberCount: 0, clergyCount: 0 });
  b.set(doc(s, 'invites/INVITECODE-NNNNNNNNNN'), { email: 'n@x.org', parishId: 'N', role: 'parish_admin', usedBy: null, createdAt: 'now' });
  await assertSucceeds(b.commit());
  await assertFails(setDoc(doc(s, 'invites/short'), { email: 'n2@x.org', parishId: 'N', role: 'parish_admin', usedBy: null }));
  await assertFails(setDoc(doc(as.adminA(), 'invites/INVITECODE-AAAAAAAAAA'), { email: 'z@x.org', parishId: 'A', role: 'parish_admin', usedBy: null }));
  await assertFails(setDoc(doc(as.adminA(), 'parishes/Z'), { name: 'Z', status: 'Approved' }));
});
test('invite: invited admin claims with matching email + code, once', async () => {
  await assertSucceeds(claim(ctx('uNew', 'new@x.org'), 'uNew', 'new@x.org', 'INVITECODE-0000000001', 'B'));
  await assertSucceeds(getDoc(doc(ctx('uNew', 'new@x.org'), 'parishes/B')));
  await assertFails(claim(ctx('uNew2', 'new@x.org'), 'uNew2', 'new@x.org', 'INVITECODE-0000000001', 'B'));   // already used
});
test('invite: wrong email, wrong parish, or no invite is refused', async () => {
  await assertFails(claim(ctx('uEvil', 'evil@x.org'), 'uEvil', 'new@x.org', 'INVITECODE-0000000001', 'B'));
  await assertFails(claim(ctx('uEvil', 'evil@x.org'), 'uEvil', 'evil@x.org', 'INVITECODE-0000000001', 'B'));
  await assertFails(claim(ctx('uNew', 'new@x.org'), 'uNew', 'new@x.org', 'INVITECODE-0000000001', 'A'));
  await assertFails(claim(ctx('uNew', 'new@x.org'), 'uNew', 'new@x.org', 'NO-SUCH-INVITE-CODE', 'B'));
  const db = ctx('uNew', 'new@x.org');
  await assertFails(setDoc(doc(db, 'users/uNew'), { role: 'parish_admin', parishId: 'B', email: 'new@x.org' }));
  await assertFails(setDoc(doc(db, 'users/uNew'), { role: 'super_admin', parishId: 'B', email: 'new@x.org', inviteCode: 'INVITECODE-0000000001' }));
  await assertFails(getDocs(collection(db, 'invites')));
  await assertFails(setDoc(doc(as.noRole(), 'parishRequests/uX'), { parishName: 'Self', email: 'x@y.com', status: 'Pending' }));
});

// ---- Phase 1: parish branding ----
test('parish admin edits name, logo, location; not status', async () => {
  const a = as.adminA();
  await assertSucceeds(updateDoc(doc(a, 'parishes/A'), { name: 'Grace Parish', logo: PHOTO, city: 'Ikeja', continent: 'Africa', mapsUrl: 'https://maps.app.goo.gl/x' }));
  await assertFails(updateDoc(doc(a, 'parishes/A'), { logo: 'javascript:alert(1)' }));
  await assertFails(updateDoc(doc(a, 'parishes/A'), { mapsUrl: 'javascript:alert(1)' }));
  await assertFails(updateDoc(doc(a, 'parishes/A'), { continent: 'Atlantis' }));
  await assertFails(updateDoc(doc(a, 'parishes/A'), { name: '' }));
  await assertFails(updateDoc(doc(as.adminB(), 'parishes/A'), { name: 'Hijack' }));
});

// ---- Phase 1: super_admin sees totals, clergy, important members only ----
test('super admin: totals + clergy register + important members only', async () => {
  const s = as.superA();
  await assertSucceeds(getDoc(doc(s, 'parishStats/A')));
  await assertSucceeds(getDocs(collectionGroup(s, 'clergy')));
  await assertSucceeds(getDoc(doc(s, 'parishes/A/clergy/CCC-CLG-001')));
  await assertSucceeds(getDocs(query(collectionGroup(s, 'members'), where('important', '==', true))));
  await assertSucceeds(getDoc(doc(s, 'parishes/A/members/CCC-MBR-002')));
  await assertFails(getDoc(doc(s, 'parishes/A/members/CCC-MBR-001')));
  await assertFails(getDocs(collection(s, 'parishes/A/members')));
  await assertFails(getDocs(collectionGroup(s, 'members')));
  await assertFails(getDocs(collection(s, 'parishes/A/finances')));
  await assertFails(getDocs(collection(s, 'parishes/A/attendance')));
  await assertFails(getDocs(collection(s, 'parishes/A/families')));
  await assertFails(getDoc(doc(s, 'parishes/A/letters/L1')));
  await assertFails(addRecord(s, 'A', 'members', person('x')));
  await assertFails(updateDoc(doc(s, 'parishes/A/clergy/CCC-CLG-001'), { rank: 'Leader' }));
});

// ---- Phase 1: families ----
test('families: own parish only', async () => {
  const fam = { name: 'Bisi family', memberNos: ['CCC-MBR-001', 'CCC-MBR-002'], roles: { 'CCC-MBR-001': 'Spouse', 'CCC-MBR-002': 'Child' } };
  await assertSucceeds(setDoc(doc(as.adminA(), 'parishes/A/families/f1'), fam));
  await assertSucceeds(getDocs(query(collection(as.adminA(), 'parishes/A/families'), where('memberNos', 'array-contains', 'CCC-MBR-001'))));
  await assertFails(setDoc(doc(as.adminB(), 'parishes/A/families/f2'), fam));
  await assertFails(setDoc(doc(as.adminA(), 'parishes/A/families/f3'), { ...fam, secret: 1 }));
});

function assert(actual, expected) { if (actual !== expected) throw new Error(`expected ${expected}, got ${actual}`); }

// Firestore caps each request at 1000 evaluated expressions. Fully filled records, in the
// same multi-write shapes the app uses, must stay under it.
const FULL = { photo: PHOTO, address: '12 Long Street, Ikeja, Lagos', email: 'full@x.org', rank: 'Venerable Most Senior Evangelist',
  occupation: 'Civil Engineer', dobYear: 1960, anointDay: 25, anointMonth: 12, anointYear: 2025, important: true,
  nokName: 'Kin Name', nokAddress: 'Ibadan', nokPhone: '0700 000 0000' };
test('limits: full records in app-shaped writes (create, ordain, transfer, edit)', async () => {
  const a = as.adminA();
  const m = await addRecord(a, 'A', 'members', person('x', { ...FULL, email: '' }));
  await assertSucceeds(setDoc(doc(a, `parishes/A/members/${m}`), person(m, { ...FULL, email: 'member@x.org', fullName: 'Edited', nameLower: 'edited' })));
  const clg = await addRecord(a, 'A', 'clergy', clergy('x', 'full@x.org', { ...FULL, formerMemberNo: '', leftDate: '', leaveReason: '', transferredTo: '', letterId: '' }));
  // Ordain a full member: clergy create + member update + counter + index + stats in one transaction.
  await assertSucceeds(runTransaction(a, async (t) => {
    const cRef = doc(a, 'parishes/A/meta/counters');
    const n = (await t.get(cRef)).data().clg + 1;
    const id = 'CCC-CLG-' + String(n).padStart(3, '0');
    t.update(cRef, { clg: n });
    t.set(doc(a, `parishes/A/clergy/${id}`), clergy(id, 'ordained@x.org', { ...FULL, email: 'ordained@x.org', formerMemberNo: 'CCC-MBR-003' }));
    t.set(doc(a, 'clergyIndex/ordained@x.org'), { parishId: 'A', clergyId: id });
    t.update(doc(a, 'parishes/A/members/CCC-MBR-003'), { status: 'Ordained', ordainedAs: id });
    t.set(doc(a, 'parishStats/A'), { memberCount: increment(-1), clergyCount: increment(1) }, { merge: true });
  }));
  // Transfer a full clergy with a letter + stats in one batch.
  const b = writeBatch(a);
  b.set(doc(a, 'parishes/A/letters/L9'), { clergyId: clg, image: 'data:image/jpeg;base64,' + 'A'.repeat(330000), createdAt: 'now' });
  b.update(doc(a, `parishes/A/clergy/${clg}`), { status: 'Former', leftDate: '2026-11-01', leaveReason: 'Transfer', transferredTo: 'Parish B', letterId: 'L9',
    serviceRecord: Array.from({ length: 10 }, (_, i) => ({ rank: 'Evangelist', from: '2010-01-01', to: '2026-11-01' })) });
  b.set(doc(a, 'parishStats/A'), { clergyCount: increment(-1), formerClergyCount: increment(1) }, { merge: true });
  await assertSucceeds(b.commit());
  // Edit a full clergy (set whole doc + index), as the edit form does.
  const c2 = await addRecord(a, 'A', 'clergy', clergy('x', 'edit@x.org', FULL));
  const e = writeBatch(a);
  e.set(doc(a, `parishes/A/clergy/${c2}`), clergy(c2, 'edit2@x.org', { ...FULL, email: 'edit2@x.org', fullName: 'Edited', nameLower: 'edited' }));
  e.set(doc(a, 'clergyIndex/edit2@x.org'), { parishId: 'A', clergyId: c2 });
  await assertSucceeds(e.commit());
});
