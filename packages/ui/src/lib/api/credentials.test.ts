import { describe, it, expect, vi } from "vitest";
import { listCredentials, createCredential, deleteCredential } from "./credentials";
import * as client from "./client";

describe("credentials API (backend mode)", () => {
  it("lists credentials via GET /admin/credentials", async () => {
    vi.spyOn(client, "hasBackendApi").mockReturnValue(true);
    vi.spyOn(client, "apiList").mockResolvedValue([
      {
        id: "cred-1",
        provider: "openai",
        name: "Prod",
        createdAt: "2026-08-18T00:00:00.000Z",
        updatedAt: "2026-08-18T00:00:00.000Z",
      },
    ]);
    const result = await listCredentials();
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Prod");
  });

  it("creates a credential via POST /admin/credentials", async () => {
    vi.spyOn(client, "hasBackendApi").mockReturnValue(true);
    const apiRequestSpy = vi.spyOn(client, "apiRequest").mockResolvedValue({
      id: "cred-new",
      provider: "openai",
      name: "Prod",
      createdAt: "x",
      updatedAt: "x",
    });
    await createCredential({ provider: "openai", name: "Prod", config: { apiKey: "sk-x" } });
    expect(apiRequestSpy).toHaveBeenCalledWith(
      "/admin/credentials",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("deletes a credential via DELETE /admin/credentials/:id", async () => {
    vi.spyOn(client, "hasBackendApi").mockReturnValue(true);
    const apiRequestSpy = vi.spyOn(client, "apiRequest").mockResolvedValue(undefined);
    await deleteCredential("cred-1");
    expect(apiRequestSpy).toHaveBeenCalledWith(
      "/admin/credentials/cred-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
