import { describe, it, expect } from "vitest";
import { hasBackendApi, nextId, nowIso } from "./client";

describe("client smoke test", () => {
  it("nextId produces a prefixed id", () => {
    expect(nextId("dep")).toMatch(/^dep_/);
  });

  it("nowIso produces a parseable ISO date", () => {
    expect(Number.isNaN(new Date(nowIso()).getTime())).toBe(false);
  });

  it("hasBackendApi is a callable function", () => {
    expect(typeof hasBackendApi()).toBe("boolean");
  });
});
