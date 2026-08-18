import { describe, it, expect, vi } from "vitest";
import { listDeployments } from "./models";
import * as client from "./client";

describe("listDeployments (backend mode)", () => {
  it("carries the health field from AdminDeploymentDto onto Deployment", async () => {
    vi.spyOn(client, "hasBackendApi").mockReturnValue(true);
    vi.spyOn(client, "apiList").mockResolvedValue([
      {
        id: "dep-1",
        modelName: "gpt-4o",
        provider: "openai",
        providerModelId: "gpt-4o",
        credentialsRef: "ref",
        weight: 1,
        isActive: true,
        timeoutMs: null,
        maxRetries: null,
        retryBackoffMs: null,
        health: "cooldown",
      },
    ]);

    const result = await listDeployments();
    expect(result[0]!.health).toBe("cooldown");
  });

  it("carries credentialsRef through instead of a fake region field", async () => {
    vi.spyOn(client, "hasBackendApi").mockReturnValue(true);
    vi.spyOn(client, "apiList").mockResolvedValue([
      {
        id: "dep-1",
        modelName: "gpt-4o",
        provider: "openai",
        providerModelId: "gpt-4o",
        credentialsRef: "cred-1",
        weight: 1,
        isActive: true,
        timeoutMs: null,
        maxRetries: null,
        retryBackoffMs: null,
      },
    ]);
    const result = await listDeployments();
    expect(result[0]!.credentialsRef).toBe("cred-1");
    expect(result[0]).not.toHaveProperty("region");
  });
});
