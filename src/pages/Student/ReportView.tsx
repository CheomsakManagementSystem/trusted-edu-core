import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import WithdrawalDialog from "@/components/WithdrawalDialog";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  compareReportsByExamDateDesc,
  fetchClasses,
  formatExamDate,
  formatExamDateShort,
  getReportExamTitle,
  hydrateReportRecord,
  type ClassLite,
  type ReportRecord,
} from "@/lib/pdfProcessor";
import { formatStudentName } from "@/lib/studentName";
import { db } from "@/lib/firebase";
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { joinClass } from "@/services/classTransferService";
import { Check, Clipboard } from "lucide-react";
import {
  clearClientSession,
  deleteCurrentUserAccount,
  getAccountDeletionErrorMessage,
} from "@/services/accountDeletionService";
import {
  CartesianGrid,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const cleanFeedbackText = (value: string): string => {
  return value
    .replace(/김윤환\s*class/gi, " ")
    .replace(/첨삭\s*채점표/gi, " ")
    .replace(/내용\s*형식/gi, " ")
    .replace(/작성일\s*[:：]?\s*[0-9./-]+/gi, " ")
    .replace(/수강반\s*[:：]?\s*[^\n]+/gi, " ")
    .replace(/논제\s*[:：]?\s*[^\n]+/gi, " ")
    .replace(/(?:이름|성명|학생명)\s*[:：]?\s*[가-힣A-Za-z]{2,10}/gi, " ")
    .replace(/(?:독해력|내용\s*이해력|문제\s*이해력|구성력|표현력|총점|등급)\s*[:：]?\s*-?\d+(?:\.\d+)?/gi, " ")
    .replace(/(?:독해력|내용\s*이해력|문제\s*이해력|구성력|표현력|총점|등급)\s*[:：]?/gi, " ")
    .replace(/(?:나의\s*점수|전체\s*평균|환산\s*점수)\s*[:：]?/gi, " ")
    .replace(/\d{4}\.\s?\d{1,2}\.\s?\d{1,2}/g, " ")
    .replace(/\b(?:19|20)\d{2}[./-]\d{1,2}[./-]\d{1,2}\b/g, " ")
    .replace(/\b\d{1,3}(?:\.\d+)?\s*점\b/g, " ")
    .replace(/\(\s*\d+\s*점\s*만점\s*\)/g, " ")
    .replace(/\b(?:50|60|70|80|90)\b(?:\s+\b(?:50|60|70|80|90)\b)+/g, " ")
    .replace(/\b-?\d+(?:\.\d+)?\b(?:\s+\b-?\d+(?:\.\d+)?\b){2,}/g, " ")
    .replace(/\b\d{1,3}\s*\/\s*\d{1,3}\b/g, " ")
    .replace(/[|]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
};

const splitFeedbackSections = (feedback: string): { summary: string; nextTask: string } => {
  if (!feedback) {
    return { summary: "", nextTask: "" };
  }

  const taskMatch = feedback.match(
    /(향후\s*과제|다음\s*과제|개선\s*과제|과제)\s*[:：]?\s*(.+)$/i,
  );

  if (!taskMatch || taskMatch.index === undefined) {
    return { summary: feedback, nextTask: "" };
  }

  const summary = feedback.slice(0, taskMatch.index).trim();
  const nextTask = taskMatch[2]?.trim() ?? "";
  return { summary, nextTask };
};

const ReportView = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [classes, setClasses] = useState<ClassLite[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("none");
  const [joinLoading, setJoinLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [withdrawPassword, setWithdrawPassword] = useState("");
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [feedbackExpanded, setFeedbackExpanded] = useState(false);
  const [claimingReportId, setClaimingReportId] = useState<string | null>(null);
  const [claimedReportIds, setClaimedReportIds] = useState<Set<string>>(new Set());
  const [copyAllLocked, setCopyAllLocked] = useState(false);
  const [copyAllCompleted, setCopyAllCompleted] = useState(false);
  const copyAllTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const lastCopyAllAtRef = useRef(0);

  useEffect(() => {
    if (!user?.uid) {
      setReports([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const toRows = (docs: Array<{ id: string; data: () => unknown }>): ReportRecord[] =>
      docs
        .map((docSnap) => hydrateReportRecord(docSnap.id, docSnap.data() as Omit<ReportRecord, "id">))
        .filter((row) =>
          row.assignmentStatus !== "duplicate_pending" &&
          row.assignmentStatus !== "unassigned_pending" &&
          (row.assignmentStatus as string) !== "unassigned",
        )
        .sort(compareReportsByExamDateDesc);

    const mergeReports = (...groups: ReportRecord[][]) =>
      Array.from(
        new Map(
          groups
            .flat()
            .map((report) => [report.id, report]),
        ).values(),
      ).sort(compareReportsByExamDateDesc);

    const reportsRef = collection(db, "reports");
    const primaryQuery = query(reportsRef, where("studentUid", "==", user.uid), orderBy("createdAt", "desc"));
    let fallbackUnsub: (() => void) | null = null;
    let identityUnsub: (() => void) | null = null;
    let identityFallbackUnsub: (() => void) | null = null;
    let uidRows: ReportRecord[] = [];
    let identityRows: ReportRecord[] = [];
    const syncRows = () => {
      const ownRecords = mergeReports(uidRows, identityRows);
      setReports(ownRecords);
      setSelectedReportId((prev) => {
        if (ownRecords.some((report) => report.id === prev)) {
          return prev;
        }
        return ownRecords[0]?.id ?? "";
      });
      setLoading(false);
    };

    const primaryUnsub = onSnapshot(
      primaryQuery,
      (snapshot) => {
        uidRows = toRows(snapshot.docs);
        syncRows();
      },
      () => {
        const fallbackQuery = query(reportsRef, where("studentUid", "==", user.uid));
        fallbackUnsub = onSnapshot(
          fallbackQuery,
          (snapshot) => {
            uidRows = toRows(snapshot.docs);
            syncRows();
          },
          (loadError) => {
            setError(
              loadError instanceof Error
                ? loadError.message
                : "리포트 조회 중 오류가 발생했습니다.",
            );
            setLoading(false);
          },
        );
      },
    );

    if (user.studentId) {
      const identityQuery = query(
        reportsRef,
        where("studentId", "==", user.studentId),
        orderBy("createdAt", "desc"),
      );
      identityUnsub = onSnapshot(
        identityQuery,
        (snapshot) => {
          identityRows = toRows(snapshot.docs);
          syncRows();
        },
        () => {
          const fallbackQuery = query(reportsRef, where("studentId", "==", user.studentId));
          identityFallbackUnsub = onSnapshot(
            fallbackQuery,
            (snapshot) => {
              identityRows = toRows(snapshot.docs);
              syncRows();
            },
            (loadError) => {
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : "리포트 조회 중 오류가 발생했습니다.",
              );
              setLoading(false);
            },
          );
        },
      );
    }

    return () => {
      primaryUnsub();
      fallbackUnsub?.();
      identityUnsub?.();
      identityFallbackUnsub?.();
    };
  }, [user?.studentId, user?.uid]);

  useEffect(() => {
    const run = async () => {
      if (!user?.uid) {
        setClasses([]);
        return;
      }

      try {
        const classRows = await fetchClasses();
        setClasses(classRows);
      } catch {
        // 신청 상태 조회 실패는 대시보드 핵심 기능을 막지 않음
      }
    };

    run();
  }, [user?.uid]);

  const studentReports = useMemo(
    () =>
      reports
        .filter(
          (report) =>
            !claimedReportIds.has(report.id) &&
            (report.studentUid === user?.uid ||
              (Boolean(user?.studentId) && report.studentId === user?.studentId)),
        )
        .sort(compareReportsByExamDateDesc),
    [reports, user?.studentId, user?.uid, claimedReportIds],
  );

  const selectedReport = useMemo(
    () =>
      studentReports.find((report) => report.id === selectedReportId) ?? studentReports[0] ?? null,
    [studentReports, selectedReportId],
  );

  const radarData = useMemo(() => {
    if (!selectedReport) {
      return [];
    }

    return [
      {
        subject: isMobile ? "독해" : "독해력",
        myScore: selectedReport.scores?.reading ?? 0,
        avgScore: selectedReport.averageScores?.reading ?? 0,
      },
      {
        subject: isMobile ? "내용이해" : "내용 이해력",
        myScore: selectedReport.scores?.comprehension ?? 0,
        avgScore: selectedReport.averageScores?.comprehension ?? 0,
      },
      {
        subject: isMobile ? "문제이해" : "문제 이해력",
        myScore: selectedReport.scores?.problemUnderstanding ?? 0,
        avgScore: selectedReport.averageScores?.problemUnderstanding ?? 0,
      },
      {
        subject: isMobile ? "구성" : "구성력",
        myScore: selectedReport.scores?.organization ?? 0,
        avgScore: selectedReport.averageScores?.organization ?? 0,
      },
      {
        subject: isMobile ? "표현" : "표현력",
        myScore: selectedReport.scores?.expression ?? 0,
        avgScore: selectedReport.averageScores?.expression ?? 0,
      },
    ];
  }, [isMobile, selectedReport]);

  const trendData = useMemo(
    () =>
      [...studentReports]
        .map((report) => ({
          examDateLabel: formatExamDateShort(report.examDate),
          score: report.totalScore,
          reportId: report.id,
        })),
    [studentReports],
  );

  const feedbackMeta = useMemo(() => {
    if (!selectedReport) {
      return {
        reviewer: "정보를 불러오는 중입니다",
        writtenAt: "정보를 불러오는 중입니다",
        className: "정보를 불러오는 중입니다",
        essayTopic: "정보를 불러오는 중입니다",
        studentName: "정보를 불러오는 중입니다",
        summary: "",
        nextTask: "",
      };
    }

    const cleanedFeedback = cleanFeedbackText(selectedReport.feedback || "");
    const { summary, nextTask } = splitFeedbackSections(cleanedFeedback);

    return {
      reviewer: selectedReport.reviewer?.trim() || "기록 없음",
      writtenAt: selectedReport.writtenAt?.trim() || "기록 없음",
      className: selectedReport.className?.trim() || user?.className || "기록 없음",
      essayTopic: selectedReport.essayTopic?.trim() || "기록 없음",
      studentName: formatStudentName(selectedReport.studentName?.trim() || user?.name || "기록 없음", {
        studentId: selectedReport.studentId ?? user?.studentId ?? null,
      }),
      summary,
      nextTask,
    };
  }, [selectedReport, user?.className, user?.name, user?.studentId]);

  useEffect(() => {
    setFeedbackExpanded(false);
  }, [selectedReportId]);

  useEffect(() => {
    return () => {
      if (copyAllTimerRef.current) {
        window.clearTimeout(copyAllTimerRef.current);
      }
    };
  }, []);

  const handleReportClaim = async () => {
    if (!user?.uid || !selectedReport) {
      return;
    }

    if (!window.confirm("이 리포트가 내 것이 아님을 신고하시겠습니까?\n관리자가 확인 후 처리해드립니다.")) {
      return;
    }

    const reportId = selectedReport.id;
    setClaimingReportId(reportId);
    try {
      const batch = writeBatch(db);

      batch.set(doc(db, "report_claims", `${reportId}_${user.uid}`), {
        reportId,
        reportedBy: user.uid,
        studentUid: user.uid,
        wrongStudentName: selectedReport.studentName ?? null,
        status: "open",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.update(doc(db, "reports", reportId), {
        studentId: null,
        studentName: null,
        assignmentStatus: "unassigned",
        status: "pending",
        isReported: true,
      });

      await batch.commit();

      // onSnapshot이 null로 바뀐 studentUid/studentId를 감지하여 자동으로 목록에서 제거하지만
      // 커밋 직후 즉각 사라지도록 로컬 상태에서도 선제 제거
      setReports((prev) => prev.filter((r) => r.id !== reportId));
      setClaimedReportIds((prev) => new Set([...prev, reportId]));

      toast({
        title: "신고 접수",
        description: "관리자에게 오배송 신고가 전달되었습니다. 해당 리포트가 숨김 처리되었습니다.",
      });
    } catch (claimError) {
      toast({
        variant: "destructive",
        title: "신고 실패",
        description: claimError instanceof Error ? claimError.message : "신고를 접수하지 못했습니다.",
      });
    } finally {
      setClaimingReportId(null);
    }
  };

  const summaryPreview = useMemo(() => {
    const text = feedbackMeta.summary || "첨삭 총평이 없습니다.";
    if (feedbackExpanded || text.length <= 190) {
      return text;
    }
    return `${text.slice(0, 190)}...`;
  }, [feedbackExpanded, feedbackMeta.summary]);

  const reportData = useMemo(
    () => ({
      reading: selectedReport?.scores?.reading ?? "-",
      comprehension: selectedReport?.scores?.comprehension ?? "-",
      problemUnderstanding: selectedReport?.scores?.problemUnderstanding ?? "-",
      organization: selectedReport?.scores?.organization ?? "-",
      expression: selectedReport?.scores?.expression ?? "-",
      feedback: feedbackMeta.summary || "첨삭 총평이 없습니다.",
    }),
    [feedbackMeta.summary, selectedReport],
  );

  const copyAllData = useCallback(
    async () => {
      const now = Date.now();
      if (copyAllLocked || now - lastCopyAllAtRef.current < 1000) {
        return;
      }

      lastCopyAllAtRef.current = now;
      const clipboardText = [
        reportData.reading,
        reportData.comprehension,
        reportData.problemUnderstanding,
        reportData.organization,
        reportData.expression,
      ].map(String).join("\n") + `\n\n${reportData.feedback}`;

      try {
        await navigator.clipboard.writeText(clipboardText);
        setCopyAllLocked(true);
        setCopyAllCompleted(true);

        if (copyAllTimerRef.current) {
          window.clearTimeout(copyAllTimerRef.current);
        }

        copyAllTimerRef.current = window.setTimeout(() => {
          setCopyAllLocked(false);
          setCopyAllCompleted(false);
          copyAllTimerRef.current = null;
        }, 1000);
      } catch {
        toast({
          variant: "destructive",
          title: "복사 실패",
          description: "클립보드 권한을 확인한 뒤 다시 시도해주세요.",
        });
      }
    },
    [copyAllLocked, reportData, toast],
  );

  const reportStatItems = useMemo(
    () => [
      { label: "독해력", value: reportData.reading },
      { label: "내용 이해력", value: reportData.comprehension },
      { label: "문제 이해력", value: reportData.problemUnderstanding },
      { label: "구성력", value: reportData.organization },
      { label: "표현력", value: reportData.expression },
      { label: "총점", value: selectedReport?.totalScore ?? "-" },
      { label: "등급", value: selectedReport?.grade || "기록 없음" },
    ],
    [reportData, selectedReport],
  );

  const chartAxisColor = "#111827";
  const chartGridColor = "#d1d5db";
  const chartLineColor = "#2563eb";

  const handleJoinRequest = async () => {
    if (!user?.uid || !user?.email) {
      toast({
        variant: "destructive",
        title: "신청 실패",
        description: "사용자 정보를 확인할 수 없습니다.",
      });
      return;
    }

    const targetClass = classes.find((item) => item.id === selectedClassId);
    if (!targetClass) {
      toast({
        variant: "destructive",
        title: "신청 실패",
        description: "반을 먼저 선택해주세요.",
      });
      return;
    }

    setJoinLoading(true);

    try {
      await joinClass(
        {
          uid: user.uid,
          name: user.name,
          email: user.email,
        },
        targetClass,
      );
      toast({
        title: "반 배정이 완료되었습니다!",
        description: `${targetClass.name} 반으로 즉시 배정되었습니다.`,
      });
      window.setTimeout(() => {
        window.location.reload();
      }, 600);
    } catch (submitError) {
      toast({
        variant: "destructive",
        title: "신청 실패",
        description:
          submitError instanceof Error
            ? submitError.message
            : "가입 신청 중 오류가 발생했습니다.",
      });
    } finally {
      setJoinLoading(false);
    }
  };

  const handleWithdrawAccount = async () => {
    if (!user?.uid) {
      toast({
        variant: "destructive",
        title: "회원 탈퇴 실패",
        description: "인증 상태를 확인할 수 없습니다.",
      });
      return;
    }

    setWithdrawPassword("");
    setWithdrawError(null);
    setWithdrawDialogOpen(true);
  };

  const confirmWithdrawAccount = async () => {
    setWithdrawing(true);
    setWithdrawError(null);

    try {
      await deleteCurrentUserAccount(withdrawPassword);
      toast({
        title: "회원 탈퇴 완료",
        description: "계정이 삭제되었습니다.",
      });
      setWithdrawDialogOpen(false);
      await clearClientSession(signOut);
      window.location.replace("/");
    } catch (withdrawError) {
      const message = getAccountDeletionErrorMessage(withdrawError);
      setWithdrawError(message);
      toast({
        variant: "destructive",
        title: "회원 탈퇴 실패",
        description: message,
      });
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-5 px-4 md:space-y-6 md:px-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 md:text-xl">
              나의 논술 성장 리포트
            </h2>
            <p className="mt-1 text-base text-slate-600 md:text-sm">
              나의 논술 성장 기록을 한눈에 확인하고 취약점을 보완하세요.
            </p>
            {copyAllCompleted && (
              <p className="mt-2 text-xs font-semibold text-slate-600">
                리소스 절약을 위해 1초간 버튼이 비활성화됩니다
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            aria-label="전체 데이터 복사"
            className="w-full border-slate-900 bg-white text-slate-900 hover:bg-slate-900 hover:text-white sm:w-auto"
            disabled={!selectedReport || copyAllLocked}
            onClick={copyAllData}
          >
            {copyAllCompleted ? (
              <Check className="h-4 w-4" />
            ) : (
              <Clipboard className="h-4 w-4" />
            )}
            전체 복사
          </Button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm md:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900 md:text-sm">반 배정 신청</h3>
              <p className="text-sm text-slate-600 md:text-xs">
                현재 배정 반: {user?.className ?? "기록 없음"}
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Select value={selectedClassId} onValueChange={setSelectedClassId}>
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue placeholder="가입할 반 선택" />
                </SelectTrigger>
                <SelectContent className="rounded-t-2xl rounded-b-xl md:rounded-md">
                  <SelectItem value="none">반 선택</SelectItem>
                  {classes.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleJoinRequest}
                disabled={joinLoading || selectedClassId === "none"}
              >
                {joinLoading ? "신청 중..." : "가입 신청"}
              </Button>
            </div>
          </div>
        </div>

        {loading && <p className="text-sm text-muted-foreground">정보를 불러오는 중입니다</p>}
        {!loading && error && <p className="text-sm text-destructive">{error}</p>}

        {!loading && !error && studentReports.length === 0 && (
          <p className="text-sm text-muted-foreground">아직 배포된 리포트가 없습니다.</p>
        )}

        {!loading && !error && studentReports.length > 0 && selectedReport && (
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm md:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-base font-semibold text-slate-900 md:text-sm">리포트 날짜를 확인하세요</h3>
                <Select value={selectedReportId} onValueChange={setSelectedReportId}>
                  <SelectTrigger className="w-full border-slate-200 sm:w-72">
                    <SelectValue placeholder="리포트 날짜를 확인하세요" />
                  </SelectTrigger>
                  <SelectContent className="rounded-t-2xl rounded-b-xl md:rounded-md">
                    {studentReports.map((report) => (
                      <SelectItem key={report.id} value={report.id}>
                        {getReportExamTitle(report)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 md:px-5">
                  <h3 className="text-lg font-semibold text-slate-900 md:text-base">영역별 역량 분석표</h3>
                  <div className="hidden items-center gap-3 text-xs text-slate-500 md:flex">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2.5 w-8 rounded bg-amber-400" />
                      나의점수
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2.5 w-8 rounded bg-slate-300" />
                      전체평균
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_220px] md:p-5">
                  <div className="rounded-2xl border border-slate-200 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.08),_transparent_55%),linear-gradient(to_right,_rgba(148,163,184,0.12)_1px,_transparent_1px),linear-gradient(to_bottom,_rgba(148,163,184,0.12)_1px,_transparent_1px)] bg-[size:auto,28px_28px,28px_28px] bg-center p-2">
                    <div className="aspect-[4/3] min-h-[280px] w-full sm:min-h-[320px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={radarData} outerRadius="76%">
                          <PolarGrid stroke={chartGridColor} />
                          <PolarAngleAxis
                            dataKey="subject"
                            tick={{ fontSize: isMobile ? 11 : 12, fill: chartAxisColor }}
                          />
                          <PolarRadiusAxis
                            domain={[0, 100]}
                            tick={{ fontSize: isMobile ? 10 : 11, fill: chartAxisColor }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Radar
                            name="나의점수"
                            dataKey="myScore"
                            stroke="#eab308"
                            fill="#eab308"
                            fillOpacity={0.14}
                            strokeWidth={3}
                          />
                          <Radar
                            name="전체평균"
                            dataKey="avgScore"
                            stroke="#6b7280"
                            fillOpacity={0}
                            strokeDasharray="8 6"
                            strokeWidth={2}
                          />
                          <Tooltip />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {reportStatItems.map((item) => (
                      <div
                        key={item.label}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <p className="text-xs font-semibold text-slate-500">{item.label}</p>
                        <p className="mt-1 text-2xl font-black leading-none text-slate-900">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:p-5">
                <h3 className="mb-3 text-lg font-semibold text-slate-900 md:text-base">선생님의 핵심 조언</h3>
                <div className="mb-4 grid grid-cols-1 gap-2 text-sm md:grid-cols-2 md:text-xs">
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-slate-500">첨삭자</p>
                    <p className="font-semibold text-slate-800">{feedbackMeta.reviewer}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-slate-500">작성일</p>
                    <p className="font-semibold text-slate-800">{feedbackMeta.writtenAt}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-slate-500">수강반</p>
                    <p className="font-semibold text-slate-800">{feedbackMeta.className}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-slate-500">학생명</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-semibold text-slate-800">
                        {feedbackMeta.studentName || "미연결 학생"}
                      </p>
                      {!selectedReport.studentUid && !selectedReport.studentId && (
                        <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs text-zinc-600">
                          가입 대기
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 md:col-span-2">
                    <p className="text-slate-500">논제</p>
                    <p className="font-semibold text-slate-800">{feedbackMeta.essayTopic}</p>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 px-3 py-2 text-sm font-bold text-slate-700">
                    첨삭 총평
                  </div>
                  <div className="min-h-28 px-4 py-4 text-[15px] font-semibold leading-7 text-slate-900 md:text-lg md:leading-8">
                    {summaryPreview}
                  </div>
                </div>
                <p className="mt-2 text-center text-xs font-medium text-slate-500">
                  불필요한 클릭을 줄여 리소스를 절약하세요
                </p>
                {feedbackMeta.summary.length > 190 && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-1 px-1 text-sm font-semibold text-primary"
                    onClick={() => setFeedbackExpanded((prev) => !prev)}
                  >
                    {feedbackExpanded ? "접기" : "더 보기"}
                  </Button>
                )}
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
                  <p className="mb-1 text-xs font-semibold text-slate-500">[향후 과제]</p>
                  <p className="text-[15px] leading-7 md:text-base md:leading-8">
                    {feedbackMeta.nextTask || "향후 과제가 명시되지 않았습니다."}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 w-full border-red-200 text-red-700 hover:bg-red-50"
                  disabled={claimingReportId === selectedReport.id}
                  onClick={handleReportClaim}
                >
                  {claimingReportId === selectedReport.id ? "신고 중..." : "⚠️ 내 리포트가 아닙니다"}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="order-1 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:order-2 md:p-5">
                <h3 className="mb-3 text-lg font-semibold text-slate-900 md:text-base">날짜별 점수 변화 그래프</h3>
                <div className="h-64 sm:h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                      <XAxis
                        dataKey="examDateLabel"
                        tick={{ fontSize: isMobile ? 11 : 12, fill: chartAxisColor }}
                        angle={isMobile ? -18 : 0}
                        textAnchor={isMobile ? "end" : "middle"}
                        height={isMobile ? 44 : 32}
                        stroke={chartGridColor}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fontSize: isMobile ? 11 : 12, fill: chartAxisColor }}
                        stroke={chartGridColor}
                      />
                      <Tooltip
                        contentStyle={{
                          borderColor: chartGridColor,
                          backgroundColor: "#ffffff",
                          color: chartAxisColor,
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="score"
                        stroke={chartLineColor}
                        strokeWidth={3}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="order-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:order-1 md:p-5">
                <h3 className="mb-3 text-lg font-semibold text-slate-900 md:text-base">리포트 목록</h3>
                <div className="space-y-3">
                  {studentReports.map((report) => (
                    <button
                      key={report.id}
                      type="button"
                      onClick={() => setSelectedReportId(report.id)}
                      className={`w-full rounded-xl border px-4 py-4 text-left transition-colors ${
                        selectedReport.id === report.id
                          ? "border-slate-900 bg-slate-50"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xl font-bold tracking-tight text-slate-900 md:text-lg">
                            {getReportExamTitle(report)}
                          </p>
                          <p className="mt-2 text-sm text-slate-600 md:text-base">
                            총점 {report.totalScore} | 등급 {report.grade || "기록 없음"} | 날짜{" "}
                            {formatExamDate(report.examDate)}
                          </p>
                        </div>
                        <span className="rounded-xl bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
                          읽음
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-red-200 bg-red-50 p-3 shadow-sm md:p-5">
              <h3 className="text-sm font-semibold text-red-900">계정 관리</h3>
              <p className="mt-1 text-xs text-red-700">
                회원 탈퇴 시 그동안의 모든 학습 기록과 성적 데이터가 소멸되며 복구가 불가능합니다.
              </p>
              <Button
                className="mt-3 w-full"
                variant="destructive"
                onClick={handleWithdrawAccount}
                disabled={withdrawing}
              >
                {withdrawing ? "탈퇴 처리 중..." : "회원 탈퇴"}
              </Button>
            </div>
          </div>
        )}
      </div>

      <WithdrawalDialog
        open={withdrawDialogOpen}
        onOpenChange={setWithdrawDialogOpen}
        password={withdrawPassword}
        onPasswordChange={setWithdrawPassword}
        onConfirm={confirmWithdrawAccount}
        loading={withdrawing}
        error={withdrawError}
        description="보안을 위해 현재 비밀번호를 다시 입력해 주세요. 탈퇴 후에는 학습 기록 연결과 계정 정보가 복구되지 않습니다."
      />
    </DashboardLayout>
  );
};

export default ReportView;
