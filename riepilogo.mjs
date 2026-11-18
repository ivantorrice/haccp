// Riepilogo coperti: ogni sera alle 20 (lun, mer-sab) e la domenica alle 12:30.
import admin from "firebase-admin";
import {fileURLToPath} from "node:url";

const TZ = "Europe/Rome";

export function riepilogo(data, date){
  const get = (k, d) => { try { const v = data[k]; return v ? JSON.parse(v) : d; } catch(e){ return d; } };
  const CLOSED = get("haccp-closed-v1", [2]), XCL = get("haccp-closedx-v1", []), OPN = get("haccp-openx-v1", []);
  const wd = new Date(date + "T12:00:00Z").getUTCDay();
  if (!OPN.includes(date) && (CLOSED.includes(wd) || XCL.includes(date))) return null;
  const lim = Number(get("haccp-prenlim-v1", 54)) > 0 ? Number(get("haccp-prenlim-v1", 54)) : 54;
  const list = get("haccp-pren-v1", []).filter(b => b && !b.x && b.st !== "ann" && !(b.ev && b.es === "prev") && b.d === date);
  const tot = list.reduce((a, b) => a + (Number(b.p) || 0), 0), by = {};
  list.forEach(b => { const h = String(b.t || "").slice(0, 2); by[h] = (by[h] || 0) + (Number(b.p) || 0); });
  const fasce = Object.keys(by).sort().map(h => h + ":00 " + by[h]).join(" · ");
  const quando = wd === 0 ? "A pranzo" : "Stasera";
  const body = list.length
    ? `${quando} ${tot} coperti · ${list.length} ${list.length === 1 ? "prenotazione" : "prenotazioni"} · ` + (tot > lim ? `${tot - lim} oltre il limite` : `${lim - tot} liberi`) + (fasce ? ` (${fasce})` : "")
    : `${quando} nessuna prenotazione.`;
  return {wd, body};
}

async function main(){
  admin.initializeApp({credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA))});
  const db = admin.firestore();
  const s = new Date().toLocaleString("sv-SE", {timeZone: TZ}), date = s.slice(0, 10), mins = +s.slice(11, 13) * 60 + +s.slice(14, 16);
  const wd = new Date(date + "T12:00:00Z").getUTCDay(), force = process.env.FORCE === "true";
  console.log("Ora a Roma:", s, force ? "(prova forzata)" : "");
  const ok = wd === 0 ? (mins >= 12 * 60 + 30 && mins < 15 * 60) : (mins >= 20 * 60 && mins < 22 * 60);
  if (!force && !ok){ console.log("Non è l'ora del riepilogo, esco."); return; }
  const devs = await db.collectionGroup("devices").get();
  const byKitchen = {};
  devs.forEach(d => { const code = d.ref.parent.parent && d.ref.parent.parent.id; if (code) (byKitchen[code] = byKitchen[code] || []).push(d); });
  for (const code of Object.keys(byKitchen)){
    const metaRef = db.doc(`kitchens/${code}/meta/riepilogo`), meta = await metaRef.get();
    if (!force && meta.exists && meta.data().date === date){ console.log("Già inviato oggi."); continue; }
    const data = {}; (await db.collection(`kitchens/${code}/data`).get()).forEach(d => { data[d.id] = d.data().v; });
    const r = riepilogo(data, date);
    if (!r){ console.log("Giorno di chiusura: nessuna notifica."); continue; }
    let sent = 0;
    for (const d of byKitchen[code]){
      try { await admin.messaging().send({token: d.data().token, data: {title: "Prenotazioni", body: r.body, tag: "riep-" + date}, webpush: {headers: {Urgency: "high", TTL: "3600"}}}); sent++; }
      catch(e){ console.log("Errore invio:", e.code || e.message); if (/registration-token-not-registered|invalid-argument|invalid-registration/.test(e.code || "")) await d.ref.delete(); }
    }
    console.log("Notifiche inviate:", sent, "-", r.body);
    if (!force) await metaRef.set({date, sent});
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
