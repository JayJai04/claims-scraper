import type { FullClaim } from '../types/claim.js';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.6-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent?key=${API_KEY}`;

const RETRYABLE_STATUS = new Set([429, 503]);

const MAX_RETRIES = 10;

export function buildPrompt(full: FullClaim): string {
  const c = full.claim;
  const notes = full.notes.map((n) => `[${n.entry_datetime}] ${n.entered_by}: ${n.narrative}`).join('\n');
  const docs = full.documents
    .map((d) => `${d.document_date} | ${d.category} | ${d.image_name} (${d.pages} pages)`)
    .join('\n');
  const payments = full.payments.map((p) => `${p.transaction_date} | ${p.payment_type} | ${p.payee} | ${p.status} | $${p.amount}`).join('\n');
  const reqs = full.requirements
    .map((r) => `${r.created} | due ${r.due_date} | ${r.requirement} | ${r.activity_status}`)
    .join('\n');
  return `You are an insurance claims analyst. Summarize this claim concisely (3-5 sentences).
Highlight the loss type, key dates, total payments, claimant, and current status.

Claim ID: ${c.claim_id}
Policy: ${c.policy_number ?? ''}
Claimant: ${c.claimant_name ?? ''}
Date filed: ${c.date_filed ?? ''}
Status: ${c.status ?? ''}
Amount: ${c.amount ?? ''}
Description: ${c.description ?? ''}
Notes:
${notes}
Documents:
${docs}
Payments:
${payments}
Requirements:
${reqs}`;
}

export interface GeminiError extends Error {
  status?: number;
}

export async function summarizeClaim(full: FullClaim): Promise<string> {
  if (!API_KEY) {
    throw new Error('GEMINI_API_KEY env var not set');
  }
  const prompt = buildPrompt(full);
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '[No summary generated]';
    }
    const bodyText = await res.text().catch(() => '');
    if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_RETRIES) {
      const err: GeminiError = new Error(`Gemini API error: ${res.status}`);
      err.status = res.status;
      err.message += ` ${bodyText.slice(0, 500)}`;
      throw err;
    }
    const retryMatch = bodyText.match(/retry in\s+([\d.]+)s/iu);
    const parsedWait = retryMatch ? parseFloat(retryMatch[1]) : null;
    const wait = (parsedWait ?? 30) * 1000;
    console.warn(`  429, waiting ${(wait / 1000).toFixed(0)}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error('Unreachable');
}

export async function summarizeClaimById(claimId: string): Promise<string> {
  const { getFullClaim } = await import('./db.js');
  const full = getFullClaim(claimId);
  if (!full) throw new Error(`Claim not found: ${claimId}`);
  return summarizeClaim(full);
}

export async function summarizeAllClaims(rows: Awaited<ReturnType<typeof import('./db.js').listClaims>>): Promise<Array<{ claim_id: string; summary: string | null; error?: string }>> {
  const { updateClaimSummary } = await import('./db.js');
  const out: Array<{ claim_id: string; summary: string | null; error?: string }> = [];
  for (const row of rows) {
    try {
      if (row.summary) {
        out.push({ claim_id: row.claim_id, summary: row.summary });
        continue;
      }
      const summary = await summarizeClaimById(row.claim_id);
      updateClaimSummary(row.claim_id, summary);
      out.push({ claim_id: row.claim_id, summary });
    } catch (e) {
      out.push({ claim_id: row.claim_id, summary: row.summary, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
