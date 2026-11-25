import { expect, Page } from '@playwright/test';

export const PASSWORD = process.env.E2E_PASSWORD ?? 'Passw0rd!2026';

export async function login(page: Page, user: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.evaluate(() => localStorage.setItem('jsa.lang', 'en'));
  await page.goto('/login');
  await page.locator('#identifier').fill(user);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Local datetime-local string N hours from now (browser runs in Asia/Bangkok, same as the app setting). */
export function localIn(hours: number) {
  const d = new Date(Date.now() + hours * 3600_000);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
}

export async function section(page: Page, name: RegExp | string) {
  await page.getByRole('navigation', { name: 'Form sections' }).getByRole('button', { name }).click();
}

export async function confirmDialog(page: Page, button: RegExp | string) {
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: button }).click();
}
