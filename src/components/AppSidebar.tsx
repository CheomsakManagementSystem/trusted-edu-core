import { useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, LayoutDashboard, Upload, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import BrandLogo from "@/components/BrandLogo";

const AppSidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { user } = useAuth();

  const staffMenu = [
    { icon: Upload, label: "리포트 등록", path: "/admin" },
    { icon: Users, label: "반 관리", path: "/admin/class-manager" },
  ];

  const studentMenu = [{ icon: LayoutDashboard, label: "나의 성장 리포트", path: "/dashboard" }];

  const menuItems = user?.role === "staff" ? staffMenu : studentMenu;

  return (
    <aside
      className={`hidden flex-col bg-sidebar text-sidebar-foreground transition-all duration-300 md:flex ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      <div className="flex h-20 items-center justify-center border-b border-sidebar-border px-3">
        {!collapsed ? (
          <BrandLogo compact className="max-w-full text-sidebar-primary-foreground" />
        ) : (
          <BrandLogo iconOnly className="text-sidebar-primary-foreground" />
        )}
      </div>

      <nav className="flex-1 space-y-1 px-2 py-4">
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
