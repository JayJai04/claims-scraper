import type { Page } from 'playwright';
import type {
  FullClaim,
  ParserOptions,
  RawClaim,
  RawDocument,
  RawNote,
  RawPayment,
  RawRequirement,
} from '../types/claim.js';

const DEFAULT_TABLE_SELECTOR = 'table';

const DEFAULT_HEADER_MAPPING: Record<string, keyof RawClaim> = {
  'claim id': 'claim_id',
  'claim number': 'claim_id',
  'claim no.': 'claim_id',
  'claim no': 'claim_id',
  'claim file': 'claim_id',
  'policy number': 'policy_number',
  'policy': 'policy_number',
  'claimant name': 'claimant_name',
  'claimant': 'claimant_name',
  'date filed': 'date_filed',
  'filed date': 'date_filed',
  'date reported': 'date_filed',
  'date of loss': 'date_filed',
  'loss status': 'status',
  'status': 'status',
  'amount': 'amount',
  'loss description': 'description',
  'description': 'description',
};

export function normalizeHeader(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function normalizeDate(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const mdy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0].slice(0, 10);
  const parsed = Date.parse(t);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

export function normalizeAmount(text: string): number | null {
  const t = text.replace(/[$,]/g, '').trim();
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isNaN(n) ? null : n;
}

function emptyClaim(): RawClaim {
  return {
    claim_id: '',
    policy_number: null,
    claimant_name: null,
    date_filed: null,
    status: null,
    amount: null,
    description: null,
  };
}

export function mapDetailToClaim(
  fields: Record<string, string>,
  headerMapping: Record<string, keyof RawClaim> = DEFAULT_HEADER_MAPPING,
): RawClaim | null {
  const claim = emptyClaim();
  let found = false;
  for (const [label, value] of Object.entries(fields)) {
    const field = headerMapping[normalizeHeader(label)];
    if (!field) continue;
    found = true;
    if (field === 'date_filed') claim[field] = normalizeDate(value);
    else if (field === 'amount') claim[field] = normalizeAmount(value);
    else if (field === 'claim_id') claim[field] = value.trim();
    else claim[field] = value.trim() || null;
  }
  if (!found || !claim.claim_id) return null;
  return claim;
}

async function extractLabelValuePairs(page: Page, container: string): Promise<Record<string, string>> {
  return page.$$eval(
    [
      `${container} dl dt`,
      `${container} .claim-banner div`,
      `${container} .sub-panel`,
      `${container} [data-field]`,
    ].join(', '),
    (nodes) => {
      const out: Record<string, string> = {};
      for (const node of nodes) {
        const el = node as HTMLElement;
        if (el.hasAttribute('data-field')) {
          out[el.getAttribute('data-field')!] = (el.textContent || '').trim();
          continue;
        }
        if (el.tagName === 'DT') {
          const dd = el.nextElementSibling;
          if (dd && dd.tagName === 'DD') {
            out[(el.textContent || '').trim()] = (dd.textContent || '').trim();
          }
          continue;
        }
        if (el.classList.contains('sub-panel')) {
          const h = el.querySelector('h3, h2, h4');
          const p = el.querySelector('p');
          if (h && p) out[(h.textContent || '').trim()] = (p.textContent || '').trim();
          continue;
        }
        const small = el.querySelector('small');
        const b = el.querySelector('b');
        if (small && b) {
          out[(small.textContent || '').trim()] = (b.textContent || '').trim();
        }
      }
      return out;
    },
  );
}

export async function parseSingleClaimFromPage(page: Page, options: ParserOptions = {}): Promise<RawClaim> {
  const detailSelector = options.detailSelector ?? 'main';
  const mapping = { ...DEFAULT_HEADER_MAPPING, ...options.headerMapping };
  await page.waitForSelector(detailSelector, { timeout: 10000 }).catch(() => {
    throw new Error(`Claim detail not found (selector "${detailSelector}" missing)`);
  });
  await page.waitForSelector('.detail-panel, .claim-banner, .field-grid', { timeout: 15000 }).catch(() => {
    throw new Error('Claim detail page did not finish loading (still showing loading state?)');
  });
  const fields = await extractLabelValuePairs(page, detailSelector);
  const claim = mapDetailToClaim(fields, mapping);
  if (!claim) {
    throw new Error('Claim detail found but no recognizable fields extracted');
  }
  return claim;
}

export async function collectClaimUrls(page: Page, options: ParserOptions = {}): Promise<string[]> {
  const tableSelector = options.tableSelector ?? DEFAULT_TABLE_SELECTOR;
  await page.waitForSelector(tableSelector, { timeout: 10000 }).catch(() => {
    throw new Error(`Claims table not found (selector "${tableSelector}" missing)`);
  });
  await page.waitForTimeout(2500);
  const seen = new Set<string>();
  const urls: string[] = [];
  for (;;) {
    const hrefs = await page.$$eval(
      `${tableSelector} tbody tr td a[href]`,
      (as) => (as as HTMLAnchorElement[]).map((a) => a.getAttribute('href') || '').filter(Boolean),
    );
    for (const href of hrefs) {
      try {
        const url = new URL(href, page.url()).toString();
        if (url.includes('/claims/') && !seen.has(url)) {
          seen.add(url);
          urls.push(url);
        }
      } catch {
        continue;
      }
    }
    const nextBtn = page.locator('.results-panel .pager button', { hasText: 'Next' });
    if ((await nextBtn.count()) === 0 || (await nextBtn.isDisabled())) break;
    const firstHrefBefore = hrefs[0] ?? '';
    await nextBtn.click();
    await page
      .waitForFunction(
        (prev) => {
          const a = document.querySelector('.results-panel tbody tr td a[href]');
          return a && a.getAttribute('href') !== prev;
        },
        firstHrefBefore,
        { timeout: 10000 },
      )
      .catch(() => {});
    await page.waitForTimeout(1000);
  }
  return urls;
}

export interface ParseAllResult {
  claims: RawClaim[];
  errors: { url: string; error: string }[];
}

type TabName = 'Claim Summary' | 'Notes' | 'Documents' | 'Payments' | 'Requirements';

async function clickTab(page: Page, tab: TabName): Promise<void> {
  await page.locator('nav.tabs button', { hasText: tab }).click();
  await page.waitForTimeout(1500);
}

function textOrNull(cells: string[], i: number): string | null {
  const t = (cells[i] ?? '').trim();
  return t || null;
}

function parsePages(text: string): number | null {
  const n = parseInt(text.trim(), 10);
  return Number.isNaN(n) ? null : n;
}

export async function parseNotesTab(page: Page, claimId: string): Promise<RawNote[]> {
  await clickTab(page, 'Notes');
  const rows = await page.locator('table.data-table tbody tr').all();
  const notes: RawNote[] = [];
  for (const row of rows) {
    const cells = await row.locator('td').allInnerTexts();
    if (cells.every((c) => !c.trim())) continue;
    notes.push({
      claim_id: claimId,
      entry_datetime: textOrNull(cells, 0),
      entered_by: textOrNull(cells, 1),
      narrative: textOrNull(cells, 2),
    });
  }
  return notes;
}

export async function parseDocumentsTab(page: Page, claimId: string): Promise<RawDocument[]> {
  await clickTab(page, 'Documents');
  const rows = await page.locator('table.data-table tbody tr').all();
  const docs: RawDocument[] = [];
  for (const row of rows) {
    const cells = await row.locator('td').allInnerTexts();
    if (cells.every((c) => !c.trim())) continue;
    const href = await row.locator('td a[href]').getAttribute('href').catch(() => null);
    docs.push({
      claim_id: claimId,
      document_date: normalizeDate(cells[0] ?? '') ?? textOrNull(cells, 0),
      category: textOrNull(cells, 1),
      image_name: textOrNull(cells, 2),
      pages: parsePages(cells[3] ?? ''),
      download_url: href ? new URL(href, page.url()).toString() : null,
    });
  }
  return docs;
}

export async function parsePaymentsTab(page: Page, claimId: string): Promise<RawPayment[]> {
  await clickTab(page, 'Payments');
  const rows = await page.locator('table.data-table tbody tr').all();
  const payments: RawPayment[] = [];
  for (const row of rows) {
    const cells = await row.locator('td').allInnerTexts();
    if (cells.every((c) => !c.trim())) continue;
    payments.push({
      claim_id: claimId,
      transaction_date: normalizeDate(cells[0] ?? '') ?? textOrNull(cells, 0),
      payment_type: textOrNull(cells, 1),
      payee: textOrNull(cells, 2),
      status: textOrNull(cells, 3),
      amount: normalizeAmount(cells[4] ?? ''),
    });
  }
  return payments;
}

export async function parseRequirementsTab(page: Page, claimId: string): Promise<RawRequirement[]> {
  await clickTab(page, 'Requirements');
  const rows = await page.locator('table.data-table tbody tr').all();
  const reqs: RawRequirement[] = [];
  for (const row of rows) {
    const cells = await row.locator('td').allInnerTexts();
    if (cells.every((c) => !c.trim())) continue;
    reqs.push({
      claim_id: claimId,
      created: normalizeDate(cells[0] ?? '') ?? textOrNull(cells, 0),
      due_date: normalizeDate(cells[1] ?? '') ?? textOrNull(cells, 1),
      requirement: textOrNull(cells, 2),
      activity_status: textOrNull(cells, 3),
    });
  }
  return reqs;
}

export async function parseFullClaimFromPage(page: Page, options: ParserOptions = {}): Promise<FullClaim> {
  const claim = await parseSingleClaimFromPage(page, options);
  const claimId = claim.claim_id;
  const notes = await parseNotesTab(page, claimId).catch(() => [] as RawNote[]);
  const documents = await parseDocumentsTab(page, claimId).catch(() => [] as RawDocument[]);
  const payments = await parsePaymentsTab(page, claimId).catch(() => [] as RawPayment[]);
  const requirements = await parseRequirementsTab(page, claimId).catch(() => [] as RawRequirement[]);
  const amounts = payments.map((p) => p.amount).filter((a): a is number => a !== null);
  if (claim.amount === null && amounts.length > 0) {
    claim.amount = amounts.reduce((sum, a) => sum + a, 0);
  }
  return { claim, notes, documents, payments, requirements };
}

export interface ParseAllFullResult {
  fullClaims: FullClaim[];
  errors: { url: string; error: string }[];
}

export async function parseAllFullClaimsFromPage(
  page: Page,
  options: ParserOptions = {},
): Promise<ParseAllFullResult> {
  const urls = await collectClaimUrls(page, options);
  const fullClaims: FullClaim[] = [];
  const errors: { url: string; error: string }[] = [];
  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      fullClaims.push(await parseFullClaimFromPage(page, options));
    } catch (err) {
      errors.push({ url, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { fullClaims, errors };
}

export async function parseAllClaimsFromPage(page: Page, options: ParserOptions = {}): Promise<ParseAllResult> {
  const urls = await collectClaimUrls(page, options);
  const claims: RawClaim[] = [];
  const errors: { url: string; error: string }[] = [];
  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      claims.push(await parseSingleClaimFromPage(page, options));
    } catch (err) {
      errors.push({ url, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { claims, errors };
}
