import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";

const functions = getFunctions(app, "us-central1");
const getConfigJson = httpsCallable(functions, "getConfigJson");
const updateConfigJson = httpsCallable(functions, "updateConfigJson");

export async function fetchConfig(path = "config.json") {
  try {
    const res = await getConfigJson({ path });
    return res.data;
  } catch (e) {
    console.error("fetchConfig error:", e);
    // callable errors often have: e.code, e.message, e.details
    throw e;
  }
}


export async function saveConfig(path, json) {
  const res = await updateConfigJson({ path, json });
  return res.data; // { success, path }
}
