import { type FormEvent, useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { auth } from "@/lib/firebase";
import {
  fetchReportsByStudentId,
  type ReportRecord,
} from "@/lib/pdfEngine";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
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
import { Quote, TrendingUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const cleanFeedbackText = (value: string): string =>
  value
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

  return {
    summary: feedback.slice(0, taskMatch.index).trim(),
    nextTask: taskMatch[2]?.trim() ?? "",
  };
};

const StudentDashboard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState("");

  useEffect(() => {
    const run = async () => {
      if (!user?.studentId) {
        setReports([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const records = await fetchReportsByStudentId(user.studentId);
        setReports(records);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "리포트 조회 중 오류가 발생했습니다.",
        );
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [user?.studentId]);

  const chartData = useMemo(
    () =>
      [...reports]
        .reverse()
        .map((report) => ({
          date: report.createdAt
            ? report.createdAt.toDate().toLocaleDateString("ko-KR")
            : "-",
          score: report.score,
        })),
    [reports],
  );

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? reports[0] ?? null,
    [reports, selectedReportId],
  );

  useEffect(() => {
    setSelectedReportId((prev) => {
      if (reports.some((report) => report.id === prev)) {
        return prev;
      }
      return reports[0]?.id ?? "";
    });
  }, [reports]);

  const radarData = useMemo(() => {
    if (!selectedReport) {
      return [];
    }

    return [
      {
        subject: "독해력",
        myScore: selectedReport.scores?.reading ?? 0,
        avgScore: selectedReport.averageScores?.reading ?? 0,
      },
      {
        subject: "내용 이해력",
        myScore: selectedReport.scores?.comprehension ?? 0,
        avgScore: selectedReport.averageScores?.comprehension ?? 0,
      },
      {
        subject: "문제 이해력",
        myScore: selectedReport.scores?.problemUnderstanding ?? 0,
        avgScore: selectedReport.averageScores?.problemUnderstanding ?? 0,
      },
      {
        subject: "구성력",
        myScore: selectedReport.scores?.organization ?? 0,
        avgScore: selectedReport.averageScores?.organization ?? 0,
      },
      {
        subject: "표현력",
        myScore: selectedReport.scores?.expression ?? 0,
        avgScore: selectedReport.averageScores?.expression ?? 0,
      },
    ];
  }, [selectedReport]);

  const feedbackMeta = useMemo(() => {
    if (!selectedReport) {
      return {
        summary: "",
        nextTask: "",
        reviewer: "기록 없음",
        writtenAt: "기록 없음",
      };
    }

    const cleanedFeedback = cleanFeedbackText(selectedReport.feedback || "");
    const { summary, nextTask } = splitFeedbackSections(cleanedFeedback);

    return {
      summary,
      nextTask,
      reviewer: selectedReport.reviewer?.trim() || "기록 없음",
      writtenAt: selectedReport.writtenAt?.trim() || "기록 없음",
    };
  }, [selectedReport]);

  const handlePasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError(null);

    if (!currentPassword || !newPassword || !newPasswordConfirm) {
      setPasswordError("모든 비밀번호 입력값을 채워주세요.");
      window.alert("모든 비밀번호 입력값을 채워주세요.");
      return;
    }

    if (newPassword !== newPasswordConfirm) {
      setPasswordError("새 비밀번호가 서로 다릅니다");
      window.alert("새 비밀번호가 서로 다릅니다");
      return;
    }

    const firebaseUser = auth.currentUser;
    if (!firebaseUser?.email) {
      setPasswordError("비밀번호 변경을 위한 사용자 인증 정보를 확인할 수 없습니다.");
      window.alert("비밀번호 변경을 위한 사용자 인증 정보를 확인할 수 없습니다.");
      return;
    }

    if (currentPassword === newPassword) {
      setPasswordError("새 비밀번호는 현재 비밀번호와 다르게 설정해주세요.");
      window.alert("새 비밀번호는 현재 비밀번호와 다르게 설정해주세요.");
      return;
    }

    setPasswordSaving(true);
    try {
      const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
      await reauthenticateWithCredential(firebaseUser, credential);
      await updatePassword(firebaseUser, newPassword);

      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
      toast({
        title: "비밀번호 변경 완료",
        description: "비밀번호가 안전하게 변경되었습니다!",
      });
      window.alert("비밀번호가 안전하게 변경되었습니다!");
    } catch (passwordUpdateError) {
      const errorCode =
        typeof passwordUpdateError === "object" &&
        passwordUpdateError !== null &&
        "code" in passwordUpdateError
          ? String(passwordUpdateError.code)
          : "";

      if (errorCode === "auth/wrong-password" || errorCode === "auth/invalid-credential") {
        setPasswordError("현재 비밀번호가 올바르지 않습니다.");
        window.alert("현재 비밀번호가 올바르지 않습니다.");
      } else if (errorCode === "auth/weak-password") {
        setPasswordError("새 비밀번호가 너무 약합니다. 더 안전한 비밀번호를 입력해주세요.");
        window.alert("새 비밀번호가 너무 약합니다. 더 안전한 비밀번호를 입력해주세요.");
      } else if (errorCode === "auth/too-many-requests") {
        setPasswordError("요청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해주세요.");
        window.alert("요청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해주세요.");
      } else {
        setPasswordError("비밀번호 변경 중 오류가 발생했습니다. 다시 시도해주세요.");
        window.alert("비밀번호 변경 중 오류가 발생했습니다. 다시 시도해주세요.");
      }
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 px-4 pb-20 md:px-0">
        <div>
          <h2 className="text-xl font-bold text-foreground">학생 대시보드</h2>
          <p className="text-sm text-muted-foreground">
            학번 {user?.studentId ?? "미등록"} 기준으로 첨삭 리포트를 조회합니다.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-3 shadow-card md:p-5">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-card-foreground">점수 추이</h3>
          </div>
          <div className="h-48 sm:h-56 md:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9 }}
                  angle={-20}
                  textAnchor="end"
                  height={44}
                  interval={0}
                />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {chartData.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              표시할 데이터가 없습니다.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-3 shadow-card md:p-5">
          <h3 className="mb-3 text-sm font-semibold text-card-foreground">리포트 회차 선택</h3>

          {loading && (
            <p className="text-sm text-muted-foreground">리포트를 불러오는 중입니다...</p>
          )}

          {!loading && error && <p className="text-sm text-destructive">{error}</p>}

          {!loading && !error && !user?.studentId && (
            <p className="text-sm text-destructive">
              사용자 프로필에 studentId가 없습니다. 관리자에게 문의하세요.
            </p>
          )}

          {!loading && !error && user?.studentId && reports.length === 0 && (
            <p className="text-sm text-muted-foreground">
              등록된 첨삭 리포트가 없습니다.
            </p>
          )}

          {!loading && !error && reports.length > 0 && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {reports.map((report) => (
                <button
                  key={report.id}
                  type="button"
                  onClick={() => setSelectedReportId(report.id)}
                  className={`rounded-md border bg-background p-4 text-left transition-colors ${
                    selectedReport?.id === report.id
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border hover:border-primary/30 hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-1.5 sm:gap-2">
                    <div>
                      <p className="line-clamp-2 break-all text-sm font-semibold text-card-foreground">
                        {report.essayTopic?.trim() || report.fileName}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {report.createdAt
                          ? report.createdAt.toDate().toLocaleString("ko-KR")
                          : "날짜 정보 없음"}
                      </p>
                    </div>
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                      {report.totalScore ?? report.score}점
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {report.reviewer?.trim() || "담당 선생님 정보 없음"}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {!loading && !error && selectedReport && (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-4 md:px-6">
                <div>
                  <h3 className="text-base font-semibold text-card-foreground md:text-lg">
                    영역별 역량 분석
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground md:text-sm">
                    나의 점수와 전체 평균을 한눈에 비교해보세요.
                  </p>
                </div>
                <div className="hidden items-center gap-3 text-xs text-muted-foreground md:flex">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-8 rounded-full bg-primary" />
                    나의 점수
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-8 rounded-full bg-slate-300" />
                    전체 평균
                  </span>
                </div>
              </div>
              <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_180px] md:p-6">
                <div className="relative min-h-[320px] overflow-hidden rounded-2xl border border-border/60 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.08),_transparent_55%),linear-gradient(to_right,_rgba(148,163,184,0.12)_1px,_transparent_1px),linear-gradient(to_bottom,_rgba(148,163,184,0.12)_1px,_transparent_1px)] bg-[size:auto,28px_28px,28px_28px] bg-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData} outerRadius="74%">
                      <PolarGrid stroke="rgba(148, 163, 184, 0.45)" />
                      <PolarAngleAxis
                        dataKey="subject"
                        tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }}
                      />
                      <PolarRadiusAxis
                        domain={[0, 100]}
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Radar
                        name="나의 점수"
                        dataKey="myScore"
                        stroke="hsl(var(--primary))"
                        fill="hsl(var(--primary))"
                        fillOpacity={0.18}
                        strokeWidth={3}
                      />
                      <Radar
                        name="전체 평균"
                        dataKey="avgScore"
                        stroke="#94a3b8"
                        fill="#94a3b8"
                        fillOpacity={0.06}
                        strokeWidth={2}
                        strokeDasharray="6 5"
                      />
                      <Tooltip />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "독해력", value: selectedReport.scores?.reading ?? "-" },
                    { label: "내용 이해력", value: selectedReport.scores?.comprehension ?? "-" },
                    { label: "문제 이해력", value: selectedReport.scores?.problemUnderstanding ?? "-" },
                    { label: "구성력", value: selectedReport.scores?.organization ?? "-" },
                    { label: "표현력", value: selectedReport.scores?.expression ?? "-" },
                    { label: "총점", value: selectedReport.totalScore ?? selectedReport.score ?? "-" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-xl border border-border bg-background/80 px-3 py-3"
                    >
                      <p className="text-xs font-semibold text-muted-foreground">{item.label}</p>
                      <p className="mt-2 text-2xl font-bold leading-none text-card-foreground">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card shadow-card">
              <div className="border-b border-border px-4 py-4 md:px-6">
                <h3 className="text-base font-semibold text-card-foreground md:text-lg">
                  선생님의 핵심 조언
                </h3>
                <p className="mt-1 text-xs text-muted-foreground md:text-sm">
                  최근 선택한 리포트의 핵심 코멘트를 정리했습니다.
                </p>
              </div>
              <div className="space-y-4 p-4 md:p-6">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border border-border bg-muted/30 px-3 py-3">
                    <p className="text-xs font-medium text-muted-foreground">첨삭자</p>
                    <p className="mt-1 font-semibold text-card-foreground">{feedbackMeta.reviewer}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/30 px-3 py-3">
                    <p className="text-xs font-medium text-muted-foreground">작성일</p>
                    <p className="mt-1 font-semibold text-card-foreground">{feedbackMeta.writtenAt}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-background p-4 md:p-5">
                  <div className="mb-3 flex items-center gap-2 text-primary">
                    <Quote className="h-5 w-5" />
                    <p className="text-sm font-semibold">핵심 총평</p>
                  </div>
                  <p className="text-[15px] leading-7 text-card-foreground md:text-base md:leading-8">
                    {feedbackMeta.summary || "등록된 첨삭 총평이 없습니다."}
                  </p>
                </div>

                <div className="rounded-2xl border border-border bg-muted/30 p-4 md:p-5">
                  <p className="text-sm font-semibold text-muted-foreground">향후 과제</p>
                  <p className="mt-2 text-[15px] leading-7 text-card-foreground md:text-base md:leading-8">
                    {feedbackMeta.nextTask || "향후 과제가 명시되지 않았습니다."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="relative mt-10 block rounded-lg border-2 border-primary/20 bg-primary/5 p-3 shadow-card md:p-5">
          <h3 className="text-base font-bold text-card-foreground">계정 관리</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            계정 보안을 위해 정기적으로 비밀번호를 변경하세요.
          </p>

          <div className="mt-4 rounded-md border border-primary/20 bg-background p-3 md:p-4">
            <h4 className="mb-3 text-sm font-semibold text-card-foreground">비밀번호 변경</h4>
            <form className="space-y-4" onSubmit={handlePasswordChange}>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-card-foreground">현재 비밀번호</label>
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  className="text-base"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-card-foreground">새 비밀번호</label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  className="text-base"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-card-foreground">새 비밀번호 확인</label>
                <Input
                  type="password"
                  value={newPasswordConfirm}
                  onChange={(event) => setNewPasswordConfirm(event.target.value)}
                  autoComplete="new-password"
                  className="text-base"
                  required
                />
              </div>

              {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}

              <Button type="submit" disabled={passwordSaving} className="w-full">
                {passwordSaving ? "변경 중..." : "비밀번호 변경하기"}
              </Button>
            </form>
          </div>
        </div>

        <p className="text-center text-xs leading-6 text-muted-foreground/80 md:text-sm">
          보안을 위해 개별 데이터 리포트로 제공됩니다. 상세 PDF 원본이 필요한 경우 학원으로 문의 바랍니다.
        </p>
      </div>
    </DashboardLayout>
  );
};

export default StudentDashboard;
