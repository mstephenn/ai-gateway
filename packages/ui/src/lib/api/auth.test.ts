import { describe, it, expect, vi, beforeEach } from "vitest";
import { signIn } from "./auth";
import * as client from "./client";

describe("signIn (backend mode)", () => {
  beforeEach(() => {
    vi.spyOn(client, "hasBackendApi").mockReturnValue(true);
  });

  it("succeeds and marks the session admin when /admin/me returns isAdmin: true", async () => {
    vi.spyOn(client, "apiRequest").mockResolvedValue({
      apiKeyId: "key-1",
      isAdmin: true,
      teamId: null,
      allowedModels: [],
    });
    const session = await signIn("sk-admin");
    expect(session.isAdmin).toBe(true);
  });

  it("rejects when /admin/me returns isAdmin: false", async () => {
    vi.spyOn(client, "apiRequest").mockResolvedValue({
      apiKeyId: "key-1",
      isAdmin: false,
      teamId: null,
      allowedModels: [],
    });
    await expect(signIn("sk-user")).rejects.toThrow();
  });

  it("rejects when /admin/me itself fails", async () => {
    vi.spyOn(client, "apiRequest").mockRejectedValue(new Error("invalid_api_key"));
    await expect(signIn("sk-bad")).rejects.toThrow();
  });
});
