import DashboardLayout from "@/components/DashboardLayout";
import { BarChart3, TrendingUp, Users, Target } from "lucide-react";
import StatCard from "@/components/StatCard";

const Analytics = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">통계 분석</h2>
          <p className="text-sm text-muted-foreground">학원 운영 통계 및 분석</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Users} title="이번 달 신규" value={5} change="↑ 전월 대비" changeType="positive" />
          <StatCard icon={TrendingUp} title="평균 성적 변화" value="+3.2" change="점 상승" changeType="positive" />
          <StatCard icon={Target} title="목표 달성률" value="78%" change="이번 학기" changeType="neutral" />
          <StatCard icon={BarChart3} title="수업 만족도" value="4.5" change="/ 5.0" changeType="positive" />
        </div>

        <div className="rounded-lg border border-border bg-card p-8 shadow-card">
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <BarChart3 className="h-12 w-12 mb-3 opacity-40" />
            <p className="text-base font-medium">상세 통계 분석</p>
            <p className="text-sm mt-1">Google Sheets 데이터가 연동되면 자동으로 분석 차트가 표시됩니다</p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Analytics;
