import React, { useState, useEffect } from "react";
import {
  Save,
  Upload,
  Download,
  RotateCcw,
  Trash2,
  AlertTriangle,
  Info,
} from "lucide-react";
import api from "../services/api";
import Spinner from "../components/Spinner";

function Backup() {
  const [backups, setBackups] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [backupsRes, statsRes] = await Promise.all([
        api.get("/backup"),
        api.get("/backup/stats"),
      ]);
      setBackups(backupsRes.data.data);
      setStats(statsRes.data.data);
    } catch (err) {
      console.error("Failed to fetch backup data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBackup = async () => {
    if (!window.confirm("Create a new database backup?")) return;
    setCreating(true);
    try {
      const res = await api.post("/backup/create");
      alert(
        `Backup created: ${res.data.data.filename} (${res.data.data.size_mb} MB)`,
      );
      fetchData();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = async (backup) => {
    try {
      const response = await api.get(`/backup/${backup.id}/download`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = backup.filename;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Download failed: " + (err.response?.data?.error || err.message));
    }
  };

  const handleRestore = async () => {
    if (confirmText !== "RESTORE") {
      alert("Please type RESTORE to confirm");
      return;
    }
    setRestoring(true);
    try {
      await api.post(`/backup/${selectedBackup.id}/restore`, {
        confirm: "RESTORE",
      });
      alert("Database restored successfully! The page will reload.");
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      alert("Restore failed: " + (err.response?.data?.error || err.message));
      setRestoring(false);
    }
  };

  const handleDelete = async (backup) => {
    if (
      !window.confirm(
        `Delete backup "${backup.filename}"? This cannot be undone.`,
      )
    )
      return;
    try {
      await api.delete(`/backup/${backup.id}`);
      alert("Backup deleted");
      fetchData();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    }
  };

  const handleUploadRestore = async (e) => {
    e.preventDefault();
    if (!uploadFile) {
      alert("Please select a backup file");
      return;
    }
    if (confirmText !== "RESTORE") {
      alert("Please type RESTORE to confirm");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("backup", uploadFile);
      formData.append("confirm", "RESTORE");
      await api.post("/backup/upload-restore", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      alert("Database restored from uploaded backup! Page will reload.");
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
      setUploading(false);
    }
  };

  const handleCleanup = async () => {
    if (!window.confirm("Delete backups older than 30 days?")) return;
    try {
      const res = await api.post("/backup/cleanup", { retention_days: 30 });
      alert(`Deleted ${res.data.deleted_count} old backups`);
      fetchData();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes) return "0 B";
    const mb = bytes / 1024 / 1024;
    return mb > 1 ? `${mb.toFixed(2)} MB` : `${(bytes / 1024).toFixed(2)} KB`;
  };

  if (loading) return <Spinner centered className="py-20" label="Loading backups…" />;

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
            <Save size={28} /> Backup &amp; Restore
          </h1>
          <p className="text-gray-600 mt-2">
            Protect your data with regular backups
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setConfirmText("");
              setUploadFile(null);
              setShowUploadModal(true);
            }}
            className="px-4 py-3 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-lg inline-flex items-center gap-2"
          >
            <Upload size={16} /> Upload &amp; Restore
          </button>
          <button
            onClick={handleCreateBackup}
            disabled={creating}
            className="px-6 py-3 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg disabled:opacity-50"
          >
            {creating ? "Creating..." : "+ Create Backup"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-ocean-gradient text-white rounded-xl shadow-lg p-6">
          <p className="text-ocean-100 text-sm uppercase">Total Backups</p>
          <p className="text-3xl font-bold mt-2">
            {stats?.total_backups || 0}
          </p>
        </div>
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 text-white rounded-xl shadow-lg p-6">
          <p className="text-green-100 text-sm uppercase">Successful</p>
          <p className="text-3xl font-bold mt-2">{stats?.successful || 0}</p>
        </div>
        <div className="bg-gradient-to-br from-blue-500 to-cyan-600 text-white rounded-xl shadow-lg p-6">
          <p className="text-blue-100 text-sm uppercase">Total Size</p>
          <p className="text-3xl font-bold mt-2">
            {formatBytes(stats?.total_size)}
          </p>
        </div>
        <div className="bg-gradient-to-br from-orange-500 to-red-600 text-white rounded-xl shadow-lg p-6">
          <p className="text-orange-100 text-sm uppercase">Last Backup</p>
          <p className="text-lg font-bold mt-2">
            {stats?.last_backup
              ? new Date(stats.last_backup).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
              : "Never"}
          </p>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
        <h3 className="font-bold text-blue-900 mb-2 flex items-center gap-2">
          <Info size={16} className="text-blue-700" /> Backup Information
        </h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Automatic backups run daily at 2:00 AM</li>
          <li>• Scheduled/manual backups older than 30 days are auto-deleted</li>
          <li>• A safety backup is created before any restore operation</li>
          <li>
            • Restore runs in a single transaction — a bad file rolls back
            and leaves the live database unchanged
          </li>
        </ul>
      </div>

      <div className="flex justify-end mb-4">
        <button
          onClick={handleCleanup}
          className="text-sm text-gray-600 hover:text-gray-800 inline-flex items-center gap-1"
        >
          <Trash2 size={14} /> Cleanup Old Backups
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-md overflow-hidden">
        <div className="overflow-auto max-h-[600px]">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0 border-b-2">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Filename
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Size
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Created
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  By
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
              {backups.length === 0 ? (
                <tr>
                  <td colSpan="7" className="p-12 text-center text-gray-500">
                    No backups yet. Create your first backup!
                  </td>
                </tr>
              ) : (
                backups.map((backup) => (
                  <tr
                    key={backup.id}
                    className="border-b hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 font-mono text-sm">
                      {backup.filename}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${
                          backup.backup_type === "manual"
                            ? "bg-blue-100 text-blue-700"
                            : backup.backup_type === "scheduled"
                              ? "bg-ocean-100 text-ocean-700"
                              : backup.backup_type === "pre_restore"
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-orange-100 text-orange-700"
                        }`}
                      >
                        {backup.backup_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {formatBytes(backup.file_size)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {new Date(backup.created_at).toLocaleString("en-GB")}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {backup.first_name
                        ? `${backup.first_name} ${backup.last_name}`
                        : "System"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${
                          backup.status === "success"
                            ? "bg-green-100 text-green-700"
                            : backup.status === "failed"
                              ? "bg-red-100 text-red-700"
                              : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {backup.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {backup.status === "success" && (
                          <>
                            <button
                              onClick={() => handleDownload(backup)}
                              className="text-blue-600 hover:text-blue-800"
                              title="Download"
                            >
                              <Download size={16} />
                            </button>
                            <button
                              onClick={() => {
                                setSelectedBackup(backup);
                                setConfirmText("");
                                setShowRestoreModal(true);
                              }}
                              className="text-orange-600 hover:text-orange-800"
                              title="Restore"
                            >
                              <RotateCcw size={16} />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleDelete(backup)}
                          className="text-red-600 hover:text-red-800"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showRestoreModal && selectedBackup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full">
            <h3 className="text-2xl font-bold mb-4 flex items-center gap-2"><AlertTriangle size={22} className="text-red-600" /> Restore Database</h3>
            <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4 mb-4">
              <p className="font-bold text-red-800 mb-2 flex items-center gap-1"><AlertTriangle size={14} /> WARNING</p>
              <p className="text-sm text-red-700">
                This REPLACES ALL current data with the backup. A safety
                backup is taken first, and the restore runs in one
                transaction (rolls back if the file is bad).
              </p>
            </div>
            <div className="mb-4">
              <p className="text-sm text-gray-600">Restore from:</p>
              <p className="font-mono text-sm font-bold">
                {selectedBackup.filename}
              </p>
              <p className="text-xs text-gray-500">
                Created:{" "}
                {new Date(selectedBackup.created_at).toLocaleString("en-GB")}
              </p>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-2">
                Type{" "}
                <code className="bg-gray-100 px-2 py-1 rounded">RESTORE</code>{" "}
                to confirm:
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type RESTORE"
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-red-500 focus:outline-none font-mono"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowRestoreModal(false)}
                disabled={restoring}
                className="px-6 py-2 bg-gray-500 text-white rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleRestore}
                disabled={restoring || confirmText !== "RESTORE"}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
              >
                {restoring ? "Restoring..." : <span className="inline-flex items-center gap-2"><RotateCcw size={16} /> Restore Database</span>}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full">
            <h3 className="text-2xl font-bold mb-4 flex items-center gap-2"><Upload size={22} /> Upload &amp; Restore</h3>
            <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4 mb-4">
              <p className="text-sm text-yellow-800 flex items-start gap-1">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> Upload a .sql backup to restore the database. This
                REPLACES all current data (safety backup taken first).
              </p>
            </div>
            <form onSubmit={handleUploadRestore}>
              <div className="mb-4">
                <label className="block text-sm font-semibold mb-2">
                  Backup File (.sql)
                </label>
                <input
                  type="file"
                  accept=".sql"
                  onChange={(e) => setUploadFile(e.target.files[0])}
                  required
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-semibold mb-2">
                  Type{" "}
                  <code className="bg-gray-100 px-2 py-1 rounded">
                    RESTORE
                  </code>{" "}
                  to confirm:
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="Type RESTORE"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-orange-500 focus:outline-none font-mono"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-6 py-2 bg-gray-500 text-white rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    uploading || confirmText !== "RESTORE" || !uploadFile
                  }
                  className="px-6 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg disabled:opacity-50"
                >
                  {uploading ? "Uploading..." : <span className="inline-flex items-center gap-2"><Upload size={16} /> Upload &amp; Restore</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Backup;
