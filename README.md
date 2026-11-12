# Shop API (secure) — безопасный REST API интернет-магазина

Учебный проект по теме **«Разработка безопасного Backend-приложения»**.
Node.js + Express 5 + MongoDB (Mongoose 9): регистрация, JWT-аутентификация, авторизация по ролям, CRUD и защита маршрутов.

Цели:
- **знание:** изучить современные методы обеспечения безопасности веб-приложений;
- **понимание:** исследовать механизмы JWT-аутентификации, авторизации пользователей и защиты REST API;
- **применение:** разработать серверное приложение на Node.js, Express и MongoDB с регистрацией, аутентификацией, CRUD-операциями и защитой маршрутов.

Основа — интернет-магазин из предыдущей работы: категории, товары с отзывами, пользователи с адресами, заказы. В этой работе добавлен слой безопасности.

## Что реализовано

| Механизм | Как |
|---|---|
| Регистрация | `POST /api/auth/register`, политика паролей, роль всегда `customer` |
| Хранение паролей | bcrypt (12 раундов), поле скрыто от выборок и ответов |
| Аутентификация | Access JWT (HS256, 15 мин) + refresh-токен (7 дней, в БД только SHA-256-хеш) |
| Ротация refresh-токенов | Одноразовые; повторное использование → отзыв всей цепочки (защита от кражи) |
| Выход | `logout` (одна сессия), `logout-all` (все устройства) |
| Смена пароля | Все старые access- и refresh-токены перестают работать (`tokenVersion`) |
| Авторизация | Роли `customer` / `admin`, `authorize('admin')`, владелец ресурса (только свои заказы и отзывы) |
| Защита от подбора | Блокировка аккаунта на 15 мин после 5 неудач (423) + rate limit по IP (429) |
| Защита от инъекций | Поля входа — строго строки, `sanitizeFilter`, белые списки полей и фильтров, экранирование regex |
| HTTP-защита | Helmet (CSP, HSTS, X-Frame-Options…), CORS по списку адресов, лимит тела 100 КБ, без `X-Powered-By` |
| Конфигурация | Секреты только в `.env`; сервер не стартует без надёжного `JWT_ACCESS_SECRET` |

Подробно (схемы входа и ротации токенов, матрица доступа, соответствие OWASP API Top 10): [docs/security.md](docs/security.md).
Модель данных и ER-диаграмма: [docs/data-model.md](docs/data-model.md).

## Стек

Node.js ≥ 20.12 (проверено на 24.21), Express 5.3, Mongoose 9.12, MongoDB 9.0, jsonwebtoken 9, bcryptjs 3, helmet 8, cors 2, express-rate-limit 8. Тесты — `node:test` + `mongodb-memory-server`.

## Структура

```
src/
  config.js                 настройки из .env, проверка секрета
  app.js, server.js         Express-приложение, запуск
  models/                   User (пароль, блокировка, tokenVersion), RefreshToken (TTL), Category, Product, Order
  services/tokenService.js  выпуск и проверка JWT, ротация refresh-токенов
  middleware/auth.js        authenticate (кто ты?) и authorize (что тебе можно?)
  middleware/security.js    Helmet, CORS, rate limit
  middleware/errorHandler.js единый формат ошибок
  controllers/              authController + CRUD сущностей (crudFactory с фильтром видимости scope)
  routes/index.js           маршруты и матрица доступа
scripts/                    seed (тестовые данные), smoke (прогон всех запросов)
test/api.test.js            автотесты
requests.http, postman/     все запросы с токенами
docs/                       безопасность, модель данных, ER-диаграмма, лог проверки
```

## Запуск

1. Установить MongoDB (служба `MongoDB Server` или MongoDB Atlas) и Node.js.
2. Зависимости:

   ```bash
   npm install
   ```

3. Создать `.env` из примера и вписать секрет:

   ```bash
   copy .env.example .env
   ```

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   Полученную строку вставить в `JWT_ACCESS_SECRET`. С заглушкой из примера сервер не запустится — это намеренно.

4. Заполнить базу и запустить:

   ```bash
   npm run seed
   ```

   ```bash
   npm start
   ```

   Сервер: http://localhost:3000, база `shop_secure_db`.

5. Проверить:

   ```bash
   npm run smoke
   ```

   121 запрос и 56 проверок против запущенного сервера, включая атаки (поддельный JWT, alg=none, NoSQL-инъекции, чужие заказы, повторный refresh, подбор пароля). Лог — [docs/smoke-run.txt](docs/smoke-run.txt).

   ```bash
   npm test
   ```

   Автотесты на временной БД (5 тестов, в т.ч. rate limit 429).

**Тестовые пользователи** после `npm run seed`: администратор `admin@example.com` и покупатели `aidos@example.com`, `dana@example.com` и др. Пароли — в `TEST_PASSWORDS` в [scripts/seed-data.js](scripts/seed-data.js) (учебные значения, в БД хранятся только хеши).

> Счётчик rate limit хранится в памяти процесса: после перезапуска сервера он обнуляется. Чтобы показать ответ 429, поставьте `AUTH_RATE_LIMIT_MAX=3` в `.env` и перезапустите сервер.

## API

### Аутентификация `/api/auth`

| Метод и путь | Доступ | Тело | Ответ |
|---|---|---|---|
| `POST /register` | все | `name, email, password, phone?, addresses?` | 201 `{ data, accessToken, refreshToken }` |
| `POST /login` | все | `email, password` | 200 `{ data, accessToken, refreshToken }` |
| `POST /refresh` | все | `refreshToken` | 200 новая пара токенов |
| `POST /logout` | все | `refreshToken` | 200 |
| `POST /logout-all` | вошедший | — | 200, все сессии завершены |
| `GET /me` | вошедший | — | свой профиль |
| `PATCH /me` | вошедший | `name, phone, addresses` | свой профиль (role и email не меняются) |
| `PATCH /password` | вошедший | `currentPassword, newPassword` | 200 + новая пара токенов |

Защищённые запросы — с заголовком:

```http
Authorization: Bearer <accessToken>
```

### Ресурсы

| Ресурс | Чтение | Запись |
|---|---|---|
| `/api/categories`, `/api/products` | все | admin |
| `/api/products/:id/reviews` | все | создать — вошедший; изменить/удалить — автор или admin |
| `/api/orders` | вошедший (покупатель — только свои) | создать — вошедший; отменить — владелец; статусы — admin; удалить — admin |
| `/api/users` | admin | admin |
| `/api/stats/sales-by-category`, `/orders-by-status` | admin | — |

Полная матрица доступа — в [docs/security.md](docs/security.md#2-авторизация-матрица-доступа).

Списки поддерживают `?page=&limit=&sort=` и фильтры (товары: `category, minPrice, maxPrice, inStock, tag, minRating, q`; заказы: `status, from, to, minTotal, maxTotal`; пользователи: `role, q, city`).

### Коды ответов

| Код | Когда |
|---|---|
| 400 | Ошибка валидации, слабый пароль, некорректный id или параметр, поле не строка (попытка инъекции) |
| 401 | Нет токена, токен недействителен/просрочен/подделан, неверный email или пароль |
| 403 | Недостаточно прав (роль или чужой отзыв) |
| 404 | Не найдено, в том числе чужой заказ |
| 409 | Дубликат, конфликт статуса, нехватка товара |
| 413 | Тело запроса больше 100 КБ |
| 423 | Аккаунт временно заблокирован после неудачных входов |
| 429 | Превышен лимит запросов |

Формат ошибки: `{ "error": { "status": 401, "message": "Срок действия токена истёк" } }`.

### Postman

Import → [postman/shop-api.postman_collection.json](postman/shop-api.postman_collection.json) → Run collection. 58 запросов в 8 папках, токены `adminToken`, `customerToken`, `aidosToken` и id сохраняются в переменные коллекции автоматически. Те же запросы для VS Code REST Client — [requests.http](requests.http).
