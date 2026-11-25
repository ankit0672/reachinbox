import { Navigate, Route, Routes } from "react-router";
import { RequireAuth } from "../auth/RequireAuth";
import { DashboardLayout } from "../pages/dashboard/DashboardLayout";
import { EmailTabPage } from "../pages/dashboard/EmailTabPage";
import { ComposePage } from "../pages/ComposePage";
import { EmailDetailPage } from "../pages/EmailDetailPage";
import { LoginPage } from "../pages/LoginPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        {/* The backend redirects here after Google login (FRONTEND_URL/dashboard). */}
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<EmailTabPage key="scheduled" tab="scheduled" />} />
          <Route path="sent" element={<EmailTabPage key="sent" tab="sent" />} />
        </Route>
        <Route path="/compose" element={<ComposePage />} />
        <Route path="/emails/:id" element={<EmailDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
