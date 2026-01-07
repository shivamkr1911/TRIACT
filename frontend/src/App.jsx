import React, { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth.js";
import PrivateRoute from "./components/PrivateRoute.jsx";
import NavBar from "./components/NavBar.jsx";

// Pages
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import OwnerDashboard from "./pages/OwnerDashboard.jsx";
import EmployeeDashboard from "./pages/EmployeeDashboard.jsx";
import InvoiceScan from "./pages/InvoiceScan.jsx";
import CreateOrder from "./pages/CreateOrder.jsx";
import ManageStock from "./pages/ManageStock.jsx";
import ManageEmployees from "./pages/ManageEmployees.jsx";
import ShopSettings from "./pages/ShopSettings.jsx";
import SalaryInfo from "./pages/SalaryInfo.jsx";
import ViewInvoices from "./pages/ViewInvoices.jsx";
import AiChat from "./pages/AiChat.jsx"; // New page

// --- Wrapper component for consistent dashboard layout ---
const Dashboard = () => {
  const { user } = useAuth();
  if (user?.role === "owner") return <OwnerDashboard />;
  if (user?.role === "employee") return <EmployeeDashboard />;
  return <Navigate to="/login" />;
};

function App() {
  const { shopDetails } = useAuth();

  // --- Dynamic page title ---
  useEffect(() => {
    document.title = shopDetails?.shopName
      ? `TRIACT - ${shopDetails.shopName}`
      : "TRIACT";
  }, [shopDetails]);

  return (
    <div className="bg-gray-100 min-h-screen flex flex-col">
      {/* Navbar */}
      <NavBar />

      {/* Main content */}
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Protected Routes */}
          <Route
            path="/dashboard"
            element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            }
          />
          <Route
            path="/scan-invoice"
            element={
              <PrivateRoute>
                <InvoiceScan />
              </PrivateRoute>
            }
          />
          <Route
            path="/create-order"
            element={
              <PrivateRoute>
                <CreateOrder />
              </PrivateRoute>
            }
          />
          <Route
            path="/manage-stock"
            element={
              <PrivateRoute>
                <ManageStock />
              </PrivateRoute>
            }
          />
          <Route
            path="/manage-employees"
            element={
              <PrivateRoute>
                <ManageEmployees />
              </PrivateRoute>
            }
          />
          <Route
            path="/shop-settings"
            element={
              <PrivateRoute>
                <ShopSettings />
              </PrivateRoute>
            }
          />
          <Route
            path="/salary-info"
            element={
              <PrivateRoute>
                <SalaryInfo />
              </PrivateRoute>
            }
          />
          <Route
            path="/view-invoices"
            element={
              <PrivateRoute>
                <ViewInvoices />
              </PrivateRoute>
            }
          />
          <Route
            path="/ai-chat"
            element={
              <PrivateRoute>
                <AiChat />
              </PrivateRoute>
            }
          />

          {/* Redirect root to dashboard */}
          <Route path="/" element={<Navigate to="/dashboard" />} />
        </Routes>
      </main>

      {/* Optional footer */}
      <footer className="bg-white border-t mt-auto p-4 text-center text-gray-500 text-sm">
        &copy; {new Date().getFullYear()} TRIACT. All rights reserved.
      </footer>
    </div>
  );
}

export default App;
