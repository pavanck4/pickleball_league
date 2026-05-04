// CourtIQ v5 — Google Auth + Player Profiles + Personal Schedule
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, onSnapshot, collection, serverTimestamp, query, orderBy, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, onValue, set, onDisconnect, serverTimestamp as rtServerTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: window.__env?.FIREBASE_API_KEY,
  authDomain: "pikleball-scoreboard.firebaseapp.com",
  projectId: "pikleball-scoreboard",
  storageBucket: "pikleball-scoreboard.firebasestorage.app",
  messagingSenderId: "495511862752",
  appId: "1:495511862752:web:e479e2c24eb44b0e153f85",
  databaseURL: "https://pikleball-scoreboard-default-rtdb.firebaseio.com"
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
const rtdb = getDatabase(fbApp);
const auth = getAuth(fbApp);
const provider = new GoogleAuthProvider();

// Only this email can see the Players tab
const ADMIN_EMAIL = 'pavanck4@gmail.com';
function isAppAdmin() { return currentUser?.email === ADMIN_EMAIL; }

// ── State ─────────────────────────────────────────────────────────────────────
let S = { mode: 'fixed', players: [], teams: [], rounds: 0, schedule: [], results: {} };
let activeRound = 0;
let leagueCode = null;
let currentUser = null;
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

// ── Auth ──────────────────────────────────────────────────────────────────────
async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, provider);
    currentUser = result.user;
    await saveUserProfile(currentUser);
    showToast('Welcome ' + currentUser.displayName + '!');
  } catch (e) {
    showToast('Login failed — ' + e.message, 'error');
    console.error(e);
  }
}

async function logout() {
  await signOut(auth);
  currentUser = null;
  showToast('Logged out');
}

async function saveUserProfile(user) {
  // Save to Firestore
  const userRef = doc(db, 'users', user.uid);
  await setDoc(userRef, {
    uid: user.uid,
    name: user.displayName,
    email: user.email,
    photo: user.photoURL,
    lastSeen: serverTimestamp(),
    createdAt: serverTimestamp()
  }, { merge: true });

  // Set up Realtime Database presence
  const presenceRef = ref(rtdb, 'presence/' + user.uid);
  const connectedRef = ref(rtdb, '.info/connected');
  onValue(connectedRef, snap => {
    if (snap.val() === true) {
      set(presenceRef, {
        online: true,
        name: user.displayName,
        photo: user.photoURL,
        uid: user.uid,
        lastSeen: rtServerTimestamp()
      });
      onDisconnect(presenceRef).set({
        online: false,
        name: user.displayName,
        photo: user.photoURL,
        uid: user.uid,
        lastSeen: rtServerTimestamp()
      });
    }
  });
}

function renderAuthUI(user) {
  const authBtn = document.getElementById('auth-btn');
  const loginWall = document.getElementById('login-wall');
  const mainApp = document.getElementById('main-app');
  const usersNav = document.getElementById('nav-users');

  if (user) {
    if (loginWall) loginWall.style.display = 'none';
    if (mainApp) mainApp.style.display = '';
    if (authBtn) {
      authBtn.innerHTML = '<img src="' + (user.photoURL || '') + '" class="user-avatar"><span>' + (user.displayName || '').split(' ')[0] + '</span>';
      authBtn.onclick = () => gotoTab('profile', null);
    }
    // Show Players tab to all logged in users, but content is admin-only
    if (usersNav) usersNav.style.display = '';
  } else {
    if (loginWall) loginWall.style.display = '';
    if (mainApp) mainApp.style.display = 'none';
    if (authBtn) {
      authBtn.innerHTML = 'Sign in';
      authBtn.onclick = loginWithGoogle;
    }
    if (usersNav) usersNav.style.display = 'none';
  }
}

// ── Tab Navigation ────────────────────────────────────────────────────────────
function gotoTab(t, btn) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const tabEl = document.getElementById('tab-' + t);
  if (tabEl) tabEl.classList.add('active');
  if (btn) btn.classList.add('active');
  else { const b = document.getElementById('nav-' + t); if (b) b.classList.add('active'); }
  if (t === 'standings') renderStandings();
  if (t === 'schedule') renderSchedule();
  if (t === 'history') loadHistory();
  if (t === 'profile') renderProfile();
  if (t === 'myschedule') renderMySchedule();
  if (t === 'users') renderUsers();
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
      ...toFirestore(S), leagueCode, isComplete, standings,
      createdBy: currentUser?.uid,
      members: S.players,
      updatedAt: serverTimestamp()
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
    renderSchedule();
    renderStandings();
    updateBanner();
    setSyncStatus('synced');
  }, err => { setSyncStatus('error'); console.error(err); });
}

async function joinLeague(silent) {
  const input = document.getElementById('join-code');
  const errEl = document.getElementById('join-err');
  const code = (input?.value || '').trim().toUpperCase();
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
    leagueCode = code;
    activeRound = 0;
    localStorage.setItem('pickleball_last_code', code);

    // Register this user as a member
    if (currentUser) {
      await setDoc(doc(db, 'leagues', code), {
        memberUids: { [currentUser.uid]: { name: currentUser.displayName, joinedAt: serverTimestamp() } }
      }, { merge: true });
    }

    showLeagueUI();
    subscribeToLeague(code);
    clearPlayerInputs();
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
    const data = { ...toFirestore(S), leagueCode, standings, isComplete: true, completedAt: serverTimestamp(), createdBy: currentUser?.uid };
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

// ── Users Dashboard ──────────────────────────────────────────────────────────
async function renderUsers() {
  const cont = document.getElementById('users-body');
  if (!cont) return;
  if (!isAppAdmin()) {
    cont.innerHTML = '<div class="warn-box">⛔ Admin access only.<br><small>Your email: ' + (currentUser?.email || 'not logged in') + '</small></div>';
    return;
  }
  cont.innerHTML = '<p class="muted">Loading users…</p>';

  try {
    // Load all enrolled users from Firestore
    const usersSnap = await getDocs(collection(db, 'users'));
    const users = [];
    usersSnap.forEach(d => users.push(d.data()));
    users.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    // Listen to presence from Realtime Database
    const presenceRef = ref(rtdb, 'presence');
    onValue(presenceRef, presSnap => {
      const presence = presSnap.val() || {};
      const onlineCount = Object.values(presence).filter(p => p.online).length;

      cont.innerHTML = `
        <div class="grid4" style="margin-bottom:1.25rem;">
          <div class="metric"><div class="metric-val">${users.length}</div><div class="metric-lbl">Enrolled</div></div>
          <div class="metric"><div class="metric-val" style="color:#1D9E75;">${onlineCount}</div><div class="metric-lbl">Online now</div></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${users.map(u => {
            const isOnline = presence[u.uid]?.online === true;
            return `
              <div class="card" style="padding:12px 16px;display:flex;align-items:center;gap:12px;">
                <div style="position:relative;flex-shrink:0;">
                  <img src="${u.photo || ''}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none'">
                  <div style="position:absolute;bottom:0;right:0;width:11px;height:11px;border-radius:50%;background:${isOnline?'#1D9E75':'#ccc'};border:2px solid white;"></div>
                </div>
                <div style="flex:1;">
                  <div style="font-size:14px;font-weight:500;">${u.name || 'Unknown'}</div>
                  <div style="font-size:12px;color:var(--text-secondary);">${u.email || ''}</div>
                </div>
                <div style="text-align:right;">
                  <span class="pill ${isOnline?'pill-done':'pill-pend'}" style="font-size:11px;">${isOnline?'● Online':'Offline'}</span>
                  <div style="font-size:11px;color:var(--text-tertiary);margin-top:3px;">${u.createdAt ? 'Joined ' + formatDate(u.createdAt) : ''}</div>
                </div>
              </div>`;
          }).join('')}
        </div>`;
    });
  } catch (e) {
    cont.innerHTML = '<p class="muted">Could not load users.</p>';
    console.error(e);
  }
}

// ── Firebase: Player Profile ──────────────────────────────────────────────────
async function renderProfile() {
  const cont = document.getElementById('profile-body');
  if (!cont || !currentUser) return;

  cont.innerHTML = '<p class="muted">Loading profile…</p>';

  try {
    // Load all history and calculate stats for this user
    const snap = await getDocs(query(collection(db, 'history'), orderBy('completedAt', 'desc')));
    let totalWins = 0, totalLosses = 0, totalPts = 0, totalScored = 0, tournaments = 0;
    let bestFinish = null;
    const recentTournaments = [];

    snap.forEach(docSnap => {
      const d = docSnap.data();
      const playerName = currentUser.displayName?.split(' ')[0];
      // Find this player in standings
      const standings = d.standings || [];
      const idx = standings.findIndex(s =>
        s.name?.toLowerCase() === playerName?.toLowerCase() ||
        (d.players || []).some(p => p?.toLowerCase() === playerName?.toLowerCase())
      );
      if (idx === -1) return;
      const s = standings[idx];
      if (!s) return;
      tournaments++;
      totalWins += s.wins || 0;
      totalLosses += s.losses || 0;
      totalPts += s.pts || 0;
      totalScored += s.scored || 0;
      if (bestFinish === null || idx + 1 < bestFinish) bestFinish = idx + 1;
      recentTournaments.push({ date: formatDate(d.completedAt), rank: idx + 1, total: standings.length, pts: s.pts, wins: s.wins, losses: s.losses, code: d.leagueCode });
    });

    const winRate = totalWins + totalLosses > 0 ? Math.round((totalWins / (totalWins + totalLosses)) * 100) : 0;
    const medals = ['🥇', '🥈', '🥉'];

    cont.innerHTML = `
      <div class="profile-hero">
        <img src="${currentUser.photoURL || ''}" class="profile-avatar" onerror="this.style.display='none'">
        <div class="profile-info">
          <div class="profile-name">${currentUser.displayName || 'Player'}</div>
          <div class="profile-email">${currentUser.email || ''}</div>
          <button class="btn-outline" style="margin-top:8px;padding:5px 14px;font-size:12px;" onclick="logout()">Sign out</button>
        </div>
      </div>

      <div class="grid4" style="margin-top:1.25rem;">
        <div class="metric"><div class="metric-val">${tournaments}</div><div class="metric-lbl">Tournaments</div></div>
        <div class="metric"><div class="metric-val">${winRate}%</div><div class="metric-lbl">Win rate</div></div>
        <div class="metric"><div class="metric-val">${totalWins}W ${totalLosses}L</div><div class="metric-lbl">Record</div></div>
        <div class="metric"><div class="metric-val">${bestFinish ? (medals[bestFinish-1] || '#'+bestFinish) : '—'}</div><div class="metric-lbl">Best finish</div></div>
      </div>

      <h3 style="margin:1.25rem 0 10px;">Recent tournaments</h3>
      ${recentTournaments.length === 0 ? '<p class="muted">No tournaments found. Make sure your player name matches your Google name.</p>' : ''}
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${recentTournaments.map(t => `
          <div class="card" style="padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div>
              <div style="font-size:13px;font-weight:500;">${t.date}</div>
              <div style="font-size:12px;color:var(--text-secondary);">${t.code} · Rank #${t.rank} of ${t.total}</div>
            </div>
            <div style="display:flex;gap:12px;align-items:center;">
              <span style="font-size:13px;color:#0F6E56;font-weight:500;">${t.wins}W ${t.losses}L</span>
              <span style="font-size:13px;font-weight:500;">${t.pts} pts</span>
              <span style="font-size:18px;">${t.rank === 1 ? '🥇' : t.rank === 2 ? '🥈' : t.rank === 3 ? '🥉' : ''}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    cont.innerHTML = '<p class="muted">Could not load profile.</p>';
    console.error(e);
  }
}

// ── Personal Schedule ─────────────────────────────────────────────────────────
function renderMySchedule() {
  const cont = document.getElementById('myschedule-body');
  if (!cont || !currentUser || !S.schedule.length) {
    if (cont) cont.innerHTML = '<p class="muted">Join a league first to see your schedule.</p>';
    return;
  }

  const myName = currentUser.displayName?.split(' ')[0]?.toLowerCase();
  const matches = [];

  S.schedule.forEach((round, ri) => {
    round.forEach(match => {
      let isMyMatch = false;
      let myTeam = null, oppTeam = null;

      if (match.type === 'fixed') {
        const t1 = S.teams[match.t1], t2 = S.teams[match.t2];
        const inT1 = t1?.players?.some(p => p?.toLowerCase().startsWith(myName));
        const inT2 = t2?.players?.some(p => p?.toLowerCase().startsWith(myName));
        if (inT1) { isMyMatch = true; myTeam = t1; oppTeam = t2; }
        if (inT2) { isMyMatch = true; myTeam = t2; oppTeam = t1; }
      } else {
        const p1 = (match.t1pair || []).map(i => S.players[i]);
        const p2 = (match.t2pair || []).map(i => S.players[i]);
        const inP1 = p1.some(p => p?.toLowerCase().startsWith(myName));
        const inP2 = p2.some(p => p?.toLowerCase().startsWith(myName));
        if (inP1) { isMyMatch = true; myTeam = { name: p1.map(p=>p?.split(' ')[0]).join(' & '), players: p1 }; oppTeam = { name: p2.map(p=>p?.split(' ')[0]).join(' & '), players: p2 }; }
        if (inP2) { isMyMatch = true; myTeam = { name: p2.map(p=>p?.split(' ')[0]).join(' & '), players: p2 }; oppTeam = { name: p1.map(p=>p?.split(' ')[0]).join(' & '), players: p1 }; }
      }

      if (isMyMatch) {
        const res = S.results[match.id] || {};
        matches.push({ round: ri + 1, match, myTeam, oppTeam, res });
      }
    });
  });

  if (matches.length === 0) {
    cont.innerHTML = '<div class="info-box">Your name wasn\'t found in this league. Make sure your player name matches the first name on your Google account: <strong>' + currentUser.displayName?.split(' ')[0] + '</strong></div>';
    return;
  }

  const totalM = matches.length;
  const doneM = matches.filter(m => m.res.done).length;
  const wins = matches.filter(m => {
    if (!m.res.done) return false;
    const s1 = parseInt(m.res.s1), s2 = parseInt(m.res.s2);
    const myIsT1 = m.match.type === 'fixed' ? S.teams[m.match.t1]?.players?.some(p => p?.toLowerCase().startsWith(myName)) : (m.match.t1pair||[]).map(i=>S.players[i]).some(p=>p?.toLowerCase().startsWith(myName));
    return myIsT1 ? s1 > s2 : s2 > s1;
  }).length;

  cont.innerHTML = `
    <div class="profile-hero" style="margin-bottom:1.25rem;">
      <img src="${currentUser.photoURL||''}" class="profile-avatar" onerror="this.style.display='none'">
      <div class="profile-info">
        <div class="profile-name">${currentUser.displayName?.split(' ')[0]}'s Schedule</div>
        <div class="profile-email">League ${leagueCode} · ${doneM}/${totalM} played · ${wins} wins</div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${matches.map(m => {
        const done = m.res.done;
        const s1 = parseInt(m.res.s1 || 0), s2 = parseInt(m.res.s2 || 0);
        const myIsT1 = m.match.type === 'fixed'
          ? S.teams[m.match.t1]?.players?.some(p => p?.toLowerCase().startsWith(myName))
          : (m.match.t1pair||[]).map(i=>S.players[i]).some(p=>p?.toLowerCase().startsWith(myName));
        const myScore = myIsT1 ? s1 : s2;
        const oppScore = myIsT1 ? s2 : s1;
        const won = done && myScore > oppScore;
        const lost = done && myScore < oppScore;
        return `
          <div class="match-card" style="border-left:3px solid ${done ? (won?'#1D9E75':'#c0392b') : 'var(--border)'};">
            <div class="match-header">
              <span class="match-label">Round ${m.round}</span>
              <span class="pill ${done ? (won?'pill-done':'pill-loss') : 'pill-pend'}">${done ? (won?'won':'lost') : 'upcoming'}</span>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
              <div>
                <div style="font-size:14px;font-weight:500;color:#0F6E56;">You (${m.myTeam.name})</div>
                <div style="font-size:12px;color:var(--text-secondary);">vs ${m.oppTeam.name}</div>
                <div style="font-size:11px;color:var(--text-tertiary);">${m.oppTeam.players?.join(' & ') || ''}</div>
              </div>
              ${done ? `<div style="font-size:24px;font-weight:600;font-family:'DM Serif Display',serif;color:${won?'#0F6E56':'#c0392b'}">${myScore} — ${oppScore}</div>` : '<div style="font-size:13px;color:var(--text-tertiary);">Score pending</div>'}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

// ── Firebase: Groups ──────────────────────────────────────────────────────────
async function loadGroupsFromFirebase() {
  try {
    const local = JSON.parse(localStorage.getItem('courtiq_groups') || '[]');
    if (Array.isArray(local) && local.length) { cachedGroups = local; renderGroups(); }
  } catch (e) {}
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
  } catch (e) { console.error('Groups save error:', e); return false; }
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

function editGroup(idx) { saveCurrentAsGroup(idx); }

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
  const existing = preload || Array.from(cont.querySelectorAll('input[type=text]')).map(i => i.value);
  cont.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.className = 'player-row';
    const lbl = S.mode === 'fixed' ? '<span class="team-label">Team ' + (Math.floor(i / 2) + 1) + '</span>' : '';
    row.innerHTML = '<span class="player-num">' + (i + 1) + '</span><input type="text" placeholder="Player ' + (i + 1) + '" value="' + (existing[i] || '') + '" id="pi' + i + '">' + lbl;
    cont.appendChild(row);
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
    row.innerHTML = '<span class="player-num">' + (i + 1) + '</span><input type="text" placeholder="Player ' + (i + 1) + '" id="pi' + i + '">' + lbl;
    cont.appendChild(row);
  }
}

function showLeagueUI() {
  document.getElementById('reset-btn').style.display = '';
  document.getElementById('saved-banner').style.display = '';
  document.getElementById('share-box').style.display = '';
  document.getElementById('league-code-display').textContent = leagueCode;
  // Show My Schedule nav
  const mySchedNav = document.getElementById('nav-myschedule');
  if (mySchedNav) mySchedNav.style.display = '';
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
  if (!confirm('Reset the league? All scores will be cleared.')) return;
  if (unsubscribe) unsubscribe();
  leagueCode = null;
  S = { mode: 'fixed', players: [], teams: [], rounds: 0, schedule: [], results: {} };
  activeRound = 0;
  localStorage.removeItem('pickleball_last_code');
  document.getElementById('reset-btn').style.display = 'none';
  document.getElementById('saved-banner').style.display = 'none';
  document.getElementById('share-box').style.display = 'none';
  const mySchedNav = document.getElementById('nav-myschedule');
  if (mySchedNav) mySchedNav.style.display = 'none';
  document.getElementById('join-code').value = '';
  setSyncStatus('');
  clearPlayerInputs();
  document.getElementById('matches-list').innerHTML = '';
  document.getElementById('standings-body').innerHTML = '';
  gotoTab('setup', document.getElementById('nav-setup'));
}

// ── League Generation ─────────────────────────────────────────────────────────
async function generateLeague() {
  const n = parseInt(document.getElementById('inp-n').value) || 6;
  const rounds = parseInt(document.getElementById('inp-r').value) || 3;
  const errEl = document.getElementById('setup-err');
  errEl.textContent = '';
  if (n < 4 || n % 2 !== 0) { errEl.textContent = 'Need an even number of players (min 4).'; return; }
  if (rounds < 1) { errEl.textContent = 'Need at least 1 round.'; return; }
  const players = [];
  for (let i = 0; i < n; i++) players.push((document.getElementById('pi' + i)?.value || '').trim() || 'Player ' + (i + 1));
  S.players = players; S.rounds = rounds; S.results = {};
  if (S.mode === 'fixed') generateFixed(players, rounds);
  else generateRotating(players, rounds);
  activeRound = 0;
  leagueCode = generateCode();
  showLeagueUI();
  await saveToFirebase();
  subscribeToLeague(leagueCode);
  renderSchedule();
  renderStandings();
  gotoTab('schedule', document.getElementById('nav-schedule'));
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
  if (!currentUser) { showToast('Sign in to add scores', 'error'); return; }
  const s1 = parseInt(document.getElementById('s1-' + mid)?.value);
  const s2 = parseInt(document.getElementById('s2-' + mid)?.value);
  const err = validateScore(s1, s2);
  if (err) { document.getElementById('err-' + mid).textContent = err; return; }
  S.results[mid] = { s1, s2, done: true, enteredBy: currentUser.uid };
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
    const scoreSection = currentUser && !res.done
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
        : !currentUser
          ? '<div class="score-pending-msg">Sign in to enter scores</div>'
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
window.forceSaveHistory = forceSaveHistory;
window.saveCurrentAsGroup = saveCurrentAsGroup;
window.loadGroup = loadGroup;
window.deleteGroup = deleteGroup;
window.editGroup = editGroup;
window.loadGroupsFromFirebase = loadGroupsFromFirebase;
window.loginWithGoogle = loginWithGoogle;
window.logout = logout;
window.renderUsers = renderUsers;
window.S = S;

// ── Init ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  currentUser = user;
  renderAuthUI(user);
  if (user) {
    clearPlayerInputs();
    await loadGroupsFromFirebase();
    const lastCode = localStorage.getItem('pickleball_last_code');
    if (lastCode) {
      document.getElementById('join-code').value = lastCode;
      await joinLeague(true);
    }
  }
});
