import { createHash } from "node:crypto";

import { Redis } from "ioredis";

import { createBudgetChecker, type BudgetChecker } from "./budget/budget.js";
import {
  createResponseCache,
  type ResponseCache,
} from "./cache/responseCache.js";
import { decryptConfig } from "./credentials/encryption.js";
import { createDbClient, type DbClient } from "./db/client.js";
import { fetchHttpClient, type HttpClient } from "./http/httpClient.js";
import { ensureDefaultRoles } from "./org/roles.js";
import { loadGuardrails } from "./plugins/guardrails/loadGuardrails.js";
import {
  createWebhookObservabilityMiddleware,
  type WebhookObservabilityConfig,
} from "./plugins/observability.js";
import { createPluginRegistry } from "./plugins/registry.js";
import type { PluginRegistry } from "./plugins/registry.js";
import { createAnthropicProvider } from "./providers/anthropic.js";
import {
  createAzureOpenAIProvider,
  type AzureOpenAIConfig,
} from "./providers/azure-open-ai.js";
import {
  createBedrockProvider,
  type BedrockCredentials,
} from "./providers/bedrock.js";
import { createGeminiProvider } from "./providers/gemini.js";
import { createOpenAIProvider } from "./providers/openai.js";
import {
  createRateLimiter,
  type RateLimiter,
} from "./rateLimiter/rateLimiter.js";
import {
  createRouter,
  type Router,
  type RedisLike,
  type ResilienceDefaults,
} from "./router/router.js";
import type { Provider } from "./types/provider.js";

export interface GatewayDeps {
  db: DbClient;
  router: Router;
  providers: Map<string, Provider>;
  pluginRegistry: PluginRegistry;
  cache?: ResponseCache;
  rateLimiter?: RateLimiter;
  budgetChecker?: BudgetChecker;
  redis: RedisLike;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable "${name}"`);
  }
  return value;
}

function toRedisLike(redis: Redis): RedisLike {
  return {
    get: (key) => redis.get(key),
    set: async (key, value, ttlSeconds) => {
      await redis.set(key, value, "EX", ttlSeconds);
    },
    incr: async (key) => redis.incr(key),
  };
}

export type Env = Record<string, string | undefined>;

export interface BootstrapLogger {
  warn(message: string): void;
}

export function buildPluginRegistry(
  env: Env = process.env,
  httpClient: HttpClient = fetchHttpClient,
): PluginRegistry {
  const registry = createPluginRegistry();

  registry.registerProvider({
    name: "openai",
    createProvider: (config) =>
      createOpenAIProvider(httpClient, config as string),
  });
  registry.registerProvider({
    name: "anthropic",
    createProvider: (config) =>
      createAnthropicProvider(httpClient, config as string),
  });
  registry.registerProvider({
    name: "bedrock",
    createProvider: (config) =>
      createBedrockProvider(httpClient, config as BedrockCredentials),
  });
  registry.registerProvider({
    name: "azure-openai",
    createProvider: (config) =>
      createAzureOpenAIProvider(httpClient, config as AzureOpenAIConfig),
  });
  registry.registerProvider({
    name: "gemini",
    createProvider: (config) =>
      createGeminiProvider(httpClient, config as string),
  });

  const webhookUrl = env.OBSERVABILITY_WEBHOOK_URL;
  if (webhookUrl) {
    let headers: Record<string, string> | undefined;
    if (env.OBSERVABILITY_WEBHOOK_HEADERS) {
      try {
        headers = JSON.parse(env.OBSERVABILITY_WEBHOOK_HEADERS);
      } catch {
        console.error(
          "OBSERVABILITY_WEBHOOK_HEADERS is not valid JSON; ignoring",
        );
      }
    }
    const config: WebhookObservabilityConfig = { url: webhookUrl, headers };
    registry.registerMiddleware(
      createWebhookObservabilityMiddleware(httpClient, config),
    );
  }

  return registry;
}

export function buildProviders(
  registry: PluginRegistry,
  env: Env = process.env,
  logger: BootstrapLogger = console,
): Map<string, Provider> {
  const configured: [string, unknown][] = [
    ["openai", env.OPENAI_API_KEY || undefined],
    ["anthropic", env.ANTHROPIC_API_KEY || undefined],
    [
      "bedrock",
      env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_REGION
        ? ({
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            region: env.AWS_REGION,
          } satisfies BedrockCredentials)
        : undefined,
    ],
    [
      "azure-openai",
      env.AZURE_OPENAI_API_KEY &&
      env.AZURE_OPENAI_RESOURCE_NAME &&
      env.AZURE_OPENAI_API_VERSION
        ? ({
            apiKey: env.AZURE_OPENAI_API_KEY,
            resourceName: env.AZURE_OPENAI_RESOURCE_NAME,
            apiVersion: env.AZURE_OPENAI_API_VERSION,
          } satisfies AzureOpenAIConfig)
        : undefined,
    ],
    ["gemini", env.GEMINI_API_KEY || undefined],
  ];

  const instances = configured.flatMap<[string, Provider]>(([name, config]) => {
    if (config === undefined) {
      logger.warn(
        `Skipping provider "${name}": required environment variables are not set`,
      );
      return [];
    }
    const instance = registry.createProviderInstance(name, config);
    return instance ? [[`env:${name}`, instance]] : [];
  });

  return new Map(instances);
}

export async function loadDbProviders(
  registry: PluginRegistry,
  db: DbClient,
  keyHex: string | undefined,
  logger: BootstrapLogger = console,
): Promise<Map<string, Provider>> {
  if (!keyHex) {
    return new Map();
  }

  const rows = await db.providerCredential.findMany();
  const instances = new Map<string, Provider>();
  for (const row of rows) {
    try {
      const config = decryptConfig(
        row.configCiphertext,
        row.configIv,
        row.configAuthTag,
        keyHex,
      );
      const instance = registry.instantiate(row.provider, config);
      if (instance) {
        instances.set(row.id, instance);
      }
    } catch (err) {
      logger.warn(
        `Skipping provider credential "${row.id}" (${row.provider}): failed to decrypt — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return instances;
}

export async function ensureBootstrapAdminKey(
  db: DbClient,
  env: Env = process.env,
): Promise<void> {
  const bootstrapKey = env.ADMIN_BOOTSTRAP_KEY;
  if (!bootstrapKey) {
    return;
  }

  const keyHash = createHash("sha256").update(bootstrapKey).digest("hex");
  await db.apiKey.upsert({
    where: { keyHash },
    update: { isAdmin: true, isActive: true },
    create: {
      keyHash,
      keyPrefix: bootstrapKey.slice(0, 7),
      name: "bootstrap-admin",
      isAdmin: true,
      isActive: true,
    },
  });
}

function readResilienceConfig(env: Env): ResilienceDefaults {
  return {
    timeoutMs: parseInt(env.REQUEST_TIMEOUT_MS || "60000", 10),
    maxRetries: parseInt(env.DEPLOYMENT_MAX_RETRIES || "2", 10),
    backoffMs: parseInt(env.DEPLOYMENT_RETRY_BACKOFF_MS || "1000", 10),
  };
}

export async function bootstrap(): Promise<GatewayDeps> {
  const pluginRegistry = buildPluginRegistry(process.env, fetchHttpClient);
  const db = createDbClient(requireEnv("DATABASE_URL"));
  const envProviders = buildProviders(pluginRegistry, process.env, console);
  const dbProviders = await loadDbProviders(
    pluginRegistry,
    db,
    process.env.CREDENTIAL_ENCRYPTION_KEY,
    console,
  );
  const providers = new Map([...envProviders, ...dbProviders]);
  const redis = toRedisLike(new Redis(requireEnv("REDIS_URL")));
  await ensureDefaultRoles(db);
  await ensureBootstrapAdminKey(db, process.env);
  await loadGuardrails(db, pluginRegistry);
  const resilienceDefaults = readResilienceConfig(process.env);
  const router = createRouter(db, redis, providers, resilienceDefaults);

  const cacheTtlSeconds = parseInt(process.env.CACHE_TTL_SECONDS || "0", 10);
  const cache: ResponseCache | undefined =
    cacheTtlSeconds > 0
      ? createResponseCache(redis, cacheTtlSeconds)
      : undefined;
  const rateLimiter: RateLimiter = createRateLimiter(redis);
  const budgetChecker: BudgetChecker = createBudgetChecker(db);

  return {
    db,
    router,
    providers,
    pluginRegistry,
    cache,
    rateLimiter,
    budgetChecker,
    redis,
  };
}
