// Unit tests for the ccc-ai worker helpers and the shared alert core. Run: node --test ai-worker/
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { default: w } = await import('./worker.js');
const A = globalThis.AlertsCore;

test('origins: production + this project\'s Vercel previews only', () => {
  for (const o of ['https://ccc-parish-portal.vercel.app', 'https://kobomoba.github.io', 'https://ccc-parish-portal-git-main-aadesanya173-gmailcoms-projects.vercel.app'])
    assert.ok(w.allowedOrigin(o), o);
  for (const o of ['https://ccc-parish-portal-x-aadesanya173-gmailcoms-projects.vercel.app.evil.com', 'https://evil-ccc-parish-portal-x-aadesanya173-gmailcoms-projects.vercel.app',
    'https://ccc-parish-portal-x-someone-projects.vercel.app', 'http://ccc-parish-portal.vercel.app', 'https://ccc-parish-portal.vercel.app.evil.com'])
    assert.ok(!w.allowedOrigin(o), o);
});
test('summary totals: numbers only, never names', () => {
  const t = w.cleanTotals({ month: 'November 2026', alerts: 3, name: 'Olumide Ajayi', alertsByCountry: { Nigeria: 2, '<b>': 1 }, world: { members: 5, parish: 'Ikeja' } });
  assert.deepEqual(t, { month: 'November 2026', alerts: 3, alertsByCountry: { Nigeria: 2 }, world: { members: 5 } });
});
test('alerts core: returns gap, membership decline, attendance drop, inactive', () => {
  const p = [{ id: 'P', name: 'P', status: 'Approved', createdAt: '2025-01-01' }];
  const gap = A.returnAlerts('2026-10', p, { P: { '2026-08': { income: { tithes: 1 }, attendance: 1, outstanding: 0, currency: 'NGN' } } }, '2026-11-20');
  assert.ok(gap.some(a => a.rule === 'returnsGap'));
  const sn = { P: { '2026-07': { month: '2026-07', attendanceTotal: 0, memberCount: 50 }, '2026-08': { month: '2026-08', attendanceTotal: 400, memberCount: 50 },
    '2026-09': { month: '2026-09', attendanceTotal: 800, memberCount: 50 }, '2026-10': { month: '2026-10', attendanceTotal: 900, memberCount: 45 },
    '2026-11': { month: '2026-11', attendanceTotal: 950, memberCount: 40, lastActive: '2026-09-01' } } };
  assert.deepEqual(A.statsAlerts('2026-11', p, sn, '2026-11-20').map(a => a.rule).sort(), ['attendanceDrop', 'inactive', 'memberDecline']);
  sn.P['2026-11'].lastActive = '2026-11-19';
  assert.ok(!A.statsAlerts('2026-11', p, sn, '2026-11-20').some(a => a.rule === 'inactive'));
});
