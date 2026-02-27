import { useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import DashboardLayout from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { normalizeRole } from "@/lib/authz";

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: Location } };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const uid = credential.user.uid;

      const userRef = doc(db, "users", uid);
      const snap = await getDoc(userRef);

      let role = "STUDENT";

      if (snap.exists()) {
        const data = snap.data() as { role?: string };
        role = normalizeRole(data.role);
      }

      const redirectTo =
        (location.state?.from as unknown as { pathname?: string } | undefined)?.pathname ??
        (role === "ADMIN" ? "/admin/master" : role === "INSTRUCTOR" ? "/admin" : "/dashboard");

      navigate(redirectTo, { replace: true });
    } catch (err) {
      console.error(err);
      setError("이메일 또는 비밀번호를 다시 확인해주세요.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="flex h-full items-center justify-center">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-card">
          <h2 className="mb-2 text-xl font-bold text-card-foreground">로그인</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            이메일과 비밀번호로 로그인해주세요.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
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

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              type="submit"
              className="w-full"
              disabled={loading}
            >
              {loading ? "로그인 중..." : "로그인"}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            아직 계정이 없나요?{" "}
            <Link to="/signup" className="font-medium text-primary hover:underline">
              회원가입
            </Link>
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Login;
