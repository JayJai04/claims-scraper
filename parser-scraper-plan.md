# Parser & Scraper Modules

## Overview
Design the `parser.ts` and `scraper.ts` modules that work together to:
1. Fetch the authenticated claims page HTML
2. Parse the claims table into structured data
3. Return raw claim records ready for database insertion

## Current State
- `src/lib/auth.ts` exists but has a bug: it reads cookies from the jar but never saves cookies **back** to it after login
- Dependencies `node-fetch` and `tough-cookie` are installed
- `cheerio` is not yet installed (needed for HTML parsing)

## Module Design

### 1. `src/lib/parser.ts` — DOM Extraction

**Responsibility:** Parse HTML and extract claim records from the table.

**Key selectors (configurable):**
```typescript
const DEFAULT_SELECTORS = {
  table: 'table',
  row: 'tbody tr',
  headers: ['claim_id', 'policy_number', 'claimant_name', 'date_filed', 'status', 'amount'],
};
```

**Functions:**
- `parseClaimsHtml(html: string, selectors?): RawClaim[]` — Main parser
  - Load HTML into Cheerio
  - Find the claims table
  - Extract header row to determine column mapping (flexible)
  - Iterate data rows, extract cell values
  - Return array of `RawClaim` objects

**Type definitions (`src/types/claim.ts`):**
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
  rowSelector?: string;
  headerMapping?: Record<string, keyof RawClaim>;
}
```

### 2. `src/lib/scraper.ts` — Fetch + Parse

**Responsibility:** Orchestrate the fetch and parse pipeline.

**Functions:**
- `scrapeClaims(): Promise<RawClaim[]>` — Main scraper function
  - Calls `login()` from `auth.ts` to get authenticated fetch
  - Fetches the claims page HTML
  - Calls `parseClaimsHtml()` to extract data
  - Returns parsed claims
  - Handles errors (network, auth failure, parse errors)

- `scrapeToInsert(): Promise<{ claims: RawClaim[]; hashes: string[] }>` — Extended version
  - Returns claims with computed `raw_hash` for deduplication
  - Uses SHA-256 hash of claim data for dedup

### 3. Fix `src/lib/auth.ts` — Cookie Persistence Bug

**Issue:** The cookie jar is never populated with cookies from server responses.

**Fix:**
```typescript
const setCookieHeader = response.headers.get('set-cookie');
if (setCookieHeader) {
  await cookieJar.setCookie(setCookieHeader, url, { ignoreError: true });
}
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Edit | Add `cheerio` dependency |
| `src/types/claim.ts` | Create | Type definitions for RawClaim and ParserOptions |
| `src/lib/parser.ts` | Create | HTML parser for claims table |
| `src/lib/scraper.ts` | Create | Scraper orchestration (fetch + parse) |
| `src/lib/auth.ts` | Edit | Fix cookie persistence bug |

## Implementation Steps

### Step 1: Add cheerio dependency
```bash
npm install cheerio
```

### Step 2: Create `src/types/claim.ts`
- Define `RawClaim` interface matching `raw_claims` table schema
- Define `ParserOptions` interface for configurable selectors

### Step 3: Fix `src/lib/auth.ts`
- Add cookie extraction after each fetch
- Store cookies in jar for subsequent requests
- Verify the fix by checking cookies are present before claims page fetch

### Step 4: Create `src/lib/parser.ts`
- Import cheerio
- Implement `parseClaimsHtml()` with flexible header mapping
- Handle: missing table, empty rows, varying column counts
- Add date parsing (handle MM/DD/YYYY → ISO)
- Add amount parsing (handle currency symbols, commas)

### Step 5: Create `src/lib/scraper.ts`
- Import `login` from auth, `parseClaimsHtml` from parser
- Implement `scrapeClaims()` with error handling
- Implement `scrapeToInsert()` with hash generation
- Add logging for debugging

## Edge Cases to Handle

| Case | Handling |
|------|----------|
| Login fails | Throw error with status code, log response body |
| No claims table found | Return empty array + warning log |
| Empty table (no rows) | Return empty array |
| Missing/empty cells | Set field to `null` |
| Invalid date format | Try multiple formats, fallback to `null` |
| Currency in amount | Strip `$`, `,` before parsing number |
| Network timeout | Retry once, then throw |
| Large tables | Process all rows (no pagination for now) |

## Verification

1. **Unit test parser:** Create a test HTML file with a mock claims table, verify parser extracts correct data
2. **Integration test scraper:**
   - Run `login()` → verify cookies populated
   - Fetch claims page → verify HTML returned
   - Parse HTML → verify claims array
3. **CLI test script:** `npx ts-node src/lib/scraper.ts` should log parsed claims

## Notes
- Parser should be defensive — claims sites often have inconsistent HTML
- Header mapping allows adapting to column reorders without code changes
- Hash generation uses `claim_id` + `amount` + `date_filed` for deduplication
