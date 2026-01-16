const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const Busboy = require("busboy");

const app = express();
app.use(cors({ origin: true }));

// Lazy init variables
let admin, db, Storage, storage, bucket;

app.post("/", (req, res) => {
  try {
    // Initialize only once
    if (!admin) {
      admin = require("firebase-admin");
      admin.initializeApp();
      db = admin.firestore();

      Storage = require("@google-cloud/storage").Storage;
      storage = new Storage();
      bucket = storage.bucket("betvibe-deposit"); // your bucket
    }

    const busboy = new Busboy({ headers: req.headers });
    const fields = {};
    let fileUpload = null;

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (name, file, info) => {
      const { filename, mimeType } = info;
      if (!mimeType.startsWith("image/")) {
        file.resume();
        return;
      }
      const filepath = `screenshots/${Date.now()}-${filename}`;
      fileUpload = bucket.file(filepath);
      file.pipe(fileUpload.createWriteStream());
    });

    busboy.on("finish", async () => {
      if (!fields.utr || !/^\d{12}$/.test(fields.utr))
        return res.status(400).json({ error: "Invalid UTR" });
      if (!fileUpload)
        return res.status(400).json({ error: "Screenshot required" });

      await db.collection("deposits").add({
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        amount: fields.amount || null,
        utr: fields.utr,
        username: fields.username,
        email: fields.email,
        firstName: fields.firstName,
        lastName: fields.lastName,
        screenshotPath: fileUpload.name,
      });

      return res.json({ success: true });
    });

 req.pipe(busboy);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

exports.submitDeposit = functions.https.onRequest(app);
