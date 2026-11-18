// Avvisa tutti i telefoni quando qualcuno inserisce una nuova prenotazione.
import admin from "firebase-admin";

const TZ = "Europe/Rome", DN = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
async function main(){
  admin.initializeApp({credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA))});
  const db = admin.firestore();
  const today = new Date().toLocaleString("sv-SE", {timeZone: TZ}).slice(0, 10);
  const devs = await db.collectionGroup("devices").get();
  const byKitchen = {};
  devs.forEach(d => { const code = d.ref.parent.parent && d.ref.parent.parent.id; if (code) (byKitchen[code] = byKitchen[code] || []).push(d); });
  for (const code of Object.keys(byKitchen)){
    const snap = await db.doc(`kitchens/${code}/data/haccp-pren-v1`).get();
    let all = []; try { all = snap.exists ? JSON.parse(snap.data().v) : []; } catch(e){ all = []; }
    const live = all.filter(b => b && !b.x && b.st !== "ann" && !(b.ev && b.es === "prev") && b.d >= today);
    const metaRef = db.doc(`kitchens/${code}/meta/pren`), meta = await metaRef.get();
    const sent = new Set(meta.exists ? meta.data().sent || [] : []);
    if (!meta.exists){ await metaRef.set({sent: live.map(b => b.id)}); console.log("Prima esecuzione: segno", live.length, "prenotazioni già presenti."); continue; }
    const fresh = live.filter(b => !sent.has(b.id)).sort((a, b) => (a.u || 0) - (b.u || 0));
    if (!fresh.length){ console.log("Nessuna prenotazione nuova."); continue; }
    for (const b of fresh.slice(0, 8)){
      const w = new Date(b.d + "T12:00:00Z"), body = `${b.n} · ${b.p} ${Number(b.p) === 1 ? "persona" : "persone"} · ${b.t} · ${DN[w.getUTCDay()]} ${w.getUTCDate()}/${w.getUTCMonth() + 1}` + (b.by ? ` (presa da ${b.by})` : "");
      for (const d of byKitchen[code]){
        if (b.dv && d.id === b.dv) continue;
        try { await admin.messaging().send({token: d.data().token, data: {title: "Nuova prenotazione", body, tag: "pren-" + b.id}, webpush: {headers: {Urgency: "high", TTL: "3600"}}}); }
        catch(e){ console.log("Errore invio:", e.code || e.message); if (/registration-token-not-registered|invalid-argument|invalid-registration/.test(e.code || "")) await d.ref.delete(); }
      }
      console.log("Inviata:", body);
    }
    fresh.forEach(b => sent.add(b.id));
    await metaRef.set({sent: [...sent].slice(-600)});
  }
}
main().catch(e => { console.error(e); process.exit(1); });
