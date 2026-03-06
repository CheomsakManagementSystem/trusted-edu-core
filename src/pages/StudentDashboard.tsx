import { type FormEvent, useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { auth } from "@/lib/firebase";
import {
  fetchReportsByStudentId,
  type ReportRecord,
} from "@/lib/pdfEngine";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const StudentDashboard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);

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

  const handlePasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError(null);

    if (!currentPassword || !newPassword || !newPasswordConfirm) {
      setPasswordError("모든 비밀번호 입력값을 채워주세요.");
      window.alert("모든 비밀번호 입력값을 채워주세요.");
      return;
    }

    if (newPassword !== newPasswordConfirm) {
      setPasswordError("새 비밀번호가 서로 다릅니다");
      window.alert("새 비밀번호가 서로 다릅니다");
      return;
    }

    const firebaseUser = auth.currentUser;
    if (!firebaseUser?.email) {
      setPasswordError("비밀번호 변경을 위한 사용자 인증 정보를 확인할 수 없습니다.");
      window.alert("비밀번호 변경을 위한 사용자 인증 정보를 확인할 수 없습니다.");
      return;
    }

    if (currentPassword === newPassword) {
      setPasswordError("새 비밀번호는 현재 비밀번호와 다르게 설정해주세요.");
      window.alert("새 비밀번호는 현재 비밀번호와 다르게 설정해주세요.");
      return;
    }

    setPasswordSaving(true);
    try {
      const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
      await reauthenticateWithCredential(firebaseUser, credential);
      await updatePassword(firebaseUser, newPassword);

      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
      toast({
        title: "비밀번호 변경 완료",
        description: "비밀번호가 안전하게 변경되었습니다!",
      });
      window.alert("비밀번호가 안전하게 변경되었습니다!");
    } catch (passwordUpdateError) {
      const errorCode =
        typeof passwordUpdateError === "object" &&
        passwordUpdateError !== null &&
        "code" in passwordUpdateError
          ? String(passwordUpdateError.code)
          : "";

      if (errorCode === "auth/wrong-password" || errorCode === "auth/invalid-credential") {
        setPasswordError("현재 비밀번호가 올바르지 않습니다.");
        window.alert("현재 비밀번호가 올바르지 않습니다.");
      } else if (errorCode === "auth/weak-password") {
        setPasswordError("새 비밀번호가 너무 약합니다. 더 안전한 비밀번호를 입력해주세요.");
        window.alert("새 비밀번호가 너무 약합니다. 더 안전한 비밀번호를 입력해주세요.");
      } else if (errorCode === "auth/too-many-requests") {
        setPasswordError("요청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해주세요.");
        window.alert("요청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해주세요.");
      } else {
        setPasswordError("비밀번호 변경 중 오류가 발생했습니다. 다시 시도해주세요.");
        window.alert("비밀번호 변경 중 오류가 발생했습니다. 다시 시도해주세요.");
      }
    } finally {
      setPasswordSaving(false);
    }
  };

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

        <div className="sticky bottom-3 z-30 block rounded-lg border border-primary/30 bg-card p-5 shadow-card">
          <h3 className="text-base font-bold text-card-foreground">계정 관리</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            계정 보안을 위해 정기적으로 비밀번호를 변경하세요.
          </p>

          <div className="mt-4 rounded-md border border-primary/20 bg-background p-4">
            <h4 className="mb-3 text-sm font-semibold text-card-foreground">비밀번호 변경</h4>
            <form className="space-y-3" onSubmit={handlePasswordChange}>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-card-foreground">현재 비밀번호</label>
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-card-foreground">새 비밀번호</label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-card-foreground">새 비밀번호 확인</label>
                <Input
                  type="password"
                  value={newPasswordConfirm}
                  onChange={(event) => setNewPasswordConfirm(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>

              {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}

              <Button type="submit" disabled={passwordSaving} className="w-full md:w-auto">
                {passwordSaving ? "변경 중..." : "비밀번호 변경하기"}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default StudentDashboard;
