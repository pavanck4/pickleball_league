// CourtIQ v4 — clean rewrite
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, onSnapshot, collection, serverTimestamp, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDPDDpW7Hf0GqBuCXqvg9IeX9zVlaDOYeM",
  authDomain: "pikleball-scoreboard.firebaseapp.com",
  projectId: "pikleball-scoreboard",
  storageBucket: "pikleball-scoreboard.firebasestorage.app",
  messagingSenderId: "495511862752",
  appId: "1:495511862752:web:e479e2c24eb44b0e153f85"
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

// ── State ─────────────────────────────────────────────────────────────────────
let S = { mode: 'fixed', players: [], teams: [], rounds: 0, schedule: [], results: {} };
let activeRound = 0;
let leagueCode = null;
let adminPin = null;
let isAdmin = false;
let unsubscribe = null;
let toastTimer = null;
let isSaving = false;
let cachedGroups = [];

// ── Utilities ─────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = 'PK-';
  for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.background = type === 'success' ? '#1D9E75' : type === 'link' ? '#185FA5' : '#c0392b';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function setSyncStatus(s) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (s === 'synced') { el.className = 'sync-status synced'; el.textContent = '● Live'; }
  else if (s === 'saving') { el.className = 'sync-status saving'; el.textContent = '● Saving…'; }
  else if (s === 'error') { el.className = 'sync-status error'; el.textContent = '● Offline'; }
  else { el.className = 'sync-status'; el.textContent = ''; }
}

// ── Tab Navigation ────────────────────────────────────────────────────────────
function gotoTab(t, btn) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + t).classList.add('active');
  if (btn) btn.classList.add('active');
  else { const b = document.getElementById('nav-' + t); if (b) b.classList.add('active'); }
  if (t === 'standings') renderStandings();
  if (t === 'schedule') renderSchedule();
  if (t === 'history') loadHistory();
}

// ── Schedule Serialization ────────────────────────────────────────────────────
function serializeSchedule(schedule) {
  const obj = {};
  schedule.forEach((round, i) => { obj['r' + i] = round; });
  return obj;
}

function deserializeSchedule(obj, roundCount) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  const out = [];
  for (let i = 0; i < roundCount; i++) out.push(obj['r' + i] || []);
  return out;
}

function toFirestore(state) {
  return {
    mode: state.mode,
    players: state.players,
    teams: state.teams,
    rounds: state.rounds,
    schedule: serializeSchedule(state.schedule),
    results: state.results
  };
}

function fromFirestore(data) {
  return {
    mode: data.mode || 'fixed',
    players: data.players || [],
    teams: data.teams || [],
    rounds: data.rounds || 0,
    schedule: deserializeSchedule(data.schedule, data.rounds),
    results: data.results || {}
  };
}

// ── Standings Calculator ──────────────────────────────────────────────────────
function calcStandings(state) {
  if (state.mode === 'fixed') {
    const stats = state.teams.map(t => ({ name: t.name, players: t.players, wins: 0, losses: 0, pts: 0, scored: 0, conceded: 0, played: 0, diff: 0 }));
    state.schedule.forEach(r => r.forEach(m => {
      const res = state.results[m.id];
      if (!res || !res.done) return;
      const s1 = parseInt(res.s1), s2 = parseInt(res.s2);
      const st1 = stats[m.t1], st2 = stats[m.t2];
      if (!st1 || !st2) return;
      st1.played++; st2.played++;
      st1.scored += s1; st1.conceded += s2;
      st2.scored += s2; st2.conceded += s1;
      if (s1 > s2) { st1.wins++; st1.pts += 2; st2.losses++; }
      else { st2.wins++; st2.pts += 2; st1.losses++; }
    }));
    stats.forEach(s => s.diff = s.scored - s.conceded);
    return stats.sort((a, b) => b.pts - a.pts || b.diff - a.diff || b.scored - a.scored);
  } else {
    const stats = {};
    state.players.forEach((p, i) => { stats[i] = { name: p, wins: 0, losses: 0, pts: 0, scored: 0, conceded: 0, played: 0, diff: 0 }; });
    state.schedule.forEach(r => r.forEach(m => {
      const res = state.results[m.id];
      if (!res || !res.done) return;
      const s1 = parseInt(res.s1), s2 = parseInt(res.s2);
      (m.t1pair || []).forEach(p => { if (!stats[p]) return; stats[p].played++; stats[p].scored += s1; stats[p].conceded += s2; if (s1 > s2) { stats[p].wins++; stats[p].pts += 2; } else stats[p].losses++; });
      (m.t2pair || []).forEach(p => { if (!stats[p]) return; stats[p].played++; stats[p].scored += s2; stats[p].conceded += s1; if (s2 > s1) { stats[p].wins++; stats[p].pts += 2; } else stats[p].losses++; });
    }));
    return Object.values(stats).map(s => ({ ...s, diff: s.scored - s.conceded })).sort((a, b) => b.pts - a.pts || b.diff - a.diff || b.scored - a.scored);
  }
}

// ── Firebase: League ──────────────────────────────────────────────────────────
async function saveToFirebase() {
  if (!leagueCode || isSaving) return;
  isSaving = true;
  setSyncStatus('saving');
  try {
    const totalM = S.schedule.reduce((s, r) => s + r.length, 0);
    const doneM = Object.values(S.results).filter(r => r.done).length;
    const isComplete = doneM === totalM && totalM > 0;
    const standings = calcStandings(S);
    await setDoc(doc(db, 'leagues', leagueCode), {
      ...toFirestore(S), leagueCode, adminPin, isComplete, standings, updatedAt: serverTimestamp()
    }, { merge: true });
    setSyncStatus('synced');
    localStorage.setItem('pickleball_last_code', leagueCode);
    if (isComplete) {
      await saveToHistory(standings);
      showToast('🏆 League complete — saved to history!');
    } else {
      showToast('✓ Saved');
    }
  } catch (e) {
    setSyncStatus('error');
    showToast('Save failed', 'error');
    console.error(e);
  }
  isSaving = false;
}

function subscribeToLeague(code) {
  if (unsubscribe) unsubscribe();
  unsubscribe = onSnapshot(doc(db, 'leagues', code), snap => {
    if (!snap.exists() || isSaving) return;
    const data = snap.data();
    S = fromFirestore(data);
    adminPin = data.adminPin || null;
    renderSchedule();
    renderStandings();
    updateBanner();
    setSyncStatus('synced');
  }, err => { setSyncStatus('error'); console.error(err); });
}

async function joinLeague(silent) {
  const input = document.getElementById('join-code');
  const errEl = document.getElementById('join-err');
  const code = (input.value || '').trim().toUpperCase();
  if (errEl) errEl.textContent = '';
  if (!code) { if (errEl && !silent) errEl.textContent = 'Enter a league code.'; return; }
  try {
    const snap = await getDoc(doc(db, 'leagues', code));
    if (!snap.exists()) {
      if (!silent && errEl) errEl.textContent = 'No league found with code "' + code + '".';
      return;
    }
    const data = snap.data();
    S = fromFirestore(data);
    adminPin = data.adminPin || null;
    leagueCode = code;
    activeRound = 0;
    localStorage.setItem('pickleball_last_code', code);
    const saved = sessionStorage.getItem('pk_admin_' + code);
    setAdminMode(saved && saved === adminPin);
    showLeagueUI();
    subscribeToLeague(code);
    refreshPlayerInputs();
    renderSchedule();
    renderStandings();
    updateBanner();
    if (!silent) {
      gotoTab('schedule', document.getElementById('nav-schedule'));
      showToast('Joined ' + code, 'link');
    }
  } catch (e) {
    if (!silent && errEl) errEl.textContent = 'Connection error.';
    console.error(e);
  }
}

// ── Firebase: History ─────────────────────────────────────────────────────────
async function saveToHistory(standings) {
  if (!leagueCode) return;
  try {
    const ref = doc(db, 'history', leagueCode);
    const existing = await getDoc(ref);
    const data = { ...toFirestore(S), leagueCode, standings, isComplete: true, completedAt: serverTimestamp() };
    if (!existing.exists()) data.createdAt = serverTimestamp();
    await setDoc(ref, data, { merge: true });
  } catch (e) { console.error('History save error:', e); }
}

async function forceSaveHistory() {
  const standings = calcStandings(S);
  showToast('Saving…', 'link');
  await saveToHistory(standings);
  showToast('✓ Saved to history!');
}

async function loadHistory() {
  const cont = document.getElementById('history-list');
  if (!cont) return;
  cont.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const snap = await getDocs(query(collection(db, 'history'), orderBy('completedAt', 'desc')));
    if (snap.empty) { cont.innerHTML = '<p class="muted">No completed tournaments yet.</p>'; return; }
    cont.innerHTML = '';
    snap.forEach(d => cont.appendChild(buildHistoryCard(d.data())));
  } catch (e) {
    cont.innerHTML = '<p class="muted">Could not load history.</p>';
    console.error(e);
  }
}

function buildHistoryCard(d) {
  const sched = deserializeSchedule(d.schedule, d.rounds);
  const totalM = sched.reduce((s, r) => s + r.length, 0);
  const doneM = Object.values(d.results || {}).filter(r => r.done).length;
  const standings = d.standings || calcStandings({ ...d, schedule: sched });
  const top3 = standings.slice(0, 3);
  const medals = ['🥇', '🥈', '🥉'];
  const isFixed = d.mode === 'fixed';

  const card = document.createElement('div');
  card.className = 'history-card';

  const hdr = document.createElement('div');
  hdr.className = 'history-header';
  hdr.innerHTML = '<div><div class="history-date">' + formatDate(d.completedAt) + '</div>'
    + '<div class="history-meta"><span class="hbadge ' + (isFixed ? 'tag-fixed' : 'tag-rotate') + '">' + (isFixed ? 'Fixed' : 'Rotating') + '</span>'
    + '<span class="history-sub">' + (d.players || []).length + ' players · ' + d.rounds + ' rounds · ' + doneM + '/' + totalM + ' matches</span></div></div>'
    + '<span class="history-code">' + d.leagueCode + '</span>';
  card.appendChild(hdr);

  const podium = document.createElement('div');
  podium.className = 'history-podium';
  podium.innerHTML = top3.map((s, i) =>
    '<div class="podium-item"><span class="medal">' + medals[i] + '</span>'
    + '<span class="podium-name">' + s.name + '</span>'
    + '<span class="podium-pts">' + s.pts + ' pts</span>'
    + (isFixed && s.players ? '<span class="podium-players">' + s.players.join(' & ') + '</span>' : '')
    + '</div>'
  ).join('');
  card.appendChild(podium);

  const btn = document.createElement('button');
  btn.className = 'btn-expand';
  btn.textContent = 'View full standings ▾';
  card.appendChild(btn);

  const detail = document.createElement('div');
  detail.className = 'history-detail';
  detail.style.display = 'none';
  const ph = isFixed ? '<th>Players</th>' : '';
  const rows = standings.map((s, i) => {
    const rc = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
    const dc = s.diff >= 0 ? 'td-win' : 'td-loss';
    const pc = isFixed ? '<td class="td-muted">' + (s.players || []).join(' & ') + '</td>' : '';
    return '<tr><td><span class="rank-badge ' + rc + '">' + (i + 1) + '</span></td>'
      + '<td style="font-weight:500">' + s.name + '</td>' + pc
      + '<td>' + s.played + '</td><td class="td-win">' + s.wins + '</td><td class="td-loss">' + s.losses + '</td>'
      + '<td style="font-weight:500">' + s.pts + '</td>'
      + '<td class="' + dc + '">' + (s.diff >= 0 ? '+' : '') + s.diff + '</td>'
      + '<td>' + (s.scored || 0) + '</td></tr>';
  }).join('');
  detail.innerHTML = '<table class="stbl" style="margin-top:10px"><thead><tr><th>#</th><th>' + (isFixed ? 'Team' : 'Player') + '</th>' + ph + '<th>P</th><th>W</th><th>L</th><th>Pts</th><th>+/-</th><th>Scored</th></tr></thead><tbody>' + rows + '</tbody></table>';
  card.appendChild(detail);

  btn.addEventListener('click', () => {
    const open = detail.style.display !== 'none';
    detail.style.display = open ? 'none' : 'block';
    btn.textContent = open ? 'View full standings ▾' : 'Hide standings ▴';
  });

  return card;
}

// ── Firebase: Groups ──────────────────────────────────────────────────────────
async function loadGroupsFromFirebase() {
  // Show local cache immediately
  try {
    const local = JSON.parse(localStorage.getItem('courtiq_groups') || '[]');
    if (Array.isArray(local) && local.length) { cachedGroups = local; renderGroups(); }
  } catch (e) {}
  // Fetch from Firebase
  try {
    const snap = await getDoc(doc(db, 'groups', 'shared'));
    if (snap.exists() && Array.isArray(snap.data().list)) {
      cachedGroups = snap.data().list;
      localStorage.setItem('courtiq_groups', JSON.stringify(cachedGroups));
    }
  } catch (e) { console.error('Groups load error:', e); }
  renderGroups();
}

async function saveGroups(groups) {
  cachedGroups = groups;
  localStorage.setItem('courtiq_groups', JSON.stringify(groups));
  try {
    await setDoc(doc(db, 'groups', 'shared'), { list: groups, updatedAt: serverTimestamp() });
    return true;
  } catch (e) {
    console.error('Groups save error:', e);
    return false;
  }
}

async function saveCurrentAsGroup(editIdx) {
  const n = parseInt(document.getElementById('inp-n').value) || 6;
  const players = [];
  for (let i = 0; i < n; i++) {
    const v = (document.getElementById('pi' + i)?.value || '').trim();
    if (v) players.push(v);
  }
  if (players.length < 4) { showToast('Enter at least 4 player names first', 'error'); return; }
  const def = editIdx !== undefined ? cachedGroups[editIdx]?.name || '' : '';
  const name = prompt(editIdx !== undefined ? 'Rename group:' : 'Name this group:', def);
  if (!name?.trim()) return;
  const groups = [...cachedGroups];
  const entry = { name: name.trim(), players, savedAt: new Date().toISOString() };
  if (editIdx !== undefined) groups[editIdx] = entry;
  else groups.unshift(entry);
  const ok = await saveGroups(groups.slice(0, 10));
  renderGroups();
  showToast(ok ? '✓ Group saved & synced!' : 'Saved locally only', ok ? 'success' : 'error');
}

function loadGroup(idx) {
  const g = cachedGroups[idx];
  if (!g) return;
  const n = g.players.length % 2 === 0 ? g.players.length : g.players.length + 1;
  document.getElementById('inp-n').value = n;
  refreshPlayerInputs(g.players);
  showToast('Loaded: ' + g.name, 'link');
}

async function deleteGroup(idx) {
  if (!confirm('Delete group "' + (cachedGroups[idx]?.name) + '"?')) return;
  const groups = [...cachedGroups];
  groups.splice(idx, 1);
  await saveGroups(groups);
  renderGroups();
  showToast('Group deleted');
}

function editGroup(idx) {
  saveCurrentAsGroup(idx);
}

function renderGroups() {
  const wrap = document.getElementById('groups-wrap');
  const chips = document.getElementById('groups-chips');
  if (!wrap || !chips) return;
  if (!cachedGroups.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  chips.innerHTML = cachedGroups.map((g, i) =>
    '<div class="group-chip">'
    + '<button class="group-chip-load" onclick="loadGroup(' + i + ')">'
    + '<span class="group-chip-name">' + g.name + '</span>'
    + '<span class="group-chip-count">' + g.players.length + ' players</span>'
    + '</button>'
    + '<div class="group-chip-actions">'
    + '<button class="group-action-btn edit" onclick="editGroup(' + i + ')" title="Edit">✏️</button>'
    + '<button class="group-action-btn delete" onclick="deleteGroup(' + i + ')" title="Delete">✕</button>'
    + '</div></div>'
  ).join('');
}

// ── PIN Modal ─────────────────────────────────────────────────────────────────
function showPinModal(mode, onSuccess) {
  const overlay = document.getElementById('pin-overlay');
  const title = document.getElementById('pin-modal-title');
  const desc = document.getElementById('pin-modal-desc');
  const input = document.getElementById('pin-input');
  const errEl = document.getElementById('pin-err');
  title.textContent = mode === 'create' ? 'Set admin PIN' : 'Enter admin PIN';
  desc.textContent = mode === 'create' ? 'Create a 4-digit PIN. Share it with players who can enter scores.' : 'Enter the 4-digit PIN to unlock score entry.';
  input.value = '';
  errEl.textContent = '';
  overlay.style.display = 'flex';
  setTimeout(() => input.focus(), 100);
  document.getElementById('pin-confirm-btn').onclick = () => {
    const val = input.value.trim();
    if (!/^\d{4}$/.test(val)) { errEl.textContent = 'PIN must be 4 digits.'; return; }
    overlay.style.display = 'none';
    onSuccess(val);
  };
  document.getElementById('pin-cancel-btn').onclick = () => { overlay.style.display = 'none'; };
  input.onkeydown = e => { if (e.key === 'Enter') document.getElementById('pin-confirm-btn').click(); };
}

function promptAdminPin() {
  if (!leagueCode || !adminPin) return;
  showPinModal('enter', val => {
    if (val === adminPin) {
      setAdminMode(true);
      sessionStorage.setItem('pk_admin_' + leagueCode, val);
      showToast('Admin access granted!');
    } else {
      showToast('Incorrect PIN', 'error');
    }
  });
}

function setAdminMode(val) {
  isAdmin = val;
  const badge = document.getElementById('admin-badge');
  if (badge) badge.style.display = val ? '' : 'none';
  if (S.schedule.length) renderSchedule();
}

// ── League Setup ──────────────────────────────────────────────────────────────
function selectMode(m) {
  S.mode = m;
  document.getElementById('mc-fixed').classList.toggle('selected', m === 'fixed');
  document.getElementById('mc-rotate').classList.toggle('selected', m === 'rotate');
  refreshPlayerInputs();
}

function refreshPlayerInputs(preload) {
  let n = parseInt(document.getElementById('inp-n').value) || 6;
  if (n % 2 !== 0) n++;
  n = Math.max(4, Math.min(20, n));
  const cont = document.getElementById('player-inputs');
  if (!cont) return;
  // Only carry over existing values if a group is being loaded (preload provided)
  // Otherwise keep whatever is already typed (e.g. when switching mode or changing count)
  const existing = preload || Array.from(cont.querySelectorAll('input[type=text]')).map(i => i.value);
  cont.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.className = 'player-row';
    const lbl = S.mode === 'fixed' ? '<span class="team-label">Team ' + (Math.floor(i / 2) + 1) + '</span>' : '';
    // Only pre-fill if preload was given (loading a group), otherwise empty
    const val = preload ? (existing[i] || '') : (existing[i] || '');
    row.innerHTML = '<span class="player-num">' + (i + 1) + '</span><input type="text" placeholder="Player ' + (i + 1) + '" value="' + val + '" id="pi' + i + '">' + lbl;
    cont.appendChild(row);
  }
}

function showLeagueUI() {
  document.getElementById('reset-btn').style.display = '';
  document.getElementById('saved-banner').style.display = '';
  document.getElementById('share-box').style.display = '';
  document.getElementById('league-code-display').textContent = leagueCode;
  setSyncStatus('synced');
  updateBanner();
}

function updateBanner() {
  const total = S.schedule.reduce((s, r) => s + r.length, 0);
  const done = Object.values(S.results).filter(r => r.done).length;
  const el = document.getElementById('saved-banner-text');
  if (el) el.textContent = 'League ' + leagueCode + ' · ' + done + '/' + total + ' matches · live sync';
}

function copyCode() {
  navigator.clipboard.writeText(leagueCode).catch(() => {});
  showToast('Code copied!', 'link');
}

function confirmReset() {
  if (!isAdmin) { showToast('Admin PIN required', 'error'); return; }
  if (!confirm('Reset the league? All scores will be cleared.')) return;
  if (unsubscribe) unsubscribe();
  leagueCode = null; adminPin = null;
  S = { mode: 'fixed', players: [], teams: [], rounds: 0, schedule: [], results: {} };
  activeRound = 0;
  localStorage.removeItem('pickleball_last_code');
  document.getElementById('reset-btn').style.display = 'none';
  document.getElementById('saved-banner').style.display = 'none';
  document.getElementById('share-box').style.display = 'none';
  document.getElementById('join-code').value = '';
  setSyncStatus('');
  setAdminMode(false);
  clearPlayerInputs();
  document.getElementById('matches-list').innerHTML = '';
  document.getElementById('standings-body').innerHTML = '';
  gotoTab('setup', document.getElementById('nav-setup'));
}

// ── League Generation ─────────────────────────────────────────────────────────
function generateLeague() {
  const n = parseInt(document.getElementById('inp-n').value) || 6;
  const rounds = parseInt(document.getElementById('inp-r').value) || 3;
  const errEl = document.getElementById('setup-err');
  errEl.textContent = '';
  if (n < 4 || n % 2 !== 0) { errEl.textContent = 'Need an even number of players (min 4).'; return; }
  if (rounds < 1) { errEl.textContent = 'Need at least 1 round.'; return; }
  showPinModal('create', async pin => {
    const players = [];
    for (let i = 0; i < n; i++) players.push((document.getElementById('pi' + i)?.value || '').trim() || 'Player ' + (i + 1));
    S.players = players; S.rounds = rounds; S.results = {};
    if (S.mode === 'fixed') generateFixed(players, rounds);
    else generateRotating(players, rounds);
    activeRound = 0;
    adminPin = pin;
    leagueCode = generateCode();
    setAdminMode(true);
    sessionStorage.setItem('pk_admin_' + leagueCode, pin);
    showLeagueUI();
    await saveToFirebase();
    subscribeToLeague(leagueCode);
    renderSchedule();
    renderStandings();
    gotoTab('schedule', document.getElementById('nav-schedule'));
  });
}

function generateFixed(players, rounds) {
  const shuffled = shuffle(players);
  const teams = [];
  for (let i = 0; i < shuffled.length; i += 2)
    teams.push({ id: i / 2, name: 'T' + (i / 2 + 1), players: [shuffled[i], shuffled[i + 1]] });
  S.teams = teams;
  S.schedule = buildRRSchedule(teams.map(t => t.id), rounds);
  S.schedule.forEach(r => r.forEach(m => { S.results[m.id] = { s1: '', s2: '', done: false }; }));
}

function generateRotating(players, rounds) {
  S.teams = players.map((p, i) => ({ id: i, name: p, players: [p] }));
  S.schedule = buildRotatingSchedule(players, rounds);
  S.schedule.forEach(r => r.forEach(m => { S.results[m.id] = { s1: '', s2: '', done: false }; }));
}

function buildRRSchedule(ids, rounds) {
  const schedule = [], history = new Set();
  for (let r = 0; r < rounds; r++) {
    const used = new Set(), matches = [], order = shuffle([...ids]);
    for (let i = 0; i < order.length; i++) {
      if (used.has(order[i])) continue;
      const a = order[i];
      const newOpp = order.filter(x => x !== a && !used.has(x) && !history.has(Math.min(a,x)+'-'+Math.max(a,x)));
      const anyOpp = order.filter(x => x !== a && !used.has(x));
      const pool = newOpp.length ? newOpp : anyOpp;
      if (!pool.length) continue;
      const b = pool[Math.floor(Math.random() * pool.length)];
      used.add(a); used.add(b);
      history.add(Math.min(a,b)+'-'+Math.max(a,b));
      matches.push({ id: 'r'+r+'m'+matches.length, round: r, t1: a, t2: b, type: 'fixed' });
    }
    schedule.push(matches);
  }
  return schedule;
}

function buildRotatingSchedule(players, rounds) {
  const n = players.length, schedule = [], history = new Set();
  for (let r = 0; r < rounds; r++) {
    const shuffled = shuffle([...Array(n).keys()]);
    const pairs = [];
    for (let i = 0; i < shuffled.length; i += 2)
      if (shuffled[i+1] !== undefined) pairs.push([shuffled[i], shuffled[i+1]]);
    const used = new Set(), matches = [], pOrder = shuffle([...Array(pairs.length).keys()]);
    for (let i = 0; i < pOrder.length; i++) {
      if (used.has(pOrder[i])) continue;
      const pi = pOrder[i], pa = pairs[pi];
      let pb = -1;
      const others = pOrder.filter(j => j !== pi && !used.has(j));
      for (const j of shuffle(others)) {
        const key = [...pa].sort().join(',')+'_'+[...pairs[j]].sort().join(',');
        if (!history.has(key)) { pb = j; break; }
      }
      if (pb === -1 && others.length) pb = others[0];
      if (pb !== -1) {
        const ppb = pairs[pb];
        history.add([...pa].sort().join(',')+'_'+[...ppb].sort().join(','));
        used.add(pi); used.add(pb);
        matches.push({ id: 'r'+r+'m'+matches.length, round: r, t1pair: pa, t2pair: ppb, type: 'rotate' });
      }
    }
    schedule.push(matches);
  }
  return schedule;
}

// ── Score Entry ───────────────────────────────────────────────────────────────
function getTeamLabel(match, side) {
  if (match.type === 'rotate') {
    const pair = side === 1 ? match.t1pair : match.t2pair;
    return { name: (S.players[pair[0]]||'').split(' ')[0] + ' & ' + (S.players[pair[1]]||'').split(' ')[0], players: [S.players[pair[0]], S.players[pair[1]]] };
  }
  const t = S.teams[side === 1 ? match.t1 : match.t2];
  return { name: t.name, players: t.players };
}

function getWinner(mid) {
  const res = S.results[mid];
  if (!res || !res.done) return 0;
  const s1 = parseInt(res.s1), s2 = parseInt(res.s2);
  if (isNaN(s1) || isNaN(s2)) return 0;
  if (Math.max(s1, s2) >= 11 && Math.abs(s1 - s2) >= 2) return s1 > s2 ? 1 : 2;
  return 0;
}

function validateScore(s1, s2) {
  if (isNaN(s1) || isNaN(s2) || s1 < 0 || s2 < 0) return 'Enter valid scores.';
  if (s1 === s2) return 'Scores cannot be tied.';
  if (Math.max(s1, s2) < 11) return 'Winner needs at least 11 pts.';
  if (Math.abs(s1 - s2) < 2) return 'Need a 2-point lead.';
  return null;
}

async function submitScore(mid) {
  if (!isAdmin) { showToast('Enter PIN to add scores', 'error'); promptAdminPin(); return; }
  const s1 = parseInt(document.getElementById('s1-' + mid)?.value);
  const s2 = parseInt(document.getElementById('s2-' + mid)?.value);
  const err = validateScore(s1, s2);
  if (err) { document.getElementById('err-' + mid).textContent = err; return; }
  S.results[mid] = { s1, s2, done: true };
  updateBanner();
  await saveToFirebase();
  renderSchedule();
}

// ── Render: Schedule ──────────────────────────────────────────────────────────
function renderSchedule() {
  const tabs = document.getElementById('round-tabs');
  if (!tabs) return;
  tabs.innerHTML = '';
  S.schedule.forEach((_, ri) => {
    const b = document.createElement('button');
    b.className = 'rtab' + (ri === activeRound ? ' active' : '');
    b.textContent = 'Round ' + (ri + 1);
    b.onclick = () => { activeRound = ri; renderSchedule(); };
    tabs.appendChild(b);
  });

  const cont = document.getElementById('matches-list');
  if (!cont) return;
  cont.innerHTML = '';
  const round = S.schedule[activeRound];
  if (!round || !round.length) { cont.innerHTML = '<p class="muted">No matches this round.</p>'; return; }

  const bar = document.createElement('div');
  bar.className = 'access-bar ' + (isAdmin ? 'admin' : 'viewer');
  bar.innerHTML = isAdmin
    ? '🔓 Admin — you can enter scores'
    : '👁 View only — <button class="btn-unlock" onclick="promptAdminPin()">Enter PIN to add scores</button>';
  cont.appendChild(bar);

  const note = document.createElement('div');
  note.className = S.mode === 'rotate' ? 'warn-box' : 'info-box';
  note.textContent = S.mode === 'rotate' ? 'Rotating partners — new pairs each round.' : 'Fixed partners — same teams throughout.';
  cont.appendChild(note);

  round.forEach(match => {
    const res = S.results[match.id] || { s1: '', s2: '', done: false };
    const t1 = getTeamLabel(match, 1), t2 = getTeamLabel(match, 2);
    const winner = getWinner(match.id);
    const mc = document.createElement('div');
    mc.className = 'match-card';
    const scoreSection = isAdmin && !res.done
      ? '<div class="score-row">'
        + '<span class="score-label">' + t1.name + '</span>'
        + '<input type="number" class="score-inp" min="0" max="99" value="' + res.s1 + '" placeholder="0" id="s1-' + match.id + '" oninput="S.results[\'' + match.id + '\'].s1=this.value;document.getElementById(\'err-' + match.id + '\').textContent=\'\';">'
        + '<span class="score-sep">—</span>'
        + '<input type="number" class="score-inp" min="0" max="99" value="' + res.s2 + '" placeholder="0" id="s2-' + match.id + '" oninput="S.results[\'' + match.id + '\'].s2=this.value;document.getElementById(\'err-' + match.id + '\').textContent=\'\';">'
        + '<span class="score-label">' + t2.name + '</span>'
        + '<button class="btn-save" onclick="submitScore(\'' + match.id + '\')">save</button>'
        + '</div><div id="err-' + match.id + '" class="match-err"></div>'
      : res.done
        ? '<div class="score-display"><span class="score-num ' + (winner===1?'score-win':'') + '">' + res.s1 + '</span><span class="score-sep-display">—</span><span class="score-num ' + (winner===2?'score-win':'') + '">' + res.s2 + '</span></div>'
        : '<div class="score-pending-msg">Score not entered yet</div>';
    mc.innerHTML = '<div class="match-header"><span class="match-label">Match · ' + match.id + '</span><span class="pill ' + (res.done?'pill-done':'pill-pend') + '">' + (res.done?'completed':'pending') + '</span></div>'
      + '<div class="match-grid"><div class="team-box"><div class="team-name">' + t1.name + ' ' + (winner===1?'<span class="win-tag">winner</span>':'') + '</div><div class="team-players">' + t1.players.join(' & ') + '</div></div>'
      + '<div class="vs-label">vs</div>'
      + '<div class="team-box right"><div class="team-name">' + (winner===2?'<span class="win-tag">winner</span>':'') + ' ' + t2.name + '</div><div class="team-players">' + t2.players.join(' & ') + '</div></div></div>'
      + scoreSection;
    cont.appendChild(mc);
  });
}

// ── Render: Standings ─────────────────────────────────────────────────────────
function renderStandings() {
  const cont = document.getElementById('standings-body');
  if (!cont) return;
  if (!S.teams.length) { cont.innerHTML = '<p class="muted">Generate a league first.</p>'; return; }
  const totalM = S.schedule.reduce((s, r) => s + r.length, 0);
  const doneM = Object.values(S.results).filter(r => r.done).length;
  const allDone = doneM === totalM && totalM > 0;
  const standings = calcStandings(S);
  const isFixed = S.mode === 'fixed';

  if (allDone && leagueCode) saveToHistory(standings);

  const ph = isFixed ? '<th>Players</th>' : '';
  const rows = standings.map((s, i) => {
    const rc = i===0?'r1':i===1?'r2':i===2?'r3':'';
    const dc = s.diff >= 0 ? 'td-win' : 'td-loss';
    const pc = isFixed ? '<td class="td-muted">' + (s.players||[]).join(' & ') + '</td>' : '';
    return '<tr><td><span class="rank-badge ' + rc + '">' + (i+1) + '</span></td><td style="font-weight:500">' + s.name + '</td>' + pc
      + '<td>' + s.played + '</td><td class="td-win">' + s.wins + '</td><td class="td-loss">' + s.losses + '</td>'
      + '<td style="font-weight:500">' + s.pts + '</td><td class="' + dc + '">' + (s.diff>=0?'+':'') + s.diff + '</td><td>' + (s.scored||0) + '</td></tr>';
  }).join('');

  cont.innerHTML = '<div class="grid4">'
    + '<div class="metric"><div class="metric-val">' + (isFixed?S.teams.length:S.players.length) + '</div><div class="metric-lbl">' + (isFixed?'Teams':'Players') + '</div></div>'
    + '<div class="metric"><div class="metric-val">' + S.rounds + '</div><div class="metric-lbl">Rounds</div></div>'
    + '<div class="metric"><div class="metric-val">' + doneM + '/' + totalM + '</div><div class="metric-lbl">Done</div></div>'
    + '<div class="metric"><div class="metric-val">' + (allDone?'Final':'Live') + '</div><div class="metric-lbl">Status</div></div>'
    + '</div>'
    + (!isFixed ? '<div class="warn-box">Rotating partners — individual rankings.</div>' : '')
    + (allDone ? '<div class="info-box" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">🏆 All matches complete!<button onclick="forceSaveHistory()" style="background:#185FA5;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer;font-family:inherit;">Save to History</button></div>' : '')
    + '<div class="card" style="padding:0;overflow:hidden;"><div class="standings-wrap"><table class="stbl">'
    + '<thead><tr><th>#</th><th>' + (isFixed?'Team':'Player') + '</th>' + ph + '<th>P</th><th>W</th><th>L</th><th>Pts</th><th>+/-</th><th>Scored</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div></div>'
    + '<p class="tiebreak-note">Tiebreakers: league points → score diff → total scored</p>';
}

// ── Expose globals ────────────────────────────────────────────────────────────
window.gotoTab = gotoTab;
window.selectMode = selectMode;
window.refreshPlayerInputs = refreshPlayerInputs;
window.generateLeague = generateLeague;
window.joinLeague = joinLeague;
window.submitScore = submitScore;
window.confirmReset = confirmReset;
window.copyCode = copyCode;
window.promptAdminPin = promptAdminPin;
window.forceSaveHistory = forceSaveHistory;
window.saveCurrentAsGroup = saveCurrentAsGroup;
window.loadGroup = loadGroup;
window.deleteGroup = deleteGroup;
window.editGroup = editGroup;
window.loadGroupsFromFirebase = loadGroupsFromFirebase;
window.clearPlayerInputs = clearPlayerInputs;
window.S = S;

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  // Start with empty player inputs
  clearPlayerInputs();
  await loadGroupsFromFirebase();
  const lastCode = localStorage.getItem('pickleball_last_code');
  if (lastCode) {
    document.getElementById('join-code').value = lastCode;
    await joinLeague(true);
  }
}

function clearPlayerInputs() {
  let n = parseInt(document.getElementById('inp-n').value) || 6;
  if (n % 2 !== 0) n++;
  n = Math.max(4, Math.min(20, n));
  const cont = document.getElementById('player-inputs');
  if (!cont) return;
  cont.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.className = 'player-row';
    const lbl = S.mode === 'fixed' ? '<span class="team-label">Team ' + (Math.floor(i / 2) + 1) + '</span>' : '';
    row.innerHTML = '<span class="player-num">' + (i + 1) + '</span><input type="text" placeholder="Player ' + (i + 1) + '" value="" id="pi' + i + '">' + lbl;
    cont.appendChild(row);
  }
}

init();
