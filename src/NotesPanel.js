import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db, app } from "./firebase";

export default function NotesPanel({ utr }) {
  const [notes, setNotes] = useState([]);
  const [newText, setNewText] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [error, setError] = useState("");

  const functions = useMemo(() => getFunctions(app, "us-central1"), []);
  const addDepositNote = useMemo(() => httpsCallable(functions, "addDepositNote"), [functions]);
  const updateDepositNote = useMemo(() => httpsCallable(functions, "updateDepositNote"), [functions]);
  const deleteDepositNote = useMemo(() => httpsCallable(functions, "deleteDepositNote"), [functions]);

  

  useEffect(() => {
    if (!utr) return;

    setError("");
    setNotes([]);

    const q = query(collection(db, "deposits", utr, "notes"), orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        setError("");
        setNotes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.error("Notes onSnapshot error:", err);
        if (String(err?.code) === "permission-denied") {
          setError("Permission denied for notes. Update Firestore rules to allow /deposits/{utr}/notes/* for admins.");
        } else {
          setError(err?.message || "Failed to load notes.");
        }
      }
    );

    return () => unsub();
  }, [utr]);

  const submitNew = async () => {
    const text = newText.trim();
    if (!text) return;

    try {
      await addDepositNote({ utr, text });
      setNewText("");
    } catch (e) {
      console.error(e);
      alert(e?.message || "Failed to add note");
    }
  };

  const submitEdit = async () => {
    const text = editingText.trim();
    if (!text || !editingId) return;

    try {
      await updateDepositNote({ utr, noteId: editingId, text });
      setEditingId(null);
      setEditingText("");
    } catch (e) {
      console.error(e);
      alert(e?.message || "Failed to update note");
    }
  };

  const remove = async (noteId) => {
    const ok = window.confirm("Delete this note?");
    if (!ok) return;

    try {
      await deleteDepositNote({ utr, noteId });
    } catch (e) {
      console.error(e);
      alert(e?.message || "Failed to delete note");
    }
  };

  return (
    <div className="card" style={{ borderRadius: 12 }}>
      <div className="card-header">
        <h3 className="card-title" style={{ margin: 0 }}>
          Notes (UTR: {utr})
        </h3>
      </div>

      <div className="card-body" style={{ display: "grid", gap: 10 }}>
        {error ? (
          <div className="alert alert-danger" style={{ marginBottom: 0 }}>
            {error}
          </div>
        ) : null}

        {/* Add */}
        <div style={{ display: "grid", gap: 8 }}>
          <textarea
            className="form-control"
            rows={3}
            placeholder="Add note…"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
          />
          <button className="btn btn-primary" type="button" onClick={submitNew}>
            Add note
          </button>
        </div>

        <hr />

        {/* List */}
        {notes.length === 0 ? (
          <div style={{ color: "#6b7280" }}>No notes yet.</div>
        ) : (
          notes.map((n) => {
            const created = n.createdAt?.toDate?.()?.toLocaleString?.() || "";
            const updated = n.updatedAt?.toDate?.()?.toLocaleString?.() || "";
            const isEditing = editingId === n.id;

            return (
              <div key={n.id} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                  Created: {created}
                  {updated && updated !== created ? ` • Updated: ${updated}` : ""}
                </div>

                {!isEditing ? (
                  <div style={{ whiteSpace: "pre-wrap", fontWeight: 600 }}>{n.text}</div>
                ) : (
                  <textarea
                    className="form-control"
                    rows={3}
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                  />
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  {!isEditing ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => {
                        setEditingId(n.id);
                        setEditingText(n.text || "");
                      }}
                    >
                      Edit
                    </button>
                  ) : (
                    <>
                      <button type="button" className="btn btn-sm btn-primary" onClick={submitEdit}>
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-default"
                        onClick={() => {
                          setEditingId(null);
                          setEditingText("");
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  )}

                  <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => remove(n.id)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
