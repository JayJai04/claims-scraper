import { chromium, Browser, Page } from 'playwright';

const BASE_URL = 'https://docura-technical-screen.vercel.app';
const LOGIN_URL = `${BASE_URL}/`;
const CLAIMS_URL = `${BASE_URL}/claims`;

export interface AuthResult {
  browser: Browser;
  page: Page;
  close: () => Promise<void>;
}

export async function login(): Promise<AuthResult> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Step 1: Navigate to login page
  await page.goto(LOGIN_URL);

  // Step 2: Fill in credentials
  await page.fill('input[name="username"]', process.env.SCRAPER_USER_ID || '');
  await page.fill('input[name="password"]', process.env.SCRAPER_PASSWORD || '');

  // Step 3: Click Log On and wait for claims page
  await Promise.all([
    page.waitForURL('**/claims'),
    page.click('button:has-text("Log On")'),
  ]);

  return {
    browser,
    page,
    close: () => browser.close(),
  };
}
