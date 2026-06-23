import React, { useState, useEffect } from "react";
import {
  Package,
  Link,
  Globe,
  Eye,
  Smartphone,
  Monitor,
  ClipboardList,
  CheckCircle,
  Info,
  Calculator,
} from "lucide-react";
import api from "../services/api";
import PageHeader from "../components/PageHeader";
import Skeleton from "../components/Skeleton";
import { useToast } from "../components/Toast";

function EmbedSettings() {
  const { toast } = useToast();
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(null);
  const [previewSize, setPreviewSize] = useState("mobile");

  useEffect(() => {
    api
      .get("/white-label/settings")
      .then((r) => setTenant(r.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="p-4 lg:p-8 max-w-6xl mx-auto">
        <PageHeader
          icon={Calculator}
          title="Loan Calculator Widget"
          subtitle="Embed your branded calculator on your website"
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      </div>
    );
  if (!tenant) return null;

  const baseUrl =
    import.meta.env.VITE_FRONTEND_URL || window.location.origin;
  const widgetUrl = `${baseUrl}/widget/calculator/${tenant.subdomain}`;
  const brand = tenant.brand_color || "#0e8a6e";

  const iframeCode = `<iframe
  src="${widgetUrl}"
  width="100%"
  height="650"
  frameborder="0"
  style="border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);"
  title="Loan Calculator">
</iframe>`;

  const linkCode = `<a href="${widgetUrl}" target="_blank" rel="noopener">
  Use Our Loan Calculator
</a>`;

  const buttonCode = `<a href="${widgetUrl}" target="_blank" rel="noopener"
  style="display: inline-block; padding: 12px 24px; background: ${brand};
         color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
  Calculate Your Loan
</a>`;

  const copy = (code, type) => {
    navigator.clipboard.writeText(code);
    setCopied(type);
    toast("Copied to clipboard"); // UI feedback only
    setTimeout(() => setCopied(null), 2000);
  };

  const CopyCard = ({ title, desc, code, type }) => (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4">
      <h3 className="font-bold text-gray-800 dark:text-slate-100 mb-1">{title}</h3>
      <p className="text-sm text-gray-600 dark:text-slate-400 mb-3">{desc}</p>
      <pre className="bg-gray-900 text-green-400 p-3 rounded-lg text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
        {code}
      </pre>
      <button
        onClick={() => copy(code, type)}
        className="mt-2 w-full py-2 bg-ocean-600 hover:bg-ocean-700 text-white rounded-lg font-semibold text-sm inline-flex items-center justify-center gap-2"
      >
        {copied === type ? <><CheckCircle size={16} /> Copied!</> : <><ClipboardList size={16} /> Copy</>}
      </button>
    </div>
  );

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto">
      <PageHeader
        icon={Calculator}
        title="Loan Calculator Widget"
        subtitle="Embed your branded calculator on your website"
      />

      <div className="bg-ocean-gradient-soft rounded-2xl p-4 mb-6 border border-ocean-200">
        <h2 className="font-bold text-ocean-900 mb-2 flex items-center gap-2"><Info size={16} className="text-ocean-700" /> Why use this?</h2>
        <ul className="space-y-1 text-sm text-ocean-800">
          <li className="flex items-start gap-2"><CheckCircle size={14} className="mt-0.5 shrink-0 text-ocean-600" /> Capture leads directly from YOUR website</li>
          <li className="flex items-start gap-2"><CheckCircle size={14} className="mt-0.5 shrink-0 text-ocean-600" /> Help visitors estimate loans before applying</li>
          <li className="flex items-start gap-2"><CheckCircle size={14} className="mt-0.5 shrink-0 text-ocean-600" /> Branded with your business name and color</li>
          <li className="flex items-start gap-2">
            <CheckCircle size={14} className="mt-0.5 shrink-0 text-ocean-600" /> &ldquo;Apply Now&rdquo; goes straight to your client portal with the
            amount/duration pre-filled
          </li>
        </ul>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <CopyCard
            title={<span className="inline-flex items-center gap-2"><Package size={16} /> Embed (iframe)</span>}
            desc="Best option — embeds the full calculator on any page."
            code={iframeCode}
            type="iframe"
          />
          <CopyCard
            title={<span className="inline-flex items-center gap-2"><Link size={16} /> Button Link</span>}
            desc="Opens the calculator in a new tab."
            code={buttonCode}
            type="button"
          />
          <CopyCard
            title={<span className="inline-flex items-center gap-2"><Link size={16} /> Simple Link</span>}
            desc="Just a plain text link."
            code={linkCode}
            type="link"
          />
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4">
            <h3 className="font-bold text-gray-800 dark:text-slate-100 mb-1 flex items-center gap-2"><Globe size={16} /> Direct URL</h3>
            <p className="text-sm text-gray-600 dark:text-slate-400 mb-3">Share the widget directly.</p>
            <div className="bg-gray-100 dark:bg-slate-700 p-3 rounded-lg text-sm font-mono break-all">
              {widgetUrl}
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => copy(widgetUrl, "url")}
                className="flex-1 py-2 bg-ocean-600 hover:bg-ocean-700 text-white rounded-lg font-semibold text-sm"
              >
                {copied === "url" ? <span className="inline-flex items-center gap-1"><CheckCircle size={14} /> Copied!</span> : <span className="inline-flex items-center gap-1"><ClipboardList size={14} /> Copy URL</span>}
              </button>
              <a
                href={widgetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2 bg-white border-2 border-ocean-200 text-ocean-700 rounded-lg font-semibold text-sm text-center hover:bg-ocean-50"
              >
                Open ↗
              </a>
            </div>
          </div>
        </div>

        <div>
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4 sticky top-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2"><Eye size={16} /> Live preview</h3>
              <div className="flex gap-1">
                <button
                  onClick={() => setPreviewSize("mobile")}
                  className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
                    previewSize === "mobile"
                      ? "bg-ocean-600 text-white"
                      : "bg-gray-100 dark:bg-slate-700"
                  }`}
                >
                  <Smartphone size={14} />
                </button>
                <button
                  onClick={() => setPreviewSize("desktop")}
                  className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
                    previewSize === "desktop"
                      ? "bg-ocean-600 text-white"
                      : "bg-gray-100 dark:bg-slate-700"
                  }`}
                >
                  <Monitor size={14} />
                </button>
              </div>
            </div>
            <div
              className="mx-auto bg-gray-100 dark:bg-slate-700 rounded-lg p-2 transition-all"
              style={{ maxWidth: previewSize === "mobile" ? "375px" : "100%" }}
            >
              <iframe
                src={widgetUrl}
                width="100%"
                height="650"
                frameBorder="0"
                title="Calculator Preview"
                className="rounded-lg shadow"
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-3 text-center">
              This is what visitors will see when embedded on your website
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4 lg:p-6 mt-6">
        <h2 className="font-bold text-xl mb-4 flex items-center gap-2"><Info size={20} /> How to embed</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[
            ["1. Copy code", "Click Copy on the iframe option — that's the recommended embed."],
            ["2. Paste on your site", "Add the snippet to your site's HTML where you want the calculator."],
            ["3. Get leads", "Visitors calculate → click Apply → become your clients."],
          ].map(([t, d]) => (
            <div key={t} className="border-l-4 border-ocean-600 pl-3">
              <p className="font-bold text-sm mb-1">{t}</p>
              <p className="text-xs text-gray-600 dark:text-slate-400">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default EmbedSettings;
