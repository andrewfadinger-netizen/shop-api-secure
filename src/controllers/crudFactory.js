const ApiError = require('../utils/ApiError');
const { parsePagination, pick } = require('../utils/query');

/**
 * Универсальный CRUD-контроллер для модели Mongoose.
 * Общая логика (пагинация, сортировка, 404, белый список полей) — здесь,
 * особенности сущности (фильтры, populate, проверки перед удалением) — в опциях.
 *
 * scope(req) — фильтр видимости для текущего пользователя (например,
 * покупатель видит только свои заказы). Он добавляется к КАЖДОМУ запросу в БД,
 * поэтому чужой документ невозможно ни получить, ни изменить, ни удалить:
 * для такого пользователя его как будто нет (404, а не 403 — не раскрываем, что id существует).
 */
function crudFactory(Model, options) {
  const {
    notFound,
    allowedFields,
    sortable,
    defaultSort = '-createdAt',
    buildFilter = () => ({}),
    scope = () => ({}),
    listSelect,
    listPopulate,
    getPopulate,
    beforeDelete,
  } = options;

  const resolve = (value, req) => (typeof value === 'function' ? value(req) : value);
  const populateDoc = async (doc, req) => {
    const populate = resolve(getPopulate, req);
    if (populate) await doc.populate(populate);
  };

  async function findOr404(id, populate, req) {
    const query = Model.findOne({ ...(req ? scope(req) : {}), _id: id });
    if (populate) query.populate(populate);
    const doc = await query;
    if (!doc) throw ApiError.notFound(notFound);
    return doc;
  }

  // GET /  — список с фильтрами, сортировкой и пагинацией
  async function list(req, res) {
    // scope идёт последним: его нельзя перебить параметром запроса (?user=чужой_id)
    const filter = { ...(await buildFilter(req.query, req)), ...scope(req) };
    const { page, limit, skip, sort } = parsePagination(req.query, { defaultSort, sortable });

    const query = Model.find(filter).sort(sort).skip(skip).limit(limit);
    if (listSelect) query.select(listSelect);
    if (listPopulate) query.populate(listPopulate);

    const [data, total] = await Promise.all([query, Model.countDocuments(filter)]);
    res.json({ data, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  }

  // GET /:id
  async function get(req, res) {
    const doc = await findOr404(req.params.id, resolve(getPopulate, req), req);
    res.json({ data: doc });
  }

  // POST /
  async function create(req, res) {
    const doc = await Model.create(pick(req.body, allowedFields));
    await populateDoc(doc, req);
    res.status(201).json({ data: doc });
  }

  // PATCH /:id — частичное обновление. Через save(), чтобы сработали
  // все валидаторы и middleware схемы (findByIdAndUpdate их частично обходит).
  async function update(req, res) {
    const changes = pick(req.body, allowedFields);
    if (Object.keys(changes).length === 0) {
      throw ApiError.badRequest('Нет полей для обновления', { allowed: allowedFields });
    }
    const doc = await findOr404(req.params.id, null, req);
    doc.set(changes);
    await doc.save();
    await populateDoc(doc, req);
    res.json({ data: doc });
  }

  // DELETE /:id
  async function remove(req, res) {
    const doc = await findOr404(req.params.id, null, req);
    if (beforeDelete) await beforeDelete(doc, req);
    await doc.deleteOne();
    res.json({ message: 'Удалено', id: doc._id });
  }

  return { list, get, create, update, remove, findOr404 };
}

module.exports = crudFactory;
