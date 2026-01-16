import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export async function fetchDeposits({ pageSize = 20, cursor = null } = {}) {
  const q = query(
    collection(db, "deposits"),
    orderBy("submittedAt", "desc"),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(pageSize)
  );

  const snap = await getDocs(q);

  return {
    data: snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    })),
    cursor: snap.docs[snap.docs.length - 1] || null,
  };
}
