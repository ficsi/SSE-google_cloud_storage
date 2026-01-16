import { getFunctions, httpsCallable } from "firebase/functions";
import { getAuth } from "firebase/auth";
import { app } from "./firebase";

const auth = getAuth(app);              // ✅ ensure Auth is initialized
const functions = getFunctions(app, "us-central1"); // ✅ be explicit
const getScreenshotUrl = httpsCallable(functions, "getScreenshotUrl");

export async function fetchScreenshotUrl(path) {
  if (!auth.currentUser) throw new Error("Not logged in");
  await auth.currentUser.getIdToken(true); // refresh

  const res = await getScreenshotUrl({ path });
  return res.data.url;
}
