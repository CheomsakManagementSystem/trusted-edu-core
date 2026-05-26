import { useState } from "react";
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { Loader2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const CUSTOM_ID_REGEX = /^[a-z0-9]{6,8}$/;

/**
 * 레거시 유저(users/{uid}) → users/{customId} 원자적 이사 모달.
 * 대시보드 진입을 막고 강제 렌더링. 닫기 불가.
 */
const MigrationModal = () => {
  const { user } = useAuth();
  const [customId, setCustomId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!user?.needsMigration) return null;

  const validate = (value: string): string | null => {
    if (!value) return "아이디를 입력해주세요.";
    if (!CUSTOM_ID_REGEX.test(value))
      return "영소문자·숫자만, 6~8자로 입력해주세요. (예: dohyun17)";
    return null;
  };

  const handleSubmit = async () => {
    const id = customId.trim().toLowerCase();
    const validationError = validate(id);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 중복 확인
      const newRef = doc(db, "users", id);
      const dupSnap = await getDoc(newRef);
      if (dupSnap.exists()) {
        setError("이미 사용 중인 아이디입니다. 다른 아이디를 선택해주세요.");
        return;
      }

      // 기존 문서 읽기
      const oldRef = doc(db, "users", user.uid);
      const oldSnap = await getDoc(oldRef);
      if (!oldSnap.exists()) {
        setError("기존 계정 정보를 찾을 수 없습니다. 페이지를 새로고침해주세요.");
        return;
      }
      const oldData = oldSnap.data() as Record<string, unknown>;

      // 원자적 이사 (writeBatch)
      const batch = writeBatch(db);
      batch.set(newRef, {
        ...oldData,
        studentId: id,       // 새 customId를 studentId로 확정
        uid: user.uid,        // Firebase Auth UID 보존 (AuthContext 재조회용)
        updatedAt: serverTimestamp(),
      });
      batch.delete(oldRef);   // 구형 users/{uid} 문서 삭제

      await batch.commit();

      // AuthContext가 onSnapshot 삭제 이벤트를 감지하고 재구독함.
      // 안전하게 리로드해서 상태를 완전히 초기화.
      window.location.reload();
    } catch (err) {
      console.error("Migration failed:", err);
      setError(
        err instanceof Error ? err.message : "아이디 설정 중 오류가 발생했습니다. 다시 시도해주세요.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open modal>
      {/* 닫기(X) 버튼 숨김 → 강제 진행 */}
      <DialogContent
        className="sm:max-w-md [&>button:last-child]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>아이디 설정이 필요합니다</DialogTitle>
          <DialogDescription>
            새 시스템 전환에 따라 <strong>6~8자리 고유 아이디</strong>를 한 번만 설정합니다.
            영소문자·숫자 조합으로 입력하세요. (예: dohyun17)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-card-foreground">아이디 (6~8자)</label>
            <Input
              value={customId}
              onChange={(e) => {
                setCustomId(e.target.value.toLowerCase());
                setError(null);
              }}
              placeholder="dohyun17"
              maxLength={8}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading) handleSubmit();
              }}
            />
            <p className="text-xs text-muted-foreground">영소문자(a-z)와 숫자(0-9)만 사용 가능</p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button className="w-full" onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "설정 중..." : "아이디 확정하기"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MigrationModal;
