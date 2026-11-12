const express = require('express');
const morgan = require('morgan');
const mongoose = require('mongoose');
const config = require('./config');
const buildRouter = require('./routes');
const { securityHeaders, corsPolicy, apiLimiter } = require('./middleware/security');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const DB_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

/**
 * @param {object} [options]
 * @param {number} [options.rateLimitMax] — общий лимит запросов (переопределяется в тестах)
 * @param {number} [options.authMax] — лимит неудачных попыток входа
 */
function createApp(options = {}) {
  config.assertSecrets();

  const app = express();
  app.disable('x-powered-by'); // не раскрываем, что это Express
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1); // за nginx/облаком

  app.use(securityHeaders);
  app.use(corsPolicy);
  app.use(express.json({ limit: '100kb' })); // защита от огромных тел запросов
  if (process.env.NODE_ENV !== 'test') {
    // в журнал попадают метод, путь, код и время — без тел запросов и токенов
    app.use(morgan('dev'));
  }

  app.get('/', (req, res) => {
    res.json({
      name: 'Shop API (secure) — интернет-магазин с JWT-аутентификацией',
      endpoints: ['/api/health', '/api/auth', '/api/categories', '/api/products', '/api/users', '/api/orders', '/api/stats'],
    });
  });

  app.get('/api/health', (req, res) => {
    const state = DB_STATES[mongoose.connection.readyState] || 'unknown';
    res.status(state === 'connected' ? 200 : 503).json({ status: state === 'connected' ? 'ok' : 'degraded', db: state });
  });

  app.use('/api', apiLimiter(options.rateLimitMax), buildRouter({ authMax: options.authMax }));

  app.use(notFound);
  app.use(errorHandler); // Express 5 сам передаёт сюда ошибки из async-обработчиков
  return app;
}

module.exports = createApp;
