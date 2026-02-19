import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { fetchReportsByStudentUid, type ReportRecord } from "@/lib/pdfProcessor";
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
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? reports[0] ?? null,
    [reports, selectedReportId],
  );

  const radarData = useMemo(() => {
    if (!selectedReport) {
      return [];
    }

    return [
      { subject: "독해력", value: selectedReport.scores.reading ?? 0 },
      { subject: "내용 이해력", value: selectedReport.scores.comprehension ?? 0 },
      { subject: "문제 이해력", value: selectedReport.scores.problemUnderstanding ?? 0 },
      { subject: "구성력", value: selectedReport.scores.organization ?? 0 },
      { subject: "표현력", value: selectedReport.scores.expression ?? 0 },
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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">학생 리포트 분석</h2>
          <p className="text-sm text-muted-foreground">
            레이더 차트와 총점 추이를 통해 회차별 성장을 확인합니다.
          </p>
        </div>

        {loading && <p className="text-sm text-muted-foreground">리포트를 불러오는 중입니다...</p>}
        {!loading && error && <p className="text-sm text-destructive">{error}</p>}

        {!loading && !error && reports.length === 0 && (
          <p className="text-sm text-muted-foreground">등록된 리포트가 없습니다.</p>
        )}

        {!loading && !error && reports.length > 0 && selectedReport && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="space-y-4 xl:col-span-2">
              <div className="rounded-lg border border-border bg-card p-5 shadow-card">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  {reports.map((report, index) => (
                    <button
                      key={report.id}
                      type="button"
                      onClick={() => setSelectedReportId(report.id)}
                      className={`rounded px-3 py-1 text-xs ${
                        selectedReport.id === report.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      회차 {reports.length - index}
                    </button>
                  ))}
                </div>

                <h3 className="mb-2 text-sm font-semibold text-card-foreground">5개 지표 레이더 차트</h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid />
                      <PolarAngleAxis dataKey="subject" />
                      <PolarRadiusAxis domain={[0, 25]} />
                      <Radar
                        dataKey="value"
                        stroke="hsl(var(--primary))"
                        fill="hsl(var(--primary))"
                        fillOpacity={0.28}
                      />
                      <Tooltip />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-5 shadow-card">
                <h3 className="mb-2 text-sm font-semibold text-card-foreground">총점 추이</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="round" />
                      <YAxis domain={[0, 100]} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="score"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-5 shadow-card">
              <h3 className="mb-2 text-sm font-semibold text-card-foreground">원본 PDF</h3>
              <p className="mb-2 text-xs text-muted-foreground">
                논제: {selectedReport.essayTopic || "-"} / 등급: {selectedReport.grade || "-"}
              </p>
              <iframe
                title="Report PDF Viewer"
                src={selectedReport.fileUrl}
                className="h-[620px] w-full rounded border border-border"
              />
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default ReportView;
