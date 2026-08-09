import { describe, expect, it } from "vitest";
import {
  resolveClassStateAfterRemoval,
  shouldSyncPrimaryClassName,
} from "@/services/classIntegrityService";

const classes = [
  { id: "class-a", name: "A반" },
  { id: "class-b", name: "B반" },
  { id: "class-c", name: "C반" },
];

describe("class identity integrity", () => {
  it("renames className only when the renamed class is the primary class", () => {
    expect(shouldSyncPrimaryClassName("class-a", "class-a")).toBe(true);
    expect(shouldSyncPrimaryClassName("class-a", "class-b")).toBe(false);
  });

  it("keeps the existing primary class when a secondary class is removed", () => {
    expect(
      resolveClassStateAfterRemoval(
        ["class-a", "class-b"],
        "class-a",
        "class-b",
        classes,
      ),
    ).toEqual({
      classIds: ["class-a"],
      classId: "class-a",
      className: "A반",
    });
  });

  it("selects a remaining class and its actual name when the primary class is removed", () => {
    expect(
      resolveClassStateAfterRemoval(
        ["class-a", "class-b", "class-c"],
        "class-a",
        "class-a",
        classes,
      ),
    ).toEqual({
      classIds: ["class-b", "class-c"],
      classId: "class-b",
      className: "B반",
    });
  });

  it("clears legacy class fields when the last class is removed", () => {
    expect(
      resolveClassStateAfterRemoval([], "class-a", "class-a", classes),
    ).toEqual({
      classIds: [],
      classId: null,
      className: null,
    });
  });
});
