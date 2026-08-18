import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticate } from "../../auth/authenticate.js";
import type { DbClient } from "../../db/client.js";
import {
  statusForError,
  UnauthorizedError,
  ForbiddenError,
} from "../../errors.js";
import { getDeploymentHealth } from "../../router/deploymentHealth.js";
import type { RedisLike } from "../../router/router.js";

export interface AdminOverviewRouteDeps {
  db: DbClient;
  redis: RedisLike;
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

function percentile(sortedLatencies: number[], p: number): number {
  if (sortedLatencies.length === 0) {
    return 0;
  }
  const idx = Math.min(
    sortedLatencies.length - 1,
    Math.ceil((p / 100) * sortedLatencies.length) - 1,
  );
  return sortedLatencies[Math.max(0, idx)];
}

function topN(
  counts: Map<string, { label: string; count: number }>,
  n: number,
): { key: string; label: string; requestCount: number }[] {
  return Array.from(counts.entries())
    .map(([key, v]) => ({ key, label: v.label, requestCount: v.count }))
    .sort((a, b) => b.requestCount - a.requestCount)
    .slice(0, n);
}

export function registerAdminOverviewRoute(
  app: FastifyInstance,
  deps: AdminOverviewRouteDeps,
): void {
  app.get("/admin/overview", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const query = request.query as { start?: string; end?: string };
      const end = query.end ? new Date(query.end) : new Date();
      const start = query.start
        ? new Date(query.start)
        : new Date(end.getTime() - 24 * 60 * 60 * 1000);

      const logs = await deps.db.requestLog.findMany({
        where: { createdAt: { gte: start, lte: end } },
      });

      const requestCount = logs.length;
      const errorCount = logs.filter((l: any) => l.status >= 400).length;
      const errorRate = requestCount === 0 ? 0 : errorCount / requestCount;

      const latencies = logs
        .map((l: any) => l.latencyMs as number)
        .sort((a: number, b: number) => a - b);
      const p50LatencyMs = percentile(latencies, 50);
      const p95LatencyMs = percentile(latencies, 95);

      const inputTokens = logs.reduce(
        (sum: number, l: any) => sum + (l.inputTokens ?? 0),
        0,
      );
      const outputTokens = logs.reduce(
        (sum: number, l: any) => sum + (l.outputTokens ?? 0),
        0,
      );

      const nonStreaming = logs.filter((l: any) => l.stream === false);
      const cacheHits = nonStreaming.filter(
        (l: any) => l.cacheHit === true,
      ).length;
      const cacheHitRate =
        nonStreaming.length === 0 ? 0 : cacheHits / nonStreaming.length;

      const modelCounts = new Map<string, { label: string; count: number }>();
      for (const l of logs as any[]) {
        const entry = modelCounts.get(l.modelName) ?? {
          label: l.modelName,
          count: 0,
        };
        entry.count += 1;
        modelCounts.set(l.modelName, entry);
      }

      const deployments = await deps.db.deployment.findMany({
        select: { id: true },
      });
      const health = await getDeploymentHealth(
        deps.redis,
        deployments.map((d: any) => d.id),
      );
      const unhealthyDeploymentIds = Array.from(health.entries())
        .filter(([, status]) => status === "cooldown")
        .map(([id]) => id);

      const apiKeys = await deps.db.apiKey.findMany({
        where: { budgetLimit: { not: null } },
      });
      const teams = await deps.db.team.findMany({
        where: { budgetLimit: { not: null } },
      });
      const budgetPressure = [
        ...apiKeys
          .filter((k: any) => Number(k.spent) / Number(k.budgetLimit) >= 0.8)
          .map((k: any) => ({
            scope: "key" as const,
            id: k.id,
            label: k.name ?? k.id,
            spent: String(k.spent),
            budgetLimit: String(k.budgetLimit),
          })),
        ...teams
          .filter((t: any) => Number(t.spent) / Number(t.budgetLimit) >= 0.8)
          .map((t: any) => ({
            scope: "team" as const,
            id: t.id,
            label: t.name,
            spent: String(t.spent),
            budgetLimit: String(t.budgetLimit),
          })),
      ];

      return reply.status(200).send({
        start: start.toISOString(),
        end: end.toISOString(),
        requestCount,
        errorRate,
        p50LatencyMs,
        p95LatencyMs,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cacheHitRate,
        topModels: topN(modelCounts, 5),
        topTeams: [],
        unhealthyDeploymentIds,
        budgetPressure,
        rateLimitPressure: null,
        rateLimitPressureNote:
          "Live RPM/TPM pressure requires a read API into the rate limiter's Redis counters, not yet available.",
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
