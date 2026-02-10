import DashboardLayout from "@/components/DashboardLayout";
import { Settings as SettingsIcon } from "lucide-react";

const Settings = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">설정</h2>
          <p className="text-sm text-muted-foreground">시스템 설정 및 환경 구성</p>
        </div>

        <div className="rounded-lg border border-border bg-card p-8 shadow-card">
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <SettingsIcon className="h-12 w-12 mb-3 opacity-40" />
            <p className="text-base font-medium">설정 페이지 준비 중</p>
            <p className="text-sm mt-1">학원 정보, 알림 설정 등을 관리할 수 있습니다</p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Settings;
