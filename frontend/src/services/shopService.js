// frontend/src/services/shopService.js

import api from "./api.js";

const getOwnerDashboardData = async (shopId) => {
  const response = await api.get(`/api/shops/${shopId}/dashboard`);
  return response.data;
};

const getProducts = async (shopId) => {
  const response = await api.get(`/api/shops/${shopId}/products`);
  return response.data.products;
};

const updateProduct = async (shopId, productId, productData) => {
  const response = await api.put(
    `/api/shops/${shopId}/products/${productId}`,
    productData
  );
  return response.data;
};

const addProduct = async (shopId, productData) => {
  const response = await api.post(`/api/shops/${shopId}/products`, productData);
  return response.data;
};

// ADD THIS MISSING FUNCTION
const deleteProduct = async (shopId, productId) => {
  const response = await api.delete(
    `/api/shops/${shopId}/products/${productId}`
  );
  return response.data;
};


const getEmployees = async (shopId) => {
  const response = await api.get(`/api/shops/${shopId}/employees`);
  return response.data.employees;
};

const updateEmployee = async (shopId, employeeId, employeeData) => {
  const response = await api.put(
    `/api/shops/${shopId}/employees/${employeeId}`,
    employeeData
  );
  return response.data;
};

const addEmployee = async (shopId, employeeData) => {
  const response = await api.post(
    `/api/shops/${shopId}/employees`,
    employeeData
  );
  return response.data;
};

const removeEmployee = async (shopId, employeeId) => {
  const response = await api.delete(
    `/api/shops/${shopId}/employees/${employeeId}`
  );
  return response.data;
};

const createOrder = async (shopId, orderData) => {
  const response = await api.post(`/api/shops/${shopId}/orders`, orderData);
  return response.data;
};

const getNotifications = async (shopId) => {
  const response = await api.get(`/api/shops/${shopId}/notifications`);
  return response.data.notifications;
};

const markNotificationsAsRead = async (shopId) => {
  const response = await api.put(
    `/api/shops/${shopId}/notifications/mark-read`
  );
  return response.data;
};

const getShopDetails = async (shopId) => {
  const response = await api.get(`/api/shops/${shopId}`);
  return response.data.shop;
};

const updateShopDetails = async (shopId, shopData) => {
  const response = await api.put(`/api/shops/${shopId}`, shopData);
  return response.data.shop;
};

const createShop = async (token, shopData) => {
  const response = await api.post(`/api/shops`, shopData, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data;
};

const getInvoices = async (shopId) => {
  const response = await api.get(`/api/shops/${shopId}/invoices`);
  return response.data.invoices;
};

const getForecast = async (shopId) => {
  const response = await api.get(`/api/shops/${shopId}/ai/forecast`);
  return response.data.products;
};

const getAiChatResponse = async (shopId, query, history = []) => {
  const response = await api.post(`/api/shops/${shopId}/ai/chat`, { query, history });
  return response.data;
};

const streamAiChatResponse = async (shopId, query, history = [], onChunk) => {
  const token = localStorage.getItem("token");
  const response = await fetch(`/api/shops/${shopId}/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, history, stream: true }),
  });

  if (!response.ok) {
    let errorMsg = "I'm having trouble analyzing the store data right now. Please try again in a moment.";
    try {
      const data = await response.json();
      if (data?.message || data?.reply) errorMsg = data.message || data.reply;
    } catch (_) {}
    throw new Error(errorMsg);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await response.json();
    const fullText = data.reply || data.answer || "";
    if (onChunk) onChunk(fullText);
    return fullText;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    accumulated += chunk;
    if (onChunk) onChunk(accumulated);
  }

  return accumulated;
};

const shopService = {
  getOwnerDashboardData,
  getProducts,
  updateProduct,
  addProduct,
  deleteProduct,
  getEmployees,
  updateEmployee,
  addEmployee,
  removeEmployee,
  createOrder,
  getNotifications,
  markNotificationsAsRead,
  getShopDetails,
  updateShopDetails,
  createShop,
  getInvoices,
  getForecast,
  getAiChatResponse,
  streamAiChatResponse,
};

export default shopService;
