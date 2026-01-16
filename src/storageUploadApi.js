import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";

const functions = getFunctions(app, "us-central1");
const getUploadUrl = httpsCallable(functions, "getUploadUrl");

/**
 * Upload an image to the ROOT of bucket sydkmy.xyz using a signed PUT URL.
 * Returns { path, publicUrl }.
 */
export async function uploadFileToSiteBucketRoot(file, opts = {}) {
  if (!file) throw new Error("No file selected");

  const contentType = file.type || "application/octet-stream";
  if (!contentType.startsWith("image/")) {
    throw new Error("Only image files are allowed");
  }

  // ROOT filename only (no folders)
  const safeName = String(file.name || "image.png")
    .replace(/[^\w.\-]/g, "_")
    .replace(/^_+/, "")
    .slice(0, 120);

  const filename = opts.filename || `${Date.now()}-${safeName}`; // unique => no cache problems

  // 1) Get signed URL from backend
  const res = await getUploadUrl({
    path: filename, // root only
    contentType,    // MUST match PUT header
  });

  const { url, path } = res.data;

  // 2) PUT upload
  const put = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
    },
    body: file,
  });

  if (!put.ok) {
    const text = await put.text().catch(() => "");
    throw new Error(`Upload failed (${put.status}): ${text || put.statusText}`);
  }

  // 3) Public URL you can store in config.json
  const publicUrl = `https://storage.googleapis.com/sydkmy.xyz/${path}`;

  return { path, publicUrl };
}
