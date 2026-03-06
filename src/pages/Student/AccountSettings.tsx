import { type FormEvent, useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import DashboardLayout from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";

const AccountSettings = () => {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);

  const handlePasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError(null);

    if (!currentPassword || !newPassword || !newPasswordConfirm) {
      setPasswordError("모든 비밀번호 입력값을 채워주세요.");
      window.alert("모든 비밀번호 입력값을 채워주세요.");
      return;
    }

    if (newPassword !== newPasswordConfirm) {
      setPasswordError("새 비밀번호가 서로 다릅니다");
      window.alert("새 비밀번호가 서로 다릅니다");
      return;
    }

    const firebaseUser = auth.currentUser;
    if (!firebaseUser?.email) {
      setPasswordError("비밀번호 변경을 위한 사용자 인증 정보를 확인할 수 없습니다.");
      window.alert("비밀번호 변경을 위한 사용자 인증 정보를 확인할 수 없습니다.");
      return;
    }

    if (currentPassword === newPassword) {
      setPasswordError("새 비밀번호는 현재 비밀번호와 다르게 설정해주세요.");
      window.alert("새 비밀번호는 현재 비밀번호와 다르게 설정해주세요.");
      return;
    }

    setPasswordSaving(true);
    try {
      const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
      await reauthenticateWithCredential(firebaseUser, credential);
      await updatePassword(firebaseUser, newPassword);

      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
      toast({
        title: "비밀번호 변경 완료",
        description: "비밀번호가 안전하게 변경되었습니다!",
      });
      window.alert("비밀번호가 안전하게 변경되었습니다!");
    } catch (passwordUpdateError) {
      const errorCode =
        typeof passwordUpdateError === "object" &&
        passwordUpdateError !== null &&
        "code" in passwordUpdateError
          ? String(passwordUpdateError.code)
          : "";

      if (errorCode === "auth/wrong-password" || errorCode === "auth/invalid-credential") {
        setPasswordError("현재 비밀번호가 올바르지 않습니다.");
        window.alert("현재 비밀번호가 올바르지 않습니다.");
      } else if (errorCode === "auth/weak-password") {
        setPasswordError("새 비밀번호가 너무 약합니다. 더 안전한 비밀번호를 입력해주세요.");
        window.alert("새 비밀번호가 너무 약합니다. 더 안전한 비밀번호를 입력해주세요.");
      } else if (errorCode === "auth/too-many-requests") {
        setPasswordError("요청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해주세요.");
        window.alert("요청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해주세요.");
      } else {
        setPasswordError("비밀번호 변경 중 오류가 발생했습니다. 다시 시도해주세요.");
        window.alert("비밀번호 변경 중 오류가 발생했습니다. 다시 시도해주세요.");
      }
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 pb-20">
        <div>
          <h2 className="text-xl font-bold text-foreground">계정 관리</h2>
          <p className="text-sm text-muted-foreground">
            보안을 위해 현재 비밀번호 확인 후 새 비밀번호로 변경하세요.
          </p>
        </div>

        <div className="relative block rounded-lg border-2 border-primary/20 bg-primary/5 p-5 shadow-card">
          <h3 className="text-base font-bold text-card-foreground">비밀번호 변경</h3>
          <form className="mt-4 space-y-3 rounded-md border border-primary/20 bg-background p-4" onSubmit={handlePasswordChange}>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-card-foreground">현재 비밀번호</label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-card-foreground">새 비밀번호</label>
              <Input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-card-foreground">새 비밀번호 확인</label>
              <Input
                type="password"
                value={newPasswordConfirm}
                onChange={(event) => setNewPasswordConfirm(event.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}

            <Button type="submit" disabled={passwordSaving} className="w-full md:w-auto">
              {passwordSaving ? "변경 중..." : "비밀번호 변경하기"}
            </Button>
          </form>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AccountSettings;

