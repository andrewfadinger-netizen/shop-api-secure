const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../services/tokenService');

// Аутентификация: «кто ты?». Проверяет заголовок Authorization: Bearer <JWT>.
async function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new ApiError(401, 'Требуется авторизация: заголовок Authorization: Bearer <токен>');
  }

  const payload = verifyAccessToken(token);

  // Пользователь должен существовать сейчас, а роль берём из БД, а не из токена:
  // если админа разжаловали, старый токен уже не даст прав администратора.
  const user = await User.findById(payload.sub);
  if (!user) throw new ApiError(401, 'Пользователь токена не найден');

  // Токен, выданный до смены пароля, недействителен (версия в токене устарела)
  if (payload.ver !== (user.tokenVersion || 0)) {
    throw new ApiError(401, 'Пароль был изменён — войдите заново');
  }

  req.user = { id: user._id.toString(), role: user.role, doc: user };
  next();
}

// Авторизация: «что тебе можно?». Пускает только перечисленные роли.
function authorize(...roles) {
  return function checkRole(req, res, next) {
    if (!req.user) return next(new ApiError(401, 'Требуется авторизация'));
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, 'Недостаточно прав для этого действия'));
    }
    return next();
  };
}

const isAdmin = (req) => req.user?.role === 'admin';

module.exports = { authenticate, authorize, isAdmin };
