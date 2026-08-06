import { describe, expect, it } from "vitest";
import { resolveMatchStatus, resolveReportAssignmentClass, type StudentLite } from "@/lib/pdfProcessor";

const student = (overrides: Partial<StudentLite>): StudentLite => ({
  docId: overrides.docId ?? overrides.uid ?? "doc-id",
  uid: overrides.uid ?? "uid",
  name: overrides.name ?? "홍길동",
  email: overrides.email ?? "",
  classId: overrides.classId ?? "class-a",
  classIds: overrides.classIds ?? [overrides.classId ?? "class-a"],
  className: overrides.className ?? "A반",
  studentId: overrides.studentId ?? null,
  phoneNumber: overrides.phoneNumber ?? null,
  phoneSuffix: overrides.phoneSuffix ?? null,
});

describe("resolveMatchStatus", () => {
  it("does not auto-match by phone when the name differs", () => {
    const classStudents = [
      student({ uid: "a", name: "김철수", classId: "class-a", phoneSuffix: "1234" }),
    ];
    const allStudents = [
      ...classStudents,
      student({ uid: "b", name: "이영희", classId: "class-b", phoneSuffix: "1234" }),
    ];

    const result = resolveMatchStatus(
      { name: "이영희", className: "A반", studentId: "", phoneSuffix: "1234" },
      classStudents,
      allStudents,
    );

    expect(result.status).toBe("unregistered");
    expect(result.selectedStudentUid).toBeNull();
  });

  it("auto-matches one same-name student inside the selected class", () => {
    const classStudents = [
      student({ uid: "a", name: "김철수", classId: "class-a", phoneSuffix: "1234" }),
    ];

    const result = resolveMatchStatus(
      { name: "김 철수", className: "A반", studentId: "", phoneSuffix: "9999" },
      classStudents,
      classStudents,
    );

    expect(result.status).toBe("ready");
    expect(result.selectedStudentUid).toBe("a");
  });

  it("uses phone only as a tie-breaker among same-name students", () => {
    const classStudents = [
      student({ uid: "a", name: "김철수", classId: "class-a", phoneSuffix: "1234" }),
      student({ uid: "b", name: "김철수", classId: "class-a", phoneSuffix: "5678" }),
    ];

    const result = resolveMatchStatus(
      { name: "김철수", className: "A반", studentId: "", phoneSuffix: "5678" },
      classStudents,
      classStudents,
    );

    expect(result.status).toBe("ready");
    expect(result.selectedStudentUid).toBe("b");
  });
  it("keeps the report class when manually linking a student", () => {
    const target = student({
      docId: "custom-doc",
      uid: "auth-uid",
      classId: "student-primary",
      classIds: ["student-primary"],
      className: "학생 기존 반",
    });

    expect(
      resolveReportAssignmentClass(
        { classId: "report-class", className: "리포트 업로드 반" },
        target,
      ),
    ).toEqual({ classId: "report-class", className: "리포트 업로드 반" });
  });

});
