import { useDriveSync } from "@/hooks/useDriveSync";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CloudSync, Play, Database } from "lucide-react";

const SyncControlCard = () => {
  const {
    folderId,
    setFolderId,
    phase,
    error,
    summary,
    createdCount,
    scan,
    commit,
  } = useDriveSync();

  const isScanning = phase === "scanning";
  const isSaving = phase === "saving";

  const progressValue =
    phase === "idle"
      ? 0
      : phase === "scanning"
      ? 40
      : phase === "ready"
      ? 70
      : phase === "saving"
      ? 90
      : 0;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
            <CloudSync className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-50">
              구글 드라이브 동기화 컨트롤
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              폴더 ID를 등록하고 스캔을 실행하여 파일명 기반으로 학생/점수를
              자동 매칭합니다.
            </p>
          </div>
        </div>
        <div className="hidden text-right text-xs text-slate-400 md:block">
          <p>규칙: <code className="rounded bg-slate-800 px-1 py-0.5">이름(한글)+전화4자리_점수점</code></p>
          <p className="mt-0.5">예: <span className="font-mono">홍길동1234_87점.pdf</span></p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)] md:items-center">
        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-300">
            드라이브 폴더 ID
          </label>
          <Input
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
            placeholder="예: 1AbCdEfGhIjKlMnOpQrStUvWxYz"
            className="border-slate-700 bg-slate-950 text-slate-50 placeholder:text-slate-600"
          />
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="bg-sky-500 text-slate-950 hover:bg-sky-400"
              disabled={!folderId || isScanning || isSaving}
              onClick={scan}
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              스캔 시작
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-emerald-500/40 bg-slate-950 text-emerald-300 hover:bg-emerald-500/10"
              disabled={!summary.total || isScanning || isSaving}
              onClick={commit}
            >
              <Database className="mr-1.5 h-3.5 w-3.5" />
              최종 Commit
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>
              진행 상태:{" "}
              <span className="font-medium text-slate-100">
                {phase === "idle" && "대기 중"}
                {phase === "scanning" && "스캔 중"}
                {phase === "ready" && "검수 대기"}
                {phase === "saving" && "DB 저장 중"}
                {phase === "error" && "오류 발생"}
              </span>
            </span>
            {summary.total > 0 && (
              <span>
                총 {summary.total}건 중{" "}
                <span className="text-emerald-300">{summary.matched}</span>건
                매칭
              </span>
            )}
          </div>
          <Progress value={progressValue} className="h-2 bg-slate-800" />
          {createdCount > 0 && (
            <p className="text-xs text-emerald-300">
              최근 Commit에서 {createdCount}건의 제출 기록이 생성/업데이트
              되었습니다.
            </p>
          )}
          {error && (
            <p className="text-xs text-rose-300">
              오류: {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default SyncControlCard;

