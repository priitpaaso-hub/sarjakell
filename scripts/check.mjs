// Tunnipõhine kontroll: vaatab kõigi pereliikmete sarjad läbi ja saadab teavituse,
// kui mõni osa on ilmunud viimase 6 tunni jooksul (iga osa kohta üks kord).
import admin from 'firebase-admin';
import webpush from 'web-push';

const TZ = 'Europe/Tallinn';
const BEFORE = 6 * 3600e3; // varu juhuks, kui GitHub mõne käivituse vahele jätab
const AFTER = 0;           // teavitus alles pärast ilmumist
const now = Date.now();

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:sarjakell@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = new Map();
async function getShow(id) {
  if (cache.has(id)) return cache.get(id);
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://api.tvmaze.com/shows/${id}?embed[]=nextepisode&embed[]=previousepisode`);
    if (r.status === 429) { await sleep(2500); continue; }
    const v = r.ok ? await r.json() : null;
    cache.set(id, v);
    await sleep(600); // TVmaze piirang: ~20 päringut 10 sekundi kohta
    return v;
  }
  cache.set(id, null);
  return null;
}

const epTime = (ep) => ep.airstamp ? Date.parse(ep.airstamp) : ep.airdate ? Date.parse(ep.airdate + 'T12:00:00Z') : NaN;
const tallinnTime = (t) => new Date(t).toLocaleTimeString('et-EE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

function message(show, ep, t) {
  const code = `${ep.season}. hooaeg, ${ep.number != null ? ep.number + '. osa' : 'eriosa'}`;
  const title = ep.number === 1 ? `${show.name}: uus hooaeg!` : show.name;
  const where = show.network?.name || show.webChannel?.name;
  const at = ep.airtime ? ` (ilmus kell ${tallinnTime(t)}${where ? ', ' + where : ''})` : where ? ` (${where})` : '';
  const body = `${code}${ep.name ? ' «' + ep.name + '»' : ''} on väljas${at}.`;
  return { title, body, tag: 'ep-' + ep.id, url: './' };
}

let sent = 0, checked = 0;
const members = await db.collectionGroup('members').get();
console.log(`Pereliikmeid: ${members.size}`);

for (const m of members.docs) {
  const data = m.data();
  const subs = { ...(data.subs || {}) };
  if (!Object.keys(subs).length) continue;
  for (const s of data.shows || []) {
    const show = await getShow(s.id);
    checked++;
    if (!show) continue;
    const eps = [show._embedded?.previousepisode, show._embedded?.nextepisode].filter(Boolean);
    for (const ep of eps) {
      const t = epTime(ep);
      if (Number.isNaN(t) || t < now - BEFORE || t > now + AFTER) continue;
      const sentRef = m.ref.collection('sent').doc(String(ep.id));
      if ((await sentRef.get()).exists) continue;

      const payload = JSON.stringify(message(show, ep, t));
      let ok = 0;
      for (const [key, sub] of Object.entries(subs)) {
        try {
          await webpush.sendNotification(sub, payload, { TTL: 86400 });
          ok++;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await m.ref.update({ [`subs.${key}`]: admin.firestore.FieldValue.delete() });
            delete subs[key];
            console.log(`Aegunud seade eemaldatud (${data.name})`);
          } else {
            console.error(`Saatmine ebaõnnestus (${data.name}): ${err.statusCode || ''} ${err.body || err.message}`);
          }
        }
      }
      if (ok) {
        await sentRef.set({ at: admin.firestore.FieldValue.serverTimestamp(), show: show.name });
        sent++;
        console.log(`Teavitus: ${data.name} ← ${show.name} S${ep.season}E${ep.number}`);
      }
    }
  }
}
console.log(`Kontrollitud ${checked} sarja, saadetud ${sent} teavitust.`);
