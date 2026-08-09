import { describe, expect, it } from "vitest";
import {
  buildStudentDocumentPath,
  normalizeClassIds,
  resolveClassStateAfterRemoval,
  resolvePrimaryClassId,
  shouldSyncRenamedPrimaryClassName,
} from "@/services/classTransferService";

const classes = [
  { id: "class-a", name: "A반" },
  { id: "class-b", name: "B반" },
  { id: "class-c", name: "C반" },
];

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

  it("preserves an existing primary class when a secondary class is removed", () => {
    expect(resolvePrimaryClassId(["class-a", "class-b", "class-c"], "class-c")).toBe("class-c");
    expect(
      resolveClassStateAfterRemoval(
        ["class-a", "class-b", "class-c"],
        "class-c",
        "class-b",
        classes,
      ),
    ).toEqual({
      classIds: ["class-a", "class-c"],
      primaryClass: { id: "class-c", name: "C반" },
    });
  });

  it("selects the first remaining class when the primary class itself is removed", () => {
    expect(
      resolveClassStateAfterRemoval(
        ["class-a", "class-b", "class-c"],
        "class-b",
        "class-b",
        classes,
      ),
    ).toEqual({
      classIds: ["class-a", "class-c"],
      primaryClass: { id: "class-a", name: "A반" },
    });
  });

  it("updates className only when the renamed class is the primary class", () => {
    expect(
      shouldSyncRenamedPrimaryClassName(["class-a", "class-b"], "class-a", "class-a"),
    ).toBe(true);
    expect(
      shouldSyncRenamedPrimaryClassName(["class-a", "class-b"], "class-a", "class-b"),
    ).toBe(false);
    expect(shouldSyncRenamedPrimaryClassName([], "class-b", "class-b")).toBe(true);
  });
});
