import { useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  BarChart3,
  Users,
  ClipboardCheck,
  Settings,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  BookOpen,
  UserPlus,
  LogOut,
} from "lucide-react";

const AppSidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { role, profileName, signOut } = useAuth();

  const menuItems = (() => {
    if (role === "admin") {
      return [
        { icon: LayoutDashboard, label: "대시보드", path: "/" },
        { icon: BookOpen, label: "수업 관리", path: "/classes" },
        { icon: Users, label: "학생 관리", path: "/students" },
        { icon: UserPlus, label: "계정 관리", path: "/accounts" },
        { icon: ClipboardCheck, label: "성적 입력", path: "/scores" },
      ];
    }
    if (role === "teacher") {
      return [
        { icon: LayoutDashboard, label: "대시보드", path: "/" },
        { icon: ClipboardCheck, label: "성적 입력", path: "/scores" },
      ];
    }
    // student
    return [
      { icon: LayoutDashboard, label: "내 성적", path: "/" },
    ];
  })();

  const roleLabel = role === "admin" ? "관리자" : role === "teacher" ? "강사" : "학생";

  return (
    <aside
      className={`flex flex-col bg-sidebar text-sidebar-foreground transition-all duration-300 ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-center border-b border-sidebar-border px-4">
        {!collapsed ? (
          <span className="text-lg font-bold tracking-tight text-sidebar-primary-foreground">
            📝 논술학원
          </span>
        ) : (
          <span className="text-xl">📝</span>
        )}
      </div>

      {/* User info */}
      {!collapsed && (
        <div className="border-b border-sidebar-border px-4 py-3">
          <p className="text-sm font-medium text-sidebar-foreground">{profileName || "사용자"}</p>
          <p className="text-xs text-sidebar-muted">{roleLabel}</p>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2 py-4">
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              } ${collapsed ? "justify-center" : ""}`}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <button
        onClick={signOut}
        className="flex items-center gap-3 border-t border-sidebar-border px-5 py-3 text-sm text-sidebar-muted hover:text-sidebar-foreground transition-colors"
      >
        <LogOut className="h-4 w-4" />
        {!collapsed && <span>로그아웃</span>}
      </button>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-center border-t border-sidebar-border py-3 text-sidebar-muted hover:text-sidebar-foreground transition-colors"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
    </aside>
  );
};

export default AppSidebar;
