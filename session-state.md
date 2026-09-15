# Claims Scraper — Current State (Session Handoff)

## Project
Authenticated claims scraper (Playwright headless browser) for the Northstar claims site, scraping 40 claims (paginated) with per-claim detail tabs into SQLite (`better-sqlite3`, file `claims.db`). Local UI at http://localhost:3000 (`src/server.ts` + `src/ui.html`) with claims browser, document viewer (local PDF serving), and AI summary feature via Google Gemini API.

## Current state
- **Scraping**: Complete. 40 claims, 93 notes, 81 documents, 24 payments, 42 requirements in separate tables (`raw_claims`, `raw_notes`, `raw_documents`, `raw_payments`, `raw_requirements`).
- **UI**: Left pane lists claims with search + status filter + "Only with summary" checkbox (default ON — shows only the 5 claims that have summaries). Detail pane has Summary/Notes/Documents/Payments/Requirements tabs. Documents tab table is Date/Category/File/Pages/View — clicking "View" opens a dialog showing the document's one-paragraph summary plus an "Open PDF" link. `/api/documents/:id/download` serves the local PDF from `/tmp/docs/` by `raw_documents.id` (site docIds were overwritten by `dl-docs.ts`, so the old Playwright-authenticated proxy route was removed).
- **Claim summaries**: Dummy summaries (built from real claim data: claimant, policy, dates, status, payment totals, tab counts, latest note) saved for NC-2025-1001..1005 via `POST /api/claims/:id/summary/dummy`. Real Gemini generation is blocked by free-tier 429s (quota exhausted); `POST /api/claims/:id/summary` (real) and `POST /api/claims` (batch) still wired, using `gemini-2.5-flash`.
- **Document summaries**: All 81 PDFs downloaded to `/tmp/docs/` (authed via Playwright), text extracted with `pdfjs-dist`. Each document has a one-paragraph summary in the `raw_documents.summary` column built ONLY from the document itself: identity line (category/filename/date/pages) + the PDF's substantive content. No claim context, payment totals, or claim status. Regenerate via `para-docs.ts`.
- **Scripts** (in repo root, uncommitted): `dl-docs.ts` (download PDFs), `extract-docs.ts` (extract text), `para-docs.ts` (write paragraph summaries).
- **Uncommitted code changes**: `src/server.ts` (dummy summary endpoints, local PDF download route), `src/ui.html` (summary display, "Only with summary" filter, doc summary View dialog), `src/lib/db.ts` (`raw_documents.summary` column, `updateDocumentSummary`, `buildDummyDocumentSummary`), `src/lib/parser.ts` (`summary: null` field), `src/types/claim.ts` (`RawDocument.summary`), `pdfjs-dist` dependency added.
- **DB schema change**: `raw_documents.summary` column added via ALTER TABLE (schema in `db.ts` also updated).
- **Git**: main branch at repo https://github.com/JayJai04/claims-scraper, working tree has the above uncommitted changes.

## TODO (next chat)
1. Commit the pending changes (scripts + src changes + regenerated DB summaries).
2. Real Gemini claim summaries still blocked by free-tier 429 quota — retry `POST /api/claims/:id/summary` when quota resets.
