const STORAGE_KEY = 'pickleball_league_v1';

let S = { mode: 'fixed', players: [], teams: [], rounds: 0, schedule: [], results: {} };
let activeRound = 0;
let toastTimer = null;

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ S, activeRound }));
    showToast();
  } catch(e) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (saved?.S) { S = saved.S; activeRound = saved.activeRound || 0; return true; }
  } catch(e) {}
  return false;
}

function showToast() {
  const t = document.getElementById('toast');
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

function confirmReset() {
  if (confirm('Reset the league? All scores and setup will be cleared.')) {
    localStorage.removeItem(STORAGE_KEY);
    S = { mode: 'fixed', players: [], teams: [], rounds: 0, schedule: [], results: {} };
    activeRound = 0;
    document.getElementById('reset-btn').style.display = 'none';
    document.getElementById('saved-banner').style.display = 'none';
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

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateLeague() {
  const n = parseInt(document.getElementById('inp-n').value) || 6;
  const rounds = parseInt(document.getElementById('inp-r').value) || 3;
  const errEl = document.getElementById('setup-err');
  errEl.textContent = '';
  if (n < 4 || n % 2 !== 0) { errEl.textContent = 'Need an even number of players (min 4).'; return; }
  if (rounds < 1) { errEl.textContent = 'Need at least 1 round.'; return; }
  const players = [];
  for (let i = 0; i < n; i++) {
    players.push((document.getElementById('pi' + i)?.value || '').trim() || `Player ${i + 1}`);
  }
  S.players = players;
  S.rounds = rounds;
  S.results = {};
  if (S.mode === 'fixed') generateFixed(players, rounds);
  else generateRotating(players, rounds);
  activeRound = 0;
  saveState();
  document.getElementById('reset-btn').style.display = '';
  document.getElementById('saved-banner').style.display = '';
  updateBanner();
  renderSchedule();
  renderStandings();
  gotoTab('schedule', document.getElementById('nav-schedule'));
}

function updateBanner() {
  const total = S.schedule.reduce((s, r) => s + r.length, 0);
  const done = Object.values(S.results).filter(r => r.done).length;
  const el = document.getElementById('saved-banner-text');
  if (el) el.textContent = `League in progress · ${done}/${total} matches saved · auto-saves on every score.`;
}

function generateFixed(players, rounds) {
  const shuffled = shuffle(players);
  const teams = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    teams.push({ id: i / 2, name: `T${i / 2 + 1}`, players: [shuffled[i], shuffled[i + 1]] });
  }
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
    for (let i = 0; i < shuffled.length; i += 2) {
      if (shuffled[i + 1] !== undefined) pairs.push([shuffled[i], shuffled[i + 1]]);
    }
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

function getTeamLabel(match, side) {
  if (match.type === 'rotate') {
    const pair = side === 1 ? match.t1pair : match.t2pair;
    return {
      name: `${S.players[pair[0]]?.split(' ')[0]} & ${S.players[pair[1]]?.split(' ')[0]}`,
      players: [S.players[pair[0]], S.players[pair[1]]]
    };
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
  if (isNaN(s1) || isNaN(s2) || s1 < 0 || s2 < 0) return 'Enter valid scores.';
  if (s1 === s2) return 'Scores cannot be tied.';
  if (Math.max(s1,s2) < 11) return `Winner needs at least 11 pts (max: ${Math.max(s1,s2)}).`;
  if (Math.abs(s1-s2) < 2) return `Need 2-point lead (diff: ${Math.abs(s1-s2)}).`;
  return null;
}

function submitScore(mid) {
  const s1 = parseInt(document.getElementById('s1-' + mid)?.value);
  const s2 = parseInt(document.getElementById('s2-' + mid)?.value);
  const err = validateScore(s1, s2);
  const errEl = document.getElementById('err-' + mid);
  if (err) { errEl.textContent = err; return; }
  S.results[mid] = { s1, s2, done: true };
  saveState();
  updateBanner();
  renderSchedule();
}

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
  const note = S.mode === 'rotate'
    ? `<div class="warn-box">Rotating partners — new pairs each round. Players ranked individually in standings.</div>`
    : `<div class="info-box">Fixed partners — same teams throughout all rounds.</div>`;
  cont.innerHTML = note;
  round.forEach(match => {
    const res = S.results[match.id];
    const t1 = getTeamLabel(match, 1), t2 = getTeamLabel(match, 2);
    const winner = getWinner(match.id);
    const mc = document.createElement('div');
    mc.className = 'match-card';
    mc.innerHTML = `
      <div class="match-header">
        <span class="match-label">Match · ${match.id}</span>
        <span class="pill ${res.done ? 'pill-done' : 'pill-pend'}">${res.done ? 'completed' : 'pending'}</span>
      </div>
      <div class="match-grid">
        <div class="team-box">
          <div class="team-name">${t1.name} ${winner === 1 ? '<span class="win-tag">winner</span>' : ''}</div>
          <div class="team-players">${t1.players.join(' & ')}</div>
        </div>
        <div class="vs-label">vs</div>
        <div class="team-box right">
          <div class="team-name">${winner === 2 ? '<span class="win-tag">winner</span>' : ''} ${t2.name}</div>
          <div class="team-players">${t2.players.join(' & ')}</div>
        </div>
      </div>
      <div class="score-row">
        <span class="score-label">${t1.name}</span>
        <input type="number" class="score-inp" min="0" max="99" value="${res.s1}" placeholder="0" id="s1-${match.id}"
          oninput="S.results['${match.id}'].s1=this.value; document.getElementById('err-${match.id}').textContent='';">
        <span class="score-sep">—</span>
        <input type="number" class="score-inp" min="0" max="99" value="${res.s2}" placeholder="0" id="s2-${match.id}"
          oninput="S.results['${match.id}'].s2=this.value; document.getElementById('err-${match.id}').textContent='';">
        <span class="score-label">${t2.name}</span>
        <button class="btn-save" onclick="submitScore('${match.id}')" ${res.done ? 'disabled' : ''}>
          ${res.done ? 'saved ✓' : 'save'}
        </button>
      </div>
      <div id="err-${match.id}" class="match-err"></div>
    `;
    cont.appendChild(mc);
  });
}

function renderStandings() {
  const cont = document.getElementById('standings-body');
  if (!S.teams.length) { cont.innerHTML = '<p class="muted">Generate the league first.</p>'; return; }
  const totalM = S.schedule.reduce((s, r) => s + r.length, 0);
  const doneM = Object.values(S.results).filter(r => r.done).length;
  const allDone = doneM === totalM && totalM > 0;
  if (S.mode === 'fixed') renderFixedStandings(cont, allDone, doneM, totalM);
  else renderRotatingStandings(cont, allDone, doneM, totalM);
}

function renderFixedStandings(cont, allDone, doneM, totalM) {
  const stats = S.teams.map(t => ({ team: t, wins: 0, losses: 0, pts: 0, scored: 0, conceded: 0, played: 0 }));
  S.schedule.forEach(r => r.forEach(m => {
    const res = S.results[m.id];
    if (!res?.done) return;
    const s1 = parseInt(res.s1), s2 = parseInt(res.s2);
    const st1 = stats[m.t1], st2 = stats[m.t2];
    st1.played++; st2.played++; st1.scored += s1; st1.conceded += s2; st2.scored += s2; st2.conceded += s1;
    if (s1 > s2) { st1.wins++; st1.pts += 2; st2.losses++; } else { st2.wins++; st2.pts += 2; st1.losses++; }
  }));
  stats.forEach(s => s.diff = s.scored - s.conceded);
  stats.sort((a, b) => b.pts - a.pts || b.diff - a.diff || b.scored - a.scored);
  cont.innerHTML = `
    <div class="grid4">
      <div class="metric"><div class="metric-val">${S.teams.length}</div><div class="metric-lbl">Teams</div></div>
      <div class="metric"><div class="metric-val">${S.rounds}</div><div class="metric-lbl">Rounds</div></div>
      <div class="metric"><div class="metric-val">${doneM}/${totalM}</div><div class="metric-lbl">Done</div></div>
      <div class="metric"><div class="metric-val">${allDone ? 'Final' : 'Live'}</div><div class="metric-lbl">Status</div></div>
    </div>
    ${allDone ? '<div class="info-box">All matches complete — final standings.</div>' : ''}
    <div class="card" style="padding:0;overflow:hidden;">
      <div class="standings-wrap">
        <table class="stbl">
          <thead><tr><th>#</th><th>Team</th><th>Players</th><th>P</th><th>W</th><th>L</th><th>Pts</th><th>+/-</th><th>Scored</th></tr></thead>
          <tbody>${stats.map((s, i) => `<tr>
            <td><span class="rank-badge ${i===0?'r1':i===1?'r2':i===2?'r3':''}">${i+1}</span></td>
            <td style="font-weight:500;">${s.team.name}</td>
            <td class="td-muted">${s.team.players.join(' & ')}</td>
            <td>${s.played}</td>
            <td class="td-win">${s.wins}</td>
            <td class="td-loss">${s.losses}</td>
            <td style="font-weight:500;">${s.pts}</td>
            <td class="${s.diff>=0?'td-win':'td-loss'}">${s.diff>=0?'+':''}${s.diff}</td>
            <td>${s.scored}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>
    <p class="tiebreak-note">Tiebreakers: league points → score diff → total scored</p>`;
}

function renderRotatingStandings(cont, allDone, doneM, totalM) {
  const stats = {};
  S.players.forEach((p, i) => { stats[i] = { name: p, wins: 0, losses: 0, pts: 0, scored: 0, conceded: 0, played: 0 }; });
  S.schedule.forEach(r => r.forEach(m => {
    const res = S.results[m.id];
    if (!res?.done) return;
    const s1 = parseInt(res.s1), s2 = parseInt(res.s2);
    [m.t1pair[0], m.t1pair[1]].forEach(p => { stats[p].played++; stats[p].scored+=s1; stats[p].conceded+=s2; if(s1>s2){stats[p].wins++;stats[p].pts+=2;}else stats[p].losses++; });
    [m.t2pair[0], m.t2pair[1]].forEach(p => { stats[p].played++; stats[p].scored+=s2; stats[p].conceded+=s1; if(s2>s1){stats[p].wins++;stats[p].pts+=2;}else stats[p].losses++; });
  }));
  const rows = Object.values(stats).map(s => ({ ...s, diff: s.scored - s.conceded }));
  rows.sort((a, b) => b.pts - a.pts || b.diff - a.diff || b.scored - a.scored);
  cont.innerHTML = `
    <div class="grid4">
      <div class="metric"><div class="metric-val">${S.players.length}</div><div class="metric-lbl">Players</div></div>
      <div class="metric"><div class="metric-val">${S.rounds}</div><div class="metric-lbl">Rounds</div></div>
      <div class="metric"><div class="metric-val">${doneM}/${totalM}</div><div class="metric-lbl">Done</div></div>
      <div class="metric"><div class="metric-val">${allDone?'Final':'Live'}</div><div class="metric-lbl">Status</div></div>
    </div>
    <div class="warn-box">Rotating partners — individual player rankings.</div>
    ${allDone ? '<div class="info-box">All matches complete — final standings.</div>' : ''}
    <div class="card" style="padding:0;overflow:hidden;">
      <div class="standings-wrap">
        <table class="stbl">
          <thead><tr><th>#</th><th>Player</th><th>P</th><th>W</th><th>L</th><th>Pts</th><th>+/-</th><th>Scored</th></tr></thead>
          <tbody>${rows.map((s,i) => `<tr>
            <td><span class="rank-badge ${i===0?'r1':i===1?'r2':i===2?'r3':''}">${i+1}</span></td>
            <td style="font-weight:500;">${s.name}</td>
            <td>${s.played}</td>
            <td class="td-win">${s.wins}</td>
            <td class="td-loss">${s.losses}</td>
            <td style="font-weight:500;">${s.pts}</td>
            <td class="${s.diff>=0?'td-win':'td-loss'}">${s.diff>=0?'+':''}${s.diff}</td>
            <td>${s.scored}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>
    <p class="tiebreak-note">Tiebreakers: league points → score diff → total scored</p>`;
}

const loaded = loadState();
if (loaded && S.teams.length) {
  document.getElementById('reset-btn').style.display = '';
  document.getElementById('saved-banner').style.display = '';
  updateBanner();
  refreshPlayerInputs();
  renderSchedule();
  renderStandings();
} else {
  refreshPlayerInputs();
}
