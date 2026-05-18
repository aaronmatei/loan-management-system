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

export default bulkExport;
