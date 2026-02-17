import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc,
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
import { User, GraduationCap } from "lucide-react";

type ClassDoc = {
  id: string;
  name: string;
};

type StudentDoc = {
  id: string; // uid
  name: string;
  email: string;
  role: "staff" | "student";
  classId?: string;
  className?: string;
};

const StudentAssignmentSection = () => {
  const [classes, setClasses] = useState<ClassDoc[]>([]);
  const [students, setStudents] = useState<StudentDoc[]>([]);
  const [search, setSearch] = useState("");

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
        if (s.role !== "student") return false;
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q)
        );
      }),
    [students, search]
  );

  const handleAssignClass = async (student: StudentDoc, classId: string) => {
    const ref = doc(db, "users", student.id);
    const cls = classes.find((c) => c.id === classId);
    await updateDoc(ref, {
      classId: classId || null,
      className: cls?.name ?? null,
    });
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
              {students.filter((s) => s.role === "student").length}
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
                배정
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
                  <Select
                    value={s.classId ?? ""}
                    onValueChange={(v) => handleAssignClass(s, v)}
                  >
                    <SelectTrigger className="h-8 w-44 border-slate-700 bg-slate-900 text-xs text-slate-50">
                      <SelectValue placeholder="반 선택" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 text-slate-50">
                      <SelectItem value="">미배정</SelectItem>
                      {classes.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

