import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { fetchReportsByStudentUid, type ReportRecord } from "@/lib/pdfProcessor";
import { normalizeRole } from "@/lib/authz";
import {
  deleteManagedUserCompletely,
  fetchManagedUsers,
  getMasterControls,
  saveMasterControls,
  updateManagedUserRole,
  type ManagedUser,
} from "@/services/masterAdminService";

const scoreMetrics: Array<{ key: keyof NonNullable<ReportRecord["scores"]>; label: string }> = [
  { key: "reading", label: "독해력" },
  { key: "comprehension", label: "내용 이해력" },
  { key: "problemUnderstanding", label: "문제 이해력" },
  { key: "organization", label: "구성력" },
  { key: "expression", label: "논증/표현력" },
];

const safeNumber = (value: unknown): number | null => {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

const reportTotal = (report: ReportRecord): number | null => {
  const direct = safeNumber(report.totalScore);
  if (direct !== null) {
    return direct;
  }

  const scores = report.scores;
  if (!scores) {
    return null;
  }

  const fromTotal = safeNumber(scores.total);
  if (fromTotal !== null) {
    return fromTotal;
  }

  const partial = [
    safeNumber(scores.reading),
    safeNumber(scores.comprehension),
    safeNumber(scores.problemUnderstanding),
    safeNumber(scores.organization),
    safeNumber(scores.expression),
  ].filter((value): value is number => value !== null);

  if (!partial.length) {
    return null;
  }

  return partial.reduce((sum, value) => sum + value, 0);
};

const getTimestampMs = (report: ReportRecord) => report.createdAt?.toMillis() ?? 0;

const avg = (rows: number[]) => {
  if (!rows.length) {
    return null;
  }
  return rows.reduce((sum, value) => sum + value, 0) / rows.length;
};

const MasterAdminPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [savingControls, setSavingControls] = useState(false);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [search, setSearch] = useState("");
  const [instructorSignupCode, setInstructorSignupCode] = useState("");
  const [autoNotifyOnFeedbackComplete, setAutoNotifyOnFeedbackComplete] = useState(true);
  const [roleUpdatingUid, setRoleUpdatingUid] = useState<string | null>(null);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);

  const [analysisStudentUid, setAnalysisStudentUid] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisReports, setAnalysisReports] = useState<ReportRecord[]>([]);
  const [analysisMessages, setAnalysisMessages] = useState<string[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [controls, userRows] = await Promise.all([getMasterControls(), fetchManagedUsers()]);
      setInstructorSignupCode(controls.instructorSignupCode);
      setAutoNotifyOnFeedbackComplete(controls.autoNotifyOnFeedbackComplete);
      setUsers(userRows);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "초기 데이터 로드 실패",
        description: error instanceof Error ? error.message : "데이터를 불러오지 못했습니다.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredUsers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return users;
    }

    return users.filter((row) => {
      const target = `${row.name} ${row.email} ${row.studentId || ""} ${row.uid}`.toLowerCase();
      return target.includes(keyword);
    });
  }, [search, users]);

  const studentCandidates = useMemo(
    () => users.filter((row) => normalizeRole(row.role) === "STUDENT"),
    [users],
  );

  const saveControls = async () => {
    if (!user) {
      return;
    }

    if (!instructorSignupCode.trim()) {
      toast({
        variant: "destructive",
        title: "강사 코드 확인",
        description: "강사 가입 코드는 비워둘 수 없습니다.",
      });
      return;
    }

    setSavingControls(true);
    try {
      await saveMasterControls(
        {
          instructorSignupCode: instructorSignupCode.trim(),
          autoNotifyOnFeedbackComplete,
        },
        user.uid,
      );
      toast({
        title: "시스템 제어 설정 저장 완료",
        description: "알림 토글 및 강사 코드가 반영되었습니다.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "설정 저장 실패",
        description: error instanceof Error ? error.message : "설정을 저장하지 못했습니다.",
      });
    } finally {
      setSavingControls(false);
    }
  };

  const handleRoleChange = async (target: ManagedUser, nextRole: "STUDENT" | "INSTRUCTOR") => {
    setRoleUpdatingUid(target.uid);
    try {
      await updateManagedUserRole(target.uid, nextRole);
      setUsers((prev) => prev.map((row) => (row.uid === target.uid ? { ...row, role: nextRole } : row)));
      toast({
        title: "권한 변경 완료",
        description: `${target.name} 사용자의 권한을 ${nextRole}로 변경했습니다.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "권한 변경 실패",
        description: error instanceof Error ? error.message : "권한 변경 중 오류가 발생했습니다.",
      });
    } finally {
      setRoleUpdatingUid(null);
    }
  };

  const handleDelete = async (target: ManagedUser) => {
    if (!user) {
      return;
    }

    if (target.uid === user.uid) {
      toast({
        variant: "destructive",
        title: "삭제 차단",
        description: "현재 로그인한 관리자 계정은 여기서 삭제할 수 없습니다.",
      });
      return;
    }

    if (!window.confirm(`${target.name} (${target.email}) 계정을 완전 삭제하시겠습니까?`)) {
      return;
    }

    setDeletingUid(target.uid);
    try {
      await deleteManagedUserCompletely(target.uid);
      setUsers((prev) => prev.filter((row) => row.uid !== target.uid));
      toast({
        title: "계정 삭제 완료",
        description: "Auth 계정과 관련 DB 데이터를 삭제했습니다.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "계정 삭제 실패",
        description:
          error instanceof Error
            ? error.message
            : "계정 삭제를 완료하지 못했습니다. Functions 설정을 확인해주세요.",
      });
    } finally {
      setDeletingUid(null);
    }
  };

  const runAnalysis = async () => {
    if (!analysisStudentUid) {
      toast({
        variant: "destructive",
        title: "학생 선택 필요",
        description: "먼저 분석할 학생을 선택해주세요.",
      });
      return;
    }

    setAnalysisLoading(true);
    setAnalysisMessages([]);

    try {
      const reports = await fetchReportsByStudentUid(analysisStudentUid);
      const sorted = [...reports].sort((a, b) => getTimestampMs(a) - getTimestampMs(b));
      setAnalysisReports(sorted);

      const messages: string[] = [];
      const totals = sorted
        .map((report) => reportTotal(report))
        .filter((value): value is number => value !== null);

      if (totals.length >= 3) {
        const last3 = totals.slice(-3);
        if (last3[0] < last3[1] && last3[1] < last3[2]) {
          messages.push("📈 성적 우상향 중");
        } else if (last3[0] > last3[1] && last3[1] > last3[2]) {
          messages.push("⚠️ 슬럼프 점검 상담 권장");
        }
      }

      const latest = sorted[sorted.length - 1];
      if (latest?.scores) {
        scoreMetrics.forEach((metric) => {
          const latestScore = safeNumber(latest.scores?.[metric.key]);
          if (latestScore === null) {
            return;
          }

          const history = sorted
            .map((report) => safeNumber(report.scores?.[metric.key]))
            .filter((value): value is number => value !== null);
          const metricAverage = avg(history);

          if (metricAverage !== null && latestScore < metricAverage) {
            messages.push(`💡 ${metric.label} 집중 보완 필요`);
          }
        });
      }

      const totalAverage = avg(totals);
      if (totalAverage !== null && totalAverage >= 90) {
        messages.push("🏆 최상위권 안정권");
      }

      if (messages.length === 0) {
        messages.push("기준 로직상 특이 경보 없음");
      }

      setAnalysisMessages(messages);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "분석 실패",
        description: error instanceof Error ? error.message : "누적 성적 데이터를 불러오지 못했습니다.",
      });
    } finally {
      setAnalysisLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold text-card-foreground">마스터 시스템 제어</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            실장님 전용 알림 정책과 강사 가입 코드를 직접 제어합니다.
          </p>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-card-foreground">강사 가입 코드</label>
              <Input
                type="text"
                value={instructorSignupCode}
                onChange={(event) => setInstructorSignupCode(event.target.value)}
                placeholder="강사 가입 코드"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium text-card-foreground">Master Notification Toggle</p>
                <p className="text-xs text-muted-foreground">
                  첨삭 완료 시 학생 자동 알림 발송을 제어합니다.
                </p>
              </div>
              <Switch
                checked={autoNotifyOnFeedbackComplete}
                onCheckedChange={(checked) => setAutoNotifyOnFeedbackComplete(checked)}
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button onClick={saveControls} disabled={savingControls || loading}>
              {savingControls ? "저장 중..." : "설정 저장"}
            </Button>
            <p className="text-xs text-muted-foreground">
              저장 후 가입/리포트 발송 로직에 즉시 반영됩니다.
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-card-foreground">유저 관리 및 사고 수습</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                이름/아이디 검색, 권한 변경, 계정 완전 삭제(Auth + DB) 기능입니다.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="이름/이메일/학생ID 검색"
                className="w-64"
              />
              <Button variant="outline" onClick={loadData} disabled={loading}>
                새로고침
              </Button>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] divide-y divide-border text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-muted-foreground">이름</th>
                  <th className="px-3 py-2 text-left text-muted-foreground">이메일</th>
                  <th className="px-3 py-2 text-left text-muted-foreground">학생ID</th>
                  <th className="px-3 py-2 text-left text-muted-foreground">권한</th>
                  <th className="px-3 py-2 text-left text-muted-foreground">조치</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredUsers.map((row) => (
                  <tr key={row.uid}>
                    <td className="px-3 py-2 text-card-foreground">{row.name}</td>
                    <td className="px-3 py-2 text-card-foreground">{row.email || "-"}</td>
                    <td className="px-3 py-2 text-card-foreground">{row.studentId || row.phoneSuffix || "-"}</td>
                    <td className="px-3 py-2">
                      {normalizeRole(row.role) === "ADMIN" ? (
                        <span className="rounded-md bg-primary/15 px-2 py-1 text-xs font-semibold text-primary">
                          ADMIN
                        </span>
                      ) : (
                        <Select
                          value={normalizeRole(row.role)}
                          onValueChange={(value: "STUDENT" | "INSTRUCTOR") =>
                            handleRoleChange(row, value)
                          }
                          disabled={roleUpdatingUid === row.uid}
                        >
                          <SelectTrigger className="h-8 w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="STUDENT">STUDENT</SelectItem>
                            <SelectItem value="INSTRUCTOR">INSTRUCTOR</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={deletingUid === row.uid || normalizeRole(row.role) === "ADMIN"}
                        onClick={() => handleDelete(row)}
                      >
                        {deletingUid === row.uid ? "삭제 중..." : "계정 삭제"}
                      </Button>
                    </td>
                  </tr>
                ))}

                {!filteredUsers.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-5 text-center text-muted-foreground">
                      검색 결과가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            Auth 삭제는 Firebase callable 함수(`adminDeleteUser` 또는 `deleteUserByUid`)가 배포되어야 동작합니다.
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold text-card-foreground">고도화 룰베이스 분석 엔진</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            학생 누적 성적을 불러와 추세/항목별/종합 상담 인사이트를 자동 생성합니다.
          </p>

          <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
            <Select value={analysisStudentUid} onValueChange={setAnalysisStudentUid}>
              <SelectTrigger className="w-full md:w-[360px]">
                <SelectValue placeholder="분석할 학생 선택" />
              </SelectTrigger>
              <SelectContent>
                {studentCandidates.map((student) => (
                  <SelectItem key={student.uid} value={student.uid}>
                    {student.name} ({student.email || "이메일 없음"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={runAnalysis} disabled={analysisLoading || !analysisStudentUid}>
              {analysisLoading ? "분석 중..." : "분석 실행"}
            </Button>
          </div>

          {analysisReports.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              누적 데이터 {analysisReports.length}건 기준으로 분석했습니다.
            </p>
          )}

          <div className="mt-4 space-y-2">
            {analysisMessages.map((message, index) => (
              <div key={`${message}-${index}`} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
                {message}
              </div>
            ))}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
};

export default MasterAdminPage;
