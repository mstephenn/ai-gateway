import { test, expect } from "@playwright/test";
import { signIn } from "../fixtures/auth.js";

test("admin can create a keyword-blocking guardrail", async ({ page }) => {
  await signIn(page);

  await page.getByRole("link", { name: "Guardrails" }).click();
  await page.waitForURL("/guardrails");

  const ruleName = `E2E Block ${Date.now()}`;
  await page.getByRole("button", { name: "Add rule" }).click();
  await page.getByPlaceholder("e.g. Block internal codenames").fill(ruleName);
  await page.getByPlaceholder("secret, classified, internal-use").fill("e2e-blocked-word");
  await page.getByRole("button", { name: "Create rule" }).click();

  await expect(page.getByText(ruleName)).toBeVisible();
});
