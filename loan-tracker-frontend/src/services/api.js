import axios from "axios";

const API_URL = "http://localhost:3000/api";

const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Add token (+ tenant subdomain hint) to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Subdomain is only a pre-auth hint; the backend scopes data by the
  // signed JWT, never this header. Safe to send (ignored pre-migration).
  try {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    if (user?.tenant?.subdomain) {
      config.headers["X-Tenant-Subdomain"] = user.tenant.subdomain;
    }
  } catch {
    /* ignore malformed user */
  }
  return config;
});

// Handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const code = error.response?.data?.code;

    if (status === 403 && code === "TENANT_SUSPENDED") {
      alert("Your account has been suspended. Please contact support.");
      localStorage.clear();
      window.location.href = "/login";
    } else if (status === 403 && code === "TRIAL_EXPIRED") {
      alert("Your trial has expired. Please upgrade to continue.");
    } else if (status === 403 && code === "LIMIT_REACHED") {
      alert(error.response.data.message);
    }

    if (status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);

export default api;
