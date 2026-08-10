import { describe, expect, it } from "vitest";
import {
  extractPhoneIdentityHints,
  resolveStudentIdentity,
  type StudentIdentityCandidate,
} from "./studentIdentityResolver";

const student = (
  uid: string,
  studentLast4: string,
  parentLast4?: string,
): StudentIdentityCandidate => ({
  uid,
  name: uid,
  studentPhoneLast4: studentLast4,
  parentPhoneLast4: parentLast4 ?? null,
});

describe("resolveStudentIdentity", () => {
  it("matches a unique student phone suffix", () => {
    const result = resolveStudentIdentity(
      [student("a", "1234", "1111"), student("b", "5678", "2222")],
      { studentPhoneLast4: "1234" },
    );

    expect(result.status).toBe("matched");
    expect(result.student?.uid).toBe("a");
    expect(result.method).toBe("student_phone_last4");
  });

  it("uses parent phone suffix only when the student suffix is duplicated", () => {
    const result = resolveStudentIdentity(
      [student("a", "1234", "1111"), student("b", "1234", "2222")],
      { studentPhoneLast4: "1234", parentPhoneLast4: "2222" },
    );

    expect(result.status).toBe("matched");
    expect(result.student?.uid).toBe("b");
    expect(result.method).toBe("student_parent_phone_last4");
  });

  it("keeps duplicate student suffixes unresolved when parent suffix is absent", () => {
    const result = resolveStudentIdentity(
      [student("a", "1234", "1111"), student("b", "1234", "2222")],
      { studentPhoneLast4: "1234" },
    );

    expect(result.status).toBe("ambiguous");
    expect(result.student).toBeNull();
  });

  it("does not auto-match when any duplicate candidate lacks parent identity", () => {
    const result = resolveStudentIdentity(
      [student("a", "1234", "1111"), student("b", "1234")],
      { studentPhoneLast4: "1234", parentPhoneLast4: "1111" },
    );

    expect(result.status).toBe("ambiguous");
    expect(result.student).toBeNull();
  });

  it("keeps a duplicated student/parent suffix pair unresolved", () => {
    const result = resolveStudentIdentity(
      [student("a", "1234", "1111"), student("b", "1234", "1111")],
      { studentPhoneLast4: "1234", parentPhoneLast4: "1111" },
    );

    expect(result.status).toBe("ambiguous");
    expect(result.student).toBeNull();
  });

  it("supports legacy phoneSuffix as the student phone suffix fallback", () => {
    const result = resolveStudentIdentity(
      [{ uid: "legacy", phoneSuffix: "9876" }],
      { studentPhoneLast4: "9876" },
    );

    expect(result.status).toBe("matched");
    expect(result.student?.uid).toBe("legacy");
  });
});

describe("extractPhoneIdentityHints", () => {
  it("extracts student and parent phone suffixes from labeled PDF text", () => {
    const hints = extractPhoneIdentityHints(
      "학생 전화번호: 010-1234-5678 학부모 전화번호: 010-7777-1111",
    );

    expect(hints).toEqual({
      studentPhoneLast4: "5678",
      parentPhoneLast4: "1111",
    });
  });

  it("uses the parsed legacy student suffix when no student phone label exists", () => {
    const hints = extractPhoneIdentityHints("학부모 연락처 010-8888-2222", "5678");

    expect(hints).toEqual({
      studentPhoneLast4: "5678",
      parentPhoneLast4: "2222",
    });
  });
});
