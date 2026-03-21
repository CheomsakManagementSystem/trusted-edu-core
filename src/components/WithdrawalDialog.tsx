import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type WithdrawalDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  onConfirm: () => void;
  loading: boolean;
  error?: string | null;
  title?: string;
  description?: string;
  confirmLabel?: string;
};

const WithdrawalDialog = ({
  open,
  onOpenChange,
  password,
  onPasswordChange,
  onConfirm,
  loading,
  error,
  title = "회원 탈퇴 확인",
  description = "보안을 위해 현재 비밀번호를 다시 입력해 주세요. 탈퇴 후에는 계정과 연결 정보가 복구되지 않습니다.",
  confirmLabel = "탈퇴하기",
}: WithdrawalDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">현재 비밀번호</label>
          <Input
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder="현재 비밀번호를 입력하세요"
            autoComplete="current-password"
            disabled={loading}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onConfirm();
              }
            }}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            취소
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "처리 중..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default WithdrawalDialog;
