import { describe, it, expect, vi } from "vitest";
import { getOverviewMetrics } from "./overview";
import * as client from "./client";

describe("getOverviewMetrics (backend mode)", () => {
  it("maps AdminOverviewDto onto OverviewMetrics", async () => {
    vi.spyOn(client, "hasBackendApi").mockReturnValue(true);
    vi.spyOn(client, "apiRequest").mockResolvedValue({
      start: "2026-08-17T00:00:00.000Z",
      end: "2026-08-18T00:00:00.000Z",
      requestCount: 120,
      errorRate: 0.05,
      p50LatencyMs: 200,
      p95LatencyMs: 900,
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      cacheHitRate: 0.3,
      topModels: [{ key: "gpt-4o", label: "gpt-4o", requestCount: 80 }],
      topTeams: [],
      unhealthyDeploymentIds: ["dep-2"],
      budgetPressure: [],
      rateLimitPressure: null,
      rateLimitPressureNote: "not yet available",
    });

    const result = await getOverviewMetrics("24h");

    expect(result.requestVolume).toBe(120);
    expect(result.errorRate).toBe(0.05);
    expect(result.p50LatencyMs).toBe(200);
    expect(result.p95LatencyMs).toBe(900);
    expect(result.totalTokens).toBe(1500);
    expect(result.topModels).toEqual([{ model: "gpt-4o", requests: 80, tokens: 0, errorRate: 0 }]);
  });
});
