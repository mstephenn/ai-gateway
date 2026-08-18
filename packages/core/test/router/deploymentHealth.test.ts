import { describe, it, expect, vi } from "vitest";
import { getDeploymentHealth, cooldownKey } from "../../src/router/deploymentHealth";
import type { RedisLike } from "../../src/router/router";

describe("cooldownKey", () => {
  it("builds the same key format the router already uses", () => {
    expect(cooldownKey("dep-1")).toBe("deployment:cooldown:dep-1");
  });
});

describe("getDeploymentHealth", () => {
  it("marks a deployment healthy when no cooldown key is set", async () => {
    const redis: RedisLike = { get: vi.fn().mockResolvedValue(null), set: vi.fn(), incr: vi.fn() };
    const result = await getDeploymentHealth(redis, ["dep-1"]);
    expect(result.get("dep-1")).toBe("healthy");
  });

  it("marks a deployment in cooldown when its key is set", async () => {
    const redis: RedisLike = {
      get: vi.fn().mockImplementation((key: string) => Promise.resolve(key === "deployment:cooldown:dep-2" ? "1" : null)),
      set: vi.fn(),
      incr: vi.fn(),
    };
    const result = await getDeploymentHealth(redis, ["dep-1", "dep-2"]);
    expect(result.get("dep-1")).toBe("healthy");
    expect(result.get("dep-2")).toBe("cooldown");
  });

  it("returns an empty map for an empty id list", async () => {
    const redis: RedisLike = { get: vi.fn(), set: vi.fn(), incr: vi.fn() };
    const result = await getDeploymentHealth(redis, []);
    expect(result.size).toBe(0);
    expect(redis.get).not.toHaveBeenCalled();
  });
});
