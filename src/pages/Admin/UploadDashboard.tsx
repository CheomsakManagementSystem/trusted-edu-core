import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import {
  fetchClasses,
  fetchReportsByClassId,
  fetchStudents,
  prepareUploadCandidates,
  publishReportBatch,
  type ClassLite,
  type ReportRecord,
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
const requiredScoreKeys: Array<keyof ScoreBreakdown> = [
  "reading",
  "comprehension",
  "problemUnderstanding",
  "organization",
  "expression",
];

const statusLabel = {
  auto_matched: "자동 매칭",
  needs_selection: "선택 필요",
  unregistered: "미등록",
} as const;

const UploadDashboard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [classes, setClasses] = useState<ClassLite[]>([]);
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [classReports, setClassReports] = useState<ReportRecord[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("none");
  const [rows, setRows] = useState<UploadCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [studentSearch, setStudentSearch] = useState<Record<string, string>>({});

  const selectedClass = useMemo(
    () => classes.find((item) => item.id === selectedClassId) ?? null,
    [classes, selectedClassId],
  );

  const classStudents = useMemo(
    () => students.filter((student) => student.classId === selectedClassId),
    [selectedClassId, students],
  );

  useEffect(() => {
    const run = async () => {
      const [classDocs, studentDocs] = await Promise.all([fetchClasses(), fetchStudents()]);
      setClasses(classDocs);
      setStudents(studentDocs);
    };

    run();
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!selectedClass || selectedClassId === "none") {
        setClassReports([]);
        return;
      }
      const reports = await fetchReportsByClassId(selectedClass.id);
      setClassReports(reports);
    };

    run();
  }, [selectedClass, selectedClassId]);

  const parseAndAppendFiles = async (files: File[]) => {
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
      setRows((prev) => {
        const ids = new Set(prev.map((row) => row.id));
        const deduped = parsedRows.filter((row) => !ids.has(row.id));
        return [...prev, ...deduped];
      });
      const parseFailedCount = parsedRows.filter((row) => Boolean(row.parseError)).length;
      if (parseFailedCount > 0) {
        toast({
          variant: "destructive",
          title: "파싱 실패",
          description: `${parseFailedCount}건에서 파싱 오류가 발생했습니다. 항목을 수동 보정해주세요.`,
        });
      }
      setProgress(0);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "PDF 파싱에 실패했습니다.";
      setMessage(reason);
      toast({
        variant: "destructive",
        title: "파싱 실패",
        description: reason,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    await parseAndAppendFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const updateRow = (id: string, updater: (row: UploadCandidate) => UploadCandidate) => {
    setRows((prev) => prev.map((row) => (row.id === id ? updater(row) : row)));
  };

  const handleNameEdit = (id: string, name: string) => {
    updateRow(id, (row) => ({ ...row, parsed: { ...row.parsed, name } }));
  };

  const handleMetaEdit = (
    id: string,
    field: "essayTopic" | "grade" | "feedback" | "writtenAt" | "className" | "reviewer",
    value: string,
  ) => {
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

  const readyToPublish = useMemo(() => rows.filter((row) => row.selectedStudentUid), [rows]);
  const hasAnyInvalidScoreRow = useMemo(
    () =>
      rows.some((row) => requiredScoreKeys.some((key) => !Number.isFinite(row.parsed.scores[key]))),
    [rows],
  );
  const readByReportId = useMemo(
    () => new Map(classReports.map((report) => [report.id, report.isRead])),
    [classReports],
  );

  const handlePublish = async () => {
    if (!user) {
      setMessage("로그인이 필요합니다.");
      toast({
        variant: "destructive",
        title: "배포 실패",
        description: "로그인이 필요합니다.",
      });
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

    if (hasAnyInvalidScoreRow) {
      setMessage("파싱 실패: 점수 5개(독해력/내용 이해력/문제 이해력/구성력/표현력)를 모두 입력해주세요.");
      toast({
        variant: "destructive",
        title: "파싱 실패",
        description: "점수 5개가 누락된 항목이 있어 배포할 수 없습니다.",
      });
      return;
    }

    setUploading(true);
    setProgress(0);
    setMessage("");

    try {
      const result = await publishReportBatch(rows, selectedClass, students, user.uid, setProgress);

      setRows((prev) => {
        const mapById = new Map(result.results.map((item) => [item.candidateId, item]));
        return prev.map((row) => {
          const current = mapById.get(row.id);
          if (!current) {
            return row;
          }
          if (current.success) {
            return {
              ...row,
              sent: true,
              sentReportId: current.reportId,
              isRead: false,
            };
          }
          return { ...row, sent: false };
        });
      });

      setMessage(`배포 완료: 성공 ${result.successCount}건, 실패 ${result.failureCount}건`);
      if (result.failureCount > 0) {
        setMessage((prev) => `${prev}\n${result.failures.join("\n")}`);
        toast({
          variant: "destructive",
          title: "일부 전송 실패",
          description: result.failures[0],
        });
      } else {
        toast({
          title: "배포 완료!",
          description: `${result.successCount}건이 저장되었습니다.`,
        });
      }

      const reports = await fetchReportsByClassId(selectedClass.id);
      setClassReports(reports);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "배포 중 오류가 발생했습니다.";
      setMessage(reason);
      toast({
        variant: "destructive",
        title: "대시보드 전송 실패",
        description: reason,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleRefreshReadStatus = async () => {
    if (!selectedClass) {
      return;
    }
    const reports = await fetchReportsByClassId(selectedClass.id);
    setClassReports(reports);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">PDF 업로드 & 무결성 보정</h2>
          <p className="text-sm text-muted-foreground">
            반별 다중 업로드 후 자동 매칭하고, 필요한 항목만 수동 보정하여 배포합니다.
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
              <p className="text-xs text-muted-foreground">Step 2. 드래그 앤 드롭 다중 업로드</p>
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`flex min-h-28 items-center justify-center rounded-md border-2 border-dashed px-4 text-sm transition-colors ${
                  isDragging ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <div className="text-center">
                  <p className="text-card-foreground">PDF 파일을 여기로 끌어오세요</p>
                  <button
                    type="button"
                    className="mt-2 text-xs text-primary underline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!selectedClass || loading || uploading}
                  >
                    파일 선택 열기
                  </button>
                </div>
              </div>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                multiple
                className="hidden"
                disabled={!selectedClass || loading || uploading}
                onChange={(event) => parseAndAppendFiles(Array.from(event.target.files ?? []))}
              />
            </div>
          </div>

          <div className="mt-4">
            <Progress value={progress} className="h-2" />
            <p className="mt-2 text-xs text-muted-foreground">업로드/배포 진행률 {Math.round(progress)}%</p>
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
                    {row.sent && (
                      <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700">
                        ✅ 전송 완료
                      </span>
                    )}
                    {row.sent && (
                      <span className="rounded bg-sky-500/10 px-2 py-0.5 text-xs text-sky-700">
                        {row.sentReportId && readByReportId.get(row.sentReportId) ? "읽음" : "미확인"}
                      </span>
                    )}
                    {row.parseError && (
                      <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                        파싱 오류(수동 입력 가능)
                      </span>
                    )}
                  </div>

                  {row.parseError && <p className="mb-3 text-xs text-destructive">{row.parseError}</p>}

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
                      value={row.parsed.writtenAt}
                      onChange={(event) => handleMetaEdit(row.id, "writtenAt", event.target.value)}
                      placeholder="작성일"
                    />
                    <Input
                      value={row.parsed.className}
                      onChange={(event) => handleMetaEdit(row.id, "className", event.target.value)}
                      placeholder="수강반"
                    />
                    <Input
                      value={row.parsed.reviewer}
                      onChange={(event) => handleMetaEdit(row.id, "reviewer", event.target.value)}
                      placeholder="첨삭자"
                    />
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
                        onChange={(event) => handleScoreEdit(row.id, field.key, event.target.value)}
                        placeholder={field.label}
                      />
                    ))}
                  </div>

                  <Textarea
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
                데이터가 유효한 행만 `reports` 컬렉션으로 전송되며 기본 `isRead=false`로 저장됩니다.
              </p>
            </div>
            <Button onClick={handlePublish} disabled={uploading || loading || rows.length === 0}>
              {uploading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  전송 중...
                </span>
              ) : (
                "대시보드 전송"
              )}
            </Button>
          </div>
          {uploading && (
            <div className="mt-3">
              <Progress value={progress} className="h-2" />
              <p className="mt-2 text-xs text-muted-foreground">
                배포 진행 중입니다. 완료 전까지 중복 클릭이 비활성화됩니다.
              </p>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-card-foreground">Step 5. 전송/수신 확인</h3>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">선택 반 최근 배포 {classReports.length}건</p>
              <Button size="sm" variant="outline" onClick={handleRefreshReadStatus} disabled={!selectedClass}>
                새로고침
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            {classReports.slice(0, 20).map((report) => (
              <div
                key={report.id}
                className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-card-foreground">
                    {report.studentName} | {report.essayTopic || "논제 미기재"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    총점 {report.totalScore} / 등급 {report.grade || "-"}
                  </p>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    report.isRead
                      ? "bg-emerald-500/10 text-emerald-700"
                      : "bg-amber-500/10 text-amber-700"
                  }`}
                >
                  {report.isRead ? "읽음" : "미확인"}
                </span>
              </div>
            ))}
            {classReports.length === 0 && (
              <p className="text-sm text-muted-foreground">아직 배포된 리포트가 없습니다.</p>
            )}
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
