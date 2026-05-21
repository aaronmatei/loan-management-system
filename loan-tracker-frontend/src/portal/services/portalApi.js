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
    if (error.response?.status === 401) {
      localStorage.removeItem("portal_token");
      localStorage.removeItem("portal_customer");
      localStorage.removeItem("portal_current_tenant");
      localStorage.removeItem("portal_tenants");
      window.location.href = "/loanfix/portal/login";
    }
    return Promise.reject(error);
  },
);

export default portalApi;
