import { CONFIG } from './config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const TV = 'https://api.tvmaze.com';
const DEMO = new URLSearchParams(location.search).has('demo');

/* ---------- abifunktsioonid ---------- */
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const strip = (h) => new DOMParser().parseFromString(h || '', 'text/html').body.textContent || '';
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
const randCode = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => ALPHA[x % ALPHA.length]).join('');
const fmtCode = (c) => (c.match(/.{1,4}/g) || []).join('-');
const cleanCode = (c) => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const initial = (n) => (String(n || '?').trim()[0] || '?').toUpperCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- olek ---------- */
const S = {
  family: ls.get('family'), memberId: ls.get('memberId'), member: null,
  tab: 'upcoming', unsub: null, lastQ: '', results: null, pendingCode: null
};
const $app = document.getElementById('app');

/* ---------- andmebaas (Firebase või demo) ---------- */
let api;

async function initFirebase() {
  const [{ initializeApp }, fs] = await Promise.all([
    import(FB + 'firebase-app.js'),
    import(FB + 'firebase-firestore.js')
  ]);
  const db = fs.getFirestore(initializeApp(CONFIG.firebase));
  const mref = (id) => fs.doc(db, 'families', S.family, 'members', id);
  return {
    async listMembers() {
      const snap = await fs.getDocs(fs.collection(db, 'families', S.family, 'members'));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.created || 0) - (b.created || 0));
    },
    createMember: (id, data) => fs.setDoc(mref(id), data),
    update: (patch) => fs.updateDoc(mref(S.memberId), patch),
    removeSub: (key) => fs.updateDoc(mref(S.memberId), { ['subs.' + key]: fs.deleteField() }),
    watch(cb, onErr) {
      return fs.onSnapshot(mref(S.memberId), (snap) => cb(snap.exists() ? snap.data() : null), onErr);
    }
  };
}

function initDemo() {
  const members = [
    { id: 'm1', name: 'Priit', created: 1, subs: {}, shows: DEMO_SHOWS.map(({ id, name, image }) => ({ id, name, image: image?.medium })) },
    { id: 'm2', name: 'Kristi', created: 2, subs: {}, shows: [] }
  ];
  let listener = null;
  const me = () => members.find((m) => m.id === S.memberId);
  return {
    listMembers: async () => members,
    createMember: async (id, data) => { members.push({ id, ...data }); },
    update: async (patch) => { Object.assign(me(), patch); listener && listener(structuredClone(me())); },
    removeSub: async () => {},
    watch(cb) { listener = cb; setTimeout(() => cb(me() ? structuredClone(me()) : null), 0); return () => { listener = null; }; }
  };
}

/* ---------- TVmaze ---------- */
const mem = new Map();
async function tv(path, ttlMin = 360) {
  if (DEMO) return demoTv(path);
  const key = 'tv:' + path;
  if (mem.has(key)) return mem.get(key);
  try {
    const c = JSON.parse(sessionStorage.getItem(key));
    if (c && Date.now() - c.t < ttlMin * 60e3) { mem.set(key, c.v); return c.v; }
  } catch {}
  const p = (async () => {
    for (let i = 0; i < 3; i++) {
      const r = await fetch(TV + path);
      if (r.status === 429) { await sleep(1500); continue; }
      if (!r.ok) throw new Error('TVmaze ' + r.status);
      return r.json();
    }
    throw new Error('TVmaze on ülekoormatud');
  })();
  mem.set(key, p);
  try {
    const v = await p;
    mem.set(key, v);
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch {}
    return v;
  } catch (e) { mem.delete(key); throw e; }
}
const showPath = (id) => `/shows/${id}?embed[]=nextepisode&embed[]=previousepisode`;

/* ---------- kuupäevad ---------- */
const dayKey = (d) => d.toLocaleDateString('sv-SE');
function epDate(ep) {
  if (ep.airstamp) return new Date(ep.airstamp);
  if (ep.airdate) return new Date(ep.airdate + 'T12:00:00');
  return null;
}
function dayLabel(d) {
  const t = new Date(); const tm = new Date(t); tm.setDate(t.getDate() + 1);
  if (dayKey(d) === dayKey(t)) return 'Täna';
  if (dayKey(d) === dayKey(tm)) return 'Homme';
  const s = d.toLocaleDateString('et-EE', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const timeStr = (ep, d) => (ep.airtime ? d.toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' }) : '');
const epCode = (ep) => `${ep.season}. hooaeg · ${ep.number != null ? ep.number + '. osa' : 'eriosa'}`;
const channel = (sh) => sh.network?.name || sh.webChannel?.name || '';
const statusEt = (s) => ({ Running: 'jookseb', Ended: 'lõppenud', 'To Be Determined': 'teadmata', 'In Development': 'arenduses' }[s] || '');
const poster = (img, name, cls = 'poster') => img
  ? `<img class="${cls}" src="${esc(img)}" alt="" loading="lazy">`
  : `<div class="${cls} ph">${esc(initial(name))}</div>`;

/* ---------- ikoonid ---------- */
const ICON = {
  upcoming: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  mine: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>'
};
const TABS = [['upcoming', 'Tulekul'], ['mine', 'Minu sarjad'], ['search', 'Otsi']];

/* ---------- käivitus ---------- */
async function boot() {
  if ('serviceWorker' in navigator && !DEMO) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  const p = new URLSearchParams(location.search).get('pere');
  if (p) S.pendingCode = cleanCode(p);

  if (DEMO) {
    api = initDemo();
    S.family = S.family || 'demo0demo0demo0demo0demo';
  } else {
    if (!CONFIG.firebase.projectId) {
      $app.innerHTML = `<div class="welcome"><img class="logo" src="icons/icon-192.png" alt=""><h1>Seadistamata</h1>
        <p class="lead">Fail config.js on täitmata. Vaata JUHEND.md sammud 2 ja 3.</p></div>`;
      return;
    }
    try { api = await initFirebase(); }
    catch { $app.innerHTML = `<div class="welcome"><h1>Ühendus puudub</h1><p class="lead">Andmebaasiga ei õnnestunud ühendust luua. Kontrolli internetti ja ava äpp uuesti.</p></div>`; return; }
  }
  if (S.family && S.memberId) startMember(); else render();
}

function render() {
  if (!S.family) return renderWelcome();
  if (!S.memberId || !S.member) return renderProfiles();
  renderShell();
}

/* ---------- 1. tervitus: pere loomine või liitumine ---------- */
function renderWelcome() {
  const needInstall = isIOS() && !isStandalone() && !DEMO;
  $app.innerHTML = `
    <div class="welcome">
      <img class="logo" src="icons/icon-192.png" alt="">
      <h1>Sarjakell</h1>
      <p class="lead">Pere ühine seriaalide märkmik. Igaüks valib oma sarjad ja saab teavituse, kui ilmub uus osa.</p>
      ${needInstall ? `<div class="card tip"><h3>Paigalda kõigepealt</h3>
        <p>iPhone'is töötavad teavitused ainult siis, kui Sarjakell on paigaldatud.</p>
        <ol><li>Vajuta Safaris all <b>Jaga</b> nuppu</li><li>Vali <b>Lisa avaekraanile</b></li><li>Ava Sarjakell avaekraani ikoonilt ja jätka seal</li></ol></div>` : ''}
      <div class="card">
        <h3>Liitu perega</h3>
        <p>Sisesta pere kood, mille said pereliikmelt.</p>
        <input id="code" class="field code-field" placeholder="xxxx-xxxx-xxxx-xxxx-xxxx-xxxx" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(S.pendingCode ? fmtCode(S.pendingCode) : '')}">
        <div style="height:10px"></div>
        <button class="btn" id="join">Liitu</button>
      </div>
      <div class="or">või</div>
      <button class="btn ghost" id="create">Loo uus pere</button>
    </div>`;
  document.getElementById('create').onclick = () => {
    S.family = randCode(24); ls.set('family', S.family); renderProfiles();
  };
  document.getElementById('join').onclick = async (e) => {
    const code = cleanCode(document.getElementById('code').value);
    if (code.length < 20) return toast('Kood on liiga lühike');
    e.target.disabled = true;
    S.family = code;
    try {
      const list = await api.listMembers();
      if (!list.length) { S.family = null; e.target.disabled = false; return toast('Selle koodiga peret ei leitud'); }
      ls.set('family', code); renderProfiles(list);
    } catch { S.family = null; e.target.disabled = false; toast('Ühendus ebaõnnestus'); }
  };
}

/* ---------- 2. profiili valik ---------- */
async function renderProfiles(prefetched) {
  $app.innerHTML = `<div class="welcome"><img class="logo" src="icons/icon-192.png" alt=""><h1>Kes vaatab?</h1>
    <p class="lead">Vali oma profiil või lisa uus pereliige.</p><div id="mlist"><div class="loading">Laen…</div></div>
    <div class="card"><h3>Lisa pereliige</h3><div class="row">
      <input id="newName" class="field" placeholder="Nimi" maxlength="24" autocomplete="off">
      <button class="btn" id="addM">Lisa</button></div></div>
    <button class="btn ghost" id="leave" style="margin-top:8px">Muu pere kood</button></div>`;
  document.getElementById('leave').onclick = () => { S.family = null; ls.del('family'); render(); };
  document.getElementById('addM').onclick = async (e) => {
    const name = document.getElementById('newName').value.trim();
    if (!name) return toast('Sisesta nimi');
    e.target.disabled = true;
    const id = randCode(10);
    try {
      await api.createMember(id, { name, shows: [], subs: {}, created: Date.now() });
      selectMember(id);
    } catch { e.target.disabled = false; toast('Salvestamine ebaõnnestus'); }
  };
  try {
    const list = prefetched || await api.listMembers();
    const box = document.getElementById('mlist');
    if (!box) return;
    box.innerHTML = list.length ? list.map((m) => `<button class="member" data-id="${esc(m.id)}">
        <span class="avatar" style="display:grid;place-content:center">${esc(initial(m.name))}</span>
        <span>${esc(m.name)}<small>${(m.shows || []).length} sarja</small></span></button>`).join('')
      : '<p class="hint">Peres pole veel kedagi. Lisa esimene liige.</p>';
    box.querySelectorAll('.member').forEach((b) => (b.onclick = () => selectMember(b.dataset.id)));
  } catch { toast('Ühendus ebaõnnestus'); }
}

function selectMember(id) { S.memberId = id; ls.set('memberId', id); S.member = null; startMember(); }

function startMember() {
  if (S.unsub) S.unsub();
  $app.innerHTML = '<div class="splash"><img src="icons/icon-192.png" alt=""><p>Laen…</p></div>';
  S.unsub = api.watch((data) => {
    if (!data) { S.member = null; S.memberId = null; ls.del('memberId'); render(); return; }
    const first = !S.member;
    S.member = data;
    if (first) render(); else refreshView();
  }, () => toast('Ühendus andmebaasiga katkes'));
}

/* ---------- 3. põhivaade ---------- */
function renderShell() {
  $app.innerHTML = `
    <header class="top"><div class="brand"><img src="icons/icon-192.png" alt=""><span>Sarjakell</span></div>
      <button class="avatar" id="me" aria-label="Seaded">${esc(initial(S.member.name))}</button></header>
    <main id="view"></main>
    <nav class="tabs">${TABS.map(([k, l]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-tab="${k}">${ICON[k]}<span>${l}</span></button>`).join('')}</nav>`;
  document.getElementById('me').onclick = openSettings;
  document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => go(b.dataset.tab)));
  renderView();
}
function go(tab) {
  S.tab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  window.scrollTo(0, 0);
  renderView();
}
function renderView() {
  const v = document.getElementById('view');
  if (!v) return;
  if (S.tab === 'upcoming') viewUpcoming(v);
  else if (S.tab === 'mine') viewMine(v);
  else viewSearch(v);
}
function refreshView() {
  if (!document.getElementById('view')) return render();
  const a = document.getElementById('me'); if (a) a.textContent = initial(S.member.name);
  if (S.tab === 'search') renderResults(); else renderView();
}
const emptyState = (msg) => `<div class="empty"><p>${msg}</p><button class="btn" id="toSearch" style="max-width:260px;margin:0 auto">Otsi sarju</button></div>`;
function bindEmpty() { const b = document.getElementById('toSearch'); if (b) b.onclick = () => go('search'); }

/* Tulekul */
let upToken = 0;
async function viewUpcoming(v) {
  const shows = S.member.shows || [];
  if (!shows.length) { v.innerHTML = emptyState('Sa ei jälgi veel ühtegi sarja.'); return bindEmpty(); }
  const token = ++upToken;
  if (!v.innerHTML.trim() || !v.querySelector('.ep, .later')) v.innerHTML = '<div class="loading">Laen ilmumisaegu…</div>';
  const res = await Promise.allSettled(shows.map((s) => tv(showPath(s.id))));
  if (token !== upToken || S.tab !== 'upcoming') return;

  const start = new Date(); start.setHours(0, 0, 0, 0);
  const items = []; const later = [];
  res.forEach((r, i) => {
    if (r.status !== 'fulfilled') { later.push({ name: shows[i].name, note: 'andmed ei laadinud' }); return; }
    const sh = r.value;
    const cand = [sh._embedded?.previousepisode, sh._embedded?.nextepisode].filter(Boolean)
      .map((ep) => ({ ep, d: epDate(ep) })).filter((x) => x.d && x.d >= start);
    const seen = new Set();
    const uniq = cand.filter((x) => !seen.has(x.ep.id) && seen.add(x.ep.id));
    if (uniq.length) uniq.forEach((x) => items.push({ sh, ...x }));
    else later.push({ name: sh.name, note: sh.status === 'Ended' ? 'lõppenud' : 'kuupäev teadmata' });
  });
  items.sort((a, b) => a.d - b.d);

  const groups = new Map();
  items.forEach((it) => { const k = dayKey(it.d); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); });
  let html = '';
  for (const [, list] of groups) {
    const label = dayLabel(list[0].d);
    html += `<h2 class="section ${label === 'Täna' ? 'today' : ''}">${esc(label)}</h2>`;
    html += list.map(({ sh, ep, d }) => `
      <article class="ep ${ep.number === 1 ? 'premiere' : ''}" data-id="${sh.id}">
        ${poster(sh.image?.medium, sh.name)}
        <div><div class="ep-show">${esc(sh.name)}${ep.number === 1 ? '<span class="chip">uus hooaeg</span>' : ''}</div>
          <div class="ep-meta">${esc(epCode(ep))}</div>
          ${ep.name ? `<div class="ep-title">${esc(ep.name)}</div>` : ''}</div>
        <div class="ep-when">${esc(timeStr(ep, d))}<small>${esc(channel(sh))}</small></div>
      </article>`).join('');
  }
  if (!items.length) html += '<p class="hint">Lähiajal uusi osi ei ilmu.</p>';
  if (later.length) {
    html += `<h2 class="section">Uue osa kuupäev pole teada</h2><div class="later">${later
      .map((x) => `<div>${esc(x.name)}<span>${esc(x.note)}</span></div>`).join('')}</div>`;
  }
  v.innerHTML = html;
  v.querySelectorAll('.ep').forEach((el) => (el.onclick = () => openShow(+el.dataset.id)));
}

/* Minu sarjad */
function viewMine(v) {
  const shows = S.member.shows || [];
  if (!shows.length) { v.innerHTML = emptyState('Sinu nimekiri on tühi.'); return bindEmpty(); }
  v.innerHTML = `<h2 class="section">Jälgin ${shows.length} sarja</h2><div class="grid">${shows
    .map((s) => `<button class="tile" data-id="${s.id}">${poster(s.image, s.name)}<div class="tile-name">${esc(s.name)}</div></button>`).join('')}</div>`;
  v.querySelectorAll('.tile').forEach((b) => (b.onclick = () => openShow(+b.dataset.id)));
}

/* Otsing */
let searchTimer;
function viewSearch(v) {
  v.innerHTML = `<div class="search"><input id="q" type="search" placeholder="Sarja nimi, nt Slow Horses" autocomplete="off" enterkeyhint="search"></div>
    <div id="results"><p class="hint">Otsing kasutab TVmaze'i andmebaasi (üle 50 000 sarja, ka Netflix, HBO jt).</p></div>`;
  const q = document.getElementById('q');
  q.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => doSearch(q.value), 350); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { q.blur(); doSearch(q.value); } });
  if (S.lastQ) { q.value = S.lastQ; renderResults(); } else q.focus();
}
async function doSearch(term) {
  term = term.trim(); S.lastQ = term;
  const box = document.getElementById('results'); if (!box) return;
  if (term.length < 2) { S.results = null; box.innerHTML = '<p class="hint">Sisesta vähemalt 2 tähte.</p>'; return; }
  box.innerHTML = '<div class="loading">Otsin…</div>';
  try {
    const res = await tv('/search/shows?q=' + encodeURIComponent(term), 30);
    if (term !== S.lastQ) return;
    S.results = res.map((r) => r.show);
    renderResults();
  } catch { box.innerHTML = '<p class="hint">Otsing ebaõnnestus. Kontrolli internetiühendust.</p>'; }
}
function renderResults() {
  const box = document.getElementById('results');
  if (!box || !S.results) return;
  const have = new Set((S.member.shows || []).map((s) => s.id));
  if (!S.results.length) { box.innerHTML = '<p class="hint">Midagi ei leitud.</p>'; return; }
  box.innerHTML = S.results.map((sh) => `
    <div class="res">${poster(sh.image?.medium, sh.name)}
      <div><div class="res-name">${esc(sh.name)}</div>
        <div class="res-meta">${esc([sh.premiered?.slice(0, 4), channel(sh), statusEt(sh.status)].filter(Boolean).join(' · '))}</div></div>
      <button class="add ${have.has(sh.id) ? 'on' : ''}" data-id="${sh.id}">${have.has(sh.id) ? 'Jälgin' : 'Lisa'}</button>
    </div>`).join('');
  box.querySelectorAll('.add').forEach((b) => (b.onclick = () => toggleShow(S.results.find((x) => x.id === +b.dataset.id))));
}

async function toggleShow(sh) {
  if (!sh) return;
  const shows = [...(S.member.shows || [])];
  const i = shows.findIndex((s) => s.id === sh.id);
  if (i >= 0) shows.splice(i, 1);
  else shows.push({ id: sh.id, name: sh.name, image: sh.image?.medium || null });
  S.member = { ...S.member, shows };
  refreshView();
  try { await api.update({ shows }); toast(i >= 0 ? 'Eemaldatud' : 'Lisatud: ' + sh.name); }
  catch { toast('Salvestamine ebaõnnestus'); }
}

/* ---------- alumine leht ---------- */
function sheet(html) {
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  return bg;
}

async function openShow(id) {
  const bg = sheet('<div class="loading">Laen…</div>');
  const box = bg.querySelector('.sheet');
  try {
    const sh = await tv(showPath(id));
    const nx = sh._embedded?.nextepisode;
    const following = (S.member.shows || []).some((s) => s.id === id);
    let next = 'Järgmise osa kuupäev pole teada.';
    if (nx) { const d = epDate(nx); next = `${dayLabel(d)}${timeStr(nx, d) ? ' kell ' + timeStr(nx, d) : ''}: ${epCode(nx)}${nx.name ? ', ' + nx.name : ''}`; }
    if (sh.status === 'Ended') next = 'Sari on lõppenud.';
    box.innerHTML = `<div class="grab"></div>
      <div class="detail-top">${poster(sh.image?.medium, sh.name)}<div>
        <h2>${esc(sh.name)}</h2>
        <p class="sub">${esc([sh.premiered?.slice(0, 4), channel(sh), statusEt(sh.status)].filter(Boolean).join(' · '))}</p>
        <p class="status">${esc(next)}</p></div></div>
      ${sh.summary ? `<p class="summary">${esc(strip(sh.summary))}</p>` : ''}
      <button class="btn ${following ? 'danger' : ''}" id="tg">${following ? 'Lõpeta jälgimine' : 'Hakka jälgima'}</button>`;
    box.querySelector('#tg').onclick = () => { toggleShow(sh); bg.remove(); };
  } catch { box.innerHTML = '<div class="grab"></div><p class="hint">Andmeid ei õnnestunud laadida.</p>'; }
}

/* ---------- seaded ja teavitused ---------- */
async function subKey(endpoint) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}
function b64ToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function currentSub() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function openSettings() {
  const link = `${location.origin}${location.pathname}?pere=${S.family}`;
  const bg = sheet(`
    <h2>${esc(S.member.name)}</h2><p class="sub">Jälgib ${(S.member.shows || []).length} sarja</p>
    <h3>Teavitused</h3><div id="push"><p class="status">Kontrollin…</p></div>
    <h3>Pere</h3><div class="fam" id="fam"></div>
    <p class="sub">Pere kood (jaga ainult pereliikmetega):</p>
    <div class="code-box">${esc(fmtCode(S.family))}</div>
    <button class="btn ghost" id="share">Jaga pere koodi</button>
    <h3>Profiil</h3>
    <button class="btn ghost" id="switch">Vaheta profiili</button>
    <button class="btn danger" id="leave">Lahku perest sellel seadmel</button>`);
  const $ = (s) => bg.querySelector(s);

  api.listMembers().then((list) => {
    $('#fam').innerHTML = list.map((m) => `<span class="${m.id === S.memberId ? 'me' : ''}">${esc(m.name)}</span>`).join('');
  }).catch(() => {});

  $('#share').onclick = async () => {
    const text = `Liitu meie pere Sarjakellaga. Pere kood: ${fmtCode(S.family)}\n${link}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Sarjakell', text });
      else { await navigator.clipboard.writeText(text); toast('Kopeeritud'); }
    } catch {}
  };
  $('#switch').onclick = () => { bg.remove(); if (S.unsub) S.unsub(); S.memberId = null; S.member = null; ls.del('memberId'); render(); };
  $('#leave').onclick = () => {
    if (!confirm('Kas lahkud perest sellel seadmel? Andmed jäävad alles ja saad koodiga uuesti liituda.')) return;
    bg.remove(); if (S.unsub) S.unsub();
    S.family = S.memberId = S.member = null; ls.del('family'); ls.del('memberId'); render();
  };
  renderPush($('#push'));
}

async function renderPush(box) {
  const subs = S.member.subs || {};
  if (DEMO) { box.innerHTML = '<p class="status on">Sees sellel seadmel (demo)</p><button class="btn ghost">Saada proovi-teavitus</button>'; return; }
  if (isIOS() && !isStandalone()) {
    box.innerHTML = '<p class="status">Teavitusi saab lubada, kui Sarjakell on lisatud avaekraanile ja avatud sealt.</p>'; return;
  }
  if (!('Notification' in window) || !('PushManager' in window)) {
    box.innerHTML = '<p class="status">See brauser ei toeta teavitusi. iPhone\'is on vaja iOS 16.4 või uuemat.</p>'; return;
  }
  if (!CONFIG.vapidPublicKey) { box.innerHTML = '<p class="status">Teavituste võti on config.js failis puudu.</p>'; return; }
  const sub = await currentSub();
  const key = sub ? await subKey(sub.endpoint) : null;
  const on = sub && Notification.permission === 'granted' && subs[key];

  if (on) {
    box.innerHTML = `<p class="status on">Sees sellel seadmel. Teavitus tuleb uue osa ilmumise päeva hommikul.</p>
      <button class="btn ghost" id="test">Saada proovi-teavitus</button>
      <button class="btn danger" id="off">Lülita teavitused välja</button>`;
    box.querySelector('#test').onclick = async () => {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification('Sarjakell', { body: 'Teavitused töötavad.', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png' });
    };
    box.querySelector('#off').onclick = async () => {
      try { await api.removeSub(key); await sub.unsubscribe(); toast('Teavitused välja lülitatud'); }
      catch { toast('Ei õnnestunud'); }
      renderPush(box);
    };
    return;
  }
  if (Notification.permission === 'denied') {
    box.innerHTML = '<p class="status">Teavitused on keelatud. Luba need telefoni Seadetes: Teavitused → Sarjakell.</p>'; return;
  }
  box.innerHTML = '<p class="status">Väljas sellel seadmel.</p><button class="btn" id="on">Lülita teavitused sisse</button>';
  box.querySelector('#on').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Teavitused jäid lubamata'); return renderPush(box); }
      const reg = await navigator.serviceWorker.ready;
      let s = await reg.pushManager.getSubscription();
      if (!s) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CONFIG.vapidPublicKey) });
      const k = await subKey(s.endpoint);
      await api.update({ ['subs.' + k]: JSON.parse(JSON.stringify(s)) });
      toast('Teavitused sees');
    } catch (err) { console.error(err); toast('Teavituste sisselülitamine ebaõnnestus'); }
    renderPush(box);
  };
}

/* ---------- demoandmed (ainult ?demo) ---------- */
const iso = (dDays, hh = 21, mm = 0) => { const d = new Date(); d.setDate(d.getDate() + dDays); d.setHours(hh, mm, 0, 0); return d.toISOString(); };
const DEMO_SHOWS = [
  { id: 1, name: 'Põhjaranniku saladused', network: { name: 'ETV' }, status: 'Running', premiered: '2024-03-01', image: null,
    summary: '<p>Demo: kriminaalsari väikesest rannakülast.</p>', _embedded: { nextepisode: { id: 11, season: 2, number: 5, name: 'Tormi silm', airtime: '21:30', airstamp: iso(0, 21, 30) } } },
  { id: 2, name: 'Orbiit', webChannel: { name: 'Netflix' }, status: 'Running', premiered: '2025-01-10', image: null,
    summary: '<p>Demo: ulmesari kosmosejaamast.</p>', _embedded: { nextepisode: { id: 21, season: 3, number: 1, name: 'Uus algus', airtime: '', airstamp: iso(1, 10) } } },
  { id: 3, name: 'Köögisõjad', network: { name: 'TV3' }, status: 'Running', premiered: '2023-09-01', image: null,
    summary: '<p>Demo: kokandusvõistlus.</p>', _embedded: { nextepisode: { id: 31, season: 6, number: 9, name: '', airtime: '20:00', airstamp: iso(3, 20) } } },
  { id: 4, name: 'Vanad vennad', network: { name: 'BBC One' }, status: 'Ended', premiered: '2019-02-01', image: null, summary: '', _embedded: {} },
  { id: 5, name: 'Kõrgel taevas', webChannel: { name: 'HBO Max' }, status: 'To Be Determined', premiered: '2022-05-05', image: null, summary: '', _embedded: {} }
];
async function demoTv(path) {
  await sleep(150);
  const m = path.match(/^\/shows\/(\d+)/);
  if (m) return DEMO_SHOWS.find((s) => s.id === +m[1]);
  if (path.startsWith('/search/shows')) return DEMO_SHOWS.slice(0, 3).map((show) => ({ show }));
  return null;
}

boot();
