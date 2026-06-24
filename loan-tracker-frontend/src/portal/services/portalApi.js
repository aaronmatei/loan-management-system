import axios from "axios";

// Separate axios instance + separate token namespace ("portal_*")
// so the customer portal session never collides with staff auth.
const portalApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3000/api",
});

portalApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("portal_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Resolve tenant subdomain: real host in prod, dev selector on
  // localhost, else the logged-in customer's current tenant.
  let subdomain = null;
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    const parts = host.split(".");
    if (parts.length >= 2 && parts[0] !== "www") subdomain = parts[0];
  } else {
    subdomain = localStorage.getItem("dev_tenant_subdomain");
  }
  if (!subdomain) {
    try {
      const tenant = JSON.parse(
        localStorage.getItem("portal_current_tenant") || "null",
      );
      if (tenant?.subdomain) subdomain = tenant.subdomain;
    } catch {
      /* ignore */
    }
  }
  if (subdomain) config.headers["X-Tenant-Subdomain"] = subdomain;
  return config;
});

portalApi.interceptors.response.use(
  (r) => r,
  (error) => {
    // A 401 from an AUTH endpoint (login, member-login, forgot/reset,
    // set-password, select-tenant) is "bad credentials" for the calling
    // form to surface — NOT an expired session. Auto-redirecting those to
    // /portal/login wrongly bounced a welfare member off their own login
    // page after a single wrong password. Only treat 401s on authenticated
    // data endpoints as an expired session.
    const url = error.config?.url || "";
    const isAuthCall = url.includes("/portal/auth/");
    if (error.response?.status === 401 && !isAuthCall) {
      localStorage.removeItem("portal_token");
      localStorage.removeItem("portal_customer");
      localStorage.removeItem("portal_current_tenant");
      localStorage.removeItem("portal_tenants");
      window.location.href = "/portal/login";
    }
    return Promise.reject(error);
  },
);

export default portalApi;
