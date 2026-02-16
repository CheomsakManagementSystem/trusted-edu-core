import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import Login from "./pages/Login";
import AdminDashboard from "./pages/admin/AdminDashboard";
import ManageClasses from "./pages/admin/ManageClasses";
import ManageStudents from "./pages/admin/ManageStudents";
import ManageAccounts from "./pages/admin/ManageAccounts";
import TeacherDashboard from "./pages/teacher/TeacherDashboard";
import TeacherScoreEntry from "./pages/teacher/TeacherScoreEntry";
import StudentDashboard from "./pages/student/StudentDashboard";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const ProtectedRoutes = () => {
  const { user, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">로딩 중...</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Role-based routing
  if (role === "admin") {
    return (
      <Routes>
        <Route path="/" element={<AdminDashboard />} />
        <Route path="/classes" element={<ManageClasses />} />
        <Route path="/students" element={<ManageStudents />} />
        <Route path="/accounts" element={<ManageAccounts />} />
        <Route path="/scores" element={<TeacherScoreEntry />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  if (role === "teacher") {
    return (
      <Routes>
        <Route path="/" element={<TeacherDashboard />} />
        <Route path="/scores" element={<TeacherScoreEntry />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  if (role === "student") {
    return (
      <Routes>
        <Route path="/" element={<StudentDashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  // No role assigned yet
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="text-center space-y-2">
        <p className="text-lg font-medium text-foreground">권한이 설정되지 않았습니다</p>
        <p className="text-sm text-muted-foreground">관리자에게 문의해 주세요</p>
      </div>
    </div>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginGuard />} />
            <Route path="/*" element={<ProtectedRoutes />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

const LoginGuard = () => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <Login />;
};

export default App;
