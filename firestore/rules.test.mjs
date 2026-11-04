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

// Regression (London demo): 1/3 of a tithe not divisible by 3 (GBP 3,200 -> 1,066.67) was refused because the
// rules divided integers (3200 / 3 = 1066). Due must be worked out in decimals for every currency.
test('p6 file: GBP parish (London) files a return whose 1/3 is not a whole number', async () => {
  const London = { city: 'London', country: 'United Kingdom', continent: 'Europe', currency: 'GBP' };
  const setA = f => env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'parishes/A'), f));
  await setA(London);
  try {
    const inc = { tithes: 3200, offerings: 900, thanksgiving: 0, harvest: 0, building: 0, other: 0 };
    await assertSucceeds(fileReturn(as.adminA(), A, 'A', '2026-08', { ...London, income: inc }));
    const r = await getRet('A_2026-08');
    eq(r.due, 1066.67); eq(r.currency, 'GBP');
    // still exact: a truncated due is refused, and so is NGN on a GBP parish
    await assertFails(fileReturn(as.adminA(), A, 'A', '2026-07', { ...London, income: inc, due: 1066 }));
    await assertFails(fileReturn(as.adminA(), A, 'A', '2026-07', { ...London, currency: 'NGN', income: inc }));
    // paying it in full and the 1/3 of 100 pence-level amounts both work
    await assertSucceeds(pay(as.adminA(), A, 'A_2026-08', r, 1066.67));
    eq((await getRet('A_2026-08')).status, 'Paid');
    await assertSucceeds(fileReturn(as.adminA(), A, 'A', '2026-06', { ...London, income: { ...inc, tithes: 100.5 } }));
  } finally { await setA({ city: 'Lagos', country: 'Nigeria', continent: 'Africa', currency: 'NGN' }); }
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

import { strict as nodeAssert } from 'node:assert';
const same = (a, b) => nodeAssert.equal(a, b);
// ================= Phase 8: retirement setting, giving member number, Church Head, clergy postings, AI dashboard =================
const P8 = { ch: () => ctx('uCH', 'pastor@x.org') };
const auditBy = (who) => who === 'ch' ? { by: 'uCH', byEmail: 'pastor@x.org', byName: 'Rev Pastor', role: 'church_head' }
  : who === 'A' ? { by: 'uA', byEmail: 'a@x.org', byName: '', role: 'parish_admin' }
  : who === 'B' ? { by: 'uB', byEmail: 'b@x.org', byName: '', role: 'parish_admin' } : {};
const auditW = (b, db, target, v, action, who, reason = '') => { const a = audit7(db, target, v, action, { ...auditBy(who), reason }); b.set(a.ref, a.data); };
async function assignLeader(db, email, status = 'Active', name = 'Rev Pastor') {
  return runTransaction(db, async (t) => {
    const lRef = doc(db, 'hqSettings/leadership'), o = await t.get(lRef);
    const od = o.exists() ? o.data() : { roleName: 'Church Head', active: 0, version: 0 };
    const pRef = doc(db, 'leaders/' + email), p = await t.get(pRef);
    const v = p.exists() ? p.data().version + 1 : 1;
    t.set(pRef, { name, email, status, note: 'by vote', version: v, updatedAt: 'x', updatedBy: 'uNamed' });
    const nv = od.version + 1;
    t.set(lRef, { roleName: od.roleName, active: od.active + (status === 'Active' ? 1 : -1), lastLeader: email, version: nv, updatedAt: 'x', updatedBy: 'uNamed' });
    const a1 = audit7(db, 'leaders/' + email, v, 'leader'); t.set(a1.ref, a1.data);
    const a2 = audit7(db, 'hqSettings/leadership', nv, 'leadership'); t.set(a2.ref, a2.data);
  });
}
const postingDoc = (extra = {}) => ({ clergyNo: 'CCC-CLG-001', fullName: 'Ven Olu', email: 'olu@x.org', person: clergy('CCC-CLG-001', 'olu@x.org'),
  fromParishId: 'A', fromParishName: 'Parish A', toParishId: 'B', toParishName: 'Parish B', effectiveDate: '2026-01-05', reason: 'Needed in B', letter: '',
  status: 'Approved', departedAt: '', newClergyNo: '', approvedBy: '', approvedByName: '', decisionNote: '', version: 1,
  createdAt: 'x', createdBy: 'uNamed', createdByName: 'Bayo Adeyemi', updatedAt: 'x', updatedBy: 'uNamed', ...extra });
async function createPosting(db, id, extra) {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'parishStats/B'), { memberCount: 0, clergyCount: 0 }, { merge: true })); const b = writeBatch(db); b.set(doc(db, 'postings/' + id), postingDoc(extra)); auditW(b, db, 'postings/' + id, 1, 'posting'); return b.commit(); }
async function depart(db, id, who, uid) {
  return runTransaction(db, async (t) => {
    const ref = doc(db, 'postings/' + id), po = (await t.get(ref)).data();
    const cRef = doc(db, `parishes/${po.fromParishId}/clergy/${po.clergyNo}`);
    t.update(cRef, { status: 'Former', leftDate: po.effectiveDate, leaveReason: 'Posting', transferredTo: po.toParishName, postingId: id, updatedAt: 'y' });
    t.set(doc(db, 'parishStats/' + po.fromParishId), { clergyCount: increment(-1), formerClergyCount: increment(1) }, { merge: true });
    const next = { ...po, departedAt: po.effectiveDate, status: po.newClergyNo ? 'Applied' : 'Approved', version: po.version + 1, updatedBy: uid };
    t.set(ref, next); auditW(t, db, 'postings/' + id, next.version, 'posting-depart', who);
  });
}
async function arrive(db, id, who, uid) {
  return runTransaction(db, async (t) => {
    const ref = doc(db, 'postings/' + id), po = (await t.get(ref)).data();
    const cnt = doc(db, `parishes/${po.toParishId}/meta/counters`), n = (await t.get(cnt)).data().clg + 1;
    const p = (await t.get(doc(db, 'parishes/' + po.toParishId))).data();
    const no = `CCC-${p.parishLetters}-${p.cityLetters}-CLG-${String(n).padStart(3, '0')}`;
    t.update(cnt, { clg: n });
    t.set(doc(db, `parishes/${po.toParishId}/clergy/${no}`), { ...po.person, memberNo: no, status: 'Active', joinedDate: po.effectiveDate, postingId: id, postedFrom: po.clergyNo, postedFromParishId: po.fromParishId });
    t.set(doc(db, 'clergyIndex/' + po.email), { parishId: po.toParishId, clergyId: no });
    const next = { ...po, newClergyNo: no, status: po.departedAt ? 'Applied' : 'Approved', version: po.version + 1, updatedBy: uid };
    t.set(ref, next); auditW(t, db, 'postings/' + id, next.version, 'posting-arrive', who);
    return no;
  }).then(async no => { await setDoc(doc(db, 'parishStats/' + (await getDoc(doc(db, 'postings/' + id))).data().toParishId), { clergyCount: increment(1) }, { merge: true }); return no; });
}

test('p8 retirement age: optional HQ setting, blank by default, audited; parish cannot set it', async () => {
  const db = as.named();
  const set = (age, v) => { const b = writeBatch(db); b.set(doc(db, 'hqSettings/staff'), { retireAge: age, version: v, updatedAt: 'x', updatedBy: 'uNamed' }); auditW(b, db, 'hqSettings/staff', v, 'settings'); return b.commit(); };
  await assertFails(set(30, 1));
  await assertSucceeds(set(null, 1));
  await assertSucceeds(set(65, 2));
  await assertFails(setDoc(doc(db, 'hqSettings/staff'), { retireAge: 70, version: 3, updatedAt: 'x', updatedBy: 'uNamed' })); // no audit
  await assertFails(setDoc(doc(as.adminA(), 'hqSettings/staff'), { retireAge: 60, version: 3, updatedAt: 'x', updatedBy: 'uA' }));
});
test('p8 giving: optional member number from the member list', async () => {
  await assertSucceeds(setDoc(doc(as.adminA(), 'parishes/A/finances/f3'), { ...fin, memberNo: 'CCC-MBR-001' }));
  await assertSucceeds(setDoc(doc(as.adminA(), 'parishes/A/finances/f4'), fin));
  await assertFails(setDoc(doc(as.adminA(), 'parishes/A/finances/f5'), { ...fin, memberNo: 'Ade Bisi' }));
});
test('p8 Church Head: only a named super assigns; read-only church-wide; no parish edits; revoked = no access', async () => {
  await assertFails(assignLeader(as.adminA(), 'pastor@x.org'));
  await assertFails(assignLeader(as.superA(), 'pastor@x.org'));       // unnamed super
  await assertSucceeds(assignLeader(as.named(), 'pastor@x.org'));
  await assertSucceeds(assignLeader(as.named(), 'second@x.org', 'Active', 'Rev Second'));   // more than one holder
  same((await getDoc(doc(as.named(), 'hqSettings/leadership'))).data().active, 2);
  // Invite + claim.
  const sdb = as.named(), nb = writeBatch(sdb); nb.set(doc(sdb, 'invites/LEADERINVITE-00000001'), { email: 'pastor@x.org', parishId: '', role: 'church_head', usedBy: null, createdAt: 'x' });
  await assertSucceeds(nb.commit());
  const ch = P8.ch();
  await assertFails(setDoc(doc(ch, 'users/uCH'), { role: 'church_head', parishId: '', email: 'pastor@x.org', inviteCode: 'LEADERINVITE-00000001', name: 'Someone Else' }));
  const cb = writeBatch(ch);
  cb.set(doc(ch, 'users/uCH'), { role: 'church_head', parishId: '', email: 'pastor@x.org', inviteCode: 'LEADERINVITE-00000001', name: 'Rev Pastor' });
  cb.update(doc(ch, 'invites/LEADERINVITE-00000001'), { usedBy: 'uCH' });
  await assertSucceeds(cb.commit());
  for (const p of ['parishes/A', 'parishStats/A', 'hqSettings/leadership']) await assertSucceeds(getDoc(doc(ch, p)));
  await assertSucceeds(getDocs(collection(ch, 'alerts')));
  await assertSucceeds(getDocs(collectionGroup(ch, 'clergy')));
  for (const p of ['parishes/A/members/CCC-MBR-001', 'parishes/A/finances/f1', 'hqStaff/CCC-HQ-STF-001']) await assertFails(getDoc(doc(ch, p)));
  await assertFails(getDocs(collection(ch, 'directory')));
  await assertFails(updateDoc(doc(ch, 'parishes/A'), { name: 'X' }));
  await assertFails(setDoc(doc(ch, 'parishStats/A'), { memberCount: 1 }));
  await assertFails(assignLeader(ch, 'third@x.org'));
  // A self-made church_head profile without an Active leaders doc gets nothing.
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'users/uX'), { role: 'church_head', name: 'Fake' }));
  await assertFails(getDoc(doc(ctx('uX', 'fake@x.org'), 'parishStats/A')));
  // Revoke: access ends at once; nothing deleted.
  await assertSucceeds(assignLeader(as.named(), 'pastor@x.org', 'Revoked'));
  await assertFails(getDoc(doc(ch, 'parishStats/A')));
  await assertFails(deleteDoc(doc(as.named(), 'leaders/pastor@x.org')));
  same((await getDoc(doc(as.named(), 'hqSettings/leadership'))).data().active, 1);
});
test('p8 postings: needs Church Head approval when one exists; halves apply on the date; new lettered CLG linked; audited', async () => {
  await env.withSecurityRulesDisabled(async c => { const db = c.firestore();
    await setDoc(doc(db, 'users/uCH'), { role: 'church_head', parishId: '', email: 'pastor@x.org', name: 'Rev Pastor' }); });
  await assignLeader(as.named(), 'pastor@x.org');
  const sup = as.named(), ch = P8.ch(), a = as.adminA(), b = as.adminB();
  await assertFails(createPosting(sup, 'p1', { status: 'Approved' }));          // a Church Head exists -> must wait
  await assertFails(createPosting(a, 'p1', { status: 'Pending approval' }));    // only super posts
  await assertSucceeds(createPosting(sup, 'p1', { status: 'Pending approval' }));
  await assertSucceeds(getDoc(doc(a, 'postings/p1')));
  await assertSucceeds(getDoc(doc(b, 'postings/p1')));
  await assertSucceeds(getDocs(query(collection(b, 'postings'), where('toParishId', '==', 'B'))));
  await assertFails(getDoc(doc(as.adminS(), 'postings/p1')));
  await assertFails(getDoc(doc(as.hq(), 'postings/p1')));
  await assertFails(arrive(b, 'p1', 'B', 'uB'));                                 // not approved yet
  const decide = (db, who, uid, status, name) => runTransaction(db, async t => { const ref = doc(db, 'postings/p1'), po = (await t.get(ref)).data();
    t.set(ref, { ...po, status, approvedBy: uid, approvedByName: name, decisionNote: 'ok', version: po.version + 1, updatedBy: uid }); auditW(t, db, 'postings/p1', po.version + 1, 'posting-approve', who); });
  await assertFails(decide(sup, '', 'uNamed', 'Approved', 'Bayo Adeyemi'));    // super cannot approve
  await assertSucceeds(decide(ch, 'ch', 'uCH', 'Approved', 'Rev Pastor'));
  // Old parish half (parish A admin), then new parish half (parish B admin).
  await assertFails(arrive(a, 'p1', 'A', 'uA'));
  await assertSucceeds(depart(a, 'p1', 'A', 'uA'));
  const old = (await getDoc(doc(a, 'parishes/A/clergy/CCC-CLG-001'))).data();
  same(old.status, 'Former'); same(old.leaveReason, 'Posting');
  const no = await arrive(b, 'p1', 'B', 'uB');
  same(no, 'CCC-BBB-LAG-CLG-002');
  const nu = (await getDoc(doc(b, 'parishes/B/clergy/' + no))).data();
  same(nu.postedFrom, 'CCC-CLG-001'); same(nu.status, 'Active');
  const po = (await getDoc(doc(sup, 'postings/p1'))).data();
  same(po.status, 'Applied'); same(po.newClergyNo, no);
  same((await getDocs(query(collection(sup, 'auditLog'), where('target', '==', 'postings/p1')))).size, 4);
  await assertFails(deleteDoc(doc(sup, 'postings/p1')));
  await assertFails(deleteDoc(doc(b, 'parishes/B/clergy/' + no)));
});
test('p8 postings: no Church Head -> approved at once; super applies both halves; future date waits; cancel', async () => {
  const sup = as.named();
  await assertSucceeds(createPosting(sup, 'p2'));
  await assertSucceeds(depart(sup, 'p2', '', 'uNamed'));
  await assertSucceeds(arrive(as.adminB(), 'p2', 'B', 'uB'));
  same((await getDoc(doc(sup, 'postings/p2'))).data().status, 'Applied');
  // A posting dated in the future cannot be applied yet; it can be cancelled.
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'parishes/B/clergy/CCC-CLG-009'), clergy('CCC-CLG-009', 'ife@x.org')));
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'clergyIndex/ife@x.org'), { parishId: 'B', clergyId: 'CCC-CLG-009' }));
  await assertSucceeds(createPosting(sup, 'p3', { clergyNo: 'CCC-CLG-009', email: 'ife@x.org', person: clergy('CCC-CLG-009', 'ife@x.org'), fromParishId: 'B', toParishId: 'A', effectiveDate: '2099-01-01' }));
  await assertFails(depart(as.adminB(), 'p3', 'B', 'uB'));
  await assertSucceeds(runTransaction(sup, async t => { const ref = doc(sup, 'postings/p3'), po = (await t.get(ref)).data();
    t.set(ref, { ...po, status: 'Cancelled', decisionNote: 'changed plan', version: 2 }); auditW(t, sup, 'postings/p3', 2, 'posting-cancel'); }));
  // Super cannot edit clergy records outside a posting.
  await assertFails(updateDoc(doc(sup, 'parishes/B/clergy/CCC-CLG-009'), { status: 'Former', leaveReason: 'Posting', leftDate: '2026-01-01', postingId: 'p3' }));
});
test('p8 AI dashboard data: rollups + snapshots + summaries readable by super and Church Head only', async () => {
  const sup = as.named();
  await assertSucceeds(setDoc(doc(sup, 'statsRollups/2026-11_world_all'), { month: '2026-11', level: 'world', key: 'all', name: 'World', parishes: 2, members: 10, clergy: 1, attendance: 50, births: 1, deaths: 0, birthsMonth: 1, deathsMonth: 0, returnsFiled: 1, updatedAt: 'x' }));
  await assertSucceeds(setDoc(doc(sup, 'parishMonthly/A_2026-11'), { parishId: 'A', month: '2026-11', memberCount: 2, clergyCount: 1, attendanceTotal: 0, serviceCount: 0, birthCount: 0, deathCount: 0, lastActive: '', city: '', country: '', continent: '', updatedAt: 'x' }));
  await assertFails(setDoc(doc(sup, 'statsRollups/2026-11_world_all'), { month: '2026-11', level: 'world', key: 'all', name: 'World', fullName: 'Ade Bisi', updatedAt: 'x' }));
  await assertSucceeds(setDoc(doc(sup, 'aiSummaries/2026-11'), { month: '2026-11', text: 'All calm.', engine: 'test', alertCount: 0, at: 'x', by: 'uNamed' }));
  for (const who of [as.adminA(), as.hq()]) {
    await assertFails(getDoc(doc(who, 'statsRollups/2026-11_world_all')));
    await assertFails(setDoc(doc(who, 'parishMonthly/A_2026-12'), { parishId: 'A', month: '2026-12' }));
    await assertFails(getDoc(doc(who, 'aiSummaries/2026-11')));
  }
  // New alert rules are accepted with an audit entry.
  const b = writeBatch(sup);
  b.set(doc(sup, 'alerts/2026-11_A_inactive'), { month: '2026-11', parishId: 'A', parishName: 'Parish A', rule: 'inactive', detail: 'x', currency: 'NGN', status: 'Open', version: 1, at: 'x', by: 'uNamed' });
  auditW(b, sup, 'alerts/2026-11_A_inactive', 1, 'alert');
  await assertSucceeds(b.commit());
});


// ---------------------------------------------------------------- Phase 9
const sermon = (extra = {}) => ({ title: 'Walk in the Light', titleLower: 'walk in the light', preacher: 'Ven Olu', preacherNo: 'CCC-CLG-001',
  date: '2026-11-01', serviceType: 'Sunday Service', scripture: 'John 8:12', tags: ['light', 'faith'], text: 'Beloved...',
  mediaUrl: 'https://youtu.be/abc', shared: false, parishId: 'A', parishName: 'Parish A', createdAt: 'x', updatedAt: 'x', ...extra });
test('p9 sermons: own parish only; link not file; bad shapes refused', async () => {
  const a = as.adminA();
  await assertSucceeds(setDoc(doc(a, 'parishes/A/sermons/s1'), sermon()));
  await assertSucceeds(getDoc(doc(a, 'parishes/A/sermons/s1')));
  await assertFails(setDoc(doc(a, 'parishes/A/sermons/s2'), sermon({ mediaUrl: 'http://insecure' })));
  await assertFails(setDoc(doc(a, 'parishes/A/sermons/s2'), sermon({ audio: 'data:audio/mp3;base64,AAAA' })));
  await assertFails(setDoc(doc(a, 'parishes/A/sermons/s2'), sermon({ titleLower: 'other' })));
  await assertFails(setDoc(doc(a, 'parishes/A/sermons/s2'), sermon({ parishId: 'B' })));
  await assertFails(deleteDoc(doc(a, 'parishes/A/sermons/s1')));
  for (const who of [as.adminB(), as.superA(), as.hq(), as.stranger()]) await assertFails(getDoc(doc(who, 'parishes/A/sermons/s1')));
  await assertFails(setDoc(doc(as.adminB(), 'parishes/A/sermons/s3'), sermon()));
});
test('p9 shared sermons: owning parish shares/unshares; every parish admin + super read; strangers not', async () => {
  const a = as.adminA();
  await assertSucceeds(setDoc(doc(a, 'sharedSermons/A_s1'), sermon({ shared: true })));
  await assertFails(setDoc(doc(a, 'sharedSermons/B_s1'), sermon({ shared: true, parishId: 'B' })));
  await assertFails(setDoc(doc(as.adminB(), 'sharedSermons/A_s2'), sermon({ shared: true })));
  await assertFails(setDoc(doc(a, 'sharedSermons/A_s3'), sermon({ shared: false })));
  for (const who of [as.adminB(), as.superA(), a]) await assertSucceeds(getDocs(collection(who, 'sharedSermons')));
  for (const who of [as.adminS(), as.hq(), as.stranger(), as.noRole()]) await assertFails(getDoc(doc(who, 'sharedSermons/A_s1')));
  await assertFails(deleteDoc(doc(as.adminB(), 'sharedSermons/A_s1')));
  await assertSucceeds(deleteDoc(doc(a, 'sharedSermons/A_s1')));
});
test('p9 events with volunteer slots: own parish only', async () => {
  const a = as.adminA();
  const ev = { title: 'Harvest 2026', kind: 'harvest', date: '2026-11-22', time: '10:00', venue: 'Main church', notes: '',
    slots: [{ role: 'Ushers', needed: 4, assigned: [{ no: 'CCC-MBR-001', name: 'Ade Bisi' }] }], createdAt: 'x', updatedAt: 'x' };
  await assertSucceeds(setDoc(doc(a, 'parishes/A/events/e1'), ev));
  await assertFails(setDoc(doc(a, 'parishes/A/events/e2'), { ...ev, kind: 'party' }));
  await assertFails(setDoc(doc(a, 'parishes/A/events/e2'), { ...ev, time: '9am' }));
  await assertFails(setDoc(doc(a, 'parishes/A/events/e2'), { ...ev, secret: 'x' }));
  for (const who of [as.adminB(), as.superA(), as.hq()]) await assertFails(getDoc(doc(who, 'parishes/A/events/e1')));
});
test('p9 message log: who/when/template only, never content; append-only', async () => {
  const a = as.adminA();
  const log = { template: 'birthday', channel: 'whatsapp', to: 'CCC-MBR-001', name: 'Ade Bisi', at: serverTimestamp(), by: 'uA' };
  await assertSucceeds(setDoc(doc(a, 'parishes/A/messageLog/m1'), log));
  await assertFails(setDoc(doc(a, 'parishes/A/messageLog/m2'), { ...log, text: 'Happy birthday Ade' }));
  await assertFails(setDoc(doc(a, 'parishes/A/messageLog/m2'), { ...log, phone: '0803' }));
  await assertFails(setDoc(doc(a, 'parishes/A/messageLog/m2'), { ...log, template: 'promo' }));
  await assertFails(setDoc(doc(a, 'parishes/A/messageLog/m2'), { ...log, by: 'uB' }));
  await assertFails(setDoc(doc(a, 'parishes/A/messageLog/m2'), { ...log, at: '2026-01-01' }));
  await assertFails(updateDoc(doc(a, 'parishes/A/messageLog/m1'), { name: 'X' }));
  await assertFails(deleteDoc(doc(a, 'parishes/A/messageLog/m1')));
  await assertFails(getDoc(doc(as.adminB(), 'parishes/A/messageLog/m1')));
});
test('p9 wedding anniversary on a member (optional day + month)', async () => {
  const a = as.adminA();
  await assertSucceeds(updateDoc(doc(a, 'parishes/A/members/CCC-MBR-001'), { weddingDay: 14, weddingMonth: 2 }));
  await assertFails(updateDoc(doc(a, 'parishes/A/members/CCC-MBR-001'), { weddingMonth: 13 }));
});
const seedCodes = () => env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await updateDoc(doc(db, 'parishes/A'), { code: 'AAA111' }); await updateDoc(doc(db, 'parishes/B'), { code: 'BBB222' });
});
const pending = (extra = {}) => ({ fullName: 'Ngozi New', gender: 'Female', maritalStatus: 'Single', phone: '08031112222', email: '',
  address: 'Ikeja', occupation: 'Nurse', dobDay: 5, dobMonth: 6, dobYear: null, weddingDay: null, weddingMonth: null, nokName: '', nokPhone: '',
  photo: '', consentGiven: true, status: 'Pending', website: '', submittedAt: serverTimestamp(), ...extra });
test('p10 parish website removed: publicSites is closed to everyone', async () => {
  await seedCodes();
  const site = { parishId: 'A', name: 'Parish A', city: 'Lagos', country: 'Nigeria', services: [], updatedAt: 'x' };
  await assertFails(setDoc(doc(as.adminA(), 'publicSites/AAA111'), site));
  await assertFails(setDoc(doc(as.superA(), 'publicSites/AAA111'), site));
  await assertFails(setDoc(doc(as.adminA(), 'publicSites/AAA111/sermons/s1'), { title: 'x', updatedAt: 'x' }));
  for (const p of ['publicSites/AAA111', 'publicSites/AAA111/events/e1']) await assertFails(getDoc(doc(as.stranger(), p)));
  await assertFails(getDoc(doc(as.stranger(), 'parishes/A')));
  await assertFails(getDocs(collection(as.stranger(), 'sharedSermons')));
});
test('p9b join link + pendingMembers: anonymous create only, strict, honeypot, admin reads/decides', async () => {
  await seedCodes();
  const anon = as.stranger(), a = as.adminA();
  await assertFails(addDocTo(anon, 'parishes/A/pendingMembers', pending()));              // link not opened yet
  await assertFails(setDoc(doc(as.adminB(), 'joinLinks/AAA111'), { parishId: 'A', name: 'Parish A', open: true, updatedAt: 'x' }));
  await assertSucceeds(setDoc(doc(a, 'joinLinks/AAA111'), { parishId: 'A', name: 'Parish A', open: true, updatedAt: 'x' }));
  await assertSucceeds(getDoc(doc(anon, 'joinLinks/AAA111')));
  await assertFails(getDocs(collection(anon, 'joinLinks')));
  await assertSucceeds(setDoc(doc(anon, 'parishes/A/pendingMembers/p1'), pending()));
  await assertSucceeds(setDoc(doc(anon, 'parishes/A/pendingMembers/p2'), pending({ photo: 'data:image/jpeg;base64,' + 'A'.repeat(90000) })));
  for (const bad of [{ website: 'http://spam' }, { consentGiven: false }, { status: 'Approved' }, { memberNo: 'CCC-MBR-009' },
      { photo: 'data:image/jpeg;base64,' + 'A'.repeat(120000) }, { photo: 'data:text/html;base64,AA' }, { fullName: '' },
      { phone: '' }, { important: true }, { dobMonth: 13 }, { submittedAt: '2026-01-01' }])
    await assertFails(setDoc(doc(anon, 'parishes/A/pendingMembers/bad'), pending(bad)));
  await assertFails(setDoc(doc(ctx('uX'), 'parishes/A/pendingMembers/p3'), pending()));     // signed-in: not this path
  await assertFails(setDoc(doc(anon, 'parishes/S/pendingMembers/p4'), pending()));         // suspended parish (no link)
  for (const who of [anon, as.adminB(), as.superA(), as.hq()]) await assertFails(getDoc(doc(who, 'parishes/A/pendingMembers/p1')));
  await assertSucceeds(getDocs(collection(a, 'parishes/A/pendingMembers')));
  await assertFails(updateDoc(doc(anon, 'parishes/A/pendingMembers/p1'), { fullName: 'X' }));
  await assertFails(updateDoc(doc(a, 'parishes/A/pendingMembers/p1'), { status: 'Rejected' }));        // reason required
  await assertSucceeds(updateDoc(doc(a, 'parishes/A/pendingMembers/p1'), { status: 'Rejected', reason: 'Duplicate', decidedAt: 'x', decidedBy: 'uA' }));
  await assertFails(updateDoc(doc(a, 'parishes/A/pendingMembers/p2'), { status: 'Approved', memberNo: 'CCC-MBR-999' })); // no such member
  await assertSucceeds(updateDoc(doc(a, 'parishes/A/pendingMembers/p2'), { status: 'Approved', memberNo: 'CCC-MBR-001', decidedAt: 'x', decidedBy: 'uA' }));
  // Flag & pend: reason from the fixed list, optional note; stays open; then approve or reject. No visitor path.
  await assertSucceeds(setDoc(doc(anon, 'parishes/A/pendingMembers/p6'), pending()));
  await assertSucceeds(setDoc(doc(anon, 'parishes/A/pendingMembers/p7'), pending()));
  await assertFails(updateDoc(doc(a, 'parishes/A/pendingMembers/p6'), { status: 'Clarify' }));                                   // reason required
  await assertFails(updateDoc(doc(a, 'parishes/A/pendingMembers/p6'), { status: 'Clarify', clarifyReason: 'Looks odd' }));       // not in the list
  await assertFails(updateDoc(doc(a, 'parishes/A/pendingMembers/p6'), { status: 'Clarify', clarifyReason: 'Other', clarifyNote: 'x'.repeat(301) }));
  await assertFails(updateDoc(doc(as.adminB(), 'parishes/A/pendingMembers/p6'), { status: 'Clarify', clarifyReason: 'Other' }));
  await assertSucceeds(updateDoc(doc(a, 'parishes/A/pendingMembers/p6'), { status: 'Clarify', clarifyReason: 'May be a visitor', decidedAt: 'x', decidedBy: 'uA' })); // note optional
  await assertSucceeds(updateDoc(doc(a, 'parishes/A/pendingMembers/p6'), { status: 'Clarify', clarifyReason: 'Details look suspicious', clarifyNote: 'Which parish?' }));
  await assertSucceeds(updateDoc(doc(a, 'parishes/A/pendingMembers/p6'), { status: 'Rejected', reason: 'No reply' }));          // flagged -> reject
  await assertFails(updateDoc(doc(a, 'parishes/A/pendingMembers/p6'), { status: 'Clarify', clarifyReason: 'Other' }));          // closed now
  await assertSucceeds(updateDoc(doc(a, 'parishes/A/pendingMembers/p7'), { status: 'Clarify', clarifyReason: 'May be a friend of the house' }));
  await assertFails(updateDoc(doc(a, 'parishes/A/pendingMembers/p7'), { status: 'Approved', memberNo: 'CCC-MBR-999' }));       // no such member
  await assertSucceeds(updateDoc(doc(a, 'parishes/A/pendingMembers/p7'), { status: 'Approved', memberNo: 'CCC-MBR-001' }));    // flagged -> approve
  await assertSucceeds(setDoc(doc(anon, 'parishes/A/pendingMembers/p8'), pending()));
  await assertFails(updateDoc(doc(a, 'parishes/A/pendingMembers/p8'), { status: 'Visitor', visitorId: 'v77' }));               // visitor path removed
  await assertFails(updateDoc(doc(a, 'parishes/A/pendingMembers/p8'), { status: 'Bogus' }));
  await assertSucceeds(updateDoc(doc(a, 'joinLinks/AAA111'), { open: false }));
  await assertFails(setDoc(doc(anon, 'parishes/A/pendingMembers/p5'), pending()));         // link closed
});
test('p9b timetable: per parish; custom service keys valid for attendance; batch WhatsApp log', async () => {
  const a = as.adminA();
  const tt = { services: [{ key: 'sunday', name: 'Sunday Service', dow: 0, time: '09:00', kind: 'service' },
    { key: 'c_vigil2', name: 'Extra Night Vigil', dow: 6, time: '23:00', kind: 'service' }], updatedAt: 'x' };
  await assertSucceeds(setDoc(doc(a, 'parishes/A/settings/timetable'), tt));
  await assertFails(setDoc(doc(a, 'parishes/A/settings/other'), tt));
  await assertFails(setDoc(doc(a, 'parishes/A/settings/timetable'), { services: [] }));
  await assertFails(setDoc(doc(as.adminB(), 'parishes/A/settings/timetable'), tt));
  await assertFails(getDoc(doc(as.superA(), 'parishes/A/settings/timetable')));
  const rec = { serviceDate: '2026-11-07', serviceType: 'Extra Night Vigil', serviceKey: 'c_vigil2', serviceTime: '23:00', men: 1, women: 2, children: 0, visitors: 0, headcount: 3, ledBy: '', ledByName: '', notes: '', updatedAt: 'x' };
  await assertSucceeds(setDoc(doc(a, 'parishes/A/attendance/2026-11-07_c_vigil2'), rec));
  await assertFails(setDoc(doc(a, 'parishes/A/attendance/2026-11-07_C-BAD'), { ...rec, serviceKey: 'C-BAD' }));
  await assertSucceeds(setDoc(doc(a, 'parishes/A/attendance/t1'), att));                    // old record shape still valid
  const bl = { template: 'general', channel: 'whatsapp_batch', count: 12, at: serverTimestamp(), by: 'uA' };
  await assertSucceeds(setDoc(doc(a, 'parishes/A/messageLog/b1'), bl));
  await assertFails(setDoc(doc(a, 'parishes/A/messageLog/b2'), { ...bl, text: 'Dear Beloved' }));
  await assertFails(setDoc(doc(a, 'parishes/A/messageLog/b3'), { ...bl, count: -1 }));
});
const addDocTo = (db, path, d) => setDoc(doc(collection(db, path)), d);
// ---------------------------------------------------------------- Phase 9: change parish admin (handover)
const hoStart = (db, id, mode = 'on_claim', extra = {}) => {
  const b = writeBatch(db);
  b.set(doc(db, 'invites/HANDOVERCODE-00000001'), { email: 'new@x.org', parishId: 'A', role: 'parish_admin', usedBy: null, createdAt: 'x' });
  b.set(doc(db, 'adminHandovers/' + id), { parishId: 'A', parishName: 'Parish A', newEmail: 'new@x.org', inviteCode: 'HANDOVERCODE-00000001',
    oldAdmins: [{ uid: 'uA', email: 'a@x.org' }], mode, status: 'Pending', reason: 'Real admin appointed', version: 1, createdAt: 'x', updatedAt: 'x', revokedAt: '', by: 'uNamed', ...extra });
  auditW(b, db, 'adminHandovers/' + id, 1, 'admin-handover-start', '', 'Real admin appointed');
  return b;
};
const revoke = (b, db, id) => { b.update(doc(db, 'users/uA'), { role: 'revoked', handoverId: id, revokedAt: 'x', revokedBy: 'uNamed' }); b.delete(doc(db, 'adminEmails/a@x.org')); };
test('p9 handover: named super starts it (invite + audited record); two admins coexist until claimed', async () => {
  const sup = as.named();
  await assertFails(hoStart(as.superA(), 'h0').commit());                     // unnamed super: refused
  const nb = hoStart(sup, 'h1'); await assertSucceeds(nb.commit());
  const bad = writeBatch(sup);                                                 // no audit entry: refused
  bad.set(doc(sup, 'adminHandovers/h2'), { parishId: 'A', parishName: 'A', newEmail: 'new@x.org', inviteCode: 'HANDOVERCODE-00000001', oldAdmins: [], mode: 'now', status: 'Pending', reason: 'x', version: 1, createdAt: 'x', updatedAt: 'x', revokedAt: '', by: 'uNamed' });
  await assertFails(bad.commit());
  for (const who of [as.adminA(), as.hq()]) await assertFails(getDoc(doc(who, 'adminHandovers/h1')));
  // New admin claims: both admins work in parish A.
  const nu = ctx('uN', 'new@x.org');
  const c = writeBatch(nu);
  c.set(doc(nu, 'users/uN'), { role: 'parish_admin', parishId: 'A', email: 'new@x.org', inviteCode: 'HANDOVERCODE-00000001' });
  c.update(doc(nu, 'invites/HANDOVERCODE-00000001'), { usedBy: 'uN' });
  c.set(doc(nu, 'adminEmails/new@x.org'), { uid: 'uN' });
  await assertSucceeds(c.commit());
  await assertSucceeds(getDoc(doc(nu, 'parishes/A/members/CCC-MBR-001')));
  await assertSucceeds(getDoc(doc(as.adminA(), 'parishes/A/members/CCC-MBR-001')));
  // Complete: old admin revoked in the same audited step; old login loses all access; parish data untouched.
  const fb = writeBatch(sup);
  fb.update(doc(sup, 'adminHandovers/h1'), { status: 'Completed', version: 2, updatedAt: 'y', revokedAt: 'y' });
  auditW(fb, sup, 'adminHandovers/h1', 2, 'admin-handover-complete', '', 'claimed');
  revoke(fb, sup, 'h1');
  await assertSucceeds(fb.commit());
  await assertFails(getDoc(doc(as.adminA(), 'parishes/A/members/CCC-MBR-001')));
  await assertFails(setDoc(doc(as.adminA(), 'parishes/A/finances/f9'), fin));
  await assertSucceeds(getDoc(doc(nu, 'parishes/A/members/CCC-MBR-001')));
  // Nothing deleted: the record stays; no more changes once Completed.
  await assertFails(updateDoc(doc(sup, 'adminHandovers/h1'), { status: 'Pending', version: 3 }));
  await assertFails(deleteDoc(doc(sup, 'adminHandovers/h1')));
});
test('p9 handover: revoke now; revoking an admin without an audited handover is refused', async () => {
  const sup = as.named();
  await assertFails(updateDoc(doc(sup, 'users/uA'), { role: 'revoked' }));
  await assertFails(deleteDoc(doc(sup, 'users/uA')));
  const b = hoStart(sup, 'h3', 'now', { revokedAt: 'x' }); revoke(b, sup, 'h3');
  await assertSucceeds(b.commit());
  await assertFails(getDoc(doc(as.adminA(), 'parishes/A')));
  await assertSucceeds(getDoc(doc(as.adminA(), 'users/uA')));               // can still see why (role revoked)
  // Cancel needs a reason in the audit; the parish admin cannot touch handovers.
  const c = writeBatch(sup);
  c.update(doc(sup, 'adminHandovers/h3'), { status: 'Cancelled', version: 2, updatedAt: 'z' });
  auditW(c, sup, 'adminHandovers/h3', 2, 'admin-handover-cancel', '', 'Wrong email');
  await assertSucceeds(c.commit());
});

// ================= Batch 14: HQ 1/3 base + Letters of Introduction =================
test('b14 HQ base: tithes 1/3 by default; lines marked in hqBase count at 1/3 too; old returns unchanged', async () => {
  // Old shape (no hqBase) still files with due = 1/3 of tithes.
  await assertSucceeds(fileReturn(as.adminA(), A, 'A', '2026-08'));
  eq((await getRet('A_2026-08')).due, 30000);
  await assertSucceeds(fileReturn(as.adminA(), A, 'A', '2026-07', { hqBase: [] }));
  await assertSucceeds(fileReturn(as.adminA(), A, 'A', '2026-06', { hqBase: ['harvest'] }));
  // Offerings marked: due = (90000 + 20000) / 3.
  const due = r2((90000 + 20000) / 3);
  await assertSucceeds(fileReturn(as.adminA(), A, 'A', '2026-10', { hqBase: ['offerings'], due }));
  eq((await getRet('A_2026-10')).due, due);
  // Marked line but due computed on tithes only -> refused; unknown / duplicate / tithes entries refused.
  await assertFails(fileReturn(as.adminA(), A, 'A', '2026-09', { hqBase: ['offerings'] }));
  await assertFails(fileReturn(as.adminA(), A, 'A', '2026-09', { hqBase: ['salary'], due: 30000 }));
  await assertFails(fileReturn(as.adminA(), A, 'A', '2026-09', { hqBase: ['offerings', 'offerings'], due }));
  await assertFails(fileReturn(as.adminA(), A, 'A', '2026-09', { hqBase: ['tithes'], due: 30000 }));
  // Correction: parish can untick a line (due back to tithes only), audited.
  const o = await getRet('A_2026-10');
  const d = { ...o, hqBase: [], due: 30000, version: 2 }; d.outstanding = r2(d.due - d.remitted); d.status = statusOf(d);
  const adb = as.adminA(), b = writeBatch(adb);
  b.update(doc(adb, 'returns/A_2026-10'), d);
  b.set(doc(adb, 'auditLog/' + auditId('returns/A_2026-10', 2)), audit('returns/A_2026-10', 2, 'correct', A, { reason: 'Offerings not in base' }));
  await assertSucceeds(b.commit());
  // Overpayment is just recorded (no block).
  await assertSucceeds(pay(as.adminA(), A, 'A_2026-10', await getRet('A_2026-10'), 50000));
  eq((await getRet('A_2026-10')).status, 'Paid');
});

async function issueLetter(db, who, pid, extra = {}, auditExtra = {}) {
  return runTransaction(db, async t => {
    const cRef = doc(db, `parishes/${pid}/meta/loi`);
    const c = await t.get(cRef);
    const n = (c.exists() ? c.data().n : 0) + 1, id = `CCC-${pid}${pid}${pid}-LAG-LOI-` + String(n).padStart(3, '0');
    const target = `parishes/${pid}/letters/${id}`;
    t.set(cRef, { n });
    t.set(doc(db, target), { no: id, memberNo: 'CCC-MBR-001', memberName: 'Ade Bisi', gender: 'Female', addressedTo: 'To whom it may concern',
      purpose: 'Worship while studying in Ibadan', date: '2026-11-04',
      signatories: [{ role: 0, title: 'Head Shepherd', name: 'Sup Evang Olu' }, { role: 1, title: 'Parochial Chairperson', name: 'Mrs Bola Ade' }],
      version: 1, issuedAt: '2026-11-04T10:00:00Z', issuedBy: who.uid, ...extra });
    if (auditExtra !== null) t.set(doc(db, 'auditLog/' + target.replace(/\//g, '_') + '_v1'), { ...audit(target, 1, 'issue-letter', who), parishId: pid, ...auditExtra });
    return id;
  });
}
test('b14 letters: numbered LOI per parish, audited, editable signatories, immutable, private', async () => {
  const a = as.adminA();
  eq(await issueLetter(a, A, 'A'), 'CCC-AAA-LAG-LOI-001');
  eq(await issueLetter(a, A, 'A', { signatories: [{ role: 0, title: 'Shepherd-in-charge', name: 'X Y' }, { role: 1, title: 'Parochial Chairman', name: 'A B' }, { role: 2, title: 'Church Secretary', name: 'C D' }] }), 'CCC-AAA-LAG-LOI-002');
  // No audit, missing name, 4 signers, unknown member, wrong member name, other parish -> refused.
  await assertFails(issueLetter(a, A, 'A', {}, null));
  await assertFails(issueLetter(a, A, 'A', { signatories: [{ role: 0, title: 'Head Shepherd', name: '' }] }));
  const s = { role: 0, title: 'T', name: 'N' };
  await assertFails(issueLetter(a, A, 'A', { signatories: [s, s, s, s] }));
  await assertFails(issueLetter(a, A, 'A', { memberNo: 'CCC-MBR-099' }));
  await assertFails(issueLetter(a, A, 'A', { memberName: 'Someone Else' }));
  await assertFails(issueLetter(as.adminB(), B, 'A'));
  await assertFails(issueLetter(a, A, 'A', { purpose: '' }));
  // Never edited or deleted; private to the parish.
  await assertFails(updateDoc(doc(a, 'parishes/A/letters/CCC-AAA-LAG-LOI-001'), { purpose: 'x' }));
  await assertFails(deleteDoc(doc(a, 'parishes/A/letters/CCC-AAA-LAG-LOI-001')));
  await assertSucceeds(getDoc(doc(a, 'parishes/A/letters/CCC-AAA-LAG-LOI-001')));
  await assertFails(getDoc(doc(as.adminB(), 'parishes/A/letters/CCC-AAA-LAG-LOI-001')));
  await assertFails(getDoc(doc(as.hq(), 'parishes/A/letters/CCC-AAA-LAG-LOI-001')));
  // Audit entry is readable by the parish.
  await assertSucceeds(getDoc(doc(a, 'auditLog/parishes_A_letters_CCC-AAA-LAG-LOI-001_v1')));
});

// ---------------- Batch 15: parish committees, harvests, unit anniversaries
const pTarget = (kind, id) => `parishes/A/${kind}/${id}`;
async function pAudited(db, who, path, data, v, action = 'create', auditExtra = {}) {
  const b = writeBatch(db);
  b.set(doc(db, path), { version: v, updatedAt: 'now', updatedBy: who.uid, ...data });
  if (auditExtra !== null) b.set(doc(db, 'auditLog/' + path.replace(/\//g, '_') + '_v' + v), { ...audit(path, v, action, who), parishId: path.split('/')[1], ...auditExtra });
  return b.commit();
}
const pcom = (extra = {}) => ({ name: 'Harvest Committee 2026', nameLower: 'harvest committee 2026', template: 'Harvest', purpose: '', termStart: '2026-06-01',
  termEnd: '2026-12-31', status: 'Active', members: [{ memberNo: 'CCC-MBR-001', fullName: 'Ade Bisi', role: 'Chairperson', status: 'Current', from: '2026-06-01', to: '' }],
  createdAt: 'c', createdBy: 'uA', ...extra });
const celeb = (y, kind, date, extra = {}) => ({ year: y, kind, title: 'T', date, committeeId: '', notes: '', ...extra });
test('b15 parish committees: audited, never deleted, private to the parish', async () => {
  const a = as.adminA(), p = pTarget('pcommittees', 'C1');
  await assertFails(pAudited(a, A, p, pcom(), 1, 'create', null));            // no audit
  await assertFails(pAudited(a, A, p, pcom({ termEnd: '2026-01-01' }), 1));   // ends before start
  await assertFails(pAudited(a, A, p, pcom({ status: 'Gone' }), 1));
  await assertSucceeds(pAudited(a, A, p, pcom(), 1));
  await assertFails(pAudited(a, A, p, pcom({ status: 'Dissolved' }), 1, 'update'));  // not bumped
  await assertSucceeds(pAudited(a, A, p, pcom({ status: 'Dissolved' }), 2, 'dissolve'));
  await assertFails(deleteDoc(doc(a, p)));
  await assertFails(getDoc(doc(as.adminB(), p)));
  await assertFails(pAudited(as.adminB(), { uid: 'uB', email: 'b@x.org', role: 'parish_admin' }, p, pcom(), 3, 'update'));
  await assertSucceeds(getDoc(doc(a, 'auditLog/' + p.replace(/\//g, '_') + '_v2')));
});
test('b15 harvests: juvenile 1st Sunday of June, adult window (default June), unit anniversaries, super reads all', async () => {
  const a = as.adminA(), c = id => pTarget('celebrations', id);
  await assertSucceeds(pAudited(a, A, c('2026_juvenile'), celeb(2026, 'juvenile', '2026-06-07'), 1));
  await assertFails(pAudited(a, A, c('2027_juvenile'), celeb(2027, 'juvenile', '2027-06-13'), 1));   // 2nd Sunday
  await assertFails(pAudited(a, A, c('2026_adult'), celeb(2026, 'adult', '2026-06-07'), 1));         // before 2nd Sunday of June
  await assertFails(pAudited(a, A, c('2026_adult'), celeb(2026, 'adult', '2026-12-27'), 1));         // after Christmas
  await assertFails(pAudited(a, A, c('2026_adult'), celeb(2026, 'adult', '2026-11-14'), 1));         // Saturday
  await assertFails(pAudited(a, A, c('2026_adult'), celeb(2026, 'adult', '2025-11-15'), 1));         // wrong year
  await assertSucceeds(pAudited(a, A, c('2026_adult'), celeb(2026, 'adult', '2026-06-14'), 1));
  await assertSucceeds(pAudited(a, A, c('2026_adult'), celeb(2026, 'adult', '2026-12-20', { attendance: 450, income: 1250000.5 }), 2, 'update'));
  await assertFails(pAudited(a, A, c('2026_adult'), celeb(2026, 'adult', '2026-12-20', { attendance: -1 }), 3, 'update'));
  await assertFails(pAudited(a, A, c('2026_other'), celeb(2026, 'adult', '2026-12-20'), 1));         // id mismatch
  await assertSucceeds(pAudited(a, A, c('2026_unit-choir'), celeb(2026, 'unit-choir', '2026-09-19'), 1));
  await assertFails(pAudited(a, A, c('2026_unit-sundayschool'), celeb(2026, 'unit-sundayschool', '2026-09-19'), 1));
  await assertFails(pAudited(a, A, c('2026_unit-parochial'), celeb(2026, 'unit-parochial', '2026-09-19'), 1));
  await assertFails(deleteDoc(doc(a, c('2026_adult'))));
  // HQ moves the start month to October: a September Adult Harvest is now refused.
  const n = as.named(), save = (db, who, m, v) => { const b = writeBatch(db);
    b.set(doc(db, 'hqSettings/harvest'), { startMonth: m, version: v, updatedAt: 'now', updatedBy: who.uid });
    b.set(doc(db, 'auditLog/' + auditId('hqSettings/harvest', v)), audit('hqSettings/harvest', v, 'settings', who)); return b.commit(); };
  await assertFails(save(as.adminA(), A, 10, 1));
  await assertFails(save(n, NAMED, 13, 1));
  await assertSucceeds(save(n, NAMED, 10, 1));
  await assertFails(pAudited(a, A, c('2027_adult'), celeb(2027, 'adult', '2027-09-12'), 1));
  await assertFails(pAudited(a, A, c('2027_adult'), celeb(2027, 'adult', '2027-10-03'), 1));        // 1st Sunday of Oct
  await assertSucceeds(pAudited(a, A, c('2027_adult'), celeb(2027, 'adult', '2027-10-10'), 1));
  // Super Admin sees every parish's Adult Harvest; other parishes cannot.
  const all = await assertSucceeds(getDocs(query(collectionGroup(as.superA(), 'celebrations'), where('kind', '==', 'adult'), where('year', '==', 2026))));
  eq(all.size, 1);
  await assertFails(getDocs(collection(as.adminB(), 'parishes/A/celebrations')));
});

// ---------------- Batch 16: rank history, anointing events, HQ certificates
const rEntry = (to, extra = {}) => ({ date: '2026-11-01', from: '', to, parish: 'A', pastor: 'Rev X', approvedBy: 'Shepherd', eventId: '', kind: 'start', by: 'uA', ...extra });
const rHist = (entries) => ({ memberNo: 'CCC-MBR-001', fullName: 'Ade Bisi', gender: 'Female', entries });
const anoint = (extra = {}) => ({ date: '2026-12-06', state: 'Lagos', parishName: 'A', pastor: 'Rev X', approvedBy: '', notes: '', status: 'Planned',
  candidates: [{ memberNo: 'CCC-MBR-001', fullName: 'Ade Bisi', fromRank: 'Sister', toRank: 'Elder Sister', amount: 5000, flagged: false, anointed: false }],
  createdAt: 'c', createdBy: 'uA', ...extra });
test('b16 rank history: append-only, audited, gender rank line, never deleted', async () => {
  const a = as.adminA(), p = 'parishes/A/rankHistory/CCC-MBR-001';
  const e0 = rEntry('Sister'), e1 = rEntry('Elder Sister', { from: 'Sister', kind: 'anointment', eventId: 'E1', date: '2026-12-06' });
  await assertFails(pAudited(a, A, p, rHist([e0]), 1, 'create', null));                     // no audit
  await assertFails(pAudited(a, A, p, rHist([rEntry('Brother')]), 1));                      // male rank on a woman
  await assertSucceeds(pAudited(a, A, p, rHist([e0]), 1));
  await assertFails(pAudited(a, A, p, rHist([e1]), 2, 'anoint'));                           // rewrites history
  await assertFails(pAudited(a, A, p, rHist([e0, e1, e1]), 2, 'anoint'));                   // two at once
  await assertFails(pAudited(a, A, p, rHist([e0, rEntry('Mother Celestial', { by: 'uB' })]), 2, 'anoint')); // wrong "by"
  await assertSucceeds(pAudited(a, A, p, rHist([e0, e1]), 2, 'anoint'));
  await assertFails(pAudited(a, A, p, rHist([e0]), 3, 'update'));                           // cannot remove
  await assertFails(deleteDoc(doc(a, p)));
  await assertFails(getDoc(doc(as.adminB(), p)));
});
test('b16 anointing events: audited, never deleted, Done stays Done, super reads all', async () => {
  const a = as.adminA(), p = 'parishes/A/anointings/E1';
  await assertFails(pAudited(a, A, p, anoint(), 1, 'create', null));
  await assertFails(pAudited(a, A, p, anoint({ status: 'Done' }), 1));
  await assertFails(pAudited(a, A, p, anoint({ split: 0.5 }), 1));                           // no fee split fields
  await assertSucceeds(pAudited(a, A, p, anoint(), 1));
  await assertSucceeds(pAudited(a, A, p, anoint({ status: 'Done' }), 2, 'anoint'));
  await assertFails(pAudited(a, A, p, anoint({ status: 'Planned' }), 3, 'update'));
  await assertFails(deleteDoc(doc(a, p)));
  await assertFails(getDoc(doc(as.adminB(), p)));
  const all = await assertSucceeds(getDocs(collectionGroup(as.superA(), 'anointings')));
  eq(all.size, 1);
  await assertFails(getDocs(collectionGroup(as.adminA(), 'anointings')));
});
test('b16 certificates: parish requests, named Super Admin issues, audited', async () => {
  const a = as.adminA();
  await pAudited(a, A, 'parishes/A/anointings/E1', anoint(), 1);
  const id = 'A_E1_CCC-MBR-001', t = 'certificates/' + id;
  const cert = { parishId: 'A', parishName: 'A', eventId: 'E1', eventDate: '2026-12-06', memberNo: 'CCC-MBR-001', fullName: 'Ade Bisi', rank: 'Elder Sister', status: 'Requested' };
  const write = (db, who, data, v, action, parishId = 'A') => { const b = writeBatch(db);
    b.set(doc(db, t), { ...data, version: v, updatedAt: 'now', updatedBy: who.uid });
    b.set(doc(db, 'auditLog/' + auditId(t, v)), { ...audit(t, v, action, who), parishId }); return b.commit(); };
  await assertFails(write(a, A, { ...cert, status: 'Issued' }, 1, 'request'));
  await assertFails(write(a, A, { ...cert, eventId: 'NOPE' }, 1, 'request'));
  await assertFails(write(as.adminB(), { uid: 'uB', email: 'b@x.org', role: 'parish_admin' }, cert, 1, 'request'));
  await assertSucceeds(write(a, A, cert, 1, 'request'));
  await assertFails(write(a, A, { ...cert, status: 'Issued', certNo: 'X1', issuedDate: '2027-01-10' }, 2, 'issue'));   // parish cannot issue
  await assertFails(write(as.named(), NAMED, { ...cert, status: 'Issued', issuedDate: '2027-01-10' }, 2, 'issue'));     // no number
  await assertFails(write(as.named(), NAMED, { ...cert, fullName: 'Other', status: 'Issued', certNo: 'X1', issuedDate: '2027-01-10' }, 2, 'issue'));
  await assertSucceeds(write(as.named(), NAMED, { ...cert, status: 'Issued', certNo: 'HQ/AN/2027/001', issuedDate: '2027-01-10' }, 2, 'issue'));
  await assertFails(deleteDoc(doc(as.named(), t)));
  await assertSucceeds(getDoc(doc(a, t)));
  await assertFails(getDoc(doc(as.adminB(), t)));
});

// ---- Prophet / Prophetess designation + tracks (women are never clergy) ----
test('tracks: a woman cannot be created as clergy; prophet is a yes/no on members', async () => {
  const a = as.adminA();
  await assertFails(addRecord(a, 'A', 'clergy', clergy('x', 'sister.clergy@x.org', { gender: 'Female', fullName: 'Ada Olu', nameLower: 'ada olu',
    rank: 'Mother Celestial', serviceRecord: [{ rank: 'Mother Celestial', from: '2020-01-01' }] })));
  await assertSucceeds(addRecord(a, 'A', 'clergy', clergy('x', 'brother.clergy@x.org')));
  await assertSucceeds(addRecord(a, 'A', 'members', person('x', { rank: 'Lace Superior Senior Elder Sister', prophet: true })));
  await assertFails(addRecord(a, 'A', 'members', person('x', { prophet: 'yes' })));
});

// ---- Batch 17: Bible readings (public, named Super Admin writes), duty roster (parish, draft -> published), public info ----
async function readingWrite(db, who, date, data, v, parishId = '') {
  const b = writeBatch(db), t = 'bibleReadings/' + date;
  b.set(doc(db, t), { date, services: [{ service: 'Sunday Service', readings: 'Psalm 23; John 3:16-21' }], version: v, updatedAt: 'now', ...data });
  b.set(doc(db, 'auditLog/' + auditId(t, v)), { ...audit(t, v, v === 1 ? 'readings-add' : 'readings-edit', who), parishId });
  return b.commit();
}
test('b17 bible readings: public + signed-in read, only a named Super Admin writes, audited, never deleted', async () => {
  const D = '2026-11-08';
  await assertFails(readingWrite(as.adminA(), A, D, {}, 1));
  await assertFails(readingWrite(as.superA(), UNNAMED, D, {}, 1));                       // unnamed Super Admin
  await assertFails(readingWrite(as.named(), NAMED, '2026-11-09', { date: D }, 1));       // id must be the date
  await assertFails(readingWrite(as.named(), NAMED, D, { services: [] }, 1));
  await assertFails(readingWrite(as.named(), NAMED, D, { updatedBy: 'uNamed' }, 1));      // public doc: no uid
  await assertSucceeds(readingWrite(as.named(), NAMED, D, {}, 1));
  await assertFails(readingWrite(as.named(), NAMED, D, {}, 1));                           // must bump the version
  await assertSucceeds(readingWrite(as.named(), NAMED, D, { services: [{ service: 'Sunday Service', readings: 'Psalm 24' }] }, 2));
  await assertFails(readingWrite(as.adminA(), A, D, {}, 3, 'A'));
  await assertFails(deleteDoc(doc(as.named(), 'bibleReadings/' + D)));
  await assertSucceeds(getDoc(doc(as.stranger(), 'bibleReadings/' + D)));                // website, no login
  await assertSucceeds(getDoc(doc(as.adminA(), 'bibleReadings/' + D)));
  await assertSucceeds(getDocs(query(collection(as.adminB(), 'bibleReadings'), where('date', '>=', '2026-11-01'))));
  await assertFails(setDoc(doc(as.stranger(), 'bibleReadings/2026-11-15'), { date: '2026-11-15', services: [{ service: 'S', readings: 'R' }], version: 1, updatedAt: 'x' }));
});
const roster = (extra = {}) => ({ month: '2026-11', rev: 1, status: 'Draft', rows: [{ date: '2026-11-01', service: 'Sunday Service',
  lesson1: '2 KINGS 23:4-9', lesson2: '', duties: [{ duty: 'Preacher', no: 'CCC-CLG-001', name: 'Ven Olu', kind: 'clergy' }] }], nos: ['CCC-CLG-001'], replaces: '', reason: '', parishName: 'Parish A',
  secretary: 'S/L JOHN', shepherd: 'VEN/M/EVANG. ISSAC', createdAt: '2026-11-01', createdBy: 'uA', ...extra });
test('b17 duty roster: parish-scoped, draft -> published, published frozen, corrections are new versions, audited', async () => {
  const a = as.adminA(), p1 = 'parishes/A/rosters/2026-11_r1', p2 = 'parishes/A/rosters/2026-11_r2';
  await assertFails(pAudited(a, A, p1, roster(), 1, 'create', null));                      // no audit entry
  await assertFails(pAudited(a, A, p1, roster({ status: 'Published' }), 1));               // starts as Draft
  await assertFails(pAudited(a, A, 'parishes/A/rosters/2026-11_r9', roster(), 1));          // id = month_r{rev}
  await assertFails(pAudited(a, A, 'parishes/A/rosters/2026-13_r1', roster({ month: '2026-13' }), 1));
  await assertFails(pAudited(as.adminB(), B, p1, roster(), 1));                            // other parish
  await assertFails(pAudited(as.adminS(), { uid: 'uS', email: '', role: 'parish_admin' }, 'parishes/S/rosters/2026-11_r1', roster(), 1));
  await assertSucceeds(pAudited(a, A, p1, roster(), 1));
  await assertSucceeds(pAudited(a, A, p1, roster({ rows: [] , nos: [] }), 2, 'roster-save'));
  await assertFails(pAudited(a, A, p1, roster({ month: '2026-12' }), 3, 'roster-save'));
  await assertSucceeds(pAudited(a, A, p1, roster({ status: 'Published', publishedAt: 'now' }), 3, 'roster-publish'));
  await assertFails(pAudited(a, A, p1, roster({ status: 'Published', rows: [] }), 4, 'roster-save'));   // published is frozen
  await assertFails(pAudited(a, A, p1, roster({ status: 'Draft' }), 4, 'roster-save'));
  await assertFails(deleteDoc(doc(a, p1)));
  await assertFails(pAudited(a, A, p2, roster({ rev: 2, replaces: '2026-11_r1' }), 1));    // a correction needs a reason
  await assertFails(pAudited(a, A, 'parishes/A/rosters/2026-11_r4', roster({ rev: 4, reason: 'skip' }), 1)); // no gaps
  await assertSucceeds(pAudited(a, A, p2, roster({ rev: 2, replaces: '2026-11_r1', reason: 'Usher changed' }), 1, 'roster-correct'));
  await assertSucceeds(getDocs(query(collection(a, 'parishes/A/rosters'), where('nos', 'array-contains', 'CCC-CLG-001'))));
  await assertFails(getDoc(doc(as.adminB(), p1)));
  await assertFails(getDoc(doc(as.stranger(), p1)));
  await assertFails(getDoc(doc(as.superA(), p1)));                                         // parish-private
  // Duty types: editable list, versioned + audited.
  const dt = 'parishes/A/rosterConfig/dutyTypes', types = { types: [{ name: 'Sermon', clergyOnly: true }] };
  await assertFails(pAudited(a, A, dt, { types: [] }, 1));
  await assertFails(pAudited(a, A, 'parishes/A/rosterConfig/other', types, 1));
  await assertFails(pAudited(a, A, dt, { ...types, days: [0,1,2,3,4,5,6,0] }, 1));
  await assertSucceeds(pAudited(a, A, dt, { ...types, days: [0, 3, 5] }, 1));
  await assertFails(pAudited(a, A, dt, types, 1));
  await assertSucceeds(pAudited(a, A, dt, { types: [{ name: 'Usher', clergyOnly: false }] }, 2, 'duty-types'));
  await assertFails(pAudited(as.adminB(), B, dt, types, 3));
  await assertFails(getDoc(doc(as.adminB(), dt)));
});
test('b17 public church info: anyone reads; only that parish admin writes; only the public fields', async () => {
  const info = { parishName: 'Parish A', services: ['Sunday 10:00 Sunday Service'], address: '1 Church Rd', phone: '0801', mapsUrl: 'https://maps.app.goo.gl/x', about: 'Welcome', updatedAt: 'now' };
  await assertFails(setDoc(doc(as.adminB(), 'publicInfo/A'), info));
  await assertFails(setDoc(doc(as.stranger(), 'publicInfo/A'), info));
  await assertFails(setDoc(doc(as.adminA(), 'publicInfo/A'), { ...info, members: 120 }));  // nothing private
  await assertFails(setDoc(doc(as.adminA(), 'publicInfo/A'), { ...info, mapsUrl: 'javascript:alert(1)' }));
  await assertFails(setDoc(doc(as.adminS(), 'publicInfo/S'), info));                        // suspended parish
  await assertSucceeds(setDoc(doc(as.adminA(), 'publicInfo/A'), info));
  await assertSucceeds(getDoc(doc(as.stranger(), 'publicInfo/A')));
  await assertSucceeds(getDocs(collection(as.stranger(), 'publicInfo')));
  await assertFails(deleteDoc(doc(as.adminA(), 'publicInfo/A')));
  await assertFails(getDoc(doc(as.stranger(), 'parishes/A')));                              // the parish itself stays private
});

// ---------------- Batch 18: archive index + intake import log ----------------
const KEY = (p) => `${p}/2026/0f8fad5b-d9cb-469f-a165-70867728950e.jpg`;
const arc = (pid, extra = {}) => ({ title: 'Minutes 1990', titleLower: 'minutes 1990', category: 'Minutes', date: '1990-05', year: 1990, parishId: pid,
  parishName: 'Parish ' + pid, tags: ['minutes', 'harvest'], description: 'Old minutes', fileKey: KEY(pid), fileName: 'm.jpg', mime: 'image/jpeg',
  size: 120000, hidden: false, createdAt: 'now', createdBy: 'uA', ...extra });
async function arcWrite(db, who, id, data, v, action = 'archive-add', withAudit = true) {
  const b = writeBatch(db), path = 'archive/' + id;
  b.set(doc(db, path), { version: v, updatedAt: 'now', updatedBy: who.uid, ...data });
  if (withAudit) b.set(doc(db, 'auditLog/archive_' + id + '_v' + v), { ...audit(path, v, action, who), parishId: data.parishId });
  return b.commit();
}
test('b18 archive: parish admin adds to own parish, Super Admin to HQ; never deleted; hide needs a reason; audited', async () => {
  const a = as.adminA(), N = { ...NAMED };
  await assertFails(arcWrite(a, A, 'x1', arc('A'), 1, 'archive-add', false));                      // no audit
  await assertFails(arcWrite(a, A, 'x1', arc('B'), 1));                                             // other parish
  await assertFails(arcWrite(a, A, 'x1', arc('A', { fileKey: KEY('B') }), 1));                      // file of another parish
  await assertFails(arcWrite(a, A, 'x1', arc('A', { category: 'Gossip' }), 1));
  await assertFails(arcWrite(a, A, 'x1', arc('A', { mime: 'text/html' }), 1));
  await assertFails(arcWrite(a, A, 'x1', arc('A', { size: 16 * 1024 * 1024 }), 1));
  await assertFails(arcWrite(a, A, 'x1', arc('A', { hidden: true }), 1));
  await assertFails(arcWrite(a, A, 'x1', arc('A', { createdBy: 'uB' }), 1));
  await assertFails(arcWrite(a, A, 'x1', arc('HQ', { fileKey: KEY('HQ') }), 1));                    // HQ is Super Admin only
  await assertFails(arcWrite(as.adminS(), { uid: 'uS', email: '', role: 'parish_admin' }, 'x9', arc('S', { createdBy: 'uS' }), 1));
  await assertSucceeds(arcWrite(a, A, 'x1', arc('A'), 1));
  await assertSucceeds(arcWrite(as.named(), N, 'h1', arc('HQ', { fileKey: KEY('HQ'), createdBy: 'uNamed' }), 1));
  await assertFails(arcWrite(as.superA(), UNNAMED, 'h2', arc('HQ', { fileKey: KEY('HQ'), createdBy: 'uSuper' }), 1)); // named accounts only
  // Edit the description: version bump + audit; file / parish fixed.
  await assertSucceeds(arcWrite(a, A, 'x1', arc('A', { title: 'Minutes May 1990', titleLower: 'minutes may 1990' }), 2, 'archive-edit'));
  await assertFails(arcWrite(a, A, 'x1', arc('A', { fileKey: KEY('A').replace('0f8f', '1f8f') }), 3, 'archive-edit'));
  await assertFails(arcWrite(a, A, 'x1', arc('A', { size: 5 }), 3, 'archive-edit'));
  await assertFails(arcWrite(a, A, 'x1', arc('A'), 2, 'archive-edit'));                             // must bump
  await assertFails(arcWrite(a, A, 'x1', arc('A', { hidden: true }), 3, 'archive-hide'));            // reason needed
  await assertSucceeds(arcWrite(a, A, 'x1', arc('A', { hidden: true, hiddenReason: 'Duplicate scan' }), 3, 'archive-hide'));
  await assertFails(deleteDoc(doc(a, 'archive/x1')));
  await assertFails(deleteDoc(doc(as.named(), 'archive/x1')));
  // Reads: own parish only; HQ docs for Super Admin / HQ.
  await assertSucceeds(getDocs(query(collection(a, 'archive'), where('parishId', '==', 'A'))));
  await assertFails(getDocs(query(collection(as.adminB(), 'archive'), where('parishId', '==', 'A'))));
  await assertFails(getDoc(doc(as.adminB(), 'archive/x1')));
  await assertFails(getDoc(doc(a, 'archive/h1')));
  await assertFails(getDoc(doc(as.stranger(), 'archive/x1')));
  await assertSucceeds(getDoc(doc(as.superA(), 'archive/x1')));
  await assertSucceeds(getDoc(doc(as.hq(), 'archive/h1')));
  await assertFails(arcWrite(as.adminB(), B, 'x1', arc('A', { hidden: false, hiddenReason: 'x' }), 4, 'archive-show'));
  await assertSucceeds(arcWrite(as.named(), N, 'x1', arc('A', { hidden: false, hiddenReason: 'Restored' }), 4, 'archive-show')); // Super Admin may hide/show
});
test('b18 intake: import log accepts source intake, also for new clergy; other sources unchanged', async () => {
  const a = as.adminA();
  const log = (no, source, v = 1) => { const b = writeBatch(a), path = `parishes/A/importLog/${no}`;
    b.set(doc(a, path), { memberNo: no, source, version: v, at: serverTimestamp(), by: 'uA' });
    b.set(doc(a, 'auditLog/' + path.replace(/\//g, '_') + '_v' + v), { ...audit(path, v, 'import-member', A), parishId: 'A' });
    return b.commit(); };
  await assertSucceeds(log('CCC-MBR-001', 'intake'));
  await assertSucceeds(log('CCC-CLG-001', 'intake'));          // clergy via the intake agent
  await assertFails(log('CCC-CLG-001', 'csv'));                // csv/whatsapp stay members-only (already exists anyway)
  await assertFails(log('CCC-MBR-002', 'robot'));
  await assertFails(log('CCC-MBR-404', 'intake'));             // record must exist
});
