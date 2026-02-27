import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { RequireAdmin, RequireAuth, RequireStaff } from "@/components/RequireAuth";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import UploadDashboard from "./pages/Admin/UploadDashboard";
import ClassManager from "./pages/Admin/ClassManager";
import MasterAdminPage from "./pages/Admin/MasterAdminPage";
import ReportView from "./pages/Student/ReportView";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />

            <Route
              path="/dashboard"
              element={
                <RequireAuth>
                  <ReportView />
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
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
