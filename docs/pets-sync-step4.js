/**
 * pets-sync-step4.js v1
 * STEP 4 — Push Outbox + tmp_id mapping (minimal, smoke-safe)
 */

async function pushOutboxIfOnline() {
  if (!navigator.onLine) return;
  if (typeof getAuthToken !== "function" || !getAuthToken()) return;

  const db = await openPetsDB();
  const tx = db.transaction(["outbox"], "readwrite");
  const store = tx.objectStore("outbox");
  const ops = [];

  await new Promise(resolve => {
    store.openCursor().onsuccess = e => {
      const c = e.target.result;
      if (!c) return resolve();
      ops.push({ id: c.primaryKey, ...c.value });
      c.continue();
    };
  });

  if (!ops.length) return;

  let res;
  try {
    res = await fetchApi("/api/sync/pets/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: localStorage.getItem("device_id"),
        ops: ops.map(o => o.value || o)
      })
    });
  } catch {
    return;
  }

  if (!res || !res.ok) return;

  let data;
  try { data = await res.json(); } catch { return; }

  // remove accepted ops
  if (Array.isArray(data.accepted)) {
    for (const acc of data.accepted) {
      try { store.delete(acc.id); } catch {}
    }
  }

  await tx.done;
}

// expose
window.ADA_PetsSync = { pushOutboxIfOnline };