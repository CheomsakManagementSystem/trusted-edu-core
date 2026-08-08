import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { RequireAdmin, RequireAuth, RequireStaff } from "@/components/RequireAuth";

const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const UploadDashboard = lazy(() => import("./pages/Admin/UploadDashboard"));
const ClassManager = lazy(() => import("./pages/Admin/ClassManager"));
const MasterAdminPage = lazy(() => import("./pages/Admin/MasterAdminPage"));
const ReportView = lazy(() => import("./pages/Student/ReportView"));
const AccountSettings = lazy(() => import("./pages/Student/AccountSettings"));
const Guide = lazy(() => import("./pages/Guide"));
const Landing = lazy(() => import("./pages/Landing"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
    불러오는 중...
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/landing" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/register" element={<Signup />} />
              <Route path="/guide" element={<Guide />} />

              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <ReportView />
                  </RequireAuth>
                }
              />
              <Route
                path="/dashboard/account"
                element={
                  <RequireAuth>
                    <AccountSettings />
                  </RequireAuth>
                }
              />

              <Route
                path="/admin"
                element={
                  <RequireStaff>
                    <UploadDashboard />
                  </RequireStaff>
                }
              />
              <Route
                path="/admin/class-manager"
                element={
                  <RequireStaff>
                    <ClassManager />
                  </RequireStaff>
                }
              />
              <Route
                path="/admin/master"
                element={
                  <RequireAdmin>
                    <MasterAdminPage />
                  </RequireAdmin>
                }
              />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
