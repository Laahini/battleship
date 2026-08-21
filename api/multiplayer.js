const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('crypto');
const { BOARD_SIZES, FLEET_PRESETS, DEFAULT_BOARD_SIZE, DEFAULT_FLEET } = require('../config.js');

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'battleship-leaderboard';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — avoids ambiguity
const GAME_TTL_SECONDS = 6 * 60 * 60; // abandoned games expire after 6h (requires TTL enabled on `expiresAt`)

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);

function makeCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function cleanName(name) {
  return String(name || 'Captain').trim().slice(0, 24) || 'Captain';
}

function coordLabel(r, c) {
  const letters = 'ABCDEFGHIJKL';
  return letters[c] + (r + 1);
}

function isStraightContiguous(cells) {
  const rows = cells.map(c => c[0]);
  const cols = cells.map(c => c[1]);
  const sameRow = rows.every(r => r === rows[0]);
  const sameCol = cols.every(c => c === cols[0]);
  if (sameRow) {
    const sorted = [...cols].sort((a, b) => a - b);
    return sorted.every((c, i) => i === 0 || c === sorted[i - 1] + 1);
  }
  if (sameCol) {
    const sorted = [...rows].sort((a, b) => a - b);
    return sorted.every((r, i) => i === 0 || r === sorted[i - 1] + 1);
  }
  return false;
}

function validateFleet(boardSize, fleetKey, ships) {
  const fleetDef = FLEET_PRESETS[fleetKey];
  if (!fleetDef || !Array.isArray(ships) || ships.length !== fleetDef.ships.length) return false;

  const expectedSizes = fleetDef.ships.map(s => s.size).sort((a, b) => a - b);
  const gotSizes = ships.map(s => (Array.isArray(s.cells) ? s.cells.length : -1)).sort((a, b) => a - b);
  if (JSON.stringify(expectedSizes) !== JSON.stringify(gotSizes)) return false;

  const occupied = Array.from({ length: boardSize }, () => Array(boardSize).fill(false));
  for (const ship of ships) {
    if (!Array.isArray(ship.cells) || ship.cells.length === 0) return false;
    for (const cell of ship.cells) {
      if (!Array.isArray(cell) || cell.length !== 2) return false;
      const [r, c] = cell;
      if (!Number.isInteger(r) || !Number.isInteger(c)) return false;
      if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) return false;
      if (occupied[r][c]) return false; // overlap
      occupied[r][c] = true;
    }
    if (ship.cells.length > 1 && !isStraightContiguous(ship.cells)) return false;
  }
  return true;
}

function shipsSunk(ships, shotsFired) {
  const hitSet = new Set(shotsFired.filter(s => s.hit).map(s => `${s.r},${s.c}`));
  return ships.every(ship => ship.cells.every(([r, c]) => hitSet.has(`${r},${c}`)));
}

function publicSide(side) {
  if (!side) return null;
  return { name: side.name, ready: side.ready };
}

function buildStateResponse(game, role) {
  const me = game[role];
  const opponentRole = role === 'host' ? 'guest' : 'host';
  const opponent = game[opponentRole];

  const base = {
    code: game.code,
    boardSize: game.boardSize,
    fleet: game.fleet,
    status: game.status,
    turn: game.turn,
    winner: game.winner,
    role,
    host: publicSide(game.host),
    guest: publicSide(game.guest),
    log: game.log || [],
    version: game.version,
  };

  if (me) {
    base.myShips = me.ships || null;
    base.myIncomingShots = opponent ? opponent.shotsFired || [] : [];
    base.myShotsFired = me.shotsFired || [];
  }

  if (game.status === 'finished' && opponent) {
    base.opponentShips = opponent.ships || null;
  }

  return base;
}

async function loadGame(code) {
  const out = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { id: `GAME#${code}` } }));
  return out.Item || null;
}

async function handleCreate(req, res) {
  const boardSize = BOARD_SIZES.includes(Number(req.body.boardSize)) ? Number(req.body.boardSize) : DEFAULT_BOARD_SIZE;
  const fleet = FLEET_PRESETS[req.body.fleet] ? req.body.fleet : DEFAULT_FLEET;
  const name = cleanName(req.body.name);

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = makeCode();
    const now = Date.now();
    const item = {
      id: `GAME#${code}`,
      type: 'game',
      code,
      boardSize,
      fleet,
      status: 'waiting',
      turn: 'host',
      winner: null,
      host: { name, ships: null, shotsFired: [], ready: false },
      guest: null,
      log: [`${name} created the game.`],
      version: 1,
      createdAt: now,
      expiresAt: Math.floor(now / 1000) + GAME_TTL_SECONDS,
    };
    try {
      await ddb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: 'attribute_not_exists(id)',
      }));
      return res.status(201).json(buildStateResponse(item, 'host'));
    } catch (err) {
      if (err.name !== 'ConditionalCheckFailedException') throw err;
      // code collision — retry with a new code
    }
  }
  res.status(500).json({ error: 'Could not allocate a game code, try again' });
}

async function handleJoin(req, res) {
  const code = String(req.body.code || '').trim().toUpperCase();
  const name = cleanName(req.body.name);
  const game = await loadGame(code);

  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.guest) return res.status(409).json({ error: 'Game is already full' });
  if (game.status !== 'waiting') return res.status(409).json({ error: 'Game already started' });

  try {
    const out = await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: `GAME#${code}` },
      UpdateExpression: 'SET guest = :guest, #status = :placing, version = version + :one, #log = list_append(#log, :entry)',
      ConditionExpression: 'attribute_not_exists(guest) AND #status = :waiting AND version = :v',
      ExpressionAttributeNames: { '#status': 'status', '#log': 'log' },
      ExpressionAttributeValues: {
        ':guest': { name, ships: null, shotsFired: [], ready: false },
        ':placing': 'placing',
        ':waiting': 'waiting',
        ':one': 1,
        ':v': game.version,
        ':entry': [`${name} joined the game.`],
      },
      ReturnValues: 'ALL_NEW',
    }));
    return res.status(200).json(buildStateResponse(out.Attributes, 'guest'));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return res.status(409).json({ error: 'Game just became unavailable, try again' });
    }
    throw err;
  }
}

async function handleSubmitFleet(req, res) {
  const code = String(req.body.code || '').trim().toUpperCase();
  const role = req.body.role === 'guest' ? 'guest' : 'host';
  const ships = req.body.ships;

  const game = await loadGame(code);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (!game[role]) return res.status(400).json({ error: 'You are not in this game' });
  if (game.status !== 'placing' && game.status !== 'waiting') {
    return res.status(409).json({ error: 'Fleet already locked in' });
  }
  if (!validateFleet(game.boardSize, game.fleet, ships)) {
    return res.status(400).json({ error: 'Invalid fleet placement' });
  }

  const otherRole = role === 'host' ? 'guest' : 'host';
  const bothReady = Boolean(game[otherRole] && game[otherRole].ready);

  const updated = {
    ...game,
    [role]: { ...game[role], ships, ready: true },
    version: game.version + 1,
  };
  if (bothReady) {
    updated.status = 'battle';
    updated.turn = 'host';
    updated.log = [...(game.log || []), 'Both fleets locked in. Battle begins!'];
  } else {
    updated.log = [...(game.log || []), `${game[role].name} is ready.`];
  }

  try {
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: updated,
      ConditionExpression: 'version = :v',
      ExpressionAttributeValues: { ':v': game.version },
    }));
    return res.status(200).json(buildStateResponse(updated, role));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return res.status(409).json({ error: 'State changed, please retry' });
    }
    throw err;
  }
}

async function handleFire(req, res) {
  const code = String(req.body.code || '').trim().toUpperCase();
  const role = req.body.role === 'guest' ? 'guest' : 'host';
  const r = Number(req.body.r);
  const c = Number(req.body.c);

  const game = await loadGame(code);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.status !== 'battle') return res.status(409).json({ error: 'Game is not in battle phase' });
  if (game.turn !== role) return res.status(409).json({ error: 'Not your turn' });

  const opponentRole = role === 'host' ? 'guest' : 'host';
  const opponent = game[opponentRole];
  const me = game[role];
  if (!opponent || !Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= game.boardSize || c < 0 || c >= game.boardSize) {
    return res.status(400).json({ error: 'Invalid shot' });
  }
  if (me.shotsFired.some(s => s.r === r && s.c === c)) {
    return res.status(409).json({ error: 'Already fired there' });
  }

  const hitShip = opponent.ships.find(ship => ship.cells.some(([sr, sc]) => sr === r && sc === c));
  const shot = { r, c, hit: Boolean(hitShip), sunkShip: null };
  let newShotsFired = [...me.shotsFired, shot];

  let sunkName = null;
  if (hitShip) {
    const hitSet = new Set(newShotsFired.filter(s => s.hit).map(s => `${s.r},${s.c}`));
    const isSunk = hitShip.cells.every(([sr, sc]) => hitSet.has(`${sr},${sc}`));
    if (isSunk) {
      sunkName = hitShip.name;
      // retroactively tag every shot (from earlier turns too) that belongs to this
      // now-fully-sunk ship, so the client can render it without ever seeing the
      // opponent's full fleet layout ahead of time.
      const shipCellSet = new Set(hitShip.cells.map(([sr, sc]) => `${sr},${sc}`));
      newShotsFired = newShotsFired.map(s => (shipCellSet.has(`${s.r},${s.c}`) ? { ...s, sunkShip: sunkName } : s));
    }
  }

  const allSunk = shipsSunk(opponent.ships, newShotsFired);
  const meName = me.name;
  const label = coordLabel(r, c);
  let logEntry = `${meName} fired at ${label} — ${shot.hit ? 'hit' : 'miss'}.`;
  if (sunkName) logEntry = `${meName} fired at ${label} and sank the ${sunkName}!`;
  if (allSunk) logEntry += ` ${meName} wins!`;

  const updated = {
    ...game,
    [role]: { ...me, shotsFired: newShotsFired },
    turn: allSunk ? game.turn : opponentRole,
    status: allSunk ? 'finished' : 'battle',
    winner: allSunk ? role : null,
    version: game.version + 1,
    log: [...(game.log || []).slice(-30), logEntry],
  };

  try {
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: updated,
      ConditionExpression: 'version = :v',
      ExpressionAttributeValues: { ':v': game.version },
    }));
    return res.status(200).json(buildStateResponse(updated, role));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return res.status(409).json({ error: 'State changed, please retry' });
    }
    throw err;
  }
}

async function handleState(req, res) {
  const code = String(req.query.code || '').trim().toUpperCase();
  const role = req.query.role === 'guest' ? 'guest' : 'host';
  const game = await loadGame(code);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  res.status(200).json(buildStateResponse(game, role));
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      const action = req.body && req.body.action;
      if (action === 'create') return await handleCreate(req, res);
      if (action === 'join') return await handleJoin(req, res);
      if (action === 'submitFleet') return await handleSubmitFleet(req, res);
      if (action === 'fire') return await handleFire(req, res);
      return res.status(400).json({ error: 'Unknown action' });
    }
    if (req.method === 'GET') return await handleState(req, res);
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('multiplayer api error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
