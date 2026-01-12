import { Page } from 'playwright';

export interface CookieLoginInput {
  cookies: string;
}

export async function cookieLogin(page: Page, input: CookieLoginInput): Promise<void> {
  const cookies = JSON.parse(input.cookies);
  await page.context().addCookies(cookies);
  await page.goto('https://www.linkedin.com/feed/');
  await page.waitForLoadState('networkidle');
}

export default cookieLogin;
