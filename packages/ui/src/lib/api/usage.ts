import type { UsageGroupBy, UsageGroupDto, UsageResponse } from "@ai-gateway/shared";
import { requestLogs } from "../mock-data/fixtures";
import type { RequestLog, RequestStatus } from "../mock-data/types";
import { apiRequest, hasBackendApi, simulate } from "./client";

export interface UsageFilters {
  range: "1h" | "24h" | "7d" | "30d";
  model: string;
  teamId: string;
  keyId: string;
  status: RequestStatus | "all";
  search: string;
}

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

function mockGroupKey(log: RequestLog, groupBy: UsageGroupBy): { value: string; label: string } {
  if (groupBy === "model") return { value: log.model, label: log.model };
  if (groupBy === "team") return { value: log.teamId, label: log.teamName };
  return { value: log.keyId, label: log.keyPrefix };
}

function aggregateLogs(logs: RequestLog[], groupBy: UsageGroupBy): UsageGroupDto[] {
  const groups = new Map<string, UsageGroupDto>();
  for (const log of logs) {
    const key = mockGroupKey(log, groupBy);
    const current = groups.get(key.value) ?? {
      groupValue: key.value,
      label: key.label,
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
    };
    current.requestCount += 1;
    current.inputTokens += log.inputTokens;
    current.outputTokens += log.outputTokens;
    current.totalTokens += log.inputTokens + log.outputTokens;
    groups.set(key.value, current);
  }
  return Array.from(groups.values()).sort((a, b) => b.requestCount - a.requestCount);
}

export function listRequestLogs(filters: UsageFilters): Promise<RequestLog[]> {
  if (hasBackendApi()) {
    return simulate([]);
  }
  return simulate(filterLogs(filters));
}

export function listUsageGroups(
  filters: UsageFilters,
  groupBy: UsageGroupBy,
): Promise<UsageResponse> {
  if (hasBackendApi()) {
    return apiRequest<UsageResponse>("/admin/usage", {
      query: { groupBy, ...rangeDates(filters.range) },
    });
  }
  const dates = rangeDates(filters.range);
  return simulate({
    object: "list",
    groupBy,
    start: dates.start,
    end: dates.end,
    data: aggregateLogs(filterLogs(filters), groupBy),
  });
}
