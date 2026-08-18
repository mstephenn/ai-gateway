import { test, expect } from "@playwright/test";
import { signIn } from "../fixtures/auth.js";

test("admin can create a key", async ({ page }) => {
  await signIn(page);

  // Create a team to own the key.
  const teamName = `E2E Key Owners ${Date.now()}`;
  await page.getByRole("link", { name: "Teams" }).click();
  await page.waitForURL("/teams");
  await page.getByRole("button", { name: "New team" }).click();
  await page.getByRole("dialog", { name: "New team" }).getByRole("textbox").first().fill(teamName);
  await page.getByRole("button", { name: "Save team" }).click();
  await expect(page.getByText(teamName)).toBeVisible();

  // Create a key owned by the new team.
  await page.getByRole("link", { name: "API Keys" }).click();
  await page.waitForURL("/keys");

  const keyName = `e2e-key-${Date.now()}`;
  await page.getByRole("button", { name: "New key" }).click();
  const createDialog = page.getByRole("dialog", { name: "Create API key" });
  await createDialog.getByRole("textbox").first().fill(keyName);
  await createDialog.getByRole("button", { name: "Create key" }).click();

  const revealDialog = page.getByRole("dialog", { name: "Copy this secret now" });
  await expect(revealDialog).toBeVisible();
  await expect(revealDialog.locator(".font-mono")).toContainText("ak-");
  await revealDialog.getByRole("button", { name: "Close" }).first().click();

  await expect(page.locator("tbody tr").first().getByText("Active")).toBeVisible();
});
