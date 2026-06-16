import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Gem, Wallet, AlertTriangle, Banknote, CheckCircle2, Gavel,
  Plus, Search, ChevronRight, TrendingUp, X, FileSpreadsheet,
} from "lucide-react";
import api from "../../services/api";
import PermissionGate from "../../components/PermissionGate";
import PawnLoanModal from "../../components/PawnLoanModal";
import BranchesSection from "../../components/BranchesSection";

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
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState("all");

  useEffect(() => {
    api.get("/branches").then((r) => setBranches((r.data.data || []).filter((b) => b.active))).catch(() => {});
  }, []);
  useEffect(() => {
    setLoading(true);
    const q = branch !== "all" ? `?branch_id=${branch}` : "";
    api.get(`/pawn/summary${q}`).then((r) => setD(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  }, [branch]);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto pb-24">
      <PageHeader
        title="Dashboard"
        action={branches.length > 1 && (
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white text-sm">
            <option value="all">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      />
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
          <Stat icon={Gavel} label="Auction queue" value={d.auction_due ?? d.overdue} sub={`${d.forfeited} forfeited`} tone="amber" />
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
            <th className="text-left px-4 py-2">Branch</th>
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
              <td className="px-4 py-2 text-slate-500">{l.branch_name || "—"}</td>
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
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [branch, setBranch] = useState("all");
  const [showNew, setShowNew] = useState(false);

  const load = async () => {
    try {
      const [p, c, b] = await Promise.all([
        api.get("/pawn"),
        api.get("/clients").catch(() => ({ data: { data: [] } })),
        api.get("/branches").catch(() => ({ data: { data: [] } })),
      ]);
      setRows(p.data.data || []);
      setClients(c.data.data || []);
      setBranches((b.data.data || []).filter((x) => x.active));
    } catch { /* */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filtered = rows.filter((l) => {
    if (status === "overdue" ? !l.overdue : status !== "all" && l.status !== status) return false;
    if (branch !== "all" && String(l.branch_id) !== String(branch)) return false;
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
          {branches.length > 1 && (
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white">
              <option value="all">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
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
  const [pledges, setPledges] = useState([]);
  const [auctions, setAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [schedule, setSchedule] = useState(null); // pledge to schedule
  const [complete, setComplete] = useState(null); // auction to complete

  const load = async () => {
    try {
      const [p, a] = await Promise.all([api.get("/pawn"), api.get("/pawn/auctions")]);
      setPledges(p.data.data || []);
      setAuctions(a.data.data || []);
    } catch { /* */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const scheduledLoanIds = new Set(auctions.filter((a) => a.status === "scheduled").map((a) => a.loan_id));
  const queue = pledges.filter((l) => l.auction_eligible && !scheduledLoanIds.has(l.id));
  const scheduled = auctions.filter((a) => a.status === "scheduled");
  const history = auctions.filter((a) => a.status !== "scheduled");

  const cancel = async (a) => {
    if (!confirm("Cancel this auction? The pledge goes back to active and the item back on hold.")) return;
    try { await api.post(`/pawn/auctions/${a.id}/cancel`, {}); load(); }
    catch (e) { alert(e.response?.data?.error || "Failed"); }
  };

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto pb-24">
      <PageHeader title="Auctions" />
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : (
        <div className="space-y-6">
          {/* Eligible queue → schedule */}
          <div className="bg-white rounded-xl shadow-md border border-amber-100 overflow-hidden">
            <div className="bg-amber-50 px-5 py-3 border-b border-amber-100">
              <h2 className="font-bold text-slate-900 flex items-center gap-2"><Gavel size={18} className="text-amber-600" /> Auction queue <span className="text-sm font-normal text-slate-500">· past the notice period</span></h2>
            </div>
            {queue.length === 0 ? <p className="p-5 text-sm text-slate-500">Nothing eligible. The queue is clear.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-4 py-2">Code</th><th className="text-left px-4 py-2">Customer</th><th className="text-left px-4 py-2">Item</th><th className="text-right px-4 py-2">Owed</th><th className="px-4 py-2"></th></tr></thead>
                  <tbody>
                    {queue.map((l) => (
                      <tr key={l.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 font-mono text-xs text-slate-600 cursor-pointer" onClick={() => navigate(`/pawn/pledges/${l.id}`)}>{l.loan_code}</td>
                        <td className="px-4 py-2 text-slate-800">{l.first_name} {l.last_name}</td>
                        <td className="px-4 py-2 text-slate-600">{l.item || "—"}</td>
                        <td className="px-4 py-2 text-right font-semibold">{money2(l.balance)}</td>
                        <td className="px-4 py-2 text-right">
                          <PermissionGate role={["admin", "manager"]}>
                            <button onClick={() => setSchedule(l)} className="text-amber-700 hover:text-amber-900 font-semibold text-sm">Schedule auction</button>
                          </PermissionGate>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Scheduled → complete / cancel */}
          <div className="bg-white rounded-xl shadow-md border border-slate-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100"><h2 className="font-bold text-slate-900">Scheduled</h2></div>
            {scheduled.length === 0 ? <p className="p-5 text-sm text-slate-500">No auctions scheduled.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-4 py-2">Code</th><th className="text-left px-4 py-2">Item</th><th className="text-left px-4 py-2">Date</th><th className="text-right px-4 py-2">Reserve</th><th className="px-4 py-2"></th></tr></thead>
                  <tbody>
                    {scheduled.map((a) => (
                      <tr key={a.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">{a.loan_code}</td>
                        <td className="px-4 py-2 text-slate-700">{a.item || "—"}</td>
                        <td className="px-4 py-2 text-slate-600">{a.auction_date ? new Date(a.auction_date).toLocaleDateString("en-KE", { month: "short", day: "numeric", year: "numeric" }) : "TBD"}</td>
                        <td className="px-4 py-2 text-right">{a.reserve_price != null ? money(a.reserve_price) : "—"}</td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <PermissionGate role={["admin", "manager"]}>
                            <button onClick={() => setComplete(a)} className="text-emerald-600 hover:text-emerald-800 font-semibold text-sm mr-3">Complete sale</button>
                            <button onClick={() => cancel(a)} className="text-slate-500 hover:text-rose-600 font-semibold text-sm">Cancel</button>
                          </PermissionGate>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* History */}
          <div className="bg-white rounded-xl shadow-md border border-slate-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100"><h2 className="font-bold text-slate-900">History</h2></div>
            {history.length === 0 ? <p className="p-5 text-sm text-slate-500">No completed or cancelled auctions yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-4 py-2">Code</th><th className="text-left px-4 py-2">Item</th><th className="text-left px-4 py-2">Outcome</th><th className="text-right px-4 py-2">Sale</th><th className="text-right px-4 py-2">Recovered</th><th className="text-right px-4 py-2">Surplus / Deficiency</th></tr></thead>
                  <tbody>
                    {history.map((a) => (
                      <tr key={a.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">{a.loan_code}</td>
                        <td className="px-4 py-2 text-slate-700">{a.item || "—"}</td>
                        <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${a.status === "completed" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>{a.status}</span></td>
                        <td className="px-4 py-2 text-right">{a.sale_price != null ? money(a.sale_price) : "—"}</td>
                        <td className="px-4 py-2 text-right">{a.status === "completed" ? money(a.recovered) : "—"}</td>
                        <td className="px-4 py-2 text-right">
                          {a.status !== "completed" ? "—" : Number(a.surplus) > 0 ? <span className="text-emerald-700">+{money(a.surplus)} to customer</span> : Number(a.deficiency) > 0 ? <span className="text-rose-600">−{money(a.deficiency)} short</span> : "settled"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {schedule && <ScheduleAuctionModal pledge={schedule} onClose={() => setSchedule(null)} onDone={() => { setSchedule(null); load(); }} />}
      {complete && <CompleteAuctionModal auction={complete} onClose={() => setComplete(null)} onDone={() => { setComplete(null); load(); }} />}
    </div>
  );
}

function ScheduleAuctionModal({ pledge, onClose, onDone }) {
  const [reserve, setReserve] = useState(pledge.balance ? String(Math.round(pledge.balance)) : "");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    try { await api.post(`/pawn/${pledge.id}/auction`, { reserve_price: reserve || undefined, auction_date: date || undefined }); onDone(); }
    catch (err) { setError(err.response?.data?.error || "Failed"); setBusy(false); }
  };
  const fld = "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-amber-500 focus:outline-none";
  return (
    <AuctionShell title={`Schedule auction — ${pledge.item || pledge.loan_code}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Err msg={error} />}
        <p className="text-sm text-slate-600">Owed: <strong>{money2(pledge.balance)}</strong>. Scheduling defaults the pledge and forfeits the item for sale.</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-sm font-semibold text-gray-700 mb-1">Reserve price</label><input type="number" value={reserve} onChange={(e) => setReserve(e.target.value)} className={fld} /></div>
          <div><label className="block text-sm font-semibold text-gray-700 mb-1">Auction date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fld} /></div>
        </div>
        <Actions busy={busy} onClose={onClose} label="Schedule" tone="bg-amber-600 hover:bg-amber-700" />
      </form>
    </AuctionShell>
  );
}

function CompleteAuctionModal({ auction, onClose, onDone }) {
  const [salePrice, setSalePrice] = useState("");
  const [fees, setFees] = useState("");
  const [buyer, setBuyer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault(); setError("");
    if (!(parseFloat(salePrice) > 0)) return setError("Enter the sale price.");
    setBusy(true);
    try {
      const r = await api.post(`/pawn/auctions/${auction.id}/complete`, { sale_price: salePrice, fees: fees || 0, buyer_name: buyer || undefined });
      const d = r.data.data;
      alert(`Sold for ${money(d.sale_price)}. Recovered ${money(d.recovered)}` + (d.surplus > 0 ? `, surplus ${money(d.surplus)} owed to customer.` : d.deficiency > 0 ? `, deficiency ${money(d.deficiency)}.` : "."));
      onDone();
    } catch (err) { setError(err.response?.data?.error || "Failed"); setBusy(false); }
  };
  const fld = "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none";
  return (
    <AuctionShell title={`Complete sale — ${auction.item || auction.loan_code}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Err msg={error} />}
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-sm font-semibold text-gray-700 mb-1">Sale price *</label><input type="number" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} className={fld} autoFocus /></div>
          <div><label className="block text-sm font-semibold text-gray-700 mb-1">Auction fees</label><input type="number" value={fees} onChange={(e) => setFees(e.target.value)} className={fld} /></div>
        </div>
        <div><label className="block text-sm font-semibold text-gray-700 mb-1">Buyer</label><input value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="Optional" className={fld} /></div>
        <p className="text-xs text-slate-500">What the borrower owed is recovered to the pool; any surplus is recorded as owed back to the customer.</p>
        <Actions busy={busy} onClose={onClose} label="Record sale" tone="bg-emerald-600 hover:bg-emerald-700" />
      </form>
    </AuctionShell>
  );
}

function AuctionShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md my-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
const Err = ({ msg }) => <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"><AlertTriangle size={15} /> {msg}</div>;
function Actions({ busy, onClose, label, tone }) {
  return (
    <div className="flex justify-end gap-3 pt-1">
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50">Cancel</button>
      <button type="submit" disabled={busy} className={`px-5 py-2 rounded-lg text-white font-semibold disabled:opacity-50 ${tone}`}>{busy ? "Saving…" : label}</button>
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

// ── Settings (valuation / interest / auction rules) ──────────────────
export function PawnSettings() {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/pawn/settings").then((r) => setForm({
      default_ltv_percent: r.data.data.default_ltv_percent ?? 50,
      default_monthly_fee_percent: r.data.data.default_monthly_fee_percent ?? 10,
      default_duration_months: r.data.data.default_duration_months ?? 1,
      grace_days: r.data.data.grace_days ?? 0,
      auction_notice_days: r.data.data.auction_notice_days ?? 14,
    })).catch(() => setError("Couldn't load settings"));
  }, []);

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setSaved(false); };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try { await api.put("/pawn/settings", form); setSaved(true); }
    catch (err) { setError(err.response?.data?.error || "Failed to save"); }
    finally { setBusy(false); }
  };
  const fld = "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 mb-1";

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto pb-24">
      <PageHeader title="Settings" />
      <div className="bg-white rounded-xl shadow-md border border-slate-100 p-6">
        <h2 className="font-bold text-slate-900 mb-1">Valuation &amp; rules</h2>
        <p className="text-sm text-slate-500 mb-5">Defaults applied to new pledges, plus how long after maturity an item becomes auction-eligible.</p>
        {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"><AlertTriangle size={15} /> {error}</div>}
        {!form ? <p className="text-sm text-slate-500">Loading…</p> : (
          <PermissionGate role={["admin", "manager"]} fallback={<p className="text-sm text-slate-500">You don't have permission to edit settings.</p>}>
            <form onSubmit={save} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className={lbl}>Default LTV %</label><input type="number" value={form.default_ltv_percent} onChange={set("default_ltv_percent")} className={fld} /><p className="text-xs text-slate-400 mt-1">Loan = item value × LTV%.</p></div>
                <div><label className={lbl}>Default monthly fee %</label><input type="number" step="0.1" value={form.default_monthly_fee_percent} onChange={set("default_monthly_fee_percent")} className={fld} /><p className="text-xs text-slate-400 mt-1">Flat fee per month on the principal.</p></div>
                <div><label className={lbl}>Default term (months)</label><input type="number" min="1" value={form.default_duration_months} onChange={set("default_duration_months")} className={fld} /></div>
                <div><label className={lbl}>Grace days</label><input type="number" min="0" value={form.grace_days} onChange={set("grace_days")} className={fld} /><p className="text-xs text-slate-400 mt-1">Days after maturity before a pledge counts as overdue.</p></div>
                <div><label className={lbl}>Auction notice (days)</label><input type="number" min="0" value={form.auction_notice_days} onChange={set("auction_notice_days")} className={fld} /><p className="text-xs text-slate-400 mt-1">Days overdue before an item is auction-eligible.</p></div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-ocean-600 hover:bg-ocean-700 text-white font-semibold disabled:opacity-50">{busy ? "Saving…" : "Save settings"}</button>
                {saved && <span className="text-sm text-emerald-600 font-semibold">Saved.</span>}
              </div>
            </form>
          </PermissionGate>
        )}
      </div>

      {/* Branches — pawnshops run multiple branches. */}
      <div className="mt-6">
        <BranchesSection />
      </div>
    </div>
  );
}

// ── Accounting (account balances + cash journal) ─────────────────────
export function PawnAccounting() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get("/pawn/accounting").then((r) => setData(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const exportCsv = () => {
    const rows = data?.journal || [];
    const cell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [["Date", "Ref", "Description", "Debit", "Credit", "Amount"].join(",")];
    rows.forEach((j) => lines.push([new Date(j.date).toISOString().split("T")[0], j.ref, j.description, j.debit, j.credit, j.amount].map(cell).join(",")));
    const url = window.URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "pawn-journal.csv"; a.click();
    window.URL.revokeObjectURL(url);
  };

  const a = data?.accounts;
  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto pb-24">
      <PageHeader title="Accounting" action={data && <button onClick={exportCsv} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-semibold rounded-lg inline-flex items-center gap-1.5"><FileSpreadsheet size={14} /> Journal CSV</button>} />
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : !data ? <p className="text-sm text-slate-500">Couldn't load accounting.</p> : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat icon={Wallet} label="Cash available" value={money(a.cash_available)} tone="emerald" />
            <Stat icon={Banknote} label="Loans receivable" value={money(a.loans_receivable)} sub="owed by customers" tone="ocean" />
            <Stat icon={TrendingUp} label="Interest income" value={money(a.interest_income)} sub="lifetime" tone="emerald" />
            <Stat icon={Gem} label="Collateral held" value={money(a.collateral_held)} sub="appraised" tone="slate" />
            <Stat icon={Gavel} label="Auction recovered" value={money(a.auction_recovered)} sub={`${a.auctions_completed} sold`} tone="amber" />
            <Stat icon={Banknote} label="Surplus payable" value={money(a.surplus_payable)} sub="owed to customers" tone="ocean" />
            <Stat icon={AlertTriangle} label="Deficiency" value={money(a.deficiency)} sub="shortfall" tone="rose" />
            <Stat icon={Banknote} label="Disbursed / collected" value={money(a.principal_disbursed)} sub={`${money(a.principal_collected)} collected`} tone="slate" />
          </div>

          <div className="bg-white rounded-xl shadow-md border border-slate-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100"><h2 className="font-bold text-slate-900">Journal</h2></div>
            {data.journal.length === 0 ? <p className="p-5 text-sm text-slate-500">No cash movements yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-2">Date</th>
                      <th className="text-left px-4 py-2">Ref</th>
                      <th className="text-left px-4 py-2">Description</th>
                      <th className="text-left px-4 py-2">Debit</th>
                      <th className="text-left px-4 py-2">Credit</th>
                      <th className="text-right px-4 py-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.journal.map((j) => (
                      <tr key={j.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{new Date(j.date).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" })}</td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">{j.ref}</td>
                        <td className="px-4 py-2 text-slate-600">{j.description}</td>
                        <td className="px-4 py-2 text-slate-700">{j.debit}</td>
                        <td className="px-4 py-2 text-slate-700">{j.credit}</td>
                        <td className="px-4 py-2 text-right font-semibold">{money(j.amount)}</td>
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
