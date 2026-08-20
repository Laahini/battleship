const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('crypto');

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'battleship-leaderboard';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampFloat(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function handlePost(req, res) {
  const body = req.body || {};
  const name = String(body.name || 'Admiral').trim().slice(0, 24) || 'Admiral';
  const result = body.result === 'win' ? 'win' : 'loss';
  const shots = clampInt(body.shots, 0, 300, 0);
  const hits = clampInt(body.hits, 0, 300, 0);
  const accuracy = clampInt(body.accuracy, 0, 100, 0);
  const duration = clampFloat(body.duration, 0, 36000, 0);

  const item = {
    id: randomUUID(),
    gsiPk: 'ALL',
    name,
    result,
    shots,
    hits,
    accuracy,
    duration,
    date: Date.now(),
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  res.status(201).json(item);
}

async function handleGet(req, res) {
  const type = req.query.type === 'recent' ? 'recent' : 'best';

  if (type === 'best') {
    const out = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'ResultShotsIndex',
      KeyConditionExpression: '#r = :win',
      ExpressionAttributeNames: { '#r': 'result' },
      ExpressionAttributeValues: { ':win': 'win' },
      ScanIndexForward: true, // ascending by shots — fewest shots first
      Limit: 10,
    }));
    return res.status(200).json(out.Items || []);
  }

  const out = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'AllDateIndex',
    KeyConditionExpression: 'gsiPk = :all',
    ExpressionAttributeValues: { ':all': 'ALL' },
    ScanIndexForward: false, // descending by date — newest first
    Limit: 15,
  }));
  res.status(200).json(out.Items || []);
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'GET') return await handleGet(req, res);
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('leaderboard api error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
