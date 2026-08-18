import { describe, it, expect, vi } from "vitest";
import { Decimal } from "../../src/db/generated/client";
import { createBudgetChecker } from "../../src/budget/budget";
import { BudgetExceededError } from "../../src/errors";

function fakeDb(seed: {
  pricing?: { inputTokenPrice: Decimal; outputTokenPrice: Decimal };
  key?: { spent: Decimal };
  team?: { spent: Decimal };
}) {
  return {
    modelPricing: {
      findUnique: vi.fn().mockResolvedValue(seed.pricing ?? null),
    },
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(seed.key ?? null),
      update: vi.fn().mockResolvedValue(undefined),
    },
    team: {
      findUnique: vi.fn().mockResolvedValue(seed.team ?? null),
      update: vi.fn().mockResolvedValue(undefined),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        apiKey: {
          findUnique: vi.fn().mockResolvedValue(seed.key ?? null),
          update: vi.fn().mockResolvedValue(undefined),
        },
        team: {
          findUnique: vi.fn().mockResolvedValue(seed.team ?? null),
          update: vi.fn().mockResolvedValue(undefined),
        },
      };
      return fn(tx);
    }),
  } as any;
}

describe("createBudgetChecker", () => {
  it("allows the request when no budget limit is configured", async () => {
    const checker = createBudgetChecker(fakeDb({}));
    await expect(checker.checkAndSpend("key-1", "gpt-4o", 100, 50)).resolves.toBeUndefined();
  });

  it("allows the request when no pricing exists for the model", async () => {
    const checker = createBudgetChecker(fakeDb({ key: { spent: new Decimal(0) } }));
    await expect(checker.checkAndSpend("key-1", "gpt-4o", 100, 50, new Decimal(10))).resolves.toBeUndefined();
  });

  it("rejects the request when it would exceed the key budget", async () => {
    const checker = createBudgetChecker(
      fakeDb({
        pricing: { inputTokenPrice: new Decimal("0.01"), outputTokenPrice: new Decimal("0.02") },
        key: { spent: new Decimal(9.5) },
      }),
    );
    await expect(checker.checkAndSpend("key-1", "gpt-4o", 100, 50, new Decimal(10))).rejects.toThrow(
      BudgetExceededError,
    );
  });

  it("allows and records spend when within budget", async () => {
    const db = fakeDb({
      pricing: { inputTokenPrice: new Decimal("0.01"), outputTokenPrice: new Decimal("0.02") },
      key: { spent: new Decimal(0) },
    });
    const checker = createBudgetChecker(db);
    await expect(checker.checkAndSpend("key-1", "gpt-4o", 100, 50, new Decimal(10))).resolves.toBeUndefined();
  });

  it("rejects the request when it would exceed the team budget", async () => {
    const checker = createBudgetChecker(
      fakeDb({
        pricing: { inputTokenPrice: new Decimal("0.01"), outputTokenPrice: new Decimal("0.02") },
        key: { spent: new Decimal(0) },
        team: { spent: new Decimal(9.5) },
      }),
    );
    await expect(
      checker.checkAndSpend("key-1", "gpt-4o", 100, 50, new Decimal(10), "team-1", new Decimal(10)),
    ).rejects.toThrow(BudgetExceededError);
  });

  it("records team spend when within budget", async () => {
    const db = fakeDb({
      pricing: { inputTokenPrice: new Decimal("0.01"), outputTokenPrice: new Decimal("0.02") },
      key: { spent: new Decimal(0) },
      team: { spent: new Decimal(0) },
    });
    const checker = createBudgetChecker(db);
    await expect(
      checker.checkAndSpend("key-1", "gpt-4o", 100, 50, new Decimal(10), "team-1", new Decimal(10)),
    ).resolves.toBeUndefined();
  });
});
