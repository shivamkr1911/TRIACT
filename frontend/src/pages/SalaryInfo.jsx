import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "../hooks/useAuth";
import authService from "../services/authService";
import { DollarSign, CheckCircle, AlertCircle, RefreshCw } from "lucide-react"; // Using lucide-react

const SalaryInfo = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState(user);
  const [loading, setLoading] = useState(false);

  const fetchLiveProfile = useCallback(async () => {
    try {
      setLoading(true);
      const liveUser = await authService.getCurrentUser();
      if (liveUser) {
        setProfile(liveUser);
      }
    } catch (err) {
      console.error("Failed to fetch live salary info:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLiveProfile();
  }, [fetchLiveProfile]);

  const formatCurrency = (amount) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
    }).format(amount || 0);

  const salaryData = profile?.salary || user?.salary;
  const isPaid = salaryData?.status === "paid";

  return (
    <div className="max-w-xl mx-auto pt-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6 text-center">
        Salary Information
      </h1>

      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
        {/* Header Section */}
        <div className="p-8 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
                <DollarSign size={28} />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">
                  Your Monthly Salary
                </p>
                <p className="text-3xl font-bold text-gray-900">
                  {formatCurrency(salaryData?.amount)}
                </p>
              </div>
            </div>
            <button
              onClick={fetchLiveProfile}
              disabled={loading}
              className="p-2 text-gray-500 hover:text-indigo-600 rounded-lg transition hover:bg-white shadow-sm border border-gray-200"
              title="Refresh Salary Info"
            >
              <RefreshCw size={18} className={loading ? "animate-spin text-indigo-600" : ""} />
            </button>
          </div>
        </div>

        {/* Status Section */}
        <div className="p-8">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">
            Current Payment Status
          </h2>
          {isPaid ? (
            <div className="flex items-center space-x-3 bg-green-50 text-green-700 p-4 rounded-lg border border-green-200">
              <CheckCircle size={24} className="flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-green-800">Paid</h3>
                <p className="text-sm">
                  Your salary for this period has been paid.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center space-x-3 bg-red-50 text-red-700 p-4 rounded-lg border border-red-200">
              <AlertCircle size={24} className="flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-red-800">Due</h3>
                <p className="text-sm">
                  Your salary for this period is pending payment.
                </p>
              </div>
            </div>
          )}

          <p className="text-sm text-gray-500 mt-6 text-center">
            Please contact your shop owner if you have any questions about your
            salary.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SalaryInfo;
