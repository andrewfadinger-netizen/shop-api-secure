const bcrypt = require('bcryptjs');
const config = require('../config');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const ApiError = require('../utils/ApiError');
const { pick } = require('../utils/query');
const tokens = require('../services/tokenService');

// Хеш-«пустышка»: если пользователя нет, всё равно тратим время на bcrypt,
// чтобы по времени ответа нельзя было узнать, зарегистрирован ли email.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-1', 10);

const INVALID_CREDENTIALS = 'Неверный email или пароль';

// Строки из тела запроса — только строки: {"email": {"$ne": null}} -> 400 (защита от NoSQL-инъекции)
function requireString(body, field) {
  const value = body?.[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw ApiError.badRequest(`Поле «${field}» обязательно и должно быть строкой`);
  }
  return value;
}

// POST /api/auth/register  { name, email, password, phone?, addresses? }
async function register(req, res) {
  requireString(req.body, 'email');
  requireString(req.body, 'password');
  // role из запроса НЕ берём: зарегистрироваться админом нельзя
  const user = await User.create({ ...pick(req.body, ['name', 'email', 'password', 'phone', 'addresses']), role: 'customer' });
  const pair = await tokens.issueTokenPair(user, req);
  res.status(201).json({ data: user, ...pair });
}

// POST /api/auth/login  { email, password }
async function login(req, res) {
  const email = requireString(req.body, 'email').trim().toLowerCase();
  const password = requireString(req.body, 'password');

  const user = await User.findOne({ email })
    .select('+password +failedLoginAttempts +lockUntil')
    .setOptions({ sanitizeFilter: true });

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw new ApiError(401, INVALID_CREDENTIALS);
  }

  if (user.isLocked()) {
    const minutes = Math.ceil((user.lockUntil.getTime() - Date.now()) / 60000);
    throw new ApiError(423, `Аккаунт временно заблокирован после неудачных попыток входа. Повторите через ${minutes} мин.`);
  }

  if (!(await user.comparePassword(password))) {
    // Счётчик неудачных попыток; при достижении лимита — блокировка на lockMinutes
    const attempts = (user.failedLoginAttempts || 0) + 1;
    const update =
      attempts >= config.maxLoginAttempts
        ? { failedLoginAttempts: 0, lockUntil: new Date(Date.now() + config.lockMinutes * 60000) }
        : { failedLoginAttempts: attempts };
    await User.updateOne({ _id: user._id }, update);
    throw new ApiError(401, INVALID_CREDENTIALS);
  }

  if (user.failedLoginAttempts || user.lockUntil) {
    await User.updateOne({ _id: user._id }, { failedLoginAttempts: 0, $unset: { lockUntil: 1 } });
  }

  const pair = await tokens.issueTokenPair(user, req);
  res.json({ data: user, ...pair });
}

// POST /api/auth/refresh  { refreshToken } -> новая пара токенов (старый refresh больше не действует)
async function refresh(req, res) {
  const { stored } = await tokens.rotateRefreshToken(req.body?.refreshToken, req);
  const user = await User.findById(stored.user);
  if (!user) throw new ApiError(401, 'Пользователь не найден');
  const pair = await tokens.issueTokenPair(user, req, stored.family);
  await RefreshToken.updateOne({ _id: stored._id }, { replacedBy: tokens.sha256(pair.refreshToken) });
  res.json(pair);
}

// POST /api/auth/logout  { refreshToken } — завершить текущую сессию
async function logout(req, res) {
  const revoked = await tokens.revokeRefreshToken(req.body?.refreshToken);
  res.json({ message: revoked ? 'Вы вышли из системы' : 'Сессия уже завершена' });
}

// POST /api/auth/logout-all — завершить все сессии пользователя (нужен access-токен)
async function logoutAll(req, res) {
  const count = await tokens.revokeAllForUser(req.user.id);
  res.json({ message: 'Все сессии завершены', revoked: count });
}

// GET /api/auth/me
async function me(req, res) {
  res.json({ data: req.user.doc });
}

// PATCH /api/auth/me — свой профиль (роль и email так поменять нельзя)
async function updateMe(req, res) {
  const changes = pick(req.body, ['name', 'phone', 'addresses']);
  if (Object.keys(changes).length === 0) {
    throw ApiError.badRequest('Можно изменить name, phone, addresses');
  }
  const user = await User.findById(req.user.id);
  user.set(changes);
  await user.save();
  res.json({ data: user });
}

// PATCH /api/auth/password  { currentPassword, newPassword }
async function changePassword(req, res) {
  const currentPassword = requireString(req.body, 'currentPassword');
  const newPassword = requireString(req.body, 'newPassword');
  const user = await User.findById(req.user.id).select('+password');
  if (!(await user.comparePassword(currentPassword))) {
    throw new ApiError(401, 'Текущий пароль указан неверно');
  }
  if (currentPassword === newPassword) throw ApiError.badRequest('Новый пароль должен отличаться от текущего');

  user.password = newPassword;
  await user.save(); // pre('save'): хеш + passwordChangedAt -> старые access-токены недействительны
  await tokens.revokeAllForUser(user._id); // и все refresh-токены тоже
  const pair = await tokens.issueTokenPair(user, req);
  res.json({ message: 'Пароль изменён, остальные сессии завершены', ...pair });
}

module.exports = { register, login, refresh, logout, logoutAll, me, updateMe, changePassword };
