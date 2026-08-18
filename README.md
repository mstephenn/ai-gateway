# AI Gateway

An open-source, pluggable AI gateway: one OpenAI-compatible API in front
of multiple LLM providers, with virtual-key management, budgets and rate
limits, organization/team hierarchy, and an admin console — built to
match this project's own operational needs rather than a broad
speculative feature catalog. See `PRODUCT_ROADMAP.md` for the product
thesis and release scope, `ROADMAP.md` for engineering phases, and
`UI_ROADMAP.md` for the admin console's use cases and delivery phases.

## Packages

| Package | What it is |
| --- | --- |
| `packages/core` | The gateway service itself — Fastify + Prisma + Redis. OpenAI-compatible `/v1/chat/completions`, `/v1/embeddings`, `/v1/models`, and the full `/admin/*` surface (deployments, teams, keys, org/users, usage, provider credentials, overview). |
| `packages/plugin-sdk` | The stable, semver'd contract (`Provider`, `MiddlewarePlugin`, `RoutingStrategyPlugin`, request/response types) third-party plugins depend on, so they don't couple to core's internals. |
| `packages/shared` | Browser-safe DTO/request types shared between `packages/core`'s admin routes and `packages/ui`, so the frontend never imports Prisma Client or redefines backend shapes locally. |
| `packages/ui` | The admin console — a TanStack Start/React app. Talks to a real backend when `VITE_API_BASE_URL` is set, otherwise falls back to local mock fixtures for UI-only development. |

## Providers

Anthropic, OpenAI, Azure OpenAI, AWS Bedrock, and Google Gemini ship
today. Credentials can be configured two ways:

- **Environment variables** (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_REGION`,
  `AZURE_OPENAI_API_KEY`/`AZURE_OPENAI_RESOURCE_NAME`/`AZURE_OPENAI_API_VERSION`,
  `GEMINI_API_KEY`) — read once at boot. A deployment references these
  with `credentialsRef: "env:<provider>"`.
- **The admin console's Providers screen** — named, AES-256-GCM
  encrypted credentials stored in Postgres, editable at runtime with no
  restart. A deployment references one by its credential id.

Neither is required to boot the service — deployments referencing an
unconfigured credential simply fail per-request with a normal upstream
error, the same as any other provider outage.

## Quickstart

**Prerequisites:** Node ≥ 22, pnpm, Docker (for local Postgres/Redis).

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Start local Postgres and Redis:

   ```sh
   docker compose up -d
   ```

3. Configure `packages/core/.env`:

   ```sh
   DATABASE_URL="postgresql://ai_gateway:ai_gateway@localhost:5432/ai_gateway?schema=public"
   REDIS_URL="redis://localhost:6379"
   ADMIN_BOOTSTRAP_KEY="<pick a value — this becomes your first admin bearer key>"
   CREDENTIAL_ENCRYPTION_KEY="<64 hex chars — only needed once you use the Providers screen>"
   # Optional: restrict admin API CORS origins in production. In dev it defaults to allowing all origins.
   # CORS_ALLOWED_ORIGINS="http://localhost:8080"
   # Optional: at least one provider's env vars, if you'd rather not use the Providers screen.
   ```

   Generate a `CREDENTIAL_ENCRYPTION_KEY`:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. Push the Prisma schema to your local database:

   ```sh
   pnpm --filter core exec prisma db push
   ```

5. Run the gateway and the admin console:

   ```sh
   pnpm dev      # core service, http://localhost:4000
   pnpm dev:ui   # admin console, http://localhost:8080 (or the next free port)
   ```

6. In `packages/ui`, point the console at your local backend with a
   `.env.local`:

   ```sh
   VITE_API_BASE_URL="http://localhost:4000"
   ```

   Sign in with the `ADMIN_BOOTSTRAP_KEY` value from step 3.

## Development

```sh
pnpm test        # every package's test suite
pnpm typecheck   # every package's typecheck
pnpm lint        # every package's lint (packages/core, /shared, /plugin-sdk)
pnpm build       # every package's build
```

Run `pnpm test`, `pnpm typecheck`, and `pnpm lint` before opening a PR —
CI expects all three clean.

## Docs

- `ROADMAP.md` — engineering phases, dependency order, what's shipped vs. planned.
- `UI_ROADMAP.md` — admin console use cases, information architecture, delivery phases.
- `PRODUCT_ROADMAP.md` — product thesis and release scope.
- `docs/superpowers/specs/` — design specs for individual features.
- `docs/superpowers/plans/` — implementation plans that executed those specs.
- `AGENTS.md` / `CLAUDE.md` — how AI coding agents are expected to work in this repo (planning process, parallel execution, model tiers, verification).
