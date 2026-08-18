import { apiRequest, hasBackendApi, simulate } from "./client";
import { listApiKeys } from "./keys";
import { listTeams } from "./teams";
import { requestLogs } from "../mock-data/fixtures";
import type { BudgetEntry, BudgetSummary } from "../mock-data/types";

const WARNING_THRESHOLD = 70;
const CRITICAL_THRESHOLD = 90;

function budgetStatus(percentUsed: number): BudgetEntry["status"] {
  if (percentUsed >= 100) return "exceeded";
  if (percentUsed >= CRITICAL_THRESHOLD) return "critical";
  if (percentUsed >= WARNING_THRESHOLD) return "warning";
  return "healthy";
}

function keyUsedTokens(keyId: string): number {
  return requestLogs
    .filter((log) => log.keyId === keyId)
    .reduce((sum, log) => sum + log.inputTokens + log.outputTokens, 0);
}

export interface BudgetMetrics {
  summary: BudgetSummary;
  entries: BudgetEntry[];
}

async function computeBudgetMetrics(): Promise<BudgetMetrics> {
  const [teams, keys] = await Promise.all([listTeams(), listApiKeys()]);

  const teamEntries: BudgetEntry[] = teams.map((team) => {
    const budgetTokens = team.budgetTokens || 0;
    const usedTokens = team.usedTokens || 0;
    const percentUsed = budgetTokens > 0 ? (usedTokens / budgetTokens) * 100 : 0;
    return {
      id: team.id,
      name: team.name,
      scope: "team",
      ownerName: null,
      budgetTokens,
      usedTokens,
      remainingTokens: Math.max(0, budgetTokens - usedTokens),
      percentUsed,
      status: budgetStatus(percentUsed),
    };
  });

  const keyEntries: BudgetEntry[] = keys
    .filter((key) => key.budgetLimit !== null && key.budgetLimit > 0)
    .map((key) => {
      const budgetTokens = key.budgetLimit ?? 0;
      const usedTokens = keyUsedTokens(key.id);
      const percentUsed = budgetTokens > 0 ? (usedTokens / budgetTokens) * 100 : 0;
      return {
        id: key.id,
        name: key.name,
        scope: "key",
        ownerName: key.ownerName,
        budgetTokens,
        usedTokens,
        remainingTokens: Math.max(0, budgetTokens - usedTokens),
        percentUsed,
        status: budgetStatus(percentUsed),
      };
    });

  const entries = [...teamEntries, ...keyEntries].sort(
    (a, b) => b.percentUsed - a.percentUsed,
  );

  const summary: BudgetSummary = {
    totalBudgeted: entries.reduce((sum, entry) => sum + entry.budgetTokens, 0),
    totalUsed: entries.reduce((sum, entry) => sum + entry.usedTokens, 0),
    totalRemaining: entries.reduce((sum, entry) => sum + entry.remainingTokens, 0),
    teamCount: teamEntries.length,
    keyCount: keyEntries.length,
    exceededCount: entries.filter((e) => e.status === "exceeded").length,
    warningCount: entries.filter((e) => e.status === "warning").length,
    criticalCount: entries.filter((e) => e.status === "critical").length,
  };

  return { summary, entries };
}

export function getBudgetMetrics(): Promise<BudgetMetrics> {
  if (hasBackendApi()) {
    return apiRequest<BudgetMetrics>("/admin/budgets");
  }
  return computeBudgetMetrics();
}
