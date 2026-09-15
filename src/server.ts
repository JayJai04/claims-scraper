import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb, getFullClaim, listClaims, updateClaimSummary } from './lib/db.js';
import { login } from './lib/auth.js';
import { summarizeClaim, summarizeAllClaims } from './lib/gemini.js';

const PORT = 3000;

async function getAuthedContext() {
  const { browser, page, close } = await login();
  const storage = await page.context().storageState();
  await close();
  const { chromium } = await import('playwright');
  const b2 = await chromium.launch({ headless: true });
  const ctx = await b2.newContext({ storageState: storage });
  return { ctx, close: () => b2.close() };
}

let docCtx: Awaited<ReturnType<typeof getAuthedContext>> | null = null;

async function proxyDocument(res: ServerResponse, docId: string): Promise<void> {
  try {
    if (!docCtx) docCtx = await getAuthedContext();
    const apiReq = docCtx.ctx.request;
    let apiRes = await apiReq.get(`https://docura-technical-screen.vercel.app/api/documents/${docId}/download`);
    if (apiRes.status() === 401) {
      await docCtx.close();
      docCtx = null;
      return proxyDocument(res, docId);
    }
    if (!apiRes.ok()) {
      res.writeHead(apiRes.status(), { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `document fetch failed: ${apiRes.status()}` }));
      return;
    }
    const body = await apiRes.body();
    res.writeHead(200, {
      'Content-Type': apiRes.headers()['content-type'] ?? 'application/pdf',
      'Content-Disposition': `inline; filename="${docId}.pdf"`,
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
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

  const docMatch = url.pathname.match(/^\/api\/documents\/(.+)\/download$/);
  if (docMatch) {
    return proxyDocument(res, decodeURIComponent(docMatch[1]));
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
