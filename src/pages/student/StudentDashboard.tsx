import { useState, useEffect, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import StatCard from "@/components/StatCard";
import { ClipboardCheck, TrendingUp, Award, Download } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface ScoreRow {
  id: string;
  assignment_name: string;
  round: number;
  written_date: string;
  reading: number | null;
  content_understanding: number | null;
  problem_understanding: number | null;
  composition: number | null;
  format: number | null;
  total_score: number | null;
  grade: string | null;
  feedback: string | null;
  pdf_path: string | null;
}

const StudentDashboard = () => {
  const { user } = useAuth();
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchScores = async () => {
      if (!user) return;
      // Find student record
      const { data: student } = await supabase
        .from("students")
        .select("id")
        .eq("auth_user_id", user.id)
        .single();

      if (!student) { setLoading(false); return; }
      setStudentId(student.id);

      const { data } = await supabase
        .from("scores")
        .select("*")
        .eq("student_id", student.id)
        .order("written_date", { ascending: true });

      setScores((data as ScoreRow[]) || []);
      setLoading(false);
    };
    fetchScores();
  }, [user]);

  const avgScore = useMemo(() => {
    if (scores.length === 0) return 0;
    return Math.round(scores.reduce((sum, s) => sum + (s.total_score || 0), 0) / scores.length);
  }, [scores]);

  const latestGrade = scores.length > 0 ? scores[scores.length - 1].grade || "-" : "-";

  const chartData = useMemo(() =>
    scores.map(s => ({
      name: `${s.round}회`,
      점수: s.total_score || 0,
    })),
    [scores]
  );

  const handleDownloadPdf = async (pdfPath: string) => {
    const { data, error } = await supabase.storage.from("attachments").download(pdfPath);
    if (error || !data) return;
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = pdfPath.split("/").pop() || "score.pdf";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">내 성적</h2>
          <p className="text-sm text-muted-foreground">논술 성적 현황</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard icon={ClipboardCheck} title="총 평가 횟수" value={scores.length} />
          <StatCard icon={TrendingUp} title="평균 점수" value={avgScore} />
          <StatCard icon={Award} title="최근 등급" value={latestGrade} />
        </div>

        {/* Score trend chart */}
        {chartData.length > 1 && (
          <div className="rounded-lg border border-border bg-card p-5 shadow-card">
            <h3 className="mb-4 text-base font-semibold text-card-foreground">점수 추이</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 25%, 89%)" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(200, 14%, 41%)" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(200, 14%, 41%)" domain={[0, 100]} />
                <Tooltip />
                <Line type="monotone" dataKey="점수" stroke="hsl(210, 76%, 46%)" strokeWidth={2} dot={{ r: 4, fill: "hsl(210, 76%, 46%)" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Scores table */}
        <div className="rounded-lg border border-border bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>회차</TableHead>
                <TableHead>과제</TableHead>
                <TableHead>독해</TableHead>
                <TableHead>내용</TableHead>
                <TableHead>문제</TableHead>
                <TableHead>구성</TableHead>
                <TableHead>형식</TableHead>
                <TableHead>총점</TableHead>
                <TableHead>등급</TableHead>
                <TableHead>PDF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">불러오는 중...</TableCell></TableRow>
              ) : scores.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">성적 데이터가 없습니다</TableCell></TableRow>
              ) : scores.map(s => (
                <TableRow key={s.id}>
                  <TableCell>{s.round}회</TableCell>
                  <TableCell className="font-medium">{s.assignment_name}</TableCell>
                  <TableCell>{s.reading ?? "-"}</TableCell>
                  <TableCell>{s.content_understanding ?? "-"}</TableCell>
                  <TableCell>{s.problem_understanding ?? "-"}</TableCell>
                  <TableCell>{s.composition ?? "-"}</TableCell>
                  <TableCell>{s.format ?? "-"}</TableCell>
                  <TableCell className="font-semibold">{s.total_score}점</TableCell>
                  <TableCell>
                    <span className={`font-semibold ${
                      s.grade === "A" ? "text-success" : s.grade === "B" ? "text-primary-accent" : "text-warning"
                    }`}>{s.grade}</span>
                  </TableCell>
                  <TableCell>
                    {s.pdf_path ? (
                      <Button variant="ghost" size="sm" onClick={() => handleDownloadPdf(s.pdf_path!)}>
                        <Download className="h-4 w-4" />
                      </Button>
                    ) : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default StudentDashboard;
