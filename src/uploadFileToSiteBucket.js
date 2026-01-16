import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";

const functions = getFunctions(app, "us-central1");
const getUploadUrl = httpsCallable(functions, "getUploadUrl");

export async function uploadQrToRoot(file) {
  // 1) pick a root filename (unique)
  const safeName = file.name.replace(/[^\w.\-]/g, "_");
  const rootPath = `${Date.now()}-${safeName}`; // e.g. 1768...-image.png

  // 2) ask backend for signed url
  const res = await getUploadUrl({
    path: rootPath,        // ✅ root only
    contentType: file.type // ✅ must match PUT header
  });

  const { url, path } = res.data;

  // 3) PUT upload
  const put = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": file.type
    },
    body: file
  });

  if (!put.ok) {
    const text = await put.text().catch(() => "");
    throw new Error(`Upload failed (${put.status}): ${text || put.statusText}`);
  }

  // 4) return public URL (good for config.json)
  // If bucket is public-hosted behind your domain, you can also use: `/${path}`
  return {
    path,
    publicUrl: `https://storage.googleapis.com/sydkmy.xyz/${path}`
  };
}
