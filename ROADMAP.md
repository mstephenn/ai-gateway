# Roadmap

An open-source, pluggable AI gateway for multi-provider LLM proxying,
virtual key management, admin operations, and enterprise organization
hierarchy. The product is intentionally focused on the providers and
administrative workflows this project needs, rather than a broad
speculative feature surface.

Each phase below is an independently shippable sub-project with its own
design spec under `docs/superpowers/specs/`. Phases are ordered by
dependency, but several phases depend only on Phase 1 and can be built
in parallel once Phase 1 is complete.

For product packaging and release scope, see `PRODUCT_ROADMAP.md`. For
the admin console use cases and UI delivery phases, see `UI_ROADMAP.md`.

## Guiding principles

- **Pluggable by default** — providers, middleware, and routing
  strategies are all extensible via npm packages against a stable
  `@ai-gateway/plugin-sdk` contract, not internal-only extension points.
- **OpenAI-compatible API surface** — existing OpenAI SDK clients work
  against this gateway without modification.
- **No feature beyond what's proven needed** — built to match this
  project's own real usage first, extended from there, not built around a
  speculative provider or feature catalog.
- **Shared contracts in the monorepo** — frontend and backend API
  payloads should be typed through `@ai-gateway/shared`; Prisma remains
  the backend data source, while the browser consumes serialized DTOs
  instead of importing Prisma Client or redefining backend shapes locally.

## Phase 1: Core gateway

**Status: complete** (`2026-08-17-typescript-ai-gateway-core-design.md`)

Multi-provider chat-completions proxying (AWS Bedrock, Azure OpenAI,
OpenAI, Anthropic) behind one OpenAI-compatible API, with database-backed
deployment routing, load balancing, and automatic fallback. Minimal
bearer-token auth — no budgets, teams, or rate limits yet. The plugin
architecture (providers, middleware, routing strategies) ships as part
of this phase, since it shapes how every later phase's own logic is
expected to hook in.

## Phase 2: Resilience & API completeness

**Status: complete**

**Depends on:** Phase 1

Three independent workstreams implemented in parallel:

1. **Retries + timeouts** — configurable per-deployment request timeout
   and retry-with-backoff before falling back to another deployment.
2. **`GET /v1/models`** — list available models from the `deployments`
   table.
3. **Redis exact-match prompt cache** — cache non-streaming chat
   completions in Redis with a configurable TTL.

## Phase 3: Virtual key management

**Status: complete**

**Depends on:** Phase 1

Full key lifecycle on top of Phase 1's flat bearer-token check:

- `Team` model and admin endpoints (`POST /admin/teams`, `GET /admin/teams`).
- Key admin endpoints (`POST /admin/keys`, `GET /admin/keys`, `DELETE /admin/keys/:id`, `POST /admin/keys/:id/rotate`).
- Keys are returned raw only at creation/rotation; only hashes and prefixes are stored.
- Expired keys are rejected at auth time.
- Per-key RPM and TPM rate limiting enforced in the chat-completions route via Redis.
- Per-key budget enforcement using the `model_pricing` table.

This is where "teams" as a first-class concept enters the data model,
which Phase 5 builds on.

## Phase 4: Admin backend surface

**Status: complete**

**Depends on:** Phase 2 and Phase 3

Backend admin endpoints for managing deployments and viewing usage:

- `GET /admin/deployments`, `POST /admin/deployments`, `GET /admin/deployments/:id`, `PATCH /admin/deployments/:id`, `DELETE /admin/deployments/:id`.
- `GET /admin/usage?groupBy=key|team|model` and `GET /admin/usage/keys/:id` for time-bucketed usage.

The admin dashboard UI is intentionally scoped as a separate frontend package
and is not part of this phase.

## Phase 5: Org/team hierarchy

**Status: complete**

**Depends on:** Phase 3

Organization and user-management model layered on top of the team/key model:

- Prisma models: `Role`, `Organization`, `OrgUnit`, `User`, `Membership`, `DirectorySyncConfig`, `DirectorySyncRun`, `DirectorySyncChange`.
- Default roles seeded on startup: `platform_admin`, `gateway_admin`, `team_owner`, `auditor`, `end_user`.
- Admin endpoints:
  - `/admin/organization` (singleton CRUD).
  - `/admin/org-units` (hierarchy CRUD, flat/tree list).
  - `/admin/roles` (list).
  - `/admin/users` (CRUD, deactivate/reactivate).
  - `/admin/memberships` (assign/remove roles in org units).
  - `/admin/directory-sync/config` and `/admin/directory-sync/config/:id/run` (Azure AD sync preview/apply with change logs).
- Existing `Team` model preserved for key ownership; org units of type `team` can reference a team.
- Admin routes remain gated by a valid bearer token only (no enterprise-only restrictions).

## Phase 6: Cost tracking, spend limits & model access control

**Status: complete**

**Depends on:** Phase 3 and Phase 5

Dollar-cost governance built on the `model_pricing` table and team model:

- `Team.budgetLimit` and `Team.spent` for team-level dollar budgets.
- `BudgetChecker` now checks and records spend against both the key and its team.
- `ApiKey.allowedModels` and `Team.allowedModels` for model access control; empty means all models allowed.
- `POST /v1/chat/completions` rejects requests for models not in the allowed lists.
- `PATCH /admin/teams/:id` and `PATCH /admin/keys/:id` expose budget and allowed-model editing.
- `GET /admin/usage/export?format=csv` returns a CSV of request logs.

## Phase 7: Embeddings endpoint

**Status: complete**

**Depends on:** Phase 1 and Phase 2 (provider interface and resilience patterns); Phase 6 for model access and spend-limit enforcement.

Extend the provider plugin interface to support `POST /v1/embeddings`
and implement it for the supported providers. Keeps the same fallback,
cooldown, retry, and timeout semantics as chat completions.

- New `EmbeddingRequest`, `Embedding`, and `EmbeddingResponse` types exported from `@ai-gateway/plugin-sdk`.
- Optional `Provider.embeddings(req, deployment)` method; router's `executeEmbeddings` uses the same fallback logic as chat completions.
- Implemented for OpenAI (`/v1/embeddings`) and Azure OpenAI (deployment-scoped embeddings endpoint).
- `POST /v1/embeddings` enforces bearer auth, model access lists, RPM/TPM rate limits, and key/team budgets before proxying.
- Request logging mirrors the chat-completions route.

## Phase 8: Provider expansion & observability

**Status: complete**

**Depends on:** Phase 1 and Phase 3 (middleware plugin hooks); Phase 7's
`RequestContext.body` extension.

Two independent workstreams:

1. **Google / Gemini provider** — new provider plugin using the existing
   `Provider` interface. Maps OpenAI chat messages to Gemini's
   `generateContent` / `streamGenerateContent` REST endpoints and back to
   OpenAI-shaped responses/chunks.
2. **Observability integrations** — made the existing middleware plugin
   contract operational:
   - `PluginRegistry.runOnResponse` chains `onResponse` handlers.
   - New built-in `webhook-observability` middleware POSTs request/response
     metadata to a configurable URL (`OBSERVABILITY_WEBHOOK_URL`) with
     optional headers (`OBSERVABILITY_WEBHOOK_HEADERS`). Works with any
     HTTP ingestion endpoint (Langfuse, Helicone, LangSmith, etc.).
   - `POST /v1/chat/completions` and `POST /v1/embeddings` run middleware
     `onRequest` (can short-circuit) and `onResponse` (can transform the
     non-streaming response). Streaming responses skip `onResponse` because
     bytes are already piped to the client.

## Phase 9: Function calling / tool use

**Status: complete**

**Depends on:** Phase 1 and Phase 8 (Gemini provider; tool shapes differ by
provider).

Extend the chat completion request/response shapes to support OpenAI-style
`tools` / `tool_choice` and normalize tool-call request/response formats
across OpenAI, Anthropic, Gemini, and Bedrock. Each provider implementation
owns translating the OpenAI tool shape into its native format and back.

- `ChatMessage.content` is now `string | null` (assistant tool-call turns
  carry `null` content), plus new `tool_calls` and `tool_call_id` fields.
- New `Tool`, `ToolFunction`, `ToolCall`, and `ToolChoice` types on
  `ChatCompletionRequest`/`ChatCompletionResponse`, re-exported from
  `@ai-gateway/plugin-sdk` alongside the existing chat types.
- OpenAI passes `tools`/`tool_choice` straight through (already
  OpenAI-shaped); Azure OpenAI forwards them the same way.
- Anthropic translates OpenAI tool defs to `input_schema`, tool calls to/from
  `tool_use`/`tool_result` content blocks, and `stop_reason: "tool_use"` to
  `finish_reason: "tool_calls"`.
- Bedrock reuses Anthropic's translation helpers (same message shape on
  Bedrock's Anthropic-compatible Messages API).
- Gemini maps tool defs to `functionDeclarations`, tool calls to/from
  `functionCall`/`functionResponse` parts, and `tool_choice` to
  `functionCallingConfig.mode`.

## Phase 10: Guardrails

**Status: not started**

**Depends on:** Phase 1 and Phase 8 (middleware hooks).

Built-in safety layer implemented as middleware plugins so users can mix
and match rules without touching core request handling:

- **PII masking** — regex/pattern redaction for emails, phone numbers,
  credit cards, SSNs in request messages.
- **Keyword blocking** — configurable block lists/allow lists that reject
  or redact requests before they reach a provider.
- **Content moderation** — optional integration with OpenAI Moderation API
  or a local scoring endpoint.

## Phase 11: Semantic caching

**Status: not started**

**Depends on:** Phase 2 (exact-match cache and Redis infrastructure) and
Phase 7 (embeddings endpoint used to compute cache keys).

Add a similarity-based response cache backed by Redis. Before calling a
provider, embed the request messages (using the configured embedding model),
search for a nearby cached response above a similarity threshold, and return
it when found. Invalidation and TTL reuse the same Redis primitives as the
Phase 2 exact-match cache.

## Phase 12: Additional providers

**Status: not started**

**Depends on:** Phase 1.

Independent provider plugins, each implementing the same `Provider`
interface:

- Groq
- Cohere
- Ollama
- vLLM (OpenAI-compatible server)
- Together AI

Each provider can be developed and tested in parallel once the interface is
stable.

## Phase 13: Advanced routing strategies

**Status: not started**

**Depends on:** Phase 2 (resilience and weighted-random routing baseline).

Alternative deployment-selection strategies exposed as routing plugins:

- Latency-based routing (track recent p99 latency per deployment).
- Cost-based routing (prefer cheaper deployments when quality is
  acceptable).
- Priority / queue-based routing for tiered traffic.

## Phase 14: Multimodal endpoints

**Status: not started**

**Depends on:** Phase 1.

OpenAI-compatible endpoints beyond chat and embeddings:

- `POST /v1/images/generations`
- `POST /v1/audio/speech`
- `POST /v1/audio/transcriptions`

Each endpoint is provider-dependent; implement initially for OpenAI and
Azure OpenAI, then extend to other providers that support them.

## Dependency map

```
Phase 1 ─┬─► Phase 2 ─┐
         │            │
         ├─► Phase 3 ─┼─► Phase 4
         │       │    │
         │       └────┼─► Phase 5
         │            │
         │            └─► Phase 6 ─┐
         │                         │
         ├─► Phase 7 ◄─────────────┘
         │            │
         │            ▼
         │       Phase 11 ◄── Phase 2
         │            │
         ├─► Phase 8 ─┤
         │            │
         │            ▼
         │       Phase 9 (tools)
         │            │
         │            ▼
         │      Phase 10 (guardrails)
         │            │
         ├─► Phase 12 (more providers)
         │
         ├─► Phase 13 (advanced routing)
         │
         └─► Phase 14 (multimodal)
```

**Parallel-safe batches:**

- After Phase 1: Phase 2, Phase 3, Phase 8, Phase 12, Phase 13, and Phase
  14 can all start in parallel. Phase 2's three sub-tasks are also
  parallel-safe.
- After Phase 3: Phase 4, Phase 5, and Phase 6 can run in parallel.
- After Phase 6: Phase 7 can start.
- After Phase 7 and Phase 2: Phase 11 can start.
- After Phase 8: Phase 9 and Phase 10 can run in parallel.
- Phase 12's individual providers can be built in parallel with each other.

## Explicitly not roadmapped yet

- Plugin sandboxing/process isolation (deferred in the Phase 1 spec —
  revisit if the plugin ecosystem grows to include untrusted third-party
  code).
- Provider-native pass-through endpoints and `/utils/transform_request`
  debugging (can be added as a Phase 14.x follow-up).
- SSO/SAML, audit logs, and RBAC beyond the flat bearer-token admin model
  (enterprise-only features are intentionally out of scope for this
  open-source roadmap).
