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

// ---------------------------------------------------------------- Phase 2: departments
const dm = (dept, no, extra = {}) => ({ dept, memberNo: no, fullName: 'Ade Bisi', role: '', status: 'Current', joinedDate: '2026-11-01', updatedAt: 'now', ...extra });
test('departments: add an Active member, move to Former, set the 2-year term', async () => {
  const a = as.adminA();
  await assertSucceeds(setDoc(doc(a, 'parishes/A/deptMembers/choir_CCC-MBR-001'), dm('choir', 'CCC-MBR-001')));
  await assertSucceeds(getDocs(query(collection(a, 'parishes/A/deptMembers'), where('dept', '==', 'choir'))));
  await assertFails(setDoc(doc(a, 'parishes/A/deptMembers/choir_CCC-MBR-001'), dm('choir', 'CCC-MBR-001', { status: 'Former' }))); // needs leftDate
  await assertSucceeds(setDoc(doc(a, 'parishes/A/deptMembers/choir_CCC-MBR-001'), dm('choir', 'CCC-MBR-001', { status: 'Former', leftDate: '2026-11-02' })));
  await assertFails(deleteDoc(doc(a, 'parishes/A/deptMembers/choir_CCC-MBR-001')));
  await assertSucceeds(setDoc(doc(a, 'parishes/A/departments/choir'), { termStart: '2025-01-01', termEnd: '2027-01-01', updatedAt: 'now' }));
  await assertFails(setDoc(doc(a, 'parishes/A/departments/choir'), { termStart: '2027-01-01', termEnd: '2025-01-01' }));
  await assertFails(setDoc(doc(a, 'parishes/A/departments/football'), { termStart: '2025-01-01', termEnd: '2027-01-01' }));
});
test('departments: clergy cannot join (CLG number, ordained member, unknown member)', async () => {
  const a = as.adminA();
  await assertFails(setDoc(doc(a, 'parishes/A/deptMembers/choir_CCC-CLG-001'), dm('choir', 'CCC-CLG-001')));
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'parishes/A/members/CCC-MBR-002'), person('CCC-MBR-002', { status: 'Ordained', ordainedAs: 'CCC-CLG-001' })));
  await assertFails(setDoc(doc(a, 'parishes/A/deptMembers/choir_CCC-MBR-002'), dm('choir', 'CCC-MBR-002')));
  await assertFails(setDoc(doc(a, 'parishes/A/deptMembers/choir_CCC-MBR-099'), dm('choir', 'CCC-MBR-099')));
  await assertFails(setDoc(doc(a, 'parishes/A/deptMembers/choir_CCC-MBR-001'), dm('football', 'CCC-MBR-001')));
  await assertFails(setDoc(doc(a, 'parishes/A/deptMembers/xyz'), dm('choir', 'CCC-MBR-001')));        // id must be dept_memberNo
});
test('departments: private to the parish (no other parish, no super, no hq)', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'parishes/A/deptMembers/choir_CCC-MBR-001'), dm('choir', 'CCC-MBR-001')));
  await assertFails(getDoc(doc(as.adminB(), 'parishes/A/deptMembers/choir_CCC-MBR-001')));
  await assertFails(setDoc(doc(as.adminB(), 'parishes/A/deptMembers/sidemen_CCC-MBR-001'), dm('sidemen', 'CCC-MBR-001')));
  await assertFails(getDoc(doc(as.superA(), 'parishes/A/deptMembers/choir_CCC-MBR-001')));
  await assertFails(getDoc(doc(as.hq(), 'parishes/A/deptMembers/choir_CCC-MBR-001')));
});

// ---------------------------------------------------------------- Phase 2: diaspora + transfers
async function seedPlaces() {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'parishes/A'), { name: 'Parish A', status: 'Approved', city: 'Lagos', country: 'Nigeria', code: 'AAAAA1' });
    await setDoc(doc(db, 'parishes/B'), { name: 'Parish B', status: 'Approved', city: 'London', country: 'United Kingdom', code: 'BBBBB2' });
    await setDoc(doc(db, 'parishCodes/AAAAA1'), { parishId: 'A' });
    await setDoc(doc(db, 'parishCodes/BBBBB2'), { parishId: 'B' });
    await setDoc(doc(db, 'parishStats/B'), { memberCount: 0, clergyCount: 0 });
  });
}
const tr = (extra = {}) => ({ memberNo: 'CCC-MBR-001', lifeNo: 'CCC-MBR-001', lifeParishCode: 'AAAAA1', fromParish: 'A', fromName: 'Parish A',
  fromCity: 'Lagos', fromCountry: 'Nigeria', toParish: 'B', toCode: 'BBBBB2', person: member, consentGiven: true, consentDate: '2026-11-01',
  status: 'Pending', createdAt: 'now', ...extra });
function send(db, id = 'T1', t = tr()) {
  const b = writeBatch(db);
  b.update(doc(db, `parishes/${t.fromParish}/members/${t.memberNo}`), { status: 'TransferredOut', transferId: id });
  b.set(doc(db, `transfers/${id}`), t);
  b.set(doc(db, `parishStats/${t.fromParish}`), { memberCount: increment(-1) }, { merge: true });
  return b.commit();
}
function accept(db, id = 'T1', life = 'CCC-MBR-001') {
  return runTransaction(db, async (t) => {
    const cRef = doc(db, 'parishes/B/meta/counters');
    const n = (await t.get(cRef)).data().mbr + 1;
    const no = 'CCC-MBR-' + String(n).padStart(3, '0');
    t.update(cRef, { mbr: n });
    t.set(doc(db, `parishes/B/members/${no}`), person(no, { transferId: id, lifeNo: life, lifeParishCode: 'AAAAA1' }));
    t.update(doc(db, `transfers/${id}`), { status: 'Accepted', newMemberNo: no, decidedAt: 'now' });
    t.set(doc(db, `flows/${id}`), { kind: 'Transfer', fromCity: 'Lagos', fromCountry: 'Nigeria', toCity: 'London', toCountry: 'United Kingdom', year: 2026 });
    t.set(doc(db, 'parishStats/B'), { memberCount: increment(1) }, { merge: true });
    return no;
  });
}
test('parish codes: any parish admin can look one up; only super creates', async () => {
  await seedPlaces();
  await assertSucceeds(getDoc(doc(as.adminA(), 'parishCodes/BBBBB2')));
  await assertFails(getDocs(collection(as.adminA(), 'parishCodes')));
  await assertFails(setDoc(doc(as.adminA(), 'parishCodes/ZZZZZ9'), { parishId: 'A' }));
  await assertFails(getDoc(doc(as.stranger(), 'parishCodes/BBBBB2')));
  const sdb = as.superA();
  const b = writeBatch(sdb);
  b.set(doc(sdb, 'parishes/C'), { name: 'Parish C', status: 'Approved', code: 'CCCCC3' });
  b.set(doc(sdb, 'parishCodes/CCCCC3'), { parishId: 'C' });
  await assertSucceeds(b.commit());
  await assertFails(setDoc(doc(as.superA(), 'parishCodes/WRONG1'), { parishId: 'C' }));  // code must match the parish
});
test('transfer: send with consent, accept by code, one life-long number, flow for super', async () => {
  await seedPlaces();
  await assertSucceeds(send(as.adminA()));
  // New parish sees the incoming transfer; super and other admins do not.
  await assertSucceeds(getDocs(query(collection(as.adminB(), 'transfers'), where('toParish', '==', 'B'), where('status', '==', 'Pending'))));
  await assertSucceeds(getDocs(query(collection(as.adminA(), 'transfers'), where('fromParish', '==', 'A'))));
  await assertFails(getDoc(doc(as.superA(), 'transfers/T1')));
  await assertFails(getDoc(doc(as.hq(), 'transfers/T1')));
  const no = await accept(as.adminB());
  assert(no, 'CCC-MBR-003');
  const rec = await getDoc(doc(as.adminB(), `parishes/B/members/${no}`));
  assert(rec.data().lifeNo, 'CCC-MBR-001');
  // Super sees the flow (places only), not the people.
  const flows = await assertSucceeds(getDocs(collection(as.superA(), 'flows')));
  assert(flows.docs.length, 1);
  assert(JSON.stringify(Object.keys(flows.docs[0].data()).sort()), JSON.stringify(['fromCity', 'fromCountry', 'kind', 'toCity', 'toCountry', 'year']));
  await assertFails(getDocs(collection(as.adminA(), 'flows')));
  // Cannot accept twice; old record stays TransferredOut and cannot be revived.
  await assertFails(accept(as.adminB()));
  await assertFails(updateDoc(doc(as.adminA(), 'parishes/A/members/CCC-MBR-001'), { status: 'Active' }));
});
test('transfer: refused without consent, to own parish, by the wrong parish, or with a changed number', async () => {
  await seedPlaces();
  await assertFails(send(as.adminA(), 'T1', tr({ consentGiven: false })));
  await assertFails(send(as.adminA(), 'T1', tr({ toCode: 'AAAAA1', toParish: 'A' })));       // own parish
  await assertFails(send(as.adminA(), 'T1', tr({ toCode: 'BBBBB2', toParish: 'S' })));       // code does not match
  await assertFails(send(as.adminA(), 'T1', tr({ fromCity: 'Abuja' })));                    // place must match the parish
  await assertFails(send(as.adminB(), 'T1', tr()));                                          // B cannot send A's member
  // Transfer doc without marking the member TransferredOut is refused.
  await assertFails(setDoc(doc(as.adminA(), 'transfers/T2'), tr()));
  await assertSucceeds(send(as.adminA()));
  await assertFails(accept(as.adminB(), 'T1', 'CCC-MBR-777'));                               // life number must be kept
  await assertFails(accept(as.adminA()));                                                    // only the receiving parish
  await assertFails(updateDoc(doc(as.adminA(), 'transfers/T1'), { status: 'Accepted', newMemberNo: 'x' }));
  // A member cannot claim a transfer id they did not arrive by.
  await assertFails(addRecord(as.adminB(), 'B', 'members', person('x', { transferId: 'NOPE', lifeNo: 'CCC-MBR-001', lifeParishCode: 'AAAAA1' })));
});
test('transfer: decline or cancel lets the old parish restore the member', async () => {
  await seedPlaces();
  await assertSucceeds(send(as.adminA()));
  await assertFails(updateDoc(doc(as.adminA(), 'parishes/A/members/CCC-MBR-001'), { status: 'Active' }));  // still pending
  await assertFails(updateDoc(doc(as.adminA(), 'transfers/T1'), { status: 'Declined', decidedAt: 'now' })); // only B declines
  await assertSucceeds(updateDoc(doc(as.adminB(), 'transfers/T1'), { status: 'Declined', decidedAt: 'now' }));
  await assertFails(updateDoc(doc(as.adminB(), 'transfers/T1'), { status: 'Accepted', decidedAt: 'now' }));  // decided is final
  await assertSucceeds(updateDoc(doc(as.adminA(), 'parishes/A/members/CCC-MBR-001'), { status: 'Active' }));
  // Send again, then the old parish cancels.
  await assertSucceeds(send(as.adminA(), 'T3'));
  await assertFails(updateDoc(doc(as.adminB(), 'transfers/T3'), { status: 'Cancelled', decidedAt: 'now' }));
  await assertSucceeds(updateDoc(doc(as.adminA(), 'transfers/T3'), { status: 'Cancelled', decidedAt: 'now' }));
});
test('diaspora: member moved abroad needs a country + date; flow carries places only', async () => {
  await seedPlaces();
  const a = as.adminA();
  await assertFails(updateDoc(doc(a, 'parishes/A/members/CCC-MBR-001'), { status: 'Diaspora' }));
  const b = writeBatch(a);
  b.update(doc(a, 'parishes/A/members/CCC-MBR-001'), { status: 'Diaspora', abroadCountry: 'United Kingdom', abroadCity: 'Manchester', abroadParish: '', abroadSince: '2026-10-01' });
  b.set(doc(a, 'flows/abroad_A_CCC-MBR-001_2026-10-01'), { kind: 'Abroad', fromCity: 'Lagos', fromCountry: 'Nigeria', toCity: 'Manchester', toCountry: 'United Kingdom', year: 2026 });
  b.set(doc(a, 'parishStats/A'), { memberCount: increment(-1), diasporaCount: increment(1) }, { merge: true });
  await assertSucceeds(b.commit());
  await assertSucceeds(getDocs(query(collection(a, 'parishes/A/members'), where('status', '==', 'Diaspora'))));
  // A flow for someone who did not move abroad, or with the wrong country, is refused.
  await assertFails(setDoc(doc(a, 'flows/abroad_A_CCC-MBR-002_2026-10-01'), { kind: 'Abroad', fromCity: 'Lagos', fromCountry: 'Nigeria', toCity: 'X', toCountry: 'United Kingdom', year: 2026 }));
  await assertFails(setDoc(doc(as.adminB(), 'flows/abroad_A_CCC-MBR-001_2026-10-01'), { kind: 'Abroad', fromCity: 'Lagos', fromCountry: 'Nigeria', toCity: 'X', toCountry: 'United Kingdom', year: 2026 }));
  // Diaspora member can transfer on to a parish abroad.
  await assertSucceeds(send(a, 'T5'));
});

// ---------------------------------------------------------------- Phase 3: attendance
const svc = (extra = {}) => ({ serviceDate: '2026-11-01', serviceType: 'Sunday Service', serviceKey: 'sunday', serviceTime: '10:00',
  men: 40, women: 50, children: 20, visitors: 5, headcount: 115, ledBy: 'CCC-CLG-001', ledByName: 'Ven Olu', notes: 'Harvest preparations', ...extra });
const SID = '2026-11-01_sunday';

test('attendance: old simple records stay readable and writable', async () => {
  const a = as.adminA();
  await assertSucceeds(getDoc(doc(a, 'parishes/A/attendance/t1')));
  await assertSucceeds(setDoc(doc(a, 'parishes/A/attendance/t2'), att));
});
test('attendance: scheduled service with men/women/children/visitors, clergy leader and notes', async () => {
  const a = as.adminA();
  const b = writeBatch(a);
  b.set(doc(a, `parishes/A/attendance/${SID}`), svc());
  b.set(doc(a, 'parishStats/A'), { attendanceTotal: increment(115), serviceCount: increment(1), byType: { sunday: { services: increment(1), total: increment(115) } } }, { merge: true });
  await assertSucceeds(b.commit());
  await assertFails(setDoc(doc(a, `parishes/A/attendance/${SID}`), svc({ headcount: 999 })));          // split must add up
  await assertFails(setDoc(doc(a, `parishes/A/attendance/${SID}`), svc({ men: -1, headcount: 74 })));   // no negatives
  await assertFails(setDoc(doc(a, `parishes/A/attendance/${SID}`), svc({ ledBy: 'CCC-CLG-099' })));     // leader must be our clergy
  await assertFails(setDoc(doc(a, `parishes/A/attendance/${SID}`), svc({ ledBy: 'CCC-MBR-001' })));     // a member is not clergy
  await assertFails(setDoc(doc(a, 'parishes/A/attendance/random'), svc()));                            // id = date_key
  await assertFails(setDoc(doc(a, `parishes/A/attendance/2026-11-01_party`), svc({ serviceKey: 'party' })));
  await assertFails(setDoc(doc(a, `parishes/A/attendance/${SID}`), svc({ extra: 1 })));
  // Special service (harvest): id carries the special service id.
  await assertSucceeds(setDoc(doc(a, 'parishes/A/specialServices/H1'), { name: 'Harvest', date: '2026-11-08', time: '10:00', notes: '', createdAt: 'now' }));
  await assertFails(setDoc(doc(a, 'parishes/A/specialServices/H2'), { name: 'Harvest', date: '2026-11-08', time: '10am' }));
  await assertSucceeds(setDoc(doc(a, 'parishes/A/attendance/2026-11-08_special_H1'), svc({ serviceDate: '2026-11-08', serviceKey: 'special', specialId: 'H1', serviceType: 'Harvest', ledBy: '' })));
  await assertFails(setDoc(doc(a, 'parishes/A/attendance/2026-11-08_special'), svc({ serviceDate: '2026-11-08', serviceKey: 'special', specialId: 'H1', ledBy: '' })));
});
test('units: admin-defined unit with its own short register; no whole-church tick-list', async () => {
  const a = as.adminA();
  await assertSucceeds(setDoc(doc(a, 'parishes/A/units/u_ushers'), { name: 'Ushers', createdAt: 'now' }));
  await assertFails(setDoc(doc(a, 'parishes/A/units/ushers'), { name: 'Ushers' }));                       // id must be u_xxx
  await assertFails(setDoc(doc(as.adminB(), 'parishes/A/units/u_x'), { name: 'X' }));
  await assertSucceeds(setDoc(doc(a, 'parishes/A/deptMembers/u_ushers_CCC-MBR-001'), { dept: 'u_ushers', memberNo: 'CCC-MBR-001', fullName: 'Ade Bisi', role: '', status: 'Current', joinedDate: '2026-11-01' }));
  await assertFails(setDoc(doc(a, 'parishes/A/deptMembers/u_ghost_CCC-MBR-001'), { dept: 'u_ghost', memberNo: 'CCC-MBR-001', fullName: 'Ade Bisi', role: '', status: 'Current', joinedDate: '2026-11-01' }));
  await assertFails(setDoc(doc(a, 'parishes/A/deptMembers/u_ushers_CCC-CLG-001'), { dept: 'u_ushers', memberNo: 'CCC-CLG-001', fullName: 'Ven Olu', role: '', status: 'Current', joinedDate: '2026-11-01' })); // clergy still barred
  await assertSucceeds(setDoc(doc(a, 'parishes/A/deptAttendance/u_ushers_2026-11-01'), { dept: 'u_ushers', date: '2026-11-01', kind: 'Service duty', present: ['CCC-MBR-001'], notes: '' }));
  await assertFails(setDoc(doc(a, 'parishes/A/deptAttendance/u_ghost_2026-11-01'), { dept: 'u_ghost', date: '2026-11-01', kind: 'Service duty', present: [] }));
  // The old per-person whole-church collections do not exist.
  await assertFails(setDoc(doc(a, `parishes/A/checkins/${SID}_CCC-MBR-001`), { memberNo: 'CCC-MBR-001' }));
  await assertFails(setDoc(doc(a, 'parishes/A/presence/CCC-MBR-001'), { memberNo: 'CCC-MBR-001' }));
});
test('attendance: department sessions and the cleaning rota', async () => {
  const a = as.adminA();
  await assertSucceeds(setDoc(doc(a, 'parishes/A/deptAttendance/choir_2026-10-31'), { dept: 'choir', date: '2026-10-31', kind: 'Practice', present: ['CCC-MBR-002'], notes: '' }));
  await assertFails(setDoc(doc(a, 'parishes/A/deptAttendance/band_2026-10-31'), { dept: 'band', date: '2026-10-31', kind: 'Practice', present: [] }));
  await assertFails(setDoc(doc(a, 'parishes/A/deptAttendance/choir_2026-10-30'), { dept: 'choir', date: '2026-10-31', kind: 'Practice', present: [] }));
  await assertSucceeds(setDoc(doc(a, 'parishes/A/cleaning/2026-10-31'), { date: '2026-10-31', assigned: ['CCC-MBR-001', 'CCC-MBR-002'], came: ['CCC-MBR-001'], names: { 'CCC-MBR-001': 'Ade Bisi' }, notes: '' }));
  await assertFails(setDoc(doc(a, 'parishes/A/cleaning/2026-10-30'), { date: '2026-10-31', assigned: [], came: [], names: {} }));
});
test('visitors: consent, follow-up status, convert to member in the same write', async () => {
  const a = as.adminA();
  const v = { name: 'Kemi Ola', nameLower: 'kemi ola', phone: '0803', phoneDigits: '0803', invitedBy: 'Ade Bisi', firstVisit: '2026-11-01', serviceType: 'Sunday Service', status: 'New', notes: '', consentGiven: true, createdAt: 'now', updatedAt: 'now' };
  await assertSucceeds(setDoc(doc(a, 'parishes/A/visitors/V1'), v));
  await assertFails(setDoc(doc(a, 'parishes/A/visitors/V2'), { ...v, consentGiven: false }));
  await assertFails(setDoc(doc(a, 'parishes/A/visitors/V2'), { ...v, nameLower: 'other' }));
  await assertSucceeds(updateDoc(doc(a, 'parishes/A/visitors/V1'), { status: 'Contacted' }));
  await assertFails(updateDoc(doc(a, 'parishes/A/visitors/V1'), { status: 'Member', memberNo: 'CCC-MBR-003' })); // member not created
  // Convert: new member + visitor marked Member, one transaction.
  await assertSucceeds(runTransaction(a, async (t) => {
    const cRef = doc(a, 'parishes/A/meta/counters');
    const n = (await t.get(cRef)).data().mbr + 1;
    const id = 'CCC-MBR-' + String(n).padStart(3, '0');
    t.update(cRef, { mbr: n });
    t.set(doc(a, `parishes/A/members/${id}`), person(id, { fullName: 'Kemi Ola', nameLower: 'kemi ola' }));
    t.update(doc(a, 'parishes/A/visitors/V1'), { status: 'Member', memberNo: id });
  }));
  await assertSucceeds(deleteDoc(doc(a, 'parishes/A/visitors/V1')));
});
test('attendance privacy: other parish, super admin and HQ see totals only', async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, `parishes/A/attendance/${SID}`), svc());
    await setDoc(doc(db, 'parishes/A/visitors/V1'), { name: 'Kemi' });
    await setDoc(doc(db, 'parishes/A/units/u_ushers'), { name: 'Ushers' });
    await setDoc(doc(db, 'parishes/A/deptAttendance/choir_2026-10-31'), { dept: 'choir' });
    await setDoc(doc(db, 'parishes/A/cleaning/2026-10-31'), { date: '2026-10-31' });
  });
  const paths = [`attendance/${SID}`, 'visitors/V1', 'units/u_ushers', 'deptAttendance/choir_2026-10-31', 'cleaning/2026-10-31'];
  for (const who of ['adminB', 'superA', 'hq', 'stranger', 'adminS']) {
    for (const p of paths) await assertFails(getDoc(doc(as[who](), `parishes/A/${p}`)));
    await assertFails(setDoc(doc(as[who](), `parishes/A/attendance/${SID}`), svc()));
  }
  await assertFails(getDocs(collectionGroup(as.superA(), 'deptAttendance')));
  await assertFails(getDocs(collectionGroup(as.superA(), 'visitors')));
  // Totals per service type are readable by super + HQ.
  await assertSucceeds(updateDoc(doc(as.adminA(), 'parishStats/A'), { byType: { sunday: { services: 1, total: 115 } }, visitorCount: 1 }));
  await assertFails(updateDoc(doc(as.adminA(), 'parishStats/A'), { visitorCount: -1 }));
  await assertSucceeds(getDoc(doc(as.superA(), 'parishStats/A')));
  await assertSucceeds(getDoc(doc(as.hq(), 'parishStats/A')));
});
