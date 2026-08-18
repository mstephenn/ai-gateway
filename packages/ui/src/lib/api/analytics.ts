import type { UsageFilters } from "./usage";
import { requestLogs } from "../mock-data/fixtures";
import type { AnalyticsMetrics, RequestLog } from "../mock-data/types";
import { apiRequest, hasBackendApi, simulate } from "./client";

const RANGE_HOURS: Record<UsageFilters["range"], number> = {
  "1h": 1,
  "24h": 24,
  "7d": 168,
  "30d": 720,
};

function rangeDates(range: UsageFilters["range"]): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - RANGE_HOURS[range] * 3600 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function filterLogs(filters: UsageFilters): RequestLog[] {
  const newest = Date.parse(requestLogs[0]?.createdAt ?? new Date().toISOString());
  const cutoff = newest - RANGE_HOURS[filters.range] * 3600 * 1000;
  return requestLogs.filter((log) => {
    if (Date.parse(log.createdAt) < cutoff) return false;
    if (filters.model !== "all" && log.model !== filters.model) return false;
    if (filters.teamId !== "all" && log.teamId !== filters.teamId) return false;
    if (filters.keyId !== "all" && log.keyId !== filters.keyId) return false;
    if (filters.status !== "all" && log.status !== filters.status) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay =
        `${log.id} ${log.model} ${log.teamName} ${log.keyPrefix} ${log.route}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function estimateCost(log: RequestLog): number {
  // Rough mock pricing per 1M tokens.
  const rates: Record<string, { input: number; output: number }> = {
    "gpt-4o-eu-primary": { input: 5.0, output: 15.0 },
    "claude-sonnet-prod": { input: 3.0, output: 15.0 },
    "mistral-large-internal": { input: 2.0, output: 6.0 },
    "llama-bedrock-batch": { input: 0.9, output: 0.9 },
    "embed-3-large": { input: 0.13, output: 0 },
  };
  const rate = rates[log.model] ?? { input: 3.0, output: 9.0 };
  return (log.inputTokens / 1_000_000) * rate.input + (log.outputTokens / 1_000_000) * rate.output;
}

function bucketLogs(logs: RequestLog[], range: UsageFilters["range"]): Map<string, RequestLog[]> {
  const bucketCount = range === "1h" ? 12 : range === "24h" ? 24 : range === "7d" ? 14 : 30;
  if (logs.length === 0) return new Map();
  const newest = Date.parse(logs[0]!.createdAt);
  const oldest = Date.parse(logs[logs.length - 1]!.createdAt);
  const spanMs = Math.max(1, newest - oldest);
  const bucketMs = spanMs / bucketCount;
  const buckets = new Map<string, RequestLog[]>();
  for (const log of logs) {
    const ts = Date.parse(log.createdAt);
    const index = Math.min(bucketCount - 1, Math.floor((ts - oldest) / bucketMs));
    const key = `${index}`;
    const group = buckets.get(key) ?? [];
    group.push(log);
    buckets.set(key, group);
  }
  return buckets;
}

function latencyPercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

function formatBucketLabel(index: number, range: UsageFilters["range"]): string {
  if (range === "1h") return `${(index * 5).toString().padStart(2, "0")}m`;
  if (range === "24h") return `${index.toString().padStart(2, "0")}:00`;
  if (range === "7d") return `D${index + 1}`;
  return `D${index + 1}`;
}

function aggregateBreakdown(
  logs: RequestLog[],
  groupBy: (log: RequestLog) => { key: string; label: string },
): import("../mock-data/types").AnalyticsBreakdown[] {
  const groups = new Map<string, import("../mock-data/types").AnalyticsBreakdown>();
  for (const log of logs) {
    const { key, label } = groupBy(log);
    const current = groups.get(key) ?? {
      key,
      label,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
      errors: 0,
      p95LatencyMs: 0,
    };
    current.requests += 1;
    current.inputTokens += log.inputTokens;
    current.outputTokens += log.outputTokens;
    current.totalTokens += log.inputTokens + log.outputTokens;
    current.estimatedCost += estimateCost(log);
    if (log.status !== "success") current.errors += 1;
    groups.set(key, current);
  }
  for (const group of groups.values()) {
    const latencies = logs
      .filter((log) => groupBy(log).key === group.key)
      .map((log) => log.latencyMs);
    group.p95LatencyMs = latencyPercentile(latencies, 95);
  }
  return Array.from(groups.values()).sort((a, b) => b.requests - a.requests);
}

function computeAnalyticsMetrics(
  filters: UsageFilters,
): Omit<AnalyticsMetrics, "start" | "end"> {
  const logs = filterLogs(filters);
  const buckets = bucketLogs(logs, filters.range);
  const dates = rangeDates(filters.range);
  const bucketCount =
    filters.range === "1h" ? 12 : filters.range === "24h" ? 24 : filters.range === "7d" ? 14 : 30;

  const series: import("../mock-data/types").AnalyticsBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const bucketLogs = buckets.get(`${i}`) ?? [];
    const latencies = bucketLogs.map((log) => log.latencyMs);
    const inputTokens = bucketLogs.reduce((sum, log) => sum + log.inputTokens, 0);
    const outputTokens = bucketLogs.reduce((sum, log) => sum + log.outputTokens, 0);
    series.push({
      t: formatBucketLabel(i, filters.range),
      requests: bucketLogs.length,
      errors: bucketLogs.filter((log) => log.status !== "success").length,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCost: bucketLogs.reduce((sum, log) => sum + estimateCost(log), 0),
      p50LatencyMs: latencyPercentile(latencies, 50),
      p95LatencyMs: latencyPercentile(latencies, 95),
    });
  }

  const requestCount = logs.length;
  const inputTokens = logs.reduce((sum, log) => sum + log.inputTokens, 0);
  const outputTokens = logs.reduce((sum, log) => sum + log.outputTokens, 0);
  const totalTokens = inputTokens + outputTokens;
  const estimatedCost = logs.reduce((sum, log) => sum + estimateCost(log), 0);
  const errorCount = logs.filter((log) => log.status !== "success").length;
  const latencies = logs.map((log) => log.latencyMs);

  const statusCounts = new Map<import("../mock-data/types").RequestStatus, number>();
  for (const log of logs) {
    statusCounts.set(log.status, (statusCounts.get(log.status) ?? 0) + 1);
  }
  const statusDistribution: import("../mock-data/types").AnalyticsStatusDistribution[] = [
    "success",
    "error",
    "rate_limited",
    "timeout",
  ]
    .map((status) => {
      const count = statusCounts.get(status as import("../mock-data/types").RequestStatus) ?? 0;
      return {
        status: status as import("../mock-data/types").RequestStatus,
        count,
        percentage: requestCount > 0 ? (count / requestCount) * 100 : 0,
      };
    })
    .filter((entry) => entry.count > 0);

  return {
    requestCount,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCost,
    errorRate: requestCount > 0 ? (errorCount / requestCount) * 100 : 0,
    p50LatencyMs: latencyPercentile(latencies, 50),
    p95LatencyMs: latencyPercentile(latencies, 95),
    series,
    byModel: aggregateBreakdown(logs, (log) => ({ key: log.model, label: log.model })),
    byTeam: aggregateBreakdown(logs, (log) => ({ key: log.teamId, label: log.teamName })),
    byKey: aggregateBreakdown(logs, (log) => ({ key: log.keyId, label: log.keyPrefix })),
    statusDistribution,
  };
}

export function getAnalyticsMetrics(filters: UsageFilters): Promise<AnalyticsMetrics> {
  if (hasBackendApi()) {
    return apiRequest<AnalyticsMetrics>("/admin/analytics", {
      query: { range: filters.range, model: filters.model, teamId: filters.teamId, keyId: filters.keyId },
    });
  }
  const dates = rangeDates(filters.range);
  return simulate({ ...computeAnalyticsMetrics(filters), ...dates });
}
