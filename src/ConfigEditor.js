// ConfigEditor.js
// AdminLTE-styled config editor for:
// ✅ branding.bank.title / branding.upi.title
// ✅ upiOptions[] (dynamic tabs, add/remove, upload QR to BUCKET ROOT)
// ✅ bankOptions[] (dynamic tabs, add/remove)
//
// Requires Firebase auth user to have custom claim: admin=true
// Backend callables expected (Gen2):
// - getConfigJson({ path })
// - updateConfigJson({ path, json })
// - getUploadUrl({ path, contentType })  -> returns { url, path }
//
// Bucket note:
// Uploads go to BUCKET ROOT by default (example: "image_1.png") so your iframe pages can use "./image_1.png"

import React, { useEffect, useMemo, useState } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";

const REGION = "us-central1";
const DEFAULT_CONFIG_PATH = "config.json";

// If you want to prefix file names in root (still root, just a naming convention)
const ROOT_NAME_PREFIX = ""; // e.g. "qr-" (leave "" for pure root names)

function safeStr(v) {
  return String(v ?? "");
}

function ensureObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function normalizeConfig(rawCfg) {
  const cfg = ensureObject(rawCfg);

  const branding = ensureObject(cfg.branding);
  const brandingBank = ensureObject(branding.bank);
  const brandingUpi = ensureObject(branding.upi);

  // UPI
  const upiOptions = Array.isArray(cfg.upiOptions) ? cfg.upiOptions : [];

  // BANK: support both old "bank" (single object) and new "bankOptions" array
  let bankOptions = [];
  if (Array.isArray(cfg.bankOptions)) {
    bankOptions = cfg.bankOptions;
  } else if (cfg.bank && typeof cfg.bank === "object") {
    bankOptions = [
      {
        label: "Bank 1",
        bankName: cfg.bank.bankName || "",
        accountNumber: cfg.bank.accountNumber || "",
        ifsc: cfg.bank.ifsc || "",
        accountHolder: cfg.bank.accountHolder || "",
      },
    ];
  }

  return {
    ...cfg,
    branding: {
      ...branding,
      bank: {
        ...brandingBank,
        title: safeStr(brandingBank.title || ""),
      },
      upi: {
        ...brandingUpi,
        title: safeStr(brandingUpi.title || ""),
      },
    },
    upiOptions: upiOptions.map((u, i) => ({
      label: safeStr(u?.label || `UPI ${i + 1}`),
      upiId: safeStr(u?.upiId || ""),
      qrImageUrl: safeStr(u?.qrImageUrl || ""),
    })),
    bankOptions: bankOptions.map((b, i) => ({
      label: safeStr(b?.label || `Bank ${i + 1}`),
      bankName: safeStr(b?.bankName || ""),
      accountNumber: safeStr(b?.accountNumber || ""),
      ifsc: safeStr(b?.ifsc || ""),
      accountHolder: safeStr(b?.accountHolder || ""),
    })),
  };
}

function makeEmptyUpi(i) {
  return {
    label: `UPI ${i}`,
    upiId: "",
    qrImageUrl: "",
  };
}

function makeEmptyBank(i) {
  return {
    label: `Bank ${i}`,
    bankName: "",
    accountNumber: "",
    ifsc: "",
    accountHolder: "",
  };
}

function prettyJson(obj) {
  return JSON.stringify(obj, null, 2);
}

// Root-friendly name (no folders)
function rootFileName(originalName) {
  const clean = safeStr(originalName || "image.png")
    .replace(/[^\w.\-]/g, "_")
    .slice(0, 120);

  // add timestamp to avoid collisions
  return `${ROOT_NAME_PREFIX}${Date.now()}-${clean}`;
}

// Ensure QR url is relative to current bucket root
function toRootRelative(pathOrUrl) {
  if (!pathOrUrl) return "";
  // If user puts full URL, keep it.
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  // If they put "/file.png" normalize to "./file.png"
  const p = safeStr(pathOrUrl).replace(/^\/+/, "");
  if (p.startsWith("./")) return p;
  return `./${p}`;
}

export default function ConfigEditor() {
  const functions = useMemo(() => getFunctions(app, REGION), []);
  const getConfigJson = useMemo(
    () => httpsCallable(functions, "getConfigJson"),
    [functions]
  );
  const updateConfigJson = useMemo(
    () => httpsCallable(functions, "updateConfigJson"),
    [functions]
  );
  const getUploadUrl = useMemo(
    () => httpsCallable(functions, "getUploadUrl"),
    [functions]
  );

  const [path, setPath] = useState(DEFAULT_CONFIG_PATH);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [cfg, setCfg] = useState(null);
  const [raw, setRaw] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  const [activeUpi, setActiveUpi] = useState(0);
  const [activeBank, setActiveBank] = useState(0);

  const upiCount = cfg?.upiOptions?.length || 0;
  const bankCount = cfg?.bankOptions?.length || 0;

  // Load
  const load = async () => {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const res = await getConfigJson({ path });
      const data = res?.data || {};
      const normalized = normalizeConfig(data.json);

      setCfg(normalized);
      setRaw(data.raw || prettyJson(normalized));

      // reset active tabs safely
      setActiveUpi(0);
      setActiveBank(0);
    } catch (e) {
      console.error(e);
      setError(e?.message || "Failed to load config");
      setCfg(null);
      setRaw("");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Small UX: auto-hide success
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(""), 1800);
    return () => clearTimeout(t);
  }, [success]);

  const setField = (pathStr, value) => {
    setCfg((prev) => {
      const next = { ...(prev || {}) };
      // path like "branding.upi.title"
      const parts = pathStr.split(".");
      let cur = next;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        cur[k] = ensureObject(cur[k]);
        cur = cur[k];
      }
      cur[parts[parts.length - 1]] = value;
      return next;
    });
  };

  const setUpiField = (idx, key, value) => {
    setCfg((prev) => {
      const next = { ...(prev || {}) };
      const arr = Array.isArray(next.upiOptions) ? [...next.upiOptions] : [];
      const item = ensureObject(arr[idx]);
      arr[idx] = { ...item, [key]: value };
      next.upiOptions = arr;
      return next;
    });
  };

  const setBankField = (idx, key, value) => {
    setCfg((prev) => {
      const next = { ...(prev || {}) };
      const arr = Array.isArray(next.bankOptions) ? [...next.bankOptions] : [];
      const item = ensureObject(arr[idx]);
      arr[idx] = { ...item, [key]: value };
      next.bankOptions = arr;
      return next;
    });
  };

  const addUpi = () => {
    setCfg((prev) => {
      const next = { ...(prev || {}) };
      const arr = Array.isArray(next.upiOptions) ? [...next.upiOptions] : [];
      arr.push(makeEmptyUpi(arr.length + 1));
      next.upiOptions = arr;
      return next;
    });
    setActiveUpi((v) => (Number.isFinite(v) ? v : 0) + 1);
  };

  const removeUpi = (idx) => {
    setCfg((prev) => {
      const next = { ...(prev || {}) };
      const arr = Array.isArray(next.upiOptions) ? [...next.upiOptions] : [];
      if (arr.length <= 1) return next; // keep at least 1
      arr.splice(idx, 1);
      // re-label defaults nicely (optional)
      next.upiOptions = arr.map((u, i) => ({
        label: safeStr(u?.label || `UPI ${i + 1}`),
        upiId: safeStr(u?.upiId || ""),
        qrImageUrl: safeStr(u?.qrImageUrl || ""),
      }));
      return next;
    });
    setActiveUpi((v) => Math.max(0, Math.min(idx - 1, upiCount - 2)));
  };

  const addBank = () => {
    setCfg((prev) => {
      const next = { ...(prev || {}) };
      const arr = Array.isArray(next.bankOptions) ? [...next.bankOptions] : [];
      arr.push(makeEmptyBank(arr.length + 1));
      next.bankOptions = arr;
      return next;
    });
    setActiveBank((v) => (Number.isFinite(v) ? v : 0) + 1);
  };

  const removeBank = (idx) => {
    setCfg((prev) => {
      const next = { ...(prev || {}) };
      const arr = Array.isArray(next.bankOptions) ? [...next.bankOptions] : [];
      if (arr.length <= 1) return next; // keep at least 1
      arr.splice(idx, 1);
      next.bankOptions = arr.map((b, i) => ({
        label: safeStr(b?.label || `Bank ${i + 1}`),
        bankName: safeStr(b?.bankName || ""),
        accountNumber: safeStr(b?.accountNumber || ""),
        ifsc: safeStr(b?.ifsc || ""),
        accountHolder: safeStr(b?.accountHolder || ""),
      }));
      return next;
    });
    setActiveBank((v) => Math.max(0, Math.min(idx - 1, bankCount - 2)));
  };

  const save = async () => {
    if (!cfg) return;
    setError("");
    setSuccess("");
    setSaving(true);

    try {
      // Keep it clean: store bankOptions/up iOptions; optionally remove legacy "bank"
      const toSave = {
        ...cfg,
        upiOptions: (cfg.upiOptions || []).map((u, i) => ({
          label: safeStr(u?.label || `UPI ${i + 1}`),
          upiId: safeStr(u?.upiId || ""),
          qrImageUrl: safeStr(u?.qrImageUrl || ""),
        })),
        bankOptions: (cfg.bankOptions || []).map((b, i) => ({
          label: safeStr(b?.label || `Bank ${i + 1}`),
          bankName: safeStr(b?.bankName || ""),
          accountNumber: safeStr(b?.accountNumber || ""),
          ifsc: safeStr(b?.ifsc || ""),
          accountHolder: safeStr(b?.accountHolder || ""),
        })),
      };

      // optional: remove legacy single bank if present
      delete toSave.bank;

      await updateConfigJson({ path, json: toSave });
      setRaw(prettyJson(toSave));
      setSuccess("Saved ✅");
    } catch (e) {
      console.error(e);
      setError(e?.message || "Failed to save config");
    } finally {
      setSaving(false);
    }
  };

  // Upload image to BUCKET ROOT and update active UPI qrImageUrl
  const uploadQrForActiveUpi = async (file) => {
    if (!file || !cfg) return;
    setError("");
    setSuccess("");
    setUploading(true);

    try {
      const filename = rootFileName(file.name); // root path: "timestamp-name.png"
      const contentType = file.type || "application/octet-stream";

      const signed = await getUploadUrl({ path: filename, contentType });
      const { url, path: storedPath } = signed?.data || {};

      if (!url || !storedPath) {
        throw new Error("Missing signed upload URL");
      }

      // IMPORTANT: Use PUT for GCS signed URL
      const resp = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
        },
        body: file,
      });

      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        throw new Error(`Upload failed (${resp.status}) ${txt}`.trim());
      }

      // Update current UPI option with a root-relative path for your static pages
      const rel = toRootRelative(storedPath); // "./filename.png"
      setUpiField(activeUpi, "qrImageUrl", rel);

      setSuccess("Uploaded ✅ (QR updated)");
    } catch (e) {
      console.error(e);
      setError(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const activeUpiObj =
    cfg?.upiOptions && cfg.upiOptions[activeUpi]
      ? cfg.upiOptions[activeUpi]
      : null;

  const activeBankObj =
    cfg?.bankOptions && cfg.bankOptions[activeBank]
      ? cfg.bankOptions[activeBank]
      : null;

  return (
    <div>
      {/* Top controls */}
      <div
        className="callout callout-info"
        style={{
          borderRadius: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>
              Config path
            </label>
            <input
              className="form-control"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="config.json"
              style={{ borderRadius: 10 }}
            />
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
              Default: <b>config.json</b> (in your static hosting bucket)
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <button
              type="button"
              className="btn btn-outline-primary"
              style={{ borderRadius: 10 }}
              onClick={load}
              disabled={loading || saving || uploading}
            >
              {loading ? "Loading..." : "Reload"}
            </button>

            <button
              type="button"
              className="btn btn-primary"
              style={{ borderRadius: 10 }}
              onClick={save}
              disabled={!cfg || loading || saving || uploading}
            >
              {saving ? "Saving..." : "Save"}
            </button>

            <button
              type="button"
              className="btn btn-outline-secondary"
              style={{ borderRadius: 10 }}
              onClick={() => setShowRaw((v) => !v)}
              disabled={!cfg}
            >
              {showRaw ? "Hide JSON" : "Show JSON"}
            </button>
          </div>
        </div>

        {error ? (
          <div
            className="alert alert-danger"
            style={{ marginTop: 12, borderRadius: 12 }}
          >
            {error}
          </div>
        ) : null}

        {success ? (
          <div
            className="alert alert-success"
            style={{ marginTop: 12, borderRadius: 12 }}
          >
            {success}
          </div>
        ) : null}
      </div>

      {!cfg ? (
        <div style={{ padding: 12, color: "#6b7280" }}>
          {loading ? "Loading config..." : "No config loaded."}
        </div>
      ) : (
        <>
          {/* Branding */}
          <div className="card" style={{ borderRadius: 12 }}>
            <div className="card-header">
              <h3 className="card-title" style={{ margin: 0 }}>
                <i className="fas fa-paint-brush" style={{ marginRight: 8 }} />
                Branding
              </h3>
            </div>

            <div className="card-body">
              <div className="row">
                <div className="col-md-6" style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 700 }}>
                    UPI title
                  </label>
                  <textarea
                    className="form-control"
                    rows={3}
                    value={safeStr(cfg.branding?.upi?.title || "")}
                    onChange={(e) =>
                      setField("branding.upi.title", e.target.value)
                    }
                    style={{ borderRadius: 10 }}
                  />
                </div>

                <div className="col-md-6" style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 700 }}>
                    Bank title (HTML allowed)
                  </label>
                  <textarea
                    className="form-control"
                    rows={3}
                    value={safeStr(cfg.branding?.bank?.title || "")}
                    onChange={(e) =>
                      setField("branding.bank.title", e.target.value)
                    }
                    style={{ borderRadius: 10 }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* UPI Options */}
          <div className="card" style={{ borderRadius: 12 }}>
            <div className="card-header">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <h3 className="card-title" style={{ margin: 0 }}>
                  <i className="fas fa-qrcode" style={{ marginRight: 8 }} />
                  UPI Options
                </h3>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary"
                    style={{ borderRadius: 10 }}
                    onClick={addUpi}
                    disabled={saving || uploading}
                  >
                    + Add UPI
                  </button>

                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger"
                    style={{ borderRadius: 10 }}
                    onClick={() => removeUpi(activeUpi)}
                    disabled={(cfg.upiOptions?.length || 0) <= 1 || saving}
                    title={
                      (cfg.upiOptions?.length || 0) <= 1
                        ? "Keep at least one UPI"
                        : "Remove active UPI"
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>

            <div className="card-body">
              {/* Tabs */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  marginBottom: 12,
                }}
              >
                {(cfg.upiOptions || []).map((u, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`btn btn-sm ${
                      idx === activeUpi ? "btn-primary" : "btn-outline-primary"
                    }`}
                    style={{ borderRadius: 999 }}
                    onClick={() => setActiveUpi(idx)}
                  >
                    {u.label || `UPI ${idx + 1}`}
                  </button>
                ))}
              </div>

              {!activeUpiObj ? (
                <div style={{ color: "#6b7280" }}>No UPI option selected.</div>
              ) : (
                <div className="row">
                  <div className="col-md-4" style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 700 }}>
                      Label
                    </label>
                    <input
                      className="form-control"
                      style={{ borderRadius: 10 }}
                      value={safeStr(activeUpiObj.label)}
                      onChange={(e) =>
                        setUpiField(activeUpi, "label", e.target.value)
                      }
                    />
                  </div>

                  <div className="col-md-4" style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 700 }}>
                      UPI ID
                    </label>
                    <input
                      className="form-control"
                      style={{ borderRadius: 10 }}
                      value={safeStr(activeUpiObj.upiId)}
                      onChange={(e) =>
                        setUpiField(activeUpi, "upiId", e.target.value)
                      }
                      placeholder="example@upi"
                    />
                  </div>

                  <div className="col-md-4" style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 700 }}>
                      QR Image URL (served)
                    </label>
                    <input
                      className="form-control"
                      style={{ borderRadius: 10 }}
                      value={safeStr(activeUpiObj.qrImageUrl)}
                      onChange={(e) =>
                        setUpiField(
                          activeUpi,
                          "qrImageUrl",
                          toRootRelative(e.target.value)
                        )
                      }
                      placeholder="./image.png"
                    />
                    <div
                      style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}
                    >
                      Tip: root file should be like <b>./image.png</b>
                    </div>
                  </div>

                  <div className="col-12">
                    <div
                      className="callout callout-warning"
                      style={{ borderRadius: 12 }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 800, marginBottom: 4 }}>
                            Upload QR image to bucket root
                          </div>
                          <div style={{ fontSize: 12, color: "#6b7280" }}>
                            Upload updates <b>qrImageUrl</b> automatically.
                          </div>
                        </div>

                        <label
                          className="btn btn-sm btn-primary"
                          style={{ borderRadius: 10, margin: 0 }}
                        >
                          {uploading ? "Uploading..." : "Upload QR"}
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            disabled={uploading || saving}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) uploadQrForActiveUpi(f);
                            }}
                          />
                        </label>
                      </div>

                      {activeUpiObj.qrImageUrl ? (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 12, color: "#6b7280" }}>
                            Preview:
                          </div>
                          <div style={{ marginTop: 8 }}>
                            <img
                              src={activeUpiObj.qrImageUrl}
                              alt="QR preview"
                              style={{
                                maxWidth: 220,
                                borderRadius: 12,
                                border: "1px solid rgba(0,0,0,.12)",
                              }}
                              onError={(ev) => {
                                // If relative path can't be previewed in admin origin, don't break UI
                                ev.currentTarget.style.display = "none";
                              }}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bank Options */}
          <div className="card" style={{ borderRadius: 12 }}>
            <div className="card-header">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <h3 className="card-title" style={{ margin: 0 }}>
                  <i className="fas fa-university" style={{ marginRight: 8 }} />
                  Bank Options
                </h3>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary"
                    style={{ borderRadius: 10 }}
                    onClick={addBank}
                    disabled={saving || uploading}
                  >
                    + Add Bank
                  </button>

                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger"
                    style={{ borderRadius: 10 }}
                    onClick={() => removeBank(activeBank)}
                    disabled={(cfg.bankOptions?.length || 0) <= 1 || saving}
                    title={
                      (cfg.bankOptions?.length || 0) <= 1
                        ? "Keep at least one bank"
                        : "Remove active bank"
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>

            <div className="card-body">
              {/* Tabs */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  marginBottom: 12,
                }}
              >
                {(cfg.bankOptions || []).map((b, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`btn btn-sm ${
                      idx === activeBank ? "btn-primary" : "btn-outline-primary"
                    }`}
                    style={{ borderRadius: 999 }}
                    onClick={() => setActiveBank(idx)}
                  >
                    {b.label || `Bank ${idx + 1}`}
                  </button>
                ))}
              </div>

              {!activeBankObj ? (
                <div style={{ color: "#6b7280" }}>No bank option selected.</div>
              ) : (
                <div className="row">
                  <div className="col-md-4" style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 700 }}>
                      Label
                    </label>
                    <input
                      className="form-control"
                      style={{ borderRadius: 10 }}
                      value={safeStr(activeBankObj.label)}
                      onChange={(e) =>
                        setBankField(activeBank, "label", e.target.value)
                      }
                    />
                  </div>

                  <div className="col-md-4" style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 700 }}>
                      Bank Name
                    </label>
                    <input
                      className="form-control"
                      style={{ borderRadius: 10 }}
                      value={safeStr(activeBankObj.bankName)}
                      onChange={(e) =>
                        setBankField(activeBank, "bankName", e.target.value)
                      }
                    />
                  </div>

                  <div className="col-md-4" style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 700 }}>
                      Account Number
                    </label>
                    <input
                      className="form-control"
                      style={{ borderRadius: 10 }}
                      value={safeStr(activeBankObj.accountNumber)}
                      onChange={(e) =>
                        setBankField(
                          activeBank,
                          "accountNumber",
                          e.target.value
                        )
                      }
                    />
                  </div>

                  <div className="col-md-6" style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 700 }}>
                      IFSC
                    </label>
                    <input
                      className="form-control"
                      style={{ borderRadius: 10 }}
                      value={safeStr(activeBankObj.ifsc)}
                      onChange={(e) =>
                        setBankField(activeBank, "ifsc", e.target.value)
                      }
                    />
                  </div>

                  <div className="col-md-6" style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 700 }}>
                      Account Holder
                    </label>
                    <input
                      className="form-control"
                      style={{ borderRadius: 10 }}
                      value={safeStr(activeBankObj.accountHolder)}
                      onChange={(e) =>
                        setBankField(
                          activeBank,
                          "accountHolder",
                          e.target.value
                        )
                      }
                    />
                  </div>

                  <div className="col-12">
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      Adding another bank object here will automatically create
                      a new <b>bank tab</b> in your hosted{" "}
                      <code>_bank.html</code> (as long as that page reads{" "}
                      <code>bankOptions</code>).
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Raw JSON */}
          {showRaw ? (
            <div className="card" style={{ borderRadius: 12 }}>
              <div className="card-header">
                <h3 className="card-title" style={{ margin: 0 }}>
                  <i className="fas fa-code" style={{ marginRight: 8 }} />
                  Raw JSON (read-only preview)
                </h3>
              </div>
              <div className="card-body">
                <pre
                  style={{
                    margin: 0,
                    padding: 12,
                    background: "#0b1020",
                    color: "#e5e7eb",
                    borderRadius: 12,
                    overflow: "auto",
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  {raw || prettyJson(cfg)}
                </pre>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

