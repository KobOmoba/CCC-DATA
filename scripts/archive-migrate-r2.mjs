// Batch 18b: move Archive items kept in DEMO storage (Firestore chunks) to Cloudflare R2, once R2 is switched on.
//
// NOT TESTED against the live project. Read it, run it in dry-run first, and keep a Firestore export before --apply.
//
// What it does, per archive doc with storage == "firestore":
//   1. reads archive/{id}/chunks/*, joins each page's parts back into a JPEG;
//   2. one page  -> uploads that JPEG;  several pages (a PDF kept as pictures) -> builds one PDF from the pages (pdf-lib);
//   3. puts it in the R2 bucket with `wrangler r2 object put` under the same key shape the worker uses
//      (<parishId>/<year>/<uuid>.jpg|pdf);
//   4. updates the doc in ONE batch: storage "r2", fileKey, mime, size, removes chunks/pages, version + 1,
//      plus an auditLog entry "archive-migrate" (archive_{id}_v{n}) like every other archive change.
//   The chunks are LEFT in place as a backup (rules never delete them); remove them by hand later if wanted.
//
// Needs (run on a computer, not the phone):
//   npm i firebase-admin@12 pdf-lib@1.17.1    (in an empty folder)
//   GOOGLE_APPLICATION_CREDENTIALS=<service-account.json>   (never commit it)
//   wrangler logged in to the Cloudflare account that owns the bucket.
// Usage:
//   node archive-migrate-r2.mjs --project <firebase-project-id> [--bucket ccc-archive] [--limit 20]          (dry run)
//   node archive-migrate-r2.mjs --project <firebase-project-id> --apply                                     (writes)
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const PROJECT = arg('project'), BUCKET = arg('bucket', 'ccc-archive'), LIMIT = +arg('limit', 500);
if (!PROJECT) { console.error('Give --project <firebase-project-id>'); process.exit(2); }
if (process.env.FIRESTORE_EMULATOR_HOST) console.log('Using the emulator at', process.env.FIRESTORE_EMULATOR_HOST);

const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
initializeApp({ credential: applicationDefault(), projectId: PROJECT });
const db = getFirestore();

async function pagesOf(id) {
  const s = await db.collection('archive').doc(id).collection('chunks').get();
  const parts = s.docs.map(d => ({ n: +d.id, ...d.data() })).sort((a, b) => a.n - b.n), pages = [];
  for (const c of parts) (pages[c.page] ||= []).push(Buffer.from(c.data));
  return pages.filter(Boolean).map(p => Buffer.concat(p));
}
async function toPdf(jpegs) {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  for (const j of jpegs) { const img = await pdf.embedJpg(j); pdf.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0, width: img.width, height: img.height }); }
  return Buffer.from(await pdf.save());
}

const snap = await db.collection('archive').where('storage', '==', 'firestore').limit(LIMIT).get();
console.log(`${snap.size} demo item(s) found. ${APPLY ? 'APPLYING.' : 'Dry run (add --apply to write).'}`);
const tmp = mkdtempSync(join(tmpdir(), 'ccc-arch-'));
let moved = 0, failed = 0;
try {
  for (const d of snap.docs) {
    const a = d.data(), id = d.id;
    try {
      const pages = await pagesOf(id);
      if (pages.length !== a.pages) throw new Error(`expected ${a.pages} page(s), found ${pages.length}`);
      const isPdf = pages.length > 1 || a.mime === 'application/pdf';
      const body = isPdf ? await toPdf(pages) : pages[0];
      const mime = isPdf ? 'application/pdf' : 'image/jpeg';
      const year = String((a.createdAt || '').slice(0, 4)).match(/^\d{4}$/) ? a.createdAt.slice(0, 4) : String(new Date().getUTCFullYear());
      const key = `${a.parishId}/${year}/${randomUUID()}.${isPdf ? 'pdf' : 'jpg'}`;
      console.log(`${id}: ${a.title} -> ${key} (${pages.length} page(s), ${body.length} bytes)`);
      if (!APPLY) continue;
      const f = join(tmp, id + (isPdf ? '.pdf' : '.jpg'));
      writeFileSync(f, body);
      execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', f, '--content-type', mime, '--remote'], { stdio: 'inherit' });
      const v = (a.version || 1) + 1, now = new Date().toISOString(), b = db.batch();
      b.update(d.ref, { storage: 'r2', fileKey: key, mime, size: body.length, chunks: FieldValue.delete(), pages: FieldValue.delete(),
        version: v, updatedAt: now, updatedBy: 'migration' });
      b.set(db.collection('auditLog').doc(`archive_${id}_v${v}`), { action: 'archive-migrate', target: 'archive/' + id, targetVersion: v,
        parishId: a.parishId, reason: 'Demo storage moved to R2', before: { storage: 'firestore', pages: a.pages }, after: { storage: 'r2', fileKey: key },
        by: 'migration', byEmail: '', byName: 'Archive migration script', role: 'system', at: FieldValue.serverTimestamp() });
      await b.commit();
      moved++;
    } catch (e) { failed++; console.error(`${id}: NOT moved - ${e.message}`); }
  }
} finally { rmSync(tmp, { recursive: true, force: true }); }
console.log(`Done. ${APPLY ? `Moved ${moved}` : 'Would move ' + (snap.size - failed)}, failed ${failed}.`);
