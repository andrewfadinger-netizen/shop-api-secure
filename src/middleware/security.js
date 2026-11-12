const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const config = require('../config');

const tooMany = (message) => (req, res) => {
  res.status(429).json({ error: { status: 429, message } });
};

// HTTP-заголовки безопасности: CSP, X-Content-Type-Options, X-Frame-Options, HSTS и др.
const securityHeaders = helmet();

// CORS: браузер пустит к API только страницы с разрешённых адресов
const corsPolicy = cors({
  origin(origin, callback) {
    // запросы без Origin (Postman, curl, сервер-сервер) CORS не касается
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600,
});

// Общий лимит на все запросы к API с одного IP
function apiLimiter(max = config.rateLimit.max) {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: tooMany('Слишком много запросов, попробуйте позже'),
  });
}

// Жёсткий лимит на вход и регистрацию: считаем только неудачные попытки
function authLimiter(max = config.rateLimit.authMax) {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: max,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: tooMany('Слишком много неудачных попыток входа с этого адреса, попробуйте через 15 минут'),
  });
}

module.exports = { securityHeaders, corsPolicy, apiLimiter, authLimiter };
