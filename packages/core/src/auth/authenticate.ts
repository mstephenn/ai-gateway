import { createHash } from "node:crypto";

import type { DbClient } from "../db/client.js";
import type { Prisma } from "../db/generated/client.js";

type Decimal = Prisma.Decimal;

export interface AuthResult {
  apiKeyId: string;
  isAdmin: boolean;
  teamId?: string;
  rpmLimit?: number;
  tpmLimit?: number;
  budgetLimit?: Decimal;
  allowedModels?: string[];
  teamBudgetLimit?: Decimal;
  teamAllowedModels?: string[];
}

function hashKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) {
    return false;
  }
  return new Date() > expiresAt;
}

export async function authenticate(
  db: DbClient,
  bearerToken: string | undefined,
): Promise<AuthResult | null> {
  if (!bearerToken) {
    return null;
  }

  const hash = hashKey(bearerToken);
  const row = await db.apiKey.findUnique({
    where: { keyHash: hash },
    include: { team: true },
  });

  if (!row || !row.isActive || isExpired(row.expiresAt)) {
    return null;
  }

  return {
    apiKeyId: row.id,
    isAdmin: row.isAdmin ?? false,
    teamId: row.teamId ?? undefined,
    rpmLimit: row.rpmLimit ?? undefined,
    tpmLimit: row.tpmLimit ?? undefined,
    budgetLimit: row.budgetLimit ?? undefined,
    allowedModels: row.allowedModels ?? undefined,
    teamBudgetLimit: row.team?.budgetLimit ?? undefined,
    teamAllowedModels: row.team?.allowedModels ?? undefined,
  };
}
