import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, onSnapshot, collection, serverTimestamp, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDPDDpW7Hf0GqBuCXqvg9IeX9zVlaDOYeM",
  authDomain: "pikleball-scoreboard.firebaseapp.com",
  projectId: "pikleball-scoreboard",
  storageBucket: "pikleball-scoreboard.firebasestorage.app",
  messagingSenderId: "495511862752",
  appId: "1:495511862752:web:e479e2c24eb44b0e153f85",
  measurementId: "G-TZWRVBBBSD"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

let S = { mode: 'fixed', players: [], teams: [], rounds: 0, schedule: [], results: {} };
let activeRound = 0;
let leagueCode = null;
let adminPin = null;
let isAdmin = false;
let unsubscribe = null;
let toastTimer = null;
let isSaving = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'PK-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = (type === 'success' ? '✓ ' : type === 'link' ? '🔗 ' : 'ℹ ') + msg;
  t.style.background = type === 'success' ? '#1D9E75' : type === 'link' ? '#185FA5' : '#633806';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function setSyncStatus(status) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (status === 'synced') { el.className = 'sync-status synced'; el.textContent = '● Live'; }
  else if (status === 'saving') { el.className = 'sync-status saving'; el.textContent = '● Saving…'; }
  else if (status === 'error') { el.className = 'sync-status error'; el.textContent = '● Offline'; }
  else { el.className = 'sync-status'; el.textContent = ''; }
}

function setAdminMode(val) {
  isAdmin = val;
  const badge = document.getElementById('admin-badge');
  if (badge) {
    badge.style.display = val ? '' : 'none';
  }
  // Re-render schedule to show/hide save buttons
  if (S.schedule.length) renderSchedule();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// ── PIN Modal ─────────────────────────────────────────────────────────────────

function showPinModal(mode, onSuccess) {
  const overlay = document.getElementById('pin-overlay');
  const title = document.getElementById('pin-modal-title');
  const desc = document.getElementById('pin-modal-desc');
  const input = document.getElementById('pin-input');
  const errEl = document.getElementById('pin-err');
  const confirmBtn = document.getElementById('pin-confirm-btn');

  if (mode === 'create') {
    title.textContent = 'Set admin PIN';
    desc.textContent = 'Create a 4-digit PIN. Share it with players who can enter scores.';
  } else {
    title.textContent = 'Enter admin PIN';
    desc.textContent = 'Enter the PIN to unlock score entry for this league.';
  }

  input.value = '';
  errEl.textContent = '';
  overlay.style.display = 'flex';
  setTimeout(() => input.focus(), 100);

  confirmBtn.onclick = () => {
    const val = input.value.trim();
    if (!/^\d{4}$/.test(val)) { errEl.textContent = 'PIN must be exactly 4 digits.'; return; }
    overlay.style.display = 'none';
    onSuccess(val);
  };

  document.getElementById('pin-cancel-btn').onclick = () => {
    overlay.style.display = 'none';
  };

  input.onkeydown = (e) => { if (e.key === 'Enter') confirmBtn.click(); };
}

function promptAdminPin() {
  if (!leagueCode) return;
  showPinModal('enter', async (val) => {
    if (val === adminPin) {
      setAdminMode(true);
      // Store in session so page refresh doesn't log out
      sessionStorage.setItem('pk_admin_' + leagueCode, val);
      showToast('Admin access granted!');
    } else {
      showToast('Incorrect PIN', 'error');
    }
  });
}

// ── Standings Calculator ──────────────────────────────────────────────────────

function calcStandings(state) {
  if (state.mode === 'fixed') {
    const stats = state.teams.map(t => ({ name: t.name, players: t.players, wins: 0, losses: 0, pts: 0, scored: 0, conceded: 0, played: 0 }));
    state.schedule.forEach(r => r.forEach(m => {
      const res = state.results[m.id];
      if (!res?.done) return;
      const s1 = parseInt(res.s1), s2 = parseInt(res.s2);
      const st1 = stats[m.t1], st2 = stats[m.t2];
      st1.played++; st2.played++; st1.scored += s1; st1.conceded += s2; st2.scored += s2; st2.conceded += s1;
      if (s1 > s2) { st1.wins++; st1.pts += 2; st2.losses++; } else { st2.wins++; st2.pts += 2; st1.losses++; }
    }));
    stats.forEach(s => s.diff = s.scored - s.conceded);
    return stats.sort((a, b) => b.pts - a.pts || b.diff - a.diff || b.scored - a.scored);
  } else {
    const stats = {};
    state.players.forEach((p, i) => { stats[i] = { name: p, wins: 0, losses: 0, pts: 0, scored: 0, conceded: 0, played: 0 }; });
    state.schedule.forEach(r => r.forEach(m => {
      const res = state.results[m.id];
      if (!res?.done) return;
      const s1 = parseInt(res.s1), s2 = parseInt(res.s2);
      [m.t1pair[0], m.t1pair[1]].forEach(p => { stats[p].played++; stats[p].scored += s1; stats[p].conceded += s2; if (s1 > s2) { stats[p].wins++; stats[p].pts += 2; } else stats[p].losses++; });
      [m.t2pair[0], m.t2pair[1]].forEach(p => { stats[p].played++; stats[p].scored += s2; stats[p].conceded += s1; if (s2 > s1) { stats[p].wins++; stats[p].pts += 2; } else stats[p].losses++; });
    }));
    return Object.values(stats).map(s => ({ ...s, diff: s.scored - s.conceded })).sort((a, b) => b.pts - a.pts || b.diff - a.diff || b.scored - a.scored);
  }
}

// ── Schedule serialization (Firestore doesn't allow nested arrays) ────────────

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

function prepareForFirestore(state) {
  return {
    mode: state.mode,
    players: state.players,
    teams: state.teams,
    rounds: state.rounds,
    schedule: serializeSchedule(state.schedule),
    results: state.results
  };
}

function restoreFromFirestore(data) {
  return {
    mode: data.mode,
    players: data.players || [],
    teams: data.teams || [],
    rounds: data.rounds || 0,
    schedule: deserializeSchedule(data.schedule, data.rounds),
    results: data.results || {}
  };
}

// ── Firebase ──────────────────────────────────────────────────────────────────

async function saveToFirebase() {
  if (!leagueCode || isSaving) return;
  isSaving = true;
  setSyncStatus('saving');

  const totalM = S.schedule.reduce((s, r) => s + r.length, 0);
  const doneM = Object.values(S.results).filter(r => r.done).length;
  const isComplete = doneM === totalM && totalM > 0;
  const standings = calcStandings(S);

  // Step 1: Save league with serialized schedule
  try {
    await setDoc(doc(db, 'leagues', leagueCode), {
      ...prepareForFirestore(S),
      leagueCode,
      adminPin,
      isComplete,
      standings,
      updatedAt: serverTimestamp()
    }, { merge: true });
    setSyncStatus('synced');
    localStorage.setItem('pickleball_last_code', leagueCode);
  } catch(e) {
    setSyncStatus('error');
    showToast('Save failed — check connection', 'error');
    console.error('League save error:', e);
    isSaving = false;
    return;
  }

  // Step 2: Save to history separately (only when complete)
  if (isComplete) {
    try {
      // Check if history entry already exists to preserve createdAt
      const histRef = doc(db, 'history', leagueCode);
      const existing = await getDoc(histRef);
      const histData = {
        leagueCode,
        ...prepareForFirestore(S),
        standings,
        isComplete: true,
        completedAt: serverTimestamp(),
      };
      if (!existing.exists()) {
        histData.createdAt = serverTimestamp();
      }
      await setDoc(histRef, histData, { merge: true });
      showToast('🏆 League complete — saved to history!');
      console.log('History saved for', leagueCode);
    } catch(e) {
      // League saved OK but history failed — show specific error
      showToast('Scores saved but history failed — check rules', 'error');
      console.error('History save error:', e);
    }
  } else {
    showToast('Saved');
  }

  isSaving = false;
}

function subscribeToLeague(code) {
  if (unsubscribe) unsubscribe();
  unsubscribe = onSnapshot(doc(db, 'leagues', code), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (!isSaving) {
      S = restoreFromFirestore(data);
      adminPin = data.adminPin || null;
      renderSchedule();
      renderStandings();
      updateBanner();
      setSyncStatus('synced');
    }
  }, (err) => { setSyncStatus('error'); console.error(err); });
}

async function loadHistory() {
  const cont = document.getElementById('history-list');
  cont.innerHTML = '<p class="muted" style="padding:1rem;">Loading history…</p>';
  try {
    const q = query(collection(db, 'history'), orderBy('completedAt', 'desc'));
    const snap = await getDocs(q);
    if (snap.empty) { cont.innerHTML = '<p class="muted" style="padding:1rem 0;">No completed tournaments yet.</p>'; return; }
    cont.innerHTML = '';
    snap.forEach(docSnap => cont.appendChild(buildHistoryCard(docSnap.data())));
  } catch(e) {
    cont.innerHTML = '<p class="muted" style="padding:1rem 0;">Could not load history. Check connection.</p>';
    console.error(e);
  }
}

function buildHistoryCard(d) {
  const sched = deserializeSchedule(d.schedule, d.rounds);
  const totalM = sched.reduce((s, r) => s + r.length, 0);
  const doneM = Object.values(d.results).filter(r => r.done).length;
  const standings = d.standings || calcStandings({...d, schedule: sched});
  const top3 = standings.slice(0, 3);
  const medals = ['🥇', '🥈', '🥉'];
  const card = document.createElement('div');
  card.className = 'history-card';
  card.innerHTML = `
    <div class="history-header">
      <div>
        <div class="history-date">${formatDate(d.completedAt)}</div>
        <div class="history-meta">
          <span class="hbadge ${d.mode==='fixed'?'tag-fixed':'tag-rotate'}">${d.mode==='fixed'?'Fixed':'Rotating'}</span>
          <span class="history-sub">${d.players.length} players · ${d.rounds} rounds · ${doneM}/${totalM} matches</span>
        </div>
      </div>
      <span class="history-code">${d.leagueCode}</span>
    </div>
    <div class="history-podium">
      ${top3.map((s,i) => `
        <div class="podium-item">
          <span class="medal">${medals[i]}</span>
          <span class="podium-name">${s.name}</span>
          <span class="podium-pts">${s.pts} pts</span>
          ${d.mode==='fixed'&&s.players?`<span class="podium-players">${s.players.join(' & ')}</span>`:''}
        </div>`).join('')}
    </div>
    <button class="btn-expand" onclick="toggleHistoryDetail(this,'${d.leagueCode}')">View full standings ▾</button>
    <div class="history-detail" id="detail-${d.leagueCode}" style="display:none;">
      <table class="stbl" style="margin-top:10px;">
        <thead><tr><th>#</th><th>${d.mode==='fixed'?'Team':'Player'}</th>${d.mode==='fixed'?'<th>Players</th>':''}<th>P</th><th>W</th><th>L</th><th>Pts</th><th>+/-</th></tr></thead>
        <tbody>${standings.map((s,i)=>`<tr>
          <td><span class="rank-badge ${i===0?'r1':i===1?'r2':i===2?'r3':''}">${i+1}</span></td>
          <td style="font-weight:500;">${s.name}</td>
          ${d.mode==='fixed'?`<td class="td-muted">${(s.players||[]).join(' & ')}</td>`:''}
          <td>${s.played}</td><td class="td-win">${s.wins}</td><td class="td-loss">${s.losses}</td>
          <td style="font-weight:500;">${s.pts}</td>
          <td class="${s.diff>=0?'td-win':'td-loss'}">${s.diff>=0?'+':''}${s.diff}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
  return card;
}

function toggleHistoryDetail(btn, code) {
  const detail = document.getElementById('detail-' + code);
  const isOpen = detail.style.display !== 'none';
  detail.style.display = isOpen ? 'none' : 'block';
  btn.textContent = isOpen ? 'View full standings ▾' : 'Hide standings ▴';
}

// ── UI ────────────────────────────────────────────────────────────────────────

async function joinLeague() {
  const input = document.getElementById('join-code');
  const errEl = document.getElementById('join-err');
  const code = input.value.trim().toUpperCase();
  errEl.textContent = '';
  if (!code) { errEl.textContent = 'Enter a league code.'; return; }
  try {
    const snap = await getDoc(doc(db, 'leagues', code));
    if (!snap.exists()) { errEl.textContent = `No league found with code "${code}".`; return; }
    const data = snap.data();
    S = restoreFromFirestore(data);
    adminPin = data.adminPin || null;
    leagueCode = code;
    activeRound = 0;
    localStorage.setItem('pickleball_last_code', code);

    // Check session for saved admin status
    const savedPin = sessionStorage.getItem('pk_admin_' + code);
    if (savedPin && savedPin === adminPin) {
      setAdminMode(true);
    } else {
      setAdminMode(false);
    }

    showLeagueUI();
    subscribeToLeague(code);
    renderSchedule();
    renderStandings();
    updateBanner();
    gotoTab('schedule', document.getElementById('nav-schedule'));
    showToast('Joined league ' + code, 'link');
  } catch(e) {
    errEl.textContent = 'Error connecting. Check your internet.';
    console.error(e);
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
  if (el) el.textContent = `League ${leagueCode} · ${done}/${total} matches · syncing live.`;
}

function copyCode() {
  navigator.clipboard.writeText(leagueCode).then(() => showToast('Code copied! Share with players', 'link')).catch(() => showToast('Code: ' + leagueCode, 'link'));
}

function confirmReset() {
  if (!isAdmin) { showToast('Admin PIN required to reset', 'error'); return; }
  if (confirm('Reset the league? All scores will be cleared from all devices.')) {
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
    refreshPlayerInputs();
    document.getElementById('matches-list').innerHTML = '';
    document.getElementById('standings-body').innerHTML = '';
    gotoTab('setup', document.getElementById('nav-setup'));
  }
}

function gotoTab(t, btn) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + t).classList.add('active');
  (btn || document.getElementById('nav-' + t)).classList.add('active');
  if (t === 'standings') renderStandings();
  if (t === 'schedule') renderSchedule();
  if (t === 'history') loadHistory();
}

function selectMode(m) {
  S.mode = m;
  document.getElementById('mc-fixed').classList.toggle('selected', m === 'fixed');
  document.getElementById('mc-rotate').classList.toggle('selected', m === 'rotate');
  refreshPlayerInputs();
}

function refreshPlayerInputs() {
  let n = parseInt(document.getElementById('inp-n').value) || 6;
  if (n % 2 !== 0) n++;
  n = Math.max(4, Math.min(20, n));
  const cont = document.getElementById('player-inputs');
  const existing = Array.from(cont.querySelectorAll('input[type=text]')).map(i => i.value);
  cont.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.className = 'player-row';
    const teamNum = Math.floor(i / 2) + 1;
    const lbl = S.mode === 'fixed' ? `<span class="team-label">Team ${teamNum}</span>` : '';
    row.innerHTML = `<span class="player-num">${i + 1}</span><input type="text" placeholder="Player ${i + 1}" value="${existing[i] || ''}" id="pi${i}">${lbl}`;
    cont.appendChild(row);
  }
}

// ── League Generation ─────────────────────────────────────────────────────────

function generateLeague() {
  const n = parseInt(document.getElementById('inp-n').value) || 6;
  const rounds = parseInt(document.getElementById('inp-r').value) || 3;
  const errEl = document.getElementById('setup-err');
  errEl.textContent = '';
  if (n < 4 || n % 2 !== 0) { errEl.textContent = 'Need an even number of players (min 4).'; return; }
  if (rounds < 1) { errEl.textContent = 'Need at least 1 round.'; return; }

  showPinModal('create', async (pin) => {
    const players = [];
    for (let i = 0; i < n; i++) players.push((document.getElementById('pi' + i)?.value || '').trim() || `Player ${i + 1}`);
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
    showToast('League created! PIN: ' + pin, 'link');
  });
}

function generateFixed(players, rounds) {
  const shuffled = shuffle(players);
  const teams = [];
  for (let i = 0; i < shuffled.length; i += 2)
    teams.push({ id: i / 2, name: `T${i / 2 + 1}`, players: [shuffled[i], shuffled[i + 1]] });
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
    const used = new Set(), roundMatches = [], order = shuffle([...ids]);
    for (let i = 0; i < order.length; i++) {
      if (used.has(order[i])) continue;
      const a = order[i];
      const newOpp = order.filter(x => x !== a && !used.has(x) && !history.has(`${Math.min(a,x)}-${Math.max(a,x)}`));
      const anyOpp = order.filter(x => x !== a && !used.has(x));
      const pool = newOpp.length > 0 ? newOpp : anyOpp;
      if (!pool.length) continue;
      const b = pool[Math.floor(Math.random() * pool.length)];
      used.add(a); used.add(b);
      history.add(`${Math.min(a,b)}-${Math.max(a,b)}`);
      roundMatches.push({ id: `r${r}m${roundMatches.length}`, round: r, t1: a, t2: b, type: 'fixed' });
    }
    schedule.push(roundMatches);
  }
  return schedule;
}

function buildRotatingSchedule(players, rounds) {
  const n = players.length, schedule = [], history = new Set();
  for (let r = 0; r < rounds; r++) {
    const shuffled = shuffle([...Array(n).keys()]);
    const pairs = [];
    for (let i = 0; i < shuffled.length; i += 2)
      if (shuffled[i + 1] !== undefined) pairs.push([shuffled[i], shuffled[i + 1]]);
    const used = new Set(), roundMatches = [], pOrder = shuffle([...Array(pairs.length).keys()]);
    for (let i = 0; i < pOrder.length; i++) {
      if (used.has(pOrder[i])) continue;
      const pi = pOrder[i], pa = pairs[pi];
      let pb = -1;
      const others = pOrder.filter(j => j !== pi && !used.has(j));
      for (const j of shuffle(others)) {
        const key = `${[...pa].sort().join(',')}_${[...pairs[j]].sort().join(',')}`;
        if (!history.has(key)) { pb = j; break; }
      }
      if (pb === -1 && others.length > 0) pb = others[0];
      if (pb !== -1) {
        const ppb = pairs[pb];
        history.add(`${[...pa].sort().join(',')}_${[...ppb].sort().join(',')}`);
        used.add(pi); used.add(pb);
        roundMatches.push({ id: `r${r}m${roundMatches.length}`, round: r, t1pair: pa, t2pair: ppb, type: 'rotate' });
      }
    }
    schedule.push(roundMatches);
  }
  return schedule;
}

// ── Score ─────────────────────────────────────────────────────────────────────

function getTeamLabel(match, side) {
  if (match.type === 'rotate') {
    const pair = side === 1 ? match.t1pair : match.t2pair;
    return { name: `${S.players[pair[0]]?.split(' ')[0]} & ${S.players[pair[1]]?.split(' ')[0]}`, players: [S.players[pair[0]], S.players[pair[1]]] };
  }
  const t = S.teams[side === 1 ? match.t1 : match.t2];
  return { name: t.name, players: t.players };
}

function getWinner(mid) {
  const res = S.results[mid];
  if (!res?.done) return 0;
  const s1 = parseInt(res.s1), s2 = parseInt(res.s2);
  if (isNaN(s1) || isNaN(s2)) return 0;
  if (Math.max(s1,s2) >= 11 && Math.abs(s1-s2) >= 2) return s1 > s2 ? 1 : 2;
  return 0;
}

function validateScore(s1, s2) {
  if (isNaN(s1)||isNaN(s2)||s1<0||s2<0) return 'Enter valid scores.';
  if (s1===s2) return 'Scores cannot be tied.';
  if (Math.max(s1,s2)<11) return `Winner needs at least 11 pts (max: ${Math.max(s1,s2)}).`;
  if (Math.abs(s1-s2)<2) return `Need 2-point lead (diff: ${Math.abs(s1-s2)}).`;
  return null;
}

async function submitScore(mid) {
  if (!isAdmin) {
    showToast('Enter admin PIN to add scores', 'error');
    promptAdminPin();
    return;
  }
  const s1 = parseInt(document.getElementById('s1-' + mid)?.value);
  const s2 = parseInt(document.getElementById('s2-' + mid)?.value);
  const err = validateScore(s1, s2);
  if (err) { document.getElementById('err-' + mid).textContent = err; return; }
  S.results[mid] = { s1, s2, done: true };
  updateBanner();
  await saveToFirebase();
  renderSchedule();
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderSchedule() {
  const tabs = document.getElementById('round-tabs');
  tabs.innerHTML = '';
  S.schedule.forEach((_, ri) => {
    const b = document.createElement('button');
    b.className = 'rtab' + (ri === activeRound ? ' active' : '');
    b.textContent = `Round ${ri + 1}`;
    b.onclick = () => { activeRound = ri; renderSchedule(); };
    tabs.appendChild(b);
  });

  const cont = document.getElementById('matches-list');
  cont.innerHTML = '';
  const round = S.schedule[activeRound];
  if (!round || !round.length) { cont.innerHTML = '<p class="muted">No matches this round.</p>'; return; }

  // Access bar
  const accessBar = document.createElement('div');
  accessBar.className = isAdmin ? 'access-bar admin' : 'access-bar viewer';
  accessBar.innerHTML = isAdmin
    ? `<span>🔓 Admin mode — you can enter scores</span>`
    : `<span>👁 View only — <button class="btn-unlock" onclick="promptAdminPin()">Enter PIN to add scores</button></span>`;
  cont.appendChild(accessBar);

  const note = document.createElement('div');
  note.className = S.mode === 'rotate' ? 'warn-box' : 'info-box';
  note.textContent = S.mode === 'rotate' ? 'Rotating partners — new pairs each round.' : 'Fixed partners — same teams throughout.';
  cont.appendChild(note);

  round.forEach(match => {
    const res = S.results[match.id];
    const t1 = getTeamLabel(match, 1), t2 = getTeamLabel(match, 2);
    const winner = getWinner(match.id);
    const mc = document.createElement('div');
    mc.className = 'match-card';
    mc.innerHTML = `
      <div class="match-header">
        <span class="match-label">Match · ${match.id}</span>
        <span class="pill ${res.done?'pill-done':'pill-pend'}">${res.done?'completed':'pending'}</span>
      </div>
      <div class="match-grid">
        <div class="team-box">
          <div class="team-name">${t1.name} ${winner===1?'<span class="win-tag">winner</span>':''}</div>
          <div class="team-players">${t1.players.join(' & ')}</div>
        </div>
        <div class="vs-label">vs</div>
        <div class="team-box right">
          <div class="team-name">${winner===2?'<span class="win-tag">winner</span>':''} ${t2.name}</div>
          <div class="team-players">${t2.players.join(' & ')}</div>
        </div>
      </div>
      ${isAdmin && !res.done ? `
      <div class="score-row">
        <span class="score-label">${t1.name}</span>
        <input type="number" class="score-inp" min="0" max="99" value="${res.s1}" placeholder="0" id="s1-${match.id}"
          oninput="S.results['${match.id}'].s1=this.value;document.getElementById('err-${match.id}').textContent='';">
        <span class="score-sep">—</span>
        <input type="number" class="score-inp" min="0" max="99" value="${res.s2}" placeholder="0" id="s2-${match.id}"
          oninput="S.results['${match.id}'].s2=this.value;document.getElementById('err-${match.id}').textContent='';">
        <span class="score-label">${t2.name}</span>
        <button class="btn-save" onclick="submitScore('${match.id}')">save</button>
      </div>
      <div id="err-${match.id}" class="match-err"></div>
      ` : res.done ? `
      <div class="score-display">
        <span class="score-num ${winner===1?'score-win':''}">${res.s1}</span>
        <span class="score-sep-display">—</span>
        <span class="score-num ${winner===2?'score-win':''}">${res.s2}</span>
      </div>` : `<div class="score-pending-msg">Score not entered yet</div>`}
    `;
    cont.appendChild(mc);
  });
}

async function saveToHistory(standings) {
  if (!leagueCode) return;
  try {
    const histRef = doc(db, 'history', leagueCode);
    const existing = await getDoc(histRef);
    const histData = {
      leagueCode,
      mode: S.mode,
      players: S.players,
      teams: S.teams,
      rounds: S.rounds,
      results: S.results,
      schedule: S.schedule,
      standings,
      isComplete: true,
      completedAt: serverTimestamp(),
    };
    if (!existing.exists()) {
      histData.createdAt = serverTimestamp();
    }
    await setDoc(histRef, histData, { merge: true });
    console.log('✅ History saved for', leagueCode);
    return true;
  } catch(e) {
    console.error('❌ History save error:', e);
    return false;
  }
}

function renderStandings() {
  const cont = document.getElementById('standings-body');
  if (!S.teams.length) { cont.innerHTML = '<p class="muted">Generate the league first.</p>'; return; }
  const totalM = S.schedule.reduce((s, r) => s + r.length, 0);
  const doneM = Object.values(S.results).filter(r => r.done).length;
  const allDone = doneM === totalM && totalM > 0;
  const standings = calcStandings(S);
  const isFixed = S.mode === 'fixed';

  // Always try to save to history when all done — safe to call multiple times (merge:true)
  if (allDone && leagueCode) {
    saveToHistory(standings);
  }

  cont.innerHTML = `
    <div class="grid4">
      <div class="metric"><div class="metric-val">${isFixed?S.teams.length:S.players.length}</div><div class="metric-lbl">${isFixed?'Teams':'Players'}</div></div>
      <div class="metric"><div class="metric-val">${S.rounds}</div><div class="metric-lbl">Rounds</div></div>
      <div class="metric"><div class="metric-val">${doneM}/${totalM}</div><div class="metric-lbl">Done</div></div>
      <div class="metric"><div class="metric-val">${allDone?'Final':'Live'}</div><div class="metric-lbl">Status</div></div>
    </div>
    ${!isFixed?'<div class="warn-box">Rotating partners — individual player rankings.</div>':''}
    ${allDone?`<div class="info-box">
      🏆 All matches complete!
      <button onclick="forceSaveHistory()" style="margin-left:10px;background:#185FA5;color:#fff;border:none;border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;font-family:inherit;">
        Save to History
      </button>
    </div>`:''}
    <div class="card" style="padding:0;overflow:hidden;">
      <div class="standings-wrap"><table class="stbl">
        <thead><tr><th>#</th><th>${isFixed?'Team':'Player'}</th>${isFixed?'<th>Players</th>':''}<th>P</th><th>W</th><th>L</th><th>Pts</th><th>+/-</th><th>Scored</th></tr></thead>
        <tbody>${standings.map((s,i)=>`<tr>
          <td><span class="rank-badge ${i===0?'r1':i===1?'r2':i===2?'r3':''}">${i+1}</span></td>
          <td style="font-weight:500;">${s.name}</td>
          ${isFixed?`<td class="td-muted">${(s.players||[]).join(' & ')}</td>`:''}
          <td>${s.played}</td><td class="td-win">${s.wins}</td><td class="td-loss">${s.losses}</td>
          <td style="font-weight:500;">${s.pts}</td>
          <td class="${s.diff>=0?'td-win':'td-loss'}">${s.diff>=0?'+':''}${s.diff}</td>
          <td>${s.scored}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
    <p class="tiebreak-note">Tiebreakers: league points → score diff → total scored</p>`;
}

async function forceSaveHistory() {
  if (!leagueCode) return;
  const standings = calcStandings(S);
  showToast('Saving to history…', 'link');
  const ok = await saveToHistory(standings);
  if (ok) {
    showToast('Saved to history!');
  } else {
    showToast('Failed — check console for errors', 'error');
  }
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
window.toggleHistoryDetail = toggleHistoryDetail;
window.promptAdminPin = promptAdminPin;
window.forceSaveHistory = forceSaveHistory;
window.S = S;

// ── Auto-rejoin ───────────────────────────────────────────────────────────────
const lastCode = localStorage.getItem('pickleball_last_code');
if (lastCode) {
  document.getElementById('join-code').value = lastCode;
  joinLeague();
} else {
  refreshPlayerInputs();
}
