import api from "../services/api";

/**
 * POST a bulk-export request and trigger a browser download of the
 * returned .xlsx blob. Shared by the Clients/Loans/Overdue pages.
 *
 * @param {string} endpoint - e.g. "/clients/bulk/export"
 * @param {object} payload  - e.g. { client_ids: [...] }
 * @param {string} filename - download filename
 */
export async function bulkExport(endpoint, payload, filename) {
  const response = await api.post(endpoint, payload, {
    responseType: "blob",
  });
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

/**
 * GET a file (PDF/CSV/etc.) with auth and trigger a browser download. The
 * server sets Content-Disposition; `filename` is the fallback name.
 *
 * @param {string} endpoint - e.g. "/welfares/3/reports/statement.pdf"
 * @param {string} filename - download filename
 */
export async function downloadFile(endpoint, filename) {
  const response = await api.get(endpoint, { responseType: "blob" });
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

export default bulkExport;
