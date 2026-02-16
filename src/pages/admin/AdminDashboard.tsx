import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import StatCard from "@/components/StatCard";
import { supabase } from "@/integrations/supabase/client";
import { Users, BookOpen, ClipboardCheck, TrendingUp } from "lucide-react";

const AdminDashboard = () => {
  const [stats, setStats] = useState({ students: 0, classes: 0, scores: 0 });

  useEffect(() => {
    const fetchStats = async () => {
      const [s, c, sc] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }),
        supabase.from("classes").select("id", { count: "exact", head: true }),
        supabase.from("scores").select("id", { count: "exact", head: true }),
      ]);
      setStats({
        students: s.count || 0,
        classes: c.count || 0,
        scores: sc.count || 0,
      });
    };
    fetchStats();
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">관리자 대시보드</h2>
          <p className="text-sm text-muted-foreground">전체 현황</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Users} title="전체 학생" value={stats.students} />
          <StatCard icon={BookOpen} title="수업 반" value={stats.classes} />
          <StatCard icon={ClipboardCheck} title="성적 기록" value={stats.scores} />
          <StatCard icon={TrendingUp} title="시스템" value="정상" />
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AdminDashboard;
