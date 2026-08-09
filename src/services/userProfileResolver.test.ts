import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  doc: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
}));

vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  doc: mocks.doc,
  collection: mocks.collection,
  query: mocks.query,
  where: mocks.where,
  limit: mocks.limit,
  getDoc: mocks.getDoc,
  getDocs: mocks.getDocs,
}));

import {
  invalidateUserProfileResolution,
  resolveUserProfileSnapshot,
} from "./userProfileResolver";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.doc.mockImplementation((_db, _collection, id) => ({ id }));
  mocks.collection.mockReturnValue({ id: "users" });
  mocks.where.mockReturnValue({});
  mocks.limit.mockReturnValue({});
  mocks.query.mockReturnValue({});
});

describe("user profile resolver", () => {
  it("shares one in-flight direct lookup between concurrent consumers", async () => {
    const uid = "shared-uid";
    invalidateUserProfileResolution(uid);

    let resolveDirect: ((value: unknown) => void) | undefined;
    mocks.getDoc.mockImplementation(
      () => new Promise((resolve) => {
        resolveDirect = resolve;
      }),
    );

    const first = resolveUserProfileSnapshot(uid);
    const second = resolveUserProfileSnapshot(uid);

    expect(mocks.getDoc).toHaveBeenCalledTimes(1);

    const snapshot = { exists: () => true, data: () => ({ role: "STUDENT" }) };
    resolveDirect?.(snapshot);

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult?.ref.id).toBe(uid);
    expect(secondResult).toBe(firstResult);
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });

  it("resolves a custom document by its uid field when users/{uid} is absent", async () => {
    const uid = "custom-auth-uid";
    invalidateUserProfileResolution(uid);

    mocks.getDoc.mockResolvedValue({ exists: () => false });
    const customSnapshot = {
      ref: { id: "student-custom-id" },
      data: () => ({ uid, role: "INSTRUCTOR" }),
    };
    mocks.getDocs.mockResolvedValue({
      size: 1,
      empty: false,
      docs: [customSnapshot],
    });

    const result = await resolveUserProfileSnapshot(uid);

    expect(result?.ref.id).toBe("student-custom-id");
    expect(result?.snapshot).toBe(customSnapshot);
    expect(mocks.getDocs).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate profile documents for one auth uid", async () => {
    const uid = "duplicate-auth-uid";
    invalidateUserProfileResolution(uid);

    mocks.getDoc.mockResolvedValue({ exists: () => false });
    mocks.getDocs.mockResolvedValue({
      size: 2,
      empty: false,
      docs: [{ ref: { id: "a" } }, { ref: { id: "b" } }],
    });

    await expect(resolveUserProfileSnapshot(uid)).rejects.toThrow(
      "동일한 인증 UID의 사용자 프로필이 여러 개 존재합니다.",
    );
  });
});
