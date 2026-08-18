import { describe, it, expect, vi } from "vitest";
import { authenticate } from "../../src/auth/authenticate";
import { createHash } from "node:crypto";
import { Decimal } from "../../src/db/generated/client";

function fakeDb(
  row:
    | {
        id: string;
        keyHash: string;
        isActive: boolean;
        teamId?: string;
        expiresAt?: Date;
        rpmLimit?: number;
        tpmLimit?: number;
        budgetLimit?: Decimal;
        allowedModels?: string[];
        team?: { id: string; budgetLimit?: Decimal; allowedModels?: string[] };
        isAdmin?: boolean;
      }
    | undefined,
) {
  return {
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(row ?? null),
    },
  } as any;
}

describe("authenticate", () => {
  it("returns null when no token is provided", async () => {
    const db = fakeDb(undefined);
    expect(await authenticate(db, undefined)).toBeNull();
  });

  it("returns null when the key hash isn't found", async () => {
    const db = fakeDb(undefined);
    expect(await authenticate(db, "sk-unknown")).toBeNull();
  });

  it("returns null when the matching key is inactive", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: false });
    expect(await authenticate(db, "sk-test")).toBeNull();
  });

  it("returns null when the matching key is expired", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true, expiresAt: new Date(Date.now() - 86400000) });
    expect(await authenticate(db, "sk-test")).toBeNull();
  });

  it("returns the api key id when the token hashes to an active key", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    expect(await authenticate(db, "sk-test")).toEqual({ apiKeyId: "key-1", isAdmin: false });
  });

  it("returns the team id when the key belongs to a team", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true, teamId: "team-1" });
    expect(await authenticate(db, "sk-test")).toEqual({ apiKeyId: "key-1", isAdmin: false, teamId: "team-1" });
  });

  it("returns rate limits when configured", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true, rpmLimit: 100, tpmLimit: 1000 });
    expect(await authenticate(db, "sk-test")).toEqual({
      apiKeyId: "key-1",
      isAdmin: false,
      rpmLimit: 100,
      tpmLimit: 1000,
    });
  });

  it("returns the budget limit when configured", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true, budgetLimit: new Decimal(10.5) });
    const result = await authenticate(db, "sk-test");
    expect(result?.apiKeyId).toBe("key-1");
    expect(result?.budgetLimit?.toString()).toBe("10.5");
  });

  it("returns allowed models and team budget fields", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({
      id: "key-1",
      keyHash: hash,
      isActive: true,
      allowedModels: ["gpt-4o"],
      team: { id: "team-1", budgetLimit: new Decimal(100), allowedModels: ["gpt-4o", "claude-3"] },
    });
    const result = await authenticate(db, "sk-test");
    expect(result?.allowedModels).toEqual(["gpt-4o"]);
    expect(result?.teamBudgetLimit?.toString()).toBe("100");
    expect(result?.teamAllowedModels).toEqual(["gpt-4o", "claude-3"]);
  });

  it("defaults isAdmin to false when not set on the row", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const result = await authenticate(db, "sk-test");
    expect(result?.isAdmin).toBe(false);
  });

  it("returns isAdmin true when the row is flagged admin", async () => {
    const hash = createHash("sha256").update("sk-admin").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true, isAdmin: true });
    const result = await authenticate(db, "sk-admin");
    expect(result?.isAdmin).toBe(true);
  });
});
