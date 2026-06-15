import React, { useState, useEffect } from "react";
import api from "./services/api";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";

// Strips the legacy /loanfix prefix off the current URL and forwards
// to the equivalent new path, preserving the query string. Used as
// the element for the /loanfix/* compat route.
function LoanfixLegacyRedirect() {
  const loc = useLocation();
  const stripped = loc.pathname.replace(/^\/loanfix/, "") || "/";
  return <Navigate to={stripped + loc.search + loc.hash} replace />;
}
import { AuthContext } from "./context/AuthContext";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import WelfareRegister from "./pages/WelfareRegister";
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
import CustomerVerifyIdentity from "./portal/pages/VerifyIdentity";
import PlatformDashboard from "./admin/pages/Dashboard";
import PlatformTenants from "./admin/pages/Tenants";
import PlatformTenantDetail from "./admin/pages/TenantDetail";
import PlatformBilling from "./admin/pages/Billing";
import PlatformInvoiceDetail from "./admin/pages/InvoiceDetail";
import PlatformCommunicationCosts from "./admin/pages/CommunicationCosts";
import LandingHome from "./landing/pages/Home";
import GetStarted from "./landing/pages/GetStarted";
import DemoStart from "./landing/pages/DemoStart";
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
import Groups from "./pages/Groups";
import GroupDetail from "./pages/GroupDetail";
import MemberDetail from "./pages/MemberDetail";
import Pawns from "./pages/Pawns";
import PawnbrokerRegister from "./pages/PawnbrokerRegister";
import LoanDetails from "./pages/LoanDetails";
import Payments from "./pages/Payments";
import Overdue from "./pages/Overdue";
import ClientProfile from "./pages/ClientProfile";
import Reports from "./pages/Reports";
import SMS from "./pages/SMS";
import Email from "./pages/Email";
import Settings from "./pages/Settings";
import LoanSettings from "./pages/LoanSettings";
import Billing from "./pages/Billing";
import Expenses from "./pages/Expenses";
import Waivers from "./pages/Waivers";
import Promises from "./pages/Promises";
import Defaulted from "./pages/Defaulted";
import Reconciliation from "./pages/Reconciliation";
import Automation from "./pages/Automation";
import AuditLog from "./pages/AuditLog";
import UserManagement from "./pages/UserManagement";
import Backup from "./pages/Backup";
import Analytics from "./pages/Analytics";
import Applications from "./pages/Applications";
import Notifications from "./pages/Notifications";
import Referrals from "./pages/Referrals";
import Layout from "./components/Layout";
import { buildAuthHandoff, consumeAuthHandoff } from "./utils/authHandoff";

function App() {
  const [user, setUser] = useState(() => {
    // A just-logged-out redirect lands here with ?loggedout=1 — wipe THIS
    // origin's storage so a stale token can't silently re-authenticate,
    // then strip the flag and fall through to the public page.
    const params = new URLSearchParams(window.location.search);
    if (params.get("loggedout") === "1") {
      [
        "token",
        "user",
        "is_demo_session",
        "demo_session_token",
        "lenderfest:period",
      ].forEach((k) => localStorage.removeItem(k));
      params.delete("loggedout");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
      );
      return null;
    }

    // Hash handoff wins over localStorage so a cross-subdomain
    // redirect overwrites whatever stale session this subdomain
    // had — kills the ping-pong loop noted above.
    const handoffUser = consumeAuthHandoff();
    if (handoffUser) return handoffUser;

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
    // Detect a demo session from the USER object too, not just the flag:
    // the cross-subdomain handoff carries `user` (with is_demo / tenant
    // subdomain 'demo') but NOT the is_demo_session flag, so on
    // demo.lenderfest.loans the flag is absent.
    let wasDemo = localStorage.getItem("is_demo_session") === "true";
    // Capture the account kind BEFORE we wipe storage, so we can send the user
    // back to the matching login (pawnbrokers → /pawn/login, welfare →
    // /welfare/login, everyone else → /login).
    let kind = "lender";
    try {
      const u = JSON.parse(localStorage.getItem("user") || "null");
      if (!wasDemo) wasDemo = !!(u && (u.is_demo || u.tenant?.subdomain === "demo"));
      kind = u?.tenant?.kind || "lender";
    } catch {
      /* ignore */
    }
    const loginPath =
      kind === "pawnbroker"
        ? "/pawn/login"
        : kind === "welfare"
          ? "/welfare/login"
          : "/login";
    setUser(null);
    // Clear EVERY auth/session key (incl. the demo flags + the persisted
    // period picker) so nothing on this origin can silently re-auth.
    [
      "token",
      "user",
      "is_demo_session",
      "demo_session_token",
      "lenderfest:period",
    ].forEach((k) => localStorage.removeItem(k));

    // Hard-redirect to the APEX (leaving the tenant subdomain entirely) so
    // the app re-initialises from scratch. Each subdomain/apex keeps its
    // OWN localStorage, so a stale token elsewhere used to log you straight
    // back into the previous tenant — `?loggedout=1` makes the destination
    // wipe its own storage first. Demo → landing home; tenant → login.
    const host = window.location.hostname;
    const onLF =
      host === "lenderfest.loans" || host.endsWith(".lenderfest.loans");
    const base = onLF ? "https://lenderfest.loans" : window.location.origin;
    window.location.href = wasDemo
      ? `${base}/?loggedout=1`
      : `${base}${loginPath}?loggedout=1`;
  };

  // Subdomain self-correction. If the URL says "kuwazo.lenderfest.loans"
  // but the signed JWT/user belongs to a different tenant (e.g. you
  // logged in via the wrong subdomain), redirect to the user's own
  // subdomain so the URL, branding, and tenant always agree. The
  // backend already scopes data by JWT — never by subdomain — so
  // this is purely a UX fix; data was never crossed.
  //
  // Guards:
  //   • only acts on lenderfest.loans hosts (skips localhost / preview / IP)
  //   • requires an authenticated tenant user — logged-out visitors keep
  //     the apex landing page (the `if (!user) return` below)
  //   • redirects the apex (lenderfest.loans) too, so a logged-in tenant
  //     who lands on the bare domain is sent to their own subdomain
  //   • skips platform admins (they're meant to roam tenants)
  //   • leaves the www / api platform hosts alone
  //   • preserves the current path + query so the user lands where
  //     they were trying to go, just on the right subdomain
  useEffect(() => {
    if (!user) return;
    const desired = user?.tenant?.subdomain;
    if (!desired) return; // pre-tenant accounts: no subdomain to enforce
    if (user.is_platform_admin) return;
    const SUFFIX = ".lenderfest.loans";
    const host = window.location.hostname;
    let current;
    if (host === "lenderfest.loans")
      current = ""; // apex — redirect logged-in tenants to their subdomain
    else if (host.endsWith(SUFFIX)) current = host.slice(0, -SUFFIX.length);
    else return; // localhost / preview / IP — never cross-redirect
    // www / api are platform hosts, not tenants — leave them alone.
    if (["www", "api"].includes(current)) return;
    if (current === desired) return;
    // Hand the current token+user to the target subdomain via the
    // fragment so its (possibly stale) localStorage doesn't
    // immediately redirect us back here. Falls back to a plain
    // redirect if the handoff can't be built — at worst we hit
    // the login screen on the right subdomain.
    const token = localStorage.getItem("token");
    const handoff = token ? buildAuthHandoff(token, user) : null;
    const existingHash = window.location.hash || "";
    const targetHash = handoff
      ? existingHash
        ? `${existingHash}&${handoff}`
        : `#${handoff}`
      : existingHash;
    const target = `https://${desired}.lenderfest.loans${window.location.pathname}${window.location.search}${targetHash}`;
    window.location.replace(target);
  }, [user]);

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

  // The demo subdomain is dedicated to the demo — visiting
  // demo.lenderfest.loans directly should auto-start a session and drop you
  // into the dashboard, not show the public landing page.
  const onDemoSubdomain =
    window.location.hostname.split(".")[0] === "demo" &&
    window.location.hostname.endsWith(".lenderfest.loans");
  if (onDemoSubdomain && !user) {
    return <DemoStart />;
  }

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
              path="/admin/communication-costs"
              element={
                <PlatformAdminRoute>
                  <PlatformCommunicationCosts />
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
                    <Route
                      path="/"
                      element={
                        user?.tenant?.kind === "welfare" ? (
                          <Navigate to="/groups" replace />
                        ) : user?.tenant?.kind === "pawnbroker" ? (
                          <Navigate to="/pawns" replace />
                        ) : (
                          <Dashboard />
                        )
                      }
                    />
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
              <Route path="/pawns" element={<Pawns />} />
              <Route path="/groups" element={<Groups />} />
              <Route path="/groups/:id" element={<GroupDetail />} />
              <Route path="/groups/:welfareId/members/:memberId" element={<MemberDetail />} />
              <Route path="/payments" element={<Payments />} />
              <Route path="/overdue" element={<Overdue />} />
              <Route path="/reports" element={<Reports />} />
              {/* Exports was folded into Reports; redirect old bookmarks. */}
              <Route path="/exports" element={<Navigate to="/reports" replace />} />
              <Route path="/sms" element={<SMS />} />
              <Route path="/email" element={<Email />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/loan-settings" element={<LoanSettings />} />
              <Route path="/billing" element={<Billing />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/waivers" element={<Waivers />} />
              <Route path="/promises" element={<Promises />} />
              <Route path="/defaulted" element={<Defaulted />} />
              <Route path="/reconciliation" element={<Reconciliation />} />
              <Route path="/automation" element={<Automation />} />
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
            <Route path="/welfare/register" element={<WelfareRegister />} />
            <Route path="/welfare/login" element={<Login />} />
            <Route path="/pawn/register" element={<PawnbrokerRegister />} />
            <Route path="/pawn/login" element={<Login />} />
            <Route path="/get-started" element={<GetStarted />} />
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
              path="/portal/verify-identity"
              element={
                <PortalProtectedRoute allowIncompleteKyc>
                  <CustomerVerifyIdentity />
                </PortalProtectedRoute>
              }
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
              path="/lenders"
              element={
                <PortalProtectedRoute>
                  <CustomerLenders />
                </PortalProtectedRoute>
              }
            />
            <Route
              path="/lenders/:id"
              element={
                <PortalProtectedRoute>
                  <CustomerLenderDetail />
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
              path="/portal/payments"
              element={
                <PortalProtectedRoute>
                  <CustomerPayments />
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
              path="/portal/calculator"
              element={
                <PortalProtectedRoute>
                  <CustomerCalculator />
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
            <Route path="/demo" element={<DemoStart />} />
            <Route path="/" element={<LandingHome />} />
            {/* Backwards compat — the customer portal used to live
                under /loanfix/portal/* and /loanfix/lenders/*. Old
                bookmarks, promo links, and referral URLs still hit
                those paths, so we strip the prefix and redirect to
                the new shorter path (preserves query string). */}
            <Route path="/loanfix/*" element={<LoanfixLegacyRedirect />} />
            <Route path="*" element={<Navigate to="/login" />} />
          </Routes>
        )}
      </Router>
    </AuthContext.Provider>
  );
}

export default App;
