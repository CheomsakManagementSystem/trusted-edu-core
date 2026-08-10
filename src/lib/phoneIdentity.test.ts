import { describe, expect, it } from "vitest";
import {
  getPhoneLast4,
  isSupportedPhoneNumber,
  normalizePhoneNumber,
} from "@/lib/phoneIdentity";

describe("phone identity helpers", () => {
  it("normalizes formatted phone numbers", () => {
    expect(normalizePhoneNumber("010-1234-5678")).toBe("01012345678");
  });

  it("accepts 10~11 digit domestic phone numbers", () => {
    expect(isSupportedPhoneNumber("010-1234-5678")).toBe(true);
    expect(isSupportedPhoneNumber("02-1234-5678")).toBe(true);
    expect(isSupportedPhoneNumber("1234")).toBe(false);
  });

  it("extracts the final four digits", () => {
    expect(getPhoneLast4("010-1234-5678")).toBe("5678");
  });
});
