import { useEffect, useMemo, useRef, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
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
import {
  deleteStudentAccountData,
  fetchClasses,
  fetchMyClassJoinRequests,
  markReportAsRead,
  renderSinglePdfPage,
  submitClassJoinRequest,
  type ClassJoinRequestRecord,
  type ClassLite,
  type ReportRecord,
} from "@/lib/pdfProcessor";
import { auth, db } from "@/lib/firebase";
import { deleteUser } from "firebase/auth";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
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
  const { user } = useAuth();
  const { toast } = useToast();

  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [classes, setClasses] = useState<ClassLite[]>([]);
  const [joinRequests, setJoinRequests] = useState<ClassJoinRequestRecord[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("none");
  const [joinLoading, setJoinLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

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
        .map((docSnap) => {
          const data = docSnap.data() as Omit<ReportRecord, "id">;
          return { id: docSnap.id, ...data, isRead: Boolean(data.isRead) };
        })
        .filter((row) => row.assignmentStatus !== "duplicate_pending" && row.assignmentStatus !== "unassigned_pending")
        .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));

    const reportsRef = collection(db, "reports");
    const primaryQuery = query(reportsRef, where("studentUid", "==", user.uid), orderBy("createdAt", "desc"));
    let fallbackUnsub: (() => void) | null = null;

    const primaryUnsub = onSnapshot(
      primaryQuery,
      (snapshot) => {
        const ownRecords = toRows(snapshot.docs);
        setReports(ownRecords);
        setSelectedReportId((prev) => {
          if (ownRecords.some((report) => report.id === prev)) {
            return prev;
          }
          return ownRecords[0]?.id ?? "";
        });
        setLoading(false);
      },
      () => {
        const fallbackQuery = query(reportsRef, where("studentUid", "==", user.uid));
        fallbackUnsub = onSnapshot(
          fallbackQuery,
          (snapshot) => {
            const ownRecords = toRows(snapshot.docs);
            setReports(ownRecords);
            setSelectedReportId((prev) => {
              if (ownRecords.some((report) => report.id === prev)) {
                return prev;
              }
              return ownRecords[0]?.id ?? "";
            });
            setLoading(false);
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

    return () => {
      primaryUnsub();
      fallbackUnsub?.();
    };
  }, [user?.uid]);

  useEffect(() => {
    const run = async () => {
      if (!user?.uid) {
        setClasses([]);
        setJoinRequests([]);
        return;
      }

      try {
        const [classRows, joinRows] = await Promise.all([
          fetchClasses(),
          fetchMyClassJoinRequests(user.uid),
        ]);
        setClasses(classRows);
        setJoinRequests(joinRows);
      } catch {
        // 신청 상태 조회 실패는 대시보드 핵심 기능을 막지 않음
      }
    };

    run();
  }, [user?.uid]);

  const studentReports = useMemo(
    () => reports.filter((report) => report.studentUid === user?.uid),
    [reports, user?.uid],
  );

  const selectedReport = useMemo(
    () =>
      studentReports.find((report) => report.id === selectedReportId) ?? studentReports[0] ?? null,
    [studentReports, selectedReportId],
  );

  const latestPendingClassId = useMemo(() => {
    return joinRequests.find((request) => request.status === "pending")?.classId ?? null;
  }, [joinRequests]);

  const radarData = useMemo(() => {
    if (!selectedReport) {
      return [];
    }

    return [
      {
        subject: "독해력",
        myScore: selectedReport.scores.reading ?? 0,
        avgScore: selectedReport.averageScores?.reading ?? 0,
      },
      {
        subject: "내용 이해력",
        myScore: selectedReport.scores.comprehension ?? 0,
        avgScore: selectedReport.averageScores?.comprehension ?? 0,
      },
      {
        subject: "문제 이해력",
        myScore: selectedReport.scores.problemUnderstanding ?? 0,
        avgScore: selectedReport.averageScores?.problemUnderstanding ?? 0,
      },
      {
        subject: "구성력",
        myScore: selectedReport.scores.organization ?? 0,
        avgScore: selectedReport.averageScores?.organization ?? 0,
      },
      {
        subject: "표현력",
        myScore: selectedReport.scores.expression ?? 0,
        avgScore: selectedReport.averageScores?.expression ?? 0,
      },
    ];
  }, [selectedReport]);

  const trendData = useMemo(
    () =>
      [...studentReports].reverse().map((report, index) => ({
        round: `회차 ${index + 1}`,
        score: report.totalScore,
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
      studentName: selectedReport.studentName?.trim() || user?.name || "기록 없음",
      summary,
      nextTask,
    };
  }, [selectedReport, user?.className, user?.name]);

  const handleOpenReport = async (report: ReportRecord) => {
    setSelectedReportId(report.id);

    if (!report.isRead) {
      await markReportAsRead(report.id);
      setReports((prev) =>
        prev.map((item) => (item.id === report.id ? { ...item, isRead: true } : item)),
      );
    }
  };

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
      await submitClassJoinRequest(
        {
          uid: user.uid,
          name: user.name,
          email: user.email,
        },
        targetClass,
      );
      const joinRows = await fetchMyClassJoinRequests(user.uid);
      setJoinRequests(joinRows);
      toast({
        title: "가입 신청 완료",
        description: `${targetClass.name} 반 신청이 접수되었습니다.`,
      });
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

  useEffect(() => {
    const run = async () => {
      if (!selectedReport || !previewCanvasRef.current) {
        return;
      }

      setPdfLoading(true);
      setPdfError("");
      try {
        const pageNumber = selectedReport.pageNumber ?? selectedReport.sourcePage ?? 1;
        await renderSinglePdfPage(selectedReport.fileUrl, pageNumber, previewCanvasRef.current);
      } catch (renderError) {
        setPdfError(
          renderError instanceof Error
            ? renderError.message
            : "PDF 미리보기를 렌더링하지 못했습니다.",
        );
      } finally {
        setPdfLoading(false);
      }
    };

    run();
  }, [selectedReport]);

  const handleWithdrawAccount = async () => {
    if (!user?.uid || !auth.currentUser) {
      toast({
        variant: "destructive",
        title: "회원 탈퇴 실패",
        description: "인증 상태를 확인할 수 없습니다.",
      });
      return;
    }

    const confirmed = window.confirm(
      "회원 탈퇴 시 그동안의 모든 학습 기록과 성적 데이터가 소멸되며 복구가 불가능합니다. 계속하시겠습니까?",
    );
    if (!confirmed) {
      return;
    }

    setWithdrawing(true);
    try {
      await deleteStudentAccountData(user.uid);
      await deleteUser(auth.currentUser);
      toast({
        title: "회원 탈퇴 완료",
        description: "계정이 삭제되었습니다.",
      });
      window.location.href = "/login";
    } catch (withdrawError) {
      toast({
        variant: "destructive",
        title: "회원 탈퇴 실패",
        description:
          withdrawError instanceof Error
            ? withdrawError.message
            : "탈퇴 처리 중 오류가 발생했습니다. 다시 로그인 후 재시도하세요.",
      });
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">나의 논술 성장 리포트</h2>
          <p className="text-sm text-slate-500">
            나의 논술 성장 기록을 한눈에 확인하고 취약점을 보완하세요.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">반 가입 신청</h3>
              <p className="text-xs text-slate-500">
                현재 배정 반: {user?.className ?? "기록 없음"}
                {latestPendingClassId ? " | 선생님의 승인을 기다리고 있습니다. 잠시만 기다려 주세요." : ""}
              </p>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <Select value={selectedClassId} onValueChange={setSelectedClassId}>
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue placeholder="가입할 반 선택" />
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
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-sm font-semibold text-slate-900">리포트 회차 선택</h3>
                <Select value={selectedReportId} onValueChange={setSelectedReportId}>
                  <SelectTrigger className="w-full border-slate-200 sm:w-72">
                    <SelectValue placeholder="회차 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {studentReports.map((report, index) => (
                      <SelectItem key={report.id} value={report.id}>
                        회차 {studentReports.length - index} | {report.essayTopic || "기록 없음"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-base font-semibold text-slate-900">영역별 역량 분석표</h3>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
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
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_240px]">
                  <div className="mx-auto h-80 w-full max-w-2xl">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData}>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="subject" />
                        <PolarRadiusAxis domain={[50, 100]} />
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
                          stroke="#a8a8a8"
                          fillOpacity={0}
                          strokeDasharray="8 6"
                          strokeWidth={2}
                        />
                        <Tooltip />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex items-center justify-center">
                    <div className="w-full max-w-[220px] overflow-hidden rounded-md border-4 border-black bg-white">
                      <div className="grid grid-cols-2">
                        <div className="border-b-4 border-r-4 border-black p-3 text-center text-4xl font-black leading-none">
                          총점
                        </div>
                        <div className="border-b-4 border-black bg-amber-400 p-3 text-center text-5xl font-black leading-none">
                          {selectedReport.totalScore}
                        </div>
                        <div className="border-r-4 border-black p-3 text-center text-4xl font-black leading-none">
                          등급
                        </div>
                        <div className="p-3 text-center text-5xl font-black leading-none">
                          {selectedReport.grade || "기록 없음"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-base font-semibold text-slate-900">선생님의 핵심 조언</h3>
                <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
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
                    <p className="font-semibold text-slate-800">{feedbackMeta.studentName}</p>
                  </div>
                  <div className="col-span-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-slate-500">논제</p>
                    <p className="font-semibold text-slate-800">{feedbackMeta.essayTopic}</p>
                  </div>
                </div>
                <div className="rounded-md border-4 border-black bg-white">
                  <div className="grid grid-cols-[160px_1fr] border-b-4 border-black">
                    <div className="border-r-4 border-black px-3 py-2 text-center text-3xl font-black">첨삭 총평</div>
                    <div className="px-3 py-2 text-lg font-bold">첨삭자: {feedbackMeta.reviewer}</div>
                  </div>
                  <div className="min-h-44 px-4 py-4 text-2xl font-bold leading-relaxed text-slate-900">
                    {feedbackMeta.summary || "첨삭 총평이 없습니다."}
                  </div>
                </div>
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
                  <p className="mb-1 text-xs font-semibold text-slate-500">[향후 과제]</p>
                  <p className="leading-relaxed">
                    {feedbackMeta.nextTask || "향후 과제가 명시되지 않았습니다."}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div className="space-y-4 xl:col-span-2">
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">회차별 점수 변화 그래프</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="round" />
                        <YAxis domain={[0, 100]} />
                        <Tooltip />
                        <Line type="monotone" dataKey="score" stroke="#2563eb" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">리포트 목록</h3>
                  <div className="space-y-2">
                    {studentReports.map((report, index) => (
                      <button
                        key={report.id}
                        type="button"
                        onClick={() => handleOpenReport(report)}
                        className={`w-full rounded-md border px-3 py-3 text-left transition-colors ${
                          selectedReport.id === report.id
                            ? "border-primary bg-primary/5"
                            : "border-border bg-background hover:border-primary/40"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900">
                            회차 {studentReports.length - index} / {report.essayTopic || "기록 없음"}
                          </p>
                          <span
                            className={`rounded px-2 py-0.5 text-xs ${
                              report.isRead
                                ? "bg-emerald-500/10 text-emerald-700"
                                : "bg-amber-500/10 text-amber-700"
                            }`}
                          >
                            {report.isRead ? "읽음" : "새 리포트"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          총점 {report.totalScore} | 등급 {report.grade || "기록 없음"} | 날짜{" "}
                          {report.createdAt
                            ? report.createdAt.toDate().toLocaleDateString("ko-KR")
                            : "기록 없음"}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">나의 답안 및 첨삭 원본 보기</h3>
                  {pdfLoading && <p className="text-sm text-muted-foreground">페이지 렌더링 중입니다...</p>}
                  {pdfError && <p className="text-sm text-destructive">{pdfError}</p>}
                  <div className="overflow-auto rounded border border-slate-200 bg-slate-50 p-2">
                    <canvas ref={previewCanvasRef} className="mx-auto h-auto max-w-full" />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    저장된 페이지 번호({selectedReport.pageNumber ?? selectedReport.sourcePage ?? 1}p)를 기준으로
                    미리보기를 제공합니다.
                  </p>
                </div>

                <div className="rounded-xl border border-red-200 bg-red-50 p-5 shadow-sm">
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
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default ReportView;
