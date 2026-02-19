import { useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, LayoutDashboard, Upload, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const AppSidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { user } = useAuth();

  const staffMenu = [
    { icon: Upload, label: "PDF 업로드", path: "/admin" },
    { icon: Users, label: "반 관리", path: "/admin/class-manager" },
  ];

  const studentMenu = [{ icon: LayoutDashboard, label: "리포트 분석", path: "/dashboard" }];

  const menuItems = user?.role === "staff" ? staffMenu : studentMenu;

  return (
    <aside
      className={`flex flex-col bg-sidebar text-sidebar-foreground transition-all duration-300 ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      <div className="flex h-16 items-center justify-center border-b border-sidebar-border px-4">
        {!collapsed ? (
          <span className="text-lg font-bold tracking-tight text-sidebar-primary-foreground">
            LOGOS EDU
          </span>
        ) : (
          <span className="text-sm font-bold">LE</span>
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
