// Автотест: поднимает временный MongoDB в памяти, заполняет seed-данными,
// запускает API на свободном порту и прогоняет все сценарии из scripts/smoke.js,
// плюс отдельные проверки rate limit и конфигурации секрета.
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
process.env.BCRYPT_ROUNDS = '4'; // быстрее в тестах; в работе — 12

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { MongoMemoryServer } = require('mongodb-memory-server');
const config = require('../src/config');
const createApp = require('../src/app');
const { seed } = require('../scripts/seed');
const { runSmoke } = require('../scripts/smoke');

let mongod;
const servers = [];

async function listen(app) {
  const server = app.listen(0);
  await once(server, 'listening');
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('shop_secure_test'));
  await seed({ log: () => {} });
});

after(async () => {
  for (const s of servers) s.close();
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test('seed создаёт данные, пароли хранятся только как bcrypt-хеши', async () => {
  const db = mongoose.connection.db;
  assert.equal(await db.collection('categories').countDocuments(), 4);
  assert.equal(await db.collection('products').countDocuments(), 12);
  assert.equal(await db.collection('users').countDocuments(), 6);
  assert.equal(await db.collection('orders').countDocuments(), 8);
  const admin = await db.collection('users').findOne({ email: 'admin@example.com' });
  assert.match(admin.password, /^\$2[aby]\$\d{2}\$/);
  assert.ok(await bcrypt.compare(require('../scripts/seed-data').TEST_PASSWORDS.admin, admin.password));
});

test('индексы созданы, включая TTL для refresh-токенов', async () => {
  const idx = await mongoose.connection.db.collection('refreshtokens').indexes();
  const ttl = idx.find((i) => i.name === 'expiresAt_1');
  assert.equal(ttl?.expireAfterSeconds, 0);
  assert.ok(idx.some((i) => i.name === 'tokenHash_1' && i.unique));
});

test('все сценарии CRUD, аутентификации и авторизации проходят', async () => {
  const base = await listen(createApp());
  const { failed } = await runSmoke(base, { log: () => {} });
  assert.deepEqual(failed, [], JSON.stringify(failed, null, 2));
});

test('rate limit: после лимита неудачных входов — 429', async () => {
  const base = await listen(createApp({ authMax: 3 }));
  const attempt = () =>
    fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'Wrong12345' }),
    });
  for (let i = 0; i < 3; i += 1) assert.equal((await attempt()).status, 401);
  const res = await attempt();
  assert.equal(res.status, 429);
  assert.match((await res.json()).error.message, /Слишком много/);
});

test('без надёжного JWT-секрета приложение не запускается', () => {
  const saved = config.jwt.accessSecret;
  try {
    for (const bad of [undefined, 'short', 'change-me-generate-a-long-random-secret']) {
      config.jwt.accessSecret = bad;
      assert.throws(() => createApp(), /JWT_ACCESS_SECRET/);
    }
  } finally {
    config.jwt.accessSecret = saved;
  }
});
