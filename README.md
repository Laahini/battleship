# Battleship

A browser-based Battleship game — play against an AI opponent (hunt/target
strategy with checkerboard-parity search), or challenge a friend in real
multiplayer with a shareable game code. Configurable board size (8/10/12)
and fleet size (3/5/7 ships). Global leaderboard and multiplayer state are
both backed by a single AWS DynamoDB table, served through Vercel
serverless functions.

## Architecture

```
Browser (index.html / game.js / config.js)
        │  fetch() — polling, ~1.5s interval, no WebSockets
        ▼
Vercel Serverless Functions (Node.js runtime, AWS SDK v3)
        ├─ api/leaderboard.js   GET/POST leaderboard entries
        └─ api/multiplayer.js   create/join/submitFleet/fire + GET state
        │
        ▼
Amazon DynamoDB table "battleship-leaderboard"  (single-table design)
        │
        ├─ Leaderboard items:  id = <uuid>
        │     ├─ GSI ResultShotsIndex:  PK result ("win"/"loss")  SK shots (N)
        │     │     → Query(result="win"), ScanIndexForward=true  = "Best Wins"
        │     └─ GSI AllDateIndex:      PK gsiPk ("ALL")           SK date (N)
        │           → Query(gsiPk="ALL"), ScanIndexForward=false  = "Recent Games"
        │
        └─ Multiplayer game items:  id = "GAME#<6-char code>"
              ├─ host / guest: { name, ships, shotsFired, ready }
              ├─ status: waiting → placing → battle → finished
              └─ version: optimistic-concurrency counter (conditional writes)
```

One table, two item shapes, distinguished by `id` prefix and served by
different access patterns — standard single-table DynamoDB design rather
than a table per entity type.

**Multiplayer is server-authoritative.** Each player only ever submits
their own fleet; the server stores it, and `api/multiplayer.js` resolves
every shot against the *stored* opponent fleet, not anything the client
claims. `validateFleet()` independently checks ship count, sizes,
in-bounds, no overlaps, and that every ship is a straight contiguous line
before accepting a submitted fleet — a client can't place ships out of
bounds, overlapping, bent, or lie about a hit. Turn order and duplicate
shots are also enforced server-side. There's no WebSocket layer (Vercel
functions are request/response, not long-lived connections), so the client
polls `GET /api/multiplayer` every ~1.5s while a game is in progress.

## Stack

- **Frontend**: vanilla HTML/CSS/JS, no build step
- **Backend**: Vercel serverless functions, Node.js, AWS SDK v3
- **Database**: AWS DynamoDB (on-demand / `PAY_PER_REQUEST`)
- **Hosting/CI**: Vercel, auto-deploys on push to `main`

## API

**Leaderboard**
- `GET /api/leaderboard?type=best` — top 10 wins, sorted by fewest shots
- `GET /api/leaderboard?type=recent` — last 15 games, newest first
- `POST /api/leaderboard` — `{ name, result, shots, hits, accuracy, duration }`

**Multiplayer** (`POST /api/multiplayer`, `action` in body; state via `GET /api/multiplayer?code&role`)
- `action: "create"` — `{ name, boardSize, fleet }` → `{ code, role: "host", ... }`
- `action: "join"` — `{ code, name }` → `{ role: "guest", ... }`
- `action: "submitFleet"` — `{ code, role, ships }`, server-validated
- `action: "fire"` — `{ code, role, r, c }`, turn-checked and resolved server-side

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create an IAM user for this app

In the AWS Console → IAM → Users → **Create user**:

- Name: `battleship-app` (programmatic access only, no console login)
- Attach this **inline policy** (replace `REGION` and `ACCOUNT_ID`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LeaderboardAndGameTableAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query",
        "dynamodb:DescribeTable"
      ],
      "Resource": [
        "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/battleship-leaderboard",
        "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/battleship-leaderboard/index/*"
      ]
    },
    {
      "Sid": "TableProvisioning",
      "Effect": "Allow",
      "Action": ["dynamodb:CreateTable"],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/battleship-leaderboard"
    }
  ]
}
```

(`GetItem`/`UpdateItem` are needed for multiplayer game state — the
leaderboard alone only ever needs `PutItem`/`Query`.)

- Create an **access key** for the user (use case: "Application running outside AWS").
- Save the Access Key ID and Secret Access Key — the secret is shown only once.

### 3. Create the DynamoDB table

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-east-1
npm run create-table
```

This runs `scripts/create-table.mjs`, which provisions the table and both
GSIs shown above. Safe to re-run — it no-ops if the table already exists.

Optional: enable TTL on the `expiresAt` attribute (Console → table →
Additional settings → Time to Live) so abandoned/unfinished multiplayer
games are automatically cleaned up after 6 hours. Not required for
functionality — games just persist as ordinary items without it.

### 4. Configure Vercel environment variables

In the Vercel project → Settings → Environment Variables, add (Production +
Preview):

| Key                     | Value                         |
| ------------------------ | ------------------------------ |
| `AWS_ACCESS_KEY_ID`      | from step 2                    |
| `AWS_SECRET_ACCESS_KEY`  | from step 2                    |
| `AWS_REGION`             | e.g. `us-east-1`               |
| `DYNAMODB_TABLE_NAME`    | `battleship-leaderboard`       |

Add these directly in the Vercel dashboard rather than pasting them
anywhere else — they never need to touch the repo or local shell history
beyond step 3.

Trigger a redeploy after adding them (Vercel → Deployments → ⋯ → Redeploy).

### 5. Local development

```bash
npx vercel dev
```

Runs the static frontend and both API functions together against real
DynamoDB (using your local AWS env vars).

## Features

- AI opponent: hunt/target algorithm with checkerboard-parity search and
  direction-tracking once a ship is found
- Configurable board size (8×8 / 10×10 / 12×12) and fleet (Compact/Classic/Armada)
- Live battle timer
- Share Result (Web Share API, falls back to clipboard copy)
- Global leaderboard (best wins by fewest shots, recent games feed)
- Real-time-ish multiplayer via 6-character join codes, server-authoritative
  hit resolution, polling-based sync
