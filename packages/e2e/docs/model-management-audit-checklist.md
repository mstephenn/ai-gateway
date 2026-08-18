# Model Management UI Audit Checklist

Use this checklist when comparing the deployed UI (`https://aigateway.optisolbusiness.com/ui`) against the reference screenshots.

## How to run the automated audit

```bash
cd packages/e2e
DEPLOYED_URL=https://aigateway.optisolbusiness.com/ui \
  pnpm exec playwright test --config=playwright.deployed.config.ts --headed
```

The test will open Chrome, navigate to the deployed URL, and pause at the login screen. Sign in manually, then resume the inspector. The script will capture screenshots and report visible gaps.

## Reference screenshots

1. `Screenshot 2026-08-18 at 3.58.23 PM.png` — Model Management list page.
2. `Screenshot 2026-08-18 at 4.00.51 PM.png` — Add Model form.

## List page checks (All Models tab)

### Header
- [ ] Page title reads **"Model Management"**
- [ ] Subtitle reads **"Add and manage models for the proxy"**

### Tab navigation
- [ ] Tabs are rendered horizontally under the header
- [ ] Tabs include: **All Models**, **Add Model**, **Auto-Routers**, **LLM Credentials**, **Pass-Through Endpoints**, **Health Status**, **Model Retry Settings**, **Model Group Alias**, **Price Data Reload**
- [ ] **Auto-Routers** has a **Beta** badge
- [ ] Active tab has an underline indicator
- [ ] Clicking a tab switches content inline on the same page (no navigation to a new route)

### Filter / toolbar row
- [ ] Left side: search input with placeholder **"Search model names..."**
- [ ] Right side: **Chapter** selector (default "Personal" with a blue dot)
- [ ] Right side: **View** selector (default "Current Chapter Models")
- [ ] Right side: settings (gear) icon button
- [ ] Right side: refresh icon button
- [ ] Right side: **Columns** button
- [ ] Right side: **Filters** button

### Data table
- [ ] Columns in order: **Model ID**, **Model Information**, **Credentials**, **Created By**, **Updated At**, **Costs**, **Chapter ID**, **Model Access Group**, **Actions**
- [ ] **Model Information** header has an info icon
- [ ] **Credentials** header has an info icon
- [ ] **Created By**, **Updated At**, **Costs**, **Chapter ID**, **Model Access Group** headers show sort arrows
- [ ] Model ID values are truncated UUIDs shown as blue links (e.g. `23c33369-ba…`)
- [ ] Model Information cells show an icon + model name + truncated provider model ID below
- [ ] Credentials cells show a gray pill/badge with a pencil icon and "Manual" text
- [ ] Created By cells show "Unknown" / "Unknown date" when no creator is present
- [ ] Updated At cells show formatted date or "—"
- [ ] Costs cells show **IN $X.XX** and **OUT $X.XX**
- [ ] Chapter ID / Model Access Group cells show value or "—"
- [ ] Actions cells show a toggle switch + delete control

### Pagination footer
- [ ] "Rows per page" selector (default 50)
- [ ] Result summary: "Showing X-Y of Z"
- [ ] Page indicator: "Page N of M"
- [ ] First / Previous / Next / Last buttons

### Info footer
- [ ] Note: "To access these models, create a Virtual Key without selecting a team on the Virtual Keys page."
- [ ] "Virtual Keys page" is a link

## Add Model form checks

### Layout
- [ ] Form is shown inline on the same page when **Add Model** tab is clicked
- [ ] No drawer/sheet is used
- [ ] Form title reads **"Add Model"** (or **"Edit Model"** when editing)
- [ ] Form rows use a two-column layout: label on the left, input on the right

### Fields
- [ ] **Provider** (required, red asterisk) — select with provider icon + name
- [ ] **Provider Model Name(s)** (required) — input with helper text "The model name sent to the upstream LLM API"
- [ ] **Model Mappings** (required) — table with columns "Public Model Name" and "Provider Model Name"
- [ ] **Mode** (optional) — select with helper text "Optional - Provider endpoint to use when health checking this model" and a "Learn more" link
- [ ] Helper text: "Either select existing credentials OR enter new provider credentials below"
- [ ] **Existing Credentials** select (default "None")
- [ ] "OR" divider
- [ ] Provider-specific credential fields:
  - For **Amazon Bedrock**: AWS Access Key ID, AWS Secret Access Key, AWS Bedrock API Key, AWS Session Token, AWS Region Name
  - Inputs have password visibility toggle icons
- [ ] Submit button labeled **"Add Model"** (or **"Save changes"** when editing)

## Inline tab content checks (other tabs)

- [ ] **Auto-Routers** tab shows an Auto-Routers section
- [ ] **LLM Credentials** tab shows an LLM Credentials section
- [ ] **Pass-Through Endpoints** tab shows a Pass-Through Endpoints section
- [ ] **Health Status** tab shows a Health Status section
- [ ] **Model Retry Settings** tab shows a Model Retry Settings section
- [ ] **Model Group Alias** tab shows a Model Group Alias section
- [ ] **Price Data Reload** tab shows a Price Data Reload section

## Behavioral checks

- [ ] Clicking a row in the All Models table switches to the Add Model tab in edit mode, pre-filled with that model's data
- [ ] Toggle switch in Actions column enables/disables a model
- [ ] Delete button opens a confirmation dialog
- [ ] Search filters the table client-side by model name / provider model ID

## Common gaps to watch for

- Missing tab rendered inline (still using a drawer or separate route)
- Missing Beta badge on Auto-Routers
- Missing info icons on Model Information / Credentials headers
- Missing sort indicators on table headers
- Missing IN/OUT cost formatting
- Missing Virtual Keys footer note
- Add Model still opens in a drawer/sheet
- Missing provider icon in Provider select
- Missing password visibility toggles on credential inputs
- Missing "OR" divider between existing and new credentials
- Placeholder tabs show empty content instead of a section card
