import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocsFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { AlertTriangle, CheckCircle2, Download, Loader2, ShieldCheck, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { normalizeClassIds } from "@/services/classTransferService";

type ClassRow = {
  id: string;
  name: string;
};

type StudentIntegrityRow = {
  docId: string;
  uid: string;
  name: string;
  email: string;
  role: string;
  classId: string | null;
  className: string | null;
  classIds: string[];
  rawClassIds: string[];
  isEnrolled: boolean | null;
  enrollmentStatus: string | null;
};

type IntegrityIssue = {
  type: "legacy_class_id" | "ghost_class" | "enrollment_mismatch";
  studentDocId: string;
  studentUid: string;
  studentName: string;
  detail: string;
};

type IntegritySummary = {
  legacyClassIdOnly: number;
  ghostClass: number;
  enrollmentMismatch: number;
};

type IntegritySnapshot = {
  checkedAt: string;
  students: StudentIntegrityRow[];
  classes: ClassRow[];
  issues: IntegrityIssue[];
  summary: IntegritySummary;
};

const emptySummary: IntegritySummary = {
  legacyClassIdOnly: 0,
  ghostClass: 0,
  enrollmentMismatch: 0,
};

const isStudentRole = (role: string) => role.toUpperCase() === "STUDENT";

const toStringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const toRawClassIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];

const hydrateStudent = (docId: string, data: Record<string, unknown>): StudentIntegrityRow => {
  const classId = toStringOrNull(data.classId);
  const rawClassIds = toRawClassIds(data.classIds);

  return {
    docId,
    uid: toStringOrNull(data.uid) ?? docId,
    name: toStringOrNull(data.name) ?? "이름없음",
    email: toStringOrNull(data.email) ?? "",
    role: toStringOrNull(data.role) ?? "",
    classId,
    className: toStringOrNull(data.className),
    classIds: normalizeClassIds(rawClassIds, classId),
    rawClassIds,
    isEnrolled: typeof data.isEnrolled === "boolean" ? data.isEnrolled : null,
    enrollmentStatus: toStringOrNull(data.enrollmentStatus),
  };
};

const hydrateClass = (docId: string, data: Record<string, unknown>): ClassRow => ({
  id: docId,
  name: toStringOrNull(data.name) ?? "이름없는 반",
});

const buildIntegritySnapshot = (
  students: StudentIntegrityRow[],
  classes: ClassRow[],
): IntegritySnapshot => {
  const classIds = new Set(classes.map((row) => row.id));
  const issues: IntegrityIssue[] = [];
  const summary = { ...emptySummary };

  students.filter((student) => isStudentRole(student.role)).forEach((student) => {
    if (student.rawClassIds.length === 0 && Boolean(student.classId)) {
      summary.legacyClassIdOnly += 1;
      issues.push({
        type: "legacy_class_id",
        studentDocId: student.docId,
        studentUid: student.uid,
        studentName: student.name,
        detail: `classIds 배열은 비어 있으나 classId=${student.classId} 값이 존재합니다.`,
      });
    }

    const ghostIds = student.classIds.filter((classId) => !classIds.has(classId));
    if (ghostIds.length > 0) {
      summary.ghostClass += 1;
      issues.push({
        type: "ghost_class",
        studentDocId: student.docId,
        studentUid: student.uid,
        studentName: student.name,
        detail: `존재하지 않는 반 ID: ${ghostIds.join(", ")}`,
      });
    }

    const validClassIds = student.classIds.filter((classId) => classIds.has(classId));
    const shouldBeEnrolled = validClassIds.length > 0;
    if (student.isEnrolled !== shouldBeEnrolled) {
      summary.enrollmentMismatch += 1;
      issues.push({
        type: "enrollment_mismatch",
        studentDocId: student.docId,
        studentUid: student.uid,
        studentName: student.name,
        detail: `isEnrolled=${String(student.isEnrolled)} / 실제 배정=${String(shouldBeEnrolled)}`,
      });
    }
  });

  return {
    checkedAt: new Date().toISOString(),
    students,
    classes,
    issues,
    summary,
  };
};

const fetchSnapshotFromServer = async (): Promise<IntegritySnapshot> => {
  const [studentSnap, classSnap] = await Promise.all([
    getDocsFromServer(query(collection(db, "users"))),
    getDocsFromServer(query(collection(db, "classes"))),
  ]);
  const students = studentSnap.docs.map((docSnap) =>
    hydrateStudent(docSnap.id, docSnap.data() as Record<string, unknown>),
  );
  const classes = classSnap.docs.map((docSnap) =>
    hydrateClass(docSnap.id, docSnap.data() as Record<string, unknown>),
  );

  return buildIntegritySnapshot(students, classes);
};

const csvEscape = (value: unknown) => {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const buildCsv = (snapshot: IntegritySnapshot) => {
  const issueMap = new Map<string, IntegrityIssue[]>();
  snapshot.issues.forEach((issue) => {
    const prev = issueMap.get(issue.studentDocId) ?? [];
    prev.push(issue);
    issueMap.set(issue.studentDocId, prev);
  });

  const headers = [
    "checkedAt",
    "docId",
    "uid",
    "name",
    "email",
    "role",
    "classId",
    "className",
    "classIds",
    "isEnrolled",
    "enrollmentStatus",
    "issueTypes",
    "issueDetails",
  ];

  const rows = snapshot.students.map((student) => {
    const issues = issueMap.get(student.docId) ?? [];
    return [
      snapshot.checkedAt,
      student.docId,
      student.uid,
      student.name,
      student.email,
      student.role,
      student.classId ?? "",
      student.className ?? "",
      student.classIds.join("|"),
      String(student.isEnrolled ?? ""),
      student.enrollmentStatus ?? "",
      issues.map((issue) => issue.type).join("|"),
      issues.map((issue) => issue.detail).join(" | "),
    ].map(csvEscape).join(",");
  });

  return [headers.join(","), ...rows].join("\n");
};

const downloadCsv = (snapshot: IntegritySnapshot) => {
  const csv = buildCsv(snapshot);
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `integrity-snapshot-${snapshot.checkedAt.slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const commitBatches = async (
  updates: Array<{ docId: string; payload: Record<string, unknown> }>,
) => {
  for (let index = 0; index < updates.length; index += 450) {
    const batch = writeBatch(db);
    updates.slice(index, index + 450).forEach((update) => {
      batch.set(doc(db, "users", update.docId), update.payload, { merge: true });
    });
    await batch.commit();
  }
};

const IntegrityManager = () => {
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState<IntegritySnapshot | null>(null);
  const [liveSummary, setLiveSummary] = useState<IntegritySummary>(emptySummary);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);

  const totalIssueCount = useMemo(
    () =>
      liveSummary.legacyClassIdOnly +
      liveSummary.ghostClass +
      liveSummary.enrollmentMismatch,
    [liveSummary],
  );

  useEffect(() => {
    let latestStudents: StudentIntegrityRow[] = [];
    let latestClasses: ClassRow[] = [];

    const updateLiveSummary = () => {
      const nextSnapshot = buildIntegritySnapshot(latestStudents, latestClasses);
      setLiveSummary(nextSnapshot.summary);
    };

    const unsubUsers = onSnapshot(query(collection(db, "users")), (snap) => {
      latestStudents = snap.docs.map((docSnap) =>
        hydrateStudent(docSnap.id, docSnap.data() as Record<string, unknown>),
      );
      updateLiveSummary();
    });

    const unsubClasses = onSnapshot(query(collection(db, "classes")), (snap) => {
      latestClasses = snap.docs.map((docSnap) =>
        hydrateClass(docSnap.id, docSnap.data() as Record<string, unknown>),
      );
      updateLiveSummary();
    });

    return () => {
      unsubUsers();
      unsubClasses();
    };
  }, []);

  const handleAudit = async () => {
    setLoading(true);
    try {
      const nextSnapshot = await fetchSnapshotFromServer();
      setSnapshot(nextSnapshot);
      setLiveSummary(nextSnapshot.summary);
      toast({
        title: "데이터 무결성 진단 완료",
        description: `오류 ${nextSnapshot.issues.length}건을 확인했습니다.`,
      });
    } catch (error) {
      console.error("[IntegrityManager] audit failed", error);
      toast({
        variant: "destructive",
        title: "무결성 진단 실패",
        description: error instanceof Error ? error.message : "진단 중 오류가 발생했습니다.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRepair = async () => {
    setRepairing(true);
    try {
      const beforeRepair = await fetchSnapshotFromServer();
      const classNameById = new Map(beforeRepair.classes.map((row) => [row.id, row.name]));
      const validClassIds = new Set(beforeRepair.classes.map((row) => row.id));
      const updates = beforeRepair.students
        .filter((student) => isStudentRole(student.role))
        .map((student) => {
          const repairedClassIds = normalizeClassIds(student.classIds, student.classId)
            .filter((classId) => validClassIds.has(classId));
          const primaryClassId = repairedClassIds[0] ?? null;
          const isEnrolled = repairedClassIds.length > 0;

          return {
            student,
            payload: {
              classIds: repairedClassIds,
              classId: primaryClassId,
              className: primaryClassId ? classNameById.get(primaryClassId) ?? null : null,
              isEnrolled,
              enrollmentStatus: isEnrolled ? "active" : null,
              updatedAt: serverTimestamp(),
            },
          };
        })
        .filter(({ student, payload }) => {
          const nextClassIds = payload.classIds as string[];
          return (
            JSON.stringify(normalizeClassIds(student.rawClassIds).sort()) !== JSON.stringify([...nextClassIds].sort()) ||
            student.classId !== payload.classId ||
            student.className !== payload.className ||
            student.isEnrolled !== payload.isEnrolled ||
            student.enrollmentStatus !== payload.enrollmentStatus
          );
        })
        .map(({ student, payload }) => ({
          docId: student.docId,
          payload,
        }));

      await commitBatches(updates);

      const afterRepair = await fetchSnapshotFromServer();
      setSnapshot(afterRepair);
      setLiveSummary(afterRepair.summary);
      toast({
        title: "자동 복구 완료",
        description: `${updates.length}개 학생 문서를 정규화했습니다.`,
      });
    } catch (error) {
      console.error("[IntegrityManager] repair failed", error);
      toast({
        variant: "destructive",
        title: "자동 복구 실패",
        description: error instanceof Error ? error.message : "복구 중 오류가 발생했습니다.",
      });
    } finally {
      setRepairing(false);
    }
  };

  const isWorking = loading || repairing;
  const currentSummary = snapshot?.summary ?? liveSummary;
  const currentTotal =
    currentSummary.legacyClassIdOnly +
    currentSummary.ghostClass +
    currentSummary.enrollmentMismatch;

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-card">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="text-base font-bold text-card-foreground">데이터 무결성 관리</h2>
            <Badge variant={currentTotal > 0 ? "destructive" : "secondary"}>
              오류 {currentTotal}건
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={currentSummary.legacyClassIdOnly > 0 ? "destructive" : "outline"}>
              Legacy classId {currentSummary.legacyClassIdOnly}
            </Badge>
            <Badge variant={currentSummary.ghostClass > 0 ? "destructive" : "outline"}>
              Ghost Class {currentSummary.ghostClass}
            </Badge>
            <Badge variant={currentSummary.enrollmentMismatch > 0 ? "destructive" : "outline"}>
              Enrollment 불일치 {currentSummary.enrollmentMismatch}
            </Badge>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={handleAudit} disabled={isWorking}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-2 h-4 w-4" />}
            Run Audit
          </Button>
          <Button type="button" onClick={handleRepair} disabled={isWorking}>
            {repairing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wrench className="mr-2 h-4 w-4" />}
            Run Repair
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => snapshot && downloadCsv(snapshot)}
            disabled={!snapshot || isWorking}
          >
            <Download className="mr-2 h-4 w-4" />
            CSV 다운로드
          </Button>
        </div>
      </div>

      {isWorking && (
        <div className="mt-4 space-y-2">
          <Progress value={repairing ? 66 : 33} className="h-2 bg-muted" />
          <p className="text-xs text-muted-foreground">
            {repairing ? "학생 문서 복구 및 서버 재조회 중..." : "Firestore 서버 데이터 진단 중..."}
          </p>
        </div>
      )}

      {snapshot && (
        <div className="mt-4 rounded-md border border-border bg-background px-3 py-2">
          <div className="flex items-center gap-2 text-sm text-card-foreground">
            {snapshot.issues.length === 0 ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            )}
            <span>
              마지막 진단: {new Date(snapshot.checkedAt).toLocaleString()} / 학생 {snapshot.students.length}명 /
              오류 {snapshot.issues.length}건
            </span>
          </div>
        </div>
      )}
    </section>
  );
};

export default IntegrityManager;
