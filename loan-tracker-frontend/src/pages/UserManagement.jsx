import React, { useState, useEffect } from "react";
import api from "../services/api";
import { getRoleBadge } from "../utils/permissions";

function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    first_name: "",
    last_name: "",
    phone_number: "",
    role: "loan_officer",
  });

  const [editData, setEditData] = useState({});
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await api.get("/users");
      setUsers(response.data.data);
    } catch (err) {
      alert(
        "Failed to fetch users: " +
          (err.response?.data?.error || err.message),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/users", formData);
      alert("✅ User created successfully!");
      setShowAddModal(false);
      setFormData({
        email: "",
        password: "",
        first_name: "",
        last_name: "",
        phone_number: "",
        role: "loan_officer",
      });
      fetchUsers();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditUser = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.put(`/users/${selectedUser.id}`, editData);
      alert("✅ User updated successfully!");
      setShowEditModal(false);
      fetchUsers();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post(`/users/${selectedUser.id}/reset-password`, {
        new_password: newPassword,
      });
      alert(`✅ Password reset for ${selectedUser.email}`);
      setShowPasswordModal(false);
      setNewPassword("");
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleUserStatus = async (user) => {
    if (
      !window.confirm(
        `${user.is_active ? "Deactivate" : "Activate"} ${user.email}?`,
      )
    )
      return;
    try {
      await api.put(`/users/${user.id}`, { is_active: !user.is_active });
      fetchUsers();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    }
  };

  if (loading) return <div className="p-8">Loading users...</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">
            👥 User Management
          </h1>
          <p className="text-gray-600 mt-2">
            Manage staff access and permissions
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-700 text-white font-semibold rounded-lg hover:shadow-lg transition"
        >
          + Add User
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {["admin", "manager", "loan_officer", "viewer"].map((role) => {
          const count = users.filter(
            (u) => u.role === role && u.is_active,
          ).length;
          const badge = getRoleBadge(role);
          return (
            <div key={role} className="bg-white rounded-xl shadow-md p-6">
              <p className="text-sm text-gray-500 uppercase">{badge.label}</p>
              <p className="text-3xl font-bold text-gray-800 mt-2">{count}</p>
              <p className="text-xs text-gray-500 mt-1">Active users</p>
            </div>
          );
        })}
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-xl shadow-md overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b-2 border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                User
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                Role
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                Phone
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                Last Login
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const badge = getRoleBadge(user.role);
              return (
                <tr
                  key={user.id}
                  className="border-b border-gray-100 hover:bg-gray-50"
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold text-gray-800">
                      {user.first_name} {user.last_name}
                    </p>
                    <p className="text-sm text-gray-500">{user.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${badge.color}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {user.phone_number || "-"}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {user.last_login
                      ? new Date(user.last_login).toLocaleString()
                      : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                        user.is_active
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {user.is_active ? "✓ Active" : "✕ Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setSelectedUser(user);
                          setEditData({
                            first_name: user.first_name,
                            last_name: user.last_name,
                            phone_number: user.phone_number,
                            role: user.role,
                            is_active: user.is_active,
                          });
                          setShowEditModal(true);
                        }}
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => {
                          setSelectedUser(user);
                          setNewPassword("");
                          setShowPasswordModal(true);
                        }}
                        className="text-purple-600 hover:text-purple-800 text-sm"
                      >
                        🔑 Reset Password
                      </button>
                      <button
                        onClick={() => toggleUserStatus(user)}
                        className={`text-sm ${
                          user.is_active
                            ? "text-red-600 hover:text-red-800"
                            : "text-green-600 hover:text-green-800"
                        }`}
                      >
                        {user.is_active ? "🚫 Deactivate" : "✅ Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-2xl w-full">
            <h3 className="text-2xl font-bold mb-6">Add New User</h3>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    First Name *
                  </label>
                  <input
                    type="text"
                    value={formData.first_name}
                    onChange={(e) =>
                      setFormData({ ...formData, first_name: e.target.value })
                    }
                    required
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    Last Name *
                  </label>
                  <input
                    type="text"
                    value={formData.last_name}
                    onChange={(e) =>
                      setFormData({ ...formData, last_name: e.target.value })
                    }
                    required
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Email *
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  required
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Phone Number
                </label>
                <input
                  type="text"
                  value={formData.phone_number}
                  onChange={(e) =>
                    setFormData({ ...formData, phone_number: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Password * (min 12 chars, 1 uppercase, 1 number, 1 symbol)
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                  required
                  minLength="12"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Role *
                </label>
                <select
                  value={formData.role}
                  onChange={(e) =>
                    setFormData({ ...formData, role: e.target.value })
                  }
                  required
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none bg-white"
                >
                  <option value="loan_officer">💼 Loan Officer</option>
                  <option value="manager">📊 Manager</option>
                  <option value="viewer">👁️ Viewer</option>
                  <option value="admin">👑 Admin</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {formData.role === "admin" &&
                    "⚠️ Admin has full access including user management"}
                  {formData.role === "manager" &&
                    "Manager can do everything except create users and settings"}
                  {formData.role === "loan_officer" &&
                    "Can manage clients, loans, and payments"}
                  {formData.role === "viewer" &&
                    "Read-only access to view records"}
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-6 py-2 bg-gray-500 text-white rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-gradient-to-r from-purple-600 to-indigo-700 text-white rounded-lg disabled:opacity-50"
                >
                  {submitting ? "Creating..." : "✓ Create User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-2xl w-full">
            <h3 className="text-2xl font-bold mb-6">
              Edit User: {selectedUser.email}
            </h3>
            <form onSubmit={handleEditUser} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    First Name
                  </label>
                  <input
                    type="text"
                    value={editData.first_name || ""}
                    onChange={(e) =>
                      setEditData({ ...editData, first_name: e.target.value })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={editData.last_name || ""}
                    onChange={(e) =>
                      setEditData({ ...editData, last_name: e.target.value })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Phone Number
                </label>
                <input
                  type="text"
                  value={editData.phone_number || ""}
                  onChange={(e) =>
                    setEditData({ ...editData, phone_number: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Role</label>
                <select
                  value={editData.role || ""}
                  onChange={(e) =>
                    setEditData({ ...editData, role: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none bg-white"
                >
                  <option value="loan_officer">💼 Loan Officer</option>
                  <option value="manager">📊 Manager</option>
                  <option value="viewer">👁️ Viewer</option>
                  <option value="admin">👑 Admin</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-6 py-2 bg-gray-500 text-white rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50"
                >
                  {submitting ? "Saving..." : "✓ Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showPasswordModal && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full">
            <h3 className="text-2xl font-bold mb-2">Reset Password</h3>
            <p className="text-gray-600 mb-4">For: {selectedUser.email}</p>
            <form onSubmit={handleResetPassword}>
              <div className="mb-4">
                <label className="block text-sm font-semibold mb-1">
                  New Password *
                </label>
                <input
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength="12"
                  placeholder="Min 12 chars, 1 uppercase, 1 number, 1 symbol"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Share this password with the user securely
                </p>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="px-6 py-2 bg-gray-500 text-white rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-purple-600 text-white rounded-lg disabled:opacity-50"
                >
                  {submitting ? "Resetting..." : "🔑 Reset Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserManagement;
