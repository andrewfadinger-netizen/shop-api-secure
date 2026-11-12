const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');

function notFound(req, res, next) {
  next(new ApiError(404, `Маршрут ${req.method} ${req.originalUrl} не найден`));
}

function fieldMessage(e) {
  if (e.name === 'CastError') return `Некорректный тип значения: ${JSON.stringify(e.value)}`;
  return e.message;
}

// Единый формат ошибок: { error: { status, message, details? } }
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500;
  let message = 'Внутренняя ошибка сервера';
  let details;

  if (err instanceof ApiError) {
    ({ status, message, details } = err);
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    message = 'Ошибка валидации';
    details = Object.fromEntries(Object.entries(err.errors).map(([path, e]) => [path, fieldMessage(e)]));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    message = `Некорректное значение поля «${err.path}»: ${JSON.stringify(err.value)}`;
  } else if (err && err.code === 11000) {
    status = 409;
    message = 'Запись с такими данными уже существует';
    details = err.keyValue;
  } else if (err && err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Некорректный JSON в теле запроса';
  } else if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    status = err.status;
    message = status === 413 ? 'Слишком большое тело запроса (максимум 100 КБ)' : err.message;
  }

  if (status >= 500) console.error(err);
  res.status(status).json({ error: { status, message, ...(details && { details }) } });
}

module.exports = { notFound, errorHandler };
