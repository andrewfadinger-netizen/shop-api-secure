const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const RefreshToken = require('../models/RefreshToken');
const ApiError = require('../utils/ApiError');

const ALGORITHM = 'HS256';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Access-токен: короткоживущий JWT (по умолчанию 15 минут).
// В payload только id, роль и версия — никаких персональных данных: JWT не шифруется, а только подписывается.
function signAccessToken(user) {
  return jwt.sign({ role: user.role, ver: user.tokenVersion || 0 }, config.jwt.accessSecret, {
    algorithm: ALGORITHM,
    subject: user._id.toString(),
    expiresIn: config.jwt.accessTtl,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
}

// Проверка: подпись, алгоритм (только HS256 — защита от alg=none и подмены алгоритма),
// срок действия, издатель и получатель.
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwt.accessSecret, {
      algorithms: [ALGORITHM],
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new ApiError(401, 'Срок действия токена истёк');
    throw new ApiError(401, 'Недействительный токен');
  }
}

// Refresh-токен: случайная строка (не JWT), в БД хранится только её хеш.
async function issueRefreshToken(user, req, family = crypto.randomUUID()) {
  const token = crypto.randomBytes(48).toString('base64url');
  await RefreshToken.create({
    user: user._id,
    tokenHash: sha256(token),
    family,
    expiresAt: new Date(Date.now() + config.refreshTtlDays * 24 * 60 * 60 * 1000),
    createdByIp: req.ip,
    userAgent: String(req.get('user-agent') || '').slice(0, 300),
  });
  return { token, hash: sha256(token) };
}

async function issueTokenPair(user, req, family) {
  const accessToken = signAccessToken(user);
  const refresh = await issueRefreshToken(user, req, family);
  return { accessToken, refreshToken: refresh.token, tokenType: 'Bearer', expiresIn: config.jwt.accessTtl };
}

// Ротация: каждый refresh-токен одноразовый. Повторное предъявление уже
// использованного токена = признак кражи -> отзываем всю цепочку (family).
async function rotateRefreshToken(token, req) {
  if (typeof token !== 'string' || token.length < 20) {
    throw ApiError.badRequest('Поле «refreshToken» обязательно');
  }
  const stored = await RefreshToken.findOne({ tokenHash: sha256(token) });
  if (!stored) throw new ApiError(401, 'Недействительный refresh-токен');

  if (stored.revokedAt) {
    await RefreshToken.updateMany({ family: stored.family, revokedAt: null }, { revokedAt: new Date() });
    throw new ApiError(401, 'Refresh-токен уже использован: все сессии этой цепочки завершены');
  }
  if (stored.expiresAt.getTime() <= Date.now()) throw new ApiError(401, 'Срок действия refresh-токена истёк');

  // Атомарно помечаем токен использованным: два параллельных запроса не получат две пары
  const used = await RefreshToken.findOneAndUpdate(
    { _id: stored._id, revokedAt: null },
    { revokedAt: new Date() },
    { returnDocument: 'after' }
  );
  if (!used) throw new ApiError(401, 'Refresh-токен уже использован');

  return { stored: used };
}

async function revokeRefreshToken(token) {
  if (typeof token !== 'string') return false;
  const res = await RefreshToken.updateOne({ tokenHash: sha256(token), revokedAt: null }, { revokedAt: new Date() });
  return res.modifiedCount > 0;
}

async function revokeAllForUser(userId) {
  const res = await RefreshToken.updateMany({ user: userId, revokedAt: null }, { revokedAt: new Date() });
  return res.modifiedCount;
}

module.exports = {
  sha256,
  signAccessToken,
  verifyAccessToken,
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
};
