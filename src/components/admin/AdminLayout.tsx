import { ReactNode, useState } from "react";
import {
  BookOpen,
  FileText,
  Settings,
  Users,
  Menu,
  X,
} from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { cn } from "@/lib/utils";

export type AdminSectionKey = "classes" | "students" | "settings";

interface AdminLayoutProps {
  section: AdminSectionKey;
  onSectionChange: (section: AdminSectionKey) => void;
  children: ReactNode;
}

const sections: { key: AdminSectionKey; label: string; icon: React.ElementType }[] = [
  { key: "classes", label: "반 관리 및 자료 배포", icon: FileText },
  { key: "students", label: "학생 명단 및 배정", icon: Users },
  { key: "settings", label: "설정", icon: Settings },
];

const AdminLayout = ({ section, onSectionChange, children }: AdminLayoutProps) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen bg-slate-950 text-slate-50">
      {/* Sidebar */}
      <aside
        className={cn(
          "hidden w-64 flex-col border-r border-slate-800 bg-slate-900 md:flex"
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-slate-800 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
            <BookOpen className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight">
              김윤환 논술학원 관리 시스템
            </span>
            <span className="text-[11px] text-slate-400">
              관리자 통제 센터
            </span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {sections.map((item) => {
            const Icon = item.icon;
            const active = section === item.key;
            return (
              <button
                key={item.key}
                onClick={() => onSectionChange(item.key)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-slate-800 text-sky-300"
                    : "text-slate-300 hover:bg-slate-800/70 hover:text-slate-50"
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 px-4 py-3 text-[11px] text-slate-500">
          © {new Date().getFullYear()} 김윤환 논술학원 관리 시스템
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header (reuse AppHeader but with dark bg wrapper) */}
        <div className="border-b border-slate-800 bg-slate-900">
          <div className="flex items-center gap-2 px-4 md:hidden">
            <button
              className="mr-1 inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-800 text-slate-200 hover:bg-slate-800"
              onClick={() => setMobileOpen((v) => !v)}
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <span className="text-sm font-semibold text-slate-100">
              김윤환 논술학원 관리 시스템
            </span>
          </div>
          <AppHeader />
        </div>

        {/* Mobile sidebar overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <div className="w-64 bg-slate-900 border-r border-slate-800">
              <div className="flex h-16 items-center gap-2 border-b border-slate-800 px-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
                  <BookOpen className="h-5 w-5" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold tracking-tight">
                    김윤환 논술학원 관리 시스템
                  </span>
                  <span className="text-[11px] text-slate-400">
                    관리자 통제 센터
                  </span>
                </div>
              </div>
              <nav className="space-y-1 px-3 py-4">
                {sections.map((item) => {
                  const Icon = item.icon;
                  const active = section === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => {
                        onSectionChange(item.key);
                        setMobileOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-slate-800 text-sky-300"
                          : "text-slate-300 hover:bg-slate-800/70 hover:text-slate-50"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
            <button
              className="flex-1 bg-black/40"
              onClick={() => setMobileOpen(false)}
            />
          </div>
        )}

        <main className="flex-1 overflow-y-auto bg-slate-950/90 px-4 py-6 md:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
