import React, { useEffect, useState } from "react";
import { FileText, Upload, Trash2, Download, Lock } from "lucide-react";
import Skeleton from "./Skeleton";
import EmptyState from "./EmptyState";
import { downloadDoc } from "../utils/downloadDoc";

// Shared documents UI for the welfare admin app and the member portal. The
// admin passes `admin` (sees everything, may set visibility, deletes any); the
// portal passes its axios client and the response tells us officer status +
// which docs are the caller's own. Files open straight from their Cloudinary
// URL. Backend: routes/welfareDocuments.js + portal/member.js documents.
const CATEGORIES = [
  { value: "minutes", label: "Meeting minutes" },
  { value: "statement", label: "Account statement" },
  { value: "constitution", label: "Constitution" },
  { value: "report", label: "Report" },
  { value: "other", label: "Other" },
];
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));
const fmtSize = (b) => (!b ? "" : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const fmtDate = (d) => new Date(d).toLocaleDateString();

export default function WelfareDocumentsPanel({ client, path, admin = false }) {
  const [docs, setDocs] = useState([]);
  const [isOfficer, setIsOfficer] = useState(admin);
  const [myId, setMyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ title: "", category: "other", visibility: "members" });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = (await client.get(path)).data?.data;
      if (Array.isArray(data)) { setDocs(data); setIsOfficer(true); }
      else { setDocs(data?.documents || []); setIsOfficer(!!data?.is_officer); setMyId(data?.my_member_id ?? null); }
      setError("");
    } catch (e) { setError(e.response?.data?.error || "Failed to load documents"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !file) { alert("Add a title and choose a file."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("title", form.title.trim());
      fd.append("category", form.category);
      if (isOfficer) fd.append("visibility", form.visibility);
      fd.append("file", file);
      await client.post(path, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm({ title: "", category: "other", visibility: "members" });
      setFile(null);
      e.target.reset();
      load();
    } catch (e2) { alert(e2.response?.data?.error || "Upload failed"); }
    finally { setBusy(false); }
  };

  const del = async (doc) => {
    if (!window.confirm(`Delete "${doc.title}"?`)) return;
    try { await client.delete(`${path}/${doc.id}`); load(); }
    catch (e) { alert(e.response?.data?.error || "Delete failed"); }
  };
  const canDelete = (doc) => admin || isOfficer || doc.uploaded_by_member === myId;

  return (
    <div className="space-y-6 max-w-3xl">
      <form onSubmit={submit} className="bg-surface rounded-xl shadow-md border border-slate-100 dark:border-slate-700 p-5">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 mb-1 flex items-center gap-2"><Upload size={18} className="text-emerald-600" /> Share a document</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Meeting minutes, account statements, the constitution — PDF, Office, image or text, up to 15 MB.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title (e.g. March AGM minutes)" className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 sm:col-span-2" />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100">
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          {isOfficer && (
            <select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100">
              <option value="members">Visible to all members</option>
              <option value="officers">Officers only</option>
            </select>
          )}
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm text-slate-600 dark:text-slate-400 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 sm:col-span-2 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 file:font-semibold" />
        </div>
        <button type="submit" disabled={busy} className="mt-4 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50 inline-flex items-center gap-2">
          <Upload size={16} /> {busy ? "Uploading…" : "Upload"}
        </button>
      </form>

      <div className="bg-surface rounded-xl shadow-md border border-slate-100 dark:border-slate-700">
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700"><h2 className="font-bold text-slate-900 dark:text-slate-100">Documents</h2></div>
        {loading ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {Array.from({ length: 3 }).map((_, i) => (
                <li key={i} className="px-5 py-3 flex items-center gap-3">
                  <Skeleton className="h-5 w-5 rounded" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <Skeleton className="h-4 w-12" />
                </li>
              ))}
            </ul>
          )
          : error ? <p className="px-5 py-8 text-center text-rose-600">{error}</p>
          : docs.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={FileText}
                title="No documents yet"
                description="Share meeting minutes, account statements or the constitution. Upload one above and the group can open it from here."
                tone="muted"
              />
            </div>
          )
          : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {docs.map((d) => (
                <li key={d.id} className="px-5 py-3 flex items-center gap-3">
                  <FileText size={20} className="text-slate-400 dark:text-slate-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-800 dark:text-slate-100 truncate">{d.title}
                      {d.visibility === "officers" && <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-700"><Lock size={11} /> officers</span>}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{CAT_LABEL[d.category] || d.category} · {d.uploaded_by_name || "—"} · {fmtDate(d.created_at)}{d.size_bytes ? ` · ${fmtSize(d.size_bytes)}` : ""}</p>
                  </div>
                  <button type="button" onClick={() => downloadDoc(d)} className="text-emerald-700 hover:text-emerald-900 font-semibold text-sm inline-flex items-center gap-1 shrink-0"><Download size={15} /> Download</button>
                  {canDelete(d) && <button onClick={() => del(d)} className="text-slate-400 dark:text-slate-400 hover:text-rose-600 shrink-0" title="Delete"><Trash2 size={16} /></button>}
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}
