import { useEffect, useMemo, useState } from "react";
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
  fetchClasses,
  fetchMyClassJoinRequests,
  fetchReportsByStudentUid,
  markReportAsRead,
  submitClassJoinRequest,
  type ClassJoinRequestRecord,
  type ClassLite,
  type ReportRecord,
} from "@/lib/pdfProcessor";
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

  useEffect(() => {
    const run = async () => {
      if (!user?.uid) {
        setReports([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const records = await fetchReportsByStudentUid(user.uid);
        setReports(records);
        setSelectedReportId(records[0]?.id ?? "");
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

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? reports[0] ?? null,
    [reports, selectedReportId],
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
      [...reports].reverse().map((report, index) => ({
        round: `회차 ${index + 1}`,
        score: report.totalScore,
      })),
    [reports],
  );

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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">학생 리포트 분석</h2>
          <p className="text-sm text-muted-foreground">
            PDF 첨삭 데이터가 디지털 대시보드에 이식되어 회차별 성장을 확인할 수 있습니다.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-card-foreground">반 가입 신청</h3>
              <p className="text-xs text-muted-foreground">
                현재 배정 반: {user?.className ?? "미배정"}
                {latestPendingClassId ? " | 승인 대기 중" : ""}
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

        {loading && <p className="text-sm text-muted-foreground">리포트를 불러오는 중입니다...</p>}
        {!loading && error && <p className="text-sm text-destructive">{error}</p>}

        {!loading && !error && reports.length === 0 && (
          <p className="text-sm text-muted-foreground">아직 배포된 리포트가 없습니다.</p>
        )}

        {!loading && !error && reports.length > 0 && selectedReport && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="space-y-4 xl:col-span-2">
              <div className="rounded-lg border border-border bg-card p-5 shadow-card">
                <h3 className="mb-2 text-sm font-semibold text-card-foreground">총점 추이</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="round" />
                      <YAxis domain={[0, 100]} />
                      <Tooltip />
                      <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-5 shadow-card">
                <h3 className="mb-2 text-sm font-semibold text-card-foreground">5개 지표 레이더 차트</h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid />
                      <PolarAngleAxis dataKey="subject" />
                      <PolarRadiusAxis domain={[50, 100]} />
                      <Radar
                        name="나의점수"
                        dataKey="myScore"
                        stroke="#f5b700"
                        fill="#f5b700"
                        fillOpacity={0.18}
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
              </div>

              <div className="rounded-lg border border-border bg-card p-5 shadow-card">
                <h3 className="mb-3 text-sm font-semibold text-card-foreground">리포트 목록</h3>
                <div className="space-y-2">
                  {reports.map((report, index) => (
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
                        <p className="text-sm font-semibold text-card-foreground">
                          회차 {reports.length - index} / {report.essayTopic || "논제 미기재"}
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
                      <p className="mt-1 text-xs text-muted-foreground">
                        총점 {report.totalScore} | 등급 {report.grade || "-"} | 날짜{" "}
                        {report.createdAt
                          ? report.createdAt.toDate().toLocaleDateString("ko-KR")
                          : "-"}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-5 shadow-card">
                <h3 className="mb-2 text-sm font-semibold text-card-foreground">피드백 카드</h3>
                <div className="space-y-2 text-sm">
                  <p className="text-card-foreground">등급: <span className="font-semibold">{selectedReport.grade || "-"}</span></p>
                  <p className="text-card-foreground">총점: <span className="font-semibold">{selectedReport.totalScore}</span></p>
                  <p className="text-card-foreground">작성일: {selectedReport.writtenAt || "-"}</p>
                  <p className="text-card-foreground">첨삭자: {selectedReport.reviewer || "-"}</p>
                </div>
                <p className="mt-3 rounded-md border border-border bg-background p-3 text-sm text-card-foreground">
                  {selectedReport.feedback || "첨삭 총평이 없습니다."}
                </p>
                <Button
                  className="mt-3 w-full"
                  variant="outline"
                  onClick={() => window.open(selectedReport.fileUrl, "_blank", "noopener,noreferrer")}
                >
                  원본 PDF 열기
                </Button>
              </div>

              <div className="rounded-lg border border-border bg-card p-5 shadow-card">
                <h3 className="mb-2 text-sm font-semibold text-card-foreground">원본 PDF 미리보기</h3>
                <iframe
                  title="Report PDF Viewer"
                  src={selectedReport.fileUrl}
                  className="h-[560px] w-full rounded border border-border"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default ReportView;
