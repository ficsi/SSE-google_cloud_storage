import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db, app } from "./firebase";

export default function SettlementHistory() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);

  const functions = useMemo(() => getFunctions(app, "us-central1"), []);
  const decideSettlement = useMemo(() => httpsCallable(functions, "decideSettlement"), [functions]);

  useEffect(() => {
    const q = query(collection(db, "settlements"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  const decide = async (id, decision) => {
    const ok = window.confirm(`${decision === "APPROVE" ? "Approve" : "Decline"} this settlement?`);
    if (!ok) return;

    try {
      await decideSettlement({ id, decision });
    } catch (e) {
      console.error(e);
      alert(e?.message || "Failed");
    }
  };

  const badge = (status) => {
    const s = String(status || "PENDING").toUpperCase();
    if (s === "APPROVED") return "badge bg-success";
    if (s === "DECLINED") return "badge bg-danger";
    return "badge bg-warning";
  };

  return (
    <div style={{ padding: 20 }}>
      <div className="card">
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 className="card-title" style={{ margin: 0 }}>
            <i className="fas fa-history" style={{ marginRight: 8 }} />
            Settlement History
          </h3>

          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-sm btn-success" onClick={() => navigate("/settlements/request")}>
              Request Settlement
            </button>
            <button className="btn btn-sm btn-default" onClick={() => navigate("/admin")}>
              Back to Deposits
            </button>
          </div>
        </div>

        <div className="card-body table-responsive p-0">
          <table className="table table-head-fixed text-nowrap">
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Currency</th>
                <th>Network</th>
                <th>Wallet</th>
                <th>Status</th>
                <th style={{ width: 120, textAlign: "right" }}>Action</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r) => {
                const status = String(r.status || "PENDING").toUpperCase();
                const canDecide = status === "PENDING";

                return (
                  <tr key={r.id}>
                    <td>{r.date || ""}</td>
                    <td>{r.totalAmount ?? ""}</td>
                    <td>{r.currency || "USDT"}</td>
                    <td>{r.network || ""}</td>
                    <td style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis" }}>{r.wallet || ""}</td>
                    <td>
                      <span className={badge(status)}>{status}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {canDecide ? (
                        <div style={{ display: "inline-flex", gap: 8 }}>
                          <button className="btn btn-sm btn-success" title="Approve" onClick={() => decide(r.id, "APPROVE")}>
                            ✓
                          </button>
                          <button className="btn btn-sm btn-danger" title="Decline" onClick={() => decide(r.id, "DECLINE")}>
                            ✕
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: "#6b7280" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 16, color: "#6b7280" }}>
                    No settlements yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
