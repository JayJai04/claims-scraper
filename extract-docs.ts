import { readFile, readdir } from 'node:fs/promises';
import { getDb } from './src/lib/db.ts';

async function extractText(path: string): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = await readFile(path);
  const doc = await getDocument({ data: new Uint8Array(data) }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it: unknown) => ('str' in (it as object) ? (it as { str: string }).str : '')).join(' ') + '\n';
  }
  await doc.cleanup();
  return text.replace(/\s+/g, ' ').trim();
}

async function main() {
  getDb();
  const db = getDb();
  const docs = db.prepare('SELECT id, claim_id, image_name FROM raw_documents').all() as Array<{
    id: number; claim_id: string; image_name: string | null;
  }>;
  const files = await readdir('/tmp/docs');
  let ok = 0;
  for (const d of docs) {
    const f = files.find((x) => x.startsWith(`${d.id}-`));
    if (!f) { console.log('MISSING FILE', d.id, d.image_name); continue; }
    try {
      const text = await extractText(`/tmp/docs/${f}`);
      db.prepare('UPDATE raw_documents SET summary = ? WHERE id = ?').run(`[RAW TEXT, needs summary] ${text}`, d.id);
      ok++;
      if (ok % 10 === 0) console.log(`progress: ${ok}/${docs.length}`);
    } catch (e) {
      console.log('FAIL', d.id, e instanceof Error ? e.message : String(e));
    }
  }
  console.log(`done: ${ok} extracted`);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
