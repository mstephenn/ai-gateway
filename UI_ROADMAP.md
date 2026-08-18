# UI Roadmap

Detailed roadmap for the AI Gateway admin UI use cases. This expands
Phase 4 from `ROADMAP.md` and maps UI delivery to the release scope in
`PRODUCT_ROADMAP.md` without changing the dependency order of the backend
roadmap.

## Scope

The UI is an enterprise-grade authenticated admin console for operating
the gateway after the core API, model listing, resilience, and virtual
key management APIs exist. It should feel mature, dense, and operationally
clear while deliberately including only the features this roadmap needs:
deployments, teams, keys, budgets, rate limits, organization/user
management, usage, provider health, and the later Phase 6 policy/cost
controls.

The UI should follow enterprise administration expectations: structured
navigation, dense tables, safe key workflows, clear usage visibility, and
operational health surfaces. It should not add broad provider catalogs,
marketplace-like settings, or advanced features unless they map to this
gateway's backend plan.

## Dependencies

- Phase 2: `GET /v1/models`, provider resilience status, prompt cache
  behavior, and timeout/retry configuration.
- Phase 3: admin authentication, teams, key lifecycle, budgets, rate
  limits, and key rotation APIs.
- Phase 5: organization hierarchy, users, memberships, platform-admin
  org-structure configuration, Azure AD/Microsoft Entra ID sync, and
  manual user sync.
- Phase 6, when available: dollar spend, model pricing, spend limits,
  and model access controls.
- Phase 8, when available: external observability integration status.

## Personas

- **Platform administrator**: defines the top-level organization
  structure, configures identity sync, assigns admins, and governs how
  users map into business units, teams, and projects.
- **Gateway administrator**: configures deployments, providers, teams,
  keys, budgets, rate limits, and access policies.
- **Team owner**: reviews team usage, rotates keys, and understands
  budget/rate-limit pressure for their own team.
- **Operator/on-call engineer**: investigates provider failures,
  fallback behavior, latency, cache hit rate, and unusual traffic.
- **Auditor/security reviewer**: checks who owns keys, when they were
  created/rotated/revoked, and whether access aligns with policy.

## Design principles

- Prefer dense enterprise operational screens over marketing-style
  pages.
- Use a restrained, professional admin-console visual system: persistent
  sidebar, compact top bar, searchable tables, status badges, filter
  chips, drawers for detail, and modals for confirmation.
- Make destructive actions explicit, reversible where possible, and
  auditable.
- Never display a plaintext API key except at creation or rotation time.
- Use tables, filters, drawers, and modals for repeated admin workflows.
- Keep UI state derived from APIs; do not invent local-only authority.
- Treat empty/error/loading states as first-class operational states.
- Default to necessary features over feature breadth. Every screen must
  support a planned operator/admin workflow.

## Use Cases

### 1. Sign in and session handling

**Goal:** Let admins reach the console securely and understand when their
session is invalid or insufficient.

**Capabilities:**

- Sign in with the admin bearer key for the first release.
- Leave room for an enterprise auth method later, but do not make it a
  Phase 4 blocker unless the backend roadmap adds it.
- Validate the current identity and admin capability before loading
  privileged screens.
- Show `401` as an authentication problem and `403` as insufficient
  permission.
- Support sign out and session expiration handling.

**Acceptance checks:**

- A non-admin key cannot access admin routes or UI data.
- Expired/revoked keys are pushed back to sign in.
- The UI never stores plaintext generated keys after the one-time reveal.

### 2. Overview dashboard

**Goal:** Give admins a fast read on gateway health and recent usage.

**Capabilities:**

- Show request volume, error rate, p50/p95 latency, token volume, and
  cache hit rate for the selected time range.
- Break down traffic by public model, provider, deployment, team, and
  key.
- Highlight deployments in cooldown, failing providers, exhausted
  budgets, and rate-limit pressure.
- Link every metric card/table row to the relevant detail screen.
- Keep the default dashboard focused on action: unhealthy deployments,
  top models, top teams, recent failures, and budget/rate-limit pressure.

**Acceptance checks:**

- Dashboard loads with partial data if one metric endpoint fails.
- Time range and filters are reflected in the URL.
- Empty state explains that traffic has not been observed yet.

### 3. Models and deployments

**Goal:** Manage the public model catalog and the provider deployments
behind each model.

**Capabilities:**

- List public model names from `GET /v1/models`.
- For each model, show active deployments, provider, provider model ID,
  weight, timeout, retry settings, cache eligibility, and current health.
- Create, edit, activate, deactivate, and delete deployments.
- Adjust routing weights with validation that at least one active
  deployment remains for a public model.
- Test a deployment with a small non-streaming request and show the
  translated gateway error if it fails.

**Acceptance checks:**

- Deactivating the last active deployment is blocked or requires a
  deliberate override.
- Credentials are referenced by name/secret reference only, never shown
  as raw secret values.
- Weight changes are visible immediately after save.

### 4. Provider credentials and configuration

**Goal:** Let admins connect providers without exposing secret material.

**Capabilities:**

- Show configured credential references and their associated providers.
- Create or update credential references through the backend-supported
  secret mechanism.
- Validate provider configuration before it is attached to a deployment.
- Surface missing, invalid, or expired credentials in deployment health.
- Limit provider configuration to the providers planned for this gateway:
  Bedrock, Azure OpenAI, OpenAI, Anthropic, and later Gemini if Phase 8
  lands.

**Acceptance checks:**

- Raw secrets are write-only.
- Validation failures show actionable provider/context details without
  leaking secret values.
- Credential references cannot be deleted while deployments use them.

### 5. Teams

**Goal:** Manage the team model introduced by virtual key management.

**Capabilities:**

- Create, edit, and delete teams.
- Show each team's key count, request volume, token usage, budget usage,
  RPM/TPM limits, and recent errors.
- Configure per-team token budget, reset period, RPM limit, and TPM
  limit.
- Prevent deleting teams that still own active keys, matching the backend
  `409` behavior.

**Acceptance checks:**

- Team budget and rate-limit settings use the same null/unlimited
  semantics as the API.
- Deleting a team with keys shows the blocking keys and next action.
- Team detail links directly to filtered usage and key views.

### 6. Organizations, users, and directory sync

**Goal:** Let platform admins define the enterprise structure from the
top-level organization down to business units, departments, teams,
projects, and final end users.

**Capabilities:**

- Create and edit the root organization profile used by the gateway.
- Define organization units such as business unit, department, cost
  center, project, and team, with a clear parent/child hierarchy.
- Manually create, edit, deactivate, and reactivate users.
- Assign users to one or more organization units and teams.
- Assign platform roles such as platform admin, gateway admin, team
  owner, auditor, and end user, limited to the role model the backend
  supports.
- Configure Azure AD/Microsoft Entra ID sync with tenant ID, sync mode,
  group filters, domain allowlist, and attribute mappings.
- Map Azure AD groups to organization units, teams, and roles.
- Run manual sync on demand and show sync preview before applying
  changes.
- Show sync history: created users, updated users, disabled users,
  group/team membership changes, conflicts, and failures.
- Resolve sync conflicts where a directory user matches an existing
  manually-created user.
- Preserve manually-managed users when directory sync is enabled, with a
  clear source label: `directory`, `manual`, or `linked`.

**Acceptance checks:**

- Platform admins can create the organization hierarchy before any users
  are assigned.
- A manually-created user can be linked to an Azure AD/Microsoft Entra ID
  identity without losing team/key history.
- Manual sync preview shows the exact create/update/disable/membership
  changes before commit.
- Deactivated directory users cannot keep active access unless explicitly
  exempted by a platform admin.
- Users are never hard-deleted by sync; they are disabled/deactivated so
  audit and usage history remain intact.
- Role and membership changes are audit logged with actor, source, old
  value, and new value.

### 7. API keys

**Goal:** Support the full key lifecycle without accidentally exposing or
losing secrets.

**Capabilities:**

- Create keys with name, optional team, admin flag, expiration, budget,
  RPM limit, and TPM limit.
- Optionally associate keys with a user and team once user management is
  available.
- Reveal the plaintext key exactly once after create/rotate, with copy
  affordance and clear confirmation once the dialog is closed.
- List keys with status, owner team, admin flag, expiration, created date,
  last used time, budget usage, and rate-limit settings.
- Revoke keys, rotate keys immediately, and rotate keys with a grace
  period.
- Filter keys by team, status, admin/non-admin, expiration, and recent
  activity.

**Acceptance checks:**

- Plaintext key material is not present after navigating away or closing
  the reveal dialog.
- Rotation with grace period clearly shows that the old key remains valid
  until the exact expiry time.
- Revoke and delete-style actions require confirmation and are audited.

### 8. Budgets and rate limits

**Goal:** Make enforcement understandable before and after requests are
rejected.

**Capabilities:**

- Show budget and rate-limit settings at both key and team scopes.
- Display current spend tokens, remaining budget, reset time, and recent
  `429` events.
- Explain whether a rejection came from the key scope or team scope.
- Let admins edit limits from team and key detail screens.

**Acceptance checks:**

- Unlimited values are displayed consistently and are not confused with
  zero.
- Reset timestamps use absolute date/time plus relative context.
- Rejections can be traced to the exact limiting scope.

### 9. Usage explorer

**Goal:** Let operators and team owners inspect request history and
understand traffic patterns.

**Capabilities:**

- Search/filter request logs by time range, model, provider, deployment,
  team, key, status, and streaming/non-streaming mode.
- Show latency, input tokens, output tokens, total tokens, status, cache
  hit/miss, and selected routing attempt details.
- Preserve filters in the URL for sharing investigations.

**Acceptance checks:**

- Large result sets use server-side pagination.
- Sensitive prompt/response bodies are not displayed unless a future
  explicit audit-log feature adds safe redaction and permissions.
- Failed requests include enough gateway error context for debugging.

### 10. Cost and model access controls

**Goal:** Add spend and model policy UI after Phase 6 lands.

**Capabilities:**

- Manage model pricing records for input and output tokens.
- Show spend by team, key, model, provider, and deployment.
- Configure hard and soft spend limits per key and team.
- Configure which models each team/key can access.
- Preview policy impact before saving access restrictions.

**Acceptance checks:**

- Token budgets from Phase 3 and dollar spend limits from Phase 6 are
  visually distinct.
- Policy edits show affected keys/teams before commit.
- Denied model calls are visible in usage and detail views.

### 11. Prompt cache controls

**Goal:** Make exact-match cache behavior observable and configurable.

**Capabilities:**

- Show cache hit rate, saved provider calls, TTL, and cacheable models.
- Configure cache TTL and enable/disable cache behavior where backend
  settings allow it.
- Inspect recent cache-related events without exposing prompt text.
- Provide a safe cache purge action by model or deployment if supported.

**Acceptance checks:**

- Cache controls are disabled when Redis/cache configuration is absent.
- Purge actions require confirmation and show the affected scope.
- Cache metrics distinguish hit, miss, bypassed, and error states.

### 12. Provider health and routing operations

**Goal:** Help operators understand fallback, cooldown, and provider
behavior.

**Capabilities:**

- Show deployment health, cooldown state, recent upstream errors,
  timeout counts, retry counts, and fallback success rate.
- Manually disable a deployment during an incident.
- View routing configuration and recent selected deployment sequence for
  failed requests.
- Link health issues to model/deployment edit actions.

**Acceptance checks:**

- Cooldown state includes exact expiry time.
- Manual disable is distinct from automatic cooldown.
- Provider errors are normalized through gateway error taxonomy.

### 13. Audit activity

**Goal:** Make administrative changes reviewable.

**Capabilities:**

- Show create/update/revoke/rotate/delete events for keys, teams,
  deployments, credentials, budgets, and access policies.
- Filter by actor, entity type, entity ID, action, and time range.
- Link audit events to the affected entity when it still exists.

**Acceptance checks:**

- Secret values and plaintext keys are never included in audit details.
- Audit entries include before/after metadata for policy and limit
  changes where backend support exists.
- Deleted entities remain identifiable by stable ID and last known name.

## Enterprise UI Bar

The UI should meet the bar of a serious internal platform tool:

- **Navigation:** persistent sidebar with Overview, Models, Providers,
  Organization, Users, Teams, Keys, Usage, Policies, Audit, and Settings.
  Hide or disable future-phase sections until backend support exists.
- **Tables:** sortable, searchable, filterable, server-paginated tables
  with clear empty states and stable column layouts.
- **Details:** side drawers or detail pages for entities, with summary,
  configuration, usage, related keys/teams/deployments, and recent
  events.
- **Hierarchy:** organization structure needs a dedicated tree/table
  view, not a flat tag picker. Platform admins should be able to see
  parent/child relationships, inherited ownership, and linked directory
  groups.
- **Actions:** primary actions are obvious but restrained; destructive
  actions require confirmation and explain the impact.
- **Status language:** consistent badges for active, inactive, revoked,
  expired, cooling down, degraded, over budget, rate limited, and
  unavailable.
- **Safety:** generated secrets are one-time reveal only; raw provider
  secrets are write-only; audit views never expose sensitive values.
- **Responsiveness:** usable on laptop and tablet widths, with mobile as
  a supported inspection mode rather than the primary workflow.
- **Accessibility:** keyboard navigation, visible focus states, semantic
  form labels, usable color contrast, and non-color-only status cues.

## Information architecture

- **Overview:** health, usage, latency, errors, cache, and incidents.
- **Models:** public models and deployment routing configuration.
- **Providers:** credential references and provider-level health.
- **Organization:** root organization, business units, departments, cost
  centers, projects, hierarchy, ownership, and directory group mappings.
- **Users:** users, directory/manual source, status, roles, memberships,
  and sync conflicts.
- **Teams:** team settings, budgets, limits, usage, and keys.
- **Keys:** key lifecycle, rotation, revocation, filters, and one-time
  secret reveal.
- **Usage:** request log explorer, charts, and exports.
- **Policies:** Phase 6 model access control and spend limits.
- **Audit:** administrative activity log.
- **Settings:** minimal system settings exposed by backend APIs.

Future-phase sections should not be prominent before they are supported.
For example, `Policies` appears only after Phase 6 APIs exist, or as a
disabled nav item in development builds if that helps implementation.

## Current Implementation State

The first UI implementation lives in `packages/ui` as a TanStack
Start/React admin console. API contracts are centralized in
`packages/shared` as browser-safe DTO/request types that mirror the
Prisma-backed backend route payloads. The swappable API layer under
`packages/ui/src/lib/api/` uses those shared types when `VITE_API_BASE_URL`
is configured and falls back to local mock fixtures when the backend is
not available.

| Area | Current state | Remaining work |
| --- | --- | --- |
| Console foundation | Implemented: sign-in, authenticated layout guard, persistent sidebar, compact top header, shared tables, filters, drawers, confirmation dialogs, status badges, and global toast notifications. | Replace mock auth with the real admin identity endpoint once available. Add broader visual regression coverage. |
| Overview | Implemented: KPI cards, request/latency charts, top models, top teams, provider health. | Add cache hit rate and live partial-error handling once backend metrics endpoints exist. |
| Models/deployments | Implemented: deployments table, filters, create/edit drawer, enable/disable toggle, delete confirmation; wired to `/admin/deployments` through shared DTOs when backend is configured. | Add credential reference selection, deployment test action, and last-active-deployment protection when backend APIs exist. Align backend deployment create/update with timeout/retry fields exposed in Prisma. |
| Teams | Implemented: teams table, budget progress, RPM/TPM display, create/edit drawer, delete confirmation; wired to `/admin/teams` through shared DTOs when backend is configured. | Add key/member drill-down. Backend currently supports create/list/update but not delete. |
| API keys | Implemented: key table, filters, create modal, one-time secret reveal, rotate, revoke, owner selection, budget/RPM/TPM/allowed-model create and edit; wired to `/admin/keys` through shared DTOs when backend is configured. | Add grace-period rotation when backend supports it. User-owned keys remain a UI concept until the backend key model adds `userId`. |
| Organization/users | Implemented: root org profile, org hierarchy view, users table/drawer, manual status changes, Entra sync controls, and role/team membership persistence through `/admin/roles` and `/admin/memberships` when backend is configured. | Add richer membership editor for multiple org units, group mapping editor, conflict resolution workflow, directory sync run list/history endpoint, and a true sync preview endpoint. |
| Usage | Implemented: aggregate usage summary backed by `/admin/usage?groupBy=key|team|model`, request-log filters/pagination with mock fallback, summary metrics, metadata drawer, no prompt/response body display. | Add raw paginated request-log JSON endpoint or keep expanding the aggregate-first view. Add routing-attempt/cache metadata once backend exposes it. |
| Providers | Partially covered through model deployment/provider health views. | Add a dedicated provider credentials/configuration screen when secret-reference APIs exist. |
| Policies/cost/audit/settings | Not implemented in MVP UI. | Build after Phase 6 and audit/settings backend APIs land. |

## Product Release Mapping

UI delivery follows `PRODUCT_ROADMAP.md`:

- **Release 1: Enterprise MVP** maps to UI Phase A, Phase B, Phase C,
  Phase D, and the MVP subset of Phase E. This gives platform admins and
  gateway admins the minimum complete operating surface: org/user setup,
  directory sync, teams, keys, deployments, usage, limits, and health.
- **Release 2: Governance And Cost Control** maps to the policy/cost
  parts of UI Phase F.
- **Release 3: Operations And Observability** expands UI Phase E with
  deeper diagnostics, cache controls, routing attempt history, and
  observability integration status.
- **Release 4: Expansion** adds UI support only for backend features that
  actually land, such as new providers, embeddings, or deeper
  organization hierarchy refinements.

## Delivery Plan

### UI Phase A: Console foundation

**Depends on:** admin auth from Phase 3.

- Choose app shell framework and package location, preferably a dedicated
  workspace package such as `packages/ui`.
- Implement enterprise admin shell: persistent sidebar, compact header,
  route-level breadcrumbs, API client, error handling, route guards, and
  shared data table primitives.
- Add session handling, sign in, sign out, `401`/`403` states, loading
  states, empty states, and global notifications.

**Done when:**

- Admin-only routes are protected.
- The app can call a health or identity/admin endpoint.
- Basic UI unit tests and build/typecheck are clean.

### UI Phase B: Keys and teams

**Depends on:** Phase 3 key/team APIs.

- Build team list/detail/create/edit/delete workflows.
- Build key list/detail/create/revoke/rotate workflows.
- Implement one-time secret reveal and copy behavior.
- Add budget and rate-limit editing for teams and keys.

**Done when:**

- An admin can create a team, create a key for it, rotate that key, and
  revoke it entirely through the UI.
- The UI correctly handles backend `401`, `403`, `409`, and `429` cases.

### UI Phase C: Organization and user management

**Depends on:** Phase 5 organization/user APIs.

- Build organization setup for the root organization profile.
- Build hierarchy management for business units, departments, cost
  centers, projects, and teams.
- Build user list/detail/create/edit/deactivate/reactivate workflows.
- Build role and membership assignment workflows.
- Build Azure AD/Microsoft Entra ID sync configuration, group mapping,
  manual sync preview, sync execution, sync history, and conflict
  resolution.
- Add source labels for directory-managed, manually-managed, and linked
  users.

**Done when:**

- A platform admin can create the organization structure from root org to
  end-user memberships without database access.
- A platform admin can run a manual directory sync, preview changes, apply
  them, and inspect sync results.
- Directory users, manual users, and linked users have clear status,
  ownership, and audit trails.

### UI Phase D: Models and deployments

**Depends on:** Phase 2 model listing plus deployment management APIs.

- Build model catalog and deployment detail screens.
- Support create/edit/activate/deactivate/delete deployment workflows.
- Add routing weight, timeout, retry, cache eligibility, and health
  displays.
- Add deployment test action once backend support exists.

**Done when:**

- An admin can safely change active deployment routing for a public
  model.
- Last-active-deployment and credential-reference constraints are
  represented in the UI.

### UI Phase E: Usage and operations

**Depends on:** request logs and operational metrics endpoints.

- Build overview dashboard and usage explorer.
- Add provider/deployment health, cooldown, retries, fallback, and cache
  metrics.
- Add URL-persisted filters and server-side pagination.
- Add operational incident actions such as manual deployment disable
  where backend support exists.

**Done when:**

- Operators can answer which team/key/model caused a spike or failure
  without database access.
- Usage screens remain usable with high-cardinality data.

### UI Phase F: Cost, policy, and audit

**Depends on:** Phase 6 and audit-log backend support.

- Add pricing management, spend views, spend limits, and model access
  policy screens.
- Add policy preview before save.
- Add audit activity explorer and entity-linked audit details.

**Done when:**

- Admins can configure spend/model access policies and verify impact.
- Security reviewers can inspect key/team/deployment changes from the UI.

## Backend API Gaps To Track

- Admin identity endpoint returning current key/user capabilities.
- Dedicated role/membership assignment UX helpers beyond the generic
  membership endpoint.
- Directory group discovery and group-to-org/team/role mapping APIs.
- Manual sync preview, sync run list/history, and conflict resolution
  APIs.
- Deployment test endpoint and backend validation for last-active
  deployment protection.
- Credential reference CRUD/validation endpoints.
- Raw paginated request-log JSON endpoint, or expanded aggregate usage
  endpoints for the Usage screen.
- Provider health/cooldown/routing attempt detail endpoints.
- Cache metrics/configuration/purge endpoints.
- Audit log event model and read API.
- Pricing management APIs for editing model prices from the console.

## Feature Discipline

Features intentionally deferred unless future backend plans require them:

- User-facing playground/chat console.
- Provider marketplace or plugin installation UI.
- Prompt library, prompt testing, or prompt tracing.
- SSO/SAML/OIDC sign-in administration beyond the planned Azure
  AD/Microsoft Entra ID user/group sync unless enterprise login is added
  to the backend roadmap.
- Advanced billing, invoices, chargeback, or customer-facing accounting.
- Raw request/response body browsing.
- Fine-grained custom RBAC beyond the platform admin, gateway admin, team
  owner, auditor, and end-user roles described here.

## Testing And Verification

- Unit test shared API client behavior, auth guards, reducers/state
  helpers, and formatting helpers.
- Component test key workflows, team workflows, table filters, and
  destructive-action dialogs.
- Component test organization hierarchy editing, user membership changes,
  directory sync preview, sync execution results, and conflict resolution.
- End-to-end test the critical path: sign in, create team, create key,
  copy one-time secret, rotate key, revoke key, and inspect usage.
- Add visual regression coverage for dense tables, empty states, error
  states, and mobile/tablet breakpoints.
- Run UI typecheck, lint, build, and test suite before merging each UI
  phase.
- Run core typecheck and tests after backend API changes that support UI
  work.

## Out Of Scope For First UI Release

- Prompt/response body inspection.
- Self-service non-admin user portal.
- Billing invoices or chargeback accounting.
- Plugin marketplace management.
- Multi-tenant white-label branding.
- Mobile-first administration beyond responsive access to core workflows.
