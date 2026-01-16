/**
 * functions/index.js (Gen Gen2 / nodejs24) — Refactored
 *
 * ✅ submitDeposit      -> v2 HTTPS (onRequest) using Express + Busboy
 * ✅ getScreenshotUrl   -> v2 Callable (onCall) returning a signed URL
 *
 * IMPORTANT:
 * - Your screenshots are stored in: https://storage.cloud.google.com/betvibe-deposit/...
 * - So we MUST use bucket "betvibe-deposit"
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

// ----------------------
// Config
// ----------------------
const REGION = "us-central1";

// ✅ Your real bucket name (from your link)
const BUCKET_NAME = "betvibe-deposit";

// ✅ NEW: bucket where config.json lives (GCS static hosting bucket)
const CONFIG_BUCKET_NAME = "sydkmy.xyz";
const DEFAULT_CONFIG_PATH = "config.json";

// ----------------------
// Firebase Admin init
// ----------------------
admin.initializeApp(); // ✅ best practice in Gen2

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// ✅ Always use the bucket where screenshots are stored
const bucket = admin.storage().bucket(BUCKET_NAME);

// ✅ NEW: separate bucket for config.json
const configBucket = admin.storage().bucket(CONFIG_BUCKET_NAME);

// ----------------------
// Express app for submitDeposit
// ----------------------
const app = express();

// Needed because you are using busboy with raw body in Cloud Functions
app.use(express.raw({ type: "multipart/form-data" }));

// Allow cross-origin; tighten this later to your domain(s)
app.use(cors({ origin: true }));

/**
 * POST /
 * multipart/form-data fields:
 * - utr (12 digits)
 * - amount, username, email, firstName, lastName
 * - screenshot (image file)
 */
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

    // Only images
    if (!mimeType || !mimeType.startsWith("image/")) {
      file.resume();
      return;
    }

    fileInfo = info;
    const chunks = [];

    file.on("data", (data) => chunks.push(data));
    file.on("end", () => {
      fileBuffer = Buffer.concat(chunks);
    });
  });

  bb.on("finish", async () => {
    try {
      // 1) Validate UTR
      if (!fields.utr || !/^\d{12}$/.test(fields.utr)) {
        return res.status(400).json({ error: "Invalid UTR" });
      }

      // 2) Validate payment method (must come from client: fields.method)
      const paymentMethod = (fields.method || "")
        .toString()
        .trim()
        .toUpperCase();
      const methodIndex = Number(fields.methodIndex);
      const methodLabel = (fields.methodLabel || "").toString().trim();
      if (!["UPI", "BANK"].includes(paymentMethod)) {
        return res.status(400).json({ error: "Invalid payment method" });
      }

      const utr = fields.utr.trim();
      const depositRef = db.collection("deposits").doc(utr);

      // 3) LOCK + create initial doc (PENDING)
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(depositRef);
        if (snap.exists) {
          const err = new Error("DUPLICATE_UTR");
          err.code = "DUPLICATE_UTR";
          throw err;
        }

        tx.set(depositRef, {
          utr,
          status: "PENDING", // ✅ initial status
          paymentMethod, // ✅ store method
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      // 4) Upload screenshot ONLY if provided (optional)
      let screenshotPath = null;

      if (fileBuffer && fileInfo) {
        const safeFilename = (fileInfo.filename || "upload")
          // eslint-disable-next-line
          .replace(/[^\w.\-]/g, "_")
          .slice(0, 120);

        screenshotPath = `screenshots/${Date.now()}-${safeFilename}`;
        const fileRef = bucket.file(screenshotPath);

        await fileRef.save(fileBuffer, {
          resumable: false,
          metadata: { contentType: fileInfo.mimeType },
        });
      }

      // 5) Update remaining fields (keep status PENDING)
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

        screenshotPath, // null if not uploaded
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

      // Cleanup created doc if something failed after transaction
      if (fields?.utr) {
        await db
          .collection("deposits")
          .doc(fields.utr)
          .delete()
          .catch(() => {});
      }

      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Important: use rawBody for busboy in Cloud Functions
  bb.end(req.rawBody);
});

// ----------------------
// Exports (Gen2)
// ----------------------

// ✅ Gen2 HTTPS function
exports.submitDeposit = onRequest({ region: REGION }, app);

// ✅ Gen2 Callable function
exports.getScreenshotUrl = onCall({ region: REGION }, async (request) => {
  // 1) Auth required
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login required");
  }

  // 2) Admin only (custom claim)
  if (!request.auth.token?.admin) {
    throw new HttpsError("permission-denied", "Admins only");
  }

  const { path } = request.data || {};

  if (!path || typeof path !== "string") {
    throw new HttpsError("invalid-argument", "Missing file path");
  }

  // Do not accept URLs/gs://
  if (path.startsWith("http") || path.startsWith("gs://")) {
    throw new HttpsError(
      "invalid-argument",
      "Path must be a bucket-relative file path (e.g. screenshots/abc.png)"
    );
  }

  try {
    const file = bucket.file(path);

    const [exists] = await file.exists();
    if (!exists) {
      throw new HttpsError("not-found", `File not found: ${path}`);
    }

    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 5 * 60 * 1000, // 5 minutes
    });

    return { url };
  } catch (e) {
    logger.error("getScreenshotUrl error:", e);

    if (e instanceof HttpsError) throw e;

    throw new HttpsError(
      "internal",
      e?.message || "Failed to generate signed URL"
    );
  }
});

exports.updateDepositStatus = onCall({ region: REGION }, async (request) => {
  // Auth required
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login required");
  }

  // Admin only
  if (!request.auth.token?.admin) {
    throw new HttpsError("permission-denied", "Admins only");
  }

  const { utr, status } = request.data || {};

  if (!utr || !/^\d{12}$/.test(utr)) {
    throw new HttpsError("invalid-argument", "Invalid UTR");
  }

  const allowed = ["RECEIVED", "NOT_RECEIVED", "REFUNDED"];
  const nextStatus = String(status || "").toUpperCase();

  if (!allowed.includes(nextStatus)) {
    throw new HttpsError("invalid-argument", "Invalid status");
  }

  const ref = db.collection("deposits").doc(utr);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Deposit not found");
  }

  await ref.update({
    status: nextStatus,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, utr, status: nextStatus };
});

// ----------------------
// ✅ NEW: Config.json editor (Admin only)
// ----------------------

function requireAdmin(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required");
  if (!request.auth.token?.admin) {
    throw new HttpsError("permission-denied", "Admins only");
  }
}

function sanitizePath(p) {
  const path = String(p || DEFAULT_CONFIG_PATH).trim();

  // prevent path traversal / weird inputs
  if (
    !path ||
    path.includes("..") ||
    path.startsWith("/") ||
    path.startsWith("gs://") ||
    path.startsWith("http")
  ) {
    throw new HttpsError("invalid-argument", "Invalid config path");
  }

  if (!path.endsWith(".json")) {
    throw new HttpsError("invalid-argument", "Config must be a .json file");
  }

  return path;
}

// ✅ Read config JSON from GCS
exports.getConfigJson = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);

  const path = sanitizePath(request.data?.path);
  const file = configBucket.file(path);

  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpsError("not-found", `Config not found: ${path}`);
  }

  const [buf] = await file.download();
  const text = buf.toString("utf8");

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new HttpsError(
      "failed-precondition",
      "Config file is not valid JSON"
    );
  }

  return { path, json, raw: text };
});

// ✅ Update config JSON in GCS
exports.updateConfigJson = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);

  const path = sanitizePath(request.data?.path);
  const json = request.data?.json;

  if (!json || typeof json !== "object") {
    throw new HttpsError("invalid-argument", "Missing json object");
  }

  const pretty = JSON.stringify(json, null, 2);

  try {
    await configBucket.file(path).save(pretty, {
      resumable: false,
      contentType: "application/json; charset=utf-8",
      metadata: {
        cacheControl: "no-store, max-age=0, must-revalidate",
      },
    });

    return { success: true, path };
  } catch (e) {
    logger.error("updateConfigJson error:", e);
    throw new HttpsError("internal", e?.message || "Failed to write config");
  }
});
// ----------------------
// ✅ NEW: Upload files to sydkmy.xyz (Admin only)
// ----------------------

const SITE_BUCKET_NAME = "sydkmy.xyz"; // ✅ no trailing slash
const siteBucket = admin.storage().bucket(SITE_BUCKET_NAME);

function requireAdmin(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required");
  if (!request.auth.token?.admin) {
    throw new HttpsError("permission-denied", "Admins only");
  }
}

function sanitizeUploadPath(p) {
  const path = String(p || "").trim();

  // prevent traversal / absolute / urls
  if (
    !path ||
    path.includes("..") ||
    path.startsWith("/") ||
    path.startsWith("http") ||
    path.startsWith("gs://")
  ) {
    throw new HttpsError("invalid-argument", "Invalid path");
  }

  return path;
}

// ----------------------
// ✅ NEW: Upload file to site bucket (Admin only)
// ----------------------

function sanitizeUploadPath(p) {
  const path = String(p || "").trim();

  // Root only: no folders allowed
  if (
    !path ||
    path.includes("..") ||
    path.includes("/") ||
    path.startsWith(".")
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Invalid path. Root only, e.g. 'image.png' (no folders)."
    );
  }

  // allow only images
  if (!/\.(png|jpg|jpeg|webp|gif)$/i.test(path)) {
    throw new HttpsError("invalid-argument", "Only image files are allowed.");
  }

  return path;
}

exports.getUploadUrl = onCall({ region: REGION }, async (request) => {
  // Admin only
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required");
  if (!request.auth.token?.admin)
    throw new HttpsError("permission-denied", "Admins only");

  const { path, contentType } = request.data || {};

  const safePath = sanitizeUploadPath(path);
  const ct = String(contentType || "").trim();

  if (!ct || !ct.startsWith("image/")) {
    throw new HttpsError(
      "invalid-argument",
      "Invalid contentType (must be image/*)"
    );
  }

  const file = siteBucket.file(safePath);

  // ✅ Signed URL for PUT upload
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + 5 * 60 * 1000,
    contentType: ct, // IMPORTANT: must match request header exactly
  });

  return { url, path: safePath };
});
