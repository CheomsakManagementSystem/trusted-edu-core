import DashboardLayout from "@/components/DashboardLayout";
import StatCard from "@/components/StatCard";
import {
  Users,
  GraduationCap,
  ClipboardCheck,
  TrendingUp,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  LineChart,
  Line,
} from "recharts";

const monthlyData = [
  { month: "9월", 학생수: 42 },
  { month: "10월", 학생수: 48 },
  { month: "11월", 학생수: 55 },
  { month: "12월", 학생수: 52 },
  { month: "1월", 학생수: 60 },
  { month: "2월", 학생수: 65 },
];

const scoreData = [
  { subject: "논리력", score: 82 },
  { subject: "표현력", score: 75 },
  { subject: "구성력", score: 88 },
  { subject: "창의력", score: 70 },
  { subject: "분석력", score: 85 },
  { subject: "종합", score: 80 },
];

const trendData = [
  { week: "1주", 평균점수: 72 },
  { week: "2주", 평균점수: 75 },
  { week: "3주", 평균점수: 74 },
  { week: "4주", 평균점수: 78 },
  { week: "5주", 평균점수: 80 },
  { week: "6주", 평균점수: 82 },
  { week: "7주", 평균점수: 79 },
  { week: "8주", 평균점수: 85 },
];

const recentStudents = [
  { name: "김민지", class: "고2 심화반", score: 88, status: "우수" },
  { name: "이준서", class: "고3 수시반", score: 72, status: "보통" },
  { name: "박서연", class: "고1 기초반", score: 65, status: "노력" },
  { name: "최도윤", class: "고2 심화반", score: 91, status: "우수" },
  { name: "정하은", class: "고3 수시반", score: 78, status: "보통" },
];

const AdminDashboard = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page title */}
        <div>
          <h2 className="text-xl font-bold text-foreground">관리자 대시보드</h2>
          <p className="text-sm text-muted-foreground">논술 학원 전체 현황</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Users}
            title="전체 학생"
            value={65}
            change="↑ 5명 증가"
            changeType="positive"
          />
          <StatCard
            icon={GraduationCap}
            title="수업 반"
            value={8}
            change="이번 학기"
            changeType="neutral"
          />
          <StatCard
            icon={ClipboardCheck}
            title="평균 점수"
            value="79.2"
            change="↑ 2.3점"
            changeType="positive"
          />
          <StatCard
            icon={TrendingUp}
            title="출석률"
            value="94%"
            change="↓ 1%"
            changeType="negative"
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Bar chart */}
          <div className="rounded-lg border border-border bg-card p-5 shadow-card">
            <h3 className="mb-4 text-base font-semibold text-card-foreground">
              월별 학생 수 추이
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlyData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(214, 25%, 89%)"
                />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 12 }}
                  stroke="hsl(200, 14%, 41%)"
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  stroke="hsl(200, 14%, 41%)"
                />
                <Tooltip />
                <Bar
                  dataKey="학생수"
                  fill="hsl(210, 76%, 46%)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Radar chart */}
          <div className="rounded-lg border border-border bg-card p-5 shadow-card">
            <h3 className="mb-4 text-base font-semibold text-card-foreground">
              영역별 평균 점수
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart data={scoreData}>
                <PolarGrid stroke="hsl(214, 25%, 89%)" />
                <PolarAngleAxis
                  dataKey="subject"
                  tick={{ fontSize: 12 }}
                  stroke="hsl(200, 14%, 41%)"
                />
                <PolarRadiusAxis
                  tick={{ fontSize: 10 }}
                  stroke="hsl(200, 14%, 41%)"
                />
                <Radar
                  dataKey="score"
                  stroke="hsl(210, 76%, 46%)"
                  fill="hsla(210, 76%, 46%, 0.25)"
                  fillOpacity={1}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bottom row */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Line chart */}
          <div className="rounded-lg border border-border bg-card p-5 shadow-card lg:col-span-2">
            <h3 className="mb-4 text-base font-semibold text-card-foreground">
              주간 평균 점수 추이
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(214, 25%, 89%)"
                />
                <XAxis
                  dataKey="week"
                  tick={{ fontSize: 12 }}
                  stroke="hsl(200, 14%, 41%)"
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  stroke="hsl(200, 14%, 41%)"
                  domain={[60, 100]}
                />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="평균점수"
                  stroke="hsl(210, 64%, 16%)"
                  strokeWidth={2}
                  dot={{ r: 4, fill: "hsl(210, 76%, 46%)" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Recent students */}
          <div className="rounded-lg border border-border bg-card p-5 shadow-card">
            <h3 className="mb-4 text-base font-semibold text-card-foreground">
              최근 평가 학생
            </h3>
            <div className="space-y-3">
              {recentStudents.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between border-b border-border pb-2 last:border-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium text-card-foreground">
                      {s.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{s.class}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-card-foreground">
                      {s.score}점
                    </p>
                    <span
                      className={`text-xs font-medium ${
                        s.status === "우수"
                          ? "text-success"
                          : s.status === "노력"
                          ? "text-warning"
                          : "text-muted-foreground"
                      }`}
                    >
                      {s.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AdminDashboard;

