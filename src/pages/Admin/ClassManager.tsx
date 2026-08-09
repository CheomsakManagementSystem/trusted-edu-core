import { FormEvent, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocsFromServer,
  orderBy,
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
import { type ClassLite, type StudentLite } from "@/lib/pdfProcessor";
import { formatStudentName } from "@/lib/studentName";
import { startPerformanceTrace } from "@/lib/performanceMonitoring";
import {
  bulkAddClassIdToStudents,
  bulkUpdateStudentClassIds,
  normalizeClassIds,
  removeClassIdFromStudent,
  removeDeletedClassReferences,
  resolveClassStateAfterRemoval,
  syncRenamedClassReferences,
  updateStudentClassIds,
} from "@/services/classTransferService";

type ClassFormState = {
  id: string | null;
  name: string;
};

const hydrateStudent = (id: string, data: Record<string, unknown>): StudentLite => {
  const phoneNumber = typeof data.phoneNumber === "string" ? data.phoneNumber : null;
  const phoneDigits = (phoneNumber ?? "").replace(/\D/g, "");
  const phoneLast4 = phoneDigits.length >= 4 ? phoneDigits.slice(-4) : null;
  const phoneSuffix = typeof data.phoneSuffix === "string" ? data.phoneSuffix : null;
  const studentId =
    typeof data.studentId === "string" ? data.studentId : phoneSuffix ?? phoneLast4 ?? null;
  const classId = typeof data.classId === "string" ? data.classId : null;
  const classIds = normalizeClassIds(data.classIds, classId);

  return {
    docId: id,
    uid: typeof data.uid === "string" ? data.uid : id,
    name: typeof data.name === "string" ? data.name : "이름없음",
    email: typeof data.email === "string" ? data.email : "",
    classId,
    classIds,
    className: typeof data.className === "string" ? data.className : null,
    studentId,
    phoneNumber,
    phoneSuffix,
  };
};

const loadClassManagerDataFromServer = async () => {
  const [classSnap, studentSnap] = await Promise.all([
    getDocsFromServer(query(collection(db, "classes"), orderBy("createdAt", "desc"))),
    getDocsFromServer(query(collection(db, "users"), where("role", "in", ["student", "STUDENT"]))),
  ]);

  const classDocs: ClassLite[] = classSnap.docs.map((docSnap) => {
    const data = docSnap.data() as Record<string, unknown>;
    return {
      id: docSnap.id,
      name: typeof data.name === "string" ? data.name : "이름없는 반",
    };
  });
  const studentDocs = studentSnap.docs.map((docSnap) =>
    hydrateStudent(docSnap.id, docSnap.data() as Record<string, unknown>),
  );

  return { classDocs, studentDocs };
};

const ClassManager = () => {
  const { toast } = useToast();
  const [classes, setClasses] = useState<ClassLite[]>([]);
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("none");
  const [checkedStudentDocIds, setCheckedStudentDocIds] = useState<string[]>([]);
  const [checkedManagedStudentDocIds, setCheckedManagedStudentDocIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [classForm, setClassForm] = useState<ClassFormState>({ id: null, name: "" });
  const [message, setMessage] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [expandedClassId, setExpandedClassId] = useState<string | null>(null);
  const [adminSearch, setAdminSearch] = useState("");
  const [selectedBulkClassId, setSelectedBulkClassId] = useState("none");
  const [pendingClassSelections, setPendingClassSelections] = useState<Record<string, string[]>>({});

  const loadData = async () => {
    const measurement = startPerformanceTrace("class_manager_load");
    try {
      const { classDocs, studentDocs } = await loadClassManagerDataFromServer();
      setClasses(classDocs);
      setStudents(studentDocs);
      measurement.stop({
        status: "success",
        metrics: { class_count: classDocs.length, student_count: studentDocs.length },
      });
    } catch (error) {
      measurement.stop({ status: "error" });
      throw error;
    }
  };

  const forceSync = async () => {
    setIsSyncing(true);
    try {
      await loadData();
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const selectedClass = useMemo(
    () => classes.find((item) => item.id === selectedClassId) ?? null,
    [classes, selectedClassId],
  );

  const formatStudentLabel = (student: StudentLite) =>
    formatStudentName(student.name, {
      phoneNumber: student.phoneNumber,
      phoneSuffix: student.phoneSuffix,
      studentId: student.studentId,
    });

  const assignableStudents = useMemo(() => {
    return students.filter((student) => {
      const classIds = normalizeClassIds(student.classIds);

      if (selectedClassId !== "none") {
        return !classIds.includes(selectedClassId);
      }

      return classIds.length === 0;
    });
  }, [selectedClassId, students]);

  const deferredSearch = useDeferredValue(search);
  const filteredStudents = useMemo(() => {
    const searchQuery = deferredSearch.toLowerCase();
    return assignableStudents.filter((student) => {
      const isMatch = (student.name ?? "").toLowerCase().includes(searchQuery);
      return isMatch;
    });
  }, [assignableStudents, deferredSearch]);

  const classNameById = useMemo(() => {
    return new Map(classes.map((item) => [item.id, item.name]));
  }, [classes]);

  const deferredAdminSearch = useDeferredValue(adminSearch);
  const filteredManageableStudents = useMemo(() => {
    const keyword = deferredAdminSearch.trim().toLowerCase();
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
  }, [deferredAdminSearch, students]);

  const studentsByClassId = useMemo(() => {
    const map = new Map<string, StudentLite[]>();
    classes.forEach((item) => {
      map.set(item.id, []);
    });

    students.forEach((student) => {
      const rawIds: string[] = normalizeClassIds(student.classIds);
      const uniqueIds = Array.from(new Set(rawIds));
      uniqueIds.forEach((cid) => {
        const list = map.get(cid);
        if (list) {
          list.push(student);
        }
      });
    });

    return map;
  }, [classes, students]);

  useEffect(() => {
    const assignableUids = new Set(filteredStudents.map((student) => student.docId));
    setCheckedStudentDocIds((prev) => prev.filter((uid) => assignableUids.has(uid)));
  }, [filteredStudents]);

  useEffect(() => {
    const manageableUids = new Set(filteredManageableStudents.map((student) => student.docId));
    setCheckedManagedStudentDocIds((prev) => prev.filter((uid) => manageableUids.has(uid)));
  }, [filteredManageableStudents]);

  useEffect(() => {
    setPendingClassSelections((prev) => {
      const next: Record<string, string[]> = {};
      students.forEach((student) => {
        if (prev[student.docId] !== undefined) {
          next[student.docId] = prev[student.docId];
        } else {
          const ids = normalizeClassIds(student.classIds);
          next[student.docId] = ids;
        }
      });
      return next;
    });
  }, [students]);

  const toggleChecked = (docId: string, checked: boolean) => {
    setCheckedStudentDocIds((prev) => {
      if (checked) {
        return Array.from(new Set([...prev, docId]));
      }
      return prev.filter((item) => item !== docId);
    });
  };

  const toggleManagedChecked = (docId: string, checked: boolean) => {
    setCheckedManagedStudentDocIds((prev) => {
      if (checked) {
        return Array.from(new Set([...prev, docId]));
      }
      return prev.filter((item) => item !== docId);
    });
  };

  const areAllManageableStudentsChecked =
    filteredManageableStudents.length > 0 &&
    filteredManageableStudents.every((student) => checkedManagedStudentDocIds.includes(student.docId));

  const handleToggleAllManagedStudents = (checked: boolean) => {
    if (checked) {
      setCheckedManagedStudentDocIds(filteredManageableStudents.map((student) => student.docId));
      return;
    }
    setCheckedManagedStudentDocIds([]);
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
        await syncRenamedClassReferences(classForm.id, name);
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
      await removeDeletedClassReferences(classDoc.id, classes);
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

    if (checkedStudentDocIds.length === 0) {
      setMessage("배정할 학생을 선택해주세요.");
      return;
    }

    const assignedStudents = students.filter((student) =>
      checkedStudentDocIds.includes(student.docId),
    );
    const firstAssignments = assignedStudents.filter(
      (student) => normalizeClassIds(student.classIds, student.classId).length === 0,
    );
    const additionalAssignments = assignedStudents.filter(
      (student) => normalizeClassIds(student.classIds, student.classId).length > 0,
    );

    setLoading(true);
    setIsSyncing(true);
    setMessage("");

    try {
      await Promise.all([
        bulkUpdateStudentClassIds(firstAssignments, [selectedClass.id], selectedClass),
        bulkAddClassIdToStudents(additionalAssignments, selectedClass.id),
      ]);
      await forceSync();
      setCheckedStudentDocIds([]);
      setMessage(`${assignedStudents.length}명의 학생을 '${selectedClass.name}'에 배정했습니다.`);
      toast({ title: "반 정보가 성공적으로 업데이트되었습니다" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "학생 배정에 실패했습니다.");
      await loadData();
    } finally {
      setIsSyncing(false);
      setLoading(false);
    }
  };

  const handleStudentClassSave = async (student: StudentLite) => {
    const nextIds = pendingClassSelections[student.docId] ?? [];
    const currentIds = normalizeClassIds(student.classIds).sort();
    const deduped = Array.from(new Set(nextIds)).sort();

    if (JSON.stringify(deduped) === JSON.stringify(currentIds)) {
      return;
    }

    const primaryClassId =
      student.classId && deduped.includes(student.classId) ? student.classId : deduped[0] ?? null;
    const primaryClass = classes.find((item) => item.id === primaryClassId) ?? null;

    setLoading(true);
    setMessage("");
    try {
      await updateStudentClassIds(student, deduped, primaryClass);
      setStudents((prev) =>
        prev.map((item) =>
          item.docId === student.docId
            ? {
                ...item,
                classIds: deduped,
                classId: primaryClass?.id ?? null,
                className: primaryClass?.name ?? null,
              }
            : item,
        ),
      );
      setPendingClassSelections((prev) => ({ ...prev, [student.docId]: deduped }));
      toast({ title: "반 정보가 성공적으로 업데이트되었습니다" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "반 변경에 실패했습니다.");
      setPendingClassSelections((prev) => ({ ...prev, [student.docId]: currentIds }));
    } finally {
      setLoading(false);
    }
  };

  const handleBulkTransfer = async () => {
    if (checkedManagedStudentDocIds.length === 0) {
      setMessage("반을 일괄 변경할 학생을 선택해주세요.");
      return;
    }

    const targetIds = selectedBulkClassId !== "none" ? [selectedBulkClassId] : [];
    const firstClass = classes.find((c) => c.id === selectedBulkClassId) ?? null;

    setLoading(true);
    setMessage("");
    try {
      const targetStudents = students.filter((student) =>
        checkedManagedStudentDocIds.includes(student.docId),
      );
      await bulkUpdateStudentClassIds(targetStudents, targetIds, firstClass);
      setStudents((prev) =>
        prev.map((student) =>
          checkedManagedStudentDocIds.includes(student.docId)
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
        checkedManagedStudentDocIds.forEach((docId) => {
          next[docId] = targetIds;
        });
        return next;
      });
      setCheckedManagedStudentDocIds([]);
      toast({ title: "반 정보가 성공적으로 업데이트되었습니다" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "반 일괄 변경에 실패했습니다.");
      await loadData();
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveStudentFromClass = async (student: StudentLite, targetClassId: string) => {
    if (!window.confirm(`${formatStudentLabel(student)} 학생을 이 반에서 내보내시겠습니까?`)) {
      return;
    }

    const nextState = resolveClassStateAfterRemoval(
      student.classIds,
      student.classId,
      targetClassId,
      classes,
    );
    const nextIds = nextState.classIds;
    const primaryClass = nextState.primaryClass;

    setLoading(true);
    setMessage("");

    try {
      await removeClassIdFromStudent(student, targetClassId, nextIds, primaryClass);
      setStudents((prev) =>
        prev.map((s) => {
          if (s.docId !== student.docId) return s;
          return {
            ...s,
            classIds: nextIds,
            classId: primaryClass?.id ?? null,
            className: primaryClass?.name ?? null,
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
                            key={`member-${targetClass.id}-${student.docId}`}
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
              const checked = checkedStudentDocIds.includes(student.docId);
              const currentClassNames = normalizeClassIds(student.classIds)
                .map((classId) => classNameById.get(classId))
                .filter((name): name is string => Boolean(name));
              const classStatus =
                currentClassNames.length > 0
                  ? `(현재 수강 중: ${currentClassNames.join(", ")})`
                  : "미배정";
              return (
                <label
                  key={student.docId}
                  className="flex cursor-pointer items-center justify-between rounded-md border border-border bg-background px-3 py-2"
                  style={{ contentVisibility: "auto", containIntrinsicSize: "64px" }}
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => toggleChecked(student.docId, Boolean(value))}
                    />
                    <div>
                      <p className="text-sm font-medium text-card-foreground">{formatStudentLabel(student)}</p>
                      <p className="text-xs text-muted-foreground">{student.email}</p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">{classStatus}</span>
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
                      선택 학생 {checkedManagedStudentDocIds.length}명
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
                      disabled={loading || checkedManagedStudentDocIds.length === 0}
                    >
                      반 일괄 변경
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2 p-3">
                {filteredManageableStudents.map((student) => {
                  const checked = checkedManagedStudentDocIds.includes(student.docId);
                  const currentIds = normalizeClassIds(student.classIds).sort();
                  const pendingIds: string[] = pendingClassSelections[student.docId] ?? currentIds;
                  const isDirty =
                    JSON.stringify(Array.from(new Set(pendingIds)).sort()) !==
                    JSON.stringify(currentIds);

                  const togglePendingClass = (classId: string, on: boolean) => {
                    setPendingClassSelections((prev) => {
                      const base = prev[student.docId] ?? currentIds;
                      const next = on
                        ? Array.from(new Set([...base, classId]))
                        : base.filter((id) => id !== classId);
                      return { ...prev, [student.docId]: next };
                    });
                  };

                  return (
                    <div
                      key={`manage-${student.docId}`}
                      className="rounded-md border border-border bg-background px-3 py-3 space-y-2"
                      style={{ contentVisibility: "auto", containIntrinsicSize: "112px" }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex items-center pt-0.5">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) => toggleManagedChecked(student.docId, Boolean(value))}
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
                      <div className="ml-7 flex flex-wrap gap-x-4 gap-y-1">
                        {classes.map((cls) => (
                          <label
                            key={`${student.docId}-${cls.id}`}
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

        {isSyncing && (
          <p className="text-sm font-medium text-card-foreground">
            Firestore 서버 데이터와 동기화 중입니다...
          </p>
        )}
        {message && <p className="text-sm text-card-foreground">{message}</p>}
      </div>
    </DashboardLayout>
  );
};

export default ClassManager;
