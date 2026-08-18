# Product Roadmap

Product roadmap for the AI Gateway from MVP to enterprise-ready
operations. This complements `ROADMAP.md`, which tracks engineering
phases, and `UI_ROADMAP.md`, which expands the admin console.

## Product Thesis

Build a focused, enterprise-grade AI gateway that covers the operational
needs this organization actually has: OpenAI-compatible routing across a
small set of providers, safe key management, teams, organization/user
management, budgets, rate limits, usage visibility, and provider health.
The product should feel mature and operationally clear without copying a
broad feature surface that this gateway does not need.

## Product Principles

- **Operate before optimize:** ship the controls needed to safely run the
  gateway before adding advanced analytics or policy depth.
- **Enterprise shape, MVP scope:** include orgs, users, roles, keys, and
  sync because they are required to operate in a company; avoid broad
  marketplace/playground/billing features until proven necessary.
- **Provider focus:** first-class support for Bedrock, Azure OpenAI,
  OpenAI, Anthropic, and later Gemini. Do not optimize the product around
  a long-tail provider catalog.
- **Traceable administration:** every sensitive lifecycle action should
  be attributable, reviewable, and reversible where the backend allows it.
- **No secret leakage:** API keys and provider credentials are write-only
  or one-time reveal.

## MVP

**Goal:** A platform admin can configure the gateway, onboard teams and
users, issue keys, control usage, and debug basic failures without
database access.

**Included capabilities:**

- Core OpenAI-compatible `POST /v1/chat/completions` gateway.
- Provider deployments for Bedrock, Azure OpenAI, OpenAI, and Anthropic.
- Deployment routing, fallback, retries, timeouts, and model listing.
- Admin authentication using admin keys.
- Root organization setup.
- Minimal organization structure: organization, business unit or
  department, team, user.
- Manual user management: create, edit, deactivate, reactivate.
- Azure AD/Microsoft Entra ID sync: configure tenant, map groups to
  teams/roles, preview sync, run sync, review results.
- Roles: platform admin, gateway admin, team owner, auditor, end user.
- API key lifecycle: create, one-time reveal, rotate, revoke, expire.
- Key ownership by team and, once available, user.
- Token budgets and RPM/TPM rate limits at key and team scope.
- Usage dashboard: request volume, token volume, latency, errors, top
  models, top teams, and top keys.
- Basic provider/deployment health: active, inactive, cooldown,
  degraded, unavailable.
- Basic audit trail for key, user, team, org, deployment, and sync
  actions.

**MVP acceptance checks:**

- A platform admin can set up an organization, sync or manually create
  users, create a team, assign users, create a key, and use that key for
  a gateway request.
- A gateway admin can add or disable a deployment without restarting the
  gateway.
- A team owner can understand key usage and budget/rate-limit pressure
  for their team.
- An operator can identify whether failures are caused by auth, budget,
  rate limit, provider outage, or missing deployment.
- Secrets are never retrievable after initial reveal/write.

## Release 1: Enterprise MVP

**Target user:** platform admin and gateway admin.

**Product scope:**

- Core gateway and provider routing.
- Admin console shell.
- Models and deployments.
- Provider credential references.
- Teams and API keys.
- Root organization, users, memberships, and roles.
- Azure AD/Microsoft Entra ID sync with manual preview/apply.
- Token budgets and RPM/TPM limits.
- Overview dashboard and usage explorer.
- Provider health and cooldown visibility.
- Minimal audit trail.

**Explicitly excluded:**

- Prompt playground.
- Prompt/request/response body inspection.
- Custom RBAC designer.
- Plugin marketplace UI.
- Customer billing, invoices, or chargeback.
- Full cost accounting.
- Advanced model access policy.
- Self-service end-user portal.

## Release 2: Governance And Cost Control

**Target user:** platform admin, finance/operations reviewer, auditor.

**Product scope:**

- Per-model pricing.
- Spend aggregation by organization unit, team, user, key, model, and
  deployment.
- Hard and soft spend limits.
- Model access controls by team/key/user where backend support exists.
- Policy preview before saving model access restrictions.
- Better audit detail with before/after values.
- Usage export if needed for internal reporting.

**Acceptance checks:**

- Admins can distinguish token budget enforcement from dollar spend
  enforcement.
- Denied model calls and spend-limit rejections are visible in usage and
  audit views.
- Policy changes can be reviewed before and after they are applied.

## Release 3: Operations And Observability

**Target user:** operator/on-call engineer.

**Product scope:**

- Provider failure diagnostics.
- Routing attempt history for failed requests.
- Cache metrics and exact-match cache controls.
- Observability integration status for systems such as Langfuse,
  Helicone, or LangSmith.
- Incident-oriented deployment actions such as manual disable/enable.
- Higher-cardinality usage analytics with reliable pagination and saved
  filters.

**Acceptance checks:**

- Operators can explain a latency/error spike from the UI without direct
  database queries.
- Cooldown, retry, fallback, and cache states are visible and consistent
  with gateway behavior.

## Release 4: Expansion

**Target user:** gateway admin and platform admin.

**Product scope:**

- Gemini provider.
- Embeddings endpoint support.
- Organization hierarchy refinements if real usage requires deeper
  nesting or project tagging.
- Optional enterprise sign-in if the backend roadmap adds it.
- Additional provider plugins only when there is confirmed demand.

## Product Backlog

- Self-service end-user portal for viewing assigned keys and usage.
- Approval workflow for key requests.
- Custom roles and permissions.
- Advanced audit retention/export policies.
- Prompt and response redaction controls.
- Semantic cache controls.
- Plugin management UI.
- Billing and chargeback reports.

## Product Metrics

- Time for a platform admin to set up org, sync users, create a team, and
  issue the first usable key.
- Percentage of requests attributable to a team and user.
- Failed request classification coverage: auth, budget, rate limit,
  provider, routing, unknown.
- Deployment change safety: number of incidents caused by bad deployment
  configuration.
- Key hygiene: stale keys, revoked keys, expired keys, and rotation age.
- Directory sync quality: conflicts, disabled users, failed sync runs,
  and unmapped groups.
