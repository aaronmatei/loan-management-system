import axios from "axios";

// Reuses the STAFF token namespace ("token"/"user") — platform admin
// is a staff user with is_platform_admin=true (the JWT carries it;
// the backend requirePlatformAdmin is the real gate).
const platformApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3000/api",
});

platformApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

platformApi.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) {
      window.location.href = "/login";
    } else if (error.response?.status === 403) {
      alert("Platform admin access required");
      window.location.href = "/";
    }
    return Promise.reject(error);
  },
);

export default platformApi;
