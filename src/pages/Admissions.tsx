import DashboardLayout from "@/components/DashboardLayout";
import { GraduationCap } from "lucide-react";

const Admissions = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">입시 관리</h2>
          <p className="text-sm text-muted-foreground">대학 입시 일정 및 학생별 진행 현황</p>
        </div>

        <div className="rounded-lg border border-border bg-card p-8 shadow-card">
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <GraduationCap className="h-12 w-12 mb-3 opacity-40" />
            <p className="text-base font-medium">입시 관리 기능 준비 중</p>
            <p className="text-sm mt-1">Google Sheets 데이터가 연동되면 입시 현황이 표시됩니다</p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Admissions;
