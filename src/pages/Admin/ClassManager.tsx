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
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import {
  fetchClasses,
  fetchStudents,
  type ClassLite,
  type StudentLite,
} from "@/lib/pdfProcessor";
import { formatStudentName } from "@/lib/studentName";
import {
  bulkAddClassIdToStudents,
  bulkUpdateStudentClassIds,
  removeClassIdFromStudent,
  updateStudentClassIds,
} from "@/services/classTransferService";

type ClassFormState = {
  id: string | null;
  name: string;
};

const getValidClassIds = (classIds: unknown): string[] =>
  Array.isArray(classIds)
    ? classIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];

const ClassManager = () => {
  const { toast } = useToast();
  const [classes, setClasses] = useState<ClassLite[]>([]);
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("none");
  const [checkedStudentUids, setCheckedStudentUids] = useState<string[]>([]);
  const [checkedManagedStudentUids, setCheckedManagedStudentUids] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [classForm, setClassForm] = useState<ClassFormState>({ id: null, name: "" });
  const [message, setMessage] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [expandedClassId, setExpandedClassId] = useState<string | null>(null);
  const [adminSearch, setAdminSearch] = useState("");
  const [selectedBulkClassId, setSelectedBulkClassId] = useState("none");
  /** uid → 선택된 classId 배열 (다중 반 지원). 저장 전 로컬 펜딩 상태 */
  const [pendingClassSelections, setPendingClassSelections] = useState<Record<string, string[]>>({});

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

  const hasAssignedClass = (student: StudentLite) => {
    // classIds 배열 우선, 빈 문자열 같은 무효값은 미배정으로 처리
    if (getValidClassIds(student.classIds).length > 0) return true;
    return Boolean(student.classId) || Boolean(student.className && student.className !== "미배정");
  };

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

  const filteredManageableStudents = useMemo(() => {
    const keyword = adminSearch.trim().toLowerCase();
    return students.filter((student) => {
      if (!keyword) {
        return true;
      }
      return (
        student.name.toLowerCase().includes(keyword) ||
        student.email.toLowerCase().includes(keyword) ||
        (student.className ?? "").toLowerCase().includes(keyword)
      );
    });
  }, [adminSearch, students]);

  const studentsByClassId = useMemo(() => {
    const map = new Map<string, StudentLite[]>();
    classes.forEach((item) => {
      map.set(item.id, []);
    });

    students.forEach((student) => {
      // classIds 배열 우선, 없으면 classId 폴백
      const rawIds: string[] =
        getValidClassIds(student.classIds).length > 0
          ? getValidClassIds(student.classIds)
          : student.classId
            ? [student.classId]
            : [];

      // classIds 내 중복 제거 → 동일 반에 같은 학생이 두 번 추가되는 것 방지
      const uniqueIds = Array.from(new Set(rawIds));
      uniqueIds.forEach((cid) => {
        const list = map.get(cid);
        if (list) {
          list.push(student); // 다중 반이면 각 반 목록에 독립적으로 추가됨
        }
      });
    });

    return map;
  }, [classes, students]);

  useEffect(() => {
    const assignableUids = new Set(filteredStudents.map((student) => student.uid));
    setCheckedStudentUids((prev) => prev.filter((uid) => assignableUids.has(uid)));
  }, [filteredStudents]);

  useEffect(() => {
    const manageableUids = new Set(filteredManageableStudents.map((student) => student.uid));
    setCheckedManagedStudentUids((prev) => prev.filter((uid) => manageableUids.has(uid)));
  }, [filteredManageableStudents]);

  useEffect(() => {
    setPendingClassSelections((prev) => {
      const next: Record<string, string[]> = {};
      students.forEach((student) => {
        // 기존 펜딩이 있으면 유지, 없으면 classIds 정규화값으로 초기화
        if (prev[student.uid] !== undefined) {
          next[student.uid] = prev[student.uid];
        } else {
          const ids =
            getValidClassIds(student.classIds).length > 0
              ? getValidClassIds(student.classIds)
              : student.classId
                ? [student.classId]
                : [];
          next[student.uid] = ids;
        }
      });
      return next;
    });
  }, [students]);

  const toggleChecked = (uid: string, checked: boolean) => {
    setCheckedStudentUids((prev) => {
      if (checked) {
        return Array.from(new Set([...prev, uid]));
      }
      return prev.filter((item) => item !== uid);
    });
  };

  const toggleManagedChecked = (uid: string, checked: boolean) => {
    setCheckedManagedStudentUids((prev) => {
      if (checked) {
        return Array.from(new Set([...prev, uid]));
      }
      return prev.filter((item) => item !== uid);
    });
  };

  const areAllManageableStudentsChecked =
    filteredManageableStudents.length > 0 &&
    filteredManageableStudents.every((student) => checkedManagedStudentUids.includes(student.uid));

  const handleToggleAllManagedStudents = (checked: boolean) => {
    if (checked) {
      setCheckedManagedStudentUids(filteredManageableStudents.map((student) => student.uid));
      return;
    }
    setCheckedManagedStudentUids([]);
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
        studentsInClass.docs.map((studentDoc) => {
          const data = studentDoc.data() as { classIds?: unknown };
          const prevIds = Array.isArray(data.classIds) ? (data.classIds as string[]) : [];
          const nextIds = prevIds.filter((id) => id !== classDoc.id);
          return updateDoc(studentDoc.ref, {
            classIds: nextIds,
            classId: nextIds.length > 0 ? nextIds[0] : null,
            className: nextIds.length > 0 ? null : null, // className은 loadData 후 재조회
            isEnrolled: nextIds.length > 0,
            enrollmentStatus: nextIds.length > 0 ? "active" : null,
            updatedAt: serverTimestamp(),
          });
        }),
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
      // classIds 배열에 원자적 추가 (arrayUnion → 중복 방지)
      await bulkAddClassIdToStudents(assignedUids, selectedClass.id);

      setStudents((prev) =>
        prev.map((student) => {
          if (!assignedUids.includes(student.uid)) return student;
          const prevIds = Array.isArray(student.classIds) ? student.classIds : student.classId ? [student.classId] : [];
          const nextIds = Array.from(new Set([...prevIds, selectedClass.id]));
          return {
            ...student,
            classId: selectedClass.id,
            classIds: nextIds,
            className: student.className || selectedClass.name,
          };
        }),
      );
      setCheckedStudentUids([]);
      setMessage(`${assignedUids.length}명의 학생을 '${selectedClass.name}'에 배정했습니다.`);
      toast({ title: "반 정보가 성공적으로 업데이트되었습니다" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "학생 배정에 실패했습니다.");
      await loadData();
    } finally {
      setLoading(false);
    }
  };

  const handleStudentClassSave = async (student: StudentLite) => {
    const nextIds = pendingClassSelections[student.uid] ?? [];
    const currentIds = Array.isArray(student.classIds)
      ? [...student.classIds].sort()
      : student.classId
        ? [student.classId]
        : [];
    const deduped = Array.from(new Set(nextIds)).sort();

    if (JSON.stringify(deduped) === JSON.stringify(currentIds)) {
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      await updateStudentClassIds(student.uid, deduped);
      const firstClass = classes.find((c) => c.id === deduped[0]) ?? null;
      setStudents((prev) =>
        prev.map((item) =>
          item.uid === student.uid
            ? {
                ...item,
                classIds: deduped,
                classId: firstClass?.id ?? null,
                className: firstClass?.name ?? null,
              }
            : item,
        ),
      );
      setPendingClassSelections((prev) => ({ ...prev, [student.uid]: deduped }));
      toast({ title: "반 정보가 성공적으로 업데이트되었습니다" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "반 변경에 실패했습니다.");
      // 롤백
      setPendingClassSelections((prev) => ({ ...prev, [student.uid]: currentIds }));
    } finally {
      setLoading(false);
    }
  };

  const handleBulkTransfer = async () => {
    if (checkedManagedStudentUids.length === 0) {
      setMessage("반을 일괄 변경할 학생을 선택해주세요.");
      return;
    }

    const targetIds =
      selectedBulkClassId !== "none" ? [selectedBulkClassId] : [];
    const firstClass = classes.find((c) => c.id === selectedBulkClassId) ?? null;

    setLoading(true);
    setMessage("");
    try {
      await bulkUpdateStudentClassIds(checkedManagedStudentUids, targetIds);
      setStudents((prev) =>
        prev.map((student) =>
          checkedManagedStudentUids.includes(student.uid)
            ? {
                ...student,
                classIds: targetIds,
                classId: firstClass?.id ?? null,
                className: firstClass?.name ?? null,
              }
            : student,
        ),
      );
      setPendingClassSelections((prev) => {
        const next = { ...prev };
        checkedManagedStudentUids.forEach((uid) => {
          next[uid] = targetIds;
        });
        return next;
      });
      setCheckedManagedStudentUids([]);
      toast({ title: "반 정보가 성공적으로 업데이트되었습니다" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "반 일괄 변경에 실패했습니다.");
      await loadData();
    } finally {
      setLoading(false);
    }
  };

  /**
   * expandedClassId 컨텍스트에서 호출됨.
   * 해당 classId 만 제거하고, 다른 반 소속은 유지.
   */
  const handleRemoveStudentFromClass = async (student: StudentLite, targetClassId: string) => {
    if (!window.confirm(`${formatStudentLabel(student)} 학생을 이 반에서 내보내시겠습니까?`)) {
      return;
    }

    const currentIds = Array.isArray(student.classIds)
      ? student.classIds
      : student.classId
        ? [student.classId]
        : [];
    const remaining = currentIds.filter((id) => id !== targetClassId).length;

    setLoading(true);
    setMessage("");

    try {
      await removeClassIdFromStudent(student.uid, targetClassId, remaining);
      const nextIds = currentIds.filter((id) => id !== targetClassId);
      setStudents((prev) =>
        prev.map((s) => {
          if (s.uid !== student.uid) return s;
          const firstClass = classes.find((c) => c.id === nextIds[0]) ?? null;
          return {
            ...s,
            classIds: nextIds,
            classId: firstClass?.id ?? null,
            className: firstClass?.name ?? null,
          };
        }),
      );
      setMessage(`${formatStudentLabel(student)} 학생의 반 배정을 취소했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "학생 배정 취소에 실패했습니다.");
      await loadData();
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
            반 개설, 학생 배정, 반 이동을 한 곳에서 관리합니다.
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
                              onClick={() => handleRemoveStudentFromClass(student, expandedClassId)}
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

        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-card-foreground">학생 목록</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                각 학생의 현재 반을 수정하거나 여러 학생을 한 번에 이동할 수 있습니다.
              </p>
            </div>
            <Input
              value={adminSearch}
              onChange={(event) => setAdminSearch(event.target.value)}
              placeholder="학생 이름/이메일/반 검색"
              className="sm:w-72"
            />
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-border bg-background">
            <div className="max-h-[680px] overflow-y-auto overscroll-contain pr-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-border/70 hover:scrollbar-thumb-border [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/70 hover:[&::-webkit-scrollbar-thumb]:bg-border">
              <div className="sticky top-0 z-20 border-b border-border bg-background/95 px-3 py-3 backdrop-blur">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-card-foreground">
                      <Checkbox
                        checked={areAllManageableStudentsChecked}
                        onCheckedChange={(value) => handleToggleAllManagedStudents(Boolean(value))}
                      />
                      <span>전체 선택</span>
                    </label>
                    <p className="text-xs text-muted-foreground">
                      선택 학생 {checkedManagedStudentUids.length}명
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center">
                    <Select value={selectedBulkClassId} onValueChange={setSelectedBulkClassId}>
                      <SelectTrigger className="md:w-64">
                        <SelectValue placeholder="반 일괄 변경" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">미배정</SelectItem>
                        {classes.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      onClick={handleBulkTransfer}
                      disabled={loading || checkedManagedStudentUids.length === 0}
                    >
                      반 일괄 변경
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2 p-3">
                {filteredManageableStudents.map((student) => {
                  const checked = checkedManagedStudentUids.includes(student.uid);
                  const currentIds = Array.isArray(student.classIds)
                    ? [...student.classIds].sort()
                    : student.classId ? [student.classId] : [];
                  const pendingIds: string[] =
                    pendingClassSelections[student.uid] ?? currentIds;
                  const isDirty =
                    JSON.stringify(Array.from(new Set(pendingIds)).sort()) !==
                    JSON.stringify(currentIds);

                  const togglePendingClass = (classId: string, on: boolean) => {
                    setPendingClassSelections((prev) => {
                      const base = prev[student.uid] ?? currentIds;
                      const next = on
                        ? Array.from(new Set([...base, classId]))
                        : base.filter((id) => id !== classId);
                      return { ...prev, [student.uid]: next };
                    });
                  };

                  return (
                    <div
                      key={`manage-${student.uid}`}
                      className="rounded-md border border-border bg-background px-3 py-3 space-y-2"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex items-center pt-0.5">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) => toggleManagedChecked(student.uid, Boolean(value))}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-card-foreground">{formatStudentLabel(student)}</p>
                          <p className="truncate text-xs text-muted-foreground">{student.email}</p>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={loading || !isDirty}
                          onClick={() => handleStudentClassSave(student)}
                        >
                          저장
                        </Button>
                      </div>
                      {/* 다중 반 선택 체크박스 그룹 (중복 방지: Set 기반) */}
                      <div className="ml-7 flex flex-wrap gap-x-4 gap-y-1">
                        {classes.map((cls) => (
                          <label
                            key={`${student.uid}-${cls.id}`}
                            className="flex items-center gap-1.5 cursor-pointer text-xs text-card-foreground"
                          >
                            <Checkbox
                              checked={pendingIds.includes(cls.id)}
                              onCheckedChange={(value) =>
                                togglePendingClass(cls.id, Boolean(value))
                              }
                            />
                            {cls.name}
                          </label>
                        ))}
                        {classes.length === 0 && (
                          <span className="text-xs text-muted-foreground">등록된 반 없음</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {filteredManageableStudents.length === 0 && (
                  <p className="py-6 text-sm text-muted-foreground">표시할 학생이 없습니다.</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {message && <p className="text-sm text-card-foreground">{message}</p>}
      </div>
    </DashboardLayout>
  );
};

export default ClassManager;
