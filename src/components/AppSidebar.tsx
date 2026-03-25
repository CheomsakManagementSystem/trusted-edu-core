import { useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, LayoutDashboard, Settings, ShieldCheck, Upload, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import BrandLogo from "@/components/BrandLogo";
import { isAdminRole, isStaffRole } from "@/lib/authz";

const AppSidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { user } = useAuth();

  const staffMenu = [
    { icon: Upload, label: "첨삭지 올리기", path: "/admin" },
    { icon: Users, label: "우리 반 아이들", path: "/admin/class-manager" },
    ...(isAdminRole(user?.role)
      ? [{ icon: ShieldCheck, label: "학원 전체 관리", path: "/admin/master" }]
      : []),
  ];

  const studentMenu = [
    { icon: LayoutDashboard, label: "나의 성장 리포트", path: "/dashboard" },
    { icon: Settings, label: "계정 관리", path: "/dashboard/account" },
  ];

  const menuItems = isStaffRole(user?.role) ? staffMenu : studentMenu;

  return (
    <aside
      className={`hidden flex-col bg-sidebar text-sidebar-foreground transition-all duration-300 md:flex ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      <div
        className={`pointer-events-none border-b border-sidebar-border px-3 py-2 ${
          collapsed ? "flex items-center justify-center" : "flex items-center justify-start"
        }`}
      >
        {!collapsed ? (
          <BrandLogo
            compact
            invertOnDark
            className="pointer-events-auto max-w-full text-sidebar-primary-foreground"
          />
        ) : (
          <BrandLogo
            iconOnly
            invertOnDark
            className="pointer-events-auto text-sidebar-primary-foreground"
          />
        )}
      </div>

      <nav className="relative z-10 flex-1 space-y-1 px-2 py-2">
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={`${item.path}-${item.label}`}
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

      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-center border-t border-sidebar-border py-3 text-sidebar-muted transition-colors hover:text-sidebar-foreground"
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </button>
    </aside>
  );
};

export default AppSidebar;
