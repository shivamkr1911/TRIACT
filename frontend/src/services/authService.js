import api from "./api.js";

const login = async (email, password) => {
  // Add /api prefix
  const response = await api.post("/api/auth/login", { email, password });
  return response.data;
};

const register = async (userData) => {
  // Add /api prefix
  const response = await api.post("/api/auth/register", userData);
  return response.data;
};

const logout = async () => {
  // Add /api prefix
  const response = await api.post("/api/auth/logout");
  return response.data;
};

const getCurrentUser = async () => {
  const response = await api.get("/api/auth/me");
  return response.data.user;
};

const authService = {
  login,
  register,
  logout,
  getCurrentUser,
};

export default authService;
