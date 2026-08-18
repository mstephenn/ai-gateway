import { test, expect, type Page } from "@playwright/test";

/**
 * E2E audit script for the deployed admin UI at aigateway.optisolbusiness.com.
 *
 * Run:
 *   DEPLOYED_URL=https://aigateway.optisolbusiness.com/ui \
 *   DEPLOYED_ADMIN_USERNAME=admin \
 *   DEPLOYED_ADMIN_KEY=sk-... \
 *     pnpm exec playwright test --config=playwright.deployed.config.ts
 *
 * The script logs in, navigates to Model Management, captures screenshots,
 * and prints a structured feature report to the console.
 */

const DEPLOYED_URL = process.env["DEPLOYED_URL"] || "https://aigateway.optisolbusiness.com/ui";
const DEPLOYED_ADMIN_USERNAME = process.env["DEPLOYED_ADMIN_USERNAME"] || "admin";
const DEPLOYED_ADMIN_KEY = process.env["DEPLOYED_ADMIN_KEY"];

async function signIn(page: Page): Promise<void> {
  await page.goto(DEPLOYED_URL);
  await page.waitForLoadState("networkidle");

  const currentUrl = page.url();
  const pathname = new URL(currentUrl).pathname.toLowerCase();
  if (pathname.includes("/ui") && !pathname.includes("/login") && !pathname.includes("/signin")) {
    console.log("Already authenticated at", currentUrl);
    return;
  }

  if (!DEPLOYED_ADMIN_KEY) {
    console.log("\n>>> DEPLOYED_ADMIN_KEY not set. Please sign in manually.");
    await page.pause();
    return;
  }

  // Wait for the client-side login form.
  await page.waitForSelector("input", { timeout: 15000 });

  const usernameSelectors = [
    'input[type="email"]',
    'input[name="username"]',
    'input[name="email"]',
    'input[placeholder*="Username" i]',
    'input[placeholder*="Email" i]',
    'input[placeholder*="User" i]',
  ];
  for (const selector of usernameSelectors) {
    const input = page.locator(selector).first();
    if (await input.isVisible().catch(() => false)) {
      await input.fill(DEPLOYED_ADMIN_USERNAME);
      break;
    }
  }

  await page.locator('input[type="password"]').first().fill(DEPLOYED_ADMIN_KEY);
  await page.locator('button[type="submit"]').first().click();

  await page.waitForURL(
    (url) => {
      const p = url.pathname.toLowerCase();
      return p.includes("/ui") && !p.includes("/login") && !p.includes("/signin");
    },
    { timeout: 20000 },
  );
}

async function navigateToModelManagement(page: Page): Promise<void> {
  // Direct URL for "Models + Endpoints" page.
  await page.goto(`${DEPLOYED_URL}/models-and-endpoints`);
  await page.waitForLoadState("networkidle");
  console.log("Model Management URL:", page.url());
}

function logSection(title: string) {
  console.log(`\n=== ${title} ===`);
}

function logFeature(label: string, value: string | number | boolean) {
  const status = value ? "✓" : "✗";
  console.log(`${status} ${label}: ${value}`);
}

test.describe("Model Management audit", () => {
  test("capture list page features", async ({ page }) => {
    await signIn(page);
    await navigateToModelManagement(page);

    await page.screenshot({ path: "test-results/model-list.png", fullPage: true });

    logSection("List Page Features");

    const heading = page.getByRole("heading", { name: /Model Management/i });
    logFeature("Heading 'Model Management'", await heading.isVisible().catch(() => false));

    const tabs = ["All Models", "Add Model", "Auto-Routers", "LLM Credentials", "Pass-Through Endpoints", "Health Status", "Model Retry Settings", "Model Group Alias", "Price Data Reload"];
    for (const tab of tabs) {
      // Tabs may be truncated; use partial text match.
      const visible = await page.getByText(tab, { exact: false }).first().isVisible().catch(() => false);
      logFeature(`Tab: ${tab}`, visible);
    }
    // Explicitly check for the Auto-Routers Beta badge.
    const autoRoutersBadge = page.locator("text=Auto-Routers").locator("xpath=..").locator("text=Beta");
    logFeature("Auto-Routers Beta badge", await autoRoutersBadge.isVisible().catch(() => false));

    const search = page.getByPlaceholder(/Search model names/i);
    logFeature("Search model names input", await search.isVisible().catch(() => false));

    const chapter = page.locator("text=Chapter").first();
    logFeature("Chapter selector", await chapter.isVisible().catch(() => false));

    const view = page.locator("text=Current Chapter Models").first();
    logFeature("View selector", await view.isVisible().catch(() => false));

    const columns = ["Model ID", "Model Information", "Credentials", "Created By", "Updated At", "Costs", "Chapter ID", "Model Access Group", "Actions"];
    for (const col of columns) {
      const visible = await page.locator("th, [role=columnheader]").getByText(col, { exact: false }).first().isVisible().catch(() => false);
      logFeature(`Column: ${col}`, visible);
    }

    const pagination = page.locator("text=/Rows per page/i");
    logFeature("Pagination footer", await pagination.isVisible().catch(() => false));

    const virtualKeysNote = page.getByText(/Virtual Keys page/i);
    logFeature("Virtual Keys note", await virtualKeysNote.isVisible().catch(() => false));
  });

  test("capture Add Model form features", async ({ page }) => {
    await signIn(page);
    await navigateToModelManagement(page);

    // Click Add Model tab/link.
    const addTab = page.getByText("Add Model", { exact: true }).first();
    if (await addTab.isVisible().catch(() => false)) {
      await addTab.click();
      await page.waitForLoadState("networkidle");
    }

    // Wait for the provider dropdown to finish loading, then select Amazon Bedrock.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('input[placeholder*="Loading providers"]');
        return !el || el.getAttribute("placeholder") !== "Loading providers...";
      },
      { timeout: 10000 },
    );

    const providerInput = page.locator('input[placeholder*="Select" i]').first();
    if (await providerInput.isVisible().catch(() => false)) {
      await providerInput.click();
      await page.waitForTimeout(300);
      const bedrockOption = page.getByText("Amazon Bedrock", { exact: false }).first();
      if (await bedrockOption.isVisible().catch(() => false)) {
        await bedrockOption.click();
        await page.waitForTimeout(500);
      }
    }

    await page.screenshot({ path: "test-results/add-model.png", fullPage: true });

    logSection("Add Model Form Features");

    const heading = page.getByRole("heading", { name: /Add Model/i });
    logFeature("Heading 'Add Model'", await heading.isVisible().catch(() => false));

    const fields = [
      "Provider",
      "Provider Model Name",
      "Model Mappings",
      "Public Model Name",
      "Mode",
      "Existing Credentials",
      "AWS Access Key ID",
      "AWS Secret Access Key",
      "AWS Bedrock API Key",
      "AWS Session Token",
      "AWS Region Name",
    ];
    for (const field of fields) {
      const visible = await page.getByText(field, { exact: false }).first().isVisible().catch(() => false);
      logFeature(`Field/Section: ${field}`, visible);
    }

    const orDivider = page.getByText("OR", { exact: true });
    logFeature('"OR" divider', await orDivider.isVisible().catch(() => false));

    const addButton = page.getByRole("button", { name: /Add Model/i });
    logFeature("Add Model submit button", await addButton.isVisible().catch(() => false));
  });

  test("report visible model rows and costs", async ({ page }) => {
    await signIn(page);
    await navigateToModelManagement(page);

    const rows = await page.locator("table tbody tr").count();
    console.log(`\n=== Visible Model Rows ===`);
    console.log(`Table body rows found: ${rows}`);

    const costsIn = await page.locator("text=/IN \\$/i").count();
    const costsOut = await page.locator("text=/OUT \\$/i").count();
    console.log(`Cost IN labels: ${costsIn}`);
    console.log(`Cost OUT labels: ${costsOut}`);

    const modelNames = await page.locator("table tbody tr td:nth-child(2)").allTextContents();
    console.log(`Model names in table: ${modelNames.map((n) => n.trim()).filter(Boolean).join(", ") || "none"}`);
  });
});
