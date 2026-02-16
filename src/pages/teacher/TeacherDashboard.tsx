import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import StatCard from "@/components/StatCard";
import { Users, ClipboardCheck, BookOpen, TrendingUp } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const TeacherDashboard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState({ classes: 0, students: 0, scores: 0 });
  const [recentScores, setRecentScores] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const [cRes, sRes, scRes] = await Promise.all([
        supabase.from("classes").select("id", { count: "exact", head: true }),
        supabase.from("students").select("id", { count: "exact", head: true }),
        supabase.from("scores").select("id, assignment_name, total_score, grade, written_date, students(name)").order("created_at", { ascending: false }).limit(10),
      ]);
      setStats({ classes: cRes.count || 0, students: sRes.count || 0, scores: scRes.data?.length || 0 });
      setRecentScores(scRes.data || []);
    };
    fetchData();
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">강사 대시보드</h2>
          <p className="text-sm text-muted-foreground">내 수업 현황</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard icon={BookOpen} title="담당 수업" value={stats.classes} />
          <StatCard icon={Users} title="담당 학생" value={stats.students} />
          <StatCard icon={ClipboardCheck} title="최근 채점" value={stats.scores} />
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <h3 className="mb-4 text-base font-semibold text-card-foreground">최근 채점 기록</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>학생</TableHead>
                <TableHead>과제</TableHead>
                <TableHead>총점</TableHead>
                <TableHead>등급</TableHead>
                <TableHead>날짜</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentScores.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">채점 기록이 없습니다</TableCell></TableRow>
              ) : recentScores.map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{(s.students as any)?.name || "-"}</TableCell>
                  <TableCell>{s.assignment_name}</TableCell>
                  <TableCell className="font-semibold">{s.total_score}점</TableCell>
                  <TableCell>
                    <span className={`font-semibold ${
                      s.grade === "A" ? "text-success" : s.grade === "B" ? "text-primary-accent" : "text-warning"
                    }`}>{s.grade}</span>
                  </TableCell>
                  <TableCell>{s.written_date}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TeacherDashboard;
