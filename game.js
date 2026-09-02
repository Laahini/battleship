'use strict';

/* ---------------------------------------------------------
   Shared grid helpers (used by single-player and multiplayer)
--------------------------------------------------------- */
function createEmptyGrid(boardSize) {
  return Array.from({ length: boardSize }, () =>
    Array.from({ length: boardSize }, () => ({ shipId: null, shot: false, state: null }))
  );
}

function inBounds(r, c, boardSize) {
  return r >= 0 && r < boardSize && c >= 0 && c < boardSize;
}

function shipCells(row, col, shipSize, orient) {
  const cells = [];
  for (let i = 0; i < shipSize; i++) {
    const r = orient === 'h' ? row : row + i;
    const c = orient === 'h' ? col + i : col;
    cells.push([r, c]);
  }
  return cells;
}

function canPlace(grid, row, col, shipSize, orient, boardSize) {
  const cells = shipCells(row, col, shipSize, orient);
  return cells.every(([r, c]) => inBounds(r, c, boardSize) && grid[r][c].shipId === null);
}

function placeShip(grid, ships, row, col, shipSize, orient, name) {
  const cells = shipCells(row, col, shipSize, orient);
  const id = ships.length;
  cells.forEach(([r, c]) => { grid[r][c].shipId = id; });
  ships.push({ id, name, size: shipSize, cells, hits: 0, sunk: false });
}

function randomlyPlaceFleet(grid, ships, fleetDef, boardSize) {
  for (const def of fleetDef.ships) {
    let placed = false;
    let attempts = 0;
    while (!placed) {
      attempts++;
      if (attempts > 400) {
        // extremely unlikely with these board/fleet sizes — restart the whole fleet
        for (let r = 0; r < boardSize; r++) for (let c = 0; c < boardSize; c++) { grid[r][c] = { shipId: null, shot: false, state: null }; }
        ships.length = 0;
        return randomlyPlaceFleet(grid, ships, fleetDef, boardSize);
      }
      const orient = Math.random() < 0.5 ? 'h' : 'v';
      const row = Math.floor(Math.random() * boardSize);
      const col = Math.floor(Math.random() * boardSize);
      if (canPlace(grid, row, col, def.size, orient, boardSize)) {
        placeShip(grid, ships, row, col, def.size, orient, def.name);
        placed = true;
      }
    }
  }
}

function shootAt(grid, ships, r, c) {
  const cell = grid[r][c];
  if (cell.shot) return null;
  cell.shot = true;
  if (cell.shipId !== null) {
    cell.state = 'hit';
    const ship = ships[cell.shipId];
    ship.hits++;
    if (ship.hits === ship.size) {
      ship.sunk = true;
      ship.cells.forEach(([rr, cc]) => { grid[rr][cc].state = 'sunk'; });
      return { hit: true, sunk: true, ship };
    }
    return { hit: true, sunk: false, ship };
  }
  cell.state = 'miss';
  return { hit: false, sunk: false, ship: null };
}

function allSunk(ships, expectedCount) {
  return ships.length === expectedCount && ships.every(s => s.sunk);
}

function coordLabel(r, c) {
  const letters = 'ABCDEFGHIJKL';
  return letters[c] + (r + 1);
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function formatClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------------------------------------------------
   State
--------------------------------------------------------- */
let playerGrid, aiGrid;
let playerShips, aiShips;
let placementIndex = 0;
let orientation = 'h';
let battleActive = false;
let playerTurn = true;

let battleBoardSize = 10;
let battleFleet = GameConfig.FLEET_PRESETS[GameConfig.DEFAULT_FLEET];

let aiMemory = { mode: 'hunt', stack: [], currentHits: [] };

let shotsFired = 0;
let hitsLanded = 0;
let battleStartTime = 0;
let currentMode = 'single'; // 'single' | 'multiplayer'
let lastShareText = '';

const PLAYER_NAME_KEY = 'battleship_playerName';

/* ---------------------------------------------------------
   DOM refs
--------------------------------------------------------- */
const statusLine = document.getElementById('statusLine');
const timerBadge = document.getElementById('timerBadge');

const placementScreen = document.getElementById('placementScreen');
const battleScreen = document.getElementById('battleScreen');
const placementBoardEl = document.getElementById('placementBoard');
const playerBoardEl = document.getElementById('playerBoard');
const enemyBoardEl = document.getElementById('enemyBoard');
const shipListEl = document.getElementById('shipList');
const rotateBtn = document.getElementById('rotateBtn');
const randomBtn = document.getElementById('randomBtn');
const resetBtn = document.getElementById('resetBtn');
const startBattleBtn = document.getElementById('startBattleBtn');
const logListEl = document.getElementById('logList');
const playerFleetStatusEl = document.getElementById('playerFleetStatus');
const enemyFleetStatusEl = document.getElementById('enemyFleetStatus');
const boardSizeSelect = document.getElementById('boardSizeSelect');
const fleetSelect = document.getElementById('fleetSelect');

const gameOverModal = document.getElementById('gameOverModal');
const gameOverTitle = document.getElementById('gameOverTitle');
const gameOverText = document.getElementById('gameOverText');
const gameOverStats = document.getElementById('gameOverStats');
const playAgainBtn = document.getElementById('playAgainBtn');
const shareResultBtn = document.getElementById('shareResultBtn');
const viewLeaderboardBtn = document.getElementById('viewLeaderboardBtn');
const closeGameOverBtn = document.getElementById('closeGameOverBtn');

const navLinks = document.querySelectorAll('.nav-link');
const playView = document.getElementById('playView');
const multiplayerView = document.getElementById('multiplayerView');
const leaderboardView = document.getElementById('leaderboardView');
const playerNameInput = document.getElementById('playerNameInput');
const bestWinsBody = document.getElementById('bestWinsBody');
const bestWinsEmpty = document.getElementById('bestWinsEmpty');
const recentGamesBody = document.getElementById('recentGamesBody');
const recentGamesEmpty = document.getElementById('recentGamesEmpty');

const mpMenuEl = document.getElementById('mpMenu');
const mpWaitingEl = document.getElementById('mpWaiting');
const mpPlacementScreenEl = document.getElementById('mpPlacementScreen');
const mpBattleScreenEl = document.getElementById('mpBattleScreen');
const mpBoardSizeSelect = document.getElementById('mpBoardSizeSelect');
const mpFleetSelect = document.getElementById('mpFleetSelect');
const mpCreateBtn = document.getElementById('mpCreateBtn');
const mpCodeInput = document.getElementById('mpCodeInput');
const mpJoinBtn = document.getElementById('mpJoinBtn');
const mpJoinError = document.getElementById('mpJoinError');
const mpCodeDisplayEl = document.getElementById('mpCodeDisplay');
const mpCopyCodeBtn = document.getElementById('mpCopyCodeBtn');
const mpPlacementBoardEl = document.getElementById('mpPlacementBoard');
const mpShipListEl = document.getElementById('mpShipList');
const mpRotateBtn = document.getElementById('mpRotateBtn');
const mpRandomBtn = document.getElementById('mpRandomBtn');
const mpResetBtn = document.getElementById('mpResetBtn');
const mpReadyBtn = document.getElementById('mpReadyBtn');
const mpPlacementStatus = document.getElementById('mpPlacementStatus');
const mpMyBoardEl = document.getElementById('mpMyBoard');
const mpEnemyBoardEl = document.getElementById('mpEnemyBoard');
const mpMyBoardLabel = document.getElementById('mpMyBoardLabel');
const mpEnemyBoardLabel = document.getElementById('mpEnemyBoardLabel');
const mpLogListEl = document.getElementById('mpLogList');
const mpTurnLightMe = document.getElementById('mpTurnLightMe');
const mpTurnLightOpponent = document.getElementById('mpTurnLightOpponent');
const mpTurnLightOpponentName = document.getElementById('mpTurnLightOpponentName');

/* ---------------------------------------------------------
   Player name
--------------------------------------------------------- */
function getPlayerName() {
  const val = playerNameInput.value.trim();
  return val || 'Admiral';
}

playerNameInput.value = localStorage.getItem(PLAYER_NAME_KEY) || '';
playerNameInput.addEventListener('input', () => {
  localStorage.setItem(PLAYER_NAME_KEY, playerNameInput.value.trim());
});

/* ---------------------------------------------------------
   Navigation
--------------------------------------------------------- */
function switchView(target) {
  navLinks.forEach(link => link.classList.toggle('active', link.dataset.nav === target));
  playView.classList.toggle('hidden', target !== 'play');
  multiplayerView.classList.toggle('hidden', target !== 'multiplayer');
  leaderboardView.classList.toggle('hidden', target !== 'leaderboard');
  statusLine.style.display = target === 'play' ? '' : 'none';
  if (target === 'leaderboard') renderLeaderboard();
}

navLinks.forEach(link => {
  link.addEventListener('click', () => switchView(link.dataset.nav));
});

/* ---------------------------------------------------------
   Timer
--------------------------------------------------------- */
let timerInterval = null;

function startTimer() {
  battleStartTime = Date.now();
  timerBadge.classList.remove('hidden');
  updateTimerDisplay();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateTimerDisplay, 500);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function hideTimer() {
  stopTimer();
  timerBadge.classList.add('hidden');
}

function updateTimerDisplay() {
  const secs = (Date.now() - battleStartTime) / 1000;
  timerBadge.textContent = '⏱ ' + formatClock(secs);
}

/* ---------------------------------------------------------
   Share result
--------------------------------------------------------- */
shareResultBtn.addEventListener('click', async () => {
  const url = window.location.origin || window.location.href;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Battleship', text: lastShareText, url });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${lastShareText}\n${url}`);
    const original = shareResultBtn.textContent;
    shareResultBtn.textContent = 'Copied!';
    setTimeout(() => { shareResultBtn.textContent = original; }, 1600);
  } catch {
    // clipboard unavailable — silently ignore, share text is still visible in the modal
  }
});

/* ---------------------------------------------------------
   Leaderboard — backed by /api/leaderboard (DynamoDB)
--------------------------------------------------------- */
const LEADERBOARD_API = '/api/leaderboard';

async function submitRecord(record) {
  try {
    const res = await fetch(LEADERBOARD_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error('Request failed: ' + res.status);
  } catch (err) {
    console.warn('Could not save leaderboard record:', err);
  }
}

async function fetchLeaderboard(type) {
  const res = await fetch(`${LEADERBOARD_API}?type=${type}`);
  if (!res.ok) throw new Error('Request failed: ' + res.status);
  return res.json();
}

async function renderLeaderboard() {
  bestWinsBody.innerHTML = '';
  recentGamesBody.innerHTML = '';
  bestWinsEmpty.classList.remove('hidden');
  recentGamesEmpty.classList.remove('hidden');
  bestWinsEmpty.textContent = 'Loading...';
  recentGamesEmpty.textContent = 'Loading...';

  try {
    const [wins, recent] = await Promise.all([
      fetchLeaderboard('best'),
      fetchLeaderboard('recent'),
    ]);

    bestWinsEmpty.textContent = 'No wins yet — sink a fleet to set a record!';
    bestWinsEmpty.classList.toggle('hidden', wins.length > 0);
    wins.forEach((rec, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td class="name-cell">${escapeHtml(rec.name)}</td>
        <td class="mono">${rec.shots}</td>
        <td class="mono">${rec.accuracy}%</td>
        <td class="mono">${formatTime(rec.duration)}</td>
        <td>${formatDate(rec.date)}</td>
      `;
      bestWinsBody.appendChild(tr);
    });

    recentGamesEmpty.textContent = 'No games played yet.';
    recentGamesEmpty.classList.toggle('hidden', recent.length > 0);
    recent.forEach(rec => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="name-cell">${escapeHtml(rec.name)}</td>
        <td><span class="result-badge ${rec.result}">${rec.result === 'win' ? 'Win' : 'Loss'}</span></td>
        <td class="mono">${rec.shots}</td>
        <td class="mono">${rec.accuracy}%</td>
        <td class="mono">${formatTime(rec.duration)}</td>
        <td>${formatDate(rec.date)}</td>
      `;
      recentGamesBody.appendChild(tr);
    });
  } catch (err) {
    console.warn('Could not load leaderboard:', err);
    bestWinsEmpty.textContent = 'Leaderboard unavailable right now.';
    recentGamesEmpty.textContent = 'Leaderboard unavailable right now.';
    bestWinsEmpty.classList.remove('hidden');
    recentGamesEmpty.classList.remove('hidden');
  }
}

viewLeaderboardBtn.addEventListener('click', () => {
  gameOverModal.classList.add('hidden');
  switchView('leaderboard');
});

closeGameOverBtn.addEventListener('click', () => {
  gameOverModal.classList.add('hidden');
});

/* ---------------------------------------------------------
   Game setup (board size / fleet selectors)
--------------------------------------------------------- */
function populateSelect(selectEl, options) {
  selectEl.innerHTML = '';
  options.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    selectEl.appendChild(o);
  });
}

function fleetOptions() {
  return Object.entries(GameConfig.FLEET_PRESETS).map(([key, def]) => ({
    value: key,
    label: `${def.label} (${def.ships.length} ships)`,
  }));
}

function boardSizeOptions() {
  return GameConfig.BOARD_SIZES.map(n => ({ value: n, label: `${n} × ${n}` }));
}

populateSelect(boardSizeSelect, boardSizeOptions());
populateSelect(fleetSelect, fleetOptions());
boardSizeSelect.value = String(GameConfig.DEFAULT_BOARD_SIZE);
fleetSelect.value = GameConfig.DEFAULT_FLEET;

populateSelect(mpBoardSizeSelect, boardSizeOptions());
populateSelect(mpFleetSelect, fleetOptions());
mpBoardSizeSelect.value = String(GameConfig.DEFAULT_BOARD_SIZE);
mpFleetSelect.value = GameConfig.DEFAULT_FLEET;

function currentSpBoardSize() { return Number(boardSizeSelect.value); }
function currentSpFleet() { return GameConfig.FLEET_PRESETS[fleetSelect.value]; }

boardSizeSelect.addEventListener('change', initPlacement);
fleetSelect.addEventListener('change', initPlacement);

/* ---------------------------------------------------------
   Placement screen (single player)
--------------------------------------------------------- */
function initPlacement() {
  playerGrid = createEmptyGrid(currentSpBoardSize());
  playerShips = [];
  placementIndex = 0;
  orientation = 'h';
  renderShipList();
  buildPlacementBoard();
  startBattleBtn.disabled = true;
  const first = currentSpFleet().ships[0];
  statusLine.textContent = `Place your ${first.name} (${first.size} cells)`;
}

function buildPlacementBoard() {
  const n = currentSpBoardSize();
  placementBoardEl.innerHTML = '';
  placementBoardEl.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
  placementBoardEl.style.gridTemplateRows = `repeat(${n}, minmax(0, 1fr))`;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.addEventListener('mouseenter', () => previewShip(r, c));
      cell.addEventListener('mouseleave', clearPreview);
      cell.addEventListener('click', () => attemptPlace(r, c));
      cell.addEventListener('contextmenu', (e) => { e.preventDefault(); toggleOrientation(); previewShip(r, c); });
      placementBoardEl.appendChild(cell);
    }
  }
}

function refreshPlacementBoardShips() {
  const n = currentSpBoardSize();
  const cells = placementBoardEl.children;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const el = cells[r * n + c];
      el.classList.toggle('ship', playerGrid[r][c].shipId !== null);
    }
  }
}

function previewShip(row, col) {
  const defs = currentSpFleet().ships;
  if (placementIndex >= defs.length) return;
  clearPreview();
  const def = defs[placementIndex];
  const n = currentSpBoardSize();
  const cells = shipCells(row, col, def.size, orientation);
  const valid = canPlace(playerGrid, row, col, def.size, orientation, n);
  const boardCells = placementBoardEl.children;
  cells.forEach(([r, c]) => {
    if (!inBounds(r, c, n)) return;
    boardCells[r * n + c].classList.add(valid ? 'preview-valid' : 'preview-invalid');
  });
}

function clearPreview() {
  Array.from(placementBoardEl.children).forEach(el => {
    el.classList.remove('preview-valid', 'preview-invalid');
  });
}

function attemptPlace(row, col) {
  const defs = currentSpFleet().ships;
  if (placementIndex >= defs.length) return;
  const def = defs[placementIndex];
  if (!canPlace(playerGrid, row, col, def.size, orientation, currentSpBoardSize())) return;
  placeShip(playerGrid, playerShips, row, col, def.size, orientation, def.name);
  placementIndex++;
  refreshPlacementBoardShips();
  renderShipList();
  clearPreview();
  if (placementIndex >= defs.length) {
    statusLine.textContent = 'Fleet placed! Click "Start Battle" when ready.';
    startBattleBtn.disabled = false;
  } else {
    const next = defs[placementIndex];
    statusLine.textContent = `Place your ${next.name} (${next.size} cells)`;
  }
}

function toggleOrientation() {
  orientation = orientation === 'h' ? 'v' : 'h';
}

function renderShipList() {
  const defs = currentSpFleet().ships;
  shipListEl.innerHTML = '';
  defs.forEach((def, i) => {
    const li = document.createElement('li');
    if (i < placementIndex) li.classList.add('placed');
    else if (i === placementIndex) li.classList.add('active');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'ship-name';
    const dots = document.createElement('span');
    dots.className = 'ship-dots';
    for (let d = 0; d < def.size; d++) {
      const dot = document.createElement('span');
      dots.appendChild(dot);
    }
    nameSpan.appendChild(document.createTextNode(def.name));
    nameSpan.appendChild(dots);
    li.appendChild(nameSpan);
    const sizeLabel = document.createElement('span');
    sizeLabel.textContent = def.size + ' cells';
    li.appendChild(sizeLabel);
    shipListEl.appendChild(li);
  });
}

rotateBtn.addEventListener('click', () => toggleOrientation());
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'r') return;
  if (!placementScreen.classList.contains('hidden') && !playView.classList.contains('hidden')) {
    toggleOrientation();
  } else if (!mpPlacementScreenEl.classList.contains('hidden') && !multiplayerView.classList.contains('hidden')) {
    mp.orientation = mp.orientation === 'h' ? 'v' : 'h';
  }
});

randomBtn.addEventListener('click', () => {
  const n = currentSpBoardSize();
  playerGrid = createEmptyGrid(n);
  playerShips = [];
  randomlyPlaceFleet(playerGrid, playerShips, currentSpFleet(), n);
  placementIndex = currentSpFleet().ships.length;
  refreshPlacementBoardShips();
  renderShipList();
  statusLine.textContent = 'Fleet placed! Click "Start Battle" when ready.';
  startBattleBtn.disabled = false;
});

resetBtn.addEventListener('click', initPlacement);

startBattleBtn.addEventListener('click', startBattle);

/* ---------------------------------------------------------
   Battle screen (single player)
--------------------------------------------------------- */
function startBattle() {
  currentMode = 'single';
  battleBoardSize = currentSpBoardSize();
  battleFleet = currentSpFleet();

  aiGrid = createEmptyGrid(battleBoardSize);
  aiShips = [];
  randomlyPlaceFleet(aiGrid, aiShips, battleFleet, battleBoardSize);
  aiMemory = { mode: 'hunt', stack: [], currentHits: [] };
  battleActive = true;
  playerTurn = true;
  shotsFired = 0;
  hitsLanded = 0;

  placementScreen.classList.add('hidden');
  battleScreen.classList.remove('hidden');

  buildBattleBoard(playerBoardEl, false, battleBoardSize);
  buildBattleBoard(enemyBoardEl, true, battleBoardSize);
  renderPlayerBoard();
  renderEnemyBoard();
  renderFleetStatus(playerFleetStatusEl, playerShips, battleFleet);
  renderFleetStatus(enemyFleetStatusEl, aiShips, battleFleet);
  logListEl.innerHTML = '';
  addLog('Battle begins! Fire when ready.', 'player');
  statusLine.textContent = 'Your turn — fire on enemy waters';
  startTimer();
}

function buildBattleBoard(boardEl, clickable, n) {
  boardEl.innerHTML = '';
  boardEl.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
  boardEl.style.gridTemplateRows = `repeat(${n}, minmax(0, 1fr))`;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      if (clickable) {
        cell.addEventListener('click', () => onEnemyCellClick(r, c));
      } else {
        cell.classList.add('disabled');
      }
      boardEl.appendChild(cell);
    }
  }
}

function renderPlayerBoard() {
  const n = battleBoardSize;
  const cells = playerBoardEl.children;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const gridCell = playerGrid[r][c];
      const el = cells[r * n + c];
      el.className = 'cell disabled';
      if (gridCell.shipId !== null) el.classList.add('ship');
      if (gridCell.state === 'hit') el.classList.add('hit');
      if (gridCell.state === 'miss') el.classList.add('miss');
      if (gridCell.state === 'sunk') el.classList.add('sunk');
    }
  }
}

function renderEnemyBoard() {
  const n = battleBoardSize;
  const cells = enemyBoardEl.children;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const gridCell = aiGrid[r][c];
      const el = cells[r * n + c];
      el.className = 'cell';
      if (gridCell.state === 'hit') el.classList.add('hit');
      if (gridCell.state === 'miss') el.classList.add('miss');
      if (gridCell.state === 'sunk') el.classList.add('sunk');
      if (gridCell.shot) el.classList.add('disabled');
    }
  }
}

function renderFleetStatus(container, ships, fleetDef) {
  container.innerHTML = '';
  fleetDef.ships.forEach(def => {
    const ship = ships.find(s => s.name === def.name);
    const badge = document.createElement('span');
    badge.className = 'badge';
    if (ship && ship.sunk) badge.classList.add('sunk');
    badge.textContent = `${def.name} (${def.size})`;
    container.appendChild(badge);
  });
}

function addLog(message, who) {
  const div = document.createElement('div');
  div.className = 'log-entry ' + who;
  div.textContent = message;
  logListEl.appendChild(div);
  logListEl.scrollTop = logListEl.scrollHeight;
}

function onEnemyCellClick(r, c) {
  if (!battleActive || !playerTurn) return;
  if (aiGrid[r][c].shot) return;

  const result = shootAt(aiGrid, aiShips, r, c);
  shotsFired++;
  if (result.hit) hitsLanded++;
  renderEnemyBoard();

  if (result.sunk) {
    addLog(`You sank the enemy ${result.ship.name}!`, 'player');
    renderFleetStatus(enemyFleetStatusEl, aiShips, battleFleet);
  } else if (result.hit) {
    addLog(`You hit the enemy fleet at ${coordLabel(r, c)}.`, 'player');
  } else {
    addLog(`You missed at ${coordLabel(r, c)}.`, 'player');
  }

  if (allSunk(aiShips, battleFleet.ships.length)) {
    endGame(true);
    return;
  }

  playerTurn = false;
  statusLine.textContent = "Enemy's turn...";
  setTimeout(aiTakeTurn, 700);
}

/* ---------------------------------------------------------
   AI logic — hunt & target with direction tracking
--------------------------------------------------------- */
function pickHuntCell() {
  const n = battleBoardSize;
  const parityCandidates = [];
  const fallbackCandidates = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (playerGrid[r][c].shot) continue;
      fallbackCandidates.push([r, c]);
      if ((r + c) % 2 === 0) parityCandidates.push([r, c]);
    }
  }
  const pool = parityCandidates.length > 0 ? parityCandidates : fallbackCandidates;
  return pool[Math.floor(Math.random() * pool.length)];
}

function validCandidate(r, c) {
  return inBounds(r, c, battleBoardSize) && !playerGrid[r][c].shot;
}

function updateAiStackAfterHit() {
  const hits = aiMemory.currentHits;
  if (hits.length === 1) {
    const [r, c] = hits[0];
    [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
      .filter(([rr, cc]) => validCandidate(rr, cc))
      .forEach(cand => aiMemory.stack.push(cand));
    return;
  }

  const rows = new Set(hits.map(h => h[0]));
  const cols = new Set(hits.map(h => h[1]));

  if (rows.size === 1) {
    const row = [...rows][0];
    const colsArr = hits.map(h => h[1]).sort((a, b) => a - b);
    const left = [row, colsArr[0] - 1];
    const right = [row, colsArr[colsArr.length - 1] + 1];
    aiMemory.stack = [];
    if (validCandidate(...left)) aiMemory.stack.push(left);
    if (validCandidate(...right)) aiMemory.stack.push(right);
  } else if (cols.size === 1) {
    const col = [...cols][0];
    const rowsArr = hits.map(h => h[0]).sort((a, b) => a - b);
    const top = [rowsArr[0] - 1, col];
    const bottom = [rowsArr[rowsArr.length - 1] + 1, col];
    aiMemory.stack = [];
    if (validCandidate(...top)) aiMemory.stack.push(top);
    if (validCandidate(...bottom)) aiMemory.stack.push(bottom);
  }
}

function aiChooseCell() {
  while (aiMemory.stack.length > 0) {
    const [r, c] = aiMemory.stack.pop();
    if (validCandidate(r, c)) return [r, c];
  }
  aiMemory.mode = 'hunt';
  return pickHuntCell();
}

function aiTakeTurn() {
  if (!battleActive) return;
  const [r, c] = aiChooseCell();
  const result = shootAt(playerGrid, playerShips, r, c);
  renderPlayerBoard();

  if (result.hit) {
    aiMemory.mode = 'target';
    aiMemory.currentHits.push([r, c]);
    if (result.sunk) {
      addLog(`Enemy sank your ${result.ship.name}!`, 'ai');
      renderFleetStatus(playerFleetStatusEl, playerShips, battleFleet);
      aiMemory = { mode: 'hunt', stack: [], currentHits: [] };
    } else {
      addLog(`Enemy hit your fleet at ${coordLabel(r, c)}.`, 'ai');
      updateAiStackAfterHit();
    }
  } else {
    addLog(`Enemy missed at ${coordLabel(r, c)}.`, 'ai');
  }

  if (allSunk(playerShips, battleFleet.ships.length)) {
    endGame(false);
    return;
  }

  playerTurn = true;
  statusLine.textContent = 'Your turn — fire on enemy waters';
}

/* ---------------------------------------------------------
   Game over (single player)
--------------------------------------------------------- */
function endGame(playerWon) {
  battleActive = false;
  currentMode = 'single';
  stopTimer();
  const durationSeconds = (Date.now() - battleStartTime) / 1000;
  const accuracy = shotsFired > 0 ? Math.round((hitsLanded / shotsFired) * 100) : 0;
  const name = getPlayerName();

  submitRecord({
    name,
    result: playerWon ? 'win' : 'loss',
    shots: shotsFired,
    hits: hitsLanded,
    accuracy,
    duration: durationSeconds,
  });

  gameOverTitle.textContent = playerWon ? 'Victory!' : 'Defeat';
  gameOverText.textContent = playerWon
    ? 'You sank the entire enemy fleet. Well played, Admiral!'
    : 'The enemy sank your entire fleet. Better luck next time.';
  gameOverStats.textContent = `${shotsFired} shots · ${accuracy}% accuracy · ${formatTime(durationSeconds)}`;
  lastShareText = playerWon
    ? `I just sank the enemy fleet in Battleship! ${shotsFired} shots, ${accuracy}% accuracy, ${formatClock(durationSeconds)}.`
    : `Just played Battleship against the AI — ${shotsFired} shots, ${accuracy}% accuracy. Rematch?`;
  statusLine.textContent = playerWon ? 'You won the battle!' : 'You lost the battle.';
  gameOverModal.classList.remove('hidden');
}

playAgainBtn.addEventListener('click', () => {
  gameOverModal.classList.add('hidden');
  if (currentMode === 'multiplayer') {
    mpReturnToMenu();
    return;
  }
  battleScreen.classList.add('hidden');
  placementScreen.classList.remove('hidden');
  hideTimer();
  initPlacement();
});

/* ---------------------------------------------------------
   Multiplayer
--------------------------------------------------------- */
const mp = {
  code: null,
  role: null,
  boardSize: GameConfig.DEFAULT_BOARD_SIZE,
  fleetKey: GameConfig.DEFAULT_FLEET,
  grid: null,
  ships: [],
  placementIndex: 0,
  orientation: 'h',
  pollTimer: null,
  currentScreen: 'menu',
  lastState: null,
  battleStarted: false,
  lastTurn: null,
};

function currentMpFleet() {
  return GameConfig.FLEET_PRESETS[mp.fleetKey];
}

function mpShowScreen(name) {
  mp.currentScreen = name;
  mpMenuEl.classList.toggle('hidden', name !== 'menu');
  mpWaitingEl.classList.toggle('hidden', name !== 'waiting');
  mpPlacementScreenEl.classList.toggle('hidden', name !== 'placement');
  mpBattleScreenEl.classList.toggle('hidden', name !== 'battle');
}

function mpReturnToMenu() {
  mpStopPolling();
  mp.code = null;
  mp.role = null;
  mp.lastState = null;
  mp.battleStarted = false;
  mp.lastTurn = null;
  hideTimer();
  switchView('multiplayer');
  mpShowScreen('menu');
  mpJoinError.classList.add('hidden');
  mpCodeInput.value = '';
}

mpCreateBtn.addEventListener('click', async () => {
  mpCreateBtn.disabled = true;
  try {
    const res = await fetch('/api/multiplayer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        name: getPlayerName(),
        boardSize: Number(mpBoardSizeSelect.value),
        fleet: mpFleetSelect.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not create game');
    mp.code = data.code;
    mp.role = 'host';
    mp.boardSize = data.boardSize;
    mp.fleetKey = data.fleet;
    mp.lastState = data;
    mpCodeDisplayEl.textContent = data.code;
    mpShowScreen('waiting');
    mpStartPolling();
  } catch (err) {
    alert(err.message || 'Could not create game right now.');
  } finally {
    mpCreateBtn.disabled = false;
  }
});

mpCopyCodeBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(mp.code || '');
    const original = mpCopyCodeBtn.textContent;
    mpCopyCodeBtn.textContent = 'Copied!';
    setTimeout(() => { mpCopyCodeBtn.textContent = original; }, 1500);
  } catch {
    // clipboard unavailable — code is already shown on screen
  }
});

mpJoinBtn.addEventListener('click', async () => {
  const code = mpCodeInput.value.trim().toUpperCase();
  mpJoinError.classList.add('hidden');
  if (code.length !== 6) {
    mpJoinError.textContent = 'Enter the 6-character code.';
    mpJoinError.classList.remove('hidden');
    return;
  }
  mpJoinBtn.disabled = true;
  try {
    const res = await fetch('/api/multiplayer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'join', code, name: getPlayerName() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not join game');
    mp.code = code;
    mp.role = 'guest';
    mp.boardSize = data.boardSize;
    mp.fleetKey = data.fleet;
    mp.lastState = data;
    mpInitPlacement();
    mpShowScreen('placement');
    mpStartPolling();
  } catch (err) {
    mpJoinError.textContent = err.message || 'Could not join game';
    mpJoinError.classList.remove('hidden');
  } finally {
    mpJoinBtn.disabled = false;
  }
});

function mpInitPlacement() {
  mp.grid = createEmptyGrid(mp.boardSize);
  mp.ships = [];
  mp.placementIndex = 0;
  mp.orientation = 'h';
  mpBuildPlacementBoardDom();
  mpRenderShipList();
  mpReadyBtn.disabled = true;
  const first = currentMpFleet().ships[0];
  mpPlacementStatus.textContent = `Place your ${first.name} (${first.size} cells)`;
}

function mpBuildPlacementBoardDom() {
  const n = mp.boardSize;
  mpPlacementBoardEl.innerHTML = '';
  mpPlacementBoardEl.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
  mpPlacementBoardEl.style.gridTemplateRows = `repeat(${n}, minmax(0, 1fr))`;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.addEventListener('mouseenter', () => mpPreviewShip(r, c));
      cell.addEventListener('mouseleave', mpClearPreview);
      cell.addEventListener('click', () => mpAttemptPlace(r, c));
      cell.addEventListener('contextmenu', (e) => { e.preventDefault(); mp.orientation = mp.orientation === 'h' ? 'v' : 'h'; mpPreviewShip(r, c); });
      mpPlacementBoardEl.appendChild(cell);
    }
  }
}

function mpPreviewShip(row, col) {
  const defs = currentMpFleet().ships;
  if (mp.placementIndex >= defs.length) return;
  mpClearPreview();
  const def = defs[mp.placementIndex];
  const n = mp.boardSize;
  const cells = shipCells(row, col, def.size, mp.orientation);
  const valid = canPlace(mp.grid, row, col, def.size, mp.orientation, n);
  const boardCells = mpPlacementBoardEl.children;
  cells.forEach(([r, c]) => {
    if (!inBounds(r, c, n)) return;
    boardCells[r * n + c].classList.add(valid ? 'preview-valid' : 'preview-invalid');
  });
}

function mpClearPreview() {
  Array.from(mpPlacementBoardEl.children).forEach(el => el.classList.remove('preview-valid', 'preview-invalid'));
}

function mpAttemptPlace(row, col) {
  const defs = currentMpFleet().ships;
  if (mp.placementIndex >= defs.length) return;
  const def = defs[mp.placementIndex];
  if (!canPlace(mp.grid, row, col, def.size, mp.orientation, mp.boardSize)) return;
  placeShip(mp.grid, mp.ships, row, col, def.size, mp.orientation, def.name);
  mp.placementIndex++;
  mpRefreshShipsOnBoard();
  mpRenderShipList();
  mpClearPreview();
  if (mp.placementIndex >= defs.length) {
    mpPlacementStatus.textContent = 'Fleet placed! Click Ready when set.';
    mpReadyBtn.disabled = false;
  } else {
    const next = defs[mp.placementIndex];
    mpPlacementStatus.textContent = `Place your ${next.name} (${next.size} cells)`;
  }
}

function mpRefreshShipsOnBoard() {
  const n = mp.boardSize;
  const cells = mpPlacementBoardEl.children;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      cells[r * n + c].classList.toggle('ship', mp.grid[r][c].shipId !== null);
    }
  }
}

function mpRenderShipList() {
  const defs = currentMpFleet().ships;
  mpShipListEl.innerHTML = '';
  defs.forEach((def, i) => {
    const li = document.createElement('li');
    if (i < mp.placementIndex) li.classList.add('placed');
    else if (i === mp.placementIndex) li.classList.add('active');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'ship-name';
    const dots = document.createElement('span');
    dots.className = 'ship-dots';
    for (let d = 0; d < def.size; d++) dots.appendChild(document.createElement('span'));
    nameSpan.appendChild(document.createTextNode(def.name));
    nameSpan.appendChild(dots);
    li.appendChild(nameSpan);
    const sizeLabel = document.createElement('span');
    sizeLabel.textContent = def.size + ' cells';
    li.appendChild(sizeLabel);
    mpShipListEl.appendChild(li);
  });
}

mpRotateBtn.addEventListener('click', () => { mp.orientation = mp.orientation === 'h' ? 'v' : 'h'; });

mpRandomBtn.addEventListener('click', () => {
  mp.grid = createEmptyGrid(mp.boardSize);
  mp.ships = [];
  randomlyPlaceFleet(mp.grid, mp.ships, currentMpFleet(), mp.boardSize);
  mp.placementIndex = currentMpFleet().ships.length;
  mpRefreshShipsOnBoard();
  mpRenderShipList();
  mpPlacementStatus.textContent = 'Fleet placed! Click Ready when set.';
  mpReadyBtn.disabled = false;
});

mpResetBtn.addEventListener('click', mpInitPlacement);

mpReadyBtn.addEventListener('click', async () => {
  mpReadyBtn.disabled = true;
  try {
    const res = await fetch('/api/multiplayer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'submitFleet',
        code: mp.code,
        role: mp.role,
        ships: mp.ships.map(s => ({ name: s.name, cells: s.cells })),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not submit fleet');
    mp.lastState = data;
    mpPlacementStatus.textContent = 'Waiting for opponent to finish placing ships...';
    mpApplyState(data);
  } catch (err) {
    mpPlacementStatus.textContent = err.message || 'Could not submit fleet — try again.';
    mpReadyBtn.disabled = false;
  }
});

function mpStartPolling() {
  mpStopPolling();
  mp.pollTimer = setInterval(mpPoll, 1500);
  mpPoll();
}

function mpStopPolling() {
  if (mp.pollTimer) clearInterval(mp.pollTimer);
  mp.pollTimer = null;
}

async function mpPoll() {
  if (!mp.code) return;
  try {
    const res = await fetch(`/api/multiplayer?code=${encodeURIComponent(mp.code)}&role=${mp.role}`);
    if (!res.ok) return;
    const state = await res.json();
    mpApplyState(state);
  } catch (err) {
    console.warn('multiplayer poll failed:', err);
  }
}

function mpApplyState(state) {
  mp.lastState = state;

  if (state.status === 'waiting') return;

  if (state.status === 'placing') {
    if (mp.currentScreen !== 'placement') {
      mpInitPlacement();
      mpShowScreen('placement');
    }
    const me = state.role === 'host' ? state.host : state.guest;
    const opp = state.role === 'host' ? state.guest : state.host;
    if (me && me.ready) {
      mpPlacementStatus.textContent = (opp && opp.ready)
        ? 'Both ready — starting battle...'
        : 'Waiting for opponent to finish placing ships...';
    } else if (opp && opp.ready) {
      mpPlacementStatus.textContent = 'Opponent is ready! Finish placing your fleet.';
    }
    return;
  }

  if (state.status === 'battle' || state.status === 'finished') {
    if (mp.currentScreen !== 'battle') {
      mpEnterBattle();
    }
    mpRenderBattle(state);
    if (state.status === 'finished') {
      mpStopPolling();
      mpEndGame(state.winner === mp.role, state);
    }
  }
}

function mpEnterBattle() {
  mpBuildBoard(mpMyBoardEl, mp.boardSize, false, null);
  mpBuildBoard(mpEnemyBoardEl, mp.boardSize, true, mpFireAt);
  mpShowScreen('battle');
  if (!mp.battleStarted) {
    mp.battleStarted = true;
    startTimer();
  }
}

function mpBuildBoard(boardEl, n, clickable, onClick) {
  boardEl.innerHTML = '';
  boardEl.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
  boardEl.style.gridTemplateRows = `repeat(${n}, minmax(0, 1fr))`;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell' + (clickable ? '' : ' disabled');
      cell.dataset.row = r;
      cell.dataset.col = c;
      if (clickable) cell.addEventListener('click', () => onClick(r, c));
      boardEl.appendChild(cell);
    }
  }
}

async function mpFireAt(r, c) {
  const state = mp.lastState;
  if (!state || state.status !== 'battle' || state.turn !== mp.role) return;
  if ((state.myShotsFired || []).some(s => s.r === r && s.c === c)) return;
  try {
    const res = await fetch('/api/multiplayer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fire', code: mp.code, role: mp.role, r, c }),
    });
    const data = await res.json();
    if (res.ok) mpApplyState(data);
  } catch (err) {
    console.warn('fire failed:', err);
  }
}

function mpRenderBattle(state) {
  const n = mp.boardSize;

  const myShipCells = new Set();
  (state.myShips || []).forEach(ship => ship.cells.forEach(([r, c]) => myShipCells.add(`${r},${c}`)));
  const incomingMap = new Map();
  (state.myIncomingShots || []).forEach(s => incomingMap.set(`${s.r},${s.c}`, s));

  const myCells = mpMyBoardEl.children;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const el = myCells[r * n + c];
      el.className = 'cell disabled';
      if (myShipCells.has(`${r},${c}`)) el.classList.add('ship');
      const shot = incomingMap.get(`${r},${c}`);
      if (shot) {
        if (shot.sunkShip) el.classList.add('sunk');
        else if (shot.hit) el.classList.add('hit');
        else el.classList.add('miss');
      }
    }
  }

  const myShotsMap = new Map();
  (state.myShotsFired || []).forEach(s => myShotsMap.set(`${s.r},${s.c}`, s));
  const canFire = state.status === 'battle' && state.turn === mp.role;
  const enemyCells = mpEnemyBoardEl.children;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const el = enemyCells[r * n + c];
      const shot = myShotsMap.get(`${r},${c}`);
      el.className = 'cell';
      if (shot) {
        el.classList.add('disabled');
        if (shot.sunkShip) el.classList.add('sunk');
        else if (shot.hit) el.classList.add('hit');
        else el.classList.add('miss');
      } else if (!canFire) {
        el.classList.add('disabled');
      }
    }
  }

  const oppName = mpOpponentName(state);
  mpMyBoardLabel.textContent = 'Your Fleet';
  mpEnemyBoardLabel.textContent = `${oppName}'s Waters`;
  mpUpdateTurnLights(state, oppName);

  mpLogListEl.innerHTML = '';
  (state.log || []).forEach(entry => {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.textContent = entry;
    mpLogListEl.appendChild(div);
  });
  mpLogListEl.scrollTop = mpLogListEl.scrollHeight;
}

function mpOpponentName(state) {
  const opp = state.role === 'host' ? state.guest : state.host;
  return (opp && opp.name) || 'Opponent';
}

function mpUpdateTurnLights(state, oppName) {
  mpTurnLightOpponentName.textContent = oppName;

  const turnChanged = mp.lastTurn !== null && mp.lastTurn !== state.turn;
  mp.lastTurn = state.turn;

  const myUnit = mpTurnLightMe;
  const oppUnit = mpTurnLightOpponent;
  myUnit.classList.remove('active', 'finished-win', 'flash');
  oppUnit.classList.remove('active', 'finished-win', 'flash');

  if (state.status === 'finished') {
    const iWon = state.winner === mp.role;
    (iWon ? myUnit : oppUnit).classList.add('finished-win');
    return;
  }

  const myTurn = state.turn === mp.role;
  (myTurn ? myUnit : oppUnit).classList.add('active');

  if (turnChanged) {
    // briefly pulse whichever light just turned on, so a move that just
    // happened is obvious even though the client only learns about it on
    // the next poll tick.
    const changedUnit = myTurn ? myUnit : oppUnit;
    changedUnit.classList.add('flash');
    setTimeout(() => changedUnit.classList.remove('flash'), 600);
  }
}

function mpEndGame(iWon, state) {
  battleActive = false;
  currentMode = 'multiplayer';
  stopTimer();

  const shots = (state.myShotsFired || []).length;
  const hits = (state.myShotsFired || []).filter(s => s.hit).length;
  const accuracy = shots > 0 ? Math.round((hits / shots) * 100) : 0;
  const durationSeconds = (Date.now() - battleStartTime) / 1000;
  const oppName = mpOpponentName(state);

  gameOverTitle.textContent = iWon ? 'Victory!' : 'Defeat';
  gameOverText.textContent = iWon
    ? `You sank ${oppName}'s entire fleet!`
    : `${oppName} sank your entire fleet.`;
  gameOverStats.textContent = `${shots} shots · ${accuracy}% accuracy · ${formatTime(durationSeconds)}`;
  lastShareText = iWon
    ? `I just beat ${oppName} in Battleship! ${shots} shots, ${accuracy}% accuracy.`
    : `Just played Battleship against ${oppName} — good game!`;
  gameOverModal.classList.remove('hidden');
}

/* ---------------------------------------------------------
   Boot
--------------------------------------------------------- */
initPlacement();
mpShowScreen('menu');
