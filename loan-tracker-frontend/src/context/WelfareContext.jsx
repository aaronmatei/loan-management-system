import React, { createContext, useContext, useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import api from "../services/api";
import Spinner from "../components/Spinner";

// Resolves "my welfare" once for the standalone welfare app and shares the
// welfare id + record with every module page, so no screen needs a welfare id
// in its URL. Wraps the /welfare/* routes.
const WelfareContext = createContext({ welfareId: null, welfare: null });

export function useWelfare() {
  return useContext(WelfareContext);
}

export default function WelfareShell() {
  const [welfare, setWelfare] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/welfare/current")
      .then((r) => setWelfare(r.data.data))
      .catch((e) => setError(e.response?.data?.error || "Couldn't load your welfare"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-md p-12">
          <Spinner centered label="Loading your welfare…" />
        </div>
      </div>
    );
  }
  if (error || !welfare) {
    return (
      <div className="p-4 lg:p-8 max-w-3xl mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error || "No welfare found for this account."}
        </div>
      </div>
    );
  }

  return (
    <WelfareContext.Provider value={{ welfareId: welfare.id, welfare }}>
      <Outlet />
    </WelfareContext.Provider>
  );
}
