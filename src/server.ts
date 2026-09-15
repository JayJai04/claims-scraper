import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb, getFullClaim, listClaims, updateClaimSummary, updateDocumentSummary, buildDummyDocumentSummary } from './lib/db.js';
import { summarizeClaim, summarizeAllClaims } from './lib/gemini.js';
import type { FullClaim } from './types/claim.js';

const PORT = 3000;

export function buildDummySummary(full: FullClaim): string {
  const c = full.claim;
  const payTotal = full.payments.reduce((s, p) => s + (p.amount ?? 0), 0);
  const latestNote = full.notes.length ? full.notes[full.notes.length - 1].narrative ?? 'n/a' : 'n/a';
  return (
    `Claim ${c.claim_id} for ${c.claimant_name ?? 'unknown'} (${c.policy_number ?? 'no policy'}) ` +
    `filed ${c.date_filed ?? 'unknown date'} is ${c.status ?? 'unknown status'}. ` +
    `${c.description ?? ''} Total payments $${payTotal.toFixed(2)} across ${full.payments.length} payment(s), ` +
    `${full.notes.length} note(s), ${full.documents.length} document(s), ${full.requirements.length} requirement(s). ` +
    `Latest note: ${latestNote}`
  );
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/api/claims') {
    if (req.method === 'POST') {
      const rows = listClaims();
      const results = await summarizeAllClaims(rows);
      return json(res, { results });
    }
    return json(res, listClaims());
  }

  const docMatch = url.pathname.match(/^\/api\/documents\/(\d+)\/download$/);
  if (docMatch) {
    const row = getDb().prepare('SELECT image_name, download_url FROM raw_documents WHERE id = ?').get(Number(docMatch[1])) as { image_name: string | null; download_url: string | null } | undefined;
    if (!row?.download_url) return json(res, { error: 'document not found' }, 404);
    try {
      const body = await readFile(row.download_url);
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${row.image_name ?? `document-${docMatch[1]}.pdf`}"`,
      });
      return res.end(body);
    } catch {
      return json(res, { error: 'document file missing' }, 404);
    }
  }

  const docDummyMatch = url.pathname.match(/^\/api\/documents\/(\d+)\/summary\/dummy$/);
  if (docDummyMatch && req.method === 'POST') {
    const db = getDb();
    const row = db.prepare('SELECT * FROM raw_documents WHERE id = ?').get(decodeURIComponent(docDummyMatch[1])) as (import('./types/claim.js').RawDocument & { id: number }) | undefined;
    if (!row) return json(res, { error: 'document not found' }, 404);
    const summary = buildDummyDocumentSummary(row);
    updateDocumentSummary(row.id, summary);
    return json(res, { id: row.id, summary });
  }

  const dummyMatch = url.pathname.match(/^\/api\/claims\/(.+)\/summary\/dummy$/);
  if (dummyMatch && req.method === 'POST') {
    const claimId = decodeURIComponent(dummyMatch[1]);
    const full = getFullClaim(claimId);
    if (!full) return json(res, { error: 'claim not found' }, 404);
    const summary = buildDummySummary(full as FullClaim);
    updateClaimSummary(claimId, summary);
    return json(res, { claim_id: claimId, summary });
  }

  const summaryMatch = url.pathname.match(/^\/api\/claims\/(.+)\/summary$/);
  if (summaryMatch && req.method === 'POST') {
    const claimId = decodeURIComponent(summaryMatch[1]);
    const full = getFullClaim(claimId);
    if (!full) return json(res, { error: 'claim not found' }, 404);
    try {
      const summary = await summarizeClaim(full);
      updateClaimSummary(claimId, summary);
      return json(res, { claim_id: claimId, summary });
    } catch (e) {
      return json(res, { error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  const match = url.pathname.match(/^\/api\/claims\/(.+)$/);
  if (match) {
    const full = getFullClaim(decodeURIComponent(match[1]));
    if (!full) return json(res, { error: 'not found' }, 404);
    return json(res, full);
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    try {
      const html = await readFile(join(__dirname, 'ui.html'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html);
    } catch {
      return json(res, { error: 'ui.html missing' }, 404);
    }
  }

  return json(res, { error: 'not found' }, 404);
});

getDb();
server.listen(PORT, () => console.log(`Claims UI: http://localhost:${PORT}`));
