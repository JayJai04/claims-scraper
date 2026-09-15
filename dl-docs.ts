import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { getDb } from './src/lib/db.ts';
import { login } from './src/lib/auth.ts';

async function main() {
  await mkdir('/tmp/docs', { recursive: true });
  getDb();
  const db = getDb();
  const docs = db.prepare('SELECT id, claim_id, image_name, download_url FROM raw_documents').all() as Array<{
    id: number; claim_id: string; image_name: string | null; download_url: string | null;
  }>;
  console.log('total docs:', docs.length);

  const { page, close } = await login();
  const storage = await page.context().storageState();
  await close();
  const { chromium } = await import('playwright');
  const b2 = await chromium.launch({ headless: true });
  const ctx = await b2.newContext({ storageState: storage });

  let ok = 0;
  let failed = 0;
  for (const d of docs) {
    if (!d.download_url) { failed++; continue; }
    try {
      const docId = d.download_url.match(/\/documents\/([^/]+)\/download/)?.[1];
      if (!docId) { failed++; continue; }
      const apiRes = await ctx.request.get(`https://docura-technical-screen.vercel.app/api/documents/${docId}/download`);
      if (!apiRes.ok()) { console.log('FAIL', d.id, d.image_name, apiRes.status()); failed++; continue; }
      const body = await apiRes.body();
      const path = `/tmp/docs/${d.id}-${d.image_name ?? docId + '.pdf'}`;
      await writeFile(path, body);
      db.prepare('UPDATE raw_documents SET download_url = ? WHERE id = ?').run(path, d.id);
      ok++;
      if (ok % 10 === 0) console.log(`progress: ${ok}/${docs.length}`);
    } catch (e) {
      console.log('FAIL', d.id, d.image_name, e instanceof Error ? e.message : String(e));
      failed++;
    }
  }
  console.log(`done: ${ok} ok, ${failed} failed`);
  await b2.close();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
