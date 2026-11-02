// CCC Firestore rules tests. Runs against the local Firestore emulator only.
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, deleteDoc, collection, collectionGroup, getDocs, query, where, orderBy, limit, writeBatch, increment, runTransaction } from 'firebase/firestore';

let env;
const ctx = (uid, email) => env.authenticatedContext(uid, email ? { email } : {}).firestore();
const as = {
  stranger: () => env.unauthenticatedContext().firestore(),
  superA: () => ctx('uSuper', 'super@x.org'),
  named: () => ctx('uNamed', 'bayo@x.org'),
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
  const prefix = `CCC-${parish}${parish}${parish}-LAG-` + (kind === 'clergy' ? 'CLG-' : 'MBR-');
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
    await setDoc(doc(db, 'users/uNamed'), { role: 'super_admin', name: 'Bayo Adeyemi' });
    await setDoc(doc(db, 'users/uHQ'), { role: 'hq' });
    await setDoc(doc(db, 'users/uA'), { role: 'parish_admin', parishId: 'A', email: 'a@x.org' });
    await setDoc(doc(db, 'users/uB'), { role: 'parish_admin', parishId: 'B', email: 'b@x.org' });
    await setDoc(doc(db, 'users/uS'), { role: 'parish_admin', parishId: 'S' });
    await setDoc(doc(db, 'adminEmails/a@x.org'), { uid: 'uA' });
    await setDoc(doc(db, 'adminEmails/b@x.org'), { uid: 'uB' });
    for (const p of ['A', 'B', 'S']) {
      await setDoc(doc(db, `parishes/${p}`), { name: 'Parish ' + p, status: p === 'S' ? 'Suspended' : 'Approved', parishLetters: p + p + p, cityLetters: 'LAG', city: 'Lagos', country: 'Nigeria', continent: 'Africa', currency: 'NGN' });
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
  await assertSucceeds(addRecord(a, 'A', 'members', person('x', { photo: PHOTO, dobYear: 1980, anointDay: 1, anointMonth: 5, anointYear: 2024, gender: 'Male', rank: 'Senior Leader', email: 'ade@x.org' })));
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
  assert(await addRecord(a, 'A', 'members', person('x')), 'CCC-AAA-LAG-MBR-003');
  assert(await addRecord(a, 'A', 'clergy', clergy('x', 'new.clergy@x.org')), 'CCC-AAA-LAG-CLG-002');
  assert(await addRecord(a, 'A', 'members', person('x')), 'CCC-AAA-LAG-MBR-004');
  const c = await getDoc(doc(a, 'parishes/A/meta/counters'));
  assert(JSON.stringify(c.data()), JSON.stringify({ clg: 2, mbr: 4 }));
});
test('numbers: cannot skip, reuse, rewind, or delete', async () => {
  const a = as.adminA();
  const raw = (id, cnt) => { const b = writeBatch(a); b.set(doc(a, `parishes/A/members/${id}`), person(id)); if (cnt) b.update(doc(a, 'parishes/A/meta/counters'), cnt); return b.commit(); };
  await assertFails(raw('CCC-AAA-LAG-MBR-003'));                              // no counter move
  await assertFails(raw('CCC-AAA-LAG-MBR-009', { mbr: 9 }));                  // skip ahead
  await assertFails(raw('CCC-AAA-LAG-MBR-005', { mbr: 3 }));                  // id does not match counter
  await assertFails(raw('CCC-AAA-LAG-MBR-002', { mbr: 2 }));                  // reuse (counter not moved)
  await assertFails(updateDoc(doc(a, 'parishes/A/meta/counters'), { mbr: 1 }));   // rewind
  await assertFails(updateDoc(doc(a, 'parishes/A/meta/counters'), { mbr: 3 }));   // bump without record
  await assertFails(deleteDoc(doc(a, 'parishes/A/members/CCC-MBR-001')));
  await assertFails(deleteDoc(doc(a, 'parishes/A/clergy/CCC-CLG-001')));
  await assertFails(updateDoc(doc(a, 'parishes/A/members/CCC-MBR-001'), { memberNo: 'CCC-MBR-099' }));
  await assertSucceeds(raw('CCC-AAA-LAG-MBR-003', { mbr: 3 }));
  await assertFails(raw('CCC-MBR-004', { mbr: 4 }));                  // new numbers must carry the parish lettering
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
const FULL = { gender: 'Male', photo: PHOTO, address: '12 Long Street, Ikeja, Lagos', email: 'full@x.org', rank: 'Venerable Most Senior Evangelist',
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
    const id = 'CCC-AAA-LAG-CLG-' + String(n).padStart(3, '0');
    t.update(cRef, { clg: n });
    t.set(doc(a, `parishes/A/clergy/${id}`), clergy(id, 'ordained@x.org', { ...FULL, email: 'ordained@x.org', formerMemberNo: 'CCC-AAA-LAG-MBR-003' }));
    t.set(doc(a, 'clergyIndex/ordained@x.org'), { parishId: 'A', clergyId: id });
    t.update(doc(a, 'parishes/A/members/CCC-AAA-LAG-MBR-003'), { status: 'Ordained', ordainedAs: id });
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
    await setDoc(doc(db, 'parishes/A'), { name: 'Parish A', status: 'Approved', city: 'Lagos', country: 'Nigeria', code: 'AAAAA1', parishLetters: 'AAA', cityLetters: 'LAG' });
    await setDoc(doc(db, 'parishes/B'), { name: 'Parish B', status: 'Approved', city: 'London', country: 'United Kingdom', code: 'BBBBB2', parishLetters: 'BBB', cityLetters: 'LAG' });
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
    const no = 'CCC-BBB-LAG-MBR-' + String(n).padStart(3, '0');
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
  b.set(doc(sdb, 'parishes/C'), { name: 'Parish C', status: 'Approved', code: 'CCCCC3', parishLetters: 'CCC', cityLetters: 'LAG' });
  b.set(doc(sdb, 'parishCodes/CCCCC3'), { parishId: 'C' });
  b.set(doc(sdb, 'parishLettering/CCC-LAG'), { parishId: 'C' });
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
  assert(no, 'CCC-BBB-LAG-MBR-003');
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
  await assertFails(updateDoc(doc(a, 'parishes/A/visitors/V1'), { status: 'Member', memberNo: 'CCC-AAA-LAG-MBR-003' })); // member not created
  // Convert: new member + visitor marked Member, one transaction.
  await assertSucceeds(runTransaction(a, async (t) => {
    const cRef = doc(a, 'parishes/A/meta/counters');
    const n = (await t.get(cRef)).data().mbr + 1;
    const id = 'CCC-AAA-LAG-MBR-' + String(n).padStart(3, '0');
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

// ---------------------------------------------------------------- Phase 4: parish lettering
test('parish lettering: set once by super, unique worldwide, index in the same write', async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    for (const p of ['X1', 'X2', 'X3']) await setDoc(doc(c.firestore(), `parishes/${p}`), { name: 'Ijaye', status: 'Approved' });
  });
  const s = as.superA();
  const setL = (p, pl, cl) => { const b = writeBatch(s); b.update(doc(s, `parishes/${p}`), { parishLetters: pl, cityLetters: cl });
    b.set(doc(s, `parishLettering/${pl}-${cl}`), { parishId: p }); return b.commit(); };
  await assertSucceeds(setL('X1', 'IJY', 'ABK'));
  await assertFails(setL('X2', 'IJY', 'ABK'));            // same lettering taken
  await assertSucceeds(setL('X2', 'IJY', 'LAG'));         // same parish name, other city: fine
  await assertFails(setL('X1', 'XYZ', 'ABK'));            // cannot change once set
  await assertFails(updateDoc(doc(s, 'parishes/X3'), { parishLetters: 'ABC', cityLetters: 'DEF' }));  // no index doc
  await assertFails(setL('X3', 'ab', 'CD'));              // uppercase 2-4 letters
  await assertFails(setL('X3', 'ABCDE', 'CD'));
  await assertFails(updateDoc(doc(as.adminA(), 'parishes/A'), { parishLetters: 'QQ' }));             // parish admin cannot
  await assertFails(setDoc(doc(as.adminA(), 'parishLettering/QQ-RR'), { parishId: 'A' }));
  await assertSucceeds(getDoc(doc(as.adminB(), 'parishLettering/IJY-ABK')));
  const b = writeBatch(s);
  b.set(doc(s, 'parishes/N'), { name: 'Ijaye', status: 'Approved', parishLetters: 'IJY', cityLetters: 'IBD' });
  b.set(doc(s, 'parishLettering/IJY-IBD'), { parishId: 'N' });
  await assertSucceeds(b.commit());
});
test('numbers: no lettering, no new number; old-style records keep working', async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'parishes/A'), { name: 'Parish A', status: 'Approved' });
  });
  const a = as.adminA();
  await assertFails(addRecord(a, 'A', 'members', person('x')));
  // Old CCC-MBR-001 is still readable, editable and usable in a department.
  await assertSucceeds(updateDoc(doc(a, 'parishes/A/members/CCC-MBR-001'), { phone: '0809' }));
  await assertSucceeds(setDoc(doc(a, 'parishes/A/deptMembers/choir_CCC-MBR-001'), dm('choir', 'CCC-MBR-001')));
});

// ---------------------------------------------------------------- Phase 4: female rank line
test('ranks: dropdown line must match gender', async () => {
  const a = as.adminA();
  await assertSucceeds(addRecord(a, 'A', 'members', person('x', { gender: 'Female', rank: 'Mother Celestial' })));
  await assertSucceeds(addRecord(a, 'A', 'members', person('x', { gender: 'Female', rank: 'Lace Elder Sister / Lace Senior Elder Sister' })));
  await assertSucceeds(addRecord(a, 'A', 'members', person('x', { gender: 'Male', rank: 'Supreme Evangelist' })));
  await assertFails(addRecord(a, 'A', 'members', person('x', { gender: 'Female', rank: 'Evangelist' })));
  await assertFails(addRecord(a, 'A', 'members', person('x', { gender: 'Male', rank: 'Elder Sister' })));
  await assertFails(addRecord(a, 'A', 'members', person('x', { gender: 'Female', rank: 'Lace Elder Sister' })));
});

// ---------------------------------------------------------------- Phase 4: births, children, teens, deaths
const ymd = (d) => d.toISOString().slice(0, 10);
const yearsAgo = (y, days = 0) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - y); d.setUTCDate(d.getUTCDate() + days); return ymd(d); };
const young = (no, dob, extra = {}) => ({ no, fullName: 'Baby Ade', nameLower: 'baby ade', gender: 'Female', dob, status: 'Active',
  consentGiven: true, consentDate: '2026-11-01', createdAt: 'now', updatedAt: 'now', ...extra });
const birth = (no, dob, extra = {}) => young(no, dob, { place: 'Ikeja', fatherNo: 'CCC-MBR-002', fatherName: 'Head Choir', motherNo: '', motherName: 'Ade Bisi',
  namingDate: dob, officiant: 'CCC-CLG-001', officiantName: 'Evangelist Ven Olu', ...extra });
const SER = { births: ['brt', 'CCC-AAA-LAG-BRT-'], children: ['chd', 'CCC-AAA-LAG-CHD-'], teens: ['ten', 'CCC-AAA-LAG-TEN-'], deaths: ['dth', 'CCC-AAA-LAG-DTH-'] };
// Same shape as the app: counter doc meta/{k} = { n }, record, stats, extra writes, one transaction.
async function addYoung(db, col, data, extra) {
  const [k, prefix] = SER[col];
  return runTransaction(db, async (t) => {
    const cRef = doc(db, `parishes/A/meta/${k}`);
    const c = await t.get(cRef);
    const n = (c.exists() ? c.data().n : 0) + 1;
    const id = prefix + String(n).padStart(3, '0');
    t.set(cRef, { n });
    t.set(doc(db, `parishes/A/${col}/${id}`), { ...data, no: id });
    if (extra) extra(t, id);
    return id;
  });
}
const NEXT = { births: 'children', children: 'teens', teens: 'members' };
async function moveUp(db, col, id, uid = 'uA') {
  const rec = (await getDoc(doc(db, `parishes/A/${col}/${id}`))).data();
  const next = NEXT[col];
  const mark = (t, newId) => t.update(doc(db, `parishes/A/${col}/${id}`), { status: 'Moved', movedTo: newId, movedAt: 'now', movedBy: uid, updatedAt: 'now' });
  if (next !== 'members') return addYoung(db, next, { ...young('x', rec.dob), fullName: rec.fullName, nameLower: rec.nameLower, fromNo: id }, mark);
  const [y, m, d] = rec.dob.split('-').map(Number);
  return runTransaction(db, async (t) => {
    const cRef = doc(db, 'parishes/A/meta/counters');
    const n = (await t.get(cRef)).data().mbr + 1;
    const newId = 'CCC-AAA-LAG-MBR-' + String(n).padStart(3, '0');
    t.update(cRef, { mbr: n });
    t.set(doc(db, `parishes/A/members/${newId}`), person(newId, { dobDay: d, dobMonth: m, dobYear: y, maritalStatus: 'Single', fromNo: id }));
    mark(t, newId);
    return newId;
  });
}

test('births: record with linked parents + clergy, own number series CCC-BRT-001', async () => {
  const a = as.adminA();
  const b1 = await addYoung(a, 'births', birth('x', yearsAgo(0, -10)));
  assert(b1, 'CCC-AAA-LAG-BRT-001');
  assert(await addYoung(a, 'births', birth('x', yearsAgo(1), { fatherNo: '', fatherName: 'Free Text Dad' })), 'CCC-AAA-LAG-BRT-002');
  await assertFails(addYoung(a, 'births', birth('x', yearsAgo(1), { fatherNo: 'CCC-MBR-999' })));      // unknown parent
  await assertFails(addYoung(a, 'births', birth('x', yearsAgo(1), { officiant: 'CCC-CLG-777' })));     // unknown clergy
  await assertFails(addYoung(a, 'births', birth('x', yearsAgo(-1))));                                // born in the future
  await assertFails(addYoung(a, 'births', birth('x', '2025-07')));                                   // full date required
  await assertFails(addYoung(a, 'births', birth('x', yearsAgo(1), { consentGiven: false })));
  // Cannot skip or rewind the series.
  const raw = writeBatch(a);
  raw.set(doc(a, 'parishes/A/meta/brt'), { n: 5 });
  raw.set(doc(a, 'parishes/A/births/CCC-AAA-LAG-BRT-005'), birth('CCC-AAA-LAG-BRT-005', yearsAgo(1)));
  await assertFails(raw.commit());
  await assertFails(deleteDoc(doc(a, 'parishes/A/births/CCC-BRT-001')));
  await assertSucceeds(updateDoc(doc(a, 'parishes/A/births/CCC-AAA-LAG-BRT-001'), { place: 'Lagos Island' }));
});

test('children + teens: full date of birth required; independent of members', async () => {
  const a = as.adminA();
  assert(await addYoung(a, 'children', { ...young('x', yearsAgo(5)), parentName: 'Ade Bisi', parentPhone: '080', address: 'Lagos' }), 'CCC-AAA-LAG-CHD-001');
  assert(await addYoung(a, 'teens', young('x', yearsAgo(14))), 'CCC-AAA-LAG-TEN-001');
  await assertFails(addYoung(a, 'children', young('x', '')));
  await assertFails(addYoung(a, 'teens', { ...young('x', yearsAgo(14)), dobDay: 4 }));
  // A child cannot pretend to come from a birth record that was not moved.
  await addYoung(a, 'births', birth('x', yearsAgo(3)));
  await assertFails(addYoung(a, 'children', { ...young('x', yearsAgo(3)), fromNo: 'CCC-BRT-001' }));
});

test('moves by age: birth -> child at 2, child -> teen at 12, teen -> member at 18 (CCC-MBR), history links', async () => {
  const a = as.adminA();
  const b = await addYoung(a, 'births', birth('x', yearsAgo(2, -1)));
  const tooYoung = await addYoung(a, 'births', birth('x', yearsAgo(2, 1)));
  const c = await moveUp(a, 'births', b);
  assert(c, 'CCC-AAA-LAG-CHD-001');
  await assertFails(moveUp(a, 'births', tooYoung));                                    // not 2 yet: server date decides
  await assertFails(moveUp(a, 'births', b));                                           // already moved
  const moved = (await getDoc(doc(a, `parishes/A/births/${b}`))).data();
  assert(moved.movedTo, c);
  assert((await getDoc(doc(a, `parishes/A/children/${c}`))).data().fromNo, b);
  await assertFails(updateDoc(doc(a, `parishes/A/births/${b}`), { status: 'Active' }));  // Moved is final
  await assertFails(moveUp(a, 'children', c));                                          // a 2-year-old is not 12
  const c12 = await addYoung(a, 'children', young('x', yearsAgo(12)));
  const t = await moveUp(a, 'children', c12);
  await assertFails(moveUp(a, 'teens', t));                                             // 12 is not 18
  const t18 = await addYoung(a, 'teens', young('x', yearsAgo(18, -3)));
  const m = await moveUp(a, 'teens', t18);
  assert(m, 'CCC-AAA-LAG-MBR-003');
  assert((await getDoc(doc(a, `parishes/A/members/${m}`))).data().fromNo, t18);
  // movedBy must be the person doing it (audit).
  const t2 = await addYoung(a, 'teens', young('x', yearsAgo(19)));
  await assertFails(moveUp(a, 'teens', t2, 'someoneElse'));
  // Pending-moves query used on app load (needs the status+dob composite index on live).
  await assertSucceeds(getDocs(query(collection(a, 'parishes/A/teens'), where('status', '==', 'Active'), where('dob', '<=', yearsAgo(18)), limit(50))));
});

test('deaths: linked member is marked Called to glory in the same write, never deleted; certificate number CCC-DTH-001', async () => {
  const a = as.adminA();
  const death = (no, extra = {}) => ({ no, fullName: 'Ade Bisi', nameLower: 'ade bisi', personNo: 'CCC-MBR-001', gender: 'Female',
    dateOfDeath: '2026-10-30', age: 70, place: 'Lagos', burialDate: '2026-11-07', officiant: 'CCC-CLG-001', officiantName: 'Ev Ven Olu',
    informant: 'Tunde Bisi', notes: '', createdAt: 'now', updatedAt: 'now', ...extra });
  // Without marking the member, the death record is refused.
  await assertFails(addYoung(a, 'deaths', death('x')));
  // Member cannot be marked Called to glory without a death record.
  await assertFails(updateDoc(doc(a, 'parishes/A/members/CCC-MBR-001'), { status: 'Called to glory', deathId: 'CCC-DTH-009' }));
  const d1 = await addYoung(a, 'deaths', death('x'), (t, id) => {
    t.update(doc(a, 'parishes/A/members/CCC-MBR-001'), { status: 'Called to glory', deathId: id });
    t.set(doc(a, 'parishStats/A'), { memberCount: increment(-1), deathCount: increment(1) }, { merge: true });
  });
  assert(d1, 'CCC-AAA-LAG-DTH-001');
  assert((await getDoc(doc(a, 'parishes/A/members/CCC-MBR-001'))).data().status, 'Called to glory');
  await assertFails(updateDoc(doc(a, 'parishes/A/members/CCC-MBR-001'), { status: 'Active' }));   // final
  await assertFails(deleteDoc(doc(a, 'parishes/A/members/CCC-MBR-001')));
  await assertFails(deleteDoc(doc(a, `parishes/A/deaths/${d1}`)));
  await assertSucceeds(updateDoc(doc(a, `parishes/A/deaths/${d1}`), { burialDate: '2026-11-08' }));
  await assertFails(updateDoc(doc(a, `parishes/A/deaths/${d1}`), { personNo: 'CCC-MBR-002' }));
  // Unlinked (free-text) death of a non-member.
  assert(await addYoung(a, 'deaths', death('x', { personNo: '', fullName: 'Visitor X', nameLower: 'visitor x' })), 'CCC-AAA-LAG-DTH-002');
  // Clergy: moved to Former with leaveReason 'Called to glory'.
  await assertSucceeds(addYoung(a, 'deaths', death('x', { personNo: 'CCC-CLG-001', fullName: 'Ven Olu', nameLower: 'ven olu' }), (t, id) =>
    t.update(doc(a, 'parishes/A/clergy/CCC-CLG-001'), { status: 'Former', leftDate: '2026-10-30', leaveReason: 'Called to glory', deathId: id })));
  // A baby (births record).
  const b = await addYoung(a, 'births', birth('x', yearsAgo(1)));
  await assertSucceeds(addYoung(a, 'deaths', death('x', { personNo: b, fullName: 'Baby Ade', nameLower: 'baby ade', age: 1 }), (t, id) =>
    t.update(doc(a, `parishes/A/births/${b}`), { status: 'Called to glory', deathId: id })));
  await assertFails(addYoung(a, 'deaths', death('x', { age: 200, personNo: '' })));
});

test('phase 4 privacy + totals: other parish, super and HQ see counts only', async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'parishes/A/births/CCC-BRT-001'), birth('CCC-BRT-001', '2026-01-01'));
    await setDoc(doc(db, 'parishes/A/children/CCC-CHD-001'), young('CCC-CHD-001', '2020-01-01'));
    await setDoc(doc(db, 'parishes/A/teens/CCC-TEN-001'), young('CCC-TEN-001', '2012-01-01'));
    await setDoc(doc(db, 'parishes/A/deaths/CCC-DTH-001'), { no: 'CCC-DTH-001', fullName: 'X' });
  });
  for (const who of ['adminB', 'superA', 'hq', 'stranger', 'adminS']) {
    for (const p of ['births/CCC-BRT-001', 'children/CCC-CHD-001', 'teens/CCC-TEN-001', 'deaths/CCC-DTH-001'])
      await assertFails(getDoc(doc(as[who](), `parishes/A/${p}`)));
  }
  for (const g of ['births', 'children', 'teens', 'deaths']) await assertFails(getDocs(collectionGroup(as.superA(), g)));
  await assertSucceeds(updateDoc(doc(as.adminA(), 'parishStats/A'), { birthCount: 1, childCount: 1, teenCount: 1, deathCount: 1 }));
  await assertFails(updateDoc(doc(as.adminA(), 'parishStats/A'), { deathCount: -1 }));
  await assertSucceeds(getDoc(doc(as.hq(), 'parishStats/A')));
});

// ================= Phase 6: Monthly Returns =================
const CATS = ['tithes', 'offerings', 'thanksgiving', 'harvest', 'building', 'other'];
const DEFAULT_SHARES = { tithes: { num: 1, den: 3 }, offerings: { num: 0, den: 1 }, thanksgiving: { num: 0, den: 1 }, harvest: { num: 0, den: 1 }, building: { num: 0, den: 1 }, other: { num: 0, den: 1 } };
const eq = (a, b) => { if (a !== b) throw new Error(`expected ${b}, got ${a}`); };
const r2 = x => Math.round(x * 100) / 100;
const dueOf = (inc, sh = DEFAULT_SHARES) => r2(CATS.reduce((t, c) => t + inc[c] * sh[c].num / sh[c].den, 0));
const statusOf = d => d.disputed ? 'Disputed' : (d.confirmations > 0 && d.confirmed >= d.due && d.remitted >= d.due) ? 'Confirmed'
  : d.remitted >= d.due ? 'Paid' : d.remitted > 0 ? 'Part paid' : 'Due';
const income = (t = 90000, o = 20000) => ({ tithes: t, offerings: o, thanksgiving: 0, harvest: 0, building: 5000, other: 0 });
function newReturn(pid, month, extra = {}) {
  const inc = extra.income || income();
  const d = { parishId: pid, parishName: 'Parish ' + pid, city: 'Lagos', country: 'Nigeria', continent: 'Africa', month, currency: 'NGN',
    income: inc, shares: DEFAULT_SHARES, due: dueOf(inc), attendance: 400, services: 12, note: '', remitted: 0, confirmed: 0, confirmations: 0,
    disputed: false, disputeReason: '', version: 1, filedAt: '2026-11-03T00:00:00Z', filedBy: 'uA', updatedAt: '2026-11-03T00:00:00Z', ...extra };
  d.outstanding = r2(d.due - d.remitted); d.status = statusOf(d);
  return d;
}
const audit = (target, v, action, by, extra = {}) => ({ action, target, targetVersion: v, parishId: target.startsWith('returns/') ? target.split('/')[1].split('_')[0] : '',
  reason: '', before: null, after: null, by: by.uid, byEmail: by.email, byName: by.name || '', role: by.role, at: serverTimestamp(), ...extra });
const A = { uid: 'uA', email: 'a@x.org', role: 'parish_admin' };
const B = { uid: 'uB', email: 'b@x.org', role: 'parish_admin' };
const NAMED = { uid: 'uNamed', email: 'bayo@x.org', role: 'super_admin', name: 'Bayo Adeyemi' };
const UNNAMED = { uid: 'uSuper', email: 'super@x.org', role: 'super_admin', name: '' };
const auditId = (t, v) => t.replace('/', '_') + '_v' + v;

async function fileReturn(db, who, pid, month, extra = {}, auditExtra = {}) {
  const id = `${pid}_${month}`, b = writeBatch(db);
  b.set(doc(db, 'returns/' + id), newReturn(pid, month, extra));
  b.set(doc(db, 'auditLog/' + auditId('returns/' + id, 1)), audit('returns/' + id, 1, 'file', who, auditExtra));
  return b.commit();
}
async function seedReturn(pid, month, extra = {}) {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), `returns/${pid}_${month}`), newReturn(pid, month, extra)));
}
async function pay(db, who, id, old, amount, extra = {}, payExtra = {}) {
  const v = old.version + 1, d = { ...old, remitted: r2(old.remitted + amount), version: v, ...extra };
  d.outstanding = r2(d.due - d.remitted); d.status = statusOf(d);
  const b = writeBatch(db);
  b.update(doc(db, 'returns/' + id), d);
  b.set(doc(db, `returns/${id}/payments/p${v}`), { returnId: id, amount, date: '2026-11-05', method: 'Bank transfer', reference: 'TLR-0001', by: who.uid, byEmail: who.email, at: serverTimestamp(), ...payExtra });
  b.set(doc(db, 'auditLog/' + auditId('returns/' + id, v)), audit('returns/' + id, v, amount < 0 ? 'correct' : 'pay', who, amount < 0 ? { reason: payExtra.reason || '' } : {}));
  return b.commit();
}
async function confirm(db, who, id, old, amount, extra = {}) {
  const v = old.version + 1, d = { ...old, confirmed: r2(old.confirmed + amount), confirmations: old.confirmations + 1, version: v, ...extra };
  d.status = statusOf(d);
  const b = writeBatch(db);
  b.update(doc(db, 'returns/' + id), d);
  b.set(doc(db, `returns/${id}/confirmations/c${v}`), { returnId: id, amount, note: '', by: who.uid, byName: who.name || '', at: serverTimestamp() });
  b.set(doc(db, 'auditLog/' + auditId('returns/' + id, v)), audit('returns/' + id, v, 'confirm', who));
  return b.commit();
}
const getRet = async id => { let out; await env.withSecurityRulesDisabled(async c => { out = (await getDoc(doc(c.firestore(), 'returns/' + id))).data(); }); return out; };

test('p6 file: parish files own return with due = 1/3 of tithes, currency from parish, audited', async () => {
  await assertSucceeds(fileReturn(as.adminA(), A, 'A', '2026-10'));
  const r = await getRet('A_2026-10');
  eq(r.due, 30000); eq(r.status, 'Due'); eq(r.currency, 'NGN');
  // wrong due, wrong currency, other parish, no audit, suspended parish, wrong id
  await assertFails(fileReturn(as.adminA(), A, 'A', '2026-09', { due: 1000 }));
  await assertFails(fileReturn(as.adminA(), A, 'A', '2026-09', { currency: 'USD' }));
  await assertFails(fileReturn(as.adminB(), B, 'A', '2026-09'));
  await assertFails(setDoc(doc(as.adminA(), 'returns/A_2026-09'), newReturn('A', '2026-09')));
  await assertFails(fileReturn(as.adminS(), { ...A, uid: 'uS' }, 'S', '2026-09'));
  await assertFails(fileReturn(as.adminA(), A, 'A', '2026-13'));
  // cannot file as already-paid
  await assertFails(fileReturn(as.adminA(), A, 'A', '2026-09', { remitted: 30000 }));
});

test('p6 privacy: super reads returns, HQ/other parish/stranger cannot; nobody but the parish reads individual giving', async () => {
  await seedReturn('A', '2026-10');
  await assertSucceeds(getDoc(doc(as.named(), 'returns/A_2026-10')));
  await assertSucceeds(getDoc(doc(as.adminA(), 'returns/A_2026-10')));
  await assertFails(getDoc(doc(as.adminB(), 'returns/A_2026-10')));
  await assertFails(getDoc(doc(as.hq(), 'returns/A_2026-10')));
  await assertFails(getDoc(doc(as.stranger(), 'returns/A_2026-10')));
  // individual giver records (parish finances) stay parish-private
  await assertFails(getDocs(collection(as.named(), 'parishes/A/finances')));
  await assertFails(getDocs(collection(as.hq(), 'parishes/A/finances')));
  await assertSucceeds(getDocs(collection(as.adminA(), 'parishes/A/finances')));
  // a return cannot carry giver names (unknown keys refused)
  await assertFails(fileReturn(as.adminA(), A, 'A', '2026-09', { givers: [{ name: 'Ade Bisi', amount: 5000 }] }));
});

test('p6 payments: part paid -> paid; amount must match; nothing deleted; negative = correction with reason', async () => {
  await seedReturn('A', '2026-10');
  const id = 'A_2026-10';
  await assertFails(pay(as.adminA(), A, id, await getRet(id), 10000, { remitted: 15000 })); // remitted != payment
  await assertSucceeds(pay(as.adminA(), A, id, await getRet(id), 10000));
  eq((await getRet(id)).status, 'Part paid');
  await assertSucceeds(pay(as.adminA(), A, id, await getRet(id), 20000));
  eq((await getRet(id)).status, 'Paid');
  await assertFails(pay(as.adminA(), A, id, await getRet(id), -5000)); // correction without reason
  await assertSucceeds(pay(as.adminA(), A, id, await getRet(id), -5000, {}, { reason: 'Teller entered twice', corrects: 'p3' }));
  eq((await getRet(id)).status, 'Part paid');
  await assertFails(deleteDoc(doc(as.adminA(), `returns/${id}/payments/p2`)));
  await assertFails(updateDoc(doc(as.adminA(), `returns/${id}/payments/p2`), { amount: 1 }));
  await assertFails(deleteDoc(doc(as.adminA(), 'returns/' + id)));
  await assertFails(deleteDoc(doc(as.named(), 'returns/' + id)));
  await assertFails(pay(as.adminB(), B, id, await getRet(id), 1000));
  // parish cannot confirm its own money or change shares
  const r = await getRet(id);
  await assertFails(confirm(as.adminA(), A, id, r, 5000));
  await assertFails(pay(as.adminA(), A, id, r, 100, { shares: { ...DEFAULT_SHARES, tithes: { num: 1, den: 10 } }, due: 9000 }));
});

test('p6 corrections: income change needs a reason in the audit, version bump, due recomputed', async () => {
  await seedReturn('A', '2026-10');
  const id = 'A_2026-10', old = await getRet(id);
  const fix = (reason, due) => {
    const inc = income(120000); const d = { ...old, income: inc, due: due ?? dueOf(inc), version: 2 };
    d.outstanding = r2(d.due - d.remitted); d.status = statusOf(d);
    const db = as.adminA(), b = writeBatch(db);
    b.update(doc(db, 'returns/' + id), d);
    b.set(doc(db, 'auditLog/' + auditId('returns/' + id, 2)), audit('returns/' + id, 2, 'correct', A, { reason }));
    return b.commit();
  };
  await assertFails(fix(''));
  await assertFails(fix('Sunday count missed', 1));
  await assertSucceeds(fix('Sunday count missed'));
  eq((await getRet(id)).due, 40000);
});

test('p6 confirm + dispute: named super only; statuses Confirmed / Disputed', async () => {
  await seedReturn('A', '2026-10', { remitted: 30000 });
  const id = 'A_2026-10';
  await assertFails(confirm(as.superA(), UNNAMED, id, await getRet(id), 30000)); // no name on the account
  await assertFails(confirm(as.hq(), { uid: 'uHQ', email: '', role: 'hq', name: '' }, id, await getRet(id), 30000));
  await assertSucceeds(confirm(as.named(), NAMED, id, await getRet(id), 30000));
  eq((await getRet(id)).status, 'Confirmed');
  const dispute = (reason) => { const o = { ...NAMED }; return (async () => {
    const r = await getRet(id); const d = { ...r, disputed: true, disputeReason: reason, version: r.version + 1 }; d.status = statusOf(d);
    const db = as.named(), b = writeBatch(db);
    b.update(doc(db, 'returns/' + id), d);
    b.set(doc(db, 'auditLog/' + auditId('returns/' + id, d.version)), audit('returns/' + id, d.version, 'dispute', o, { reason }));
    return b.commit(); })(); };
  await assertFails(dispute(''));
  await assertSucceeds(dispute('Bank shows 25,000 only'));
  eq((await getRet(id)).status, 'Disputed');
  // super cannot touch the parish's figures
  const r = await getRet(id);
  await assertFails(pay(as.named(), NAMED, id, r, 1000));
});

test('p6 audit log: append-only, names the person, server time; parish sees only its own', async () => {
  await assertSucceeds(fileReturn(as.adminA(), A, 'A', '2026-10'));
  const aid = auditId('returns/A_2026-10', 1);
  await assertSucceeds(getDoc(doc(as.named(), 'auditLog/' + aid)));
  await assertSucceeds(getDocs(query(collection(as.adminA(), 'auditLog'), where('parishId', '==', 'A'))));
  await assertFails(getDocs(query(collection(as.adminB(), 'auditLog'), where('parishId', '==', 'A'))));
  await assertFails(getDocs(collection(as.hq(), 'auditLog')));
  await assertFails(updateDoc(doc(as.named(), 'auditLog/' + aid), { reason: 'x' }));
  await assertFails(deleteDoc(doc(as.named(), 'auditLog/' + aid)));
  // forged author / time / orphan entry
  await assertFails(fileReturn(as.adminA(), A, 'A', '2026-09', {}, { byEmail: 'someone@else.org' }));
  await assertFails(fileReturn(as.adminA(), A, 'A', '2026-08', {}, { at: '2020-01-01T00:00:00Z' }));
  await assertFails(setDoc(doc(as.adminA(), 'auditLog/' + auditId('returns/A_2026-07', 1)), audit('returns/A_2026-07', 1, 'file', A)));
});

test('p6 HQ settings: named super sets share fractions with an audit; parishes read; default 1/3 when unset', async () => {
  const save = (db, who, shares, v = 1) => { const b = writeBatch(db);
    b.set(doc(db, 'hqSettings/returns'), { shares, version: v, updatedAt: '2026-11-02', updatedBy: who.uid });
    b.set(doc(db, 'auditLog/' + auditId('hqSettings/returns', v)), audit('hqSettings/returns', v, 'settings', who));
    return b.commit(); };
  await assertFails(save(as.superA(), UNNAMED, DEFAULT_SHARES));
  await assertFails(save(as.adminA(), A, DEFAULT_SHARES));
  await assertFails(save(as.named(), NAMED, { ...DEFAULT_SHARES, tithes: { num: 4, den: 3 } }));
  const sh = { ...DEFAULT_SHARES, building: { num: 1, den: 10 } };
  await assertSucceeds(save(as.named(), NAMED, sh));
  await assertSucceeds(getDoc(doc(as.adminA(), 'hqSettings/returns')));
  await assertFails(deleteDoc(doc(as.named(), 'hqSettings/returns')));
  // returns must now use the new shares: 30000 + 10% of 5000 building
  await assertFails(fileReturn(as.adminA(), A, 'A', '2026-10'));
  const inc = income();
  await assertSucceeds(fileReturn(as.adminA(), A, 'A', '2026-10', { shares: sh, due: dueOf(inc, sh) }));
  eq((await getRet('A_2026-10')).due, 30500);
});

test('p6 rollups + alerts: super reads; parish adds its own deltas; alerts super-only with audit', async () => {
  const ru = { month: '2026-10', level: 'country', key: 'nigeria', name: 'Nigeria', country: 'Nigeria', continent: 'Africa', cur: { NGN: { due: increment(30000), returns: increment(1) } } };
  await assertSucceeds(setDoc(doc(as.adminA(), 'returnRollups/2026-10_country_nigeria'), ru, { merge: true }));
  await assertFails(setDoc(doc(as.adminA(), 'returnRollups/2026-10_country_ghana'), ru, { merge: true })); // id must match
  await assertFails(setDoc(doc(as.adminS(), 'returnRollups/2026-10_country_nigeria'), ru, { merge: true }));
  await assertSucceeds(getDocs(query(collection(as.named(), 'returnRollups'), where('month', '==', '2026-10'))));
  await assertFails(getDocs(collection(as.adminA(), 'returnRollups')));
  await assertFails(getDocs(collection(as.hq(), 'returnRollups')));
  const al = { month: '2026-10', parishId: 'A', parishName: 'Parish A', rule: 'notFiled', detail: 'No return by 10 Nov', currency: 'NGN', status: 'Open', version: 1, at: '2026-11-11', by: 'uNamed' };
  const raise = (db, who, a) => { const b = writeBatch(db);
    b.set(doc(db, 'alerts/2026-10_A_notFiled'), a);
    b.set(doc(db, 'auditLog/' + auditId('alerts/2026-10_A_notFiled', a.version)), audit('alerts/2026-10_A_notFiled', a.version, 'alert', who));
    return b.commit(); };
  await assertFails(raise(as.adminA(), A, al));
  await assertSucceeds(raise(as.named(), NAMED, al));
  await assertFails(getDoc(doc(as.adminA(), 'alerts/2026-10_A_notFiled')));
  await assertFails(deleteDoc(doc(as.named(), 'alerts/2026-10_A_notFiled')));
});

test('p6 currency: parish sets an ISO currency code; returns keep their own currency', async () => {
  await assertSucceeds(updateDoc(doc(as.adminA(), 'parishes/A'), { currency: 'GBP' }));
  await assertFails(updateDoc(doc(as.adminA(), 'parishes/A'), { currency: 'pounds' }));
  await assertSucceeds(fileReturn(as.adminA(), A, 'A', '2026-10', { currency: 'GBP' }));
});

// ================= Phase 7: HQ Staff, member directory, committees =================
const audit7 = (db, target, v, action, extra = {}) => ({ ref: doc(db, 'auditLog/' + target.replace('/', '_') + '_v' + v),
  data: { action, target, targetVersion: v, parishId: '', reason: '', before: null, after: null, by: 'uNamed', byEmail: 'bayo@x.org',
    byName: 'Bayo Adeyemi', role: 'super_admin', at: serverTimestamp(), ...extra } });
const staff = (no, extra = {}) => ({ staffNo: no, fullName: 'Kemi Ade', nameLower: 'kemi ade', photo: '', department: 'Finance',
  jobTitle: 'Accountant', grade: 'GL-08', phone: '0803', email: '', category: 'member', linkParishId: '', linkNo: '',
  dob: '1967-03-01', employedDate: '2010-01-04', confirmedDate: '', exitDate: '', status: 'Active', postings: [],
  consentGiven: true, consentDate: '2026-11-02', version: 1, createdAt: '2026-11-02', updatedAt: '2026-11-02', updatedBy: 'uNamed', ...extra });
async function addStaff(db, data = {}, uid = 'uNamed') {
  return runTransaction(db, async (t) => {
    const c = await t.get(doc(db, 'hqMeta/staff'));
    const n = (c.exists() ? c.data().n : 0) + 1;
    const id = 'CCC-HQ-STF-' + String(n).padStart(3, '0');
    t.set(doc(db, 'hqMeta/staff'), { n });
    t.set(doc(db, 'hqStaff/' + id), staff(id, { updatedBy: uid, ...data }));
    const a = audit7(db, 'hqStaff/' + id, 1, 'create'); t.set(a.ref, { ...a.data, by: uid });
    return id;
  });
}
const dirDoc = (p, no, extra = {}) => ({ parishId: p, memberNo: no, fullName: 'Ade Bisi', nameLower: 'ade bisi', photo: '', gender: 'Female',
  rank: '', occupation: 'Trader', occLower: 'trader', phone: '080', parishName: 'Parish ' + p, city: 'Lagos', cityLower: 'lagos',
  country: 'Nigeria', status: 'Active', departments: [{ dept: 'choir', role: '', status: 'Current', from: '2026-01-01', to: '' }],
  attendance: { streak: 3, lastSeen: '2026-11-01' }, rankHistory: [], anointed: {}, giving: { regular: true, byYear: { 2026: 50000 } },
  committees: [], updatedAt: '2026-11-02', ...extra });
const committee = (extra = {}) => ({ name: 'Harvest Planning', nameLower: 'harvest planning', purpose: 'Plan 2027 harvest', duties: 'Budget, venue',
  termStart: '2026-11-01', termEnd: '2027-10-31', status: 'Active', version: 1, createdAt: '2026-11-02', createdBy: 'uNamed', updatedAt: '2026-11-02', updatedBy: 'uNamed', ...extra });
async function auditedSet(db, path, data, v, action = 'create') {
  const b = writeBatch(db); b.set(doc(db, path), data); const a = audit7(db, path, v, action); b.set(a.ref, a.data); return b.commit();
}

test('p7 HQ staff: named super creates CCC-HQ-STF-001 with audit; numbers in sequence; nobody else reads or writes', async () => {
  await assertSucceeds(addStaff(as.named()));
  await assertSucceeds(addStaff(as.named()));
  const s2 = await getDoc(doc(as.named(), 'hqStaff/CCC-HQ-STF-002'));
  assert(s2.data().staffNo, 'CCC-HQ-STF-002');
  await assertFails(addStaff(as.superA(), {}, 'uSuper'));          // unnamed super
  for (const who of [as.superA(), as.hq(), as.adminA(), as.stranger()]) {
    await assertFails(getDoc(doc(who, 'hqStaff/CCC-HQ-STF-001')));
    await assertFails(getDocs(collection(who, 'hqStaff')));
  }
  // Skipping a number, or no audit entry, is refused.
  const db = as.named();
  const b = writeBatch(db); b.set(doc(db, 'hqMeta/staff'), { n: 4 }); b.set(doc(db, 'hqStaff/CCC-HQ-STF-004'), staff('CCC-HQ-STF-004'));
  const a = audit7(db, 'hqStaff/CCC-HQ-STF-004', 1, 'create'); b.set(a.ref, a.data);
  await assertFails(b.commit());
  const b2 = writeBatch(db); b2.set(doc(db, 'hqMeta/staff'), { n: 3 }); b2.set(doc(db, 'hqStaff/CCC-HQ-STF-003'), staff('CCC-HQ-STF-003'));
  await assertFails(b2.commit());
});
test('p7 HQ staff: updates bump version + audit; Retired/Left need an exit date; never deleted; consent required', async () => {
  const db = as.named();
  await addStaff(db);
  const ref = 'hqStaff/CCC-HQ-STF-001';
  await assertFails(updateDoc(doc(db, ref), { grade: 'GL-09', version: 2 }));  // no audit
  await assertFails(auditedSet(db, ref, staff('CCC-HQ-STF-001', { grade: 'GL-09', version: 1 }), 1, 'update')); // no bump
  await assertSucceeds(auditedSet(db, ref, staff('CCC-HQ-STF-001', { grade: 'GL-09', version: 2 }), 2, 'update'));
  await assertFails(auditedSet(db, ref, staff('CCC-HQ-STF-001', { status: 'Retired', version: 3 }), 3, 'update'));
  await assertSucceeds(auditedSet(db, ref, staff('CCC-HQ-STF-001', { status: 'Retired', exitDate: '2026-11-30', version: 3 }), 3, 'update'));
  await assertFails(deleteDoc(doc(db, ref)));
  await assertFails(addStaff(db, { consentGiven: false }));
  await assertFails(addStaff(db, { address: 'Lagos' }));   // unknown field
});
test('p7 HQ staff: link to a parish clergy/member record must exist; documents <=250KB image/PDF; leave records', async () => {
  const db = as.named();
  await assertFails(addStaff(db, { category: 'clergy', linkParishId: 'A', linkNo: 'CCC-CLG-009' }));
  await assertSucceeds(addStaff(db, { category: 'clergy', linkParishId: 'A', linkNo: 'CCC-CLG-001' }));
  await assertFails(addStaff(db, { category: 'member', linkParishId: 'A', linkNo: 'CCC-MBR-001' })); // no directory doc yet
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'directory/A_CCC-MBR-001'), dirDoc('A', 'CCC-MBR-001')));
  await assertSucceeds(addStaff(db, { category: 'member', linkParishId: 'A', linkNo: 'CCC-MBR-001' }));
  const file = (data) => ({ staffNo: 'CCC-HQ-STF-001', kind: 'CV', name: 'cv.pdf', data, version: 1, at: serverTimestamp(), by: 'uNamed', byName: 'Bayo Adeyemi' });
  await assertSucceeds(auditedSet(db, 'hqStaffFiles/f1', file('data:application/pdf;base64,' + 'A'.repeat(300000)), 1));
  await assertSucceeds(auditedSet(db, 'hqStaffFiles/f2', file('data:image/jpeg;base64,' + 'A'.repeat(1000)), 1));
  await assertFails(auditedSet(db, 'hqStaffFiles/f3', file('data:application/pdf;base64,' + 'A'.repeat(360000)), 1));
  await assertFails(auditedSet(db, 'hqStaffFiles/f4', file('data:text/html;base64,AAAA'), 1));
  await assertFails(deleteDoc(doc(db, 'hqStaffFiles/f1')));
  const leave = (extra = {}) => ({ staffNo: 'CCC-HQ-STF-001', type: 'Annual', from: '2026-12-01', to: '2026-12-20', note: '', version: 1, at: serverTimestamp(), by: 'uNamed', ...extra });
  await assertSucceeds(auditedSet(db, 'hqLeave/l1', leave(), 1));
  await assertFails(auditedSet(db, 'hqLeave/l2', leave({ to: '2026-11-01' }), 1));
  await assertFails(auditedSet(db, 'hqLeave/l3', leave({ staffNo: 'CCC-HQ-STF-099' }), 1));
  await assertFails(getDoc(doc(as.superA(), 'hqLeave/l1')));
  await assertFails(getDoc(doc(as.adminA(), 'hqStaffFiles/f1')));
});
test('p7 directory: parish writes its own projection; no private fields; other parish and HQ cannot read', async () => {
  const a = as.adminA();
  await assertSucceeds(setDoc(doc(a, 'directory/A_CCC-MBR-001'), dirDoc('A', 'CCC-MBR-001')));
  for (const k of ['address', 'nokName', 'dobYear', 'family'])
    await assertFails(setDoc(doc(a, 'directory/A_CCC-MBR-002'), dirDoc('A', 'CCC-MBR-002', { fullName: 'Head Choir', nameLower: 'head choir', [k]: 'x' })));
  await assertFails(setDoc(doc(a, 'directory/A_CCC-MBR-009'), dirDoc('A', 'CCC-MBR-009')));          // no such member
  await assertFails(setDoc(doc(a, 'directory/A_CCC-MBR-002'), dirDoc('A', 'CCC-MBR-002')));          // name must match the record
  await assertFails(setDoc(doc(as.adminB(), 'directory/A_CCC-MBR-002'), dirDoc('A', 'CCC-MBR-002', { fullName: 'Head Choir', nameLower: 'head choir' })));
  await assertFails(setDoc(doc(a, 'directory/A_CCC-MBR-002'), dirDoc('A', 'CCC-MBR-002', { fullName: 'Head Choir', nameLower: 'head choir', committees: [{ name: 'x' }] })));
  await assertSucceeds(getDoc(doc(a, 'directory/A_CCC-MBR-001')));
  await assertSucceeds(getDocs(query(collection(a, 'directory'), where('parishId', '==', 'A'))));
  await assertFails(getDoc(doc(as.adminB(), 'directory/A_CCC-MBR-001')));
  await assertFails(getDocs(collection(as.adminB(), 'directory')));
  await assertFails(getDoc(doc(as.hq(), 'directory/A_CCC-MBR-001')));
  await assertFails(getDoc(doc(as.stranger(), 'directory/A_CCC-MBR-001')));
  await assertSucceeds(getDocs(query(collection(as.superA(), 'directory'), orderBy('nameLower'), limit(20))));
  await assertSucceeds(getDocs(query(collection(as.superA(), 'directory'), where('rank', '==', ''), limit(20))));
  await assertFails(setDoc(doc(as.named(), 'directory/A_CCC-MBR-001'), dirDoc('A', 'CCC-MBR-001', { phone: '1' })));
  await assertFails(deleteDoc(doc(a, 'directory/A_CCC-MBR-001')));
  await assertFails(deleteDoc(doc(as.named(), 'directory/A_CCC-MBR-001')));
});
test('p7 directory: parish cannot change committees; super changes only committees', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'directory/A_CCC-MBR-001'), dirDoc('A', 'CCC-MBR-001')));
  await assertFails(updateDoc(doc(as.adminA(), 'directory/A_CCC-MBR-001'), { committees: [{ name: 'Fake' }] }));
  await assertSucceeds(updateDoc(doc(as.adminA(), 'directory/A_CCC-MBR-001'), { occupation: 'Banker', occLower: 'banker' }));
  await assertSucceeds(updateDoc(doc(as.named(), 'directory/A_CCC-MBR-001'), { committees: [{ id: 'c1', name: 'Harvest', role: 'Chair' }] }));
  await assertFails(updateDoc(doc(as.superA(), 'directory/A_CCC-MBR-001'), { committees: [] }));   // unnamed
  // Parish keeps committees when it refreshes (merge write).
  await assertSucceeds(setDoc(doc(as.adminA(), 'directory/A_CCC-MBR-001'), { occupation: 'Teacher', occLower: 'teacher' }, { merge: true }));
});
test('p7 committees: named super creates with audit; members from directory, clergy by clergy number; former kept', async () => {
  const db = as.named();
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'directory/A_CCC-MBR-001'), dirDoc('A', 'CCC-MBR-001')));
  await assertFails(setDoc(doc(db, 'committees/c1'), committee()));                                  // no audit
  await assertFails(auditedSet(db, 'committees/c1', committee({ termEnd: '2026-01-01' }), 1));       // end before start
  await assertFails(auditedSet(as.superA(), 'committees/c1', committee({ updatedBy: 'uSuper' }), 1));
  await assertSucceeds(auditedSet(db, 'committees/c1', committee(), 1));
  const cm = (p, no, extra = {}) => ({ committeeId: 'c1', committeeName: 'Harvest Planning', parishId: p, parishName: 'Parish ' + p, personNo: no,
    fullName: 'Ade Bisi', isClergy: no.includes('CLG'), role: 'Member', status: 'Current', joinedDate: '2026-11-02', leftDate: '', version: 1,
    updatedAt: '2026-11-02', updatedBy: 'uNamed', ...extra });
  await assertSucceeds(auditedSet(db, 'committeeMembers/c1_A_CCC-MBR-001', cm('A', 'CCC-MBR-001', { role: 'Chair' }), 1));
  await assertSucceeds(auditedSet(db, 'committeeMembers/c1_A_CCC-CLG-001', cm('A', 'CCC-CLG-001', { role: 'Secretary' }), 1));
  await assertFails(auditedSet(db, 'committeeMembers/c1_A_CCC-MBR-002', cm('A', 'CCC-MBR-002'), 1));   // not in the directory
  await assertFails(auditedSet(db, 'committeeMembers/c1_A_CCC-CLG-001x', cm('A', 'CCC-CLG-001'), 1));  // id mismatch
  await assertFails(auditedSet(db, 'committeeMembers/c1_A_CCC-CLG-001', cm('A', 'CCC-CLG-001', { isClergy: false, version: 2 }), 2, 'update'));
  await assertFails(auditedSet(db, 'committeeMembers/c1_A_CCC-MBR-001', cm('A', 'CCC-MBR-001', { status: 'Former', version: 2 }), 2, 'update')); // no leftDate
  await assertSucceeds(auditedSet(db, 'committeeMembers/c1_A_CCC-MBR-001', cm('A', 'CCC-MBR-001', { status: 'Former', leftDate: '2026-12-01', version: 2 }), 2, 'update'));
  await assertFails(deleteDoc(doc(db, 'committeeMembers/c1_A_CCC-MBR-001')));
  await assertFails(deleteDoc(doc(db, 'committees/c1')));
  for (const who of [as.hq(), as.adminA()]) {
    await assertFails(getDoc(doc(who, 'committees/c1')));
    await assertFails(getDoc(doc(who, 'committeeMembers/c1_A_CCC-MBR-001')));
  }
  // Audit trail exists for every change.
  const log = await getDocs(query(collection(db, 'auditLog'), where('target', '==', 'committeeMembers/c1_A_CCC-MBR-001')));
  assert(log.size, 2);
});
