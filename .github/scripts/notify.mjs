// Promemoria HACCP delle 18: manda una notifica solo se mancano temperature o pulizie.
import admin from "firebase-admin";
import {fileURLToPath} from "node:url";

const TDEV = [["z1","Freezer 1"],["z2","Freezer 2"],["v1","Vetrina bar/deposito"],["b1","Banco bar"],["v2","Vetrina sala"]];
const TZ = "Europe/Rome";
const romeDate = ms => new Date(ms).toLocaleString("sv-SE", {timeZone: TZ}).slice(0, 10);

export function missing(data, date){
  const get = (k, d) => { try { const v = data[k]; return v ? JSON.parse(v) : d; } catch(e){ return d; } };
  const CLOSED = get("haccp-closed-v1", [2]), XCL = get("haccp-closedx-v1", []), OPN = get("haccp-openx-v1", []);
  const wd = new Date(date + "T12:00:00Z").getUTCDay();
  if (!OPN.includes(date) && (CLOSED.includes(wd) || XCL.includes(date))) return {closed: true, temps: [], pul: []};
  const tE = get("haccp-temp-v1", []), pE = get("haccp-pul-v1", []);
  const temps = TDEV.filter(([id]) => !tE.some(e => e.dev === id && (e.data || romeDate(e.t)) === date)).map(x => x[1]);
  const pul = [["sala", "Sala"], ["cucina", "Cucina"]].filter(([r]) => !pE.some(e => e.rep === r && e.task === "g" && e.data === date)).map(x => x[1]);
  return {closed: false, temps, pul};
}
export function testo(m){
  const p = [];
  if (m.temps.length) p.push("Temperature da registrare: " + m.temps.join(", ") + ".");
  if (m.pul.length) p.push("Pulizia giornaliera da segnare: " + m.pul.join(", ") + ".");
  return p.join(" ");
}

async function main(){
  admin.initializeApp({credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA))});
  const db = admin.firestore(), now = Date.now();
  const s = new Date(now).toLocaleString("sv-SE", {timeZone: TZ}), date = s.slice(0, 10), hour = +s.slice(11, 13);
  const force = process.env.FORCE === "true";
  console.log("Ora a Roma:", s, force ? "(prova forzata)" : "");
  if (!force && (hour < 18 || hour > 19)){ console.log("Non è l'ora del promemoria, esco."); return; }
  const devs = await db.collectionGroup("devices").get();
  const byKitchen = {};
  devs.forEach(d => { const code = d.ref.parent.parent && d.ref.parent.parent.id; if (code) (byKitchen[code] = byKitchen[code] || []).push(d); });
  for (const code of Object.keys(byKitchen)){
    const metaRef = db.doc(`kitchens/${code}/meta/notify`);
    const meta = await metaRef.get();
    if (!force && meta.exists && meta.data().date === date){ console.log("Già inviato oggi per una cucina."); continue; }
    const data = {}; (await db.collection(`kitchens/${code}/data`).get()).forEach(d => { data[d.id] = d.data().v; });
    const m = missing(data, date);
    if (m.closed){ console.log("Giorno di chiusura: nessuna notifica."); continue; }
    const body = testo(m);
    if (!body){ console.log("Tutto registrato: nessuna notifica."); await metaRef.set({date, sent: 0}); continue; }
    let sent = 0;
    for (const d of byKitchen[code]){
      try {
        await admin.messaging().send({token: d.data().token, data: {title: "Promemoria HACCP", body}, webpush: {headers: {Urgency: "high", TTL: "7200"}}});
        sent++;
      } catch(e){
        console.log("Errore invio:", e.code || e.message);
        if (/registration-token-not-registered|invalid-argument|invalid-registration/.test(e.code || "")) await d.ref.delete();
      }
    }
    console.log("Notifiche inviate:", sent, "-", body);
    if (!force) await metaRef.set({date, sent});
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
