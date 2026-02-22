import { Bell, LogOut, Search, User } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import BrandLogo from "@/components/BrandLogo";

const AppHeader = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <header className="flex h-20 items-center justify-between border-b border-border bg-card px-6">
      <BrandLogo compact className="text-foreground" />

      <div className="flex items-center gap-4">
        {/* Search */}
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="검색..."
            className="h-9 w-60 rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Notifications (placeholder) */}
        <button className="relative hidden rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors md:inline-flex">
          <Bell className="h-5 w-5" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
        </button>

        {/* User / Auth actions */}
        {user ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <User className="h-4 w-4" />
              </div>
              <div className="hidden text-left text-xs md:block">
                <p className="font-medium text-card-foreground">{user.name}</p>
                <p className="text-[10px] uppercase text-muted-foreground">
                  {user.role === "staff" ? "STAFF" : "STUDENT"}
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>로그아웃</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs">
            <Link
              to="/login"
              className="rounded-md px-2.5 py-1.5 font-medium text-foreground hover:bg-muted transition-colors"
            >
              로그인
            </Link>
            <Link
              to="/signup"
              className="rounded-md bg-primary px-2.5 py-1.5 font-medium text-primary-foreground hover:opacity-90 transition-opacity"
            >
              회원가입
            </Link>
          </div>
        )}
      </div>
    </header>
  );
};

export default AppHeader;
