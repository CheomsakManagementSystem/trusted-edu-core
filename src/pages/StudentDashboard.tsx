import DashboardLayout from "@/components/DashboardLayout";

const StudentDashboard = () => {
  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">학생 대시보드</h2>
          <p className="text-sm text-muted-foreground">
            나의 논술 리포트와 학습 현황을 확인하세요.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-card">
          <p className="text-sm text-muted-foreground">
            학생 전용 기능(리포트 확인, 피드백, 과제 제출 등)은 추후 이 영역에
            추가하면 됩니다.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default StudentDashboard;

