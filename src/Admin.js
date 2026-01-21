import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  where,
  Timestamp,
} from "firebase/firestore";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

import NotesPanel from "./NotesPanel";
import { db, app } from "./firebase";
import "./index.css";
import "./App.css";
import { exportDepositsCSV } from "./csv";
import Ledger from "./Ledger";

const ConfigEditor = lazy(() => import("./ConfigEditor"));

export default function Admin() {
  const navigate = useNavigate();
  const [balances, setBalances] = useState({ upi: 0, imps: 0, total: 0 });
  const [balancesErr, setBalancesErr] = useState("");

  // data
  const [allDeposits, setAllDeposits] = useState([]);
  const [deposits, setDeposits] = useState([]);

  // filters
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFrom, setDateFrom] = useState(""); // YYYY-MM-DD
  const [dateTo, setDateTo] = useState(""); // YYYY-MM-DD

  // ui state
  const [activeRows, setActiveRows] = useState(new Set());
  const [openMenuFor, setOpenMenuFor] = useState(null); // UTR
  const [menuPos, setMenuPos] = useState(null); // { top, left, width }
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [notesForUtr, setNotesForUtr] = useState(null);

  // auth gating
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [permissionError, setPermissionError] = useState("");

  // Firebase callable
  const functions = useMemo(() => getFunctions(app, "us-central1"), []);
  const updateDepositStatus = useMemo(
    () => httpsCallable(functions, "updateDepositStatus"),
    [functions],
  );

  // -----------------------
  // Helpers
  // -----------------------
  const getBalances = useMemo(
    () => httpsCallable(functions, "getBalances"),
    [functions],
  );

  const statusLabel = (s) => String(s || "PENDING").toUpperCase();

  const statusBadgeClass = (s) => {
    switch (statusLabel(s)) {
      case "MISMATCH":
        return "badge bg-pink";
      case "TEST":
        return "badge bg-black";
      case "RECEIVED":
        return "badge bg-success";
      case "NOT_RECEIVED":
        return "badge bg-danger";
      case "REFUNDED":
        return "badge bg-info";
      default:
        return "badge bg-warning";
    }
  };

  const allowedTransitions = useMemo(
    () => ({
      PENDING: ["RECEIVED", "NOT_RECEIVED", "MISMATCH", "TEST"],
      TEST: ["RECEIVED", "NOT_RECEIVED", "MISMATCH"],
      MISMATCH: ["RECEIVED", "NOT_RECEIVED"],
      RECEIVED: ["REFUNDED", "NOT_RECEIVED", "MISMATCH"],
      NOT_RECEIVED: ["RECEIVED", "MISMATCH"],
      REFUNDED: [],
    }),
    [],
  );

  const optionsFor = (currentStatus) =>
    allowedTransitions[statusLabel(currentStatus)] || [];

  const createdAtMs = (d) => {
    const t = d?.createdAt;
    if (!t) return 0;
    if (typeof t.toMillis === "function") return t.toMillis();
    if (typeof t === "number") return t;
    return 0;
  };

  const paymentMethodText = (d) => {
    if (d?.methodLabel) return d.methodLabel;

    const type = String(d?.paymentMethod || "").toUpperCase();
    const idx = Number(d?.methodIndex);
    const n = Number.isFinite(idx) ? idx + 1 : null;

    if (type === "UPI") return n ? `UPI ${n}` : "UPI";
    if (type === "BANK") return n ? `Bank ${n}` : "Bank Transfer";
    return "";
  };

  function applyFilter(rows, term, fromStr, toStr) {
    const t = String(term || "")
      .trim()
      .toLowerCase();

    const fromMs = fromStr ? new Date(`${fromStr}T00:00:00`).getTime() : null;
    const toMs = toStr ? new Date(`${toStr}T23:59:59.999`).getTime() : null;

    return rows.filter((d) => {
      const utr = String(d.utr || "");
      const email = String(d.email || "").toLowerCase();
      const username = String(d.username || "").toLowerCase();
      const first = String(d.firstName || "").toLowerCase();
      const last = String(d.lastName || "").toLowerCase();

      const matchesText =
        !t ||
        utr.toLowerCase().includes(t) ||
        email.includes(t) ||
        username.includes(t) ||
        first.includes(t) ||
        last.includes(t);

      if (!matchesText) return false;

      const ms = createdAtMs(d);
      if (!ms) return false;

      if (fromMs !== null && ms < fromMs) return false;
      if (toMs !== null && ms > toMs) return false;

      return true;
    });
  }

  // -----------------------
  // NEW highlight + favicon + sound
  // -----------------------
  const NEW_WINDOW_MS = 2 * 60 * 1000;
  const isNew = (d) => {
    const ms = createdAtMs(d);
    if (!ms) return false;
    if (statusLabel(d.status) !== "PENDING") return false;
    return Date.now() - ms <= NEW_WINDOW_MS;
  };

  const faviconIntervalRef = useRef(null);
  const faviconOnRef = useRef(false);

  const notifyAudioRef = useRef(null);
  const notifyTimerRef = useRef(null);
  const notifyActiveRef = useRef(false);

  const NOTIFY_AUDIO_SRC = "/notify.mp3";
  const NOTIFY_MS = 3_000;

  function setFavicon(href) {
    let link =
      document.querySelector("link[rel='icon']") ||
      document.querySelector("link[rel='shortcut icon']");

    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = `${href}?v=${Date.now()}`;
  }

  function startFaviconBlink() {
    if (faviconIntervalRef.current) return;
    faviconOnRef.current = false;

    faviconIntervalRef.current = setInterval(() => {
      faviconOnRef.current = !faviconOnRef.current;
      setFavicon(faviconOnRef.current ? "/favicon-green.ico" : "/favicon.ico");
    }, 800);
  }

  function stopFaviconBlink() {
    if (faviconIntervalRef.current) {
      clearInterval(faviconIntervalRef.current);
      faviconIntervalRef.current = null;
    }
    faviconOnRef.current = false;
    setFavicon("/favicon.ico");
  }

  function startNotifySound() {
    if (notifyActiveRef.current) return;
    notifyActiveRef.current = true;

    if (!notifyAudioRef.current) {
      const a = new Audio(NOTIFY_AUDIO_SRC);
      a.preload = "auto";
      a.loop = true;
      a.volume = 1.0;
      notifyAudioRef.current = a;
    }

    const a = notifyAudioRef.current;
    try {
      a.currentTime = 0;
      a.play().catch(() => {});
    } catch {}

    clearTimeout(notifyTimerRef.current);
    notifyTimerRef.current = setTimeout(() => stopNotifySound(), NOTIFY_MS);
  }

  function stopNotifySound() {
    notifyActiveRef.current = false;

    clearTimeout(notifyTimerRef.current);
    notifyTimerRef.current = null;

    const a = notifyAudioRef.current;
    if (a) {
      try {
        a.pause();
        a.currentTime = 0;
      } catch {}
    }
  }
  const toAmount = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const totals = useMemo(() => {
    let upi = 0,
      bank = 0,
      pending = 0,
      mismatch = 0,
      refunded = 0;

    for (const d of allDeposits) {
      const status = statusLabel(d.status);
      const method = String(d.paymentMethod || "").toUpperCase();
      const amt = toAmount(d.amount);

      if (amt <= 0) continue;

      if (status === "RECEIVED") {
        if (method === "UPI") upi += amt;
        else if (method === "BANK") bank += amt;
      } else if (status === "PENDING") pending += amt;
      else if (status === "MISMATCH") mismatch += amt;
      else if (status === "REFUNDED") refunded += amt;
    }

    return {
      upi,
      bank,
      total: upi + bank,
      pending,
      mismatch,
      refunded,
    };
  }, [allDeposits, statusLabel]);

  // -----------------------
  // Auth + Admin claim check (IMPORTANT)
  // -----------------------

  useEffect(() => {
    if (!authReady) return;
    if (!user) return;

    let alive = true;

    async function load() {
      try {
        const res = await getBalances();
        if (!alive) return;
        setBalancesErr("");
        setBalances(res.data?.balances || { upi: 0, imps: 0, total: 0 });
      } catch (e) {
        console.error("getBalances error:", e);
        setBalancesErr(e?.message || "Failed to load balances");
      }
    }

    load();
    const t = setInterval(load, 10_000); // refresh every 10s (optional)

    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [authReady, user, getBalances]);

  useEffect(() => {
    const auth = getAuth();

    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u || null);
      setAuthReady(true);
      setPermissionError("");

      if (!u) {
        setIsAdmin(false);
        return;
      }

      // Force refresh so custom claims are present immediately
      try {
        await u.getIdToken(true);
        const token = await u.getIdTokenResult();
        setIsAdmin(token?.claims?.admin === true);
      } catch (e) {
        console.error("Token refresh error:", e);
        setIsAdmin(false);
      }
    });

    return () => unsub();
  }, []);

  // -----------------------
  // Firestore listener (ONLY when admin)
  // -----------------------
  useEffect(() => {
    if (!authReady) return;

    if (!user) {
      setAllDeposits([]);
      setPermissionError("You are not logged in.");
      return;
    }

    if (!isAdmin) {
      setAllDeposits([]);
      setPermissionError("You are logged in, but you are not an admin.");
      return;
    }

    setPermissionError("");

    const start = dateFrom
      ? Timestamp.fromDate(new Date(`${dateFrom}T00:00:00`))
      : null;
    const end = dateTo
      ? Timestamp.fromDate(new Date(`${dateTo}T23:59:59.999`))
      : null;

    // IMPORTANT:
    // since we range filter by createdAt, we MUST orderBy createdAt
    let q = query(collection(db, "deposits"), orderBy("createdAt", "desc"));

    if (start) q = query(q, where("createdAt", ">=", start));
    if (end) q = query(q, where("createdAt", "<=", end));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setAllDeposits(rows);
      },
      (err) => {
        console.error("onSnapshot error:", err);
        setPermissionError(err?.message || "Failed to load deposits.");
      },
    );

    return () => unsub();
  }, [authReady, user, isAdmin, dateFrom, dateTo]);

  // Apply filters
  useEffect(() => {
    setDeposits(applyFilter(allDeposits, searchTerm, "", ""));
  }, [allDeposits, searchTerm, dateFrom, dateTo]);

  // NEW pending notifications
  useEffect(() => {
    const hasNewPending = deposits.some(
      (d) => statusLabel(d.status) === "PENDING" && isNew(d),
    );

    if (hasNewPending) {
      startFaviconBlink();
      startNotifySound();
    } else {
      stopFaviconBlink();
      stopNotifySound();
    }
  }, [deposits]);

  // stop on focus
  useEffect(() => {
    const onFocus = () => {
      stopFaviconBlink();
      stopNotifySound();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Close status menu on outside click
  useEffect(() => {
    const onDocClick = () => {
      if (!openMenuFor) return;
      setOpenMenuFor(null);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [openMenuFor]);

  // Prevent scroll when modal open
  useEffect(() => {
    if (!showConfigModal && !notesForUtr) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [showConfigModal, notesForUtr]);

  // ESC closes modals
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setShowConfigModal(false);
      setNotesForUtr(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // -----------------------
  // Actions
  // -----------------------
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

  const toggleRowSelection = (utr) => {
    if (!utr) return;
    setActiveRows((prev) => {
      const next = new Set(prev);
      next.has(utr) ? next.delete(utr) : next.add(utr);
      return next;
    });
  };

  const clearDates = () => {
    setDateFrom("");
    setDateTo("");
  };

  const periodTotals = useMemo(() => {
    const sum = {
      receivedUpi: 0,
      receivedImps: 0,
      receivedTotal: 0,
      pendingUpi: 0,
      pendingImps: 0,
      pendingTotal: 0,
    };

    for (const d of deposits) {
      const amount = Number(d.amount) || 0;
      if (amount <= 0) continue;

      const status = String(d.status || "PENDING").toUpperCase();
      const method = String(d.paymentMethod || "").toUpperCase(); // UPI or BANK

      const isUpi = method === "UPI";
      const isImps = method === "BANK"; // you map BANK -> IMPS bucket

      if (status === "RECEIVED") {
        if (isUpi) sum.receivedUpi += amount;
        if (isImps) sum.receivedImps += amount;
        sum.receivedTotal += amount;
      }

      if (status === "PENDING") {
        if (isUpi) sum.pendingUpi += amount;
        if (isImps) sum.pendingImps += amount;
        sum.pendingTotal += amount;
      }
    }

    return sum;
  }, [deposits]);

  // -----------------------
  // UI
  // -----------------------
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
            Status updates • CSV export • Config editor • Notes
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}></div>
      </div>

      {/* Permission banner */}
      {permissionError ? (
        <div className="alert alert-danger" style={{ marginBottom: 12 }}>
          <b>Firestore:</b> {permissionError}
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>
            If this is wrong, verify: (1) same Firebase projectId, (2) admin
            claim on this uid, (3) rules allow deposits + notes subcollection.
          </div>
        </div>
      ) : null}
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="col-md-3 col-sm-6 col-12">
          <div className="info-box">
            <span className="info-box-icon bg-success">
              <i className="fas fa-wallet" />
            </span>
            <div className="info-box-content">
              <span className="info-box-text">UPI Received</span>
              <span className="info-box-number">
                {periodTotals.receivedUpi.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        <div className="col-md-3 col-sm-6 col-12">
          <div className="info-box">
            <span className="info-box-icon bg-primary">
              <i className="fas fa-university" />
            </span>
            <div className="info-box-content">
              <span className="info-box-text">Bank Received</span>
              <span className="info-box-number">
                {periodTotals.receivedImps.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        <div className="col-md-3 col-sm-6 col-12">
          <div className="info-box">
            <span className="info-box-icon bg-info">
              <i className="fas fa-coins" />
            </span>
            <div className="info-box-content">
              <span className="info-box-text">Total Received</span>
              <span className="info-box-number">
                {periodTotals.receivedTotal.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        <div className="col-md-3 col-sm-6 col-12">
          <div className="info-box">
            <span className="info-box-icon bg-warning">
              <i className="fas fa-clock" />
            </span>
            <div className="info-box-content">
              <span className="info-box-text">Pending</span>
              <span className="info-box-number">
                {periodTotals.pendingTotal.toLocaleString()}
              </span>
            </div>
          </div>
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

            <div
              style={{ display: "inline-flex", gap: 10, alignItems: "center" }}
            >
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
                onChange={(e) => setSearchTerm(e.target.value)}
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

          {/* Date range */}
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div className="input-group input-group-sm" style={{ width: 185 }}>
              <div className="input-group-prepend">
                <span className="input-group-text">From</span>
              </div>
              <input
                type="date"
                className="form-control"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <div className="input-group input-group-sm" style={{ width: 185 }}>
              <div className="input-group-prepend">
                <span className="input-group-text">To</span>
              </div>
              <input
                type="date"
                className="form-control"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>

            <button
              type="button"
              className="btn btn-sm btn-default"
              disabled={!dateFrom && !dateTo}
              onClick={clearDates}
            >
              Clear dates
            </button>
          </div>
        </div>

        <div
          className="card-body table-responsive p-0"
          style={{ height: "80vh" }}
        >
          <table className="table table-head-fixed text-nowrap">
            <thead>
              <tr>
                <th>№</th>
                <th>Date</th>
                <th>Amount</th>
                <th>UTR</th>
                <th>Email</th>
                <th>Payment Method</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>

            <tbody>
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
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
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

                    <td>{d.email ?? ""}</td>
                    <td>{paymentMethodText(d)}</td>

                    <td style={{ position: "relative" }}>
                      <div
                        style={{
                          display: "inline-block",
                          position: "relative",
                        }}
                      >
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

                            const rect =
                              e.currentTarget.getBoundingClientRect();
                            const nextOpen =
                              openMenuFor === d.utr ? null : d.utr;
                            setOpenMenuFor(nextOpen);

                            if (nextOpen) {
                              setMenuPos({
                                top: rect.bottom + 6,
                                left: rect.left,
                                width: Math.max(220, rect.width),
                              });
                            }
                          }}
                          title={
                            opts.length ? "Change status" : "Status locked"
                          }
                        >
                          {currentStatus}
                          {opts.length ? (
                            <span style={{ opacity: 0.8 }}>▾</span>
                          ) : null}
                        </button>

                        {openMenuFor && menuPos
                          ? createPortal(
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
                                  padding: "6px 0",
                                  zIndex: 999999,
                                }}
                              >
                                {(
                                  optionsFor(
                                    deposits.find((x) => x.utr === openMenuFor)
                                      ?.status,
                                  ) || []
                                ).map((next) => (
                                  <div
                                    key={next}
                                    role="button"
                                    onClick={() =>
                                      doStatusUpdate(openMenuFor, next)
                                    }
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
                                      (e.currentTarget.style.background =
                                        "#f3f4f6")
                                    }
                                    onMouseLeave={(e) =>
                                      (e.currentTarget.style.background =
                                        "transparent")
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
                                              : next === "MISMATCH"
                                                ? "#f59e0b"
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
                                    (e.currentTarget.style.background =
                                      "#f9fafb")
                                  }
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.background =
                                      "transparent")
                                  }
                                >
                                  Cancel
                                </div>
                              </div>,
                              document.body,
                            )
                          : null}
                      </div>
                    </td>

                    <td>
                      <span
                        className="info-box-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowConfigModal(false);
                          setNotesForUtr(d.utr);
                        }}
                        style={{ cursor: "pointer" }}
                        title="Notes"
                      >
                        <i className="fas fa-comments"></i>
                        {!!d.notesCount && (
                          <span
                            className="test"
                            style={{
                              position: "absolute",
                              top: -4,
                              right: -16,
                              minWidth: 18,
                              height: 18,
                              borderRadius: 999,
                              padding: "0 6px",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 11,
                              fontWeight: 800,
                              background: "#ef4444",
                              color: "#fff",
                              border: "2px solid #fff",
                            }}
                          >
                            {d.notesCount > 0 ? d.notesCount : ""}
                          </span>
                        )}
                      </span>
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

      {/* Config modal */}
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
              style={{ overflow: "auto", maxHeight: "calc(85vh - 110px)" }}
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
              style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}
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

      {/* Notes modal */}
      {notesForUtr && (
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
          onClick={() => setNotesForUtr(null)}
        >
          <div
            style={{
              width: "min(900px, 100%)",
              maxHeight: "85vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <NotesPanel utr={notesForUtr} />
            <div
              style={{
                marginTop: 10,
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <button
                className="btn btn-default"
                onClick={() => setNotesForUtr(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
