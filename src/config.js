const path = require('path');

// Переменные окружения из .env (встроенная функция Node.js >= 20.12, без dotenv).
try {
  process.loadEnvFile(path.resolve(__dirname, '..', '.env'));
} catch {
  // .env может отсутствовать — тогда берутся значения по умолчанию
}

const env = process.env;
const int = (value, fallback) => (Number.isFinite(Number(value)) && value !== '' && value !== undefined ? Number(value) : fallback);

const config = {
  port: int(env.PORT, 3000),
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/shop_secure_db',
  nodeEnv: env.NODE_ENV || 'development',

  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    accessTtl: env.JWT_ACCESS_TTL || '15m',
    issuer: 'shop-api',
    audience: 'shop-api-client',
  },
  refreshTtlDays: int(env.REFRESH_TOKEN_TTL_DAYS, 7),
  bcryptRounds: int(env.BCRYPT_ROUNDS, 12),

  // Защита от подбора пароля
  maxLoginAttempts: int(env.MAX_LOGIN_ATTEMPTS, 5),
  lockMinutes: int(env.LOCK_MINUTES, 15),

  // Ограничение частоты запросов (окно 15 минут)
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: int(env.RATE_LIMIT_MAX, 1000),
    authMax: int(env.AUTH_RATE_LIMIT_MAX, 20),
  },

  // Разрешённые источники для CORS (через запятую)
  corsOrigins: (env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

// Без надёжного секрета сервер не стартует: подпись JWT с коротким/пустым ключом
// позволила бы подделывать токены.
function assertSecrets() {
  const secret = config.jwt.accessSecret;
  if (!secret || secret.length < 32 || secret.startsWith('change-me')) {
    throw new Error(
      'JWT_ACCESS_SECRET не задан или слишком короткий (нужно ≥ 32 символов). ' +
        'Сгенерируйте: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  }
}

module.exports = { ...config, assertSecrets };
