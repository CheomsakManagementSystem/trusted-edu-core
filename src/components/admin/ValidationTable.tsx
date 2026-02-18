import type { SyncResult } from "@/types";
import { MatchStatusBadge } from "@/components/admin/MatchStatusBadge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ValidationTableProps {
  results: SyncResult[];
}

const ValidationTable = ({ results }: ValidationTableProps) => {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-50">
            스캔 결과 검수 테이블
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            파일명 파싱 결과와 학생 매칭 상태를 확인한 후 최종 Commit을 실행하세요.
          </p>
        </div>
        <span className="text-xs text-slate-400">
          총 {results.length}건
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-800">
        <ScrollArea className="max-h-[320px]">
          <table className="min-w-full divide-y divide-slate-800 text-xs">
            <thead className="bg-slate-950">
              <tr>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-slate-400">
                  파일명
                </th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-slate-400">
                  파싱 결과
                </th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-slate-400">
                  매칭 학생
                </th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-slate-400">
                  상태
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-900/60">
              {results.map((r) => (
                <tr key={r.file.id}>
                  <td className="max-w-xs truncate px-3 py-2 text-slate-100">
                    {r.file.name}
                  </td>
                  <td className="px-3 py-2 text-slate-300">
                    {r.parsed ? (
                      <span>
                        {r.parsed.studentName} / {r.parsed.phoneSuffix} /{" "}
                        <span className="font-mono">{r.parsed.score}점</span>
                      </span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-300">
                    {r.student ? (
                      <span>
                        {r.student.name}{" "}
                        <span className="text-slate-500">
                          ({r.student.email})
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-500">매칭 안됨</span>
                    )}
                    {r.reason && (
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {r.reason}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <MatchStatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
              {results.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-6 text-center text-slate-500"
                  >
                    아직 스캔 결과가 없습니다. 상단에서 폴더 ID를 입력하고 스캔을
                    실행해 주세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollArea>
      </div>
    </div>
  );
};

export default ValidationTable;

