import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import WithdrawalDialog from "@/components/WithdrawalDialog";
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
import {
  compareReportsByExamDateDesc,
  fetchReportsByStudentUid,
  formatExamDate,
  getReportExamTitle,
  type ReportRecord,
} from "@/lib/pdfProcessor";
import { normalizeRole } from "@/lib/authz";
import {
  clearClientSession,
  deleteCurrentUserAccount,
  getAccountDeletionErrorMessage,
} from "@/services/accountDeletionService";
import {
  cascadeUpdateStudentId,
  deleteManagedUserCompletely,
  fetchManagedUserCount,
  fetchManagedUsers,
  fetchManagedUsersPage,
  getMasterControls,
  notifyDuplicatePhoneSuffixUsers,
  saveMasterControls,
  updateManagedUserRole,
  type ManagedUserCursor,
  type ManagedUser,
} from "@/services/masterAdminService";
import { Search } from "lucide-react";
import {
  startPerformanceTrace,
  stopPerformanceTraceAfterPaint,
} from "@/lib/performanceMonitoring";

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

const avg = (rows: number[]) => {
  if (!rows.length) {
    return null;
  }
  return rows.reduce((sum, value) => sum + value, 0) / rows.length;
};

const formatDate = (report: ReportRecord): string => {
  return formatExamDate(report.examDate);
};

const navyScrollbarClass =
  "scrollbar-thin [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-slate-100 [&::-webkit-scrollbar-thumb]:bg-slate-900/65 hover:[&::-webkit-scrollbar-thumb]:bg-slate-900/80";
const USER_PAGE_SIZE = 50;

const MasterAdminPage = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [savingControls, setSavingControls] = useState(false);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [allUsersForSearch, setAllUsersForSearch] = useState<ManagedUser[] | null>(null);
  const [searchUsersLoading, setSearchUsersLoading] = useState(false);
  const [userCount, setUserCount] = useState(0);
  const [userHasNextPage, setUserHasNextPage] = useState(false);
  const [userNextCursor, setUserNextCursor] = useState<ManagedUserCursor | null>(null);
  const [userPageCursors, setUserPageCursors] = useState<Array<ManagedUserCursor | null>>([null]);
  const searchUsersRequestRef = useRef(false);
  const [search, setSearch] = useState("");
  const [userPage, setUserPage] = useState(1);
  const userSearchMeasurementRef = useRef<ReturnType<typeof startPerformanceTrace> | null>(null);
  const [instructorSignupCode, setInstructorSignupCode] = useState("");
  const [autoNotifyOnFeedbackComplete, setAutoNotifyOnFeedbackComplete] = useState(true);
  const [roleUpdatingUid, setRoleUpdatingUid] = useState<string | null>(null);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);
  const [withdrawingAdmin, setWithdrawingAdmin] = useState(false);
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [withdrawPassword, setWithdrawPassword] = useState("");
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const [editingPhoneUid, setEditingPhoneUid] = useState<string | null>(null);
  const [editingPhoneValue, setEditingPhoneValue] = useState("");
  const [savingPhoneUid, setSavingPhoneUid] = useState<string | null>(null);

  const [notifyingDuplicates, setNotifyingDuplicates] = useState(false);

  const handleNotifyDuplicates = async () => {
    if (!user?.uid) return;
    if (!window.confirm("중복 학생 ID 보유 유저에게 인앱 알림을 발송합니다. 계속하시겠습니까?")) return;
    setNotifyingDuplicates(true);
    const measurement = startPerformanceTrace("master_duplicate_notification_batch");
    try {
      const { notified, skipped } = await notifyDuplicatePhoneSuffixUsers(user.uid);
      measurement.stop({ status: "success", metrics: { notified_count: notified, skipped_count: skipped } });
      toast({ title: `발송 완료: ${notified}명 / 이미 발송됨: ${skipped}명` });
    } catch (err) {
      measurement.stop({ status: "error" });
      toast({
        variant: "destructive",
        title: "발송 실패",
        description: err instanceof Error ? err.message : "오류가 발생했습니다.",
      });
    } finally {
      setNotifyingDuplicates(false);
    }
  };

  const [analysisStudentUid, setAnalysisStudentUid] = useState("");
  const [analysisQuery, setAnalysisQuery] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisReports, setAnalysisReports] = useState<ReportRecord[]>([]);
  const [analysisMessages, setAnalysisMessages] = useState<string[]>([]);
  const [openReportIds, setOpenReportIds] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    const measurement = startPerformanceTrace("master_admin_load");
    try {
      const [controls, userPageResult, totalCount] = await Promise.all([
        getMasterControls(),
        fetchManagedUsersPage(null, USER_PAGE_SIZE),
        fetchManagedUserCount(),
      ]);
      setInstructorSignupCode(controls.instructorSignupCode);
      setAutoNotifyOnFeedbackComplete(controls.autoNotifyOnFeedbackComplete);
      setUsers(userPageResult.users);
      setUserCount(totalCount);
      setUserHasNextPage(userPageResult.hasNextPage);
      setUserNextCursor(userPageResult.nextCursor);
      setUserPage(1);
      setUserPageCursors([null]);
      setAllUsersForSearch(null);
      stopPerformanceTraceAfterPaint(measurement, {
        status: "success",
        metrics: { user_count: totalCount, rendered_count: userPageResult.users.length },
      });
    } catch (error) {
      measurement.stop({ status: "error" });
      toast({
        variant: "destructive",
        title: "초기 데이터 로드 실패",
        description: error instanceof Error ? error.message : "데이터를 불러오지 못했습니다.",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const deferredSearch = useDeferredValue(search);
  const isUserSearchActive = deferredSearch.trim().length > 0;

  useEffect(() => {
    const needsAllUsers = isUserSearchActive || analysisQuery.trim().length > 0;
    if (!needsAllUsers || allUsersForSearch || searchUsersRequestRef.current) return;

    searchUsersRequestRef.current = true;
    setSearchUsersLoading(true);
    void fetchManagedUsers()
      .then(setAllUsersForSearch)
      .catch((error) => {
        toast({
          variant: "destructive",
          title: "사용자 검색 준비 실패",
          description: error instanceof Error ? error.message : "사용자 목록을 불러오지 못했습니다.",
        });
      })
      .finally(() => {
        searchUsersRequestRef.current = false;
        setSearchUsersLoading(false);
      });
  }, [allUsersForSearch, analysisQuery, isUserSearchActive, toast]);

  const filteredUsers = useMemo(() => {
    const keyword = deferredSearch.trim().toLowerCase();
    if (!keyword) {
      return users;
    }

    return (allUsersForSearch ?? []).filter((row) => {
      const target = `${row.name} ${row.email} ${row.studentId || ""} ${row.uid}`.toLowerCase();
      return target.includes(keyword);
    });
  }, [allUsersForSearch, deferredSearch, users]);
  const userPageCount = Math.max(1, Math.ceil(
    (isUserSearchActive ? filteredUsers.length : userCount) / USER_PAGE_SIZE,
  ));
  const safeUserPage = Math.min(userPage, userPageCount);
  const visibleUsers = useMemo(() => {
    if (!isUserSearchActive) return users;
    const start = (safeUserPage - 1) * USER_PAGE_SIZE;
    return filteredUsers.slice(start, start + USER_PAGE_SIZE);
  }, [filteredUsers, isUserSearchActive, safeUserPage, users]);

  const beginUserSearchMeasurement = (trigger: "keyword" | "page") => {
    userSearchMeasurementRef.current?.stop({ status: "cancelled" });
    userSearchMeasurementRef.current = startPerformanceTrace("master_admin_search", { trigger });
  };

  const handleUserSearchChange = (value: string) => {
    beginUserSearchMeasurement("keyword");
    setSearch(value);
    setUserPage(1);
  };

  const handleUserPageChange = async (page: number) => {
    beginUserSearchMeasurement("page");
    if (isUserSearchActive) {
      setUserPage(page);
      return;
    }

    const cursor = page > userPage
      ? userNextCursor
      : userPageCursors[page - 1] ?? null;
    if (page > userPage && !cursor) return;

    setLoading(true);
    try {
      const result = await fetchManagedUsersPage(cursor, USER_PAGE_SIZE);
      if (page > userPage && cursor) {
        setUserPageCursors((prev) => {
          const next = prev.slice(0, userPage);
          next[userPage] = cursor;
          return next;
        });
      }
      setUsers(result.users);
      setUserHasNextPage(result.hasNextPage);
      setUserNextCursor(result.nextCursor);
      setUserPage(page);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "사용자 페이지 조회 실패",
        description: error instanceof Error ? error.message : "사용자 목록을 불러오지 못했습니다.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const measurement = userSearchMeasurementRef.current;
    if (!measurement || search !== deferredSearch || (isUserSearchActive && searchUsersLoading)) return;

    stopPerformanceTraceAfterPaint(measurement, {
      status: "success",
      metrics: {
        query_length: deferredSearch.trim().length,
        result_count: filteredUsers.length,
        rendered_count: visibleUsers.length,
        total_count: userCount,
      },
    });
    userSearchMeasurementRef.current = null;
  }, [deferredSearch, filteredUsers.length, isUserSearchActive, search, searchUsersLoading, userCount, visibleUsers.length]);

  useEffect(
    () => () => userSearchMeasurementRef.current?.stop({ status: "cancelled" }),
    [],
  );

  const studentCandidates = useMemo(
    () => (allUsersForSearch ?? (analysisQuery.trim() ? [] : users))
      .filter((row) => normalizeRole(row.role) === "STUDENT"),
    [allUsersForSearch, analysisQuery, users],
  );

  const filteredStudentCandidates = useMemo(() => {
    const keyword = analysisQuery.trim().toLowerCase();
    if (!keyword) {
      return [];
    }

    return studentCandidates
      .filter((row) => {
        const target = `${row.name} ${row.email} ${row.phoneSuffix ?? ""}`.toLowerCase();
        return target.includes(keyword);
      })
      .slice(0, 12);
  }, [analysisQuery, studentCandidates]);

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
      setAllUsersForSearch((prev) =>
        prev?.map((row) => (row.uid === target.uid ? { ...row, role: nextRole } : row)) ?? null,
      );
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
      setAllUsersForSearch((prev) => prev?.filter((row) => row.uid !== target.uid) ?? null);
      setUserCount((count) => Math.max(0, count - 1));
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

  const runAnalysis = async (targetStudentUid = analysisStudentUid) => {
    if (!targetStudentUid) {
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
      const reports = await fetchReportsByStudentUid(targetStudentUid);
      const sorted = [...reports].sort(compareReportsByExamDateDesc);
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

      const latest = sorted[0];
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

  const handleSavePhone = async (uid: string) => {
    const target = users.find((row) => row.uid === uid)
      ?? allUsersForSearch?.find((row) => row.uid === uid);
    if (!target) return;

    const oldStudentId = target.studentId ?? target.phoneSuffix ?? "";
    const newStudentId = editingPhoneValue.trim();

    setSavingPhoneUid(uid);
    try {
      const updatedCount = await cascadeUpdateStudentId(uid, oldStudentId, newStudentId);
      const normalized = newStudentId || null;
      setUsers((prev) =>
        prev.map((row) =>
          row.uid === uid ? { ...row, phoneSuffix: normalized, studentId: normalized } : row,
        ),
      );
      setAllUsersForSearch((prev) =>
        prev?.map((row) =>
          row.uid === uid ? { ...row, phoneSuffix: normalized, studentId: normalized } : row,
        ) ?? null,
      );
      toast({
        title: "전화번호 수정 완료",
        description:
          updatedCount > 0
            ? `저장되었습니다. 연동된 리포트 ${updatedCount}개도 함께 업데이트했습니다.`
            : "변경 사항이 저장되었습니다.",
      });
      setEditingPhoneUid(null);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "수정 실패",
        description: error instanceof Error ? error.message : "저장하지 못했습니다.",
      });
    } finally {
      setSavingPhoneUid(null);
    }
  };

  const handleSelectAnalysisStudent = (student: ManagedUser) => {
    setAnalysisStudentUid(student.uid);
    setAnalysisQuery(`${student.name} ${student.phoneSuffix ?? student.email ?? ""}`.trim());
    runAnalysis(student.uid);
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

    setWithdrawPassword("");
    setWithdrawError(null);
    setWithdrawDialogOpen(true);
  };

  const confirmWithdrawAdminAccount = async () => {
    setWithdrawingAdmin(true);
    setWithdrawError(null);

    try {
      await deleteCurrentUserAccount(withdrawPassword);
      toast({
        title: "회원 탈퇴 완료",
        description: "관리자 계정이 삭제되었습니다.",
      });
      setWithdrawDialogOpen(false);
      await clearClientSession(signOut);
      window.location.replace("/");
    } catch (error) {
      const message = getAccountDeletionErrorMessage(error);
      setWithdrawError(message);
      toast({
        variant: "destructive",
        title: "회원 탈퇴 실패",
        description: message,
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

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={saveControls} disabled={savingControls || loading}>
              {savingControls ? "저장 중..." : "설정 완료"}
            </Button>
            <p className="text-xs text-muted-foreground">
              저장 즉시 가입 코드와 알림 기능에 적용됩니다.
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold text-card-foreground">중복 학생 ID 알림 발송</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            전체 회원 중 동일한 4자리 ID를 사용하는 유저에게 변경 안내 인앱 알림을 일괄 발송합니다.
            이미 발송된 유저는 자동으로 건너뜁니다.
          </p>
          <Button
            className="mt-4"
            variant="destructive"
            disabled={notifyingDuplicates}
            onClick={handleNotifyDuplicates}
          >
            {notifyingDuplicates ? "발송 중..." : "중복 ID 유저 알림 발송"}
          </Button>
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
                onChange={(event) => handleUserSearchChange(event.target.value)}
                placeholder="이름/이메일/학생ID 검색"
                className="w-64"
              />
              <Button variant="outline" onClick={loadData} disabled={loading}>
                새로고침
              </Button>
            </div>
          </div>

          <div className={`relative mt-4 max-h-[580px] overflow-auto pr-1 ${navyScrollbarClass}`}>
            <table className="w-full min-w-[760px] divide-y divide-border text-sm">
              <thead>
                <tr className="sticky top-0 z-10 bg-card">
                  <th className="px-3 py-2 text-left text-muted-foreground">이름</th>
                  <th className="px-3 py-2 text-left text-muted-foreground">이메일</th>
                  <th className="px-3 py-2 text-left text-muted-foreground">학생ID</th>
                  <th className="px-3 py-2 text-left text-muted-foreground">전화번호 뒷자리</th>
                  <th className="px-3 py-2 text-left text-muted-foreground">권한</th>
                  <th className="px-3 py-2 text-left text-muted-foreground">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleUsers.map((row) => (
                  <tr key={row.uid}>
                    <td className="px-3 py-2 text-card-foreground">{row.name}</td>
                    <td className="px-3 py-2 text-card-foreground">{row.email || "-"}</td>
                    <td className="px-3 py-2 text-card-foreground">{row.studentId || "-"}</td>
                    <td className="px-3 py-2">
                      {editingPhoneUid === row.uid ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={editingPhoneValue}
                            onChange={(e) => setEditingPhoneValue(e.target.value)}
                            placeholder="뒷자리 4자리"
                            className="h-7 w-24 text-xs"
                            maxLength={8}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSavePhone(row.uid);
                              if (e.key === "Escape") setEditingPhoneUid(null);
                            }}
                            autoFocus
                          />
                          <Button
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={savingPhoneUid === row.uid}
                            onClick={() => handleSavePhone(row.uid)}
                          >
                            저장
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => setEditingPhoneUid(null)}
                          >
                            취소
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="text-card-foreground">{row.phoneSuffix || "-"}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1 text-xs text-muted-foreground"
                            onClick={() => {
                              setEditingPhoneUid(row.uid);
                              setEditingPhoneValue(row.phoneSuffix ?? "");
                            }}
                          >
                            수정
                          </Button>
                        </div>
                      )}
                    </td>
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
                          <SelectContent className="z-[80]">
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

                {isUserSearchActive && searchUsersLoading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-5 text-center text-muted-foreground">
                      검색용 사용자 목록을 불러오는 중입니다...
                    </td>
                  </tr>
                )}

                {!searchUsersLoading && visibleUsers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-5 text-center text-muted-foreground">
                      검색 결과가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {userPageCount > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2">
              <span className="text-xs text-muted-foreground">
                {safeUserPage} / {userPageCount}페이지
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={safeUserPage <= 1}
                onClick={() => handleUserPageChange(safeUserPage - 1)}
              >
                이전
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isUserSearchActive
                  ? safeUserPage >= userPageCount
                  : !userHasNextPage}
                onClick={() => handleUserPageChange(safeUserPage + 1)}
              >
                다음
              </Button>
            </div>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            계정 삭제 시 해당 유저는 처음부터 다시 가입해야 하며, 삭제된 데이터는 복구되지 않습니다.
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold text-card-foreground">학생 리포트 상세 조회</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            학생 획득 점수와 강사 총평을 한눈에 확인하세요.
          </p>

          <div className="sticky top-0 z-20 mt-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                value={analysisQuery}
                onChange={(event) => setAnalysisQuery(event.target.value)}
                placeholder="이름, 전화번호 뒤 4자리, 이메일로 학생 검색"
                className="h-11 rounded-xl border-slate-200 bg-slate-50 pl-9 text-slate-900 placeholder:text-slate-500"
              />
            </div>
            <div className={`mt-3 max-h-[280px] space-y-2 overflow-y-auto pr-1 ${navyScrollbarClass}`}>
              {analysisQuery.trim().length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
                  이름, 전화번호 뒤 4자리, 이메일 중 하나를 입력하면 학생 목록이 실시간으로 표시됩니다.
                </p>
              )}
              {analysisQuery.trim().length > 0 && searchUsersLoading && (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
                  학생 검색 목록을 불러오는 중입니다...
                </p>
              )}
              {analysisQuery.trim().length > 0 && !searchUsersLoading && filteredStudentCandidates.length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
                  검색 결과가 없습니다.
                </p>
              )}
              {filteredStudentCandidates.map((student) => (
                <button
                  key={student.uid}
                  type="button"
                  onClick={() => handleSelectAnalysisStudent(student)}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                    analysisStudentUid === student.uid
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-900 hover:border-slate-300 hover:bg-white"
                  }`}
                >
                  <span className="text-sm font-semibold">
                    {student.name} ({student.phoneSuffix || "번호 없음"})
                  </span>
                  <span className={`text-xs ${analysisStudentUid === student.uid ? "text-slate-200" : "text-slate-500"}`}>
                    {student.email || "이메일 없음"}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <Button onClick={() => runAnalysis()} disabled={analysisLoading || !analysisStudentUid}>
                {analysisLoading ? "불러오는 중..." : "선택 학생 조회"}
              </Button>
            </div>
          </div>

          {analysisReports.length > 0 ? (
            <div className="mt-4 space-y-3">
              {analysisReports.map((report, index) => {
                const total = reportTotal(report);
                const opened = Boolean(openReportIds[report.id]);
                return (
                  <div key={report.id} className="rounded-lg border border-border bg-background p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-card-foreground">
                          {getReportExamTitle(report)}
                        </p>
                        <p className="text-sm text-card-foreground">
                          획득 점수: {total !== null ? `${total}점 / 100점` : "점수 정보 없음"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          시험일: {formatDate(report)}
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

      <WithdrawalDialog
        open={withdrawDialogOpen}
        onOpenChange={setWithdrawDialogOpen}
        password={withdrawPassword}
        onPasswordChange={setWithdrawPassword}
        onConfirm={confirmWithdrawAdminAccount}
        loading={withdrawingAdmin}
        error={withdrawError}
        description="보안을 위해 현재 비밀번호를 다시 입력해 주세요. 탈퇴 후에는 관리자 권한과 계정 정보가 즉시 영구 삭제됩니다."
      />
    </DashboardLayout>
  );
};

export default MasterAdminPage;
