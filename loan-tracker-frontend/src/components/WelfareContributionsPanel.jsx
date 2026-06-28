import React, { useState, useEffect } from "react";
import { CalendarClock, Plus, X, Coins, AlertTriangle, ChevronRight, Smartphone, Repeat, ChevronLeft, ArrowDownToLine, Users } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

const money = (v) =>
  "KES " + Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }) : "—");

const FREQ_LABEL = { weekly: "Weekly", biweekly: "Bi-weekly", monthly: "Monthly", quarterly: "Every 3 months", yearly: "Yearly" };
const FINE_TYPES = [
  { value: "", label: "No late fine" },
  { value: "fixed", label: "Flat amount (once)" },
  { value: "daily_fixed", label: "Flat amount per day late" },
  { value: "percentage", label: "% of the amount (once)" },
  { value: "daily_percentage", label: "% of the amount per day late" },
];

// Welfare contributions, split by pool kind:
//   kind="savings"  → group savings (Monthly).
//   kind="benefit"  → "Events & Emergencies": contributions with a member
//                     beneficiary (Quarterly dowry, one-off emergencies).
// Click one to drill into its pool + per-member activity. Welfare accounts only.
// `client`/`basePath`/`readOnly` let the read-only member portal reuse this whole
// view against its own token + endpoints (members are equal owners). Admin keeps
// the defaults (api + /welfares/:id, writes enabled).
export default function WelfareContributionsPanel({ welfareId, kind = "savings", benefitView = "both", client = api, readOnly = false, basePath = `/welfares/${welfareId}` }) {
  const benefit = kind === "benefit";
  // Within the benefit view, optionally show only Events or only Emergencies
  // (so they can live on separate nav pages). Downstream still sees kind="benefit".
  const showEvents = benefit && benefitView !== "emergencies";
  const showEmerg = benefit && benefitView !== "events";
  const benefitTitle = benefitView === "events" ? "Events" : benefitView === "emergencies" ? "Emergencies" : "Events & Emergencies";
  const [list, setList] = useState(null); // { plans, oneoffs }
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creator, setCreator] = useState(null); // { mode:'new' } | { mode:'edit', plan } | null
  const [selected, setSelected] = useState(null); // a plan to drill into
  const [openCycle, setOpenCycle] = useState(null); // a one-off cycle to view

  const load = async () => {
    setLoading(true);
    try { const r = await client.get(`${basePath}/contribution-plans`); setList(r.data.data); }
    catch { /* non-fatal */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [basePath]); // eslint-disable-line react-hooks/exhaustive-deps
  // The members list is only needed for the write modals (create/pay).
  useEffect(() => { if (readOnly) return; api.get(`/welfares/${welfareId}/members`).then((r) => setMembers((r.data.data || []).filter((m) => m.status === "active"))).catch(() => {}); }, [welfareId, readOnly]);

  if (selected) return <ContributionDetail client={client} basePath={basePath} readOnly={readOnly} welfareId={welfareId} plan={selected} members={members} kind={kind} onBack={() => { setSelected(null); load(); }} />;

  // This page only shows its kind: benefit pools here, savings pools on Contributions.
  const isBenefitOneoff = (c) => c.pool_key && c.pool_key !== "savings";
  const plans = (list?.plans || []).filter((p) => (p.pool_kind === "benefit") === benefit);
  const oneoffs = (list?.oneoffs || []).filter((c) => isBenefitOneoff(c) === benefit);
  const empty = !loading && plans.length === 0 && oneoffs.length === 0;
  const eventsPool = plans.reduce((a, p) => a + Number(p.pool_balance || 0), 0); // each event has its own pool
  const emergPool = list?.oneoff_pool_balance ?? 0; // all emergencies share one pool

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-sky-100 mb-6 overflow-hidden">
      <div className="bg-sky-50 px-5 py-3 border-b border-sky-100 flex items-center justify-between">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <CalendarClock size={18} className="text-sky-600" /> {benefit ? benefitTitle : "Contributions"}
        </h2>
        {!benefit && !readOnly && (
          <PermissionGate role={["admin", "manager"]}>
            <button onClick={() => setCreator({ mode: "new" })} className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5">
              <Plus size={15} /> New contribution
            </button>
          </PermissionGate>
        )}
      </div>

      <div className="p-5">
        {loading ? <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p> : benefit ? (
          <div className="space-y-6">
            {showEvents && (
              <BenefitSection title="Events" subtitle="Recurring benefit pools — members contribute, the pool pays a lump sum to each (e.g. Quarterly dowry)."
                pool={plans.length ? eventsPool : null} poolLabel={plans.length > 1 ? "Pools total" : "Pool"} readOnly={readOnly}
                addLabel="New event" onAdd={() => setCreator({ mode: "new", create: "event" })} empty="No events yet.">
                {plans.map((p) => <PlanRow key={p.id} plan={p} onClick={() => setSelected(p)} />)}
              </BenefitSection>
            )}
            {showEmerg && (
              <BenefitSection title="Emergencies" subtitle="One-off collections that pay out to a member in need." pool={emergPool} poolLabel="Pool" readOnly={readOnly}
                addLabel="New emergency" onAdd={() => setCreator({ mode: "new", create: "emergency" })} empty="No emergencies yet.">
                {oneoffs.map((c) => <OneoffRow key={"c" + c.id} cycle={c} onClick={() => setOpenCycle({ id: c.id, name: c.name, due_date: c.due_date, pool_key: c.pool_key, beneficiary_member_id: c.beneficiary_member_id, ben_first: c.ben_first, ben_last: c.ben_last, amount: c.amount, pool_balance: c.pool_balance })} />)}
              </BenefitSection>
            )}
          </div>
        ) : empty ? (
          <div className="text-center py-8 text-slate-500 dark:text-slate-400 text-sm">No contributions yet. Create one — e.g. <span className="font-semibold">“Monthly”</span>.</div>
        ) : (
          <div className="space-y-3">
            {plans.map((p) => <PlanRow key={p.id} plan={p} onClick={() => setSelected(p)} />)}
            {oneoffs.map((c) => <OneoffRow key={"c" + c.id} cycle={c} onClick={() => setOpenCycle({ id: c.id, name: c.name, due_date: c.due_date, pool_key: c.pool_key, beneficiary_member_id: c.beneficiary_member_id, ben_first: c.ben_first, ben_last: c.ben_last, amount: c.amount, pool_balance: c.pool_balance })} />)}
          </div>
        )}
      </div>

      {creator && !readOnly && (
        <ContributionModal welfareId={welfareId} plan={creator.plan} mode={creator.mode} members={members} kind={kind} createKind={creator.create}
          onClose={() => setCreator(null)} onSaved={() => { setCreator(null); load(); }} />
      )}
      {openCycle && openCycle.id && <SchedulesModal client={client} basePath={basePath} readOnly={readOnly} welfareId={welfareId} cycle={openCycle} members={members} onClose={() => setOpenCycle(null)} onChange={load} />}
    </div>
  );
}

// A labelled group on the Events & Emergencies page, with its own "add" button.
function BenefitSection({ title, subtitle, pool, poolLabel = "Pool", addLabel, onAdd, empty, readOnly, children }) {
  const has = React.Children.toArray(children).length > 0;
  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">{title}
            {pool != null && <span className="font-normal text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">{poolLabel}: <span className={`font-bold ${pool < 0 ? "text-rose-600" : ""}`}>{money(pool)}</span></span>}
          </h3>
          <p className="text-xs text-slate-400 dark:text-slate-400">{subtitle}</p>
        </div>
        {!readOnly && (
          <PermissionGate role={["admin", "manager"]}>
            <button onClick={onAdd} className="shrink-0 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5"><Plus size={15} /> {addLabel}</button>
          </PermissionGate>
        )}
      </div>
      {has ? <div className="space-y-3">{children}</div> : <p className="text-sm text-slate-400 dark:text-slate-400 py-3">{empty}</p>}
    </div>
  );
}

// One named contribution in the list — its current period at a glance.
function PlanRow({ plan, onClick }) {
  const c = plan.current || {};
  const done = c.member_count > 0 && c.paid_count >= c.member_count;
  return (
    <button onClick={onClick} className="w-full text-left flex items-center gap-4 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-sky-300 hover:bg-sky-50/40 transition">
      <div className="h-10 w-10 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center shrink-0"><Repeat size={18} /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-900 dark:text-slate-100 truncate">{plan.name}</span>
          <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 text-xs font-semibold">{FREQ_LABEL[plan.frequency] || plan.frequency}</span>
          <PoolBadge kind={plan.pool_kind} />
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{money(plan.amount)} per member · this year collected {money(plan.ytd_collected)}</p>
      </div>
      <div className="text-right shrink-0">
        <p className={`text-sm font-bold ${done ? "text-emerald-700" : "text-slate-800 dark:text-slate-100"}`}>{c.paid_count ?? 0}/{c.member_count ?? 0} paid</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{money(c.collected)} · due {fmt(c.due_date)}</p>
      </div>
      <ChevronRight size={18} className="text-slate-300 dark:text-slate-400 shrink-0" />
    </button>
  );
}

function OneoffRow({ cycle, onClick }) {
  return (
    <button onClick={onClick} className="w-full text-left flex items-center gap-4 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-sky-300 hover:bg-sky-50/40 transition">
      <div className="h-10 w-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0"><Coins size={18} /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-900 dark:text-slate-100 truncate">{cycle.name}</span>
          <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold">{cycle.beneficiary_member_id ? "Emergency" : "One-off"}</span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{cycle.beneficiary_member_id ? <>beneficiary {cycle.ben_first} {cycle.ben_last} · </> : null}due {fmt(cycle.due_date)}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{cycle.paid_count}/{cycle.member_count} paid</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{money(cycle.collected)}</p>
      </div>
      <ChevronRight size={18} className="text-slate-300 dark:text-slate-400 shrink-0" />
    </button>
  );
}

const PoolBadge = ({ kind }) => kind === "benefit"
  ? <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-xs font-semibold">Benefit · pays out</span>
  : <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">Savings</span>;

// One contribution's pool page: pool balance + (for benefit) payouts, plus the
// year matrix (by-period / by-member), edit, assess-late.
function ContributionDetail({ welfareId, plan: initialPlan, members = [], kind = "savings", onBack, client = api, basePath = `/welfares/${welfareId}`, readOnly = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [view, setView] = useState("months");
  const [openCycle, setOpenCycle] = useState(null);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const plan = data?.plan || initialPlan;
  const pool = data?.pool;

  const load = async () => {
    setLoading(true);
    try { const r = await client.get(`${basePath}/contribution-plans/${initialPlan.id}/overview?year=${year}`); setData(r.data.data); }
    catch { /* non-fatal */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  const assessLate = async () => {
    setBusy(true);
    try { const r = await client.post(`${basePath}/cycles/0/assess-late`, {}); alert(`${r.data.assessed} new late-contribution penalt${r.data.assessed === 1 ? "y" : "ies"} assessed.`); load(); }
    catch (e) { alert(e.response?.data?.error || "Failed"); } finally { setBusy(false); }
  };
  const tabCls = (on) => `px-3 py-1 text-sm font-semibold rounded-lg ${on ? "bg-sky-600 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`;
  const isBenefit = plan.pool_kind === "benefit";

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-sky-100 mb-6 overflow-hidden">
      <div className="bg-sky-50 px-5 py-3 border-b border-sky-100 flex items-center justify-between">
        <button onClick={onBack} className="text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 inline-flex items-center gap-1"><ChevronLeft size={16} /> {kind === "benefit" ? "All events & emergencies" : "All contributions"}</button>
        {!readOnly && (
          <PermissionGate role={["admin", "manager"]}>
            <div className="flex gap-2">
              {isBenefit && <button onClick={() => setPaying(true)} className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5"><ArrowDownToLine size={14} /> Pay a beneficiary</button>}
              <button onClick={assessLate} disabled={busy} className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-rose-200 text-rose-700 hover:bg-rose-50 text-sm font-semibold rounded-lg disabled:opacity-50">Assess late</button>
              <button onClick={() => setEditing(true)} className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-sky-200 text-sky-700 hover:bg-sky-50 text-sm font-semibold rounded-lg">Edit</button>
            </div>
          </PermissionGate>
        )}
      </div>

      <div className="px-5 py-3 border-b border-sky-100">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 text-lg flex items-center gap-2">{plan.name}
          <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 text-xs font-semibold">{FREQ_LABEL[plan.frequency] || plan.frequency}</span>
          <PoolBadge kind={plan.pool_kind} />
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5"><Repeat size={12} className="inline mr-1 text-sky-600" />{planSummary(plan)} · {fineSummary(plan)}</p>
      </div>

      {/* Pool card */}
      <div className="px-5 py-3 bg-slate-50/60 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700 flex flex-wrap items-center gap-x-8 gap-y-2">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{isBenefit ? "Benefit pool balance" : "Savings pool balance"}</p>
          <p className={`text-lg font-bold ${pool && pool.balance < 0 ? "text-rose-600" : "text-slate-900 dark:text-slate-100"}`}>{money(pool?.balance)}</p>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md">{isBenefit
          ? "Members contribute in; lump sums are paid out to member beneficiaries. Kept separate from member savings."
          : "Group savings — each member owns their balance and can withdraw it."}</p>
      </div>

      {isBenefit && pool?.payouts?.length > 0 && (
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Payouts ({pool.payouts.length})</p>
          <div className="space-y-1">
            {pool.payouts.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-700 dark:text-slate-200">{p.first_name} {p.last_name} <span className="text-slate-400 dark:text-slate-400">· {fmt(p.meeting_date || p.txn_date)}</span>
                  {p.meeting_id ? <span className="ml-1 text-violet-600 text-xs font-semibold" title={p.meeting_title}><Users size={11} className="inline -mt-0.5" /> {p.attended}/{p.recorded} present</span> : null}
                </span>
                <span className="font-semibold text-rose-600">− {money(p.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-5 pt-3 flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <button onClick={() => setYear((y) => y - 1)} className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-800"><ChevronLeft size={16} /></button>
          <span className="font-semibold text-slate-700 dark:text-slate-200 w-12 text-center">{year}</span>
          <button onClick={() => setYear((y) => y + 1)} disabled={year >= new Date().getFullYear()} className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-800 disabled:opacity-30"><ChevronRight size={16} /></button>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setView("months")} className={tabCls(view === "months")}>By period</button>
          <button onClick={() => setView("members")} className={tabCls(view === "members")}>By member</button>
        </div>
      </div>

      <div className="p-5">
        {loading || !data ? <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p> : view === "months" ? (
          <MonthsTable periods={data.periods} onOpen={(p) => setOpenCycle({ id: p.cycle_id, name: p.name, due_date: p.due_date })} />
        ) : (
          <MembersGrid data={data} />
        )}
      </div>

      {editing && (
        <ContributionModal welfareId={welfareId} plan={plan} mode="edit" members={members}
          onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />
      )}
      {paying && (
        <PayoutModal welfareId={welfareId} planId={plan.id} members={members} balance={pool?.balance}
          excludeIds={(pool?.payouts || []).map((p) => p.beneficiary_id)}
          onClose={() => setPaying(false)} onSaved={() => { setPaying(false); load(); }} />
      )}
      {openCycle && openCycle.id && <SchedulesModal client={client} basePath={basePath} readOnly={readOnly} welfareId={welfareId} cycle={openCycle} members={members} onClose={() => setOpenCycle(null)} onChange={load} />}
    </div>
  );
}

// Disburse a lump sum from a benefit pool to a member beneficiary. `excludeIds`
// are members who've already received this benefit (each member enjoys it once).
function PayoutModal({ welfareId, planId, cycleId, members, balance, defaultBeneficiary, excludeIds = [], onClose, onSaved }) {
  const [form, setForm] = useState({ beneficiary_member_id: defaultBeneficiary || "", amount: "", description: "", gathering_title: "", gathering_date: "", gathering_fine_late: "", gathering_fine_absent: "" });
  const eligible = members.filter((m) => m.id === defaultBeneficiary || !excludeIds.includes(m.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const fld = "w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-sky-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1";
  const submit = async (e) => {
    e.preventDefault();
    if (!form.beneficiary_member_id) return setError("Pick a beneficiary.");
    if (!(parseFloat(form.amount) > 0)) return setError("Enter the payout amount.");
    setBusy(true); setError("");
    try {
      const url = planId ? `/welfares/${welfareId}/contribution-plans/${planId}/payouts` : `/welfares/${welfareId}/cycles/${cycleId}/payout`;
      await api.post(url, form);
      onSaved();
    } catch (err) { setError(err.response?.data?.error || "Failed."); setBusy(false); }
  };
  return (
    <Shell title="Pay a beneficiary" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Err msg={error} />}
        <p className="text-xs text-slate-500 dark:text-slate-400">Pool balance: <span className="font-semibold">{money(balance)}</span>. The payout leaves this pool (it can go negative — it won't touch member savings).</p>
        <div><label className={lbl}>Beneficiary *</label>
          <select value={form.beneficiary_member_id} onChange={set("beneficiary_member_id")} className={fld}>
            <option value="">Select a member…</option>
            {eligible.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
          </select>
          {excludeIds.length > 0 && <p className="text-xs text-slate-400 dark:text-slate-400 mt-1">{excludeIds.length} member{excludeIds.length === 1 ? "" : "s"} who already received this benefit {excludeIds.length === 1 ? "is" : "are"} hidden.</p>}
        </div>
        <div><label className={lbl}>Amount *</label><input type="number" value={form.amount} onChange={set("amount")} className={fld} /></div>
        <div><label className={lbl}>Note</label><input value={form.description} onChange={set("description")} placeholder="e.g. Dowry / wedding" className={fld} /></div>
        <div className="border-t border-slate-100 dark:border-slate-700 pt-3">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1 flex items-center gap-1.5"><Users size={14} /> Gathering (optional)</p>
          <p className="text-xs text-slate-400 dark:text-slate-400 mb-2">Naming it creates a meeting under <span className="font-semibold">Meetings</span> where you mark attendance. Optionally fine late/absent members.</p>
          <div className="grid grid-cols-2 gap-3">
            <input value={form.gathering_title} onChange={set("gathering_title")} placeholder="Event name e.g. Dowry hand-out — Jane" className={fld} />
            <input type="date" value={form.gathering_date} onChange={set("gathering_date")} className={fld} />
          </div>
          {form.gathering_title && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div><label className={lbl}>Late fine (KES)</label><input type="number" min="0" value={form.gathering_fine_late} onChange={set("gathering_fine_late")} placeholder="e.g. 500" className={fld} /></div>
              <div><label className={lbl}>Absent fine (KES)</label><input type="number" min="0" value={form.gathering_fine_absent} onChange={set("gathering_fine_absent")} placeholder="e.g. 1000" className={fld} /></div>
            </div>
          )}
        </div>
        <Actions busy={busy} onClose={onClose} label="Record payout" tone="bg-violet-600 hover:bg-violet-700" />
      </form>
    </Shell>
  );
}

const MONTH_STATUS = { open: "bg-emerald-100 text-emerald-800", closed: "bg-slate-200 text-slate-700", upcoming: "bg-sky-100 text-sky-700", unopened: "bg-slate-100 text-slate-500" };
function MonthsTable({ periods, onOpen }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase">
          <tr>
            <th className="text-left px-4 py-2">Period</th>
            <th className="text-left px-4 py-2">Due</th>
            <th className="text-right px-4 py-2">Collected / Expected</th>
            <th className="text-right px-4 py-2">Paid</th>
            <th className="text-left px-4 py-2">Status</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {periods.map((m) => (
            <tr key={m.key} className={`border-t border-slate-100 dark:border-slate-700 ${m.opened ? "hover:bg-sky-50/50 cursor-pointer" : "opacity-70"}`} onClick={() => m.opened && onOpen(m)}>
              <td className="px-4 py-2 font-semibold text-slate-800 dark:text-slate-100">{m.name}</td>
              <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{fmt(m.due_date)}</td>
              <td className="px-4 py-2 text-right">{m.opened ? <>{money(m.collected)} <span className="text-slate-400 dark:text-slate-400">/ {money(m.expected)}</span></> : <span className="text-slate-400 dark:text-slate-400">{m.expected ? `— / ${money(m.expected)}` : "—"}</span>}</td>
              <td className="px-4 py-2 text-right">{m.opened ? `${m.paid_count}/${m.member_count}` : "—"}</td>
              <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${MONTH_STATUS[m.status] || MONTH_STATUS.unopened}`}>{m.status}</span></td>
              <td className="px-4 py-2 text-right">
                {m.opened && <ChevronRight size={16} className="inline text-sky-400" />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cellMark(cell) {
  if (!cell || cell.status === "none") return <span className="text-slate-300">·</span>;
  if (cell.status === "upcoming") return <span className="text-slate-300" title="upcoming">·</span>;
  if (cell.status === "paid") return cell.on_time === false
    ? <span className="text-amber-600 font-bold" title={`paid ${cell.late_days}d late`}>✓</span>
    : <span className="text-emerald-600 font-bold" title="on time">✓</span>;
  if (cell.status === "partial") return <span className="text-amber-600 font-bold" title="partial">½</span>;
  return cell.days_late > 0
    ? <span className="text-red-600 font-semibold text-xs" title={`${cell.days_late}d late`}>{cell.days_late}d</span>
    : <span className="text-slate-400" title="not yet paid">○</span>;
}
function MembersGrid({ data }) {
  const periods = data.periods || [];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase">
          <tr>
            <th className="text-left px-3 py-2 sticky left-0 bg-slate-50 dark:bg-slate-900">Member</th>
            {periods.map((p) => <th key={p.key} className="px-2 py-2 text-center" title={p.name}>{p.short}</th>)}
            <th className="px-3 py-2 text-right">Total paid</th>
            <th className="px-3 py-2 text-right">Fines</th>
          </tr>
        </thead>
        <tbody>
          {data.members.length === 0 ? (
            <tr><td colSpan={periods.length + 3} className="px-3 py-8 text-center text-slate-500 dark:text-slate-400">No active members.</td></tr>
          ) : data.members.map((mem) => (
            <tr key={mem.id} className="border-t border-slate-100 dark:border-slate-700">
              <td className="px-3 py-2 text-slate-800 dark:text-slate-100 whitespace-nowrap sticky left-0 bg-white dark:bg-slate-800">{mem.first_name} {mem.last_name}</td>
              {periods.map((p, i) => <td key={p.key} className="px-2 py-2 text-center">{cellMark(mem.cells[i])}</td>)}
              <td className="px-3 py-2 text-right font-semibold text-emerald-700">{money(mem.total_paid)}</td>
              <td className="px-3 py-2 text-right font-semibold">{mem.fines > 0 ? <span className={mem.fines_outstanding > 0 ? "text-rose-600" : "text-slate-500"}>{money(mem.fines)}</span> : <span className="text-slate-300">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400"><span className="text-emerald-600 font-bold">✓</span> on time · <span className="text-amber-600 font-bold">✓</span> paid late · <span className="text-red-600 font-semibold">Nd</span> days late · <span className="text-slate-400">○</span> due · <span className="text-slate-300">·</span> upcoming</p>
    </div>
  );
}

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
function fineSummary(p) {
  if (!p?.fine_calc_type) return "no late fine";
  const grace = p.grace_days ? ` after ${p.grace_days}-day grace` : "";
  const t = p.fine_calc_type;
  if (t === "fixed") return `late fine ${money(p.fine_amount)}${grace}`;
  if (t === "daily_fixed") return `late fine ${money(p.fine_amount)}/day${grace}`;
  if (t === "percentage") return `late fine ${p.fine_rate}%${grace}`;
  if (t === "daily_percentage") return `late fine ${p.fine_rate}%/day${grace}`;
  return "late fine set";
}

const WEEKDAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function planSummary(p) {
  const amt = money(p.amount);
  switch (p.frequency) {
    case "weekly": return `Auto-opens weekly: ${amt} due each ${WEEKDAY_NAMES[p.due_day] || "week"}`;
    case "biweekly": return `Auto-opens every 2 weeks: ${amt} due on day ${p.due_day} of the 2nd week`;
    case "quarterly": return `Auto-opens every 3 months: ${amt} due the ${ordinal(p.due_day)} of the 3rd month`;
    case "yearly": return `Auto-opens yearly: ${amt} due ${MONTH_NAMES[(p.due_month || 12) - 1]} ${ordinal(p.due_day)}`;
    default: return `Auto-opens monthly: ${amt} due the ${ordinal(p.due_day)}`;
  }
}
const pill = (cls, text) => <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{text}</span>;
// Per-member timeliness for the cycle view: on time vs late (and by how many days).
function timeliness(s) {
  const late = Number(s.days_overdue || 0);
  if (s.status === "paid") {
    if (s.paid_on_time === true) return pill("bg-emerald-100 text-emerald-800", "On time");
    if (s.paid_on_time === false) return pill("bg-amber-100 text-amber-800", `Paid ${s.paid_late_days}d late`);
    return pill("bg-emerald-100 text-emerald-800", "Paid");
  }
  if (Number(s.amount_paid) > 0) return pill("bg-amber-100 text-amber-800", late > 0 ? `Partial · ${late}d late` : "Partial");
  return late > 0 ? pill("bg-red-100 text-red-700", `Late ${late}d`) : pill("bg-slate-100 text-slate-600", "Not yet due");
}

// One modal for creating a contribution. "Monthly" saves the recurring plan
// (auto-opens each month); "One-off" opens a single dated cycle. Both carry the
// late-fine rule. Opened from the plan banner ("plan" mode) it edits the plan.
const FREQS = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Every 3 months" },
  { value: "yearly", label: "Yearly" },
  { value: "oneoff", label: "One-off" },
];
const WEEKDAYS = [{ v: 1, n: "Monday" }, { v: 2, n: "Tuesday" }, { v: 3, n: "Wednesday" }, { v: 4, n: "Thursday" }, { v: 5, n: "Friday" }, { v: 6, n: "Saturday" }, { v: 7, n: "Sunday" }];
const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function ContributionModal({ welfareId, plan, mode, members = [], kind = "savings", createKind, onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10);
  const benefit = kind === "benefit";
  const isWeek = (f) => f === "weekly" || f === "biweekly";
  const editing = mode === "edit";
  // Events are recurring benefit pools; emergencies are one-offs.
  const freqOptions = editing || createKind === "event" ? FREQS.filter((f) => f.value !== "oneoff")
    : createKind === "emergency" ? FREQS.filter((f) => f.value === "oneoff") : FREQS;
  const [freq, setFreq] = useState(createKind === "emergency" ? "oneoff" : plan?.frequency || (createKind === "event" || benefit ? "quarterly" : "monthly"));
  const [form, setForm] = useState({
    name: plan?.name ?? "", amount: plan?.amount ?? "", due_day: plan?.due_day ?? (isWeek(plan?.frequency) ? 1 : 10),
    due_month: plan?.due_month ?? 12, due_date: "", pool_kind: plan?.pool_kind ?? (benefit ? "benefit" : "savings"),
    grace_days: plan?.grace_days ?? 0, fine_calc_type: plan?.fine_calc_type ?? "",
    fine_amount: plan?.fine_amount ?? "", fine_rate: plan?.fine_rate ?? "", fine_cap: plan?.fine_cap ?? "",
    beneficiary_member_id: "", payout_amount: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const recurring = freq !== "oneoff";
  const usesAmount = ["fixed", "daily_fixed"].includes(form.fine_calc_type);
  const usesRate = ["percentage", "daily_percentage"].includes(form.fine_calc_type);

  // Reset due_day sensibly when switching between weekday- and day-of-month modes.
  const changeFreq = (f) => { setFreq(f); setForm((s) => ({ ...s, due_day: isWeek(f) ? (s.due_day > 7 ? 1 : s.due_day) : (s.due_day < 8 && s.due_day < 1 ? 10 : s.due_day) })); };

  const dueLabel = freq === "weekly" ? "Day of the week" : freq === "biweekly" ? "Day (2nd week)" : freq === "quarterly" ? "Day of the 3rd month" : "Due day of month";
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (recurring && !form.name.trim()) return setError("Give the contribution a name.");
    if (!(parseFloat(form.amount) > 0)) return setError("Enter the per-member amount.");
    if (!recurring && !form.due_date) return setError("Pick a due date.");
    if (benefit && !recurring && !form.beneficiary_member_id) return setError("Pick the beneficiary for this emergency.");
    if (benefit && !recurring && !(parseFloat(form.payout_amount) > 0)) return setError("Enter the benefit to pay the beneficiary.");
    if (recurring && !isWeek(freq)) { const d = parseInt(form.due_day, 10); if (!(d >= 1 && d <= 28)) return setError("Due day must be between 1 and 28."); }
    if (usesAmount && !(parseFloat(form.fine_amount) > 0)) return setError("Enter the fine amount.");
    if (usesRate && !(parseFloat(form.fine_rate) > 0)) return setError("Enter the fine rate %.");
    setBusy(true);
    try {
      if (recurring) {
        const payload = { ...form, frequency: freq };
        const r = editing
          ? await api.put(`/welfares/${welfareId}/contribution-plans/${plan.id}`, payload)
          : await api.post(`/welfares/${welfareId}/contribution-plans`, payload);
        onSaved({ plan: r.data.data });
      } else {
        const r = await api.post(`/welfares/${welfareId}/cycles`, { ...form, name: form.name || undefined });
        onSaved({ cycle: r.data.data });
      }
    } catch (err) { setError(err.response?.data?.error || "Failed."); setBusy(false); }
  };
  const fld = "w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-sky-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1";

  const hint = {
    weekly: `Opens every week, due each ${WEEKDAYS.find((d) => d.v === Number(form.due_day))?.n || "week"}.`,
    biweekly: "Opens every 2 weeks, due on the chosen day of the second week.",
    monthly: `Opens each month, due on the ${ordinal(parseInt(form.due_day, 10) || 10)}.`,
    quarterly: `Opens every 3 months, due on the ${ordinal(parseInt(form.due_day, 10) || 10)} of the 3rd month.`,
    yearly: `Opens once a year, due ${MONTHS_FULL[(parseInt(form.due_month, 10) || 12) - 1]} ${ordinal(parseInt(form.due_day, 10) || 1)}.`,
    oneoff: "A one-off collection on the chosen date.",
  }[freq];

  return (
    <Shell title={editing ? (benefit ? "Edit event / emergency" : "Edit contribution") : createKind === "emergency" ? "New emergency" : createKind === "event" ? "New event" : (benefit ? "New event / emergency" : "New contribution")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Err msg={error} />}
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Name {recurring && "*"}</label><input value={form.name} onChange={set("name")} placeholder="e.g. Monthly, Quarterly" className={fld} /></div>
          <div><label className={lbl}>Frequency *</label>
            <select value={freq} onChange={(e) => changeFreq(e.target.value)} className={fld}>
              {freqOptions.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Amount per member *</label><input type="number" value={form.amount} onChange={set("amount")} className={fld} /></div>
          {!recurring ? (
            <div><label className={lbl}>Due date *</label><input type="date" min={today} value={form.due_date} onChange={set("due_date")} className={fld} /></div>
          ) : isWeek(freq) ? (
            <div><label className={lbl}>{dueLabel} *</label>
              <select value={form.due_day} onChange={set("due_day")} className={fld}>{WEEKDAYS.map((d) => <option key={d.v} value={d.v}>{d.n}</option>)}</select>
            </div>
          ) : freq === "yearly" ? (
            <div className="grid grid-cols-2 gap-2">
              <div><label className={lbl}>Month *</label><select value={form.due_month} onChange={set("due_month")} className={fld}>{MONTHS_FULL.map((mo, i) => <option key={i} value={i + 1}>{mo}</option>)}</select></div>
              <div><label className={lbl}>Day *</label><input type="number" min="1" max="28" value={form.due_day} onChange={set("due_day")} className={fld} /></div>
            </div>
          ) : (
            <div><label className={lbl}>{dueLabel} *</label><input type="number" min="1" max="28" value={form.due_day} onChange={set("due_day")} className={fld} /></div>
          )}
        </div>

        {/* The pool kind is set by the page. A benefit one-off (emergency) needs a beneficiary. */}
        {benefit && !recurring && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={lbl}>Beneficiary *</label>
              <select value={form.beneficiary_member_id} onChange={set("beneficiary_member_id")} className={fld}>
                <option value="">Select the member who receives the payout…</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className={lbl}>Benefit paid to beneficiary *</label>
              <input type="number" value={form.payout_amount} onChange={set("payout_amount")} placeholder="e.g. 150000" className={fld} />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Paid out from the emergency pool the moment you create this — only if the pool can cover it. Members' contributions above keep the pool funded.</p>
            </div>
          </div>
        )}
        {benefit && recurring && (
          <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2"><PoolBadge kind="benefit" /> Members contribute in; you disburse lump sums to beneficiaries from its pool.</p>
        )}

        <div className="border-t border-slate-100 dark:border-slate-700 pt-3">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Late fine</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={lbl}>Charge</label>
              <select value={form.fine_calc_type} onChange={set("fine_calc_type")} className={fld}>
                {FINE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {usesAmount && <div><label className={lbl}>Fine amount (KES)</label><input type="number" value={form.fine_amount} onChange={set("fine_amount")} className={fld} /></div>}
            {usesRate && <div><label className={lbl}>Fine rate (%)</label><input type="number" value={form.fine_rate} onChange={set("fine_rate")} className={fld} /></div>}
            {form.fine_calc_type && <div><label className={lbl}>Grace days</label><input type="number" min="0" value={form.grace_days} onChange={set("grace_days")} className={fld} /></div>}
            {form.fine_calc_type && <div><label className={lbl}>Cap (optional)</label><input type="number" value={form.fine_cap} onChange={set("fine_cap")} className={fld} /></div>}
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-slate-400">{hint} A schedule is created for every active member.</p>
        <Actions busy={busy} onClose={onClose} label={recurring ? "Save plan" : "Open contribution"} tone="bg-sky-600 hover:bg-sky-700" />
      </form>
    </Shell>
  );
}

function SchedulesModal({ welfareId, cycle, members = [], onClose, onChange, client = api, basePath = `/welfares/${welfareId}`, readOnly = false }) {
  const [schedules, setSchedules] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [payFor, setPayFor] = useState(null);
  const [busy, setBusy] = useState(false);
  const isBenefit = cycle.pool_key && cycle.pool_key !== "savings";

  const load = async () => {
    try {
      const r = await client.get(`${basePath}/cycles/${cycle.id}`);
      setSchedules(r.data.data.schedules || []);
      setDetail(r.data.data.cycle || null);
    } catch {/* */} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [cycle.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const assessLate = async () => {
    setBusy(true);
    try { const r = await client.post(`${basePath}/cycles/0/assess-late`, {}); alert(`${r.data.assessed} new late fine${r.data.assessed === 1 ? "" : "s"} assessed.`); load(); onChange?.(); }
    catch (e) { alert(e.response?.data?.error || "Failed"); } finally { setBusy(false); }
  };

  const STATUS = { paid: "bg-emerald-100 text-emerald-800", partial: "bg-amber-100 text-amber-800", overdue: "bg-red-100 text-red-700", pending: "bg-slate-100 text-slate-700" };

  return (
    <Shell title={`${cycle.name} — ${fmt(cycle.due_date)}`} onClose={onClose} wide>
      {isBenefit && (
        <div className="mb-4 bg-violet-50 border border-violet-100 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 mb-2"><PoolBadge kind="benefit" />{cycle.beneficiary_member_id ? <span className="text-sm text-slate-600">Beneficiary: <span className="font-semibold">{cycle.ben_first} {cycle.ben_last}</span></span> : null}</div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><p className="text-xs text-slate-500">Received by beneficiary</p><p className="text-lg font-bold text-violet-700">{money(detail?.received)}</p></div>
            <div><p className="text-xs text-slate-500">Collected from members</p><p className="text-lg font-bold text-emerald-700">{money(detail?.collected)}</p></div>
            <div><p className="text-xs text-slate-500">Deficit to collect</p><p className={`text-lg font-bold ${detail?.deficit > 0 ? "text-rose-600" : "text-slate-700"}`}>{money(detail?.deficit)}</p></div>
          </div>
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-slate-500 dark:text-slate-400">Late fine: {detail?.fine_calc_type ? <span className="font-semibold text-slate-700 dark:text-slate-200">{fineSummary(detail)}</span> : "none"}</span>
        {!readOnly && (
          <PermissionGate role={["admin", "manager"]}>
            <button onClick={assessLate} disabled={busy} className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold rounded-lg disabled:opacity-50">Assess late</button>
          </PermissionGate>
        )}
      </div>
      {loading ? <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Member</th>
                <th className="text-right px-3 py-2">Due</th>
                <th className="text-right px-3 py-2">Paid</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Timeliness</th>
                <th className="text-right px-3 py-2">Fine</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 dark:border-slate-700">
                  <td className="px-3 py-2 text-slate-800 dark:text-slate-100">{s.first_name} {s.last_name}</td>
                  <td className="px-3 py-2 text-right">{money(s.amount_due)}</td>
                  <td className="px-3 py-2 text-right">{money(s.amount_paid)}</td>
                  <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[s.status] || STATUS.pending}`}>{s.status}</span></td>
                  <td className="px-3 py-2">{timeliness(s)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{Number(s.fine) > 0 ? <span className={Number(s.fine_outstanding) > 0 ? "text-rose-600" : "text-slate-500"}>{money(s.fine)}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2 text-right">
                    {s.status !== "paid" && !readOnly && (
                      <PermissionGate role={["admin", "manager", "loan_officer"]}>
                        <button onClick={() => setPayFor(s)} className="text-emerald-600 hover:text-emerald-800 inline-flex items-center gap-1 text-sm font-semibold"><Coins size={14} /> Pay</button>
                      </PermissionGate>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {payFor && (
        <PayModal welfareId={welfareId} cycle={cycle} schedule={payFor} onClose={() => setPayFor(null)} onDone={() => { setPayFor(null); load(); onChange?.(); }} />
      )}
    </Shell>
  );
}

function PayModal({ welfareId, cycle, schedule, onClose, onDone }) {
  const outstanding = Number(schedule.amount_due) - Number(schedule.amount_paid);
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const amt = amount === "" ? outstanding : parseFloat(amount);
    if (!(amt > 0)) return setError("Enter an amount.");
    if (amt > outstanding) return setError(`Max ${money(outstanding)}.`);
    setBusy(true);
    try { await api.post(`/welfares/${welfareId}/cycles/${cycle.id}/schedules/${schedule.id}/pay`, { amount: amt }); onDone(); }
    catch (err) { setError(err.response?.data?.error || "Failed."); setBusy(false); }
  };

  // M-Pesa pays the full outstanding (Daraja confirms the actual amount).
  const requestMpesa = async () => {
    setError(""); setNotice(""); setBusy(true);
    try {
      const r = await api.post(`/welfares/${welfareId}/mpesa/contribution`, { schedule_id: schedule.id, phone: phone || undefined });
      setNotice(r.data?.message || "STK push sent — the member should enter their M-Pesa PIN.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't start the M-Pesa request.");
    } finally { setBusy(false); }
  };
  const fld = "w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-emerald-500 focus:outline-none";

  return (
    <Shell title={`Contribution — ${schedule.first_name} ${schedule.last_name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">Outstanding: <strong>{money(outstanding)}</strong></p>
        {error && <Err msg={error} />}
        {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"><Smartphone size={15} /> {notice}</div>}
        <div>
          <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">Amount <span className="text-gray-500 dark:text-slate-400 font-normal">(blank = full)</span></label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(outstanding)} className={fld} autoFocus />
        </div>
        <Actions busy={busy} onClose={onClose} label="Record payment" tone="bg-emerald-600 hover:bg-emerald-700" />
      </form>

      <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-700">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1 flex items-center gap-1.5"><Smartphone size={15} className="text-green-600" /> Or request via M-Pesa</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Sends an STK prompt for the full outstanding to the member's phone.</p>
        <div className="flex gap-2">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (blank = member's number)" className={`${fld} flex-1`} />
          <button type="button" onClick={requestMpesa} disabled={busy} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold disabled:opacity-50 whitespace-nowrap">STK push</button>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className={`bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full ${wide ? "max-w-2xl" : "max-w-md"} my-10`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
const Err = ({ msg }) => (
  <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"><AlertTriangle size={15} /> {msg}</div>
);
function Actions({ busy, onClose, label, tone }) {
  return (
    <div className="flex justify-end gap-3 pt-1">
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 font-semibold hover:bg-gray-50 dark:hover:bg-slate-700">Cancel</button>
      <button type="submit" disabled={busy} className={`px-5 py-2 rounded-lg text-white font-semibold disabled:opacity-50 ${tone}`}>{busy ? "Saving…" : label}</button>
    </div>
  );
}
