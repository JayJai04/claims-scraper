# Claims Scraper — Scraping Plan (First Iteration)

## Goal
Set up the project foundation and authentication module so we can log into the claims site. Scraping and database work comes later.

## Target Site Overview
- **URL:** `https://docura-technical-screen.vercel.app/claims`
- **Auth:** Login form at root URL (User ID + Password)
- **System name:** Northstar Claims Services

## Authentication Flow

```
1. GET  https://docura-technical-screen.vercel.app/           → login form
2. POST credentials to the login endpoint                     → sets session cookie
3. GET  https://docura-technical-screen.vercel.app/claims     → authenticated session
```

## Project Structure (First Iteration)

```
claims-scraper/
├── .env.local                 # Credentials and Supabase keys
├── package.json
└── src/
    └── lib/
        └── auth.ts            # Login flow: fetch form, submit creds, return cookies
```

## Implementation Steps

### Step 1: Set up dependencies
```bash
npm init -y
npm install tough-cookie node-fetch
```
- `tough-cookie` — cookie jar for session persistence across requests
- `node-fetch` — HTTP client for Node.js

### Step 2: Environment variables
Create `.env.local`:
```
SCRAPER_USER_ID=your_user_id
SCRAPER_PASSWORD=your_password
```

### Step 3: Build the auth module (`src/lib/auth.ts`)
- Create a `fetch` instance with a cookie jar (using `tough-cookie`)
- GET the login page to capture any CSRF token or hidden form fields
- POST credentials to the login endpoint
- Return the authenticated fetch instance (or cookie jar) for subsequent requests
- Handle login failure (bad credentials, network error) with clear error messages

## Verification
1. Write a test script that imports `auth.ts` and calls the login function
2. After login, fetch `/claims` and print the response HTML
3. Confirm the response contains the claims page (not the login page)
