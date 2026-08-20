import { DynamoDBClient, CreateTableCommand, waitUntilTableExists } from '@aws-sdk/client-dynamodb';

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'battleship-leaderboard';
const REGION = process.env.AWS_REGION || 'us-east-1';

const client = new DynamoDBClient({ region: REGION });

// Single-table design, two access patterns:
//   ResultShotsIndex — Query(result="win") sorted by shots ASC   -> "Best Wins" leaderboard
//   AllDateIndex     — Query(gsiPk="ALL") sorted by date DESC    -> "Recent Games" feed
const command = new CreateTableCommand({
  TableName: TABLE_NAME,
  BillingMode: 'PAY_PER_REQUEST',
  AttributeDefinitions: [
    { AttributeName: 'id', AttributeType: 'S' },
    { AttributeName: 'result', AttributeType: 'S' },
    { AttributeName: 'shots', AttributeType: 'N' },
    { AttributeName: 'gsiPk', AttributeType: 'S' },
    { AttributeName: 'date', AttributeType: 'N' },
  ],
  KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'ResultShotsIndex',
      KeySchema: [
        { AttributeName: 'result', KeyType: 'HASH' },
        { AttributeName: 'shots', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    {
      IndexName: 'AllDateIndex',
      KeySchema: [
        { AttributeName: 'gsiPk', KeyType: 'HASH' },
        { AttributeName: 'date', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
  ],
});

console.log(`Creating table "${TABLE_NAME}" in ${REGION}...`);

try {
  await client.send(command);
  console.log('Waiting for table to become ACTIVE...');
  await waitUntilTableExists({ client, maxWaitTime: 90 }, { TableName: TABLE_NAME });
  console.log(`Table ready: ${TABLE_NAME}`);
} catch (err) {
  if (err.name === 'ResourceInUseException') {
    console.log('Table already exists — nothing to do.');
  } else {
    console.error('Failed to create table:', err);
    process.exit(1);
  }
}
