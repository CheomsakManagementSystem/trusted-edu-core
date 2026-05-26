import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { createUserWithEmailAndPassword, type AuthError } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { Loader2 } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import DashboardLayout from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  MASTER_ADMIN_CODE,
  getMasterControls,
} from "@/services/masterAdminService";
import { type CanonicalRole } from "@/lib/authz";

const Signup = () => {
  const navigate = useNavigate();
  const [customId, setCustomId] = useState("");
  const [name, setName] = useState("");
  const [phoneSuffix, setPhoneSuffix] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [instructorCode, setInstructorCode] = useState("");
  const [masterCode, setMasterCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getSignupErrorMessage = (code?: string) => {
    switch (code) {
      case "auth/invalid-email":
        return "유효하지 않은 이메일 형식입니다.";
      case "auth/weak-password":
        return "비밀번호는 최소 6자 이상이어야 합니다.";
      default:
        return "회원가입 중 오류가 발생했습니다. 정보를 다시 확인해주세요.";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // customId 검증 (ADMIN/INSTRUCTOR는 면제 — masterCode/instructorCode 입력 전이라 role 미확정이므로 학생만 강제)
    const isStaffSignup = masterCode.trim().length > 0 || instructorCode.trim().length > 0;
    if (!isStaffSignup) {
      const idVal = customId.trim().toLowerCase();
      if (!/^[a-z0-9]{6,8}$/.test(idVal)) {
        setError("아이디는 영소문자·숫자 조합 6~8자여야 합니다. (예: dohyun17)");
        return;
      }
    }

    if (!/^\d{4}$/.test(phoneSuffix)) {
      setError("전화번호 뒷자리는 숫자 4자리여야 합니다.");
      return;
    }

    setLoading(true);

    try {
      const controls = await getMasterControls();

      const role: CanonicalRole =
        masterCode.trim() === MASTER_ADMIN_CODE
          ? "ADMIN"
          : instructorCode.trim() === controls.instructorSignupCode
            ? "INSTRUCTOR"
            : "STUDENT";

      const docId = role === "STUDENT" ? customId.trim().toLowerCase() : null;

      // 학생 아이디 중복 확인 (Firestore doc 존재 여부)
      if (docId) {
        const dupSnap = await getDoc(doc(db, "users", docId));
        if (dupSnap.exists()) {
          setError("이미 사용 중인 아이디입니다. 다른 아이디를 선택해주세요.");
          return;
        }
      }

      const credential = await createUserWithEmailAndPassword(auth, email, password);
      const uid = credential.user.uid;

      const studentKey = `${name}_${phoneSuffix}`;

      if (role === "STUDENT" && docId) {
        // 신형: users/{customId} — uid 필드 포함해야 AuthContext가 재조회 가능
        await setDoc(doc(db, "users", docId), {
          uid,
          name,
          email,
          role,
          studentId: docId,   // customId = 학생 고유 ID
          studentKey,
          phoneSuffix,
        });
      } else {
        // 관리자/강사: 기존 방식 users/{uid}
        await setDoc(doc(db, "users", uid), {
          uid,
          name,
          email,
          role,
          studentId: phoneSuffix,
          studentKey,
          phoneSuffix,
        });
      }

      toast.success("가입을 환영합니다!", {
        description: "잠시 후 해당 권한의 대시보드로 이동합니다.",
        duration: 1000,
      });

      await new Promise((resolve) => window.setTimeout(resolve, 1000));

      navigate(
        role === "ADMIN" ? "/admin/master" : role === "INSTRUCTOR" ? "/admin" : "/dashboard",
        { replace: true },
      );
    } catch (err) {
      console.error(err);
      const authError = err as AuthError;

      if (authError.code === "auth/email-already-in-use") {
        const message = "이미 가입된 이메일입니다. 로그인 페이지로 이동하시겠습니까?";
        setError(message);
        toast.error(message, {
          action: {
            label: "로그인",
            onClick: () => navigate("/login"),
          },
          duration: 5000,
        });
        return;
      }

      const message = getSignupErrorMessage(authError.code);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="flex min-h-full items-start justify-center pt-24 pb-12 px-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-card">
          <h2 className="mb-2 text-xl font-bold text-card-foreground">회원가입</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            선생님/학생 정보를 입력하여 계정을 생성하세요.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 학생 고유 아이디 (최상단) */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-card-foreground">
                아이디 (6~8자)
              </label>
              <Input
                value={customId}
                onChange={(e) => setCustomId(e.target.value.toLowerCase())}
                placeholder="dohyun17"
                maxLength={8}
                autoComplete="username"
              />
              <p className="text-xs text-muted-foreground">
                영소문자·숫자 조합, 6~8자. 선생님 코드 입력 시 생략 가능.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-card-foreground">이름</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="홍길동"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-card-foreground">
                전화번호 뒷자리 (4자리)
              </label>
              <Input
                value={phoneSuffix}
                onChange={(e) => setPhoneSuffix(e.target.value)}
                placeholder="1234"
                maxLength={4}
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-card-foreground">이메일</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-card-foreground">비밀번호</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="********"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-card-foreground">
                선생님 비밀코드 (선택)
              </label>
              <Input
                type="password"
                value={instructorCode}
                onChange={(e) => setInstructorCode(e.target.value)}
                placeholder="선생님일 경우에만 입력"
              />
              <p className="text-xs text-muted-foreground">
                관리자 전용 보안 키를 입력하세요
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-card-foreground">
                학원 전체 관리 코드 (선택)
              </label>
              <Input
                type="password"
                value={masterCode}
                onChange={(e) => setMasterCode(e.target.value)}
                placeholder="실장님 전용 코드"
              />
              <p className="text-xs text-muted-foreground">
                정확히 일치할 때만 실장님 권한이 부여됩니다.
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              type="submit"
              className="w-full"
              disabled={loading}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? "회원가입 중..." : "회원가입"}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            이미 계정이 있나요?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              로그인
            </Link>
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Signup;
