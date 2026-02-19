import { ChangeEvent, useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchClasses,
  fetchStudents,
  prepareUploadCandidates,
  publishReportBatch,
  type ClassLite,
  type ScoreBreakdown,
  type StudentLite,
  type UploadCandidate,
} from "@/lib/pdfProcessor";

const scoreFields: Array<{ key: keyof ScoreBreakdown; label: string }> = [
  { key: "reading", label: "독해력" },
  { key: "comprehension", label: "내용 이해력" },
  { key: "problemUnderstanding", label: "문제 이해력" },
  { key: "organization", label: "구성력" },
  { key: "expression", label: "표현력" },
  { key: "total", label: "총점" },
];

const statusLabel = {
  auto_matched: "자동 매칭",
  needs_selection: "선택 필요",
  unregistered: "미등록",
} as const;

const UploadDashboard = () => {
  const { user } = useAuth();
  const [classes, setClasses] = useState<ClassLite[]>([]);
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("none");
  const [rows, setRows] = useState<UploadCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [studentSearch, setStudentSearch] = useState<Record<string, string>>({});

  const selectedClass = useMemo(
    () => classes.find((item) => item.id === selectedClassId) ?? null,
    [classes, selectedClassId],
  );

  useEffect(() => {
    const run = async () => {
      const [classDocs, studentDocs] = await Promise.all([fetchClasses(), fetchStudents()]);
      setClasses(classDocs);
      setStudents(studentDocs);
    };

    run();
  }, []);

  const classStudents = useMemo(
    () => students.filter((student) => student.classId === selectedClassId),
    [selectedClassId, students],
  );

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    if (!selectedClass) {
      setMessage("반을 먼저 선택해주세요.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const parsedRows = await prepareUploadCandidates(files, classStudents, students);
      setRows(parsedRows);
      setProgress(0);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PDF 파싱에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const updateRow = (id: string, updater: (row: UploadCandidate) => UploadCandidate) => {
    setRows((prev) => prev.map((row) => (row.id === id ? updater(row) : row)));
  };

  const handleNameEdit = (id: string, name: string) => {
    updateRow(id, (row) => ({ ...row, parsed: { ...row.parsed, name } }));
  };

  const handleMetaEdit = (id: string, field: "essayTopic" | "grade" | "feedback", value: string) => {
    updateRow(id, (row) => ({ ...row, parsed: { ...row.parsed, [field]: value } }));
  };

  const handleScoreEdit = (id: string, field: keyof ScoreBreakdown, value: string) => {
    const numeric = value.trim() === "" ? null : Number(value);
    updateRow(id, (row) => ({
      ...row,
      parsed: {
        ...row.parsed,
        scores: {
          ...row.parsed.scores,
          [field]: Number.isFinite(numeric) ? numeric : null,
        },
      },
    }));
  };

  const getSearchableCandidates = (row: UploadCandidate) => {
    const base = row.status === "needs_selection" ? row.candidates : students;
    const keyword = (studentSearch[row.id] ?? "").trim().toLowerCase();

    if (!keyword) {
      return base;
    }

    return base.filter((student) => {
      return (
        student.name.toLowerCase().includes(keyword) ||
        student.email.toLowerCase().includes(keyword)
      );
    });
  };

  const readyToPublish = useMemo(
    () => rows.filter((row) => row.selectedStudentUid),
    [rows],
  );

  const handlePublish = async () => {
    if (!user) {
      setMessage("로그인이 필요합니다.");
      return;
    }

    if (!selectedClass) {
      setMessage("반을 먼저 선택해주세요.");
      return;
    }

    if (rows.length === 0) {
      setMessage("배포할 파일이 없습니다.");
      return;
    }

    if (readyToPublish.length !== rows.length) {
      setMessage("학생 미매칭 항목을 먼저 보정해주세요.");
      return;
    }

    setUploading(true);
    setMessage("");

    try {
      const result = await publishReportBatch(rows, selectedClass, students, user.uid, setProgress);
      setMessage(`배포 완료: 성공 ${result.successCount}건, 실패 ${result.failureCount}건`);
      if (result.failureCount > 0) {
        setMessage((prev) => `${prev}\n${result.failures.join("\n")}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "배포 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">PDF 업로드 & 무결성 보정</h2>
          <p className="text-sm text-muted-foreground">
            1) 반 선택 2) PDF 업로드 3) 파싱/매칭 보정 4) 일괄 배포 순서로 진행합니다.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Step 1. 반 선택</p>
              <Select value={selectedClassId} onValueChange={setSelectedClassId}>
                <SelectTrigger>
                  <SelectValue placeholder="반 선택" />
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
            </div>
            <div className="space-y-2 md:col-span-2">
              <p className="text-xs text-muted-foreground">Step 2. PDF 다중 업로드</p>
              <Input
                type="file"
                accept=".pdf,application/pdf"
                multiple
                onChange={handleFiles}
                disabled={!selectedClass || loading || uploading}
              />
            </div>
          </div>
          <div className="mt-4">
            <Progress value={progress} className="h-2" />
            <p className="mt-2 text-xs text-muted-foreground">진행률 {Math.round(progress)}%</p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-card-foreground">Step 3. 파싱 결과 확인 & 수동 보정</h3>
            <p className="text-xs text-muted-foreground">총 {rows.length}건</p>
          </div>

          <div className="space-y-4">
            {rows.map((row) => {
              const options = getSearchableCandidates(row);
              return (
                <div key={row.id} className="rounded-md border border-border bg-background p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-card-foreground">{row.file.name}</p>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {statusLabel[row.status]}
                    </span>
                    {row.parseError && (
                      <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                        파싱 오류
                      </span>
                    )}
                  </div>

                  {row.parseError && (
                    <p className="mb-3 text-xs text-destructive">{row.parseError}</p>
                  )}

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Input
                      value={row.parsed.name}
                      onChange={(event) => handleNameEdit(row.id, event.target.value)}
                      placeholder="이름"
                    />
                    <Select
                      value={row.selectedStudentUid ?? "none"}
                      onValueChange={(value) =>
                        updateRow(row.id, (current) => ({
                          ...current,
                          selectedStudentUid: value === "none" ? null : value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="학생 매칭 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">학생 선택</SelectItem>
                        {options.map((student) => (
                          <SelectItem key={student.uid} value={student.uid}>
                            {student.name} ({student.className || "미배정"})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <Input
                      value={row.parsed.essayTopic}
                      onChange={(event) => handleMetaEdit(row.id, "essayTopic", event.target.value)}
                      placeholder="논제"
                    />
                    <Input
                      value={row.parsed.grade}
                      onChange={(event) => handleMetaEdit(row.id, "grade", event.target.value)}
                      placeholder="등급"
                    />
                    <Input
                      value={studentSearch[row.id] ?? ""}
                      onChange={(event) =>
                        setStudentSearch((prev) => ({ ...prev, [row.id]: event.target.value }))
                      }
                      placeholder="학생 검색 (이름/이메일)"
                    />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
                    {scoreFields.map((field) => (
                      <Input
                        key={`${row.id}-${field.key}`}
                        value={row.parsed.scores[field.key] ?? ""}
                        onChange={(event) =>
                          handleScoreEdit(row.id, field.key, event.target.value)
                        }
                        placeholder={field.label}
                      />
                    ))}
                  </div>

                  <Input
                    className="mt-3"
                    value={row.parsed.feedback}
                    onChange={(event) => handleMetaEdit(row.id, "feedback", event.target.value)}
                    placeholder="첨삭 총평"
                  />
                </div>
              );
            })}

            {rows.length === 0 && (
              <p className="text-sm text-muted-foreground">
                반을 선택하고 PDF를 업로드하면 파싱 결과가 표시됩니다.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-card-foreground">Step 4. 일괄 배포</h3>
              <p className="text-xs text-muted-foreground">
                파일명 형식과 무관하게 현재 보정된 값으로 `reports` 컬렉션에 저장됩니다.
              </p>
            </div>
            <Button onClick={handlePublish} disabled={uploading || rows.length === 0}>
              {uploading ? "배포 중..." : "일괄 배포"}
            </Button>
          </div>
        </div>

        {message && (
          <pre className="whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm text-card-foreground">
            {message}
          </pre>
        )}
      </div>
    </DashboardLayout>
  );
};

export default UploadDashboard;
