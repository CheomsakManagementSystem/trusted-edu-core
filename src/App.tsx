import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Outlet, Route, Routes } from "react-router-dom";

const AuthProvider = lazy(() =>
  import("@/contexts/AuthContext").then((module) => ({ default: module.AuthProvider })),
);
const RequireAuth = lazy(() =>
  import("@/components/RequireAuth").then((module) => ({ default: module.RequireAuth })),
);
const RequireStaff = lazy(() =>
  import("@/components/RequireAuth").then((module) => ({ default: module.RequireStaff })),
);
const RequireAdmin = lazy(() =>
  import("@/components/RequireAuth").then((module) => ({ default: module.RequireAdmin })),
);

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

const RouteFallback = () => (
  <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
    불러오는 중...
  </div>
);

const AuthenticatedLayout = () => (
  <AuthProvider>
    <Outlet />
  </AuthProvider>
);

const App = () => (
  <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/landing" element={<Landing />} />

            <Route element={<AuthenticatedLayout />}>
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
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
  </TooltipProvider>
);

export default App;
