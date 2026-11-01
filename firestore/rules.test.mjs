// CCC Firestore rules tests. Runs against the local Firestore emulator only.
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

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
const member = { fullName: 'Ade Bisi', gender: 'F', phone: '080', address: 'Lagos', dateJoined: '2026-01-01',
  rank: 'Sister', household: 'Bisi family', consentGiven: true, consentDate: '2026-11-01' };

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
    await setDoc(doc(db, 'parishes/A/finances/f1'), { amount: 5000 });
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
  await assertSucceeds(setDoc(doc(as.adminA(), 'parishes/A/attendance/a1'), { headcount: 100 }));
  await assertSucceeds(setDoc(doc(as.adminA(), 'parishes/A/finances/f2'), { amount: 10 }));
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
  await assertSucceeds(setDoc(doc(as.noRole(), 'parishRequests/uX'), { parishName: 'New', email: 'x@y.com', status: 'Pending' }));
  await assertFails(setDoc(doc(as.noRole(), 'parishRequests/uOther'), { parishName: 'New', email: 'x@y.com', status: 'Pending' }));
  await assertFails(setDoc(doc(as.selfPromoter(), 'parishRequests/uP'), { parishName: 'New', email: 'x@y.com', status: 'Approved' }));
});
test('hq reads all parishes, cannot write parish data, can post circulars', async () => {
  await assertSucceeds(getDoc(doc(as.hq(), 'parishes/A')));
  await assertSucceeds(getDoc(doc(as.hq(), 'parishes/B')));
  await assertSucceeds(getDocs(collection(as.hq(), 'parishes/A/members')));
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
