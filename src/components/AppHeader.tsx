import { Bell, User } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const AppHeader = () => {
  const { profileName, role } = useAuth();
  const roleLabel = role === "admin" ? "관리자" : role === "teacher" ? "강사" : "학생";

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">김윤환 논술학원</h1>
        <p className="text-xs text-muted-foreground">관리 시스템</p>
      </div>

      <div className="flex items-center gap-4">
        <button className="relative rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <Bell className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <User className="h-4 w-4" />
          </div>
          <div className="hidden md:block">
            <span className="text-sm font-medium text-foreground">{profileName || "사용자"}</span>
            <p className="text-xs text-muted-foreground">{roleLabel}</p>
          </div>
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
