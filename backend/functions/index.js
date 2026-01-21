/**
 * functions/index.js (Gen2 / nodejs24) — Consolidated
 *
 * ✅ submitDeposit        -> HTTPS onRequest (Express + Busboy)
 * ✅ getScreenshotUrl     -> Callable (admin) signed URL read from betvibe-deposit
 * ✅ updateDepositStatus  -> Callable (admin) + balances sync
 * ✅ getConfigJson        -> Callable (admin) read config.json from sydkmy.xyz
 * ✅ updateConfigJson     -> Callable (admin) write config.json with no-store cache
 * ✅ getUploadUrl         -> Callable (admin) signed PUT to sydkmy.xyz root (images only)
 * ✅ Notes CRUD           -> Callable (admin) deposits/{utr}/notes
 *
 * ✅ NEW: Settlements
 * ✅ requestSettlement    -> Callable (admin) creates settlement doc
 * ✅ decideSettlement     -> Callable (admin) approve/decline settlement
 * ✅ getBalances          -> Callable (admin) read balances/main
 */

const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const busboy = require("busboy");

const {
  onRequest,
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");

const REGION = "us-central1";

// Buckets
const DEPOSIT_BUCKET = "betvibe-deposit";
const CONFIG_BUCKET = "sydkmy.xyz";
const SITE_BUCKET = "sydkmy.xyz";
const DEFAULT_CONFIG_PATH = "config.json";

admin.initializeApp();
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const depositBucket = admin.storage().bucket(DEPOSIT_BUCKET);
const configBucket = admin.storage().bucket(CONFIG_BUCKET);
const siteBucket = admin.storage().bucket(SITE_BUCKET);

// ----------------------
// Helpers
// ----------------------
function requireAdmin(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required");
  if (!request.auth.token?.admin)
    throw new HttpsError("permission-denied", "Admins only");
}

function cleanText(v, max = 2000) {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : "";
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sanitizeConfigPath(p) {
  const path = String(p || DEFAULT_CONFIG_PATH).trim();

  if (
    !path ||
    path.includes("..") ||
    path.startsWith("/") ||
    path.startsWith("gs://") ||
    path.startsWith("http")
  ) {
    throw new HttpsError("invalid-argument", "Invalid config path");
  }
  if (!path.endsWith(".json"))
    throw new HttpsError("invalid-argument", "Config must be a .json file");
  return path;
}

// root-only image upload
function sanitizeUploadPathRootImage(p) {
  const path = String(p || "").trim();

  if (
    !path ||
    path.includes("..") ||
    path.includes("/") ||
    path.startsWith(".")
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Invalid path. Root only (no folders).",
    );
  }
  if (!/\.(png|jpg|jpeg|webp|gif)$/i.test(path)) {
    throw new HttpsError("invalid-argument", "Only image files are allowed.");
  }
  return path;
}

function assertDdMmYy(dateStr) {
  const s = String(dateStr || "").trim();
  if (!/^\d{2}\/\d{2}\/\d{2}$/.test(s)) {
    throw new HttpsError("invalid-argument", "Date must be dd/mm/yy");
  }
  return s;
}

function assertNetwork(net) {
  const n = String(net || "")
    .trim()
    .toUpperCase();
  const allowed = ["TRC-20", "ERC-20"];
  if (!allowed.includes(n))
    throw new HttpsError("invalid-argument", "Invalid network");
  return n;
}

// Balances doc ref
const balancesRef = db.collection("balances").doc("main");

// Ensure balances doc exists
async function ensureBalances() {
  const snap = await balancesRef.get();
  if (snap.exists) return;
  await balancesRef.set(
    {
      upi: 0,
      imps: 0,
      total: 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

// Apply delta to balances atomically
async function applyBalanceDelta(tx, delta) {
  const snap = await tx.get(balancesRef);
  const cur = snap.exists ? snap.data() : { upi: 0, imps: 0, total: 0 };

  const next = {
    upi: toNumber(cur.upi) + toNumber(delta.upi),
    imps: toNumber(cur.imps) + toNumber(delta.imps),
    total: toNumber(cur.total) + toNumber(delta.total),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // prevent negative (guard)
  if (next.upi < 0 || next.imps < 0 || next.total < 0) {
    throw new HttpsError("failed-precondition", "Insufficient balance");
  }

  tx.set(balancesRef, next, { merge: true });
}

// Map payment method to bucket (UPI vs IMPS)
function methodBucket(paymentMethod) {
  const m = String(paymentMethod || "").toUpperCase();
  if (m === "UPI") return "upi";
  if (m === "BANK") return "imps";
  return null;
}

// ----------------------
// submitDeposit (HTTPS)
// ----------------------
const app = express();
app.use(express.raw({ type: "multipart/form-data" }));
app.use(cors({ origin: true }));

app.post("/", (req, res) => {
  const bb = busboy({ headers: req.headers });

  const fields = {};
  let fileBuffer = null;
  let fileInfo = null;

  bb.on("field", (name, value) => {
    fields[name] = value;
  });

  bb.on("file", (name, file, info) => {
    const { mimeType } = info;

    if (!mimeType || !mimeType.startsWith("image/")) {
      file.resume();
      return;
    }

    fileInfo = info;
    const chunks = [];
    file.on("data", (d) => chunks.push(d));
    file.on("end", () => {
      fileBuffer = Buffer.concat(chunks);
    });
  });

  bb.on("finish", async () => {
    try {
      if (!fields.utr || !/^\d{12}$/.test(fields.utr))
        return res.status(400).json({ error: "Invalid UTR" });

      const paymentMethod = String(fields.method || "")
        .trim()
        .toUpperCase();
      const methodIndex = Number(fields.methodIndex);
      const methodLabel = String(fields.methodLabel || "").trim();

      if (!["UPI", "BANK"].includes(paymentMethod)) {
        return res.status(400).json({ error: "Invalid payment method" });
      }

      const utr = fields.utr.trim();
      const depositRef = db.collection("deposits").doc(utr);

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(depositRef);
        if (snap.exists) {
          const err = new Error("DUPLICATE_UTR");
          err.code = "DUPLICATE_UTR";
          throw err;
        }

        tx.set(depositRef, {
          utr,
          status: "PENDING",
          paymentMethod,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      // upload screenshot (optional)
      let screenshotPath = null;
      if (fileBuffer && fileInfo) {
        const safeFilename = (fileInfo.filename || "upload")
          .replace(/[^\w.\-]/g, "_")
          .slice(0, 120);
        screenshotPath = `screenshots/${Date.now()}-${safeFilename}`;
        await depositBucket.file(screenshotPath).save(fileBuffer, {
          resumable: false,
          metadata: { contentType: fileInfo.mimeType },
        });
      }

      const methodData =
        paymentMethod === "UPI"
          ? {
              upiId: fields.upiId || null,
              qrImageUrl: fields.qrImageUrl || null,
            }
          : {
              bankName: fields.bankName || null,
              accountNumber: fields.accountNumber || null,
              ifsc: fields.ifsc || null,
              accountHolder: fields.accountHolder || null,
            };

      await depositRef.update({
        paymentMethod,
        methodIndex: Number.isFinite(methodIndex) ? methodIndex : null,
        methodLabel: methodLabel || null,
        amount: fields.amount ? Number(fields.amount) : null,
        username: fields.username || null,
        email: fields.email || null,
        firstName: fields.firstName || null,
        lastName: fields.lastName || null,
        ...methodData,
        screenshotPath,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ success: true, utr, screenshotPath });
    } catch (err) {
      logger.error("submitDeposit error:", err);

      if (err?.code === "DUPLICATE_UTR" || err?.message === "DUPLICATE_UTR") {
        return res
          .status(409)
          .json({ error: "This UTR has already been submitted" });
      }

      if (fields?.utr)
        await db
          .collection("deposits")
          .doc(fields.utr)
          .delete()
          .catch(() => {});
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  bb.end(req.rawBody);
});

exports.submitDeposit = onRequest({ region: REGION }, app);

// ----------------------
// getScreenshotUrl (Callable)
// ----------------------
exports.getScreenshotUrl = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);

  const { path } = request.data || {};
  if (!path || typeof path !== "string")
    throw new HttpsError("invalid-argument", "Missing file path");
  if (path.startsWith("http") || path.startsWith("gs://")) {
    throw new HttpsError(
      "invalid-argument",
      "Path must be a bucket-relative file path",
    );
  }

  const file = depositBucket.file(path);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError("not-found", `File not found: ${path}`);

  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 5 * 60 * 1000,
  });

  return { url };
});

// ----------------------
// updateDepositStatus (Callable) + balances sync
// ----------------------
exports.updateDepositStatus = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);

  const { utr, status } = request.data || {};
  if (!utr || !/^\d{12}$/.test(utr))
    throw new HttpsError("invalid-argument", "Invalid UTR");

  const allowed = ["RECEIVED", "NOT_RECEIVED", "REFUNDED", "MISMATCH", "TEST"];
  const nextStatus = String(status || "").toUpperCase();
  if (!allowed.includes(nextStatus))
    throw new HttpsError("invalid-argument", "Invalid status");

  await ensureBalances();

  const depositRef = db.collection("deposits").doc(utr);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(depositRef);
    if (!snap.exists) throw new HttpsError("not-found", "Deposit not found");

    const d = snap.data() || {};
    const prevStatus = String(d.status || "PENDING").toUpperCase();
    const amount = toNumber(d.amount);

    const bucketKey = methodBucket(d.paymentMethod); // upi / imps
    const prevCounted = prevStatus === "RECEIVED";
    const nextCounted = nextStatus === "RECEIVED";

    // If moving in/out of RECEIVED, adjust balances
    if (amount > 0 && bucketKey && prevCounted !== nextCounted) {
      const sign = nextCounted ? +1 : -1; // entering RECEIVED => +, leaving RECEIVED => -
      const delta = { upi: 0, imps: 0, total: 0 };
      delta[bucketKey] = sign * amount;
      delta.total = sign * amount;
      await applyBalanceDelta(tx, delta);
    }

    tx.update(depositRef, {
      status: nextStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { success: true, utr, status: nextStatus };
});

// ----------------------
// Config editor (Callable)
// ----------------------
exports.getConfigJson = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);

  const path = sanitizeConfigPath(request.data?.path);
  const file = configBucket.file(path);

  const [exists] = await file.exists();
  if (!exists) throw new HttpsError("not-found", `Config not found: ${path}`);

  const [buf] = await file.download();
  const text = buf.toString("utf8");

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HttpsError(
      "failed-precondition",
      "Config file is not valid JSON",
    );
  }

  return { path, json, raw: text };
});

exports.updateConfigJson = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);

  const path = sanitizeConfigPath(request.data?.path);
  const json = request.data?.json;
  if (!json || typeof json !== "object")
    throw new HttpsError("invalid-argument", "Missing json object");

  const pretty = JSON.stringify(json, null, 2);

  await configBucket.file(path).save(pretty, {
    resumable: false,
    contentType: "application/json; charset=utf-8",
    metadata: { cacheControl: "no-store, max-age=0, must-revalidate" },
  });

  return { success: true, path };
});

// ----------------------
// Upload URL (Callable) root-only image
// ----------------------
exports.getUploadUrl = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);

  const { path, contentType } = request.data || {};
  const safePath = sanitizeUploadPathRootImage(path);

  const ct = String(contentType || "").trim();
  if (!ct || !ct.startsWith("image/")) {
    throw new HttpsError(
      "invalid-argument",
      "Invalid contentType (must be image/*)",
    );
  }

  const file = siteBucket.file(safePath);

  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + 5 * 60 * 1000,
    contentType: ct,
  });

  return { url, path: safePath };
});

// ----------------------
// Notes (Callable)
// ----------------------
exports.addDepositNote = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);

  const utr = String(request.data?.utr || "").trim();
  const text = cleanText(request.data?.text);
  if (!/^\d{12}$/.test(utr))
    throw new HttpsError("invalid-argument", "Invalid UTR");
  if (!text) throw new HttpsError("invalid-argument", "Note text is required");

  const depositRef = db.collection("deposits").doc(utr);
  const snap = await depositRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Deposit not found");

  const noteRef = depositRef.collection("notes").doc();

  await noteRef.set({
    text,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: {
      uid: request.auth.uid,
      email: request.auth.token?.email || null,
    },
  });

  // optional: update counters/preview safely
  await db.runTransaction(async (tx) => {
    const depSnap = await tx.get(depositRef);
    const dep = depSnap.data() || {};
    const nextCount = Math.max(0, toNumber(dep.notesCount) + 1);

    tx.set(
      depositRef,
      {
        notesCount: nextCount,
        lastNoteAt: admin.firestore.FieldValue.serverTimestamp(),
        lastNoteText: text.slice(0, 120),
      },
      { merge: true },
    );
  });

  return { success: true, noteId: noteRef.id };
});

exports.updateDepositNote = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);

  const utr = String(request.data?.utr || "").trim();
  const noteId = String(request.data?.noteId || "").trim();
  const text = cleanText(request.data?.text);

  if (!/^\d{12}$/.test(utr))
    throw new HttpsError("invalid-argument", "Invalid UTR");
  if (!noteId) throw new HttpsError("invalid-argument", "Missing noteId");
  if (!text) throw new HttpsError("invalid-argument", "Note text is required");

  const noteRef = db
    .collection("deposits")
    .doc(utr)
    .collection("notes")
    .doc(noteId);
  const snap = await noteRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Note not found");

  await noteRef.update({
    text,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    editedBy: {
      uid: request.auth.uid,
      email: request.auth.token?.email || null,
    },
  });

  return { success: true };
});

exports.deleteDepositNote = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);

  const utr = String(request.data?.utr || "").trim();
  const noteId = String(request.data?.noteId || "").trim();

  if (!/^\d{12}$/.test(utr)) {
    throw new HttpsError("invalid-argument", "Invalid UTR");
  }
  if (!noteId) {
    throw new HttpsError("invalid-argument", "Missing noteId");
  }

  const depositRef = db.collection("deposits").doc(utr);
  const noteRef = depositRef.collection("notes").doc(noteId);

  try {
    await db.runTransaction(async (tx) => {
      // ✅ READS FIRST
      const [noteSnap, depSnap] = await Promise.all([
        tx.get(noteRef),
        tx.get(depositRef),
      ]);

      if (!noteSnap.exists) {
        throw new Error("NOTE_NOT_FOUND");
      }

      const dep = depSnap.exists ? depSnap.data() : {};
      const nextCount = Math.max(0, toNumber(dep?.notesCount) - 1);

      // ✅ WRITES AFTER ALL READS
      tx.delete(noteRef);
      tx.set(depositRef, { notesCount: nextCount }, { merge: true });
    });

    return { success: true };
  } catch (e) {
    logger.error("deleteDepositNote error:", e);

    if (e?.message === "NOTE_NOT_FOUND") {
      throw new HttpsError("not-found", "Note not found");
    }

    throw new HttpsError("internal", e?.message || "Failed to delete note");
  }
});

// ----------------------
// NEW: Settlements (Callable)
// ----------------------
exports.requestSettlement = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);
  await ensureBalances();

  const impsAmount = toNumber(request.data?.impsAmount);
  const upiAmount = toNumber(request.data?.upiAmount);

  // total is optional; if missing -> auto
  const totalAmountRaw = request.data?.totalAmount;
  const totalAmount =
    totalAmountRaw === null || totalAmountRaw === undefined || totalAmountRaw === ""
      ? impsAmount + upiAmount
      : toNumber(totalAmountRaw);

  if (impsAmount < 0 || upiAmount < 0 || totalAmount <= 0) {
    throw new HttpsError("invalid-argument", "Invalid amounts");
  }

  const date = assertDdMmYy(request.data?.date);
  const wallet = cleanText(request.data?.wallet, 200);
  if (!wallet) {
    throw new HttpsError("invalid-argument", "Crypto Wallet is required");
  }

  const network = assertNetwork(request.data?.network);
  const currency = cleanText(request.data?.currency || "USDT", 12).toUpperCase();
  const description = cleanText(request.data?.description || "", 600);

  // ✅ Read balances BEFORE using them (fixes 'bal' before init)
  const balSnap = await balancesRef.get();
  const bal = balSnap.exists ? balSnap.data() : { upi: 0, imps: 0, total: 0 };

  const curUpi = toNumber(bal.upi);
  const curImps = toNumber(bal.imps);
  const curTotal = toNumber(bal.total);

  if (upiAmount > curUpi) {
    throw new HttpsError("failed-precondition", "UPI amount exceeds available balance");
  }
  if (impsAmount > curImps) {
    throw new HttpsError("failed-precondition", "IMPS amount exceeds available balance");
  }
  if (totalAmount > curTotal) {
    throw new HttpsError("failed-precondition", "Total amount exceeds available balance");
  }

  const ref = db.collection("settlements").doc();

  await ref.set({
    impsAmount,
    upiAmount,
    totalAmount,
    date,
    wallet,
    network,
    currency,
    description: description || null,

    status: "PENDING",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: {
      uid: request.auth.uid,
      email: request.auth.token?.email || null,
    },

    decidedAt: null,
    decidedBy: null,
  });

  return { success: true, id: ref.id };
});


exports.decideSettlement = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);
  await ensureBalances();

  const id = String(request.data?.id || "").trim();
  const decision = String(request.data?.decision || "")
    .trim()
    .toUpperCase(); // APPROVE / DECLINE

  if (!id) throw new HttpsError("invalid-argument", "Missing settlement id");
  if (!["APPROVE", "DECLINE"].includes(decision))
    throw new HttpsError("invalid-argument", "Invalid decision");

  const ref = db.collection("settlements").doc(id);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Settlement not found");

    const s = snap.data() || {};
    const status = String(s.status || "PENDING").toUpperCase();
    if (status !== "PENDING")
      throw new HttpsError("failed-precondition", "Already decided");

    const upi = toNumber(s.upiAmount);
    const imps = toNumber(s.impsAmount);
    const total = toNumber(s.totalAmount);

    if (decision === "APPROVE") {
      // Deduct balances
      await applyBalanceDelta(tx, { upi: -upi, imps: -imps, total: -total });

      tx.update(ref, {
        status: "APPROVED",
        decidedAt: admin.firestore.FieldValue.serverTimestamp(),
        decidedBy: {
          uid: request.auth.uid,
          email: request.auth.token?.email || null,
        },
      });
    } else {
      tx.update(ref, {
        status: "DECLINED",
        decidedAt: admin.firestore.FieldValue.serverTimestamp(),
        decidedBy: {
          uid: request.auth.uid,
          email: request.auth.token?.email || null,
        },
      });
    }
  });

  return { success: true };
});

exports.getBalances = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);
  await ensureBalances();
  const snap = await balancesRef.get();
  return { balances: snap.data() || { upi: 0, imps: 0, total: 0 } };
});

