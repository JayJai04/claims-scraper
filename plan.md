# Claims Scraper — Full Project Plan

## Goal
Build an application that scrapes an existing claims management service site, stores the raw scraped data in a database table, then transforms that data and stores it in a new table.

## Tech Stack
- **Next.js** (App Router, TypeScript) — server-side scraper service
- **Supabase** — local instance via Docker for development, hosted for production
- **Cheerio** — server-side HTML parsing

## Current State
- GitHub repo created: `github.com/JayJai04/claims-scraper`
- Local directory: `~/Desktop/claims-scraper/`
- README committed, nothing else set up yet

## Architecture

```
┌─────────────────────┐       scrape        ┌─────────────────────┐
│  Existing Claims    │ ◄───────────────── │  Next.js App        │
│  Management Site    │   server-side       │  (API route /       │
│  (already exists)   │   fetch + parse     │   server action)    │
└─────────────────────┘                     └──────────┬──────────┘
                                                          │
                                                   insert │
                                                          ▼
                                                 ┌─────────────────────┐
                                                 │  Supabase           │
                                                 │  (local Docker)     │
                                                 │                     │
                                                 │  raw_claims  ──► transformed_claims
                                                 └─────────────────────┘
```

## Project Structure (Target)

```
~/Desktop/claims-scraper/
├── package.json
├── docker-compose.yml              # Supabase local
├── .env.local                      # Supabase connection vars
├── supabase/
│   └── migrations/
│       ├── 001_create_raw_claims.sql
│       └── 002_create_transformed_claims.sql
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                # UI to trigger scrape & view data
│   │   └── api/
│   │       ├── scrape/
│   │       │   └── route.ts        # Scrape endpoint
│   │       └── transform/
│   │           └── route.ts        # Transform endpoint
│   ├── lib/
│   │   ├── supabase.ts             # Supabase client
│   │   ├── scraper.ts              # Fetch + parse logic
│   │   ├── parser.ts               # DOM extraction (site-specific selectors)
│   │   └── transform.ts            # Data transformation logic
│   └── types/
│       └── claim.ts                # Claim type definitions
└── README.md
```

## Database Schema

### raw_claims
```sql
CREATE TABLE raw_claims (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id      TEXT NOT NULL,
  policy_number TEXT,
  claimant_name TEXT,
  date_filed    DATE,
  status        TEXT,
  amount        NUMERIC,
  description   TEXT,
  scraped_at    TIMESTAMPTZ DEFAULT NOW(),
  raw_hash      TEXT  -- for deduplication
);
```

### transformed_claims
```sql
CREATE TABLE transformed_claims (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  raw_claim_id      UUID REFERENCES raw_claims(id),
  claim_id          TEXT NOT NULL,
  policy_number     TEXT,
  claimant_name     TEXT,
  date_filed        DATE,
  status            TEXT,
  amount            NUMERIC,
  description       TEXT,
  -- Add derived/transformed fields here as needed
  transformed_at    TIMESTAMPTZ DEFAULT NOW()
);
```

## Implementation Phases

### Phase 1: Scrape + Store Raw Data (CURRENT FOCUS)
| Step | Description |
|------|-------------|
| 1 | Scaffold Next.js app with TypeScript + App Router |
| 2 | Add dependencies: `cheerio`, `@supabase/supabase-js` |
| 3 | Set up Supabase locally via Docker (`supabase init` + `supabase start`) |
| 4 | Define and run `raw_claims` migration |
| 5 | Build parser module with site-specific DOM selectors |
| 6 | Build scraper module (fetch HTML → parse → insert into Supabase) |
| 7 | Create `/api/scrape` endpoint |
| 8 | Test: hit endpoint, verify data in Supabase |

### Phase 2: Transform + Store Transformed Data
| Step | Description |
|------|-------------|
| 1 | Define transformation rules |
| 2 | Create `transformed_claims` migration |
| 3 | Build transform module |
| 4 | Create `/api/transform` endpoint |
| 5 | Link: scrape → transform pipeline |

### Phase 3: Polish
| Step | Description |
|------|-------------|
| 1 | Add simple UI to trigger and monitor |
| 2 | Add scheduling (cron / interval) |
| 3 | Deploy to hosted Supabase + Vercel/ Railway |

## Key Decisions
- **Scraping runs server-side** in Next.js — avoids CORS, full Node.js access
- **Cheerio** for HTML parsing — lightweight, jQuery-like, server-side
- **raw_hash** column for deduplication — prevents duplicate inserts on re-scrape
- **Supabase local** via Docker — free, self-contained, mirrors production

## Out of Scope (For Now)
- Authentication / authorization
- Complex scheduling infrastructure
- Production deployment
