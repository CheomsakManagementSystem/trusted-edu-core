import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Upload, Users } from "lucide-react";
import AppSidebar from "./AppSidebar";
import AppHeader from "./AppHeader";
import { useAuth } from "@/contexts/AuthContext";

const MobileBottomNav = () => {
  const location = useLocation();
  const { user } = useAuth();

  const items =
    user?.role === "staff"
      ? [
          { to: "/admin", label: "리포트", icon: Upload },
          { to: "/admin/class-manager", label: "반 관리", icon: Users },
        ]
      : [{ to: "/dashboard", label: "리포트", icon: LayoutDashboard }];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur md:hidden">
      <div className={`mx-auto grid max-w-md gap-2 ${items.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
        {items.map((item) => {
          const Icon = item.icon;
          const active = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-background text-muted-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

interface DashboardLayoutProps {
  children: ReactNode;
}

const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  return (
    <div className="flex h-dvh overflow-hidden">
      <AppSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AppHeader />
        <main className="mobile-scroll flex-1 overflow-y-auto px-4 pb-24 pt-4 sm:px-5 md:px-6 md:pb-6 md:pt-6">
          {children}
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
};

export default DashboardLayout;
