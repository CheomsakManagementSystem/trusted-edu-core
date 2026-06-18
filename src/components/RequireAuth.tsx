import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminRole, isStaffRole } from "@/lib/authz";
import MigrationModal from "@/components/MigrationModal";

export const RequireAuth = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <span className="text-sm text-muted-foreground">인증 정보를 확인하는 중...</span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // 레거시 학생 → 마이그레이션 모달이 대시보드를 덮음 (진입 자체는 허용, 모달로 차단)
  if (user.needsMigration) {
    return (
      <>
        {children}
        <MigrationModal />
      </>
    );
  }

  return <>{children}</>;
};

export const RequireStaff = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <span className="text-sm text-muted-foreground">인증 정보를 확인하는 중...</span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!isStaffRole(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

export const RequireAdmin = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <span className="text-sm text-muted-foreground">인증 정보를 확인하는 중...</span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!isAdminRole(user.role)) {
    return <Navigate to="/admin" replace />;
  }

  return <>{children}</>;
};
