import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

import type { BudgetChecker } from "./budget/budget.js";
import type { ResponseCache } from "./cache/responseCache.js";
import type { DbClient } from "./db/client.js";
import type { PluginRegistry } from "./plugins/registry.js";
import type { RateLimiter } from "./rateLimiter/rateLimiter.js";
import type { Router, RedisLike } from "./router/router.js";
import { registerAdminCredentialsRoute } from "./routes/admin/credentials.js";
import { registerAdminDeploymentsRoute } from "./routes/admin/deployments.js";
import { registerAdminDirectorySyncRoute } from "./routes/admin/directorySync.js";
import { registerAdminGuardrailsRoute } from "./routes/admin/guardrails.js";
import { registerAdminKeysRoute } from "./routes/admin/keys.js";
import { registerAdminMeRoute } from "./routes/admin/me.js";
import { registerAdminMembershipsRoute } from "./routes/admin/memberships.js";
import { registerAdminOrganizationsRoute } from "./routes/admin/organizations.js";
import { registerAdminOrgUnitsRoute } from "./routes/admin/orgUnits.js";
import { registerAdminOverviewRoute } from "./routes/admin/overview.js";
import { registerAdminRolesRoute } from "./routes/admin/roles.js";
import { registerAdminTeamsRoute } from "./routes/admin/teams.js";
import { registerAdminUsageRoute } from "./routes/admin/usage.js";
import { registerAdminUsersRoute } from "./routes/admin/users.js";
import { registerChatCompletionsRoute } from "./routes/chatCompletions.js";
import { registerEmbeddingsRoute } from "./routes/embeddings.js";
import { registerModelsRoute } from "./routes/models.js";
import type { Provider } from "./types/provider.js";

export interface AppDeps {
  db: DbClient;
  router: Router;
  providers: Map<string, Provider>;
  pluginRegistry: PluginRegistry;
  cache?: ResponseCache;
  rateLimiter?: RateLimiter;
  budgetChecker?: BudgetChecker;
  redis: RedisLike;
}

function parseCorsOrigins(): boolean | string[] {
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  if (!raw) {
    return true;
  }
  return raw.split(",").map((origin) => origin.trim());
}

export async function buildApp(deps?: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: parseCorsOrigins(),
    credentials: true,
  });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  if (deps) {
    registerModelsRoute(app, deps);
    registerChatCompletionsRoute(app, deps);
    registerEmbeddingsRoute(app, deps);
    registerAdminTeamsRoute(app, deps);
    registerAdminKeysRoute(app, deps);
    registerAdminDeploymentsRoute(app, deps);
    registerAdminCredentialsRoute(app, {
      db: deps.db,
      registry: deps.pluginRegistry,
      providers: deps.providers,
      encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY,
    });
    registerAdminUsageRoute(app, deps);
    registerAdminOrganizationsRoute(app, deps);
    registerAdminOrgUnitsRoute(app, deps);
    registerAdminRolesRoute(app, deps);
    registerAdminUsersRoute(app, deps);
    registerAdminMembershipsRoute(app, deps);
    registerAdminDirectorySyncRoute(app, deps);
    registerAdminGuardrailsRoute(app, deps);
    registerAdminMeRoute(app, deps);
    registerAdminOverviewRoute(app, deps);
  }

  return app;
}
