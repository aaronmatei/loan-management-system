import React, { useState, useEffect } from "react";
import { Gavel, Plus, X, Trash2, Coins, Ban, AlertTriangle } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

const TRIGGERS = [
  { v: "contribution_late", label: "Late contribution" },
  { v: "loan_late", label: "Late loan" },
  { v: "attendance_absent", label: "Absent" },
  { v: "attendance_late", label: "Late to meeting" },
  { v: "meeting_missed", label: "Missed meeting" },
];
const CALC = [
  { v: "fixed", label: "Fixed (KES)" },
  { v: "percentage", label: "Percentage of amount" },
  { v: "daily_fixed", label: "Per day (KES)" },
  { v: "daily_percentage", label: "Per day (%)" },
];
const triggerLabel = (v) => TRIGGERS.find((t) => t.v === v)?.label || v;
const usesAmount = (c) => c === "fixed" || c === "daily_fixed";

// Per-chama penalty rules + the assessment ledger. Welfare accounts only.
export default function WelfarePenaltiesPanel({ welfareId }) {
  const [rules, setRules] = useState([]);
  const [penalties, setPenalties] = useState([]);
  const [members, setMembers] = useState([]);
  const [outstanding, setOutstanding] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showRule, setShowRule] = useState(false);
  const [showAssess, setShowAssess] = useState(false);

  const load = async () => {
    try {
      const [r, p, m] = await Promise.all([
        api.get(`/welfares/${welfareId}/penalty-rules`),
        api.get(`/welfares/${welfareId}/penalties?status=outstanding`),
        api.get(`/welfares/${welfareId}/members`),
      ]);
      setRules(r.data.data || []);
      setPenalties(p.data.data || []);
      setMembers(m.data.data || []);
      setOutstanding(p.data.outstanding_total || 0);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [welfareId]);

  const money = (v) =>
    "KES " + Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const ruleSummary = (r) => {
    const cap = r.cap ? ` · cap ${money(r.cap)}` : "";
    if (r.calc_type === "fixed") return `${money(r.amount)} once${cap}`;
    if (r.calc_type === "daily_fixed") return `${money(r.amount)} / day${cap}`;
    if (r.calc_type === "percentage") return `${r.rate}% of amount${cap}`;
    if (r.calc_type === "daily_percentage") return `${r.rate}% / day${cap}`;
    return "";
  };

  const deleteRule = async (id) => {
    if (!confirm("Delete this penalty rule?")) return;
    try { await api.delete(`/welfares/${welfareId}/penalty-rules/${id}`); load(); }
    catch (e) { alert(e.response?.data?.error || "Failed"); }
  };
  const pay = async (a) => {
    if (!confirm(`Record full payment of ${money(a.amount - a.paid_amount)} for this penalty?`)) return;
    try { await api.post(`/welfares/${welfareId}/penalties/${a.id}/pay`, {}); load(); }
    catch (e) { alert(e.response?.data?.error || "Failed"); }
  };
  const waive = async (a) => {
    if (!confirm("Waive this penalty?")) return;
    try { await api.post(`/welfares/${welfareId}/penalties/${a.id}/waive`, {}); load(); }
    catch (e) { alert(e.response?.data?.error || "Failed"); }
  };

  return (
    <div className="bg-white rounded-xl shadow-md border border-rose-100 mb-6 overflow-hidden">
      <div className="bg-rose-50 px-5 py-3 border-b border-rose-100 flex items-center justify-between">
        <h2 className="font-bold text-slate-900 flex items-center gap-2">
          <Gavel size={18} className="text-rose-600" /> Penalties
        </h2>
        <div className="text-right">
          <p className="text-xs text-rose-700/70">Outstanding</p>
          <p className="text-lg font-bold text-rose-800">{money(outstanding)}</p>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Rules */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-slate-800 text-sm uppercase tracking-wide">Rules</h3>
            <PermissionGate role={["admin", "manager"]}>
              <button onClick={() => setShowRule(true)} className="text-rose-600 hover:text-rose-800 text-sm font-semibold inline-flex items-center gap-1">
                <Plus size={15} /> Add rule
              </button>
            </PermissionGate>
          </div>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : rules.length === 0 ? (
            <p className="text-sm text-slate-500">No penalty rules yet. Add the fees your chama charges.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {rules.map((r) => (
                <span key={r.id} className={`inline-flex items-center gap-2 text-xs rounded-full px-3 py-1 border ${r.active ? "bg-slate-50 border-slate-200 text-slate-700" : "bg-slate-100 border-slate-200 text-slate-400 line-through"}`}>
                  <strong>{triggerLabel(r.trigger)}:</strong> {ruleSummary(r)}
                  <PermissionGate role={["admin", "manager"]}>
                    <button onClick={() => deleteRule(r.id)} className="text-slate-400 hover:text-red-600" title="Delete"><Trash2 size={13} /></button>
                  </PermissionGate>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Outstanding assessments */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-slate-800 text-sm uppercase tracking-wide">Outstanding penalties</h3>
            <PermissionGate role={["admin", "manager", "loan_officer"]}>
              <button onClick={() => setShowAssess(true)} className="text-rose-600 hover:text-rose-800 text-sm font-semibold inline-flex items-center gap-1">
                <Plus size={15} /> Assess penalty
              </button>
            </PermissionGate>
          </div>
          {penalties.length === 0 ? (
            <p className="text-sm text-slate-500">No outstanding penalties.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Member</th>
                    <th className="text-left px-4 py-2">Reason</th>
                    <th className="text-right px-4 py-2">Amount</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {penalties.map((a) => (
                    <tr key={a.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-slate-800">{a.first_name} {a.last_name}</td>
                      <td className="px-4 py-2 text-slate-600">{a.description || triggerLabel(a.trigger)}</td>
                      <td className="px-4 py-2 text-right font-semibold">{money(a.amount - a.paid_amount)}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <PermissionGate role={["admin", "manager", "loan_officer"]}>
                          <button onClick={() => pay(a)} className="text-emerald-600 hover:text-emerald-800 inline-flex items-center gap-1 text-sm font-semibold mr-3"><Coins size={14} /> Pay</button>
                        </PermissionGate>
                        <PermissionGate role={["admin", "manager"]}>
                          <button onClick={() => waive(a)} className="text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 text-sm font-semibold"><Ban size={14} /> Waive</button>
                        </PermissionGate>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showRule && (
        <RuleModal welfareId={welfareId} onClose={() => setShowRule(false)} onSaved={() => { setShowRule(false); load(); }} />
      )}
      {showAssess && (
        <AssessModal welfareId={welfareId} members={members} rules={rules} onClose={() => setShowAssess(false)} onDone={() => { setShowAssess(false); load(); }} />
      )}
    </div>
  );
}

function RuleModal({ welfareId, onClose, onSaved }) {
  const [form, setForm] = useState({ trigger: "attendance_absent", calc_type: "fixed", amount: "", rate: "", cap: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (usesAmount(form.calc_type) && !(parseFloat(form.amount) > 0)) return setError("Enter the fee amount.");
    if (!usesAmount(form.calc_type) && !(parseFloat(form.rate) > 0)) return setError("Enter the rate %.");
    setBusy(true);
    try { await api.post(`/welfares/${welfareId}/penalty-rules`, form); onSaved(); }
    catch (err) { setError(err.response?.data?.error || "Failed."); setBusy(false); }
  };
  const fld = "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-rose-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 mb-1";

  return (
    <ModalShell title="New penalty rule" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Err msg={error} />}
        <div>
          <label className={lbl}>When</label>
          <select value={form.trigger} onChange={set("trigger")} className={fld}>
            {TRIGGERS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Charge</label>
          <select value={form.calc_type} onChange={set("calc_type")} className={fld}>
            {CALC.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {usesAmount(form.calc_type) ? (
            <div><label className={lbl}>Amount (KES)</label><input type="number" value={form.amount} onChange={set("amount")} className={fld} /></div>
          ) : (
            <div><label className={lbl}>Rate (%)</label><input type="number" value={form.rate} onChange={set("rate")} className={fld} /></div>
          )}
          <div><label className={lbl}>Cap (optional)</label><input type="number" value={form.cap} onChange={set("cap")} placeholder="Max" className={fld} /></div>
        </div>
        <Actions busy={busy} onClose={onClose} label="Add rule" tone="bg-rose-600 hover:bg-rose-700" />
      </form>
    </ModalShell>
  );
}

function AssessModal({ welfareId, members, rules, onClose, onDone }) {
  const [form, setForm] = useState({ member_id: "", rule_id: "", amount: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const rule = rules.find((r) => String(r.id) === String(form.rule_id));
  const fixedAmt = rule && rule.calc_type === "fixed" ? Number(rule.amount) : null;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.member_id) return setError("Pick a member.");
    const amt = form.amount !== "" ? parseFloat(form.amount) : fixedAmt;
    if (!form.rule_id && !(amt > 0)) return setError("Pick a rule or enter an amount.");
    setBusy(true);
    try {
      await api.post(`/welfares/${welfareId}/penalties`, {
        member_id: form.member_id,
        rule_id: form.rule_id || null,
        amount: form.amount !== "" ? parseFloat(form.amount) : undefined,
        description: form.description || null,
      });
      onDone();
    } catch (err) { setError(err.response?.data?.error || "Failed."); setBusy(false); }
  };
  const fld = "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-rose-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 mb-1";

  return (
    <ModalShell title="Assess a penalty" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Err msg={error} />}
        <div>
          <label className={lbl}>Member *</label>
          <select value={form.member_id} onChange={set("member_id")} className={fld}>
            <option value="">Select member…</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Rule <span className="text-gray-500 font-normal">(optional)</span></label>
          <select value={form.rule_id} onChange={set("rule_id")} className={fld}>
            <option value="">— custom amount —</option>
            {rules.filter((r) => r.active).map((r) => (
              <option key={r.id} value={r.id}>{triggerLabel(r.trigger)} ({r.calc_type})</option>
            ))}
          </select>
        </div>
        <div>
          <label className={lbl}>Amount {fixedAmt != null && <span className="text-gray-500 font-normal">(rule = KES {fixedAmt})</span>}</label>
          <input type="number" value={form.amount} onChange={set("amount")} placeholder={fixedAmt != null ? String(fixedAmt) : "Enter amount"} className={fld} />
          <p className="text-xs text-gray-500 mt-1">Leave blank to use a fixed rule's amount. For %/daily rules, enter the computed amount.</p>
        </div>
        <div>
          <label className={lbl}>Note</label>
          <input value={form.description} onChange={set("description")} className={fld} />
        </div>
        <Actions busy={busy} onClose={onClose} label="Assess" tone="bg-rose-600 hover:bg-rose-700" />
      </form>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }) {
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
const Err = ({ msg }) => (
  <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"><AlertTriangle size={15} /> {msg}</div>
);
function Actions({ busy, onClose, label, tone }) {
  return (
    <div className="flex justify-end gap-3 pt-1">
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50">Cancel</button>
      <button type="submit" disabled={busy} className={`px-5 py-2 rounded-lg text-white font-semibold disabled:opacity-50 ${tone}`}>{busy ? "Saving…" : label}</button>
    </div>
  );
}
