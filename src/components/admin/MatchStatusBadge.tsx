import { SyncStatus } from "@/types";
import { cn } from "@/lib/utils";

interface MatchStatusBadgeProps {
  status: SyncStatus;
}

const labels: Record<SyncStatus, string> = {
  matched: "매칭 완료",
  no_student: "학생 없음",
  parse_error: "파싱 오류",
};

export const MatchStatusBadge = ({ status }: MatchStatusBadgeProps) => {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        status === "matched" && "bg-emerald-500/10 text-emerald-300",
        status === "no_student" && "bg-amber-500/10 text-amber-300",
        status === "parse_error" && "bg-rose-500/10 text-rose-300"
      )}
    >
      {labels[status]}
    </span>
  );
};

