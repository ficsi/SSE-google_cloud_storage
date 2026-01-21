import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { useEffect, useMemo, useState, lazy, Suspense } from "react";

import Admin from "./Admin";
import ProtectedRoute from "./auth/ProtectedRoute";
import Login from "./auth/Login";

import SettlementRequest from "./SettlementRequest";
import SettlementHistory from "./SettlementHistory";

const ConfigEditor = lazy(() => import("./ConfigEditor"));

const NAV = [
  {
    key: "deposits",
    label: "Deposits",
    icon: "D",
    items: [{ label: "Live Deposits", to: "/admin" }],
  },
  {
    key: "settlements",
    label: "Settlements",
    icon: "S",
    items: [
      { label: "Request Settlement", to: "/settlements/request" },
      { label: "Settlement History", to: "/settlements/history" },
    ],
  },
];

export default function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [openKey, setOpenKey] = useState("deposits");
  const [showConfigModal, setShowConfigModal] = useState(false);

  const cols = useMemo(
    () => (collapsed ? "72px 1fr" : "260px 1fr"),
    [collapsed]
  );

  const linkBaseStyle = useMemo(
    () => ({
      display: "block",
      padding: "8px 10px",
      borderRadius: 8,
      textDecoration: "none",
      color: "inherit",
    }),
    []
  );

  function toggleSidebar() {
    setCollapsed((v) => {
      const next = !v;
      if (next) setOpenKey(null);
      if (!next && !openKey) setOpenKey("deposits");
      return next;
    });
  }

  function toggleSection(key) {
    if (collapsed) return;
    setOpenKey((k) => (k === key ? null : key));
  }

  // Prevent scroll when modal is open
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

  return (
    <div style={{ display: "grid", gridTemplateColumns: cols, minHeight: "100vh" }}>
      {/* Sidebar */}
      <aside
        style={{
          borderRight: "1px solid #e6e6e6",
          padding: 12,
          overflow: "hidden",
          background: "#fff",
        }}
      >
        {/* Top */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Toggle menu"
            aria-expanded={!collapsed}
            style={{
              width: 40,
              height: 40,
              border: "1px solid #e6e6e6",
              borderRadius: 10,
              background: "white",
              cursor: "pointer",
            }}
          >
            ☰
          </button>
          {!collapsed && <span style={{ fontWeight: 700 }}>Admin</span>}
        </div>

        {/* Nav */}
        <nav style={{ display: "grid", gap: 6 }}>
          {NAV.map((section) => {
            const isOpen = openKey === section.key;

            return (
              <div key={section.key}>
                <button
                  type="button"
                  onClick={() => toggleSection(section.key)}
                  aria-expanded={isOpen}
                  style={{
                    width: "100%",
                    display: "flex",
                    justifyContent: collapsed ? "center" : "space-between",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 10px",
                    border: "1px solid #e6e6e6",
                    borderRadius: 10,
                    background: "white",
                    cursor: collapsed ? "default" : "pointer",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        display: "grid",
                        placeItems: "center",
                        border: "1px solid #e6e6e6",
                        fontWeight: 800,
                        fontSize: 12,
                      }}
                      title={section.label}
                    >
                      {section.icon || section.label[0]}
                    </span>
                    {!collapsed ? section.label : null}
                  </span>

                  {!collapsed && (
                    <span
                      style={{
                        transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                        transition: "150ms",
                        opacity: 0.75,
                      }}
                    >
                      ▸
                    </span>
                  )}
                </button>

                {!collapsed && isOpen && (
                  <div
                    style={{
                      marginTop: 6,
                      padding: "6px 8px 10px",
                      border: "1px solid #e6e6e6",
                      borderRadius: 10,
                      background: "white",
                    }}
                  >
                    {section.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        style={({ isActive }) => ({
                          ...linkBaseStyle,
                          background: isActive ? "#1f2937" : "transparent",
                          color: isActive ? "#fff" : "#111827",
                          fontWeight: isActive ? 700 : 500,
                        })}
                        onClick={() => {
                          // optional: collapse on small screens
                          if (window.innerWidth < 900) setCollapsed(true);
                        }}
                      >
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Global config button */}
        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ borderRadius: 10, width: "100%" }}
            onClick={() => setShowConfigModal(true)}
          >
            <i className="fas fa-cog" style={{ marginRight: 8 }} />
            {!collapsed ? "Edit Config" : "⚙"}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ padding: 24 }}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Navigate to="/admin" replace />} />

          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <Admin />
              </ProtectedRoute>
            }
          />

          <Route
            path="/settlements/request"
            element={
              <ProtectedRoute>
                <SettlementRequest />
              </ProtectedRoute>
            }
          />

          <Route
            path="/settlements/history"
            element={
              <ProtectedRoute>
                <SettlementHistory />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>

      {/* ✅ Global AdminLTE-style Config modal */}
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
              <Suspense fallback={<div style={{ padding: 12, color: "#6b7280" }}>Loading…</div>}>
                <ConfigEditor />
              </Suspense>
            </div>

            <div className="card-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
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
