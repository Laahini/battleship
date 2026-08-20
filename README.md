# Battleship

A browser-based Battleship game played against an AI opponent (hunt/target
strategy with checkerboard-parity search), with a global leaderboard backed
by AWS DynamoDB and served through Vercel serverless functions.

## Architecture

```
Browser (index.html / game.js)
        │  fetch()
        ▼
Vercel Serverless Function  (api/leaderboard.js, Node.js runtime)
        │  AWS SDK v3
        ▼
Amazon DynamoDB table "battleship-leaderboard"
        ├─ Base table:        PK id (uuid)
        ├─ GSI ResultShotsIndex:  PK result ("win"/"loss")  SK shots (N)
        │     → Query(result="win"), ScanIndexForward=true  = "Best Wins" board
        └─ GSI AllDateIndex:      PK gsiPk ("ALL")           SK date (N)
              → Query(gsiPk="ALL"), ScanIndexForward=false   = "Recent Games" feed
```

This is a single-table DynamoDB design: one item per completed game, with
two Global Secondary Indexes to serve two different access patterns without
scanning the table. Billing mode is `PAY_PER_REQUEST` (on-demand) since
traffic is low and unpredictable — no idle capacity to pay for.

## Stack

- **Frontend**: vanilla HTML/CSS/JS, no build step
- **Backend**: Vercel serverless function (`api/leaderboard.js`), Node.js, AWS SDK v3
- **Database**: AWS DynamoDB (on-demand)
- **Hosting/CI**: Vercel, auto-deploys on push to `main`

## API

`GET /api/leaderboard?type=best` — top 10 wins, sorted by fewest shots.
`GET /api/leaderboard?type=recent` — last 15 games, newest first.
`POST /api/leaderboard` — body `{ name, result, shots, hits, accuracy, duration }`,
server assigns `id` and `date` and clamps/validates all numeric fields.

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
      "Sid": "LeaderboardTableAccess",
      "Effect": "Allow",
      "Action": ["dynamodb:PutItem", "dynamodb:Query", "dynamodb:DescribeTable"],
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

Runs the static frontend and the `/api/leaderboard` function together
against real DynamoDB (using your local AWS env vars).
