import { test, expect } from "@playwright/test";
import { signIn, signOut } from "../fixtures/auth.js";

test("admin can sign in and out", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  await signOut(page);
  await expect(page.getByLabel("Admin bearer key")).toBeVisible();
});
