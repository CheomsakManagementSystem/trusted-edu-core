import { memo, useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { Loader2, X } from "lucide-react";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [customId, setCustomId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const validate = useCallback((value: string): string | null => {
    if (!value) return "아이디를 입력해주세요.";
    if (!CUSTOM_ID_REGEX.test(value))
      return "영소문자·숫자만, 6~8자로 입력해주세요. (예: dohyun17)";
    return null;
  }, []);

  const checkIdDuplication = async (rawInput: string) => {
    const normalizedId = rawInput.replace(/\s+/g, "").toLowerCase();

    console.log("[Audit] 입력된 원본 값:", rawInput);
    console.log("[Audit] 정규화 후 쿼리 대상 값:", normalizedId);

    if (!normalizedId || normalizedId.length < 6 || !CUSTOM_ID_REGEX.test(normalizedId)) {
      console.error("[Audit] 유효하지 않은 아이디 입력으로 인해 Firestore 쿼리 차단:", normalizedId);
      return false;
    }

    const loginIdQuery = query(collection(db, "users"), where("loginId", "==", normalizedId));
    const querySnapshot = await getDocs(loginIdQuery);

    console.log("[Audit] Firestore loginId 조회 결과 문서 개수:", querySnapshot.size);
    querySnapshot.forEach((docSnap) => {
      console.log("[Audit] 중복 검출된 유저 UID 및 데이터:", docSnap.id, docSnap.data());
    });

    if (!querySnapshot.empty) return true;

    const docSnapshot = await getDoc(doc(db, "users", normalizedId));
    console.log("[Audit] Firestore users/{normalizedId} 문서 존재 여부:", docSnapshot.exists());
    return docSnapshot.exists();
  };

  const handleSubmit = async (rawInput: string) => {
    if (dismissed || !user) return;

    const id = rawInput.replace(/\s+/g, "").toLowerCase();
    const validationError = validate(id);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 중복 확인
      const isDuplicated = await checkIdDuplication(rawInput);
      console.log("[Audit] 최종 중복 판정:", isDuplicated);
      if (isDuplicated) {
        setError("이미 사용 중인 아이디입니다. 다른 아이디를 선택해주세요.");
        return;
      }

      const oldRef = doc(db, "users", user.uid);
      const oldSnap = await getDoc(oldRef);
      if (!oldSnap.exists()) {
        setError("기존 계정 정보를 찾을 수 없습니다. 페이지를 새로고침해주세요.");
        return;
      }
      const oldData = oldSnap.data() as { classIds?: unknown };
      const existingClassIds = Array.isArray(oldData.classIds)
        ? oldData.classIds.filter((classId): classId is string => typeof classId === "string")
        : [];
      const memberSnap = await getDocs(
        query(collection(db, "class_members"), where("uid", "==", user.uid)),
      );
      const memberClassIds = memberSnap.docs
        .map((memberDoc) => memberDoc.data().classId)
        .filter((classId): classId is string => typeof classId === "string");
      const classIds = Array.from(new Set([...existingClassIds, ...memberClassIds]));

      const batch = writeBatch(db);
      batch.set(oldRef, {
        studentId: id,
        loginId: id,
        uid: user.uid,
        classIds,
        needsMigration: false,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      await batch.commit();
      const verifiedSnap = await getDoc(oldRef);
      if (verifiedSnap.data()?.needsMigration === true) {
        setError("아이디 설정 상태 확인에 실패했습니다. 다시 시도해주세요.");
        return;
      }
      handleClose();
    } catch (err) {
      console.error("[Audit] 아이디 설정 또는 중복 체크 실패:", err);
      setError(
        err instanceof Error ? err.message : "아이디 설정 중 오류가 발생했습니다. 다시 시도해주세요.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleClose = useCallback(() => {
    if (dismissed) return;

    try {
      flushSync(() => {
        setDismissed(true);
      });

      window.setTimeout(() => {
        setLoading(false);
        setError(null);
      }, 0);
    } catch (error) {
      console.error("Modal close error:", error);

      try {
        flushSync(() => {
          setDismissed(true);
        });
      } catch {
        setDismissed(true);
      }

      window.setTimeout(() => {
        setLoading(false);
        setError(null);
      }, 0);
    }
  }, [dismissed]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) handleClose();
    },
    [handleClose],
  );

  if (!user || !user.needsMigration || dismissed) return null;

  return (
    <Dialog open={!dismissed} onOpenChange={handleOpenChange} modal>
      <DialogContent
        className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-md translate-x-[-50%] translate-y-[-50%] gap-4 border border-zinc-800 bg-zinc-950 p-6 text-zinc-50 shadow-lg duration-200 sm:rounded-lg [&>button:last-child]:hidden"
      >
        <button
          type="button"
          aria-label="닫기"
          className="absolute right-4 top-4 rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          onClick={handleClose}
        >
          <X className="h-4 w-4" />
        </button>

        <DialogHeader>
          <DialogTitle className="text-white">아이디 설정이 필요합니다</DialogTitle>
          <DialogDescription className="text-zinc-300">
            새 시스템 전환에 따라 <strong>6~8자리 고유 아이디</strong>를 한 번만 설정합니다.
            영소문자·숫자 조합으로 입력하세요. (예: dohyun17)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-card-foreground">아이디 (6~8자)</label>
            <Input
              ref={inputRef}
              className="flex h-10 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-black placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
              value={customId}
              onChange={(e) => {
                setCustomId(e.target.value.replace(/\s+/g, "").toLowerCase());
                setError(null);
              }}
              placeholder="아이디를 입력하세요"
              maxLength={8}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading) handleSubmit(e.currentTarget.value);
              }}
            />
            <p className="text-xs text-muted-foreground">영소문자(a-z)와 숫자(0-9)만 사용 가능</p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            className="w-full"
            onClick={() => handleSubmit(inputRef.current?.value ?? customId)}
            disabled={loading}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "설정 중..." : "아이디 확정하기"}
          </Button>

          <Button
            type="button"
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={handleClose}
          >
            나중에 하기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default memo(MigrationModal);
