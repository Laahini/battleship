'use strict';

/* ---------------------------------------------------------
   Config
--------------------------------------------------------- */
const SIZE = 10;
const SHIP_DEFS = [
  { name: 'Carrier', size: 5 },
  { name: 'Battleship', size: 4 },
  { name: 'Cruiser', size: 3 },
  { name: 'Submarine', size: 3 },
  { name: 'Destroyer', size: 2 },
];

/* ---------------------------------------------------------
   State
--------------------------------------------------------- */
let playerGrid, aiGrid;
let playerShips, aiShips;
let placementIndex = 0;
let orientation = 'h'; // 'h' or 'v'
let battleActive = false;
let playerTurn = true;

let aiMemory = { mode: 'hunt', stack: [], currentHits: [] };

let shotsFired = 0;
let hitsLanded = 0;
let battleStartTime = 0;

const PLAYER_NAME_KEY = 'battleship_playerName';

/* ---------------------------------------------------------
   DOM refs
--------------------------------------------------------- */
const statusLine = document.getElementById('statusLine');
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
const gameOverModal = document.getElementById('gameOverModal');
const gameOverTitle = document.getElementById('gameOverTitle');
const gameOverText = document.getElementById('gameOverText');
const gameOverStats = document.getElementById('gameOverStats');
const playAgainBtn = document.getElementById('playAgainBtn');
const viewLeaderboardBtn = document.getElementById('viewLeaderboardBtn');

const navLinks = document.querySelectorAll('.nav-link');
const playView = document.getElementById('playView');
const leaderboardView = document.getElementById('leaderboardView');
const playerNameInput = document.getElementById('playerNameInput');
const bestWinsBody = document.getElementById('bestWinsBody');
const bestWinsEmpty = document.getElementById('bestWinsEmpty');
const recentGamesBody = document.getElementById('recentGamesBody');
const recentGamesEmpty = document.getElementById('recentGamesEmpty');

/* ---------------------------------------------------------
   Grid helpers
--------------------------------------------------------- */
function createEmptyGrid() {
  return Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => ({ shipId: null, shot: false, state: null }))
  );
}

function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

function shipCells(row, col, size, orient) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    const r = orient === 'h' ? row : row + i;
    const c = orient === 'h' ? col + i : col;
    cells.push([r, c]);
  }
  return cells;
}

function canPlace(grid, row, col, size, orient) {
  const cells = shipCells(row, col, size, orient);
  return cells.every(([r, c]) => inBounds(r, c) && grid[r][c].shipId === null);
}

function placeShip(grid, ships, row, col, size, orient, name) {
  const cells = shipCells(row, col, size, orient);
  const id = ships.length;
  cells.forEach(([r, c]) => { grid[r][c].shipId = id; });
  ships.push({ id, name, size, cells, hits: 0, sunk: false });
}

function randomlyPlaceFleet(grid, ships) {
  for (const def of SHIP_DEFS) {
    let placed = false;
    while (!placed) {
      const orient = Math.random() < 0.5 ? 'h' : 'v';
      const row = Math.floor(Math.random() * SIZE);
      const col = Math.floor(Math.random() * SIZE);
      if (canPlace(grid, row, col, def.size, orient)) {
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

function allSunk(ships) {
  return ships.length === SHIP_DEFS.length && ships.every(s => s.sunk);
}

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
  leaderboardView.classList.toggle('hidden', target !== 'leaderboard');
  statusLine.style.display = target === 'play' ? '' : 'none';
  if (target === 'leaderboard') renderLeaderboard();
}

navLinks.forEach(link => {
  link.addEventListener('click', () => switchView(link.dataset.nav));
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

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

viewLeaderboardBtn.addEventListener('click', () => {
  gameOverModal.classList.add('hidden');
  switchView('leaderboard');
});

/* ---------------------------------------------------------
   Placement screen
--------------------------------------------------------- */
function initPlacement() {
  playerGrid = createEmptyGrid();
  playerShips = [];
  placementIndex = 0;
  orientation = 'h';
  renderShipList();
  buildPlacementBoard();
  startBattleBtn.disabled = true;
  statusLine.textContent = `Place your ${SHIP_DEFS[0].name} (${SHIP_DEFS[0].size} cells)`;
}

function buildPlacementBoard() {
  placementBoardEl.innerHTML = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
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
  const cells = placementBoardEl.children;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const el = cells[r * SIZE + c];
      el.classList.toggle('ship', playerGrid[r][c].shipId !== null);
    }
  }
}

function previewShip(row, col) {
  if (placementIndex >= SHIP_DEFS.length) return;
  clearPreview();
  const def = SHIP_DEFS[placementIndex];
  const cells = shipCells(row, col, def.size, orientation);
  const valid = canPlace(playerGrid, row, col, def.size, orientation);
  const boardCells = placementBoardEl.children;
  cells.forEach(([r, c]) => {
    if (!inBounds(r, c)) return;
    const el = boardCells[r * SIZE + c];
    el.classList.add(valid ? 'preview-valid' : 'preview-invalid');
  });
}

function clearPreview() {
  Array.from(placementBoardEl.children).forEach(el => {
    el.classList.remove('preview-valid', 'preview-invalid');
  });
}

function attemptPlace(row, col) {
  if (placementIndex >= SHIP_DEFS.length) return;
  const def = SHIP_DEFS[placementIndex];
  if (!canPlace(playerGrid, row, col, def.size, orientation)) return;
  placeShip(playerGrid, playerShips, row, col, def.size, orientation, def.name);
  placementIndex++;
  refreshPlacementBoardShips();
  renderShipList();
  clearPreview();
  if (placementIndex >= SHIP_DEFS.length) {
    statusLine.textContent = 'Fleet placed! Click "Start Battle" when ready.';
    startBattleBtn.disabled = false;
  } else {
    const next = SHIP_DEFS[placementIndex];
    statusLine.textContent = `Place your ${next.name} (${next.size} cells)`;
  }
}

function toggleOrientation() {
  orientation = orientation === 'h' ? 'v' : 'h';
}

function renderShipList() {
  shipListEl.innerHTML = '';
  SHIP_DEFS.forEach((def, i) => {
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
  if (e.key.toLowerCase() === 'r' && !placementScreen.classList.contains('hidden')) {
    toggleOrientation();
  }
});

randomBtn.addEventListener('click', () => {
  playerGrid = createEmptyGrid();
  playerShips = [];
  randomlyPlaceFleet(playerGrid, playerShips);
  placementIndex = SHIP_DEFS.length;
  refreshPlacementBoardShips();
  renderShipList();
  statusLine.textContent = 'Fleet placed! Click "Start Battle" when ready.';
  startBattleBtn.disabled = false;
});

resetBtn.addEventListener('click', initPlacement);

startBattleBtn.addEventListener('click', startBattle);

/* ---------------------------------------------------------
   Battle screen
--------------------------------------------------------- */
function startBattle() {
  aiGrid = createEmptyGrid();
  aiShips = [];
  randomlyPlaceFleet(aiGrid, aiShips);
  aiMemory = { mode: 'hunt', stack: [], currentHits: [] };
  battleActive = true;
  playerTurn = true;
  shotsFired = 0;
  hitsLanded = 0;
  battleStartTime = Date.now();

  placementScreen.classList.add('hidden');
  battleScreen.classList.remove('hidden');

  buildBattleBoard(playerBoardEl, false);
  buildBattleBoard(enemyBoardEl, true);
  renderPlayerBoard();
  renderEnemyBoard();
  renderFleetStatus(playerFleetStatusEl, playerShips);
  renderFleetStatus(enemyFleetStatusEl, aiShips);
  logListEl.innerHTML = '';
  addLog('Battle begins! Fire when ready.', 'player');
  statusLine.textContent = 'Your turn — fire on enemy waters';
}

function buildBattleBoard(boardEl, clickable) {
  boardEl.innerHTML = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
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
  const cells = playerBoardEl.children;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const gridCell = playerGrid[r][c];
      const el = cells[r * SIZE + c];
      el.className = 'cell disabled';
      if (gridCell.shipId !== null) el.classList.add('ship');
      if (gridCell.state === 'hit') el.classList.add('hit');
      if (gridCell.state === 'miss') el.classList.add('miss');
      if (gridCell.state === 'sunk') el.classList.add('sunk');
    }
  }
}

function renderEnemyBoard() {
  const cells = enemyBoardEl.children;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const gridCell = aiGrid[r][c];
      const el = cells[r * SIZE + c];
      el.className = 'cell';
      if (gridCell.state === 'hit') el.classList.add('hit');
      if (gridCell.state === 'miss') el.classList.add('miss');
      if (gridCell.state === 'sunk') el.classList.add('sunk');
      if (gridCell.shot) el.classList.add('disabled');
    }
  }
}

function renderFleetStatus(container, ships) {
  container.innerHTML = '';
  SHIP_DEFS.forEach(def => {
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
    renderFleetStatus(enemyFleetStatusEl, aiShips);
  } else if (result.hit) {
    addLog(`You hit the enemy fleet at ${coordLabel(r, c)}.`, 'player');
  } else {
    addLog(`You missed at ${coordLabel(r, c)}.`, 'player');
  }

  if (allSunk(aiShips)) {
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
function cellKey(r, c) { return r + ',' + c; }

function pickHuntCell() {
  const parityCandidates = [];
  const fallbackCandidates = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (playerGrid[r][c].shot) continue;
      fallbackCandidates.push([r, c]);
      if ((r + c) % 2 === 0) parityCandidates.push([r, c]);
    }
  }
  const pool = parityCandidates.length > 0 ? parityCandidates : fallbackCandidates;
  return pool[Math.floor(Math.random() * pool.length)];
}

function validCandidate(r, c) {
  return inBounds(r, c) && !playerGrid[r][c].shot;
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
      renderFleetStatus(playerFleetStatusEl, playerShips);
      aiMemory = { mode: 'hunt', stack: [], currentHits: [] };
    } else {
      addLog(`Enemy hit your fleet at ${coordLabel(r, c)}.`, 'ai');
      updateAiStackAfterHit();
    }
  } else {
    addLog(`Enemy missed at ${coordLabel(r, c)}.`, 'ai');
  }

  if (allSunk(playerShips)) {
    endGame(false);
    return;
  }

  playerTurn = true;
  statusLine.textContent = 'Your turn — fire on enemy waters';
}

function coordLabel(r, c) {
  const letters = 'ABCDEFGHIJ';
  return letters[c] + (r + 1);
}

/* ---------------------------------------------------------
   Game over / reset
--------------------------------------------------------- */
function endGame(playerWon) {
  battleActive = false;
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
    date: Date.now(),
  });

  gameOverTitle.textContent = playerWon ? 'Victory!' : 'Defeat';
  gameOverText.textContent = playerWon
    ? 'You sank the entire enemy fleet. Well played, Admiral!'
    : 'The enemy sank your entire fleet. Better luck next time.';
  gameOverStats.textContent = `${shotsFired} shots · ${accuracy}% accuracy · ${formatTime(durationSeconds)}`;
  statusLine.textContent = playerWon ? 'You won the battle!' : 'You lost the battle.';
  gameOverModal.classList.remove('hidden');
}

playAgainBtn.addEventListener('click', () => {
  gameOverModal.classList.add('hidden');
  battleScreen.classList.add('hidden');
  placementScreen.classList.remove('hidden');
  initPlacement();
});

/* ---------------------------------------------------------
   Boot
--------------------------------------------------------- */
initPlacement();
