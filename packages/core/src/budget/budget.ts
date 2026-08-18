import { Decimal } from "@prisma/client/runtime/client";

import type { DbClient } from "../db/client.js";
import { BudgetExceededError } from "../errors.js";

export interface BudgetChecker {
  checkAndSpend(
    apiKeyId: string,
    modelName: string,
    inputTokens: number,
    outputTokens: number,
    budgetLimit?: Decimal,
    teamId?: string,
    teamBudgetLimit?: Decimal,
  ): Promise<void>;
}

export function createBudgetChecker(db: DbClient): BudgetChecker {
  return {
    async checkAndSpend(
      apiKeyId: string,
      modelName: string,
      inputTokens: number,
      outputTokens: number,
      budgetLimit?: Decimal,
      teamId?: string,
      teamBudgetLimit?: Decimal,
    ): Promise<void> {
      const pricing = await db.modelPricing.findUnique({
        where: { modelName },
      });
      if (!pricing) {
        return;
      }

      const inputCost = new Decimal(inputTokens).mul(pricing.inputTokenPrice);
      const outputCost = new Decimal(outputTokens).mul(
        pricing.outputTokenPrice,
      );
      const cost = inputCost.plus(outputCost);

      await db.$transaction(async (tx) => {
        const key = await tx.apiKey.findUnique({ where: { id: apiKeyId } });
        if (key) {
          if (budgetLimit && budgetLimit.gt(0)) {
            const currentSpent = key.spent ?? new Decimal(0);
            const newSpent = currentSpent.plus(cost);
            if (newSpent.gt(budgetLimit)) {
              throw new BudgetExceededError("key_budget_exceeded");
            }
            await tx.apiKey.update({
              where: { id: apiKeyId },
              data: { spent: newSpent },
            });
          }
        }

        if (teamId && teamBudgetLimit && teamBudgetLimit.gt(0)) {
          const team = await tx.team.findUnique({ where: { id: teamId } });
          if (team) {
            const currentSpent = team.spent ?? new Decimal(0);
            const newSpent = currentSpent.plus(cost);
            if (newSpent.gt(teamBudgetLimit)) {
              throw new BudgetExceededError("team_budget_exceeded");
            }
            await tx.team.update({
              where: { id: teamId },
              data: { spent: newSpent },
            });
          }
        }
      });
    },
  };
}
