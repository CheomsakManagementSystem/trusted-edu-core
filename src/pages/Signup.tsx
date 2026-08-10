import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  type User,
} from "firebase/auth";
import { Loader2 } from "lucide-react";
import { auth } from "@/lib/firebase";
import DashboardLayout from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import type { CanonicalRole } from "@/lib/authz";
import {
  completeSignupProfile,
  fetchCompletedSignupRole,
  getSignupServiceErrorCode,
} from "@/services/signupService";

const Signup = () => {
  const navigate = useNavigate();
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
      case "functions/already-exists":
        return "이미 사용 중인 4자리 ID입니다. 다른 숫자로 변경해 주세요.";
      case "functions/unauthenticated":
        return "회원가입 인증 상태를 확인할 수 없습니다. 다시 시도해주세요.";
      case "functions/not-found":
        return "회원가입 서버 기능을 찾을 수 없습니다. 관리자에게 문의해주세요.";
      case "functions/internal":
      case "functions/unavailable":
      case "functions/deadline-exceeded":
        return "회원가입 서버 연결이 원활하지 않습니다. 잠시 후 다시 시도해주세요.";
      default:
        return "회원가입 중 오류가 발생했습니다. 정보를 다시 확인해주세요.";
    }
  };

  const finishSignup = async (role: CanonicalRole) => {
    toast.success("가입을 환영합니다!", {
      description: "잠시 후 해당 권한의 대시보드로 이동합니다.",
      duration: 1000,
    });

    await new Promise((resolve) => window.setTimeout(resolve, 1000));

    navigate(
      role === "ADMIN" ? "/admin/master" : role === "INSTRUCTOR" ? "/admin" : "/dashboard",
      { replace: true },
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!/^\d{4}$/.test(phoneSuffix)) {
      setError("학생 ID는 숫자 4자리여야 합니다.");
      return;
    }

    setLoading(true);
    let createdUser: User | null = null;
    let profileCompleted = false;

    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      createdUser = credential.user;

      const role = await completeSignupProfile({
        name,
        email,
        phoneSuffix,
        instructorCode,
        masterCode,
      });
      profileCompleted = true;

      await finishSignup(role);
    } catch (err) {
      console.error(err);

      if (createdUser && !profileCompleted) {
        let recoveredRole: CanonicalRole | null | undefined;
        try {
          recoveredRole = await fetchCompletedSignupRole(createdUser.uid);
        } catch (recoveryError) {
          recoveredRole = undefined;
          console.error("Failed to verify signup completion", recoveryError);
        }

        if (recoveredRole) {
          await finishSignup(recoveredRole);
          return;
        }

        if (recoveredRole === null) {
          try {
            await deleteUser(createdUser);
          } catch (cleanupError) {
            console.error("Failed to clean up incomplete signup auth user", cleanupError);
          }
        }
      }

      const code = getSignupServiceErrorCode(err);

      if (code === "auth/email-already-in-use") {
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

      const message =
        createdUser && !profileCompleted && auth.currentUser?.uid === createdUser.uid
          ? "회원가입 처리 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요."
          : getSignupErrorMessage(code);
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
                학생 ID (4자리 숫자)
              </label>
              <Input
                value={phoneSuffix}
                onChange={(e) => setPhoneSuffix(e.target.value)}
                placeholder="나만의 고유 ID 4자리"
                maxLength={4}
                required
              />
              <p className="text-xs text-muted-foreground">
                중복되지 않는 나만의 숫자 4자리를 정해 주세요.
              </p>
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
