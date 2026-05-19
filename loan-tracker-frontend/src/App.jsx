import React, { useState } from "react";
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
import CustomerLoanDetails from "./portal/pages/LoanDetails";
import CustomerProfile from "./portal/pages/Profile";
import CustomerForgotPassword from "./portal/pages/ForgotPassword";
import CustomerAddLender from "./portal/pages/AddLender";
import CustomerAllLoans from "./portal/pages/AllLoans";
import CustomerApplyLoan from "./portal/pages/ApplyLoan";
import CustomerApplications from "./portal/pages/Applications";
import PortalProtectedRoute from "./portal/components/PortalProtectedRoute";
import Dashboard from "./pages/Dashboard";
import Clients from "./pages/Clients";
import Loans from "./pages/Loans";
import LoanDetails from "./pages/LoanDetails";
import Payments from "./pages/Payments";
import Overdue from "./pages/Overdue";
import ClientProfile from "./pages/ClientProfile";
import Reports from "./pages/Reports";
import SMS from "./pages/SMS";
import Email from "./pages/Email";
import Settings from "./pages/Settings";
import AuditLog from "./pages/AuditLog";
import UserManagement from "./pages/UserManagement";
import Backup from "./pages/Backup";
import Analytics from "./pages/Analytics";
import Applications from "./pages/Applications";
import Notifications from "./pages/Notifications";
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

  return (
    <AuthContext.Provider value={{ user, setUser, logout }}>
      <Router>
        {user ? (
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
              <Route path="/sms" element={<SMS />} />
              <Route path="/email" element={<Email />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/audit" element={<AuditLog />} />
              <Route path="/users" element={<UserManagement />} />
              <Route path="/backup" element={<Backup />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Layout>
        ) : (
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/portal/login" element={<CustomerLogin />} />
            <Route path="/portal/register" element={<CustomerRegister />} />
            <Route
              path="/portal/forgot-password"
              element={<CustomerForgotPassword />}
            />
            <Route
              path="/portal/select-tenant"
              element={<TenantPicker />}
            />
            <Route
              path="/portal/add-lender"
              element={
                <PortalProtectedRoute>
                  <CustomerAddLender />
                </PortalProtectedRoute>
              }
            />
            <Route
              path="/portal/dashboard"
              element={
                <PortalProtectedRoute>
                  <CustomerDashboard />
                </PortalProtectedRoute>
              }
            />
            <Route
              path="/portal/all-loans"
              element={
                <PortalProtectedRoute>
                  <CustomerAllLoans />
                </PortalProtectedRoute>
              }
            />
            <Route
              path="/portal/apply"
              element={
                <PortalProtectedRoute>
                  <CustomerApplyLoan />
                </PortalProtectedRoute>
              }
            />
            <Route
              path="/portal/applications"
              element={
                <PortalProtectedRoute>
                  <CustomerApplications />
                </PortalProtectedRoute>
              }
            />
            <Route
              path="/portal/loans"
              element={
                <PortalProtectedRoute>
                  <CustomerMyLoans />
                </PortalProtectedRoute>
              }
            />
            <Route
              path="/portal/loans/:id"
              element={
                <PortalProtectedRoute>
                  <CustomerLoanDetails />
                </PortalProtectedRoute>
              }
            />
            <Route
              path="/portal/profile"
              element={
                <PortalProtectedRoute>
                  <CustomerProfile />
                </PortalProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/login" />} />
          </Routes>
        )}
      </Router>
    </AuthContext.Provider>
  );
}

export default App;
