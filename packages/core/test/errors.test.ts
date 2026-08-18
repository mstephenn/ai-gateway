import { describe, it, expect } from "vitest";
import { ForbiddenError, ConflictError, statusForError } from "../src/errors";

describe("ForbiddenError", () => {
  it("maps to a 403 status", () => {
    expect(statusForError(new ForbiddenError("admin_required"))).toBe(403);
  });

  it("carries the given message", () => {
    expect(new ForbiddenError("admin_required").message).toBe("admin_required");
  });
});

describe("ConflictError", () => {
  it("maps to a 409 status", () => {
    expect(statusForError(new ConflictError("in_use"))).toBe(409);
  });
});
