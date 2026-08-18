# AI Gateway — Admin Console

The admin console for the AI Gateway: sign-in, deployments/models,
providers, teams, keys, organization/users, usage, and overview. Built
with TanStack Start, React, and Tailwind CSS. See the repo root
`README.md` for the full project overview and `../../UI_ROADMAP.md` for
this console's use cases and delivery phases.

## Development

```sh
pnpm dev
```

By default the console runs against local mock fixtures under
`src/lib/mock-data/`. To point it at a real backend, set
`VITE_API_BASE_URL` (e.g. in a `.env.local` in this directory) to the
running `packages/core` service's URL — see the root `README.md`'s
Quickstart for spinning that up.

## Structure

- `src/routes/` — file-based routes (`_authenticated.*.tsx` are the
  authenticated console screens; `index.tsx` is sign-in).
- `src/lib/api/` — the API client layer. Each module (`keys.ts`,
  `teams.ts`, `models.ts`, `credentials.ts`, ...) exposes the same
  functions whether a backend is configured or not — real calls when
  `VITE_API_BASE_URL` is set, simulated latency over mock fixtures
  otherwise. `src/lib/api/client.ts` holds the shared `apiRequest`/
  `apiList` helpers and the `hasBackendApi()` check.
- `src/lib/mock-data/` — fixtures and the standalone types the mock path
  uses; the real-backend path maps `@ai-gateway/shared` DTOs onto these
  same shapes.
- `src/components/console/` — the app shell (sidebar nav, header) and
  shared table/drawer/dialog primitives reused across every screen.

## Commands

```sh
pnpm dev         # dev server
pnpm build       # production build
pnpm test        # vitest — API client layer
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
```
