import { useEffect, useMemo, useState } from "react";
import { deleteUser } from "firebase/auth";
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
import { auth } from "@/lib/firebase";
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
import { formatStudentName } from "@/lib/studentName";

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

const formatDate = (report: ReportRecord): string => {
  const dateMs = getTimestampMs(report);
  if (dateMs) {
    const date = new Date(dateMs);
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, "0");
    const d = `${date.getDate()}`.padStart(2, "0");
    return `${y}.${m}.${d}`;
  }

  if (report.writtenAt?.trim()) {
    return report.writtenAt.trim();
  }

  return "날짜 정보 없음";
};

const MasterAdminPage = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [savingControls, setSavingControls] = useState(false);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [search, setSearch] = useState("");
  const [instructorSignupCode, setInstructorSignupCode] = useState("");
  const [autoNotifyOnFeedbackComplete, setAutoNotifyOnFeedbackComplete] = useState(true);
  const [roleUpdatingUid, setRoleUpdatingUid] = useState<string | null>(null);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);
  const [withdrawingAdmin, setWithdrawingAdmin] = useState(false);

  const [analysisStudentUid, setAnalysisStudentUid] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisReports, setAnalysisReports] = useState<ReportRecord[]>([]);
  const [analysisMessages, setAnalysisMessages] = useState<string[]>([]);
  const [openReportIds, setOpenReportIds] = useState<Record<string, boolean>>({});

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
        title: "선생님 코드 확인",
        description: "선생님용 가입 비밀코드는 비워둘 수 없습니다.",
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
        title: "운영 환경 설정이 저장되었습니다",
        description: "자동 알림과 선생님 초대 코드가 반영되었습니다.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "설정 완료 처리 실패",
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
      const roleText = nextRole === "INSTRUCTOR" ? "선생님" : "학생";
      toast({
        title: "권한 변경 완료",
        description: `${target.name}님의 역할을 ${roleText}(으)로 변경했습니다.`,
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
        description: "해당 가입자 정보를 정리했습니다.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "계정 삭제 실패",
        description:
          error instanceof Error
            ? error.message
            : "계정 삭제를 완료하지 못했습니다. 함수 설정을 확인해주세요.",
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
    setOpenReportIds({});

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

  const toggleReportOpen = (reportId: string) => {
    setOpenReportIds((prev) => ({
      ...prev,
      [reportId]: !prev[reportId],
    }));
  };

  const handleWithdrawAdminAccount = async () => {
    if (!user?.uid) {
      toast({
        variant: "destructive",
        title: "회원 탈퇴 실패",
        description: "인증 상태를 확인할 수 없습니다.",
      });
      return;
    }

    const confirmed = window.confirm("정말 탈퇴하시겠습니까?");
    if (!confirmed) {
      return;
    }

    setWithdrawingAdmin(true);
    try {
      await deleteManagedUserCompletely(user.uid);
      if (auth.currentUser) {
        try {
          await deleteUser(auth.currentUser);
        } catch {
          // 서버 함수에서 이미 삭제된 경우 클라이언트 삭제 에러는 무시
        }
      }
      await signOut();
      toast({
        title: "회원 탈퇴 완료",
        description: "관리자 계정이 삭제되었습니다.",
      });
      window.location.href = "/login";
    } catch (error) {
      toast({
        variant: "destructive",
        title: "회원 탈퇴 실패",
        description:
          error instanceof Error ? error.message : "탈퇴 처리 중 오류가 발생했습니다.",
      });
    } finally {
      setWithdrawingAdmin(false);
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
              <label className="text-sm font-medium text-card-foreground">선생님용 가입 비밀코드</label>
              <Input
                type="text"
                value={instructorSignupCode}
                onChange={(event) => setInstructorSignupCode(event.target.value)}
                placeholder="선생님용 가입 비밀코드"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium text-card-foreground">첨삭 완료 알림 끄고 켜기</p>
                <p className="text-xs text-muted-foreground">
                  첨삭이 끝나면 학생에게 자동으로 알림 문자가 가도록 설정합니다.
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
              {savingControls ? "저장 중..." : "설정 완료"}
            </Button>
            <p className="text-xs text-muted-foreground">
              저장 즉시 가입 코드와 알림 기능에 적용됩니다.
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-card-foreground">유저 관리 및 사고 수습</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                실장님 전용 알림 정책과 강사 가입 코드를 직접 제어합니다.
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
                  <th className="px-3 py-2 text-left text-muted-foreground">관리</th>
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
                          실장님
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
                            <SelectItem value="STUDENT">학생</SelectItem>
                            <SelectItem value="INSTRUCTOR">선생님</SelectItem>
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
                        {deletingUid === row.uid ? "처리 중..." : "계정 삭제"}
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
            계정 삭제 시 해당 유저는 처음부터 다시 가입해야 하며, 삭제된 데이터는 복구되지 않습니다.
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold text-card-foreground">학생 리포트 상세 조회</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            학생 획득 점수와 강사 총평을 한눈에 확인하세요.
          </p>

          <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
            <Select value={analysisStudentUid} onValueChange={setAnalysisStudentUid}>
              <SelectTrigger className="w-full md:w-[360px]">
                <SelectValue placeholder="분석할 학생 선택" />
              </SelectTrigger>
              <SelectContent>
                {studentCandidates.map((student) => (
                  <SelectItem key={student.uid} value={student.uid}>
                    {formatStudentName(student.name, {
                      phoneSuffix: student.phoneSuffix,
                      studentId: student.studentId,
                    })}{" "}
                    ({student.email || "이메일 없음"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={runAnalysis} disabled={analysisLoading || !analysisStudentUid}>
              {analysisLoading ? "불러오는 중..." : "상세 조회"}
            </Button>
          </div>

          {analysisReports.length > 0 ? (
            <div className="mt-4 space-y-3">
              {analysisReports.map((report, index) => {
                const total = reportTotal(report);
                const round = index + 1;
                const opened = Boolean(openReportIds[report.id]);
                return (
                  <div key={report.id} className="rounded-lg border border-border bg-background p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-card-foreground">
                          {round}회차 - {formatDate(report)}
                        </p>
                        <p className="text-sm text-card-foreground">
                          획득 점수: {total !== null ? `${total}점 / 100점` : "점수 정보 없음"}
                        </p>
                        <p className="text-sm text-card-foreground">
                          강사 총평: {report.feedback?.trim() || "총평 없음"}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => toggleReportOpen(report.id)}>
                        {opened ? "상세 닫기" : "상세 보기"}
                      </Button>
                    </div>

                    {opened && (
                      <div className="mt-3 space-y-2 rounded-md border border-border p-3">
                        <p className="text-xs text-muted-foreground">
                          선생님: {report.reviewer || "미기재"} / 주제: {report.essayTopic || "미기재"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          등급: {report.grade || "미기재"} / 원본 이름: {report.sourceName || "미기재"}
                        </p>
                        <div className="grid gap-2 text-xs text-card-foreground md:grid-cols-2">
                          <p>독해력: {safeNumber(report.scores?.reading) ?? "-"}</p>
                          <p>내용 이해력: {safeNumber(report.scores?.comprehension) ?? "-"}</p>
                          <p>문제 이해력: {safeNumber(report.scores?.problemUnderstanding) ?? "-"}</p>
                          <p>구성력: {safeNumber(report.scores?.organization) ?? "-"}</p>
                          <p>논증/표현력: {safeNumber(report.scores?.expression) ?? "-"}</p>
                        </div>
                        <div className="rounded-md bg-card p-3 text-sm text-card-foreground whitespace-pre-wrap">
                          {report.feedback?.trim() || "상세 첨삭 내용이 없습니다."}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            !analysisLoading && (
              <div className="mt-4 rounded-md border border-border bg-background px-3 py-4 text-sm text-muted-foreground">
                작성된 리포트가 없습니다
              </div>
            )
          )}

          <div className="mt-4 space-y-2">
            {analysisMessages.map((message, index) => (
              <div key={`${message}-${index}`} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
                {message}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm md:p-5">
          <h3 className="text-sm font-semibold text-red-900">계정 관리</h3>
          <p className="mt-1 text-xs text-red-700">
            관리자 계정 탈퇴 시 모든 시스템 제어 권한이 상실되며 복구가 불가능합니다.
          </p>
          <Button
            className="mt-3 w-full"
            variant="destructive"
            onClick={handleWithdrawAdminAccount}
            disabled={withdrawingAdmin}
          >
            {withdrawingAdmin ? "탈퇴 처리 중..." : "회원 탈퇴"}
          </Button>
        </section>
      </div>
    </DashboardLayout>
  );
};

export default MasterAdminPage;
