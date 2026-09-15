# Parser & Scraper Modules (Playwright) — Single Claim First

## Overview
Two phases, in order:
- **Phase A — one claim, full depth:** pick a single claim, extract every field
  available for it, and lock down selectors + normalization.
- **Phase B — all claims:** reuse the Phase A extraction logic in a loop over
  every claim in the list.

Nothing in Phase B starts until Phase A output is verified against the live page.

1. `login()` from `src/lib/auth.ts` returns an authenticated `Page` already on `/claims`
2. Phase A: follow one claim's link to its detail URL, extract all its data via Playwright locators
3. Phase B: collect every row's detail URL first, then visit each and repeat the Phase A extraction, return `RawClaim[]`

## Current State
- `src/lib/auth.ts` uses Playwright (`chromium.launch({ headless: true })`)
- `login()` returns `{ browser, page, close }`, already navigated to `/claims`
- `package.json` has `playwright`, plus leftover `node-fetch` / `tough-cookie` from the old approach
- No `parser.ts`, `scraper.ts`, or `src/types/claim.ts` yet
- Claims list renders as an HTML table (confirmed by user)
- Clicking a claim navigates to a separate detail URL (confirmed by user).
  Step 0 records the exact route pattern (expected `/claims/:id`-style).

## Module Design

### 1. `src/types/claim.ts` — Shared types

```typescript
export interface RawClaim {
  claim_id: string;
  policy_number: string | null;
  claimant_name: string | null;
  date_filed: string | null;
  status: string | null;
  amount: number | null;
  description: string | null;
}

export interface ParserOptions {
  tableSelector?: string;
  detailSelector?: string;
  headerMapping?: Record<string, keyof RawClaim>;
}
```

`RawClaim` stays fixed across both phases — Phase A must fill every field it can,
Phase B reuses the same shape.

### 2. `src/lib/parser.ts` — DOM extraction via Page

**Responsibility:** Given an authenticated Playwright `Page`, extract one claim's
full data (Phase A), then expose the list-level helper that reuses it (Phase B).

**Phase A functions:**
- `parseSingleClaimFromPage(page: Page, options?: ParserOptions): Promise<RawClaim>`
  - Assumes `page` is already on a claim detail URL (reached via row link from `/claims`)
  - Extract every visible field for that claim, mapped to `RawClaim`
  - Throw a clear error naming the missing selector if the detail view isn't found
- `normalizeDate(text: string): string | null` — MM/DD/YYYY → ISO, fallback `null`
- `normalizeAmount(text: string): number | null` — strip `$`, `,`, fallback `null`
- `normalizeHeader(text: string): string` — lowercase, trim, collapse whitespace
  (used in Phase B for table column mapping)

**Phase B function (built on Phase A, not before it):**
- `parseAllClaimsFromPage(page: Page, options?: ParserOptions): Promise<RawClaim[]>`
  - From the claims table, collect every row's detail URL (`href`) **first**
    (avoids stale locators after navigation)
  - For each URL: `page.goto(url)` → call the Phase A extractor → next URL
    (no back-navigation needed since each claim is a direct URL visit)
  - Per-claim failures are collected and reported, not fatal to the whole run
    (return `{ claims, errors }` or throw an aggregate — decide in implementation,
    note the choice in the plan)

**Default selectors (placeholders until Step 0 confirms):**
```typescript
const DEFAULTS = {
  tableSelector: 'table',
  detailSelector: '[data-claim-detail]',
  headerMapping: {
    'claim id': 'claim_id',
    'policy number': 'policy_number',
    'claimant name': 'claimant_name',
    'date filed': 'date_filed',
    'status': 'status',
    'amount': 'amount',
    'description': 'description',
  },
};
```

**Implementation note:** Keep row/detail mapping in pure helpers
(e.g. `mapDetailToClaim(fields: Record<string, string>): RawClaim`) so the
mapping logic is unit-testable without a browser. Playwright locators only
collect raw text; Node does the mapping.

### 3. `src/lib/scraper.ts` — Orchestration

**Responsibility:** Own browser lifecycle for both phases.

**Phase A function:**
- `scrapeSingleClaim(target?: { rowIndex?: number; claimId?: string }): Promise<RawClaim>`
  - `login()` → list page (already there post-login)
  - Resolve one detail URL (row link `href` at `rowIndex`, or constructed detail
    URL for `claimId`), `page.goto()` it
  - Call `parseSingleClaimFromPage(page)`, `finally { await close() }`

**Phase B functions (built after Phase A verifies):**
- `scrapeAllClaims(): Promise<RawClaim[]>`
  - Same lifecycle, calls `parseAllClaimsFromPage(page)`
- `scrapeToInsert(): Promise<{ claims: RawClaim[]; hashes: string[] }>`
  - Calls `scrapeAllClaims()`, computes SHA-256 `raw_hash` per claim
    (hash of `claim_id + policy_number + date_filed + amount`) via `node:crypto`

### 4. `src/lib/auth.ts` — Small hardening (no redesign)

- Playwright owns the session; no cookie-jar work needed
- Add explicit failure detection: if still on the login page after submit
  (no navigation to `/claims` within timeout), throw `Login failed`
- Keep return shape `{ browser, page, close }` — parser/scraper depend on it

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Edit | Remove `node-fetch`, `tough-cookie` (unused); keep `playwright` |
| `src/types/claim.ts` | Create | `RawClaim` + `ParserOptions` types |
| `src/lib/parser.ts` | Create | Phase A: `parseSingleClaimFromPage()` + normalizers; Phase B: `parseAllClaimsFromPage()` reusing it |
| `src/lib/scraper.ts` | Create | Phase A: `scrapeSingleClaim()`; Phase B: `scrapeAllClaims()` + `scrapeToInsert()` |
| `src/lib/auth.ts` | Edit | login-failure detection only |

## Implementation Steps

### Step 0: Record the detail route + selectors (live page, read-only)
- Log in via the existing `auth.ts`, dump the claims table HTML
- Record: table selector, row-link `href` pattern (the detail route), and
  whether hrefs are absolute or relative
- Record: detail-page selectors for each `RawClaim` field
- Update `DEFAULTS` in this plan with the real selectors before writing parser code

### Step 1: Clean up deps
```bash
npm uninstall node-fetch tough-cookie
```
No new deps — Playwright is already installed.

### Step 2: Create `src/types/claim.ts`
- `RawClaim` matching the future `raw_claims` table schema
- `ParserOptions` with `tableSelector` + `detailSelector` + `headerMapping`

### Step 3: Harden `src/lib/auth.ts`
- Wrap `waitForURL('**/claims')` with a timeout and catch → throw `Login failed: ...`
- No other changes

### Step 4 (Phase A): Single-claim parser + scraper
- Implement `parseSingleClaimFromPage()` + `mapDetailToClaim()` + normalizers
- Implement `scrapeSingleClaim()` with try/finally browser close
- Verify per Phase A checks below — do not proceed until one claim extracts cleanly

### Step 5 (Phase B): Generalize to all claims
- Implement `parseAllClaimsFromPage()` collecting all detail hrefs up front,
  then `page.goto()` each and reusing the Phase A extractor
  (direct URL visits — no back-button navigation to go stale)
- Implement `scrapeAllClaims()` + `scrapeToInsert()` with `raw_hash`
- Verify per Phase B checks below

## Edge Cases to Handle

| Case | Handling |
|------|----------|
| Bad credentials | `waitForURL` times out → throw `Login failed` |
| Detail view shape differs from assumption | Stop at Step 0 — update selectors, don't guess |
| Row has no link (unexpected) | Log row index + text, skip it in Phase B |
| Table selector missing | Throw `Claims table not found` with selector in message |
| Detail selector missing (Phase A) | Throw `Claim detail not found` with selector in message |
| Empty table (no rows) | Phase B returns `[]` |
| Missing/empty fields | Field → `null` |
| Unrecognized detail label | Ignore it (don't fail on extra fields) |
| Invalid date | Try MM/DD/YYYY → ISO, fallback `null` |
| Currency in amount | Strip `$`, `,` before `parseFloat`, fallback `null` |
| One claim fails in Phase B loop | Record error, continue with remaining claims |
| Back-navigation loses list state | N/A — direct `page.goto()` per detail URL, no back-nav |
| Browser leak on error | `finally { await close() }` always runs |
| Pagination (if any) | Out of scope — visible page only, note if pager detected |

## Verification

**Phase A — single claim:**
1. Run a script calling `scrapeSingleClaim({ rowIndex: 0 })`, log the JSON
   ```bash
   npx tsx -e "import('./src/lib/scraper').then(m => m.scrapeSingleClaim({ rowIndex: 0 }).then(c => console.log(JSON.stringify(c, null, 2))))"
   ```
   (Requires real `SCRAPER_USER_ID` / `SCRAPER_PASSWORD` in `.env.local`)
2. Manually confirm every `RawClaim` field against the live detail view
3. Unit-test `mapDetailToClaim()` with a mock field record (no browser)

**Phase B — all claims:**
1. Run `scrapeAllClaims()`, assert count matches visible table rows and every
   item has `claim_id` populated
2. Spot-check 2–3 claims' full fields against Phase A output quality
3. Confirm no hanging Chromium processes after the script exits

## Notes
- No Cheerio — the DOM is already live in Playwright, so parse there
- Phase A selectors are the foundation; Phase B adds only looping + navigation
- `raw_hash` input is `claim_id + policy_number + date_filed + amount`
- Keep `node-fetch`/`tough-cookie` removal separate from parser logic so the diff is reviewable
