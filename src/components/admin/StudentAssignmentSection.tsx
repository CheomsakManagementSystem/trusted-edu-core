import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocsFromServer,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { User, GraduationCap, Loader2, RefreshCcw, ShieldCheck } from "lucide-react";
import { normalizeRole } from "@/lib/authz";
import {
  normalizeClassIds,
} from "@/services/classTransferService";

type ClassDoc = {
  id: string;
  name: string;
};

type StudentDoc = {
  id: string; // uid
  name: string;
  email: string;
  role: string;
  classId?: string;
  classIds: string[];
  className?: string;
};

const hydrateStudentDoc = (id: string, data: Record<string, unknown>): StudentDoc => {
  const classId = typeof data.classId === "string" ? data.classId : undefined;

  return {
    id: typeof data.uid === "string" ? data.uid : id,
    name: typeof data.name === "string" ? data.name : "",
    email: typeof data.email === "string" ? data.email : "",
    role: typeof data.role === "string" ? data.role : "",
    classId,
    classIds: normalizeClassIds(data.classIds, classId),
    className: typeof data.className === "string" ? data.className : undefined,
  };
};

const waitForServerPropagation = () =>
  new Promise((resolve) => setTimeout(resolve, 500));

const fetchStudentsFromServer = async (): Promise<StudentDoc[]> => {
  // [FIXED] Firestore 로컬 캐시를 우회하고 서버 원본 데이터를 강제 재조회한다.
  const querySnapshot = await getDocsFromServer(query(collection(db, "users")));

  return querySnapshot.docs
    .map((docSnap) => hydrateStudentDoc(docSnap.id, docSnap.data() as Record<string, unknown>))
    .sort((a, b) => a.name.localeCompare(b.name));
};

type SyncMismatch = {
  id: string;
  name: string;
  email: string;
  uiClassId: string;
  dbClassId: string;
};

type SyncManagerProps = {
  classes: ClassDoc[];
  pendingClassSelections: Record<string, string>;
  setPendingClassSelections: Dispatch<SetStateAction<Record<string, string>>>;
  setStudents: Dispatch<SetStateAction<StudentDoc[]>>;
};

const buildPendingSelections = (rows: StudentDoc[]) => {
  const next: Record<string, string> = {};
  rows.forEach((student) => {
    if (normalizeRole(student.role) === "STUDENT") {
      next[student.id] = normalizeClassIds(student.classIds)[0] ?? "none";
    }
  });
  return next;
};

const SyncManager = ({
  classes,
  pendingClassSelections,
  setPendingClassSelections,
  setStudents,
}: SyncManagerProps) => {
  const { toast } = useToast();
  const [mismatches, setMismatches] = useState<SyncMismatch[]>([]);
  const [checking, setChecking] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const classNameById = useMemo(
    () => new Map(classes.map((classRow) => [classRow.id, classRow.name])),
    [classes],
  );

  const findMismatches = async () => {
    const freshStudents = await fetchStudentsFromServer();
    const nextMismatches = freshStudents
      .filter((student) => normalizeRole(student.role) === "STUDENT")
      .map((student) => {
        const uiClassId = pendingClassSelections[student.id];
        if (uiClassId === undefined) {
          return null;
        }

        const normalizedUiClassId = uiClassId || "none";
        const dbClassId = normalizeClassIds(student.classIds)[0] ?? "none";

        if (normalizedUiClassId === dbClassId) {
          return null;
        }

        return {
          id: student.id,
          name: student.name,
          email: student.email,
          uiClassId: normalizedUiClassId,
          dbClassId,
        };
      })
      .filter((row): row is SyncMismatch => row !== null);

    return { freshStudents, nextMismatches };
  };

  const handleVerifySync = async () => {
    setChecking(true);
    try {
      const { nextMismatches } = await findMismatches();
      setMismatches(nextMismatches);
      toast({
        title: "싱크 검증 완료",
        description: `불일치 ${nextMismatches.length}건을 확인했습니다.`,
      });
    } catch (error) {
      console.error("[SyncManager] verify failed", error);
      toast({
        variant: "destructive",
        title: "싱크 검증 실패",
        description: error instanceof Error ? error.message : "검증 중 오류가 발생했습니다.",
      });
    } finally {
      setChecking(false);
    }
  };

  const handleForceSync = async () => {
    setSyncing(true);
    try {
      const { nextMismatches } = await findMismatches();

      await Promise.all(
        nextMismatches.map((mismatch) => {
          const nextClassId = mismatch.uiClassId === "none" ? null : mismatch.uiClassId;
          const nextClassName = nextClassId ? classNameById.get(nextClassId) ?? null : null;

          return setDoc(
            doc(db, "users", mismatch.id),
            {
              classId: nextClassId,
              className: nextClassName,
              classIds: nextClassId ? [nextClassId] : [],
              isEnrolled: Boolean(nextClassId),
              enrollmentStatus: nextClassId ? "active" : null,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }),
      );

      await waitForServerPropagation();
      const syncedStudents = await fetchStudentsFromServer();
      setStudents(syncedStudents);
      setPendingClassSelections(buildPendingSelections(syncedStudents));
      setMismatches([]);

      toast({
        title: "싱크 강제 동기화 완료",
        description: `${nextMismatches.length}개 학생 문서를 UI 값 기준으로 동기화했습니다.`,
      });
    } catch (error) {
      console.error("[SyncManager] force sync failed", error);
      toast({
        variant: "destructive",
        title: "싱크 강제 동기화 실패",
        description: error instanceof Error ? error.message : "동기화 중 오류가 발생했습니다.",
      });
    } finally {
      setSyncing(false);
    }
  };

  const isWorking = checking || syncing;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-sky-400" />
            <h3 className="text-sm font-semibold text-slate-50">UI/DB 싱크 관리</h3>
            <Badge variant={mismatches.length > 0 ? "destructive" : "secondary"}>
              Sync Mismatch {mismatches.length}
            </Badge>
          </div>
          <p className="text-xs text-slate-400">
            기준: normalizeClassIds(user.classIds)[0] === pendingClassSelections[user.id]
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            onClick={handleVerifySync}
            disabled={isWorking}
            className="border border-slate-700 bg-slate-800 text-slate-50 hover:bg-slate-700"
          >
            {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
            싱크 검증
          </Button>
          <Button
            type="button"
            onClick={handleForceSync}
            disabled={isWorking}
            className="bg-sky-500 text-slate-950 hover:bg-sky-400"
          >
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            싱크 강제 동기화
          </Button>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-800">
        <table className="min-w-full divide-y divide-slate-800 text-xs">
          <thead className="bg-slate-950/60 text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">학생</th>
              <th className="px-3 py-2 text-left font-medium">이메일</th>
              <th className="px-3 py-2 text-left font-medium">UI 값</th>
              <th className="px-3 py-2 text-left font-medium">DB 값</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-900/40">
            {mismatches.map((mismatch) => (
              <tr key={mismatch.id}>
                <td className="px-3 py-2 text-slate-100">{mismatch.name}</td>
                <td className="px-3 py-2 text-slate-300">{mismatch.email}</td>
                <td className="px-3 py-2 text-sky-300">
                  {mismatch.uiClassId === "none" ? "미배정" : classNameById.get(mismatch.uiClassId) ?? mismatch.uiClassId}
                </td>
                <td className="px-3 py-2 text-rose-300">
                  {mismatch.dbClassId === "none" ? "미배정" : classNameById.get(mismatch.dbClassId) ?? mismatch.dbClassId}
                </td>
              </tr>
            ))}
            {mismatches.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                  싱크 불일치 학생이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const StudentAssignmentSection = () => {
  const [classes, setClasses] = useState<ClassDoc[]>([]);
  const [students, setStudents] = useState<StudentDoc[]>([]);
  const [search, setSearch] = useState("");
  const [pendingClassSelections, setPendingClassSelections] = useState<Record<string, string>>({});

  useEffect(() => {
    const q = query(collection(db, "classes"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const list: ClassDoc[] = [];
      snap.forEach((d) => {
        const data = d.data() as Partial<Omit<ClassDoc, "id">>;
        list.push({ id: d.id, name: data.name ?? "" });
      });
      setClasses(list);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "users"), orderBy("name"));
    const unsub = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
      if (snap.metadata.fromCache) {
        return;
      }

      const list: StudentDoc[] = [];
      snap.forEach((d) => {
        list.push(hydrateStudentDoc(d.id, d.data() as Record<string, unknown>));
      });
      setStudents(list);
    });
    return () => unsub();
  }, []);

  const filteredStudents = useMemo(
    () =>
      students.filter((s) => {
        if (normalizeRole(s.role) !== "STUDENT") return false;
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q)
        );
      }),
    [students, search]
  );

  useEffect(() => {
    setPendingClassSelections((prev) => {
      const next: Record<string, string> = {};
      students.forEach((student) => {
        next[student.id] = prev[student.id] ?? normalizeClassIds(student.classIds)[0] ?? "none";
      });
      return next;
    });
  }, [students]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-50">
          학생 명단 및 배정
        </h2>
        <p className="text-sm text-slate-400">
          가입된 학생을 조회하고 각 반으로 배정합니다.
        </p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <User className="h-4 w-4 text-sky-400" />
          <span>
            전체 학생 수:{" "}
            <span className="font-semibold text-slate-200">
              {students.filter((s) => normalizeRole(s.role) === "STUDENT").length}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="학생 이름 또는 이메일 검색"
            className="h-9 w-64 border-slate-700 bg-slate-900 text-slate-50 placeholder:text-slate-500"
          />
        </div>
      </div>

      <SyncManager
        classes={classes}
        pendingClassSelections={pendingClassSelections}
        setPendingClassSelections={setPendingClassSelections}
        setStudents={setStudents}
      />

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
        <table className="min-w-full divide-y divide-slate-800 text-sm">
          <thead className="bg-slate-900">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                학생
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                이메일
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                현재 반
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                반 변경
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-900/40">
            {filteredStudents.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-2 text-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/10 text-sky-400">
                      <GraduationCap className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-sm font-medium">{s.name}</span>
                  </div>
                </td>
                <td className="px-4 py-2 text-xs text-slate-300">
                  {s.email}
                </td>
                <td className="px-4 py-2 text-xs text-slate-300">
                  {s.className || (
                    <span className="text-slate-500">미배정</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <Select
                      value={pendingClassSelections[s.id] ?? normalizeClassIds(s.classIds)[0] ?? "none"}
                      onValueChange={(v) =>
                        setPendingClassSelections((prev) => ({ ...prev, [s.id]: v }))
                      }
                    >
                      <SelectTrigger className="h-8 w-44 border-slate-700 bg-slate-900 text-xs text-slate-50">
                        <SelectValue placeholder="반 선택" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 text-slate-50">
                        <SelectItem value="none">미배정</SelectItem>
                        {classes.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </td>
              </tr>
            ))}
            {filteredStudents.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-xs text-slate-500"
                >
                  조건에 맞는 학생이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StudentAssignmentSection;
