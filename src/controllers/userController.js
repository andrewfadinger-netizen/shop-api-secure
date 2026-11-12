const User = require('../models/User');
const Order = require('../models/Order');
const RefreshToken = require('../models/RefreshToken');
const ApiError = require('../utils/ApiError');
const crudFactory = require('./crudFactory');
const { has, first, escapeRegex, pick } = require('../utils/query');

// Управление пользователями — только для администратора (проверка в маршрутах).
// Пароль через PATCH не меняется: это делает сам пользователь через /api/auth/password.
const crud = crudFactory(User, {
  notFound: 'Пользователь не найден',
  allowedFields: ['name', 'email', 'phone', 'role', 'addresses'],
  sortable: ['name', 'email', 'role', 'createdAt', 'updatedAt'],
  defaultSort: 'name',

  buildFilter(q) {
    const filter = {};
    if (has(q, 'role')) {
      const role = String(first(q.role));
      if (!User.ROLES.includes(role)) throw ApiError.badRequest(`role: ${User.ROLES.join(' или ')}`);
      filter.role = role;
    }
    if (has(q, 'q')) {
      const re = { $regex: escapeRegex(first(q.q)), $options: 'i' };
      filter.$or = [{ name: re }, { email: re }];
    }
    // Запрос по полю встроенного массива: пользователи, у которых есть адрес в городе
    if (has(q, 'city')) {
      filter['addresses.city'] = { $regex: `^${escapeRegex(first(q.city))}$`, $options: 'i' };
    }
    return filter;
  },

  // GET /api/users/:id?include=orders — подтянуть заказы через виртуальный populate
  getPopulate: (req) =>
    req.query.include === 'orders'
      ? { path: 'orders', select: 'status total createdAt', options: { sort: { createdAt: -1 } } }
      : null,

  async beforeDelete(user, req) {
    if (user._id.equals(req.user.id)) throw ApiError.conflict('Нельзя удалить собственную учётную запись администратора');
    const count = await Order.countDocuments({ user: user._id });
    if (count > 0) {
      throw ApiError.conflict(`Нельзя удалить пользователя: у него заказов — ${count}`, { orders: count });
    }
    await RefreshToken.deleteMany({ user: user._id }); // сессии удалённого пользователя
  },
});

// POST /api/users — администратор создаёт пользователя (в том числе другого админа) с паролем
async function create(req, res) {
  const user = await User.create(pick(req.body, ['name', 'email', 'password', 'phone', 'role', 'addresses']));
  res.status(201).json({ data: user });
}

// PATCH /api/users/:id — администратор не может снять роль admin сам с себя (чтобы не остаться без админа)
async function update(req, res) {
  if (req.params.id === req.user.id && req.body?.role && req.body.role !== 'admin') {
    throw ApiError.conflict('Нельзя понизить собственную роль');
  }
  return crud.update(req, res);
}

module.exports = { ...crud, create, update };
