import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticate } from "../../auth/authenticate.js";
import type { DbClient } from "../../db/client.js";
import {
  ForbiddenError,
  statusForError,
  UnauthorizedError,
  ValidationError,
} from "../../errors.js";

export interface AdminUsageRouteDeps {
  db: DbClient;
}

type GroupBy = "key" | "team" | "model";
type Bucket = "day" | "hour";

interface UsageQuery {
  groupBy?: string;
  start?: string;
  end?: string;
}

interface UsageBucketQuery {
  start?: string;
  end?: string;
  bucket?: string;
}

interface ApiKeyWithTeam {
  id: string;
  name: string | null;
  keyPrefix: string;
  teamId: string | null;
  team: { id: string; name: string } | null;
}

interface RequestLogWithKey {
  id: string;
  apiKeyId: string;
  modelName: string;
  deploymentId: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  status: number;
  createdAt: Date;
  apiKey: ApiKeyWithTeam | null;
}

interface Aggregate {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  const status = statusForError(err);
  return reply
    .status(status)
    .send({ error: err instanceof Error ? err.message : "internal_error" });
}

function extractBearerToken(request: {
  headers: { authorization?: string };
}): string | undefined {
  const authHeader = request.headers.authorization;
  return authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : undefined;
}

function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`invalid date: ${value}`);
  }
  return parsed;
}

function decimalToNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (
    value &&
    typeof (value as { toNumber: () => number }).toNumber === "function"
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return 0;
}

function createAggregate(): Aggregate {
  return {
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
  };
}

function addLogToAggregate(
  agg: Aggregate,
  log: RequestLogWithKey,
  priceMap: Map<string, { input: number; output: number }>,
): void {
  const inputTokens = log.inputTokens ?? 0;
  const outputTokens = log.outputTokens ?? 0;

  agg.requestCount += 1;
  agg.inputTokens += inputTokens;
  agg.outputTokens += outputTokens;
  agg.totalTokens += inputTokens + outputTokens;

  const price = priceMap.get(log.modelName);
  if (price) {
    agg.estimatedCost +=
      inputTokens * price.input + outputTokens * price.output;
  }
}

function groupKeyForLog(log: RequestLogWithKey, groupBy: GroupBy): string {
  if (groupBy === "model") {
    return log.modelName;
  }
  if (groupBy === "team") {
    return log.apiKey?.teamId ?? "(no team)";
  }
  return log.apiKeyId;
}

function bucketKeyForDate(date: Date, bucket: Bucket): string {
  const iso = date.toISOString();
  if (bucket === "hour") {
    return `${iso.slice(0, 13)}:00:00.000Z`;
  }
  return iso.slice(0, 10);
}

function buildPriceMap(
  pricing: {
    modelName: string;
    inputTokenPrice: unknown;
    outputTokenPrice: unknown;
  }[],
): Map<string, { input: number; output: number }> {
  const map = new Map<string, { input: number; output: number }>();
  for (const price of pricing) {
    map.set(price.modelName, {
      input: decimalToNumber(price.inputTokenPrice),
      output: decimalToNumber(price.outputTokenPrice),
    });
  }
  return map;
}

async function fetchLogsWithKeys(
  db: DbClient,
  where: { apiKeyId?: string; createdAt: { gte: Date; lte: Date } },
): Promise<RequestLogWithKey[]> {
  const logs = (await db.requestLog.findMany({
    where,
    orderBy: { createdAt: "asc" },
  })) as Array<{
    id: string;
    apiKeyId: string;
    modelName: string;
    deploymentId: string | null;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    status: number;
    createdAt: Date;
  }>;

  const keyIds = [...new Set(logs.map((log) => log.apiKeyId))];
  const keys = keyIds.length
    ? ((await db.apiKey.findMany({
        where: { id: { in: keyIds } },
        include: { team: true },
      })) as ApiKeyWithTeam[])
    : [];
  const keyMap = new Map(keys.map((key) => [key.id, key]));

  return logs.map((log) => ({
    ...log,
    apiKey: keyMap.get(log.apiKeyId) ?? null,
  }));
}

export function registerAdminUsageRoute(
  app: FastifyInstance,
  deps: AdminUsageRouteDeps,
): void {
  app.get("/admin/usage", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }

      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const query = request.query as UsageQuery;
      const groupBy = query.groupBy as GroupBy | undefined;
      if (!groupBy || !["key", "team", "model"].includes(groupBy)) {
        return reply
          .status(400)
          .send({ error: "groupBy must be one of key, team, or model" });
      }

      const now = new Date();
      const end = parseDate(query.end, now);
      const start = parseDate(
        query.start,
        new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      );

      const [logs, pricing] = await Promise.all([
        fetchLogsWithKeys(deps.db, {
          createdAt: { gte: start, lte: end },
        }),
        deps.db.modelPricing.findMany(),
      ]);

      const priceMap = buildPriceMap(pricing);
      const groups = new Map<string, { label: string; aggregate: Aggregate }>();

      for (const log of logs) {
        const key = groupKeyForLog(log, groupBy);
        let entry = groups.get(key);
        if (!entry) {
          let label = key;
          if (groupBy === "key") {
            label = log.apiKey?.name ?? log.apiKey?.keyPrefix ?? key;
          } else if (groupBy === "team") {
            label = log.apiKey?.team?.name ?? "(no team)";
          } else if (groupBy === "model") {
            label = log.modelName;
          }
          entry = { label, aggregate: createAggregate() };
          groups.set(key, entry);
        }
        addLogToAggregate(entry.aggregate, log, priceMap);
      }

      const data = Array.from(groups.entries()).map(
        ([groupValue, { label, aggregate }]) => ({
          groupValue,
          label,
          ...aggregate,
        }),
      );

      return reply.status(200).send({
        object: "list",
        groupBy,
        start: start.toISOString(),
        end: end.toISOString(),
        data,
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/admin/usage/keys/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }

      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const query = request.query as UsageBucketQuery;
      const bucket = (query.bucket === "hour" ? "hour" : "day") as Bucket;

      const now = new Date();
      const end = parseDate(query.end, now);
      const start = parseDate(
        query.start,
        new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      );

      const [logs, pricing] = await Promise.all([
        fetchLogsWithKeys(deps.db, {
          apiKeyId: id,
          createdAt: { gte: start, lte: end },
        }),
        deps.db.modelPricing.findMany(),
      ]);

      const priceMap = buildPriceMap(pricing);
      const buckets = new Map<string, Aggregate>();

      for (const log of logs) {
        const key = bucketKeyForDate(log.createdAt, bucket);
        let agg = buckets.get(key);
        if (!agg) {
          agg = createAggregate();
          buckets.set(key, agg);
        }
        addLogToAggregate(agg, log, priceMap);
      }

      const data = Array.from(buckets.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([bucketStart, aggregate]) => ({
          bucketStart,
          ...aggregate,
        }));

      return reply.status(200).send({
        object: "list",
        apiKeyId: id,
        bucket,
        start: start.toISOString(),
        end: end.toISOString(),
        data,
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/admin/usage/export", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }

      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const query = request.query as {
        format?: string;
        start?: string;
        end?: string;
      };
      if (query.format !== "csv") {
        return reply.status(400).send({ error: "format must be csv" });
      }

      const now = new Date();
      const end = parseDate(query.end, now);
      const start = parseDate(
        query.start,
        new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      );

      const logs = await deps.db.requestLog.findMany({
        where: {
          createdAt: {
            gte: start,
            lte: end,
          },
        },
        orderBy: { createdAt: "asc" },
      });

      const rows = [
        [
          "timestamp",
          "apiKeyId",
          "modelName",
          "deploymentId",
          "status",
          "latencyMs",
          "inputTokens",
          "outputTokens",
        ],
        ...logs.map((log) => [
          log.createdAt.toISOString(),
          log.apiKeyId,
          log.modelName,
          log.deploymentId ?? "",
          String(log.status),
          String(log.latencyMs),
          String(log.inputTokens ?? ""),
          String(log.outputTokens ?? ""),
        ]),
      ];

      const csv = rows
        .map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
        )
        .join("\n");

      return reply
        .status(200)
        .header("content-type", "text/csv")
        .header("content-disposition", 'attachment; filename="usage.csv"')
        .send(csv);
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
