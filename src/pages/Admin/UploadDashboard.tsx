import { DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Calendar,
} from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Calendar as CalendarIcon, Circle, Loader2, Pencil, Trash2 } from "lucide-react";
import IntegrityManager from "@/components/admin/IntegrityManager";
import {
  assignReportToStudentOverride,
  compareReportsByExamDateDesc,
  deletePublishedReport,
  deleteReportRecord,
  fetchClasses,
  fetchPendingReports,
  fetchPublishedReports,
  fetchReportsByClassId,
  fetchStudents,
  formatExamDate,
  fixAndAssignPendingReport,
  getReportExamTitle,
  movePublishedReportToPending,
  normalizeDateString,
  prepareUploadCandidates,
  publishReportBatch,
  resolveMatchStatus,
  subscribeOpenReportClaims,
  subscribePendingReports,
  updatePublishedReport,
  type ClassLite,
  type ReportClaimTriageRecord,
  type ReportRecord,
  type ScoreBreakdown,
  type StudentLite,
  type UploadCandidate,
} from "@/lib/pdfProcessor";
import {
  enqueueReportNotifications,
  getMasterControls,
} from "@/services/masterAdminService";
import { formatStudentName } from "@/lib/studentName";
import { normalizeClassIds } from "@/services/classTransferService";
import { isStaffRole } from "@/lib/authz";
import { startPerformanceTrace } from "@/lib/performanceMonitoring";

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
  ready: "자동 매칭 완료",
  unregistered: "가입 대기/미연결",
} as const;

type SearchableStudent = StudentLite & {
  searchText: string;
};

const toFriendlyMessage = (input: string): string =>
  input
    .replace(/studentId/gi, "학생 정보")
    .replace(/\bnull\b/gi, "확인 중")
    .replace(/\bundefined\b/gi, "확인 중")
    .replace(/Firestore/gi, "학습 기록")
    .replace(/\bAuth\b/gi, "계정")
    .replace(/Collection/gi, "목록")
    .replace(/Parsing/gi, "내용 확인")
    .replace(/파싱/g, "내용 확인");

const UploadDashboard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toastRef = useRef(toast);
  const canManageReports = isStaffRole(user?.role);

  const [classes, setClasses] = useState<ClassLite[]>([]);
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [classReports, setClassReports] = useState<ReportRecord[]>([]);
  const [publishedReports, setPublishedReports] = useState<ReportRecord[]>([]);
  const [pendingReports, setPendingReports] = useState<ReportRecord[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("none");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => new Date());
  const [rows, setRows] = useState<UploadCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [pendingSearch, setPendingSearch] = useState<Record<string, string>>({});
  const [pendingSelectedStudent, setPendingSelectedStudent] = useState<Record<string, string>>({});
  const [resolvingPendingId, setResolvingPendingId] = useState<string | null>(null);
  const [archiveClassFilter, setArchiveClassFilter] = useState<string>("all");
  const [archiveStudentFilter, setArchiveStudentFilter] = useState("");
  const [archiveReadFilter, setArchiveReadFilter] = useState<string>("all");
  const [cleanupSearch, setCleanupSearch] = useState("");
  const [pendingMatchTarget, setPendingMatchTarget] = useState<ReportRecord | null>(null);
  const [pendingMatchSearch, setPendingMatchSearch] = useState("");
  const [pendingMatchStudentUid, setPendingMatchStudentUid] = useState<string>("");
  const [fixTarget, setFixTarget] = useState<ReportRecord | null>(null);
  const [fixSearch, setFixSearch] = useState("");
  const [fixStudentUid, setFixStudentUid] = useState("");
  const [savingFix, setSavingFix] = useState(false);
  const [openClaims, setOpenClaims] = useState<ReportClaimTriageRecord[]>([]);
  const [editingReport, setEditingReport] = useState<ReportRecord | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    reviewer: string;
    feedback: string;
    scores: ScoreBreakdown;
  }>({
    reviewer: "",
    feedback: "",
    scores: {
      reading: null,
      comprehension: null,
      problemUnderstanding: null,
      organization: null,
      expression: null,
      total: null,
    },
  });
  const [fixForm, setFixForm] = useState({
    sourceName: "",
    sourceStudentId: "",
    sourcePhoneSuffix: "",
    examDate: "",
  });

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const selectedClass = useMemo(
    () => classes.find((item) => item.id === selectedClassId) ?? null,
    [classes, selectedClassId],
  );
  const selectedDateText = useMemo(() => {
    if (!selectedDate) {
      return "";
    }
    const year = selectedDate.getFullYear();
    const month = `${selectedDate.getMonth() + 1}`.padStart(2, "0");
    const day = `${selectedDate.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, [selectedDate]);

  const classStudents = useMemo(
    () => students.filter((student) =>
      normalizeClassIds(student.classIds).includes(selectedClassId)
    ),
    [selectedClassId, students],
  );
  const searchableStudents = useMemo<SearchableStudent[]>(
    () =>
      [...students]
        .sort((a, b) => a.name.localeCompare(b.name, "ko"))
        .map((student) => ({
          ...student,
          searchText: `${student.name} ${student.email} ${student.studentId ?? ""} ${student.phoneSuffix ?? ""} ${student.phoneNumber ?? ""} ${student.className ?? ""}`.toLowerCase(),
        })),
    [students],
  );

  const buildFileKey = (file: File) => `${file.name}:${file.lastModified}:${file.size}`;

  const computeFileHash = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const digest = await window.crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  };

  const formatStudentLabel = (student: StudentLite) =>
    formatStudentName(student.name, {
      phoneNumber: student.phoneNumber,
      phoneSuffix: student.phoneSuffix,
      studentId: student.studentId,
    });

  const formatReportStudentLabel = (report: ReportRecord) =>
    formatStudentName(report.studentName || "기록 없음", {
      studentId: report.studentId,
    });

  const formatClaimDate = (claim: ReportClaimTriageRecord) => {
    if (!claim.createdAt) {
      return "기록 없음";
    }
    return claim.createdAt.toDate().toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getClaimStudentLabel = (claim: ReportClaimTriageRecord) => {
    const student = students.find((item) => item.uid === claim.studentUid);
    return student ? formatStudentLabel(student) : claim.report?.studentName || "기록 없음";
  };

  const filterStudents = useCallback(
    (keyword: string) => {
      const normalized = keyword.trim().toLowerCase();
      if (!normalized) {
        return [];
      }
      return searchableStudents.filter((student) => student.searchText.includes(normalized)).slice(0, 50);
    },
    [searchableStudents],
  );

  useEffect(() => {
    const measurement = startPerformanceTrace("admin_base_load");
    const run = async () => {
      try {
        const [classDocs, studentDocs] = await Promise.all([fetchClasses(), fetchStudents()]);
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

    void run();
  }, []);

  useEffect(() => {
    const measurement = startPerformanceTrace("admin_pending_load");
    let recorded = false;
    const record = (status: "success" | "error" | "cancelled", reportCount = 0) => {
      if (recorded) return;
      recorded = true;
      measurement.stop({ status, metrics: { report_count: reportCount } });
    };
    const unsubscribe = subscribePendingReports(
      (reports) => {
        setPendingReports(reports);
        record("success", reports.length);
      },
      (pendingError) => {
        record("error");
        toastRef.current({
          variant: "destructive",
          title: "미연결 자료 조회 실패",
          description: pendingError.message,
        });
      },
    );

    return () => {
      record("cancelled");
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const measurement = startPerformanceTraceeTrace("admin_published_load");
    const run = async () => {
      try {
        const reports = await fetchPublishedReports();
        setPublishedReports(reports);
        measurement.stop({ status: "success", metrics: { report_count: reports.length } });
      } catch (error) {
        measurement.stop({ status: "error" });
        throw error;
      }
    };
    void run();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeOpenReportClaims(
      setOpenClaims,
      (claimError) => {
        toastRef.current({
          variant: "destructive",
          title: "오배송 신고 조회 실패",
          description: claimError.message,
        });
      },
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!selectedClass || selectedClassId === "none") {
        setClassReports([]);
        return;
      }
      const measurement = startPerformanceTrace("admin_class_reports_load");
      try {
        const reports = await fetchReportsByClassId(selectedClass.id);
        setClassReports(reports);
        measurement.stop({ status: "success", metrics: { report_count: reports.length } });
      } catch (error) {
        measurement.stop({ status: "error" });
        throw error;
      }
    };

    void run();
  }, [selectedClass, selectedClassId]);

  useEffect(() => {
    setRows([]);
    setPendingSearch({});
    setPendingSelectedStudent({});
    setMessage("");
  }, [selectedClassId, selectedDateText]);

  const applyMatchResolution = useCallback((row: UploadCandidate): UploadCandidate => {
    const nextMatch = resolveMatchStatus(row.parsed, classStudents, students);
    return { ...row, ...nextMatch };
  }, [classStudents, students]);

  useEffect(() => {
    if (rows.length === 0) {
      return;
    }

    setRows((prev) => prev.map((row) => applyMatchResolution(row)));
  }, [applyMatchResolution, rows.length]);

  const parseAndAppendFiles = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    if (!selectedClass) {
      setMessage("반을 먼저 선택해주세요.");
      return;
    }

    if (!selectedDateText) {
      setMessage("시험 날짜를 먼저 선택해주세요.");
      return;
    }

    setLoading(true);
    setMessage("");
    const measurement = startPerformanceTrace("pdf_parse_batch", { source: "admin_upload" });

    try {
      const hashes = await Promise.all(
        files.map(async (file) => ({
          file,
          key: buildFileKey(file),
          hash: await computeFileHash(file),
        })),
      );

      const hashByKey = new Map(hashes.map((item) => [item.key, item.hash]));
      const parsedRows = await prepareUploadCandidates(files, classStudents, students);
      const parsedWithHash = parsedRows.map((row) => ({
        ...row,
        fileHash: hashByKey.get(buildFileKey(row.file)) ?? null,
      }));

      const mismatchedRow = parsedWithHash.find((row) => {
        const parsedDate = normalizeDateString(row.parsed.writtenAt);
        return parsedDate && parsedDate !== selectedDateText;
      });

      if (mismatchedRow) {
        const confirmed = window.confirm(
          "선택한 날짜와 파일 내 날짜가 다릅니다. 이대로 진행할까요?",
        );
        if (!confirmed) {
          measurement.stop({ status: "cancelled", metrics: { file_count: files.length } });
          setMessage("날짜 불일치로 업로드를 중단했습니다.");
          return;
        }
      }

      setRows((prev) => {
        const ids = new Set(prev.map((row) => row.id));
        const deduped = parsedWithHash.filter((row) => !ids.has(row.id));
        return [...prev, ...deduped];
      });
      const parseFailedCount = parsedWithHash.filter((row) => Boolean(row.parseError)).length;
      measurement.stop({
        status: parseFailedCount > 0 ? "partial" : "success",
        metrics: { file_count: files.length, parse_failure_count: parseFailedCount },
      });
      if (parseFailedCount > 0) {
        toast({
          variant: "destructive",
          title: "내용 확인 필요",
          description: `${parseFailedCount}건에서 자동 인식이 불완전합니다. 항목을 확인해주세요.`,
        });
      }
      setProgress(0);
    } catch (error) {
      measurement.stop({ status: "error", metrics: { file_count: files.length } });
      const reason = toFriendlyMessage(
        error instanceof Error ? error.message : "파일 내용을 확인하지 못했습니다.",
      );
      setMessage(reason);
      toast({
        variant: "destructive",
        title: "파일 확인 실패",
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
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) {
          return row;
        }
        const next = updater(row);
        const recovered =
          requiredScoreKeys.every((key) => Number.isFinite(next.parsed.scores[key])) &&
          next.parsed.feedback.trim().length > 0;
        return recovered ? { ...next, parseError: undefined } : next;
      }),
    );
  };

  const handleNameEdit = (id: string, name: string) => {
    updateRow(id, (row) => applyMatchResolution({ ...row, parsed: { ...row.parsed, name } }));
  };

  const handleMatchFieldEdit = (id: string, field: "studentId" | "phoneSuffix", value: string) => {
    updateRow(id, (row) =>
      applyMatchResolution({
        ...row,
        parsed: { ...row.parsed, [field]: value },
      }),
    );
  };

  const handleMetaEdit = (
    id: string,
    field: "essayTopic" | "grade" | "feedback" | "writtenAt" | "className" | "reviewer",
    value: string,
  ) => {
    updateRow(id, (row) =>
      field === "className"
        ? applyMatchResolution({ ...row, parsed: { ...row.parsed, [field]: value } })
        : { ...row, parsed: { ...row.parsed, [field]: value } },
    );
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

  const hasAnyInvalidRow = useMemo(
    () =>
      rows.some(
        (row) =>
          requiredScoreKeys.some((key) => !Number.isFinite(row.parsed.scores[key])) ||
          !row.parsed.feedback.trim(),
      ),
    [rows],
  );
  const hasAnyReadyRow = useMemo(
    () =>
      rows.some(
        (row) =>
          requiredScoreKeys.every((key) => Number.isFinite(row.parsed.scores[key])) &&
          row.parsed.feedback.trim().length > 0,
      ),
    [rows],
  );
  const readByReportId = useMemo(
    () => new Map(classReports.map((report) => [report.id, report.isRead])),
    [classReports],
  );
  const reportById = useMemo(() => {
    const map = new Map<string, ReportRecord>();
    [...publishedReports, ...classReports, ...pendingReports].forEach((report) => {
      map.set(report.id, report);
    });
    return map;
  }, [classReports, pendingReports, publishedReports]);
  const cleanupPendingReports = useMemo(
    () =>
      pendingReports
        .filter((report) => !report.studentId && !report.studentUid)
        .sort(compareReportsByExamDateDesc),
    [pendingReports],
  );
  const filteredPublishedReports = useMemo(() => {
    return [...publishedReports]
      .sort(compareReportsByExamDateDesc)
      .filter((report) => {
        if (archiveClassFilter !== "all" && report.classId !== archiveClassFilter) {
          return false;
        }
        const keyword = archiveStudentFilter.trim().toLowerCase();
        if (keyword) {
          const target = `${report.studentName} ${report.fileName} ${report.sourceName} ${report.essayTopic}`.toLowerCase();
          if (!target.includes(keyword)) {
            return false;
          }
        }
        if (archiveReadFilter === "read" && !report.isRead) {
          return false;
        }
        if (archiveReadFilter === "unread" && report.isRead) {
          return false;
        }
        return true;
      });
  }, [archiveClassFilter, archiveReadFilter, archiveStudentFilter, publishedReports]);

  const recentClassReports = useMemo(
    () => [...classReports].sort(compareReportsByExamDateDesc).slice(0, 20),
    [classReports],
  );

  const filteredCleanupPendingReports = useMemo(() => {
    const keyword = cleanupSearch.trim().toLowerCase();
    if (!keyword) {
      return cleanupPendingReports;
    }

    return cleanupPendingReports.filter((report) => {
      const target = `${report.sourceName} ${report.fileName} ${report.essayTopic} ${report.reviewer}`.toLowerCase();
      return target.includes(keyword);
    });
  }, [cleanupPendingReports, cleanupSearch]);

  const pendingMatchCandidates = useMemo(() => {
    const keyword = pendingMatchSearch.trim();
    return keyword ? filterStudents(keyword) : searchableStudents.slice(0, 50);
  }, [filterStudents, pendingMatchSearch, searchableStudents]);

  const fixCandidates = useMemo(() => {
    const keyword = fixSearch.trim();
    return keyword ? filterStudents(keyword) : searchableStudents.slice(0, 50);
  }, [filterStudents, fixSearch, searchableStudents]);

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

    if (!selectedDateText) {
      setMessage("시험 날짜를 먼저 선택해주세요.");
      toast({
        variant: "destructive",
        title: "시험 날짜 선택 필요",
        description: "반과 시험 날짜를 모두 선택한 뒤 업로드를 진행해주세요.",
      });
      return;
    }

    if (rows.length === 0) {
      setMessage("배포할 파일이 없습니다.");
      return;
    }

    if (hasAnyInvalidRow) {
      toast({
        variant: "destructive",
        title: "내용 확인 필요",
        description: "일부 항목에 누락된 점수/총평이 있습니다. 해당 파일은 스킵되고 나머지 파일을 배포합니다.",
      });
    }

    setUploading(true);
    setProgress(0);
    setMessage("");
    const measurement = startPerformanceTrace("report_publish_batch", { source: "admin_upload" });

    try {
      const result = await publishReportBatch(
        rows,
        selectedClass,
        selectedDateText,
        students,
        user.uid,
        setProgress,
      );
      const controls = await getMasterControls();

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

      setMessage(
        `배포 완료: 자동 배정 ${result.successCount}건, 보류 ${result.pendingCount}건, 실패 ${result.failureCount}건`,
      );
      if (result.autoAssignedNotices.length > 0) {
        setMessage((prev) => `${prev}\n${result.autoAssignedNotices.join("\n")}`);
        toast({
          title: "자동 배포 완료",
          description: result.autoAssignedNotices[0],
        });
      }
      if (result.pendingCount > 0) {
        setMessage((prev) => `${prev}\n보류 건은 아래 '미연결 학습 자료 정리'에서 학생을 연결할 수 있습니다.`);
      }
      if (controls.autoNotifyOnFeedbackComplete) {
        const created = await enqueueReportNotifications(
          result.results
            .filter((item) => item.success && item.reportId)
            .map((item) => item.reportId as string),
          user.uid,
        );
        if (created > 0) {
          setMessage((prev) => `${prev}\n자동 알림 ${created}건을 큐에 등록했습니다.`);
        }
      }
      if (result.failureCount > 0) {
        setMessage((prev) => `${prev}\n${result.failures.join("\n")}`);
        toast({
          variant: "destructive",
          title: "일부 발송 실패",
          description: result.failures[0],
        });
      } else {
        setMessage((prev) =>
          prev
            ? `${prev}\n리포트가 학생들에게 성공적으로 전달되었습니다.`
            : "리포트가 학생들에게 성공적으로 전달되었습니다.",
        );
        toast({
          title: "발송 완료",
          description: "리포트가 학생들에게 성공적으로 전달되었습니다.",
        });
      }

      const reports = await fetchReportsByClassId(selectedClass.id);
      setClassReports(reports);
      const pending = await fetchPendingReports();
      setPendingReports(pending);
      measurement.stop({
        status: result.failureCount > 0 ? "partial" : "success",
        metrics: {
          file_count: rows.length,
          success_count: result.successCount,
          pending_count: result.pendingCount,
          failure_count: result.failureCount,
        },
      });
    } catch (error) {
      measurement.stop({ status: "error", metrics: { file_count: rows.length } });
      const reason = toFriendlyMessage(
        error instanceof Error ? error.message : "배포 중 오류가 발생했습니다.",
      );
      setMessage(reason);
      toast({
        variant: "destructive",
        title: "리포트 발송 실패",
        description: reason,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleRefreshReadStatus = async () => {
    const published = await fetchPublishedReports();
    setPublishedReports(published);
    if (selectedClass) {
      const reports = await fetchReportsByClassId(selectedClass.id);
      setClassReports(reports);
    }
    const pending = await fetchPendingReports();
    setPendingReports(pending);
  };

  const getPendingCandidates = (report: ReportRecord) => {
    return filterStudents(pendingSearch[report.id] ?? "");
  };

  const handleAssignPending = async (report: ReportRecord) => {
    const studentUid = pendingSelectedStudent[report.id];
    if (!studentUid) {
      toast({
        variant: "destructive",
        title: "연결 실패",
        description: "연결할 학생을 선택해주세요.",
      });
      return;
    }

    const target = students.find((student) => student.uid === studentUid);
    if (!target) {
      toast({
        variant: "destructive",
        title: "연결 실패",
        description: "선택한 학생을 찾을 수 없습니다.",
      });
      return;
    }

    setResolvingPendingId(report.id);
    try {
      if (!window.confirm(`${formatStudentLabel(target)} 학생에게 이 리포트를 배송하시겠습니까?`)) {
        return;
      }
      await assignReportToStudentOverride(report.id, target, user?.role, user?.uid);
      const [pendingRows, classRows, publishedRows] = await Promise.all([
        fetchPendingReports(),
        selectedClass ? fetchReportsByClassId(selectedClass.id) : Promise.resolve(classReports),
        fetchPublishedReports(),
      ]);
      setPendingReports(pendingRows);
      setClassReports(classRows);
      setPublishedReports(publishedRows);
      toast({
        title: "연결 완료",
        description: `${formatStudentLabel(target)} 학생으로 리포트가 배정되었습니다.`,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "리포트 배정에 실패했습니다.";
      toast({
        variant: "destructive",
        title: "연결 실패",
        description: reason,
      });
    } finally {
      setResolvingPendingId(null);
    }
  };

  const handleOpenPendingMatch = (report: ReportRecord) => {
    setPendingMatchTarget(report);
    setPendingMatchSearch(
      `${report.sourceName || ""} ${report.sourceStudentId || report.sourcePhoneSuffix || ""}`.trim(),
    );
    setPendingMatchStudentUid("");
  };

  const handleOpenFixModal = (report: ReportRecord) => {
    setFixTarget(report);
    setFixForm({
      sourceName: report.sourceName || report.studentName || "",
      sourceStudentId: report.sourceStudentId || report.studentId || "",
      sourcePhoneSuffix: report.sourcePhoneSuffix || "",
      examDate: report.examDate || report.writtenAt || "",
    });
    setFixSearch(`${report.sourceName || report.studentName || ""} ${report.sourceStudentId || report.sourcePhoneSuffix || ""}`.trim());
    setFixStudentUid("");
  };

  const closeFixModal = () => {
    setFixTarget(null);
    setFixSearch("");
    setFixStudentUid("");
  };

  const handleApplyFix = async () => {
    if (!fixTarget || !fixStudentUid) {
      toast({
        variant: "destructive",
        title: "수정 및 배정 실패",
        description: "배송할 학생을 선택해주세요.",
      });
      return;
    }

    const student = students.find((item) => item.uid === fixStudentUid);
    if (!student) {
      toast({
        variant: "destructive",
        title: "수정 및 배정 실패",
        description: "선택한 학생 정보를 찾을 수 없습니다.",
      });
      return;
    }

    setSavingFix(true);
    try {
      await fixAndAssignPendingReport(fixTarget.id, student, fixForm, user?.role, user?.uid);
      const [classRows, publishedRows] = await Promise.all([
        selectedClass ? fetchReportsByClassId(selectedClass.id) : Promise.resolve(classReports),
        fetchPublishedReports(),
      ]);
      setClassReports(classRows);
      setPublishedReports(publishedRows);
      closeFixModal();
      toast({
        title: "수정 및 배정 완료",
        description: `${formatStudentLabel(student)} 학생에게 리포트를 배송했습니다.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "수정 및 배정 실패",
        description: error instanceof Error ? error.message : "리포트 수정에 실패했습니다.",
      });
    } finally {
      setSavingFix(false);
    }
  };

  const handleApplyPendingMatch = async () => {
    if (!pendingMatchTarget || !pendingMatchStudentUid) {
      toast({
        variant: "destructive",
        title: "학생 매칭 실패",
        description: "연결할 학생을 선택해주세요.",
      });
      return;
    }

    const student = students.find((item) => item.uid === pendingMatchStudentUid);
    if (!student) {
      toast({
        variant: "destructive",
        title: "학생 매칭 실패",
        description: "선택한 학생 정보를 찾을 수 없습니다.",
      });
      return;
    }

    setResolvingPendingId(pendingMatchTarget.id);
    try {
      if (!window.confirm(`${formatStudentLabel(student)} 학생에게 이 리포트를 배송하시겠습니까?`)) {
        return;
      }
      await assignReportToStudentOverride(pendingMatchTarget.id, student, user?.role, user?.uid);
      const [pendingRows, classRows, publishedRows] = await Promise.all([
        fetchPendingReports(),
        selectedClass ? fetchReportsByClassId(selectedClass.id) : Promise.resolve(classReports),
        fetchPublishedReports(),
      ]);
      setPendingReports(pendingRows);
      setClassReports(classRows);
      setPublishedReports(publishedRows);
      setPendingMatchTarget(null);
      setPendingMatchSearch("");
      setPendingMatchStudentUid("");
      toast({
        title: "학생 매칭 완료",
        description: `${formatStudentLabel(student)} 학생으로 자료를 연결했습니다.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "학생 매칭 실패",
        description: error instanceof Error ? error.message : "학생 연결에 실패했습니다.",
      });
    } finally {
      setResolvingPendingId(null);
    }
  };

  const openEditModal = (report: ReportRecord) => {
    setEditingReport(report);
    setEditForm({
      reviewer: report.reviewer || "",
      feedback: report.feedback || "",
      scores: {
        reading: report.scores.reading ?? null,
        comprehension: report.scores.comprehension ?? null,
        problemUnderstanding: report.scores.problemUnderstanding ?? null,
        organization: report.scores.organization ?? null,
        expression: report.scores.expression ?? null,
        total: report.scores.total ?? report.totalScore ?? null,
      },
    });
  };

  const handleEditScore = (field: keyof ScoreBreakdown, value: string) => {
    const numeric = value.trim() === "" ? null : Number(value);
    setEditForm((prev) => ({
      ...prev,
      scores: {
        ...prev.scores,
        [field]: Number.isFinite(numeric) ? numeric : null,
      },
    }));
  };

  const handleSaveReportEdit = async () => {
    if (!editingReport) {
      return;
    }

    setSavingEdit(true);
    try {
      await updatePublishedReport(editingReport.id, {
        reviewer: editForm.reviewer,
        feedback: editForm.feedback,
        scores: editForm.scores,
      });
      const refreshed = await fetchPublishedReports();
      setPublishedReports(refreshed);
      if (selectedClass) {
        const reports = await fetchReportsByClassId(selectedClass.id);
        setClassReports(reports);
      }
      setEditingReport(null);
      toast({
        title: "첨삭 내용 수정",
        description: "수정된 내용이 안전하게 저장되었습니다.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "첨삭 내용 수정 실패",
        description: error instanceof Error ? error.message : "리포트 수정에 실패했습니다.",
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeletePublishedReport = async (reportId: string) => {
    if (!window.confirm("선택한 리포트를 회수/삭제하시겠습니까?")) {
      return;
    }

    setDeletingReportId(reportId);
    try {
      await deletePublishedReport(reportId);
      setPublishedReports((prev) => prev.filter((report) => report.id !== reportId));
      setClassReports((prev) => prev.filter((report) => report.id !== reportId));
      setPendingReports((prev) => prev.filter((report) => report.id !== reportId));
      toast({
        title: "리포트 회수/삭제",
        description: "리포트가 삭제되었습니다.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "리포트 회수/삭제 실패",
        description: error instanceof Error ? error.message : "리포트 삭제에 실패했습니다.",
      });
    } finally {
      setDeletingReportId(null);
    }
  };

  const handleMovePublishedReportToPending = async (report: ReportRecord) => {
    if (!window.confirm("이 리포트 연결을 해제하고 '미연결 학습 자료 정리'로 이동하시겠습니까?")) {
      return;
    }

    setDeletingReportId(report.id);
    try {
      await movePublishedReportToPending(report.id);
      const [pendingRows, classRows, publishedRows] = await Promise.all([
        fetchPendingReports(),
        selectedClass ? fetchReportsByClassId(selectedClass.id) : Promise.resolve(classReports),
        fetchPublishedReports(),
      ]);
      setPendingReports(pendingRows);
      setClassReports(classRows);
      setPublishedReports(publishedRows);
      toast({
        title: "리포트 연결 해제",
        description: "리포트를 미연결 상태로 되돌렸습니다. 올바른 학생으로 다시 연결할 수 있습니다.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "리포트 연결 해제 실패",
        description: error instanceof Error ? error.message : "리포트 연결 해제에 실패했습니다.",
      });
    } finally {
      setDeletingReportId(null);
    }
  };

  const handleDeleteRow = async (row: UploadCandidate) => {
    if (!row.sentReportId) {
      setRows((prev) => prev.filter((item) => item.id !== row.id));
      return;
    }

    const connectedReport = reportById.get(row.sentReportId);
    const isConnected = Boolean(connectedReport?.studentId || connectedReport?.studentUid);
    const confirmed = window.confirm(
      isConnected
        ? "이미 학생에게 연결된 리포트입니다. 정말 삭제하시겠습니까?"
        : "이 항목을 삭제하시겠습니까?",
    );
    if (!confirmed) {
      return;
    }

    try {
      await deleteReportRecord(row.sentReportId);
      setRows((prev) => prev.filter((item) => item.id !== row.id));
      setPublishedReports((prev) => prev.filter((report) => report.id !== row.sentReportId));
      setClassReports((prev) => prev.filter((report) => report.id !== row.sentReportId));
      setPendingReports((prev) => prev.filter((report) => report.id !== row.sentReportId));
      toast({
        title: "삭제 완료",
        description: "선택한 항목만 삭제되었습니다.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "삭제 실패",
        description: error instanceof Error ? error.message : "삭제에 실패했습니다.",
      });
    }
  };

  const handleDeletePendingReport = async (report: ReportRecord) => {
    const confirmed = window.confirm("이 미배정 리포트만 삭제하시겠습니까?");
    if (!confirmed) {
      return;
    }
    try {
      await deleteReportRecord(report.id);
      setPendingReports((prev) => prev.filter((item) => item.id !== report.id));
      toast({
        title: "삭제 완료",
        description: "이 미배정 리포트만 삭제했습니다.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "삭제 실패",
        description: error instanceof Error ? error.message : "리포트 삭제에 실패했습니다.",
      });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <IntegrityManager />

        <div>
          <h2 className="text-xl font-bold text-foreground">새로운 첨삭 리포트 등록</h2>
          <p className="text-sm text-muted-foreground">
            반별 파일을 등록한 뒤 필요한 항목을 확인하고 학생에게 전달합니다.
          </p>
          <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
            날짜만 선택하면 리포트가 전송됩니다.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">1단계: 반 선택</p>
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

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">2단계: 시험 날짜</p>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {selectedDateText || "날짜 선택"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2 md:col-span-1">
              <p className="text-xs text-muted-foreground">2단계: 파일 등록</p>
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!selectedClass || !selectedDateText) {
                    return;
                  }
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`flex min-h-28 items-center justify-center rounded-md border-2 border-dashed px-4 text-sm transition-colors ${
                  !selectedClass || !selectedDateText
                    ? "cursor-not-allowed border-muted-foreground/20 bg-muted/30 text-muted-foreground"
                    : isDragging
                      ? "border-primary bg-primary/5"
                      : "border-border"
                }`}
              >
                <div className="text-center">
                  <p className="text-card-foreground">
                    {!selectedClass || !selectedDateText
                      ? "반과 시험 날짜를 선택하면 PDF 업로드가 활성화됩니다"
                      : "PDF 파일을 여기로 끌어오세요"}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!selectedClass || !selectedDateText || loading || uploading}
                  >
                    PDF 업로드
                  </Button>
                </div>
              </div>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                multiple
                className="hidden"
                disabled={!selectedClass || !selectedDateText || loading || uploading}
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
            <h3 className="text-sm font-semibold text-card-foreground">3단계: 내용 확인</h3>
            <p className="text-xs text-muted-foreground">총 {rows.length}건</p>
          </div>
          {!selectedClass && (
            <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              반을 먼저 선택해주세요
            </p>
          )}
          {selectedClass && !selectedDateText && (
            <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              반과 시험 날짜를 모두 선택해야 PDF 업로드를 시작할 수 있습니다.
            </p>
          )}

          <div className="space-y-4">
            {rows.map((row) => {
              const invalidRow =
                requiredScoreKeys.some((key) => !Number.isFinite(row.parsed.scores[key])) ||
                !row.parsed.feedback.trim();
              return (
                <div
                  key={row.id}
                  className={`rounded-md border bg-background p-4 ${
                    invalidRow ? "border-red-500 ring-1 ring-red-500/40" : "border-border"
                  }`}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-card-foreground">{row.file.name}</p>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      원본 {row.sourcePageLabel}
                    </span>
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
                        내용 확인 필요
                      </span>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      title="이 미배정 리포트만 삭제"
                      onClick={() => handleDeleteRow(row)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {row.parseError && (
                    <p className="mb-3 text-xs text-destructive">{toFriendlyMessage(row.parseError)}</p>
                  )}
                  {row.matchReason && (
                    <p className="mb-3 text-xs text-muted-foreground">{row.matchReason}</p>
                  )}

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Input
                      value={row.parsed.name}
                      onChange={(event) => handleNameEdit(row.id, event.target.value)}
                      placeholder="이름"
                    />
                    {row.status === "unregistered" && (
                      <span className="flex items-center rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
                        미연결 상태로 자동 전송됨
                      </span>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
                    <Input
                      value={row.parsed.studentId}
                      onChange={(event) => handleMatchFieldEdit(row.id, "studentId", event.target.value)}
                      placeholder="학생 코드"
                    />
                    <Input
                      value={row.parsed.phoneSuffix}
                      onChange={(event) => handleMatchFieldEdit(row.id, "phoneSuffix", event.target.value)}
                      placeholder="전화번호 뒤 4자리"
                    />
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
                    <Input value={row.parsed.reviewer} onChange={(event) => handleMetaEdit(row.id, "reviewer", event.target.value)} placeholder="첨삭자" />
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
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
                반을 선택하고 파일을 등록하면 확인할 항목이 표시됩니다.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-card-foreground">4단계: 학생에게 발송</h3>
              <p className="text-xs text-muted-foreground">
                입력이 완료된 리포트만 학생 대시보드로 안전하게 전달됩니다.
              </p>
            </div>
            <Button
              onClick={handlePublish}
              disabled={
                uploading ||
                loading ||
                !selectedClass ||
                !selectedDateText ||
                rows.length === 0 ||
                !hasAnyReadyRow ||
                !canManageReports
              }
            >
              {uploading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  발송 중...
                </span>
              ) : (
                "학생에게 발송"
              )}
            </Button>
          </div>
          {uploading && (
            <div className="mt-3">
              <Progress value={progress} className="h-2" />
              <p className="mt-2 text-xs text-muted-foreground">
                발송 진행 중입니다. 완료 전까지 중복 클릭이 비활성화됩니다.
              </p>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-card-foreground">발송 현황 확인</h3>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">선택 반 최근 배포 {classReports.length}건</p>
              <Button size="sm" variant="outline" onClick={handleRefreshReadStatus} disabled={!selectedClass}>
                새로고침
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            {recentClassReports.map((report) => (
              <div
                key={report.id}
                className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-sm font-medium text-card-foreground">
                      {formatReportStudentLabel(report)} | {getReportExamTitle(report)}
                    </p>
                    {!report.studentUid && !report.studentId && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">미연결</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    총점 {report.totalScore} / 등급 {report.grade || "기록 없음"} / 시험일 {formatExamDate(report.examDate)}
                  </p>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    report.isRead
                      ? "bg-emerald-500/10 text-emerald-700"
                      : "bg-amber-500/10 text-amber-700"
                  }`}
                >
                  {report.isRead ? "읽음" : "읽지 않음"}
                </span>
              </div>
            ))}
            {classReports.length === 0 && (
              <p className="text-sm text-muted-foreground">아직 배포된 리포트가 없습니다.</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-card-foreground">오배송 신고 관리</h3>
              <p className="text-xs text-muted-foreground">학생이 신고한 리포트를 확인하고 즉시 재배송하세요.</p>
            </div>
            <p className="text-xs font-medium text-muted-foreground">접수 {openClaims.length}건</p>
          </div>

          {openClaims.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
              현재 접수된 오배송 신고가 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left text-xs font-medium text-muted-foreground">
                    <th className="px-3 py-2">신고 학생</th>
                    <th className="px-3 py-2">신고 일시</th>
                    <th className="px-3 py-2">리포트</th>
                    <th className="px-3 py-2">매칭 방식</th>
                    <th className="px-3 py-2 text-right">처리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-background">
                  {openClaims.map((claim) => (
                    <tr key={claim.id}>
                      <td className="px-3 py-2 text-card-foreground">{getClaimStudentLabel(claim)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{formatClaimDate(claim)}</td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-card-foreground">
                          {claim.report ? getReportExamTitle(claim.report) : "삭제되었거나 찾을 수 없는 리포트"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {claim.report?.fileName || claim.reportId || "파일 정보 없음"}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {claim.report?.matchMethod || claim.report?.matchReason || "기록 없음"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={!claim.report || !canManageReports}
                          onClick={() => claim.report && handleOpenPendingMatch(claim.report)}
                        >
                          학생 변경
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-semibold text-card-foreground">배포된 리포트 보관함</h3>
            <p className="text-xs text-muted-foreground">총 {filteredPublishedReports.length}건</p>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-3">
            <Select value={archiveClassFilter} onValueChange={setArchiveClassFilter}>
              <SelectTrigger>
                <SelectValue placeholder="반 필터" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 반</SelectItem>
                {classes.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={archiveStudentFilter}
              onChange={(event) => setArchiveStudentFilter(event.target.value)}
              placeholder="학생/파일명 검색"
            />
            <Select value={archiveReadFilter} onValueChange={setArchiveReadFilter}>
              <SelectTrigger>
                <SelectValue placeholder="읽음 상태" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 상태</SelectItem>
                <SelectItem value="read">읽음</SelectItem>
                <SelectItem value="unread">읽지 않음</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="max-h-[400px] space-y-2 overflow-y-auto pr-1">
            {filteredPublishedReports.map((report) => {
              return (
                <div
                  key={report.id}
                  className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-background px-3 py-2.5 md:grid-cols-[1.2fr_1fr_0.7fr_0.7fr_auto]"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-card-foreground">{getReportExamTitle(report)}</p>
                      {!report.studentUid && !report.studentId && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">미연결</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      학생 {formatReportStudentLabel(report)} | 반 {report.className || "기록 없음"} | 시험일 {formatExamDate(report.examDate)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      원본 식별값 {report.sourceName || "-"} / {report.sourceStudentId || report.sourcePhoneSuffix || "보조키 없음"}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <p>논제: {report.essayTopic || "기록 없음"}</p>
                    <p>첨삭자: {report.reviewer || "기록 없음"}</p>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    {report.isRead ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <Circle className="h-4 w-4 text-amber-600" />
                    )}
                    <span>{report.isRead ? "읽음" : "읽지 않음"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">등록일 {formatExamDate(report.examDate)}</p>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="secondary" disabled={!canManageReports} onClick={() => handleOpenPendingMatch(report)}>
                      학생 변경
                    </Button>
                    <Button type="button" size="sm" variant="secondary" disabled={!canManageReports} onClick={() => handleMovePublishedReportToPending(report)}>
                      연결 해제
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={!canManageReports} onClick={() => openEditModal(report)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      수정
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={deletingReportId === report.id || !canManageReports}
                      onClick={() => handleDeletePublishedReport(report.id)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      삭제
                    </Button>
                  </div>
                </div>
              );
            })}
            {filteredPublishedReports.length === 0 && (
              <p className="text-sm text-muted-foreground">검색 결과가 없습니다</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-card-foreground">미연결 학습 자료 정리</h3>
            <p className="text-xs text-muted-foreground">대기 {filteredCleanupPendingReports.length}건</p>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            이제 전체 초기화 대신, 필요한 데이터만 선택적으로 삭제하여 안전하게 관리할 수 있습니다.
          </p>
          <div className="mb-3">
            <Input
              value={cleanupSearch}
              onChange={(event) => setCleanupSearch(event.target.value)}
              placeholder="학생 이름 또는 파일명 검색"
            />
          </div>
          <div className="max-h-[400px] space-y-2 overflow-y-auto pr-1">
            {filteredCleanupPendingReports.map((report) => {
              const options = getPendingCandidates(report);
              const isDuplicate = report.assignmentStatus === "duplicate_pending";
              return (
                <div key={report.id} className="rounded-lg border border-border bg-background p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-card-foreground">
                      {report.sourceName || "기록 없음"} | {report.fileName}
                    </p>
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        isDuplicate ? "bg-amber-500/10 text-amber-700" : "bg-zinc-500/10 text-zinc-700"
                      }`}
                    >
                      {isDuplicate ? "동명이인 대기" : "미가입자 대기"}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!canManageReports}
                      onClick={() => handleOpenPendingMatch(report)}
                    >
                      학생 매칭
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!canManageReports}
                      onClick={() => handleOpenFixModal(report)}
                    >
                      수정 및 배정
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      title="이 미배정 리포트만 삭제"
                      disabled={!canManageReports}
                      onClick={() => handleDeletePendingReport(report)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="mb-3 text-xs text-muted-foreground">
                    총점 {report.totalScore} / 등급 {report.grade || "기록 없음"} / 작성일 {report.writtenAt || "기록 없음"}
                  </p>
                  <p className="mb-3 text-xs text-muted-foreground">
                    원본 식별값 {report.sourceName || "-"} / {report.sourceStudentId || report.sourcePhoneSuffix || "보조키 없음"} / 반 {report.sourceClassName || report.className || "기록 없음"}
                  </p>
                  <p className="mb-3 text-xs text-muted-foreground">
                    {report.matchReason || "관리자 확인이 필요합니다."}
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <Input
                      value={pendingSearch[report.id] ?? ""}
                      onChange={(event) =>
                        setPendingSearch((prev) => ({ ...prev, [report.id]: event.target.value }))
                      }
                      placeholder="학생 검색 (이름/이메일)"
                    />
                    <Select
                      value={pendingSelectedStudent[report.id] ?? "none"}
                      onValueChange={(value) =>
                        setPendingSelectedStudent((prev) => ({
                          ...prev,
                          [report.id]: value === "none" ? "" : value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="연결할 학생 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">학생 선택</SelectItem>
                        {options.map((student) => (
                          <SelectItem key={student.uid} value={student.uid}>
                            {formatStudentLabel(student)} ({student.email || "이메일 없음"})
                          </SelectItem>
                        ))}
                        {options.length === 0 && (
                          <SelectItem value="no-results" disabled>
                            검색어를 입력하세요
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={() => handleAssignPending(report)}
                      disabled={resolvingPendingId === report.id || !canManageReports}
                    >
                      {resolvingPendingId === report.id ? "연결 중..." : "학생 연결"}
                    </Button>
                  </div>
                </div>
              );
            })}
            {filteredCleanupPendingReports.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {cleanupPendingReports.length === 0 ? "현재 보류 중인 리포트가 없습니다." : "검색 결과가 없습니다"}
              </p>
            )}
          </div>
        </div>

        {message && (
          <pre className="whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm text-card-foreground">
            {message}
          </pre>
        )}

        <Dialog open={Boolean(editingReport)} onOpenChange={(open) => !open && setEditingReport(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>첨삭 내용 수정</DialogTitle>
              <DialogDescription>
                지표 점수, 총평 텍스트, 첨삭자 이름을 수정한 뒤 저장하세요.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                value={editForm.reviewer}
                onChange={(event) => setEditForm((prev) => ({ ...prev, reviewer: event.target.value }))}
                placeholder="첨삭자"
              />
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {scoreFields.map((field) => (
                  <Input
                    key={`edit-${field.key}`}
                    value={editForm.scores[field.key] ?? ""}
                    onChange={(event) => handleEditScore(field.key, event.target.value)}
                    placeholder={field.label}
                  />
                ))}
              </div>
              <Textarea
                value={editForm.feedback}
                onChange={(event) => setEditForm((prev) => ({ ...prev, feedback: event.target.value }))}
                placeholder="첨삭 총평"
                className="min-h-36"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingReport(null)} disabled={savingEdit}>
                취소
              </Button>
              <Button onClick={handleSaveReportEdit} disabled={savingEdit}>
                {savingEdit ? "저장 중..." : "저장"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={Boolean(fixTarget)}
          onOpenChange={(open) => {
            if (!open) {
              closeFixModal();
            }
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>미연결 리포트 수정 및 배정</DialogTitle>
              <DialogDescription>
                원본 정보를 수정하고 가입된 학생을 선택해 배송하세요.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <Input
                  value={fixForm.sourceName}
                  onChange={(event) => setFixForm((prev) => ({ ...prev, sourceName: event.target.value }))}
                  placeholder="원본 이름"
                />
                <Input
                  value={fixForm.sourceStudentId}
                  onChange={(event) => setFixForm((prev) => ({ ...prev, sourceStudentId: event.target.value }))}
                  placeholder="원본 학생 코드"
                />
                <Input
                  value={fixForm.sourcePhoneSuffix}
                  onChange={(event) => setFixForm((prev) => ({ ...prev, sourcePhoneSuffix: event.target.value }))}
                  placeholder="원본 번호 뒤 4자리"
                />
                <Input
                  value={fixForm.examDate}
                  onChange={(event) => setFixForm((prev) => ({ ...prev, examDate: event.target.value }))}
                  placeholder="시험일 YYYY-MM-DD"
                />
              </div>
              <Input
                value={fixSearch}
                onChange={(event) => setFixSearch(event.target.value)}
                placeholder="학생 이름, 번호, 반 검색"
              />
              <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
                {fixCandidates.map((student) => (
                  <button
                    key={student.uid}
                    type="button"
                    onClick={() => setFixStudentUid(student.uid)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      fixStudentUid === student.uid
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background hover:border-primary/30 hover:bg-muted/40"
                    }`}
                  >
                    <p className="text-sm font-semibold text-card-foreground">{formatStudentLabel(student)}</p>
                    <p className="text-xs text-muted-foreground">
                      {student.email || "이메일 없음"} | {student.className || "반 정보 없음"}
                    </p>
                  </button>
                ))}
                {fixCandidates.length === 0 && (
                  <p className="text-sm text-muted-foreground">검색 결과가 없습니다</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeFixModal} disabled={savingFix}>
                취소
              </Button>
              <Button onClick={handleApplyFix} disabled={!fixStudentUid || savingFix || !canManageReports}>
                {savingFix ? "저장 중..." : "확인"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={Boolean(pendingMatchTarget)}
          onOpenChange={(open) => {
            if (!open) {
              setPendingMatchTarget(null);
              setPendingMatchSearch("");
              setPendingMatchStudentUid("");
            }
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {pendingMatchTarget?.assignmentStatus === "completed" ? "배포 리포트 학생 변경" : "미연결 자료 학생 매칭"}
              </DialogTitle>
              <DialogDescription>
                가입된 학생을 검색해 이 리포트의 배송 대상을 지정하세요.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-card-foreground">
                {pendingMatchTarget?.sourceName || "기록 없음"} | {pendingMatchTarget?.fileName || "기록 없음"}
              </div>
              <p className="text-xs text-muted-foreground">
                원본 식별값: {pendingMatchTarget?.sourceStudentId || pendingMatchTarget?.sourcePhoneSuffix || "보조키 없음"} / 반 {pendingMatchTarget?.sourceClassName || pendingMatchTarget?.className || "기록 없음"}
              </p>
              <Input
                value={pendingMatchSearch}
                onChange={(event) => setPendingMatchSearch(event.target.value)}
                placeholder="학생 이름, 이메일, 학번, 반 이름 검색"
              />
              <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                {pendingMatchCandidates.map((student) => (
                  <button
                    key={student.uid}
                    type="button"
                    onClick={() => setPendingMatchStudentUid(student.uid)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      pendingMatchStudentUid === student.uid
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background hover:border-primary/30 hover:bg-muted/40"
                    }`}
                  >
                    <p className="text-sm font-semibold text-card-foreground">{formatStudentLabel(student)}</p>
                    <p className="text-xs text-muted-foreground">
                      {student.email || "이메일 없음"} | {student.className || "반 정보 없음"}
                    </p>
                  </button>
                ))}
                {pendingMatchCandidates.length === 0 && (
                  <p className="text-sm text-muted-foreground">검색 결과가 없습니다</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setPendingMatchTarget(null);
                  setPendingMatchSearch("");
                  setPendingMatchStudentUid("");
                }}
                disabled={Boolean(resolvingPendingId)}
              >
                취소
              </Button>
              <Button onClick={handleApplyPendingMatch} disabled={!pendingMatchStudentUid || Boolean(resolvingPendingId) || !canManageReports}>
                {resolvingPendingId ? "처리 중..." : "선택 학생으로 배송"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
};

export default UploadDashboard;
