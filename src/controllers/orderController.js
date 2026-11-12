const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const crudFactory = require('./crudFactory');
const { isAdmin } = require('../middleware/auth');
const { has, first, toNumber, toObjectId, toDate, pick } = require('../utils/query');

// Покупатель видит и меняет только свои заказы, администратор — все
const ownOrders = (req) => (isAdmin(req) ? {} : { user: req.user.id });

// populate для карточки заказа: покупатель + текущие данные товаров
const DETAIL_POPULATE = [
  { path: 'user', select: 'name email phone' },
  { path: 'items.product', select: 'name sku price stock' },
];

const crud = crudFactory(Order, {
  notFound: 'Заказ не найден',
  allowedFields: [], // создание и изменение — своя логика ниже
  sortable: ['createdAt', 'updatedAt', 'total', 'status'],
  defaultSort: '-createdAt',
  scope: ownOrders,

  // ?status=&user=&from=2026-11-01&to=2026-11-30&minTotal=&maxTotal=
  buildFilter(q) {
    const filter = {};
    if (has(q, 'status')) {
      const status = String(first(q.status));
      if (!Order.STATUSES.includes(status)) {
        throw ApiError.badRequest(`status: ${Order.STATUSES.join(', ')}`);
      }
      filter.status = status;
    }
    if (has(q, 'user')) filter.user = toObjectId(q.user, 'user');
    if (has(q, 'from') || has(q, 'to')) {
      filter.createdAt = {};
      if (has(q, 'from')) filter.createdAt.$gte = toDate(q.from, 'from');
      if (has(q, 'to')) {
        const to = toDate(q.to, 'to');
        to.setUTCHours(23, 59, 59, 999); // включительно до конца дня
        filter.createdAt.$lte = to;
      }
    }
    if (has(q, 'minTotal') || has(q, 'maxTotal')) {
      filter.total = {};
      if (has(q, 'minTotal')) filter.total.$gte = toNumber(q.minTotal, 'minTotal');
      if (has(q, 'maxTotal')) filter.total.$lte = toNumber(q.maxTotal, 'maxTotal');
    }
    return filter;
  },

  listPopulate: { path: 'user', select: 'name email' },
  getPopulate: DETAIL_POPULATE,
});

// Вернуть товары заказа на склад (отмена / удаление). bulkWrite — одна операция на всё.
async function restock(order) {
  if (!order.items.length) return;
  await Product.bulkWrite(
    order.items.map((item) => ({
      updateOne: { filter: { _id: item.product }, update: { $inc: { stock: item.quantity } } },
    }))
  );
}

// POST /api/orders  { items: [{ product, quantity }], shippingAddress?, comment?, user? (только admin) }
async function create(req, res) {
  const body = req.body ?? {};
  // Покупатель оформляет заказ только на себя: user берётся из токена, а не из тела.
  // Администратор может оформить заказ за покупателя (поле user).
  const userId = isAdmin(req) && body.user ? toObjectId(body.user, 'user') : toObjectId(req.user.id, 'user');
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw ApiError.badRequest('Заказ должен содержать хотя бы один товар (items)');
  }

  // Одинаковые товары в запросе объединяем в одну позицию
  const qtyById = new Map();
  body.items.forEach((item, i) => {
    const id = toObjectId(item?.product, `items[${i}].product`).toString();
    const qty = item?.quantity === undefined ? 1 : Number(item.quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      throw ApiError.badRequest(`items[${i}].quantity — целое число не меньше 1`);
    }
    qtyById.set(id, (qtyById.get(id) || 0) + qty);
  });

  const user = await User.findById(userId);
  if (!user) throw ApiError.badRequest('Пользователь не найден');

  const products = await Product.find({ _id: { $in: [...qtyById.keys()] }, isActive: true });
  const byId = new Map(products.map((p) => [p._id.toString(), p]));
  const missing = [...qtyById.keys()].filter((id) => !byId.has(id));
  if (missing.length) throw ApiError.badRequest('Товары не найдены или сняты с продажи', { missing });

  // Адрес: из запроса или адрес пользователя по умолчанию (копия, не ссылка)
  let shippingAddress = body.shippingAddress;
  if (!shippingAddress) {
    const def = user.addresses.find((a) => a.isDefault) || user.addresses[0];
    if (!def) throw ApiError.badRequest('Укажите shippingAddress: у пользователя нет сохранённых адресов');
    shippingAddress = { city: def.city, street: def.street, zip: def.zip };
  }

  // Резервируем остатки атомарно: условие stock >= qty и $inc в одной операции,
  // поэтому два параллельных заказа не уведут остаток в минус.
  const reserved = [];
  const rollback = () =>
    Promise.all(reserved.map(([id, qty]) => Product.updateOne({ _id: id }, { $inc: { stock: qty } })));

  try {
    for (const [id, qty] of qtyById) {
      const result = await Product.updateOne({ _id: id, stock: { $gte: qty } }, { $inc: { stock: -qty } });
      if (result.modifiedCount === 0) {
        const fresh = await Product.findById(id).select('stock');
        throw ApiError.conflict(`Недостаточно товара «${byId.get(id).name}» на складе`, {
          product: id,
          requested: qty,
          available: fresh ? fresh.stock : 0,
        });
      }
      reserved.push([id, qty]);
    }

    const order = await Order.create({
      user: userId,
      items: [...qtyById].map(([id, quantity]) => {
        const p = byId.get(id);
        return { product: p._id, name: p.name, sku: p.sku, price: p.price, quantity };
      }),
      shippingAddress,
      comment: body.comment,
    });
    await order.populate(DETAIL_POPULATE);
    res.status(201).json({ data: order });
  } catch (err) {
    await rollback(); // без транзакций (standalone MongoDB) — компенсирующее действие
    throw err;
  }
}

// PATCH /api/orders/:id  { status?, comment?, shippingAddress? }
async function update(req, res) {
  if (req.body && 'items' in req.body) {
    throw ApiError.badRequest('Состав заказа менять нельзя: отмените заказ и оформите новый');
  }
  const changes = pick(req.body, ['status', 'comment', 'shippingAddress']);
  if (Object.keys(changes).length === 0) {
    throw ApiError.badRequest('Нет полей для обновления', { allowed: ['status', 'comment', 'shippingAddress'] });
  }

  // Покупатель может только отменить свой заказ или поправить комментарий/адрес,
  // оплату и доставку отмечает администратор.
  if (!isAdmin(req) && changes.status !== undefined && changes.status !== 'cancelled') {
    throw new ApiError(403, 'Покупатель может только отменить заказ (status: cancelled)');
  }

  const order = await crud.findOr404(req.params.id, null, req); // чужой заказ -> 404
  const prevStatus = order.status;

  if (changes.status !== undefined && changes.status !== prevStatus) {
    if (!Order.STATUSES.includes(changes.status)) {
      throw ApiError.badRequest(`status: ${Order.STATUSES.join(', ')}`);
    }
    const allowed = Order.TRANSITIONS[prevStatus];
    if (!allowed.includes(changes.status)) {
      throw ApiError.conflict(`Нельзя перевести заказ из «${prevStatus}» в «${changes.status}»`, { allowed });
    }
  }
  if (changes.shippingAddress && !['new', 'paid'].includes(prevStatus)) {
    throw ApiError.conflict('Адрес доставки можно менять только до отправки заказа');
  }

  order.set(changes);
  await order.save();
  if (prevStatus !== 'cancelled' && order.status === 'cancelled') await restock(order);

  await order.populate(DETAIL_POPULATE);
  res.json({ data: order });
}

// DELETE /api/orders/:id  (только admin — проверка в маршруте)
async function remove(req, res) {
  const order = await crud.findOr404(req.params.id, null, req);
  if (order.status === 'shipped') {
    throw ApiError.conflict('Заказ в пути — удалить нельзя, дождитесь доставки');
  }
  await order.deleteOne();
  // new / paid — товар ещё не ушёл покупателю, возвращаем на склад
  if (['new', 'paid'].includes(order.status)) await restock(order);
  res.json({ message: 'Заказ удалён', id: order._id });
}

module.exports = { list: crud.list, get: crud.get, create, update, remove };
