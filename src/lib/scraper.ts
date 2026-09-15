import { createHash } from 'node:crypto';
import { login } from './auth.js';
import {
  collectClaimUrls,
  parseAllClaimsFromPage,
  parseAllFullClaimsFromPage,
  parseFullClaimFromPage,
  parseSingleClaimFromPage,
} from './parser.js';
import type { FullClaim, ParserOptions, RawClaim } from '../types/claim.js';

export function hashClaim(claim: RawClaim): string {
  return createHash('sha256')
    .update([claim.claim_id, claim.policy_number, claim.date_filed, claim.amount].join('|'))
    .digest('hex');
}

async function gotoClaimTarget(
  page: import('playwright').Page,
  target: { rowIndex?: number; claimId?: string } | undefined,
  options: ParserOptions,
): Promise<void> {
  if (target?.claimId && target.rowIndex === undefined) {
    const urls = await collectClaimUrls(page, options);
    const match = urls.find((u) => u.includes(target.claimId!));
    if (!match) throw new Error(`No claim link found containing "${target.claimId}"`);
    await page.goto(match, { waitUntil: 'domcontentloaded' });
  } else {
    const rowIndex = target?.rowIndex ?? 0;
    const tableSelector = options.tableSelector ?? 'table';
    const href = await page
      .locator(`${tableSelector} tbody tr a[href], ${tableSelector} a[href]`)
      .nth(rowIndex)
      .getAttribute('href')
      .catch(() => null);
    if (!href) throw new Error(`No claim link found at row index ${rowIndex}`);
    await page.goto(new URL(href, page.url()).toString(), { waitUntil: 'domcontentloaded' });
  }
}

export async function scrapeSingleClaim(
  target?: { rowIndex?: number; claimId?: string },
  options: ParserOptions = {},
): Promise<RawClaim> {
  const { page, close } = await login();
  try {
    await gotoClaimTarget(page, target, options);
    return await parseSingleClaimFromPage(page, options);
  } finally {
    await close();
  }
}

export async function scrapeFullClaim(
  target?: { rowIndex?: number; claimId?: string },
  options: ParserOptions = {},
): Promise<FullClaim> {
  const { page, close } = await login();
  try {
    await gotoClaimTarget(page, target, options);
    return await parseFullClaimFromPage(page, options);
  } finally {
    await close();
  }
}

export async function scrapeAllClaims(options: ParserOptions = {}): Promise<RawClaim[]> {
  const { page, close } = await login();
  try {
    const { claims, errors } = await parseAllClaimsFromPage(page, options);
    for (const e of errors) console.warn(`Skipped ${e.url}: ${e.error}`);
    return claims;
  } finally {
    await close();
  }
}

export async function scrapeAllFullClaims(options: ParserOptions = {}): Promise<FullClaim[]> {
  const { page, close } = await login();
  try {
    const { fullClaims, errors } = await parseAllFullClaimsFromPage(page, options);
    for (const e of errors) console.warn(`Skipped ${e.url}: ${e.error}`);
    return fullClaims;
  } finally {
    await close();
  }
}

export async function scrapeToInsert(
  options: ParserOptions = {},
): Promise<{ claims: RawClaim[]; hashes: string[] }> {
  const claims = await scrapeAllClaims(options);
  return { claims, hashes: claims.map(hashClaim) };
}
