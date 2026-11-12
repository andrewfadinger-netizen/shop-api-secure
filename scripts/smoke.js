// Проверочный прогон ВСЕХ запросов API против запущенного сервера: npm run smoke
// Проверяет CRUD, аутентификацию (JWT), авторизацию (роли, владелец ресурса) и защиту.
// Создаёт свои записи и в конце удаляет их — данные из seed не трогает.
// Используется и в автотесте (test/api.test.js).

const jwt = require('jsonwebtoken');
const config = require('../src/config');
const { TEST_PASSWORDS } = require('./seed-data');

const DEFAULT_BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const ADMIN = { email: 'admin@example.com', password: TEST_PASSWORDS.admin };

async function runSmoke(base = DEFAULT_BASE, { log = console.log } = {}) {
  const results = [];
  const s = Date.now().toString(36); // уникальный суффикс, чтобы прогон можно было повторять
  let lastHeaders = new Headers();

  async function call(method, path, body, expected, note, token, extraHeaders = {}) {
    const init = { method, headers: { ...extraHeaders } };
    if (token) init.headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(base + path, init);
    lastHeaders = res.headers;
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    const ok = res.status === expected;
    results.push({ ok, method, path, status: res.status, expected, note });
    const who = token ? '' : ' [без токена]';
    const tail = ok ? '' : `  <-- ожидали ${expected}: ${text.slice(0, 300)}`;
    log(`${ok ? 'OK ' : 'ERR'} ${res.status} ${method.padEnd(6)} ${path}${who} — ${note}${tail}`);
    return json;
  }

  function check(cond, note) {
    results.push({ ok: Boolean(cond), method: 'CHECK', note });
    log(`${cond ? 'OK ' : 'ERR'}     проверка: ${note}`);
  }

  // Нет ли в ответе секретных полей (на любой глубине)
  const leaks = (obj) => /"(password|passwordChangedAt|failedLoginAttempts|lockUntil|tokenVersion|tokenHash)"/.test(JSON.stringify(obj ?? {}));

  const missingId = '64b000000000000000000000';
  const PASS_A = 'Str0ngPass!A';
  let r;

  // ======================== Служебное и заголовки безопасности ========================
  r = await call('GET', '/api/health', undefined, 200, 'сервер и БД доступны');
  check(r?.db === 'connected', 'health.db = connected');
  check(!lastHeaders.has('x-powered-by'), 'нет заголовка X-Powered-By (Express скрыт)');
  check(lastHeaders.get('x-content-type-options') === 'nosniff', 'Helmet: X-Content-Type-Options = nosniff');
  check(lastHeaders.has('content-security-policy'), 'Helmet: есть Content-Security-Policy');
  await call('GET', '/api/health', undefined, 200, 'CORS: запрос с чужого сайта', null, { Origin: 'http://evil.example' });
  check(!lastHeaders.has('access-control-allow-origin'), 'CORS: чужому Origin доступ не выдан');
  await call('GET', '/api/health', undefined, 200, 'CORS: запрос с разрешённого сайта', null, { Origin: config.corsOrigins[0] });
  check(lastHeaders.get('access-control-allow-origin') === config.corsOrigins[0], `CORS: разрешён ${config.corsOrigins[0]}`);

  // ======================== Регистрация ========================
  const emailA = `buyer.a.${s}@example.com`;
  r = await call('POST', '/api/auth/register', {
    name: 'Покупатель А',
    email: emailA,
    password: PASS_A,
    role: 'admin',
    addresses: [{ label: 'Дом', city: 'Караганда', street: 'ул. Ерубаева, 1', zip: '100000' }],
  }, 201, 'регистрация (попытка указать role=admin)');
  const userA = r?.data?._id;
  let tokenA = r?.accessToken;
  check(r?.data?.role === 'customer', 'роль всё равно customer — стать админом при регистрации нельзя');
  check(typeof r?.accessToken === 'string' && typeof r?.refreshToken === 'string', 'выданы accessToken и refreshToken');
  check(!leaks(r), 'в ответе нет пароля/хеша');
  r = await call('POST', '/api/auth/register', { name: 'Слабый', email: `weak.${s}@example.com`, password: '12345' }, 400, 'слабый пароль');
  check(r?.error?.details?.password, 'ошибка в поле password');
  await call('POST', '/api/auth/register', { name: 'Дубль', email: emailA.toUpperCase(), password: PASS_A }, 409, 'повторный email');
  await call('POST', '/api/auth/register', { name: 'Инъекция', email: { $gt: '' }, password: PASS_A }, 400, 'NoSQL-инъекция в email');

  const emailB = `buyer.b.${s}@example.com`;
  r = await call('POST', '/api/auth/register', {
    name: 'Покупатель Б', email: emailB, password: 'Str0ngPass!B',
    addresses: [{ city: 'Павлодар', street: 'ул. Ленина, 5' }],
  }, 201, 'регистрация второго покупателя');
  const userB = r?.data?._id;
  const tokenB = r?.accessToken;

  // ======================== Вход ========================
  r = await call('POST', '/api/auth/login', { email: emailA, password: 'WrongPass1' }, 401, 'неверный пароль');
  const wrongPassMsg = r?.error?.message;
  r = await call('POST', '/api/auth/login', { email: `nobody.${s}@example.com`, password: 'WrongPass1' }, 401, 'несуществующий email');
  check(wrongPassMsg && wrongPassMsg === r?.error?.message, 'одинаковое сообщение — нельзя узнать, есть ли такой email');
  await call('POST', '/api/auth/login', { email: { $ne: null }, password: { $ne: null } }, 400, 'NoSQL-инъекция {"$ne": null} при входе');
  r = await call('POST', '/api/auth/login', { email: emailA, password: PASS_A }, 200, 'вход покупателя А');
  tokenA = r?.accessToken;
  const refreshA = r?.refreshToken;
  check(!leaks(r), 'в ответе нет пароля/хеша');
  const decoded = jwt.decode(tokenA, { complete: true });
  check(decoded?.header?.alg === 'HS256' && decoded?.payload?.sub === userA && decoded?.payload?.role === 'customer', 'JWT: alg HS256, sub = id, role = customer');
  check(decoded?.payload?.exp - decoded?.payload?.iat <= 15 * 60, `JWT живёт ≤ 15 мин (${decoded?.payload?.exp - decoded?.payload?.iat} с)`);
  check(!JSON.stringify(decoded?.payload).includes('@'), 'в payload нет email и других персональных данных');
  r = await call('POST', '/api/auth/login', ADMIN, 200, 'вход администратора');
  const adminToken = r?.accessToken;
  const adminId = r?.data?._id;

  // ======================== Проверка токена ========================
  await call('GET', '/api/auth/me', undefined, 401, 'профиль без токена');
  await call('GET', '/api/auth/me', undefined, 401, 'мусор вместо токена', 'not.a.jwt');
  const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userA, role: 'admin' })).toString('base64url')}.`;
  await call('GET', '/api/stats/orders-by-status', undefined, 401, 'поддельный токен alg=none с role=admin', unsigned);
  const wrongKey = jwt.sign({ role: 'admin', ver: 0 }, 'some-other-secret-that-attacker-knows-1234', { subject: userA, issuer: config.jwt.issuer, audience: config.jwt.audience, expiresIn: '15m' });
  await call('GET', '/api/stats/orders-by-status', undefined, 401, 'токен, подписанный чужим ключом', wrongKey);
  const expired = jwt.sign({ role: 'customer', ver: 0, exp: Math.floor(Date.now() / 1000) - 60 }, config.jwt.accessSecret, { subject: userA, issuer: config.jwt.issuer, audience: config.jwt.audience });
  r = await call('GET', '/api/auth/me', undefined, 401, 'просроченный токен', expired);
  check(/истёк/.test(r?.error?.message || ''), 'сообщение «срок действия истёк»');
  const otherAud = jwt.sign({ role: 'customer', ver: 0 }, config.jwt.accessSecret, { subject: userA, issuer: config.jwt.issuer, audience: 'other-app', expiresIn: '15m' });
  await call('GET', '/api/auth/me', undefined, 401, 'токен для другого приложения (audience)', otherAud);
  r = await call('GET', '/api/auth/me', undefined, 200, 'свой профиль', tokenA);
  check(r?.data?.email === emailA && !leaks(r), 'это А, секретных полей нет');
  r = await call('PATCH', '/api/auth/me', { name: 'Покупатель А.', role: 'admin', email: 'hacker@example.com' }, 200, 'правка профиля (попытка сменить role и email)', tokenA);
  check(r?.data?.name === 'Покупатель А.' && r?.data?.role === 'customer' && r?.data?.email === emailA, 'имя изменилось, role и email — нет');

  // ======================== Категории (чтение — все, запись — admin) ========================
  r = await call('GET', '/api/categories?page=1&limit=2&sort=name', undefined, 200, 'список категорий без входа');
  check(r?.data?.length <= 2 && r?.meta?.limit === 2 && r?.meta?.total >= 1, 'пагинация: limit=2');
  check(lastHeaders.has('ratelimit-policy') && lastHeaders.has('ratelimit'), `rate limit: заголовки RateLimit-Policy (${lastHeaders.get('ratelimit-policy')}) и RateLimit`);
  const catBody = { name: `Тест-категория ${s}`, slug: `test-${s}`, description: 'Создана smoke-тестом' };
  await call('POST', '/api/categories', catBody, 401, 'создать категорию без входа');
  await call('POST', '/api/categories', catBody, 403, 'создать категорию покупателем', tokenA);
  r = await call('POST', '/api/categories', catBody, 201, 'создать категорию администратором', adminToken);
  const catId = r?.data?._id;
  await call('POST', '/api/categories', { name: `тест-категория ${s}`, slug: `test-${s}-2` }, 409, 'дубль названия (без учёта регистра)', adminToken);
  r = await call('POST', '/api/categories', { name: 'A', slug: 'Плохой slug' }, 400, 'валидация', adminToken);
  check(r?.error?.details?.name && r?.error?.details?.slug, 'ошибки name и slug');
  r = await call('GET', `/api/categories/${catId}`, undefined, 200, 'категория по id');
  check(r?.data?.productCount === 0, 'productCount = 0');
  await call('PATCH', `/api/categories/${catId}`, { description: 'Взлом' }, 403, 'изменить категорию покупателем', tokenA);
  r = await call('PATCH', `/api/categories/${catId}`, { description: 'Обновлено' }, 200, 'изменить категорию администратором', adminToken);
  check(r?.data?.description === 'Обновлено', 'описание обновилось');
  await call('GET', '/api/categories/123', undefined, 400, 'некорректный id');
  await call('GET', `/api/categories/${missingId}`, undefined, 404, 'несуществующий id');
  await call('GET', '/api/categories?sort=password', undefined, 400, 'сортировка по запрещённому полю');

  // ======================== Пользователи (только admin) ========================
  await call('GET', '/api/users', undefined, 401, 'список пользователей без входа');
  await call('GET', '/api/users', undefined, 403, 'список пользователей покупателем', tokenA);
  r = await call('GET', '/api/users?limit=100', undefined, 200, 'список пользователей администратором', adminToken);
  check(r?.meta?.total >= 6 && !leaks(r), 'пользователи есть, паролей/хешей в ответе нет');
  r = await call('POST', '/api/users', { name: 'Менеджер', email: `manager.${s}@example.com`, password: 'Manager2026', role: 'customer', phone: '+77001234567' }, 201, 'администратор создаёт пользователя', adminToken);
  const userM = r?.data?._id;
  check(!leaks(r), 'пароля в ответе нет');
  await call('POST', '/api/users', { name: 'Без пароля', email: `nopass.${s}@example.com` }, 400, 'пользователь без пароля', adminToken);
  r = await call('GET', `/api/users?city=${encodeURIComponent('Караганда')}&q=${encodeURIComponent(emailA)}`, undefined, 200, 'фильтр по городу во встроенном массиве', adminToken);
  check(r?.meta?.total === 1, 'найден 1 пользователь');
  r = await call('PATCH', `/api/users/${userM}`, { phone: '+77007654321' }, 200, 'изменить пользователя', adminToken);
  check(r?.data?.phone === '+77007654321', 'телефон обновился');
  await call('PATCH', `/api/users/${adminId}`, { role: 'customer' }, 409, 'админ не может понизить сам себя', adminToken);
  await call('GET', `/api/users/${userA}?include=orders`, undefined, 200, 'пользователь с заказами', adminToken);
  await call('GET', '/api/users?role=superuser', undefined, 400, 'неверный фильтр role', adminToken);

  // ======================== Товары (чтение — все, запись — admin) ========================
  const sku = `TEST-${s.toUpperCase()}`;
  const productBody = { name: `Тестовый смартфон ${s}`, sku, price: 99990, stock: 5, category: catId, tags: ['Тест', 'Смартфон'], rating: { avg: 5, count: 1000 } };
  await call('POST', '/api/products', productBody, 403, 'создать товар покупателем', tokenA);
  r = await call('POST', '/api/products', productBody, 201, 'создать товар администратором', adminToken);
  const productId = r?.data?._id;
  check(r?.data?.category?.name === `Тест-категория ${s}`, 'category подтянута populate');
  check(r?.data?.rating?.count === 0, 'rating с клиента проигнорирован');
  await call('POST', '/api/products', { name: 'Без категории', sku: 'NOCAT-1', price: 1, category: missingId }, 400, 'несуществующая категория', adminToken);
  r = await call('GET', `/api/products?category=${catId}`, undefined, 200, 'каталог без входа: фильтр по категории');
  check(r?.meta?.total === 1 && r?.data?.[0]?.reviews === undefined, '1 товар, отзывы в списке не отдаются');
  r = await call('GET', '/api/products?minPrice=50000&maxPrice=300000&inStock=true&sort=-price&limit=5', undefined, 200, 'фильтр по цене + сортировка');
  const prices = (r?.data || []).map((p) => p.price);
  check(prices.length > 0 && prices.every((p, i) => p >= 50000 && p <= 300000 && (i === 0 || prices[i - 1] >= p)), `цены по убыванию: ${prices.join(', ')}`);
  r = await call('GET', `/api/products?q=${encodeURIComponent('смартфоны')}`, undefined, 200, 'полнотекстовый поиск');
  check(r?.meta?.total >= 1, `найдено: ${r?.meta?.total}`);
  const allProducts = (await call('GET', '/api/products?limit=1', undefined, 200, 'всего товаров'))?.meta?.total;
  r = await call('GET', '/api/products?price[$gt]=0&category[$ne]=x&limit=1', undefined, 200, 'попытка передать операторы MongoDB в query');
  check(r?.meta?.total === allProducts, 'операторы в query не превратились в фильтр (Express 5 не разбирает вложенные объекты)');
  await call('PATCH', `/api/products/${productId}`, { price: 1 }, 403, 'изменить цену покупателем', tokenA);
  r = await call('PATCH', `/api/products/${productId}`, { price: 89990, stock: 3 }, 200, 'изменить цену и остаток администратором', adminToken);
  check(r?.data?.price === 89990 && r?.data?.stock === 3, 'цена 89990, остаток 3');
  await call('DELETE', `/api/categories/${catId}`, undefined, 409, 'нельзя удалить категорию с товарами', adminToken);

  // ======================== Отзывы (автор — из токена) ========================
  await call('POST', `/api/products/${productId}/reviews`, { rating: 5 }, 401, 'отзыв без входа');
  await call('POST', `/api/products/${productId}/reviews`, { rating: 7 }, 400, 'оценка вне 1–5', tokenA);
  r = await call('POST', `/api/products/${productId}/reviews`, { user: userB, rating: 5, comment: 'Отлично' }, 201, 'отзыв А (попытка подставить user = Б)', tokenA);
  const reviewId = r?.data?._id;
  check(r?.data?.user === userA, 'автор отзыва — А (из токена), подмена не сработала');
  check(r?.rating?.avg === 5 && r?.rating?.count === 1, 'rating пересчитан: 5 / 1');
  await call('POST', `/api/products/${productId}/reviews`, { rating: 4 }, 409, 'повторный отзыв того же пользователя', tokenA);
  r = await call('GET', `/api/products/${productId}/reviews`, undefined, 200, 'отзывы без входа');
  check(r?.data?.[0]?.user?.name === 'Покупатель А.' && !leaks(r), 'автор подтянут, без email и пароля');
  await call('PATCH', `/api/products/${productId}/reviews/${reviewId}`, { rating: 1 }, 403, 'Б меняет чужой отзыв', tokenB);
  r = await call('PATCH', `/api/products/${productId}/reviews/${reviewId}`, { rating: 4 }, 200, 'А меняет свой отзыв', tokenA);
  check(r?.rating?.avg === 4, 'rating.avg = 4');

  // ======================== Заказы (покупатель — только свои) ========================
  await call('GET', '/api/orders', undefined, 401, 'заказы без входа');
  r = await call('POST', '/api/orders', { user: userB, items: [{ product: productId, quantity: 2 }] }, 201, 'А оформляет заказ (попытка указать user = Б)', tokenA);
  const orderId = r?.data?._id;
  check(r?.data?.user?._id === userA, 'заказ оформлен на А — user из токена');
  check(r?.data?.total === 179980, `total посчитан сервером: ${r?.data?.total}`);
  check(r?.data?.shippingAddress?.city === 'Караганда', 'адрес — копия из профиля А');
  r = await call('GET', `/api/products/${productId}`, undefined, 200, 'остаток после заказа');
  check(r?.data?.stock === 1, 'stock: 3 - 2 = 1');
  r = await call('POST', '/api/orders', { items: [{ product: productId, quantity: 5 }] }, 409, 'не хватает товара', tokenA);
  check(r?.error?.details?.available === 1, 'available = 1');
  await call('POST', '/api/orders', { items: [] }, 400, 'пустой заказ', tokenA);
  r = await call('GET', '/api/orders', undefined, 200, 'А видит свои заказы', tokenA);
  check(r?.meta?.total === 1 && r?.data?.[0]?._id === orderId, 'у А ровно 1 заказ');
  r = await call('GET', `/api/orders?user=${userA}`, undefined, 200, 'Б пытается отфильтровать заказы А', tokenB);
  check(r?.meta?.total === 0, 'Б не видит чужие заказы (фильтр подменяется на свой)');
  await call('GET', `/api/orders/${orderId}`, undefined, 404, 'Б открывает заказ А по id', tokenB);
  await call('PATCH', `/api/orders/${orderId}`, { status: 'cancelled' }, 404, 'Б отменяет заказ А', tokenB);
  r = await call('GET', `/api/orders/${orderId}`, undefined, 200, 'А открывает свой заказ', tokenA);
  check(r?.data?.items?.[0]?.product?.sku === sku && !leaks(r), 'items.product подтянут, секретов нет');
  await call('PATCH', `/api/orders/${orderId}`, { status: 'paid' }, 403, 'покупатель сам ставит «оплачен»', tokenA);
  r = await call('PATCH', `/api/orders/${orderId}`, { status: 'paid' }, 200, 'администратор: new -> paid', adminToken);
  check(r?.data?.status === 'paid', 'статус paid');
  await call('PATCH', `/api/orders/${orderId}`, { status: 'delivered' }, 409, 'недопустимый переход paid -> delivered', adminToken);
  r = await call('PATCH', `/api/orders/${orderId}`, { status: 'cancelled', comment: 'Передумал' }, 200, 'А отменяет свой оплаченный заказ', tokenA);
  check(r?.data?.status === 'cancelled', 'статус cancelled');
  r = await call('GET', `/api/products/${productId}`, undefined, 200, 'остаток после отмены');
  check(r?.data?.stock === 3, 'товар вернулся на склад: stock = 3');
  r = await call('GET', '/api/orders?status=delivered&limit=50', undefined, 200, 'администратор видит все заказы', adminToken);
  check(r?.meta?.total >= 3 && r?.data?.every((o) => o.status === 'delivered'), `доставленных из seed: ${r?.meta?.total}`);
  await call('DELETE', `/api/users/${userA}`, undefined, 409, 'нельзя удалить пользователя с заказами', adminToken);
  await call('DELETE', `/api/orders/${orderId}`, undefined, 403, 'покупатель удаляет заказ', tokenA);
  await call('DELETE', `/api/orders/${orderId}`, undefined, 200, 'администратор удаляет заказ', adminToken);

  // ======================== Статистика (только admin) ========================
  await call('GET', '/api/stats/sales-by-category', undefined, 403, 'статистика покупателем', tokenA);
  r = await call('GET', '/api/stats/sales-by-category', undefined, 200, 'выручка по категориям', adminToken);
  check(Array.isArray(r?.data) && r.data.length > 0, 'есть строки');
  await call('GET', '/api/stats/orders-by-status', undefined, 200, 'заказы по статусам', adminToken);

  // ======================== Refresh-токены: ротация и повторное использование ========================
  r = await call('POST', '/api/auth/refresh', { refreshToken: refreshA }, 200, 'обновить пару токенов');
  const refreshA2 = r?.refreshToken;
  check(refreshA2 && refreshA2 !== refreshA && r?.accessToken, 'выдан новый refresh-токен (ротация)');
  await call('GET', '/api/auth/me', undefined, 200, 'новый access-токен работает', r?.accessToken);
  r = await call('POST', '/api/auth/refresh', { refreshToken: refreshA }, 401, 'повторное использование старого refresh (кража)');
  check(/уже использован/.test(r?.error?.message || ''), 'сервер распознал повторное использование');
  await call('POST', '/api/auth/refresh', { refreshToken: refreshA2 }, 401, 'вся цепочка отозвана: новый refresh тоже не работает');
  await call('POST', '/api/auth/refresh', { refreshToken: { $ne: null } }, 400, 'NoSQL-инъекция в refreshToken');
  r = await call('POST', '/api/auth/login', { email: emailA, password: PASS_A }, 200, 'снова вход А');
  const refreshA3 = r?.refreshToken;
  r = await call('POST', '/api/auth/logout', { refreshToken: refreshA3 }, 200, 'выход');
  await call('POST', '/api/auth/refresh', { refreshToken: refreshA3 }, 401, 'после выхода refresh не работает');

  // ======================== Смена пароля ========================
  r = await call('POST', '/api/auth/login', { email: emailA, password: PASS_A }, 200, 'вход А перед сменой пароля');
  const oldAccess = r?.accessToken;
  const oldRefresh = r?.refreshToken;
  await call('PATCH', '/api/auth/password', { currentPassword: 'WrongPass1', newPassword: 'N3wPassword!' }, 401, 'неверный текущий пароль', oldAccess);
  await call('PATCH', '/api/auth/password', { currentPassword: PASS_A, newPassword: 'short' }, 400, 'слабый новый пароль', oldAccess);
  r = await call('PATCH', '/api/auth/password', { currentPassword: PASS_A, newPassword: 'N3wPassword!' }, 200, 'смена пароля', oldAccess);
  const newAccess = r?.accessToken;
  r = await call('GET', '/api/auth/me', undefined, 401, 'старый access-токен после смены пароля', oldAccess);
  check(/Пароль был изменён/.test(r?.error?.message || ''), 'сообщение «пароль был изменён»');
  await call('POST', '/api/auth/refresh', { refreshToken: oldRefresh }, 401, 'старый refresh после смены пароля');
  await call('GET', '/api/auth/me', undefined, 200, 'новый access-токен работает', newAccess);
  await call('POST', '/api/auth/login', { email: emailA, password: PASS_A }, 401, 'вход со старым паролем');
  r = await call('POST', '/api/auth/login', { email: emailA, password: 'N3wPassword!' }, 200, 'вход с новым паролем');
  await call('POST', '/api/auth/logout-all', undefined, 200, 'завершить все сессии', r?.accessToken);

  // ======================== Блокировка после неудачных входов ========================
  const emailL = `locked.${s}@example.com`;
  r = await call('POST', '/api/auth/register', { name: 'Жертва подбора', email: emailL, password: 'L0ckedPass' }, 201, 'пользователь для проверки блокировки');
  const userL = r?.data?._id;
  for (let i = 1; i <= config.maxLoginAttempts; i += 1) {
    await call('POST', '/api/auth/login', { email: emailL, password: `Guess${i}xyz` }, 401, `подбор пароля, попытка ${i}`);
  }
  r = await call('POST', '/api/auth/login', { email: emailL, password: 'L0ckedPass' }, 423, 'правильный пароль, но аккаунт заблокирован');
  check(/заблокирован/.test(r?.error?.message || ''), 'сообщение о временной блокировке');

  // ======================== Очистка ========================
  r = await call('DELETE', `/api/products/${productId}/reviews/${reviewId}`, undefined, 200, 'администратор удаляет отзыв', adminToken);
  check(r?.rating?.count === 0, 'rating.count = 0');
  await call('DELETE', `/api/products/${productId}`, undefined, 403, 'покупатель удаляет товар', tokenB);
  await call('DELETE', `/api/products/${productId}`, undefined, 200, 'удалить товар', adminToken);
  await call('DELETE', `/api/categories/${catId}`, undefined, 200, 'удалить пустую категорию', adminToken);
  await call('DELETE', `/api/users/${adminId}`, undefined, 409, 'админ не может удалить сам себя', adminToken);
  for (const [id, label] of [[userA, 'А'], [userB, 'Б'], [userL, 'для блокировки'], [userM, 'созданного админом']]) {
    await call('DELETE', `/api/users/${id}`, undefined, 200, `удалить пользователя ${label}`, adminToken);
  }
  await call('GET', '/api/auth/me', undefined, 401, 'токен удалённого пользователя не работает', tokenB);

  // ======================== Прочие ошибки ========================
  await call('GET', '/api/unknown', undefined, 404, 'несуществующий маршрут');
  await call('POST', '/api/auth/login', '{"email": ', 400, 'битый JSON');
  await call('POST', '/api/auth/login', JSON.stringify({ email: 'x@example.com', password: 'x'.repeat(120 * 1024) }), 413, 'слишком большое тело запроса');

  const failed = results.filter((x) => !x.ok);
  const requests = results.filter((x) => x.method !== 'CHECK').length;
  log(`\nИтого: запросов ${requests}, проверок ${results.length - requests}, ошибок ${failed.length}`);
  return { results, failed };
}

if (require.main === module) {
  runSmoke()
    .then(({ failed }) => process.exit(failed.length ? 1 : 0))
    .catch((err) => {
      console.error('Smoke-прогон упал:', err.message, `(сервер запущен на ${DEFAULT_BASE}?)`);
      process.exit(1);
    });
}

module.exports = { runSmoke };
