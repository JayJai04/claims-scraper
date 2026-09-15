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

function cleanBoilerplate(text: string): string {
  const m = text.match(/SUBSTANTIVE RECORD\s+(.+?)(?:SOURCE REVIEW NOTES|Synthetic interview record|$)/s);
  const core = (m ? m[1] : text).replace(/\s+/g, ' ').trim();
  return core;
}

function buildParagraph(d: { category: string | null; image_name: string | null; document_date?: string | null; pages?: number | null }, substantive: string): string {
  const parts = [
    `${d.category ?? 'Document'} ${d.image_name ?? ''} (dated ${d.document_date ?? 'unknown date'}, ${d.pages ?? '?'} pages).`,
    substantive.endsWith('.') ? substantive : substantive + '.',
  ];
  return parts.join(' ');
}

async function main() {
  getDb();
  const db = getDb();
  const docs = db.prepare('SELECT id, category, image_name, document_date, pages FROM raw_documents').all() as Array<{
    id: number; category: string | null; image_name: string | null; document_date: string | null; pages: number | null;
  }>;
  const files = await readdir('/tmp/docs');
  let ok = 0;
  for (const d of docs) {
    const f = files.find((x) => x.startsWith(`${d.id}-`));
    if (!f) { console.log('MISSING FILE', d.id); continue; }
    try {
      const raw = await extractText(`/tmp/docs/${f}`);
      const substantive = cleanBoilerplate(raw);
      const para = buildParagraph(d, substantive);
      db.prepare('UPDATE raw_documents SET summary = ? WHERE id = ?').run(para.slice(0, 4000), d.id);
      ok++;
      if (ok % 10 === 0) console.log(`progress: ${ok}/${docs.length}`);
    } catch (e) {
      console.log('FAIL', d.id, e instanceof Error ? e.message : String(e));
    }
  }
  console.log(`done: ${ok} paragraphs written`);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
