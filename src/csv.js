// csv.js

/**
 * Escape a CSV cell value and keep it Excel-safe.
 * - Escapes quotes
 * - Wraps in quotes when needed
 * - Flattens newlines to spaces
 */
export function csvEscape(value, delimiter = ";") {
  const s = String(value ?? "").replace(/\r?\n/g, " ").trim();
  const escaped = s.replace(/"/g, '""');

  const mustQuote =
    escaped.includes(delimiter) || escaped.includes('"') || /[\r\n]/.test(s);

  return mustQuote ? `"${escaped}"` : escaped;
}

/**
 * Force Excel to treat as TEXT (prevents scientific notation / losing digits).
 * Best for identifiers like UTR.
 */
export function excelText(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  // Excel will display the value and keep it as text
  return `="${s.replace(/"/g, '""')}"`;
}

/**
 * Convert rows to CSV.
 * - Adds `sep=<delimiter>` so Excel auto-detects separator on double-click
 * - Adds a header row
 */
export function rowsToCSV(rows, columns, delimiter = ";") {
  const header = columns.map((c) => csvEscape(c.label, delimiter)).join(delimiter);

  const lines = rows.map((row) =>
    columns
      .map((c) => {
        const raw =
          typeof c.get === "function" ? c.get(row) : row?.[c.key];

        // Per-column formatter support
        if (typeof c.format === "function") {
          return c.format(raw, { delimiter });
        }

        return csvEscape(raw, delimiter);
      })
      .join(delimiter)
  );

  // Excel auto-detect delimiter
  return [`sep=${delimiter}`, header, ...lines].join("\r\n");
}

/**
 * Download CSV (UTF-8 BOM so Excel reads it correctly).
 */
export function downloadCSV(csvText, filename = "export.csv") {
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csvText], { type: "text/csv;charset=utf-8" });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Export deposits to CSV.
 * - onlySelected=true exports only activeRows (Set of UTRs)
 * - UTR is forced as Excel TEXT to prevent 1.23E+11 formatting
 */
export function exportDepositsCSV({
  deposits = [],
  activeRows = new Set(),
  onlySelected = false,
  filename = "deposits.csv",
  delimiter = ";", // ✅ default for BG/EU Excel
} = {}) {
  const columns = [
    {
      label: "Date",
      get: (d) => d?.createdAt?.toDate?.()?.toLocaleString?.() || "",
    },
    { label: "Amount", get: (d) => d?.amount ?? "" },

    // ✅ UTR as TEXT (no scientific notation, no digit loss)
    {
      label: "UTR",
      get: (d) => d?.utr ?? "",
      format: (v) => excelText(v),
    },

    { label: "User", get: (d) => d?.username ?? "" },
    { label: "Email", get: (d) => d?.email ?? "" },
    {
      label: "Payment Method",
      get: (d) => String(d?.paymentMethod || "").toUpperCase(),
    },
    {
      label: "Status",
      get: (d) => String(d?.status || "PENDING").toUpperCase(),
    },
  ];

  const rows = onlySelected
    ? deposits.filter((d) => activeRows.has(String(d?.utr ?? "")))
    : deposits;

  if (!rows.length) {
    alert(onlySelected ? "No rows selected." : "No data to export.");
    return;
  }

  const csv = rowsToCSV(rows, columns, delimiter);
  downloadCSV(csv, filename);
}
