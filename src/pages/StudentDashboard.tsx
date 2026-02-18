import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchReportsByStudentId,
  type ReportRecord,
} from "@/lib/pdfEngine";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FileText, TrendingUp } from "lucide-react";

const StudentDashboard = () => {
  const { user } = useAuth();
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">학생 대시보드</h2>
          <p className="text-sm text-muted-foreground">
            학번 {user?.studentId ?? "미등록"} 기준으로 첨삭 리포트를 조회합니다.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-card-foreground">점수 추이</h3>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
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

        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <h3 className="mb-3 text-sm font-semibold text-card-foreground">첨삭 PDF 목록</h3>

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
                  onClick={() => window.open(report.fileUrl, "_blank", "noopener,noreferrer")}
                  className="rounded-md border border-border bg-background p-4 text-left transition-colors hover:border-primary/30 hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-card-foreground">
                        {report.fileName}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {report.createdAt
                          ? report.createdAt.toDate().toLocaleString("ko-KR")
                          : "날짜 정보 없음"}
                      </p>
                    </div>
                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                  </div>
                  <p className="mt-2 text-sm text-card-foreground">
                    점수: <span className="font-semibold">{report.score}점</span>
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default StudentDashboard;
