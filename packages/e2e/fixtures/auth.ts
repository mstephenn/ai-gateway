import type { Page } from "@playwright/test";

export const ADMIN_KEY = "sk-e2e-admin-test-key";

export async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForSelector('form[data-mounted="true"]');
  await page.getByLabel("Admin bearer key").fill(ADMIN_KEY);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/overview");
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL("/");
}
