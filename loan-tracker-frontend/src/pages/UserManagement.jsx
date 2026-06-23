import React, { useState, useEffect } from "react";
import {
  Users,
  Pencil,
  KeyRound,
  UserX,
  UserCheck,
  Check,
  X,
  AlertTriangle,
  Eye,
  EyeOff,
} from "lucide-react";
import api from "../services/api";
import { getRoleBadge } from "../utils/permissions";
import { apiErrorMessage } from "../utils/apiError";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import Skeleton from "../components/Skeleton";
import DataTable from "../components/DataTable";
import { useColumnPreset } from "../hooks/useTablePrefs";

// ── Users table column model ──────────────────────────────────────────
// Column-driven so the page can offer client-side presets (which columns
// render in the row) and push the rest into an expandable detail row.
// The User identity (name + email) is pinned and rendered specially, so
// it is NOT part of this generic list. Action handlers are injected via
// the `actions` arg so the column cells stay pure presentation.
const userColumns = ({ onEdit, onReset, onToggleStatus }) => [
  {
    key: "role",
    label: "Role",
    align: "left",
    cell: (user) => {
      const badge = getRoleBadge(user.role);
      return (
        <span
          className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${badge.color}`}
        >
          {badge.label}
        </span>
      );
    },
  },
  {
    key: "phone_number",
    label: "Phone",
    align: "left",
    cell: (user) => (
      <span className="text-gray-700 dark:text-slate-200">
        {user.phone_number || "-"}
      </span>
    ),
  },
  {
    key: "last_login",
    label: "Last Login",
    align: "left",
    cell: (user) => (
      <span className="text-sm text-gray-600 dark:text-slate-400">
        {user.last_login
          ? new Date(user.last_login).toLocaleString("en-GB")
          : "Never"}
      </span>
    ),
  },
  {
    key: "is_active",
    label: "Status",
    align: "left",
    cell: (user) => (
      <span
        className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
          user.is_active
            ? "bg-green-100 text-green-700"
            : "bg-red-100 text-red-700"
        }`}
      >
        {user.is_active ? (
          <span className="inline-flex items-center gap-1">
            <Check size={12} /> Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <X size={12} /> Inactive
          </span>
        )}
      </span>
    ),
  },
  {
    key: "actions",
    label: "Actions",
    align: "left",
    cell: (user) => (
      <div className="flex gap-2">
        <button
          onClick={() => onEdit(user)}
          className="text-ocean-600 hover:text-ocean-800 text-sm inline-flex items-center gap-1"
        >
          <Pencil size={14} /> Edit
        </button>
        <button
          onClick={() => onReset(user)}
          className="text-ocean-600 hover:text-ocean-800 text-sm inline-flex items-center gap-1"
        >
          <KeyRound size={14} /> Reset Password
        </button>
        <button
          onClick={() => onToggleStatus(user)}
          className={`text-sm inline-flex items-center gap-1 ${
            user.is_active
              ? "text-red-600 hover:text-red-800"
              : "text-green-600 hover:text-green-800"
          }`}
        >
          {user.is_active ? (
            <>
              <UserX size={14} /> Deactivate
            </>
          ) : (
            <>
              <UserCheck size={14} /> Activate
            </>
          )}
        </button>
      </div>
    ),
  },
];

// Column presets — which keys render in the row. The User identity is
// always pinned and shown outside this set. Hidden keys drop into the
// expandable detail row, so no data is ever lost — just demoted.
const COLUMN_PRESETS = {
  essentials: {
    label: "Essentials",
    keys: ["role", "is_active", "actions"],
  },
  full: {
    label: "Everything",
    keys: ["role", "phone_number", "last_login", "is_active", "actions"],
  },
};

const PRESET_STORAGE_KEY = "userManagement.columnPreset";

function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Per-field reveal toggles. Tracking each input separately so
  // showing the create-password doesn't also reveal the confirm
  // (which would defeat the typo-catching purpose of confirm).
  const [showCreatePwd, setShowCreatePwd] = useState(false);
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);
  const [showResetPwd, setShowResetPwd] = useState(false);

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirm_password: "",
    first_name: "",
    last_name: "",
    phone_number: "",
    role: "loan_officer",
  });

  const [editData, setEditData] = useState({});
  const [newPassword, setNewPassword] = useState("");

  // ── Table UX state (client-side only) ─────────────────────────
  // Expanded rows reveal columns demoted by the active preset.
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const toggleRow = (id) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Column preset — shared hook, localStorage only. (No filters on this
  // page, so there are no saved segments to manage.)
  const [columnPreset, setColumnPreset] = useColumnPreset(
    PRESET_STORAGE_KEY,
    COLUMN_PRESETS,
    "full",
  );

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
        "Failed to fetch users: " + apiErrorMessage(err, ""),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    // Catch typos client-side so the admin sees "passwords don't match"
    // before the request lands. Backend also enforces validatePassword
    // on the single password field, so this is purely a UX layer.
    if (formData.password !== formData.confirm_password) {
      alert("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const { confirm_password: _ignored, ...payload } = formData;
      await api.post("/users", payload);
      alert("User created successfully!");
      setShowAddModal(false);
      setShowCreatePwd(false);
      setShowCreateConfirm(false);
      setFormData({
        email: "",
        password: "",
        confirm_password: "",
        first_name: "",
        last_name: "",
        phone_number: "",
        role: "loan_officer",
      });
      fetchUsers();
    } catch (err) {
      alert(apiErrorMessage(err, "Operation failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditUser = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.put(`/users/${selectedUser.id}`, editData);
      alert("User updated successfully!");
      setShowEditModal(false);
      fetchUsers();
    } catch (err) {
      alert(apiErrorMessage(err, "Operation failed"));
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
      alert(`Password reset for ${selectedUser.email}`);
      setShowPasswordModal(false);
      setShowResetPwd(false);
      setNewPassword("");
    } catch (err) {
      alert(apiErrorMessage(err, "Operation failed"));
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
      alert(apiErrorMessage(err, "Operation failed"));
    }
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        <div className="mb-6">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-80 mt-3" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-6">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-12 mt-3" />
              <Skeleton className="h-3 w-16 mt-2" />
            </div>
          ))}
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-6 space-y-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const roleStats = ["admin", "manager", "loan_officer", "viewer"];

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      <PageHeader
        icon={Users}
        title="User Management"
        subtitle="Manage staff access and permissions"
        kpis={roleStats.map((role) => ({
          label: getRoleBadge(role).label,
          value: users.filter((u) => u.role === role && u.is_active).length,
          hint: "Active users",
        }))}
        actions={
          <button
            onClick={() => setShowAddModal(true)}
            className="px-6 py-3 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition"
          >
            + Add User
          </button>
        }
      />

      {/* Users Table */}
      {users.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No users yet"
          description="Invite your first staff member to give them access to the app."
          action={
            <button
              onClick={() => setShowAddModal(true)}
              className="px-6 py-3 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition"
            >
              + Add User
            </button>
          }
        />
      ) : (
        <DataTable
          columns={userColumns({
            onEdit: (user) => {
              setSelectedUser(user);
              setEditData({
                first_name: user.first_name,
                last_name: user.last_name,
                phone_number: user.phone_number,
                role: user.role,
                is_active: user.is_active,
              });
              setShowEditModal(true);
            },
            onReset: (user) => {
              setSelectedUser(user);
              setNewPassword("");
              setShowPasswordModal(true);
            },
            onToggleStatus: toggleUserStatus,
          })}
          rows={users}
          rowKey={(u) => u.id}
          pinned={{
            label: "User",
            cell: (user) => (
              <div>
                <p className="font-semibold text-gray-800 dark:text-slate-100">
                  {user.first_name} {user.last_name}
                </p>
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  {user.email}
                </p>
              </div>
            ),
          }}
          presets={COLUMN_PRESETS}
          preset={columnPreset}
          onPresetChange={setColumnPreset}
          expandedRows={expandedRows}
          onToggleRow={toggleRow}
          loading={loading}
          skeletonRows={6}
          skeletonCols={6}
          empty={
            <EmptyState
              icon={Users}
              tone="muted"
              title="No users to show"
              description="Add a staff member to get started."
            />
          }
        />
      )}

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-8 max-w-2xl w-full">
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
                    className="w-full px-3 py-2 border-2 border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none"
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
                    className="w-full px-3 py-2 border-2 border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none"
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
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
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
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Password * (min 12 chars, 1 uppercase, 1 number, 1 symbol)
                </label>
                <div className="relative">
                  <input
                    type={showCreatePwd ? "text" : "password"}
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({ ...formData, password: e.target.value })
                    }
                    required
                    minLength="12"
                    className="w-full px-3 py-2 pr-10 border-2 border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreatePwd((s) => !s)}
                    aria-label={showCreatePwd ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
                  >
                    {showCreatePwd ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Confirm Password *
                </label>
                <div className="relative">
                  <input
                    type={showCreateConfirm ? "text" : "password"}
                    value={formData.confirm_password}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        confirm_password: e.target.value,
                      })
                    }
                    required
                    minLength="12"
                    className={`w-full px-3 py-2 pr-10 border-2 rounded-lg focus:outline-none dark:bg-slate-900 dark:text-slate-100 ${
                      formData.confirm_password &&
                      formData.confirm_password !== formData.password
                        ? "border-rose-300 focus:border-rose-500"
                        : "border-gray-200 dark:border-slate-600 focus:border-ocean-500"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreateConfirm((s) => !s)}
                    aria-label={
                      showCreateConfirm ? "Hide password" : "Show password"
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
                  >
                    {showCreateConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {formData.confirm_password &&
                  formData.confirm_password !== formData.password && (
                    <p className="text-xs text-rose-600 mt-1">
                      Passwords don't match yet
                    </p>
                  )}
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
                  className="w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 rounded-lg focus:border-ocean-500 focus:outline-none bg-white dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="loan_officer">Loan Officer</option>
                  <option value="manager">Manager</option>
                  <option value="viewer">Viewer</option>
                  <option value="admin">Admin</option>
                </select>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                  {formData.role === "admin" && (
                    <span className="inline-flex items-center gap-1">
                      <AlertTriangle size={12} /> Admin has full access including user management
                    </span>
                  )}
                  {formData.role === "manager" &&
                    "Manager can do everything except create users and settings"}
                  {formData.role === "loan_officer" &&
                    "Can manage clients, loans, and payments"}
                  {formData.role === "viewer" &&
                    "Read-only access to view records"}
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t dark:border-slate-700">
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
                  className="px-6 py-2 bg-ocean-gradient text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {submitting ? "Creating..." : <><Check size={14} /> Create User</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-8 max-w-2xl w-full">
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
                    className="w-full px-3 py-2 border-2 border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none"
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
                    className="w-full px-3 py-2 border-2 border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none"
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
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Role</label>
                <select
                  value={editData.role || ""}
                  onChange={(e) =>
                    setEditData({ ...editData, role: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 rounded-lg focus:border-ocean-500 focus:outline-none bg-white dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="loan_officer">Loan Officer</option>
                  <option value="manager">Manager</option>
                  <option value="viewer">Viewer</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t dark:border-slate-700">
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
                  className="px-6 py-2 bg-ocean-600 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {submitting ? "Saving..." : <><Check size={14} /> Save Changes</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showPasswordModal && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-8 max-w-md w-full">
            <h3 className="text-2xl font-bold mb-2">Reset Password</h3>
            <p className="text-gray-600 dark:text-slate-400 mb-4">For: {selectedUser.email}</p>
            <form onSubmit={handleResetPassword}>
              <div className="mb-4">
                <label className="block text-sm font-semibold mb-1">
                  New Password *
                </label>
                <div className="relative">
                  <input
                    type={showResetPwd ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength="12"
                    placeholder="Min 12 chars, 1 uppercase, 1 number, 1 symbol"
                    className="w-full px-3 py-2 pr-10 border-2 border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPwd((s) => !s)}
                    aria-label={showResetPwd ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
                  >
                    {showResetPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                  Click the eye to reveal · share with the user securely
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
                  className="px-6 py-2 bg-ocean-600 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {submitting ? "Resetting..." : <><KeyRound size={14} /> Reset Password</>}
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
