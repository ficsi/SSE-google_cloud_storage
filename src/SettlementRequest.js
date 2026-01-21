import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";

export default function SettlementRequest() {
  const navigate = useNavigate();

  const functions = useMemo(() => getFunctions(app, "us-central1"), []);
  const requestSettlement = useMemo(
    () => httpsCallable(functions, "requestSettlement"),
    [functions]
  );

  const [impsAmount, setImpsAmount] = useState("");
  const [upiAmount, setUpiAmount] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [date, setDate] = useState(""); // dd/mm/yy
  const [wallet, setWallet] = useState("");
  const [network, setNetwork] = useState("TRC-20");
  const [currency, setCurrency] = useState("USDT");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const ddmmyyOk = (v) => /^\d{2}\/\d{2}\/\d{2}$/.test(String(v || "").trim());

  const onSubmit = async () => {
    const imps = Number(impsAmount || 0);
    const upi = Number(upiAmount || 0);
    const total = Number(totalAmount || 0) || imps + upi;

    if (!Number.isFinite(imps) || imps < 0) return alert("Invalid IMPS Amount");
    if (!Number.isFinite(upi) || upi < 0) return alert("Invalid UPI Amount");
    if (!Number.isFinite(total) || total <= 0) return alert("Invalid Total Amount");
    if (!ddmmyyOk(date)) return alert("Date must be dd/mm/yy");
    if (!wallet.trim()) return alert("Crypto Wallet is required");

    setBusy(true);
    try {
      await requestSettlement({
        impsAmount: imps,
        upiAmount: upi,
        totalAmount: total,
        date: date.trim(),
        wallet: wallet.trim(),
        network,
        currency: (currency || "USDT").trim().toUpperCase(),
        description: description.trim(),
      });

      alert("Settlement requested ✅");
      navigate("/settlements/history");
    } catch (e) {
      console.error(e);
      alert(e?.message || "Failed to request settlement");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <div className="card">
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between" }}>
          <h3 className="card-title" style={{ margin: 0 }}>
            <i className="fas fa-paper-plane" style={{ marginRight: 8 }} />
            Request Settlement
          </h3>

          <button className="btn btn-sm btn-default" onClick={() => navigate("/admin")}>
            Back to Deposits
          </button>
        </div>

        <div className="card-body" style={{ display: "grid", gap: 12, maxWidth: 720 }}>
          <div className="row">
            <div className="col-md-4">
              <label>IMPS Amount</label>
              <input className="form-control" type="number" value={impsAmount} onChange={(e) => setImpsAmount(e.target.value)} />
            </div>
            <div className="col-md-4">
              <label>UPI Amount</label>
              <input className="form-control" type="number" value={upiAmount} onChange={(e) => setUpiAmount(e.target.value)} />
            </div>
            <div className="col-md-4">
              <label>Total Amount</label>
              <input
                className="form-control"
                type="number"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                placeholder="Optional (auto = IMPS + UPI)"
              />
            </div>
          </div>

          <div className="row">
            <div className="col-md-4">
              <label>Date (dd/mm/yy)</label>
              <input
                className="form-control"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                placeholder="20/01/26"
              />
              <small style={{ color: "#6b7280" }}>Format: dd/mm/yy</small>
            </div>

            <div className="col-md-4">
              <label>Currency</label>
              <input className="form-control" value={currency} onChange={(e) => setCurrency(e.target.value)} />
            </div>

            <div className="col-md-4">
              <label>Network Type</label>
              <select className="form-control" value={network} onChange={(e) => setNetwork(e.target.value)}>
                <option value="TRC-20">TRC-20</option>
                <option value="ERC-20">ERC-20</option>
              </select>
            </div>
          </div>

          <div>
            <label>Crypto Wallet</label>
            <input className="form-control" value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="Wallet address…" />
          </div>

          <div>
            <label>Description (optional)</label>
            <textarea className="form-control" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <div className="card-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="btn btn-default" onClick={() => navigate("/admin")} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-success" onClick={onSubmit} disabled={busy}>
            {busy ? "Submitting..." : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
}
