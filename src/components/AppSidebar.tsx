import { useState } from "react";
import { useLocation, Link } from "react-router-dom";
import {
  BarChart3,
  Users,
  Upload,
  ClipboardCheck,
  GraduationCap,
  Settings,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  BookOpen,
} from "lucide-react";

const menuItems = [
  { icon: LayoutDashboard, label: "대시보드", path: "/" },
  { icon: Users, label: "학생 관리", path: "/students" },
  { icon: BookOpen, label: "수업 관리", path: "/classes" },
  { icon: ClipboardCheck, label: "성적 관리", path: "/scores" },
  { icon: Upload, label: "자료 업로드", path: "/uploads" },
  { icon: BarChart3, label: "통계 분석", path: "/analytics" },
  { icon: GraduationCap, label: "입시 관리", path: "/admissions" },
  { icon: Settings, label: "설정", path: "/settings" },
];

const AppSidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

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
