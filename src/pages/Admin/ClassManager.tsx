import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import DashboardLayout from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { db } from "@/lib/firebase";
import {
  fetchClasses,
  fetchStudents,
  type ClassLite,
  type StudentLite,
} from "@/lib/pdfProcessor";
import { formatStudentName } from "@/lib/studentName";

type ClassFormState = {
  id: string | null;
  name: string;
};

const ClassManager = () => {
  const [classes, setClasses] = useState<ClassLite[]>([]);
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("none");
  const [checkedStudentUids, setCheckedStudentUids] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [classForm, setClassForm] = useState<ClassFormState>({ id: null, name: "" });
  const [message, setMessage] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [expandedClassId, setExpandedClassId] = useState<string | null>(null);

  const loadData = async () => {
    const [classDocs, studentDocs] = await Promise.all([fetchClasses(), fetchStudents()]);
    setClasses(classDocs);
    setStudents(studentDocs);
  };

  useEffect(() => {
    loadData();
  }, []);

  const selectedClass = useMemo(
    () => classes.find((item) => item.id === selectedClassId) ?? null,
    [classes, selectedClassId],
  );

  const hasAssignedClass = (student: StudentLite) =>
    Boolean(student.classId) || Boolean(student.className && student.className !== "미배정");

  const formatStudentLabel = (student: StudentLite) =>
    formatStudentName(student.name, {
      phoneNumber: student.phoneNumber,
      phoneSuffix: student.phoneSuffix,
      studentId: student.studentId,
    });

  const filteredStudents = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return students.filter((student) => {
      if (hasAssignedClass(student)) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return (
        student.name.toLowerCase().includes(keyword) ||
        student.email.toLowerCase().includes(keyword)
      );
    });
  }, [search, students]);

  const studentsByClassId = useMemo(() => {
    const map = new Map<string, StudentLite[]>();
    classes.forEach((item) => {
      map.set(item.id, []);
    });

    students.forEach((student) => {
      if (!student.classId) {
        return;
      }
      const list = map.get(student.classId);
      if (!list) {
        return;
      }
      list.push(student);
    });

    return map;
  }, [classes, students]);

  useEffect(() => {
    const assignableUids = new Set(filteredStudents.map((student) => student.uid));
    setCheckedStudentUids((prev) => prev.filter((uid) => assignableUids.has(uid)));
  }, [filteredStudents]);

  const toggleChecked = (uid: string, checked: boolean) => {
    setCheckedStudentUids((prev) => {
      if (checked) {
        return Array.from(new Set([...prev, uid]));
      }
      return prev.filter((item) => item !== uid);
    });
  };

  const handleCreateOrUpdateClass = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = classForm.name.trim();
    if (!name) {
      setMessage("반 이름을 입력해주세요.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      if (classForm.id) {
        await updateDoc(doc(db, "classes", classForm.id), {
          name,
          updatedAt: serverTimestamp(),
        });
        await getDocs(query(collection(db, "users"), where("classId", "==", classForm.id))).then(
          async (snap) => {
            await Promise.all(
              snap.docs.map((studentDoc) =>
                updateDoc(studentDoc.ref, {
                  className: name,
                  updatedAt: serverTimestamp(),
                }),
              ),
            );
          },
        );
        setMessage("반 정보가 수정되었습니다.");
      } else {
        await addDoc(collection(db, "classes"), {
          name,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setMessage("새 반이 생성되었습니다.");
      }

      setClassForm({ id: null, name: "" });
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "반 저장에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClass = async (classDoc: ClassLite) => {
    if (!window.confirm(`'${classDoc.name}' 반을 삭제하시겠습니까?`)) {
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const studentsInClass = await getDocs(
        query(collection(db, "users"), where("classId", "==", classDoc.id)),
      );

      await Promise.all(
        studentsInClass.docs.map((studentDoc) =>
          updateDoc(studentDoc.ref, {
            classId: null,
            className: null,
            isEnrolled: false,
            enrollmentStatus: null,
            updatedAt: serverTimestamp(),
          }),
        ),
      );

      await deleteDoc(doc(db, "classes", classDoc.id));

      if (selectedClassId === classDoc.id) {
        setSelectedClassId("none");
      }

      setMessage("반이 삭제되었습니다.");
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "반 삭제에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleAssignStudents = async () => {
    if (!selectedClass) {
      setMessage("배정할 반을 먼저 선택해주세요.");
      return;
    }

    if (checkedStudentUids.length === 0) {
      setMessage("배정할 학생을 선택해주세요.");
      return;
    }

    const assignedUids = [...checkedStudentUids];
    setLoading(true);
    setMessage("");

    try {
      await Promise.all(
        assignedUids.map((uid) =>
          updateDoc(doc(db, "users", uid), {
            classId: selectedClass.id,
            className: selectedClass.name,
            isEnrolled: true,
            enrollmentStatus: "active",
            updatedAt: serverTimestamp(),
          }),
        ),
      );

      setStudents((prev) =>
        prev.map((student) =>
          assignedUids.includes(student.uid)
            ? { ...student, classId: selectedClass.id, className: selectedClass.name }
            : student,
        ),
      );
      setCheckedStudentUids([]);
      setMessage(`${assignedUids.length}명의 학생을 '${selectedClass.name}'에 배정했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "학생 배정에 실패했습니다.");
      await loadData();
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveStudentFromClass = async (student: StudentLite) => {
    if (!window.confirm(`${formatStudentLabel(student)} 학생을 현재 반에서 내보내시겠습니까?`)) {
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      await updateDoc(doc(db, "users", student.uid), {
        classId: null,
        className: null,
        isEnrolled: false,
        enrollmentStatus: null,
        updatedAt: serverTimestamp(),
      });
      setMessage(`${formatStudentLabel(student)} 학생의 반 배정을 취소했습니다.`);
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "학생 배정 취소에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">반 관리</h2>
          <p className="text-sm text-muted-foreground">
            반 배정이 필요한 학생만 표시됩니다.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <h3 className="mb-3 text-sm font-semibold text-card-foreground">강의실 개설 및 편집</h3>
          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={handleCreateOrUpdateClass}>
            <Input
              value={classForm.name}
              onChange={(event) => setClassForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="반 이름 예: 대치 일 아침"
              className="max-w-sm"
            />
            <Button type="submit" disabled={loading}>
              {classForm.id ? "반 수정" : "반 생성"}
            </Button>
            {classForm.id && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setClassForm({ id: null, name: "" })}
                disabled={loading}
              >
                취소
              </Button>
            )}
          </form>

          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
            {classes.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2"
              >
                <span className="text-sm text-card-foreground">{item.name}</span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setExpandedClassId((prev) => (prev === item.id ? null : item.id))
                    }
                    disabled={loading}
                  >
                    현황 보기
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setClassForm({ id: item.id, name: item.name })}
                    disabled={loading}
                  >
                    수정
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDeleteClass(item)}
                    disabled={loading}
                  >
                    삭제
                  </Button>
                </div>
              </div>
            ))}
            {classes.length === 0 && (
              <p className="text-sm text-muted-foreground">등록된 반이 없습니다.</p>
            )}
          </div>

          {expandedClassId && (
            <div className="mt-4 rounded-md border border-border bg-background p-3">
              {(() => {
                const targetClass = classes.find((item) => item.id === expandedClassId);
                if (!targetClass) {
                  return <p className="text-sm text-muted-foreground">반 정보를 찾을 수 없습니다.</p>;
                }
                const members = studentsByClassId.get(expandedClassId) ?? [];
                return (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-card-foreground">
                      현재 [{targetClass.name}] 수강생 목록: {members.length}명
                    </p>
                    {members.length === 0 ? (
                      <p className="text-sm text-muted-foreground">아직 배정된 학생이 없습니다.</p>
                    ) : (
                      <div className="space-y-1">
                        {members.map((student) => (
                          <div
                            key={`member-${targetClass.id}-${student.uid}`}
                            className="flex flex-col gap-2 rounded border border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div>
                              <p className="text-sm text-card-foreground">{formatStudentLabel(student)}</p>
                              <p className="text-xs text-muted-foreground">{student.email}</p>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={() => handleRemoveStudentFromClass(student)}
                              disabled={loading}
                            >
                              배정 취소/강퇴
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h3 className="text-sm font-semibold text-card-foreground">학생 배정</h3>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="학생 이름/이메일 검색"
                className="sm:w-64"
              />
              <Select value={selectedClassId} onValueChange={setSelectedClassId}>
                <SelectTrigger className="sm:w-56">
                  <SelectValue placeholder="배정할 반 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">반 선택</SelectItem>
                  {classes.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleAssignStudents} disabled={loading || !selectedClass}>
                선택 학생 배정
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            반 배정이 필요한 학생만 표시됩니다.
          </p>

          <div className="mt-4 space-y-2">
            {filteredStudents.map((student) => {
              const checked = checkedStudentUids.includes(student.uid);
              return (
                <label
                  key={student.uid}
                  className="flex cursor-pointer items-center justify-between rounded-md border border-border bg-background px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => toggleChecked(student.uid, Boolean(value))}
                    />
                    <div>
                      <p className="text-sm font-medium text-card-foreground">{formatStudentLabel(student)}</p>
                      <p className="text-xs text-muted-foreground">{student.email}</p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {student.className || "미배정"}
                  </span>
                </label>
              );
            })}
            {filteredStudents.length === 0 && (
              <p className="text-sm text-muted-foreground">표시할 학생이 없습니다.</p>
            )}
          </div>
        </div>

        {message && <p className="text-sm text-card-foreground">{message}</p>}
      </div>
    </DashboardLayout>
  );
};

export default ClassManager;
