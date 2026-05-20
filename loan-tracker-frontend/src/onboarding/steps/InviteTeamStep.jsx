import React, { useState } from "react";
import api from "../../services/api";

// Default temporary password MUST satisfy validatePassword
// (>=12 chars, uppercase, digit, special). The spec's 'TempPass2026'
// has no special char and would be rejected by users.js POST.
const TEMP_PASSWORD = "TempPass@2026";

function InviteTeamStep({ onNext, onBack }) {
  const [invites, setInvites] = useState([
    { first_name: "", last_name: "", email: "", role: "loan_officer" },
  ]);
  const [saving, setSaving] = useState(false);

  const update = (idx, field, value) => {
    const c = [...invites];
    c[idx][field] = value;
    setInvites(c);
  };

  const submit = async (e) => {
    e.preventDefault();
    const valid = invites.filter((i) => i.email && i.first_name);
    if (valid.length === 0) {
      onNext();
      return;
    }
    setSaving(true);
    const sent = [];
    const failed = [];
    for (const inv of valid) {
      try {
        await api.post("/users", { ...inv, password: TEMP_PASSWORD });
        sent.push(inv.email);
      } catch (err) {
        failed.push({ email: inv.email, error: err.response?.data?.error });
      }
    }
    if (failed.length) {
      alert(
        `Sent ${sent.length}, ${failed.length} failed:\n` +
          failed.map((f) => `${f.email}: ${f.error}`).join("\n"),
      );
    }
    setSaving(false);
    onNext();
  };

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none";

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="bg-white rounded-3xl shadow-xl p-6 lg:p-10">
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">👥</div>
          <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-2">
            Invite Your Team
          </h2>
          <p className="text-gray-600">
            Add team members or skip this step (you can always add later)
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {invites.map((invite, idx) => (
            <div key={idx} className="bg-gray-50 rounded-lg p-3 space-y-2">
              <div className="flex justify-between items-center">
                <p className="font-semibold text-sm">Team Member #{idx + 1}</p>
                {invites.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setInvites(invites.filter((_, i) => i !== idx))
                    }
                    className="text-red-600 text-sm"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  placeholder="First Name"
                  value={invite.first_name}
                  onChange={(e) => update(idx, "first_name", e.target.value)}
                  className={fld}
                />
                <input
                  placeholder="Last Name"
                  value={invite.last_name}
                  onChange={(e) => update(idx, "last_name", e.target.value)}
                  className={fld}
                />
              </div>
              <input
                type="email"
                placeholder="Email Address"
                value={invite.email}
                onChange={(e) => update(idx, "email", e.target.value)}
                className={fld}
              />
              <select
                value={invite.role}
                onChange={(e) => update(idx, "role", e.target.value)}
                className={`${fld} bg-white`}
              >
                <option value="loan_officer">Loan Officer</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setInvites([
                ...invites,
                {
                  first_name: "",
                  last_name: "",
                  email: "",
                  role: "loan_officer",
                },
              ])
            }
            className="w-full py-2 bg-indigo-50 text-indigo-700 rounded-lg font-semibold text-sm hover:bg-indigo-100"
          >
            + Add Another Team Member
          </button>
          <p className="text-xs text-gray-500 text-center">
            💡 Default temporary password{" "}
            <span className="font-mono">{TEMP_PASSWORD}</span> — share securely
            and ask each member to reset on first login.
          </p>
          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onBack}
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => onNext()}
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold"
            >
              Skip
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3 bg-gradient-to-r from-indigo-600 to-purple-700 text-white font-bold rounded-lg disabled:opacity-50"
            >
              {saving ? "Inviting…" : "Send Invites →"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default InviteTeamStep;
