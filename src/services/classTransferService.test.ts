import { describe, expect, it } from "vitest";
import {
  buildStudentDocumentPath,
  normalizeClassIds,
} from "@/services/classTransferService";

describe("classTransferService identity contract", () => {
  it("uses the Firestore document id instead of the auth uid", () => {
    expect(
      buildStudentDocumentPath({ docId: "custom-student-doc", uid: "firebase-auth-uid" }),
    ).toBe("users/custom-student-doc");
  });

  it("keeps classIds canonical and falls back to legacy classId only when empty", () => {
    expect(normalizeClassIds(["class-a", "class-a"], "legacy-class")).toEqual(["class-a"]);
    expect(normalizeClassIds([], "legacy-class")).toEqual(["legacy-class"]);
  });
});
