import { describe, expect, it } from "vitest";

const MASKED_INSTRUCTOR_SIGNUP_CODE = "••••••••";

const normalizeInstructorCodeForSave = (value: string) =>
  value.trim() === MASKED_INSTRUCTOR_SIGNUP_CODE ? "" : value.trim();

describe("master signup control masking", () => {
  it("keeps the current server code when the masked value is saved unchanged", () => {
    expect(normalizeInstructorCodeForSave(MASKED_INSTRUCTOR_SIGNUP_CODE)).toBe("");
  });

  it("sends an explicitly entered replacement code to the server", () => {
    expect(normalizeInstructorCodeForSave("  new-instructor-code  ")).toBe("new-instructor-code");
  });
});
