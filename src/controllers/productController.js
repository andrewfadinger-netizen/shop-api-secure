const Product = require('../models/Product');
const ApiError = require('../utils/ApiError');
const crudFactory = require('./crudFactory');
const { isAdmin } = require('../middleware/auth');
const { has, first, toNumber, toBool, toObjectId, pick } = require('../utils/query');

const crud = crudFactory(Product, {
  notFound: 'Товар не найден',
  allowedFields: ['name', 'sku', 'description', 'price', 'stock', 'category', 'tags', 'attributes', 'isActive'],
  sortable: ['name', 'price', 'stock', 'rating.avg', 'createdAt', 'updatedAt'],
  defaultSort: '-createdAt',

  // ?category=&minPrice=&maxPrice=&inStock=true&tag=&minRating=&isActive=&q=
  buildFilter(q) {
    const filter = {};
    if (has(q, 'category')) filter.category = toObjectId(q.category, 'category');
    if (has(q, 'minPrice') || has(q, 'maxPrice')) {
      filter.price = {};
      if (has(q, 'minPrice')) filter.price.$gte = toNumber(q.minPrice, 'minPrice');
      if (has(q, 'maxPrice')) filter.price.$lte = toNumber(q.maxPrice, 'maxPrice');
    }
    if (has(q, 'inStock')) filter.stock = toBool(q.inStock, 'inStock') ? { $gt: 0 } : 0;
    if (has(q, 'tag')) filter.tags = { $all: [].concat(q.tag).map((t) => String(t).toLowerCase()) };
    if (has(q, 'minRating')) filter['rating.avg'] = { $gte: toNumber(q.minRating, 'minRating') };
    if (has(q, 'isActive')) filter.isActive = toBool(q.isActive, 'isActive');
    if (has(q, 'q')) filter.$text = { $search: String(first(q.q)) }; // текстовый индекс
    return filter;
  },

  listSelect: '-reviews', // проекция: в каталоге отзывы не нужны
  listPopulate: { path: 'category', select: 'name slug' },
  getPopulate: [
    { path: 'category', select: 'name slug' },
    { path: 'reviews.user', select: 'name' },
  ],
});

// ---------- CRUD встроенных документов: отзывы товара ----------

// GET /api/products/:id/reviews
async function listReviews(req, res) {
  const product = await crud.findOr404(req.params.id, { path: 'reviews.user', select: 'name' });
  res.json({ data: product.reviews, rating: product.rating });
}

// POST /api/products/:id/reviews  { rating, comment } — автор берётся из токена
async function addReview(req, res) {
  const body = req.body ?? {};
  const userId = toObjectId(req.user.id, 'user'); // поле user из тела игнорируется: нельзя писать от чужого имени

  const product = await crud.findOr404(req.params.id);

  product.reviews.push({ user: userId, ...pick(body, ['rating', 'comment']) });
  // сначала валидация (оценка 1–5), потом проверка на повторный отзыв
  await product.validate();
  if (product.reviews.slice(0, -1).some((r) => r.user.equals(userId))) {
    throw ApiError.conflict('Этот пользователь уже оставил отзыв на товар');
  }
  await product.save();

  const review = product.reviews[product.reviews.length - 1];
  res.status(201).json({ data: review, rating: product.rating });
}

async function findReviewOr404(req) {
  const product = await crud.findOr404(req.params.id);
  const review = product.reviews.id(req.params.reviewId);
  if (!review) throw ApiError.notFound('Отзыв не найден');
  // Менять и удалять отзыв может только его автор или администратор
  if (!isAdmin(req) && !review.user.equals(req.user.id)) {
    throw new ApiError(403, 'Можно изменять только свои отзывы');
  }
  return { product, review };
}

// PATCH /api/products/:id/reviews/:reviewId  { rating?, comment? }
async function updateReview(req, res) {
  const changes = pick(req.body, ['rating', 'comment']);
  if (Object.keys(changes).length === 0) throw ApiError.badRequest('Можно изменить rating и comment');
  const { product, review } = await findReviewOr404(req);
  review.set(changes);
  await product.save();
  res.json({ data: review, rating: product.rating });
}

// DELETE /api/products/:id/reviews/:reviewId
async function deleteReview(req, res) {
  const { product, review } = await findReviewOr404(req);
  review.deleteOne(); // удаляет поддокумент из массива, запись в БД — при save()
  await product.save();
  res.json({ message: 'Отзыв удалён', id: review._id, rating: product.rating });
}

module.exports = { ...crud, listReviews, addReview, updateReview, deleteReview };
