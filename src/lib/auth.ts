import fetch from 'node-fetch';
import { CookieJar } from 'tough-cookie';

const BASE_URL = 'https://docura-technical-screen.vercel.app';
const LOGIN_URL = `${BASE_URL}/`;
const CLAIMS_URL = `${BASE_URL}/claims`;

export interface AuthResult {
  cookieJar: CookieJar;
  fetch: (url: string, options?: any) => Promise<any>;
}

export async function login(): Promise<AuthResult> {
  const cookieJar = new CookieJar();

  const authenticatedFetch = (url: string, options: any = {}) => {
    const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;
    return fetch(fullUrl, {
      ...options,
      headers: {
        ...options.headers,
        cookie: cookieJar.getCookieStringSync(fullUrl),
      },
    });
  };

  // Step 1: GET the login page to find form fields and CSRF token
  const loginPageResponse = await authenticatedFetch(LOGIN_URL);
  const loginPageHtml = await loginPageResponse.text();

  // Extract form action URL (defaults to root if not found)
  const formActionMatch = loginPageHtml.match(/action="([^"]+)"/);
  const formAction = formActionMatch ? formActionMatch[1] : '/';

  // Step 2: POST credentials
  const formData = new URLSearchParams();
  formData.append('username', process.env.SCRAPER_USER_ID || '');
  formData.append('password', process.env.SCRAPER_PASSWORD || '');

  const loginResponse = await authenticatedFetch(formAction, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
    redirect: 'manual',
  });

  // Check if login was successful
  if (loginResponse.status !== 302 && loginResponse.status !== 200) {
    throw new Error(`Login failed with status ${loginResponse.status}`);
  }

  // Step 3: Verify we can access the claims page
  const claimsResponse = await authenticatedFetch(CLAIMS_URL);
  if (claimsResponse.status !== 200) {
    throw new Error(`Failed to login but cannot access claims page (status ${claimsResponse.status})`);
  }

  return { cookieJar, fetch: authenticatedFetch };
}
