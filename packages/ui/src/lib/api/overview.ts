import type { AdminOverviewDto } from "@ai-gateway/shared";
import { overviewMetrics } from "../mock-data/fixtures";
import type { OverviewMetrics } from "../mock-data/types";
import { apiRequest, hasBackendApi, simulate } from "./client";

function rangeToQuery(range: string): { start?: string; end?: string } {
  const end = new Date();
  const hours = range === "24h" ? 24 : range === "7d" ? 24 * 7 : 24 * 30;
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function fromBackend(dto: AdminOverviewDto): OverviewMetrics {
  return {
    requestVolume: dto.requestCount,
    requestVolumeDelta: 0,
    totalTokens: dto.totalTokens,
    totalTokensDelta: 0,
    errorRate: dto.errorRate,
    errorRateDelta: 0,
    p50LatencyMs: dto.p50LatencyMs,
    p95LatencyMs: dto.p95LatencyMs,
    latencyDelta: 0,
    series: [],
    topModels: dto.topModels.map((m) => ({
      model: m.label,
      requests: m.requestCount,
      tokens: 0,
      errorRate: 0,
    })),
    topTeams: dto.topTeams.map((t) => ({
      team: t.label,
      requests: t.requestCount,
      tokens: 0,
      budgetUsed: 0,
    })),
    providerHealth: [],
  };
}

export function getOverviewMetrics(range: string): Promise<OverviewMetrics> {
  if (hasBackendApi()) {
    return apiRequest<AdminOverviewDto>("/admin/overview", { query: rangeToQuery(range) }).then(
      fromBackend,
    );
  }
  const factor = range === "24h" ? 1 : range === "7d" ? 6.4 : 24.5;
  return simulate<OverviewMetrics>({
    ...overviewMetrics,
    requestVolume: Math.round(overviewMetrics.requestVolume * factor),
    totalTokens: Math.round(overviewMetrics.totalTokens * factor),
  });
}
