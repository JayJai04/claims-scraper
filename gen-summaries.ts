import { getDb, listClaims, getFullClaim, updateClaimSummary } from './src/lib/db.ts';
import { summarizeClaim } from './src/lib/gemini.ts';

const DELAY_MS = 4000;
const LIMIT = 5;

async function main() {
  getDb();
  const rows = listClaims().slice(0, LIMIT);
  console.log('Processing', rows.length, 'claims');
  let success = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.summary) {
      console.log('SKIP', row.claim_id, '(already has summary)');
      continue;
    }
    const full = getFullClaim(row.claim_id);
    if (!full) {
      console.log('FAIL', row.claim_id, ': claim not found');
      failed++;
      continue;
    }
    try {
      const summary = await summarizeClaim(full);
      updateClaimSummary(row.claim_id, summary);
      success++;
      console.log('OK', row.claim_id);
    } catch (e) {
      console.log('FAIL', row.claim_id, ':', e instanceof Error ? e.message.slice(0, 100) : String(e));
      failed++;
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  console.log(`Done: ${success} success, ${failed} failed`);
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
