import { test, expect } from "@playwright/test";
import { signIn } from "../fixtures/auth.js";

test("admin can create a team", async ({ page }) => {
  await signIn(page);

  await page.getByRole("link", { name: "Teams" }).click();
  await page.waitForURL("/teams");

  const teamName = `E2E Team ${Date.now()}`;
  await page.getByRole("button", { name: "New team" }).click();
  await page.getByRole("dialog", { name: "New team" }).getByRole("textbox").first().fill(teamName);
  await page.getByRole("button", { name: "Save team" }).click();

  await expect(page.getByText(teamName)).toBeVisible();
});
