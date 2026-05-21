import React, { useState, useEffect } from "react";
import api from "./services/api";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { AuthContext } from "./context/AuthContext";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import CustomerLogin from "./portal/pages/Login";
import CustomerRegister from "./portal/pages/Register";
import TenantPicker from "./portal/pages/TenantPicker";
import CustomerDashboard from "./portal/pages/Dashboard";
import CustomerMyLoans from "./portal/pages/MyLoans";
import CustomerPayments from "./portal/pages/Payments";
import CustomerLoanDetails from "./portal/pages/LoanDetails";
import CustomerProfile from "./portal/pages/Profile";
import CustomerForgotPassword from "./portal/pages/ForgotPassword";
import CustomerAddLender from "./portal/pages/AddLender";
import CustomerLenders from "./portal/pages/Lenders";
import CustomerLenderDetail from "./portal/pages/LenderDetail";
import CustomerApplyLoan from "./portal/pages/ApplyLoan";
import CustomerApplications from "./portal/pages/Applications";
import CustomerCalculator from "./portal/pages/Calculator";
import PlatformDashboard from "./admin/pages/Dashboard";
import PlatformTenants from "./admin/pages/Tenants";
import PlatformTenantDetail from "./admin/pages/TenantDetail";
import PlatformBilling from "./admin/pages/Billing";
import PlatformInvoiceDetail from "./admin/pages/InvoiceDetail";
import LandingHome from "./landing/pages/Home";
import OnboardingWizard from "./onboarding/OnboardingWizard";
import WhiteLabelSettings from "./pages/WhiteLabelSettings";
import EmbedSettings from "./pages/EmbedSettings";
import CalculatorWidget from "./widget/CalculatorWidget";
import PortalProtectedRoute from "./portal/components/PortalProtectedRoute";
import PlatformAdminRoute from "./admin/components/PlatformAdminRoute";
import AdminLogin from "./admin/pages/AdminLogin";
import CronManager from "./admin/pages/CronManager";
import PlatformAuditLog from "./admin/pages/PlatformAuditLog";
import PlatformReports from "./admin/pages/PlatformReports";
import Dashboard from "./pages/Dashboard";
import Clients from "./pages/Clients";
import Loans from "./pages/Loans";
import LoanDetails from "./pages/LoanDetails";
import Payments from "./pages/Payments";
import Overdue from "./pages/Overdue";
import ClientProfile from "./pages/ClientProfile";
import Reports from "./pages/Reports";
import Exports from "./pages/Exports";
import SMS from "./pages/SMS";
import Email from "./pages/Email";
import Settings from "./pages/Settings";
import AuditLog from "./pages/AuditLog";
import UserManagement from "./pages/UserManagement";
import Backup from "./pages/Backup";
import Analytics from "./pages/Analytics";
import Applications from "./pages/Applications";
import Notifications from "./pages/Notifications";
import Referrals from "./pages/Referrals";
import Layout from "./components/Layout";

function App() {
  const [user, setUser] = useState(() => {
    const token = localStorage.getItem("token");
    const savedUser = localStorage.getItem("user");

    if (token && savedUser) {
      try {
        return JSON.parse(savedUser);
      } catch {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
      }
    }
    return null;
  });

  const logout = () => {
    setUser(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  };

  // Apply tenant's white-label favicon + tab title when an authed
  // staff session loads. Falls back silently when the endpoint isn't
  // available (basic tier / favicon unset). No-op for guests.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api
      .get("/white-label/settings")
      .then((r) => {
        if (cancelled) return;
        const d = r.data?.data;
        if (!d) return;
        if (d.business_name) document.title = d.business_name;
        if (d.favicon_url) {
          let link =
            document.querySelector("link[rel='icon']") ||
            document.querySelector("link[rel='shortcut icon']");
          if (!link) {
            link = document.createElement("link");
            link.rel = "icon";
            document.head.appendChild(link);
          }
          link.href = d.favicon_url;
        }
      })
      .catch(() => {
        /* non-fatal */
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, setUser, logout }}>
      <Router>
        {user ? (
          <Routes>
            <Route
              path="/widget/calculator/:subdomain"
              element={<CalculatorWidget />}
            />
            <Route
              path="/admin/dashboard"
              element={
                <PlatformAdminRoute>
                  <PlatformDashboard />
                </PlatformAdminRoute>
              }
            />
            <Route
              path="/admin/tenants"
              element={
                <PlatformAdminRoute>
                  <PlatformTenants />
                </PlatformAdminRoute>
              }
            />
            <Route
              path="/admin/tenants/:id"
              element={
                <PlatformAdminRoute>
                  <PlatformTenantDetail />
                </PlatformAdminRoute>
              }
            />
            <Route
              path="/admin/billing"
              element={
                <PlatformAdminRoute>
                  <PlatformBilling />
                </PlatformAdminRoute>
              }
            />
            <Route
              path="/admin/billing/:id"
              element={
                <PlatformAdminRoute>
                  <PlatformInvoiceDetail />
                </PlatformAdminRoute>
              }
            />
            <Route
              path="/admin/cron"
              element={
                <PlatformAdminRoute>
                  <CronManager />
                </PlatformAdminRoute>
              }
            />
            <Route
              path="/admin/audit"
              element={
                <PlatformAdminRoute>
                  <PlatformAuditLog />
                </PlatformAdminRoute>
              }
            />
            <Route
              path="/admin/reports"
              element={
                <PlatformAdminRoute>
                  <PlatformReports />
                </PlatformAdminRoute>
              }
            />
            <Route
              path="/onboarding"
              element={<OnboardingWizard />}
            />
            <Route
              path="/*"
              element={
                // Platform admins must not see the staff Layout —
                // they land here on / after login, on refresh from
                // localStorage, or via direct nav. Bounce them to
                // their own dashboard before Layout renders.
                user?.is_platform_admin ? (
                  <Navigate to="/admin/dashboard" replace />
                ) : (
                <Layout>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/applications" element={<Applications />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/clients" element={<Clients />} />
              <Route
                path="/clients/:id/profile"
                element={<ClientProfile />}
              />
              <Route path="/loans" element={<Loans />} />
              <Route path="/loans/:id" element={<LoanDetails />} />
              <Route path="/payments" element={<Payments />} />
              <Route path="/overdue" element={<Overdue />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/exports" element={<Exports />} />
              <Route path="/sms" element={<SMS />} />
              <Route path="/email" element={<Email />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/white-label" element={<WhiteLabelSettings />} />
              <Route path="/embed" element={<EmbedSettings />} />
              <Route path="/audit" element={<AuditLog />} />
              <Route path="/users" element={<UserManagement />} />
              <Route path="/backup" element={<Backup />} />
              <Route path="/referrals" element={<Referrals />} />
                    <Route path="*" element={<Navigate to="/" />} />
                  </Routes>
                </Layout>
                )
              }
            />
          </Routes>
        ) : (
          <Routes>
            <Route
              path="/widget/calculator/:subdomain"
              element={<CalculatorWidget />}
            />
            <Route path="/login" element={<Login />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/loanfix/portal/login" element={<CustomerLogin />} />
            <Route path="/loanfix/portal/register" element={<CustomerRegister />} />
            <Route
              path="/loanfix/portal/forgot-password"
              element={<CustomerForgotPassword />}
            />
            <Route
              path="/loanfix/portal/select-tenant"
              element={<TenantPicker />}
            />
            <Route
              path="/loanfix/portal/add-lender"
              element={
                <PortalProtectedRoute>
                  <CustomerAddLender />
                </PortalProtectedRoute>
              }
            />
            <Route
              path="/loanfix/portal/dashboard"
              element={
                <PortalProtectedRoute>
                  <CustomerDashboard />
                </PortalProtectedRoute>
              }
            />
            <Route
              path="/loanfix/lenders"
              element={
                <PortalProtectedRoute>
                  <CustomerLenders />
                </PortalProtectedRoute>
              }
            />
            <Route
              path="/loanfix/lenders/:id"
              element={
                <PortalProtectedRoute>
                  <CustomerLenderDetail />
                </PortalProtectedRoute>
              }
            />
            <Route
              path="/loanfix/portal/apply"
              element={
                <PortalProtectedRoute>
                  <CustomerApplyLoan />
                </PortalProtectedRoute>
              }
            />
            <Route
              path="/loanfix/portal/applications"
              element={
                <PortalProtectedRoute>
                  <CustomerApplications />
                </PortalProtectedRoute>
              }
            />
            <Route
              path="/loanfix/portal/loans"
              element={
                <PortalProtectedRoute>
                  <CustomerMyLoans />
                </PortalProtectedRoute>
              }
            />
            <Route
              path="/loanfix/portal/payments"
              element={
                <PortalProtectedRoute>
                  <CustomerPayments />
                </PortalProtectedRoute>
              }
            />
            <Route
              path="/loanfix/portal/loans/:id"
              element={
                <PortalProtectedRoute>
                  <CustomerLoanDetails />
                </PortalProtectedRoute>
              }
            />
            <Route
              path="/loanfix/portal/calculator"
              element={
                <PortalProtectedRoute>
                  <CustomerCalculator />
                </PortalProtectedRoute>
              }
            />
            <Route
              path="/loanfix/portal/profile"
              element={
                <PortalProtectedRoute>
                  <CustomerProfile />
                </PortalProtectedRoute>
              }
            />
            <Route path="/" element={<LandingHome />} />
            <Route path="*" element={<Navigate to="/login" />} />
          </Routes>
        )}
      </Router>
    </AuthContext.Provider>
  );
}

export default App;
