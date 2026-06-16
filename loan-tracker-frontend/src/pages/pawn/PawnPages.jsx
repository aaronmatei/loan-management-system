import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Gem, Wallet, AlertTriangle, Banknote, CheckCircle2, Gavel,
  Plus, Search, ChevronRight, TrendingUp, X,
} from "lucide-react";
import api from "../../services/api";
import PermissionGate from "../../components/PermissionGate";
import PawnLoanModal from "../../components/PawnLoanModal";

const money = (v) => "KES " + Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const money2 = (v) => "KES " + Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function PageHeader({ title, action }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
      <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">{title}</h1>
      {action}
    </div>
  );
}

const STATUS = {
  active: "bg-emerald-100 text-emerald-800",
  completed: "bg-slate-200 text-slate-700",
  defaulted: "bg-red-100 text-red-700",
};
const COLL = {
  held: "bg-ocean-100 text-ocean-700",
  returned: "bg-emerald-100 text-emerald-800",
  forfeited: "bg-amber-100 text-amber-800",
  sold: "bg-slate-200 text-slate-700",
};

// ── Dashboard ────────────────────────────────────────────────────────
const TONES = {
  emerald: "bg-emerald-50 text-emerald-800",
  ocean: "bg-ocean-50 text-ocean-800",
  amber: "bg-amber-50 text-amber-800",
  rose: "bg-rose-50 text-rose-800",
  slate: "bg-slate-50 text-slate-800",
};
function Stat({ icon: Icon, label, value, sub, tone = "slate" }) {
  const [bg, text] = (TONES[tone] || TONES.slate).split(" ");
  return (
    <div className={`${bg} rounded-lg p-4`}>
      <p className="text-xs text-slate-500 flex items-center gap-1"><Icon size={13} /> {label}</p>
      <p className={`font-bold ${text} text-xl leading-tight mt-0.5`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export function PawnDashboard() {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get("/pawn/summary").then((r) => setD(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto pb-24">
      <PageHeader title="Dashboard" />
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !d ? (
        <p className="text-sm text-slate-500">Couldn't load the dashboard.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat icon={Gem} label="Active pledges" value={d.active_pledges} sub={`${money(d.due_from_customers)} due`} tone="ocean" />
          <Stat icon={Banknote} label="Cash out on loan" value={money(d.cash_out)} tone="emerald" />
          <Stat icon={Wallet} label="Collateral value" value={money(d.collateral_value)} sub="items held" tone="slate" />
          <Stat icon={Wallet} label="Capital available" value={money(d.capital_available)} tone="emerald" />
          <Stat icon={AlertTriangle} label="Overdue" value={d.overdue} sub={`${d.due_soon} due ≤7 days`} tone="rose" />
          <Stat icon={Gavel} label="Auction queue" value={d.overdue} sub={`${d.forfeited} forfeited`} tone="amber" />
          <Stat icon={CheckCircle2} label="Redeemed today" value={d.redeemed_today} tone="emerald" />
          <Stat icon={TrendingUp} label="Interest earned" value={money(d.interest_earned)} tone="slate" />
        </div>
      )}
    </div>
  );
}

// ── Pledges ──────────────────────────────────────────────────────────
function PledgeTable({ rows, onRow }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
          <tr>
            <th className="text-left px-4 py-2">Code</th>
            <th className="text-left px-4 py-2">Customer</th>
            <th className="text-left px-4 py-2">Item</th>
            <th className="text-right px-4 py-2">Principal</th>
            <th className="text-right px-4 py-2">Balance</th>
            <th className="text-left px-4 py-2">Status</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id} onClick={() => onRow(l)} className="border-t border-slate-100 hover:bg-ocean-50/50 cursor-pointer">
              <td className="px-4 py-2 font-mono text-xs text-slate-600">{l.loan_code}</td>
              <td className="px-4 py-2 font-semibold text-slate-800">{l.first_name} {l.last_name}</td>
              <td className="px-4 py-2 text-slate-600">{l.item || "—"}{l.overdue && <span className="ml-2 text-xs font-semibold text-red-600">OVERDUE</span>}</td>
              <td className="px-4 py-2 text-right">{money(l.principal_amount)}</td>
              <td className="px-4 py-2 text-right font-semibold">{money2(l.balance)}</td>
              <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[l.status] || "bg-slate-100"}`}>{l.status}</span></td>
              <td className="px-4 py-2 text-right"><ChevronRight size={16} className="inline text-ocean-400" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PawnPledges() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [showNew, setShowNew] = useState(false);

  const load = async () => {
    try {
      const [p, c] = await Promise.all([api.get("/pawn"), api.get("/clients").catch(() => ({ data: { data: [] } }))]);
      setRows(p.data.data || []);
      setClients(c.data.data || []);
    } catch { /* */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filtered = rows.filter((l) => {
    if (status === "overdue" ? !l.overdue : status !== "all" && l.status !== status) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return [l.loan_code, l.first_name, l.last_name, l.item].some((v) => (v || "").toLowerCase().includes(s));
  });

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto pb-24">
      <PageHeader
        title="Pledges"
        action={
          <PermissionGate role={["admin", "manager", "loan_officer"]}>
            <button onClick={() => setShowNew(true)} className="px-4 py-2 bg-ocean-600 hover:bg-ocean-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5"><Plus size={15} /> New Pledge</button>
          </PermissionGate>
        }
      />
      <div className="bg-white rounded-xl shadow-md border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code, customer or item…" className="w-full pl-9 pr-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="overdue">Overdue</option>
            <option value="completed">Redeemed</option>
            <option value="defaulted">Forfeited</option>
          </select>
        </div>
        {loading ? <p className="p-5 text-sm text-slate-500">Loading…</p> : filtered.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No pledges{search || status !== "all" ? " match your filter" : " yet. Take in an item to start."}.</p>
        ) : <PledgeTable rows={filtered} onRow={(l) => navigate(`/pawn/pledges/${l.id}`)} />}
      </div>

      {showNew && <PawnLoanModal clients={clients} onClose={() => setShowNew(false)} onCreated={(loan) => { setShowNew(false); if (loan?.id) navigate(`/pawn/pledges/${loan.id}`); else load(); }} />}
    </div>
  );
}

// ── Auctions ─────────────────────────────────────────────────────────
export function PawnAuctions() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get("/pawn").then((r) => setRows(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const queue = rows.filter((l) => l.overdue); // active + past maturity → eligible for auction
  const disposed = rows.filter((l) => ["forfeited", "sold"].includes(l.collateral_status));

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto pb-24">
      <PageHeader title="Auctions" />
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-md border border-amber-100 overflow-hidden">
            <div className="bg-amber-50 px-5 py-3 border-b border-amber-100">
              <h2 className="font-bold text-slate-900 flex items-center gap-2"><Gavel size={18} className="text-amber-600" /> Auction queue <span className="text-sm font-normal text-slate-500">· overdue pledges</span></h2>
            </div>
            {queue.length === 0 ? <p className="p-5 text-sm text-slate-500">Nothing overdue. The queue is clear.</p> : (
              <PledgeTable rows={queue} onRow={(l) => navigate(`/pawn/pledges/${l.id}`)} />
            )}
          </div>

          <div className="bg-white rounded-xl shadow-md border border-slate-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100"><h2 className="font-bold text-slate-900">Disposed items</h2></div>
            {disposed.length === 0 ? <p className="p-5 text-sm text-slate-500">No forfeited or sold items yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-2">Code</th>
                      <th className="text-left px-4 py-2">Item</th>
                      <th className="text-right px-4 py-2">Appraised</th>
                      <th className="text-left px-4 py-2">Outcome</th>
                      <th className="text-right px-4 py-2">Recovered</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {disposed.map((l) => (
                      <tr key={l.id} onClick={() => navigate(`/pawn/pledges/${l.id}`)} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">{l.loan_code}</td>
                        <td className="px-4 py-2 text-slate-700">{l.item || "—"}</td>
                        <td className="px-4 py-2 text-right">{money(l.appraised_value)}</td>
                        <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${COLL[l.collateral_status] || "bg-slate-100"}`}>{l.collateral_status}</span></td>
                        <td className="px-4 py-2 text-right">{l.sale_amount != null ? money(l.sale_amount) : "—"}</td>
                        <td className="px-4 py-2 text-right"><ChevronRight size={16} className="inline text-slate-400" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Requests (customer pawn applications) ────────────────────────────
const APP_STATUS = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-700",
  withdrawn: "bg-slate-200 text-slate-600",
  converted: "bg-ocean-100 text-ocean-700",
};

export function PawnRequests() {
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState(null); // application being reviewed
  const [convert, setConvert] = useState(null); // application being converted

  const load = async () => {
    try {
      const [a, c] = await Promise.all([api.get("/pawn/applications"), api.get("/clients").catch(() => ({ data: { data: [] } }))]);
      setRows(a.data.data || []);
      setClients(c.data.data || []);
    } catch { /* */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto pb-24">
      <PageHeader title="Requests" />
      <div className="bg-white rounded-xl shadow-md border border-slate-100 overflow-hidden">
        {loading ? <p className="p-5 text-sm text-slate-500">Loading…</p> : rows.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No customer requests yet. Customers can request a loan against an item from their portal.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Customer</th>
                  <th className="text-left px-4 py-2">Item</th>
                  <th className="text-right px-4 py-2">Requested</th>
                  <th className="text-right px-4 py-2">Est. value</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-semibold text-slate-800">{a.first_name} {a.last_name}<div className="text-xs text-slate-400 font-normal">{a.phone_number}</div></td>
                    <td className="px-4 py-2 text-slate-600">{a.item_description}{a.item_category ? <span className="text-slate-400"> · {a.item_category}</span> : ""}</td>
                    <td className="px-4 py-2 text-right">{a.requested_amount != null ? money(a.requested_amount) : "—"}</td>
                    <td className="px-4 py-2 text-right text-slate-500">{a.estimated_value != null ? money(a.estimated_value) : "—"}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${APP_STATUS[a.status] || "bg-slate-100"}`}>{a.status}</span>
                      {a.status === "approved" && a.offered_amount != null && <span className="ml-2 text-xs text-emerald-700">offer {money(a.offered_amount)}</span>}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <PermissionGate role={["admin", "manager", "loan_officer"]}>
                        {a.status === "pending" && <button onClick={() => setReview(a)} className="text-ocean-600 hover:text-ocean-800 font-semibold text-sm">Review</button>}
                        {a.status === "approved" && <button onClick={() => setConvert(a)} className="text-emerald-600 hover:text-emerald-800 font-semibold text-sm">Convert to pledge</button>}
                      </PermissionGate>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {review && <ReviewModal application={review} onClose={() => setReview(null)} onDone={() => { setReview(null); load(); }} />}
      {convert && <PawnLoanModal clients={clients} application={convert} onClose={() => setConvert(null)} onCreated={() => { setConvert(null); load(); }} />}
    </div>
  );
}

function ReviewModal({ application, onClose, onDone }) {
  const [offer, setOffer] = useState(application.requested_amount || "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const decide = async (decision) => {
    setError(""); setBusy(true);
    try {
      await api.post(`/pawn/applications/${application.id}/review`, { decision, offered_amount: decision === "approved" ? offer : undefined, notes });
      onDone();
    } catch (e) { setError(e.response?.data?.error || "Failed"); setBusy(false); }
  };

  const fld = "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none";
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md my-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">Review request</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"><AlertTriangle size={15} /> {error}</div>}
          <div className="text-sm text-slate-600">
            <p className="font-semibold text-slate-800">{application.item_description}</p>
            <p>{[application.item_category, application.condition].filter(Boolean).join(" · ")}</p>
            <p className="mt-1">Requested: <strong>{application.requested_amount != null ? money(application.requested_amount) : "—"}</strong>{application.estimated_value != null ? ` · est. ${money(application.estimated_value)}` : ""}</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Your offer (KES)</label>
            <input type="number" value={offer} onChange={(e) => setOffer(e.target.value)} className={fld} placeholder="Offer if approving" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={fld} placeholder="Optional note to the customer" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => decide("rejected")} disabled={busy} className="px-4 py-2 rounded-lg border-2 border-rose-200 text-rose-700 font-semibold hover:bg-rose-50 disabled:opacity-50">Reject</button>
            <button onClick={() => decide("approved")} disabled={busy} className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50">{busy ? "…" : "Approve"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
