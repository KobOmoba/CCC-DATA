// CCC Firestore rules tests. Runs against the local Firestore emulator only.
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, orderBy, limit, writeBatch, increment } from 'firebase/firestore';

let env;
const ctx = (uid) => env.authenticatedContext(uid).firestore();
const as = {
  stranger: () => env.unauthenticatedContext().firestore(),
  superA: () => ctx('uSuper'),
  hq: () => ctx('uHQ'),
  adminA: () => ctx('uA'),
  adminB: () => ctx('uB'),
  adminS: () => ctx('uS'),       // parish is Suspended
  noRole: () => ctx('uX'),       // signed in, no users doc
  selfPromoter: () => ctx('uP'),
};
const member = { fullName: 'Ade Bisi', nameLower: 'ade bisi', gender: 'Female', phone: '080', phoneDigits: '080',
  address: 'Lagos', dateJoined: '2026-01-01', rank: 'Sister', household: 'Bisi family', consentGiven: true, consentDate: '2026-11-01' };
const att = { serviceDate: '2026-11-01', serviceType: 'Sunday Service', headcount: 100 };
const fin = { transactionDate: '2026-11-01', contributorName: 'Ade Bisi', contributionType: 'Tithe', amount: 5000 };

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
    await setDoc(doc(db, 'users/uA'), { role: 'parish_admin', parishId: 'A' });
    await setDoc(doc(db, 'users/uB'), { role: 'parish_admin', parishId: 'B' });
    await setDoc(doc(db, 'users/uS'), { role: 'parish_admin', parishId: 'S' });
    await setDoc(doc(db, 'parishes/A'), { name: 'Parish A', status: 'Approved' });
    await setDoc(doc(db, 'parishes/B'), { name: 'Parish B', status: 'Approved' });
    await setDoc(doc(db, 'parishes/S'), { name: 'Parish S', status: 'Suspended' });
    await setDoc(doc(db, 'parishes/A/members/m1'), member);
    await setDoc(doc(db, 'parishes/A/finances/f1'), fin);
    await setDoc(doc(db, 'parishStats/A'), { memberCount: 1, attendanceTotal: 0, serviceCount: 0, financeTotal: 5000, financeCount: 1 });
    await setDoc(doc(db, 'parishRequests/uX'), { parishName: 'Pilot', email: 'x@y.com', status: 'Pending' });
    await setDoc(doc(db, 'parishes/S/members/m1'), member);
    await setDoc(doc(db, 'circulars/c1'), { body: 'Notice' });
  });
});

test('stranger cannot read anything', async () => {
  await assertFails(getDoc(doc(as.stranger(), 'parishes/A')));
  await assertFails(getDoc(doc(as.stranger(), 'parishes/A/members/m1')));
  await assertFails(getDoc(doc(as.stranger(), 'circulars/c1')));
  await assertFails(getDoc(doc(as.stranger(), 'users/uA')));
});
test('stranger cannot write anything', async () => {
  await assertFails(setDoc(doc(as.stranger(), 'parishes/X'), { name: 'x', status: 'Approved' }));
  await assertFails(setDoc(doc(as.stranger(), 'circulars/c2'), { body: 'x' }));
});
test('parish admin reads and writes own parish', async () => {
  await assertSucceeds(getDoc(doc(as.adminA(), 'parishes/A')));
  await assertSucceeds(getDocs(collection(as.adminA(), 'parishes/A/members')));
  await assertSucceeds(setDoc(doc(as.adminA(), 'parishes/A/members/m2'), member));
  await assertSucceeds(setDoc(doc(as.adminA(), 'parishes/A/attendance/a1'), att));
  await assertSucceeds(setDoc(doc(as.adminA(), 'parishes/A/finances/f2'), fin));
  await assertSucceeds(deleteDoc(doc(as.adminA(), 'parishes/A/members/m1')));
});
test('parish admin cannot touch another parish', async () => {
  await assertFails(getDoc(doc(as.adminB(), 'parishes/A')));
  await assertFails(getDoc(doc(as.adminB(), 'parishes/A/members/m1')));
  await assertFails(getDoc(doc(as.adminB(), 'parishes/A/finances/f1')));
  await assertFails(setDoc(doc(as.adminB(), 'parishes/A/members/m9'), member));
  await assertFails(deleteDoc(doc(as.adminB(), 'parishes/A/members/m1')));
});
test('member without consent is refused (NDPA)', async () => {
  await assertFails(setDoc(doc(as.adminA(), 'parishes/A/members/m3'), { ...member, consentGiven: false }));
  const { consentDate, ...noDate } = member;
  await assertFails(setDoc(doc(as.adminA(), 'parishes/A/members/m4'), noDate));
});
test('parish admin cannot approve own parish, change roles, or post circulars', async () => {
  await assertFails(setDoc(doc(as.adminA(), 'parishes/A'), { name: 'Parish A', status: 'Approved' }));
  await assertFails(setDoc(doc(as.adminA(), 'users/uA'), { role: 'super_admin' }));
  await assertFails(setDoc(doc(as.selfPromoter(), 'users/uP'), { role: 'super_admin' }));
  await assertFails(setDoc(doc(as.adminA(), 'circulars/c2'), { body: 'x' }));
  await assertSucceeds(getDoc(doc(as.adminA(), 'circulars/c1')));
});
test('suspended parish admin is locked out', async () => {
  await assertFails(getDoc(doc(as.adminS(), 'parishes/S')));
  await assertFails(getDoc(doc(as.adminS(), 'parishes/S/members/m1')));
});
test('signed-in user with no role sees nothing', async () => {
  await assertFails(getDoc(doc(as.noRole(), 'parishes/A')));
  await assertFails(getDoc(doc(as.noRole(), 'circulars/c1')));
});
test('signed-in user can file own Pending parish request only', async () => {
  await assertSucceeds(setDoc(doc(ctx('uY'), 'parishRequests/uY'), { parishName: 'New', email: 'x@y.com', status: 'Pending' }));
  await assertFails(setDoc(doc(as.noRole(), 'parishRequests/uOther'), { parishName: 'New', email: 'x@y.com', status: 'Pending' }));
  await assertFails(setDoc(doc(as.selfPromoter(), 'parishRequests/uP'), { parishName: 'New', email: 'x@y.com', status: 'Approved' }));
});
test('hq reads all parishes, cannot write parish data, can post circulars', async () => {
  await assertSucceeds(getDoc(doc(as.hq(), 'parishes/A')));
  await assertSucceeds(getDoc(doc(as.hq(), 'parishes/B')));
  await assertFails(setDoc(doc(as.hq(), 'parishes/A/members/m5'), member));
  await assertFails(setDoc(doc(as.hq(), 'parishes/A/finances/f9'), { amount: 1 }));
  await assertSucceeds(setDoc(doc(as.hq(), 'circulars/c2'), { body: 'HQ notice' }));
});
test('super admin can do everything', async () => {
  await assertSucceeds(setDoc(doc(as.superA(), 'parishes/C'), { name: 'C', status: 'Approved' }));
  await assertSucceeds(setDoc(doc(as.superA(), 'users/uNew'), { role: 'parish_admin', parishId: 'C' }));
  await assertSucceeds(getDoc(doc(as.superA(), 'parishes/S/members/m1')));
  await assertSucceeds(setDoc(doc(as.superA(), 'circulars/c3'), { body: 'x' }));
});

// ---- Milestone 1 ----
test('NDPA: hq cannot read members, finances or attendance', async () => {
  await assertFails(getDocs(collection(as.hq(), 'parishes/A/members')));
  await assertFails(getDoc(doc(as.hq(), 'parishes/A/members/m1')));
  await assertFails(getDocs(collection(as.hq(), 'parishes/A/finances')));
  await assertFails(getDocs(collection(as.hq(), 'parishes/A/attendance')));
});
test('NDPA: hq reads per-parish totals but cannot write them', async () => {
  await assertSucceeds(getDoc(doc(as.hq(), 'parishStats/A')));
  await assertFails(setDoc(doc(as.hq(), 'parishStats/A'), { memberCount: 99 }));
});
test('parish admin keeps own totals; not another parish', async () => {
  const a = as.adminA();
  const b = writeBatch(a);
  b.set(doc(a, 'parishes/A/members/m7'), member);
  b.set(doc(a, 'parishStats/A'), { memberCount: increment(1) }, { merge: true });
  await assertSucceeds(b.commit());
  await assertFails(setDoc(doc(as.adminA(), 'parishStats/B'), { memberCount: 1 }));
  await assertFails(getDoc(doc(as.adminB(), 'parishStats/A')));
  await assertFails(setDoc(doc(as.adminA(), 'parishStats/A'), { memberCount: -1 }));
  await assertFails(setDoc(doc(as.adminA(), 'parishStats/A'), { memberNames: ['x'] }));
});
test('parish admin edits a member; bad edits refused', async () => {
  await assertSucceeds(updateDoc(doc(as.adminA(), 'parishes/A/members/m1'), { phone: '0803', phoneDigits: '0803' }));
  await assertSucceeds(updateDoc(doc(as.adminA(), 'parishes/A/members/m1'), { fullName: 'Ade Bisi Jr', nameLower: 'ade bisi jr' }));
  await assertFails(updateDoc(doc(as.adminA(), 'parishes/A/members/m1'), { fullName: 'X', nameLower: 'wrong' }));
  await assertFails(updateDoc(doc(as.adminA(), 'parishes/A/members/m1'), { consentGiven: false }));
  await assertFails(updateDoc(doc(as.adminA(), 'parishes/A/members/m1'), { religionSecret: 'x' }));
  await assertFails(updateDoc(doc(as.adminB(), 'parishes/A/members/m1'), { phone: '1' }));
});
test('member search by name prefix and phone, own parish only', async () => {
  const col = collection(as.adminA(), 'parishes/A/members');
  await assertSucceeds(getDocs(query(col, orderBy('nameLower'), where('nameLower', '>=', 'ade'), where('nameLower', '<=', 'ade\uf8ff'), limit(20))));
  await assertSucceeds(getDocs(query(col, where('phoneDigits', '==', '080'), limit(20))));
  await assertFails(getDocs(query(collection(as.adminB(), 'parishes/A/members'), limit(20))));
});
test('finance validation: amount must be a positive number, fields fixed', async () => {
  const r = (id) => doc(as.adminA(), 'parishes/A/finances/' + id);
  await assertFails(setDoc(r('x1'), { ...fin, amount: -50 }));
  await assertFails(setDoc(r('x2'), { ...fin, amount: 0 }));
  await assertFails(setDoc(r('x3'), { ...fin, amount: '5000' }));
  await assertFails(setDoc(r('x4'), { ...fin, amount: 1e12 }));
  await assertFails(setDoc(r('x5'), { ...fin, transactionDate: 'yesterday' }));
  await assertFails(setDoc(r('x6'), { ...fin, contributorName: '' }));
  await assertFails(setDoc(r('x7'), { ...fin, extra: true }));
  await assertSucceeds(setDoc(r('x8'), { ...fin, amount: 2500.5 }));
});
test('attendance validation: whole non-negative headcount, valid date', async () => {
  const r = (id) => doc(as.adminA(), 'parishes/A/attendance/' + id);
  await assertFails(setDoc(r('y1'), { ...att, headcount: -1 }));
  await assertFails(setDoc(r('y2'), { ...att, headcount: 10.5 }));
  await assertFails(setDoc(r('y3'), { ...att, headcount: '100' }));
  await assertFails(setDoc(r('y4'), { ...att, serviceDate: '01/11/2026' }));
  await assertFails(setDoc(r('y5'), { ...att, serviceType: '' }));
  await assertSucceeds(setDoc(r('y6'), { ...att, headcount: 0 }));
});
test('super admin approves a pilot parish in one batch', async () => {
  const db = as.superA();
  const b = writeBatch(db);
  b.set(doc(db, 'parishes/uX'), { name: 'Pilot', status: 'Approved' });
  b.set(doc(db, 'users/uX'), { role: 'parish_admin', parishId: 'uX' });
  b.set(doc(db, 'parishStats/uX'), { memberCount: 0, attendanceTotal: 0, serviceCount: 0, financeTotal: 0, financeCount: 0 });
  b.update(doc(db, 'parishRequests/uX'), { status: 'Approved' });
  await assertSucceeds(b.commit());
  await assertSucceeds(setDoc(doc(as.noRole(), 'parishes/uX/members/p1'), member));
});
test('hq and parish admins cannot approve parishes', async () => {
  await assertFails(updateDoc(doc(as.hq(), 'parishRequests/uX'), { status: 'Approved' }));
  await assertFails(setDoc(doc(as.hq(), 'parishes/uX'), { name: 'Pilot', status: 'Approved' }));
  await assertFails(setDoc(doc(as.noRole(), 'users/uX'), { role: 'parish_admin', parishId: 'uX' }));
});
