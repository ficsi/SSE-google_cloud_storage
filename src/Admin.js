import {
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { createPortal } from "react-dom";

import { db, app } from "./firebase";
import "./index.css";
import "./App.css";

import { exportDepositsCSV } from "./csv";

const ConfigEditor = lazy(() => import("./ConfigEditor"));

export default function Admin() {
  const [allDeposits, setAllDeposits] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");

  // ✅ selected rows (UTR Set)
  const [activeRows, setActiveRows] = useState(new Set());

  // ✅ Status dropdown
  const [openMenuFor, setOpenMenuFor] = useState(null); // UTR
  const [menuPos, setMenuPos] = useState(null); // { top, left, width }

  // ✅ Config modal
  const [showConfigModal, setShowConfigModal] = useState(false);

  // keep ref for click-outside area (optional)
  const menuRootRef = useRef(null);

  // Firebase callable
  const functions = useMemo(() => getFunctions(app, "us-central1"), []);
  const updateDepositStatus = useMemo(
    () => httpsCallable(functions, "updateDepositStatus"),
    [functions]
  );

  // Debug current user
  useEffect(() => {
    const auth = getAuth();
    // console.log("Current user:", auth.currentUser);
  }, []);

  // Close status menu on outside click
  useEffect(() => {
    const onDocClick = (e) => {
      if (!openMenuFor) return;
      // if click is inside the table body we still want to close,
      // but portal menu will stopPropagation itself
      setOpenMenuFor(null);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [openMenuFor]);

  // Prevent scroll when modal open
  useEffect(() => {
    if (!showConfigModal) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [showConfigModal]);

  // ESC closes modal
  useEffect(() => {
    if (!showConfigModal) return;
    const onKey = (e) => {
      if (e.key === "Escape") setShowConfigModal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showConfigModal]);

  // -----------------------
  // Status helpers
  // -----------------------
  const statusLabel = (s) => String(s || "PENDING").toUpperCase();

  const statusBadgeClass = (s) => {
    switch (statusLabel(s)) {
      case "RECEIVED":
        return "badge bg-success";
      case "NOT_RECEIVED":
        return "badge bg-danger";
      case "REFUNDED":
        return "badge bg-info";
      default:
        return "badge bg-warning"; // PENDING
    }
  };

  const allowedTransitions = useMemo(
    () => ({
      PENDING: ["RECEIVED", "NOT_RECEIVED"],
      RECEIVED: ["REFUNDED"],
      NOT_RECEIVED: [],
      REFUNDED: [],
    }),
    []
  );

  const optionsFor = (currentStatus) =>
    allowedTransitions[statusLabel(currentStatus)] || [];

  const doStatusUpdate = async (utr, nextStatus) => {
    if (!utr) return;
    const ok = window.confirm(`Change status → ${nextStatus}? (UTR: ${utr})`);
    if (!ok) return;

    try {
      await updateDepositStatus({ utr, status: nextStatus });
      setOpenMenuFor(null);
    } catch (e) {
      console.error("updateDepositStatus error:", e);
      alert(e?.message || "Failed to update status");
    }
  };

  // -----------------------
  // Payment method label
  // -----------------------
  const paymentMethodText = (d) => {
  // preferred
  if (d?.methodLabel) return d.methodLabel;

  // fallback
  const type = String(d?.paymentMethod || "").toUpperCase();
  const idx = Number(d?.methodIndex);
  const n = Number.isFinite(idx) ? idx + 1 : null;

  if (type === "UPI") return n ? `UPI ${n}` : "UPI";
  if (type === "BANK") return n ? `Bank ${n}` : "Bank Transfer";
  return "";
};


  // -----------------------
  // "NEW" highlight logic
  // -----------------------
  const NEW_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
  const SEEN_KEY = "betvibe_admin_last_seen_ms";

  useEffect(() => {
    // mark as seen when admin opens
    localStorage.setItem(SEEN_KEY, String(Date.now()));
  }, []);

  const createdAtMs = (d) => {
    const t = d?.createdAt;
    if (!t) return 0;
    if (typeof t.toMillis === "function") return t.toMillis();
    if (typeof t === "number") return t;
    return 0;
  };

  const isNew = (d) => {
    const ms = createdAtMs(d);
    if (!ms) return false;
    if (statusLabel(d.status) !== "PENDING") return false;
    return Date.now() - ms <= NEW_WINDOW_MS;
  };

  // -----------------------
  // Search filter
  // -----------------------
  const matchesSearch = (d, term) => {
    if (!term) return true;

    const t = term.toLowerCase();
    const utr = String(d.utr || "");
    const email = String(d.email || "").toLowerCase();
    const username = String(d.username || "").toLowerCase();
    const first = String(d.firstName || "").toLowerCase();
    const last = String(d.lastName || "").toLowerCase();

    return (
      utr.includes(term) ||
      email.includes(t) ||
      username.includes(t) ||
      first.includes(t) ||
      last.includes(t)
    );
  };

  const applyFilter = (rows, term) => rows.filter((d) => matchesSearch(d, term));

  const handleSearchTermFilter = (e) => {
    const term = e.target.value;
    setSearchTerm(term);
    setDeposits(applyFilter(allDeposits, term));
  };

  // -----------------------
  // Row selection
  // -----------------------
  const toggleRowSelection = (utr) => {
    if (!utr) return;
    setActiveRows((prev) => {
      const next = new Set(prev);
      next.has(utr) ? next.delete(utr) : next.add(utr);
      return next;
    });
  };

  // -----------------------
  // Live Firestore listener
  // -----------------------
  useEffect(() => {
    const q = query(collection(db, "deposits"), orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        setAllDeposits(rows);
        setDeposits(applyFilter(rows, searchTerm));
      },
      (err) => {
        console.error("onSnapshot error:", err);
      }
    );

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  return (
    <div style={{ padding: 20 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Deposits (Live)</h2>
          <div style={{ color: "#6b7280", fontSize: 13, marginTop: 4 }}>
            Status updates • CSV export • Config editor
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ borderRadius: 10 }}
            onClick={() => setShowConfigModal(true)}
          >
            <i className="fas fa-cog" style={{ marginRight: 8 }} />
            Edit Config
          </button>
        </div>
      </div>

      {/* Deposits card */}
      <div className="card">
        <div
          className="card-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h3 className="card-title" style={{ margin: 0 }}>
              Records
            </h3>

            {/* ✅ Export controls (restored) */}
            <div style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
              <button
                type="button"
                className="btn btn-sm btn-outline-primary"
                onClick={() =>
                  exportDepositsCSV({
                    deposits,
                    activeRows,
                    onlySelected: false,
                    filename: "deposits_all.csv",
                    delimiter: ";",
                  })
                }
              >
                Export All CSV
              </button>

              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={!activeRows.size}
                onClick={() =>
                  exportDepositsCSV({
                    deposits,
                    activeRows,
                    onlySelected: true,
                    filename: "deposits_selected.csv",
                    delimiter: ";",
                  })
                }
              >
                Export Selected ({activeRows.size})
              </button>

              <button
                type="button"
                className="btn btn-sm btn-default"
                disabled={!activeRows.size}
                onClick={() => setActiveRows(new Set())}
                title="Clear selection"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="card-tools">
            <div className="input-group input-group-sm" style={{ width: 260 }}>
              <input
                value={searchTerm}
                onChange={handleSearchTermFilter}
                type="text"
                className="form-control float-right"
                placeholder="Search (UTR / email / user)"
              />
              <div className="input-group-append">
                <button type="button" className="btn btn-default">
                  <i className="fas fa-search"></i>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="card-body table-responsive p-0" style={{ height: "80vh" }}>
          <table className="table table-head-fixed text-nowrap">
            <thead>
              <tr>
                <th>№</th>
                <th>Date</th>
                <th>Amount</th>
                <th>UTR</th>
                <th>User</th>
                <th>Email</th>
                <th>Payment Method</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody ref={menuRootRef}>
              {deposits.map((d, index) => {
                const currentStatus = statusLabel(d.status);
                const opts = optionsFor(currentStatus);
                const selected = activeRows.has(d.utr);

                return (
                  <tr
                    key={d.id}
                    className={selected ? "active" : ""}
                    style={{
                      background: isNew(d) ? "rgba(34,197,94,0.08)" : undefined,
                      outline: isNew(d)
                        ? "2px solid rgba(34,197,94,0.25)"
                        : undefined,
                      outlineOffset: isNew(d) ? "-2px" : undefined,
                      transition: "background 200ms ease",
                    }}
                  >
                    {/* ✅ Click selection on row number (as you had) */}
                    <td
                      className="row-num"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleRowSelection(d.utr);
                      }}
                      style={{ cursor: "pointer" }}
                      title="Select row"
                    >
                      {index + 1}
                    </td>

                    <td>{d.createdAt?.toDate?.().toLocaleString?.() || ""}</td>
                    <td>{d.amount ?? ""}</td>

                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 700 }}>{d.utr ?? ""}</span>

                        {isNew(d) && (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 800,
                              padding: "3px 8px",
                              borderRadius: 999,
                              background: "rgba(34,197,94,0.14)",
                              color: "#166534",
                              border: "1px solid rgba(34,197,94,0.25)",
                            }}
                          >
                            NEW
                          </span>
                        )}
                      </div>
                    </td>

                    <td>{d.username ?? ""}</td>
                    <td>{d.email ?? ""}</td>
                    <td>{paymentMethodText(d)}</td>

                    {/* Status badge + portal menu */}
                    <td style={{ position: "relative" }}>
                      <div style={{ display: "inline-block", position: "relative" }}>
                        <button
                          type="button"
                          className={statusBadgeClass(currentStatus)}
                          style={{
                            border: "none",
                            cursor: opts.length ? "pointer" : "default",
                            padding: "6px 10px",
                            borderRadius: 999,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!opts.length) return;

                            const rect = e.currentTarget.getBoundingClientRect();
                            const nextOpen = openMenuFor === d.utr ? null : d.utr;
                            setOpenMenuFor(nextOpen);

                            if (nextOpen) {
                              setMenuPos({
                                top: rect.bottom + 6,
                                left: rect.left,
                                width: Math.max(220, rect.width),
                              });
                            }
                          }}
                          title={opts.length ? "Change status" : "Status locked"}
                        >
                          {currentStatus}
                          {opts.length ? <span style={{ opacity: 0.8 }}>▾</span> : null}
                        </button>

                        {openMenuFor &&
                          menuPos &&
                          createPortal(
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                position: "fixed",
                                top: menuPos.top,
                                left: menuPos.left,
                                minWidth: menuPos.width,
                                background: "#fff",
                                border: "1px solid rgba(0,0,0,.12)",
                                borderRadius: 12,
                                boxShadow: "0 14px 40px rgba(0,0,0,.18)",
                                padding: "6px 0",
                                zIndex: 999999,
                              }}
                            >
                              {(optionsFor(
                                deposits.find((x) => x.utr === openMenuFor)?.status
                              ) || []).map((next) => (
                                <div
                                  key={next}
                                  role="button"
                                  onClick={() => doStatusUpdate(openMenuFor, next)}
                                  style={{
                                    padding: "10px 14px",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                    fontSize: 14,
                                    fontWeight: 600,
                                    color: "#111827",
                                  }}
                                  onMouseEnter={(e) =>
                                    (e.currentTarget.style.background = "#f3f4f6")
                                  }
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.background = "transparent")
                                  }
                                >
                                  <span
                                    style={{
                                      width: 10,
                                      height: 10,
                                      borderRadius: "50%",
                                      background:
                                        next === "RECEIVED"
                                          ? "#16a34a"
                                          : next === "NOT_RECEIVED"
                                          ? "#ef4444"
                                          : "#0ea5e9",
                                    }}
                                  />
                                  <span>{next.replaceAll("_", " ")}</span>
                                </div>
                              ))}

                              <div
                                style={{
                                  height: 1,
                                  background: "#e5e7eb",
                                  margin: "6px 0",
                                }}
                              />

                              <div
                                role="button"
                                onClick={() => setOpenMenuFor(null)}
                                style={{
                                  padding: "10px 14px",
                                  cursor: "pointer",
                                  fontSize: 13,
                                  color: "#6b7280",
                                }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.background = "#f9fafb")
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.background = "transparent")
                                }
                              >
                                Cancel
                              </div>
                            </div>,
                            document.body
                          )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {deposits.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 16, color: "#666" }}>
                    No records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ✅ AdminLTE-style Config modal */}
      {showConfigModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.55)",
            zIndex: 999999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setShowConfigModal(false)}
        >
          <div
            className="card"
            style={{
              width: "min(980px, 100%)",
              maxHeight: "85vh",
              borderRadius: 12,
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="card-header"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <h3 className="card-title" style={{ margin: 0 }}>
                <i className="fas fa-sliders-h" style={{ marginRight: 8 }} />
                Config Editor
              </h3>

              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                style={{ borderRadius: 10 }}
                onClick={() => setShowConfigModal(false)}
              >
                <i className="fas fa-times" style={{ marginRight: 6 }} />
                Close
              </button>
            </div>

            <div
              className="card-body"
              style={{
                overflow: "auto",
                maxHeight: "calc(85vh - 110px)",
              }}
            >
              <Suspense
                fallback={
                  <div style={{ padding: 12, color: "#6b7280" }}>Loading…</div>
                }
              >
                <ConfigEditor />
              </Suspense>
            </div>

            <div
              className="card-footer"
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
              }}
            >
              <button
                type="button"
                className="btn btn-outline-secondary"
                style={{ borderRadius: 10 }}
                onClick={() => setShowConfigModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
