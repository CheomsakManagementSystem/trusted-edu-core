import { useEffect, useMemo, useState } from "react";
import {
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { User, GraduationCap } from "lucide-react";
import { normalizeRole } from "@/lib/authz";
import {
  bulkUpdateStudentClassAssignments,
  buildClassMemberId,
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

const getValidClassIds = (classIds: unknown): string[] =>
  Array.isArray(classIds)
    ? classIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];

const StudentAssignmentSection = () => {
  const { toast } = useToast();
  const [classes, setClasses] = useState<ClassDoc[]>([]);
  const [students, setStudents] = useState<StudentDoc[]>([]);
  const [search, setSearch] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [selectedBulkClassId, setSelectedBulkClassId] = useState("none");
  const [pendingClassSelections, setPendingClassSelections] = useState<Record<string, string>>({});
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "classes"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const list: ClassDoc[] = [];
      snap.forEach((d) => {
        const data = d.data() as any;
        list.push({ id: d.id, name: data.name });
      });
      setClasses(list);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "users"), orderBy("name"));
    const unsub = onSnapshot(q, (snap) => {
      const list: StudentDoc[] = [];
      snap.forEach((d) => {
        const data = d.data() as any;
        list.push({
          id: data.uid ?? d.id,
          name: data.name,
          email: data.email,
          role: data.role,
          classId: data.classId,
          classIds: getValidClassIds(data.classIds),
          className: data.className,
        });
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
        next[student.id] = prev[student.id] ?? student.classIds[0] ?? student.classId ?? "none";
      });
      return next;
    });
  }, [students]);

  useEffect(() => {
    const ids = new Set(filteredStudents.map((student) => student.id));
    setSelectedStudentIds((prev) => prev.filter((id) => ids.has(id)));
  }, [filteredStudents]);

  const handleAssignClass = async (student: StudentDoc) => {
    const nextClassId = pendingClassSelections[student.id] ?? student.classIds[0] ?? student.classId ?? "none";
    const currentClassId = student.classIds[0] ?? student.classId ?? "none";
    if (nextClassId === currentClassId) {
      return;
    }

    setSavingStudentId(student.id);
    try {
      const cls = classes.find((c) => c.id === nextClassId) ?? null;
      if (!cls) {
        throw new Error("배정할 반을 선택해주세요.");
      }

      console.log(`[Assign] Starting batch for student: ${student.id}`);

      const batch = writeBatch(db);
      const memberRef = doc(db, "class_members", buildClassMemberId(cls.id, student.id));
      const userRef = doc(db, "users", student.id);

      batch.set(memberRef, {
        classId: cls.id,
        className: cls.name,
        uid: student.id,
        studentName: student.name ?? null,
        studentEmail: student.email ?? null,
        createdAt: serverTimestamp(),
      }, { merge: true });

      batch.set(userRef, {
        classId: cls.id,
        className: cls.name,
        classIds: arrayUnion(cls.id),
        isEnrolled: true,
        enrollmentStatus: "active",
        updatedAt: serverTimestamp(),
      }, { merge: true });

      await batch.commit();
      console.log(`[Assign] Batch committed successfully for student: ${student.id}`);

      setStudents((prev) =>
        prev.map((item) =>
          item.id === student.id
            ? {
                ...item,
                classId: cls.id,
                className: cls.name,
                classIds: Array.from(new Set([...item.classIds, cls.id])),
              }
            : item,
        ),
      );
      setPendingClassSelections((prev) => ({ ...prev, [student.id]: cls.id }));
      console.log("[Sync] UI state refreshed after assignment");

      toast({
        title: "반 정보가 성공적으로 업데이트되었습니다",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "반 변경 실패",
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해주세요.",
      });
      setPendingClassSelections((prev) => ({
        ...prev,
        [student.id]: student.classIds[0] ?? student.classId ?? "none",
      }));
    } finally {
      setSavingStudentId(null);
    }
  };

  const handleBulkAssign = async () => {
    if (!selectedStudentIds.length) {
      return;
    }

    setBulkSaving(true);
    try {
      const cls = classes.find((c) => c.id === selectedBulkClassId) ?? null;
      await bulkUpdateStudentClassAssignments(selectedStudentIds, cls);
      setSelectedStudentIds([]);
      toast({
        title: "반 정보가 성공적으로 업데이트되었습니다",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "일괄 변경 실패",
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해주세요.",
      });
    } finally {
      setBulkSaving(false);
    }
  };

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

      <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3 md:flex-row md:items-center">
        <Select value={selectedBulkClassId} onValueChange={setSelectedBulkClassId}>
          <SelectTrigger className="h-9 w-full border-slate-700 bg-slate-900 text-xs text-slate-50 md:w-56">
            <SelectValue placeholder="반 일괄 변경" />
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
        <Button
          type="button"
          onClick={handleBulkAssign}
          disabled={bulkSaving || selectedStudentIds.length === 0}
          className="bg-sky-500 text-slate-950 hover:bg-sky-400"
        >
          반 일괄 변경
        </Button>
        <span className="text-xs text-slate-400">선택 학생 {selectedStudentIds.length}명</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
        <table className="min-w-full divide-y divide-slate-800 text-sm">
          <thead className="bg-slate-900">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                선택
              </th>
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
                <td className="px-4 py-2">
                  <Checkbox
                    checked={selectedStudentIds.includes(s.id)}
                    onCheckedChange={(checked) =>
                      setSelectedStudentIds((prev) =>
                        checked
                          ? Array.from(new Set([...prev, s.id]))
                          : prev.filter((id) => id !== s.id),
                      )
                    }
                    className="border-slate-600 data-[state=checked]:border-sky-500 data-[state=checked]:bg-sky-500"
                  />
                </td>
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
                      value={pendingClassSelections[s.id] ?? s.classIds[0] ?? s.classId ?? "none"}
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
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={
                        savingStudentId === s.id ||
                        (pendingClassSelections[s.id] ?? s.classIds[0] ?? s.classId ?? "none") ===
                          (s.classIds[0] ?? s.classId ?? "none")
                      }
                      className="border border-slate-700 bg-slate-800 text-slate-50 hover:bg-slate-700"
                      onClick={() => handleAssignClass(s)}
                    >
                      저장
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredStudents.length === 0 && (
              <tr>
                <td
                  colSpan={5}
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
