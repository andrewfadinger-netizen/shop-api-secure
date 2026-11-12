// Тестовые данные. Связи задаются «человеческими» ключами (slug, email, sku),
// seed.js превращает их в ObjectId.

const categories = [
  { name: 'Смартфоны', slug: 'smartphones', description: 'Смартфоны на Android и iOS' },
  { name: 'Ноутбуки', slug: 'laptops', description: 'Ноутбуки для учёбы, работы и игр' },
  { name: 'Аудио', slug: 'audio', description: 'Наушники и портативные колонки' },
  { name: 'Аксессуары', slug: 'accessories', description: 'Зарядки, кабели, мыши и чехлы' },
];

const users = [
  {
    name: 'Айдос Сериков',
    email: 'aidos@example.com',
    phone: '+77011112233',
    addresses: [
      { label: 'Дом', city: 'Алматы', street: 'пр. Абая, 52, кв. 14', zip: '050000', isDefault: true },
      { label: 'Работа', city: 'Алматы', street: 'ул. Сатпаева, 90', zip: '050046' },
    ],
  },
  {
    name: 'Дана Ахметова',
    email: 'dana@example.com',
    phone: '+77025554411',
    addresses: [{ label: 'Дом', city: 'Астана', street: 'ул. Кенесары, 40, кв. 7', zip: '010000' }],
  },
  {
    name: 'Арман Жумабеков',
    email: 'arman@example.com',
    phone: '+77073330099',
    addresses: [{ label: 'Общежитие', city: 'Семей', street: 'ул. Глинки, 20', zip: '071400' }],
  },
  {
    name: 'Айгерим Нурланова',
    email: 'aigerim@example.com',
    addresses: [{ label: 'Дом', city: 'Шымкент', street: 'ул. Тауке хана, 5', zip: '160000' }],
  },
  {
    name: 'Ержан Касымов',
    email: 'erzhan@example.com',
    phone: '+77750001122',
    addresses: [{ label: 'Дом', city: 'Алматы', street: 'мкр. Самал-2, 33', zip: '050059' }],
  },
  { name: 'Администратор', email: 'admin@example.com', role: 'admin', addresses: [] },
];

const products = [
  {
    name: 'Samsung Galaxy A55 8/256 ГБ',
    sku: 'SM-A556-256',
    category: 'smartphones',
    price: 219990,
    stock: 15,
    tags: ['смартфон', 'android', 'samsung'],
    description: 'Смартфон с AMOLED-экраном 6,6", камерой 50 Мп и защитой IP67.',
    attributes: [
      { key: 'Экран', value: '6,6" Super AMOLED, 120 Гц' },
      { key: 'Память', value: '8/256 ГБ' },
      { key: 'Аккумулятор', value: '5000 мАч' },
    ],
    reviews: [
      { user: 'aidos@example.com', rating: 5, comment: 'Отличный экран, батареи хватает на день.' },
      { user: 'dana@example.com', rating: 4, comment: 'Хороший, но тяжеловат.' },
    ],
  },
  {
    name: 'Apple iPhone 15 128 ГБ',
    sku: 'IPH15-128',
    category: 'smartphones',
    price: 429990,
    stock: 8,
    tags: ['смартфон', 'ios', 'apple'],
    description: 'iPhone 15 с Dynamic Island и портом USB-C.',
    attributes: [
      { key: 'Экран', value: '6,1" OLED' },
      { key: 'Память', value: '128 ГБ' },
    ],
    reviews: [{ user: 'arman@example.com', rating: 5, comment: 'Камера супер.' }],
  },
  {
    name: 'Xiaomi Redmi Note 13 8/128 ГБ',
    sku: 'RN13-128',
    category: 'smartphones',
    price: 109990,
    stock: 25,
    tags: ['смартфон', 'android', 'xiaomi', 'бюджетный'],
    description: 'Недорогой смартфон с AMOLED-экраном и быстрой зарядкой 33 Вт.',
    attributes: [{ key: 'Память', value: '8/128 ГБ' }],
    reviews: [
      { user: 'aigerim@example.com', rating: 4, comment: 'За свои деньги — отлично.' },
      { user: 'erzhan@example.com', rating: 3, comment: 'Камера слабовата ночью.' },
    ],
  },
  {
    name: 'Lenovo IdeaPad Slim 3 15" Ryzen 5',
    sku: 'LNV-IPS3-R5',
    category: 'laptops',
    price: 289990,
    stock: 6,
    tags: ['ноутбук', 'учёба', 'lenovo'],
    description: 'Лёгкий ноутбук для учёбы: Ryzen 5 7530U, 16 ГБ ОЗУ, SSD 512 ГБ.',
    attributes: [
      { key: 'Процессор', value: 'AMD Ryzen 5 7530U' },
      { key: 'ОЗУ', value: '16 ГБ' },
      { key: 'Накопитель', value: 'SSD 512 ГБ' },
    ],
  },
  {
    name: 'ASUS TUF Gaming F15 RTX 4050',
    sku: 'ASUS-TUF-F15',
    category: 'laptops',
    price: 549990,
    stock: 3,
    tags: ['ноутбук', 'игровой', 'asus'],
    description: 'Игровой ноутбук: Core i5-12500H, RTX 4050, экран 144 Гц.',
    attributes: [
      { key: 'Видеокарта', value: 'NVIDIA RTX 4050 6 ГБ' },
      { key: 'Экран', value: '15,6" IPS 144 Гц' },
    ],
    reviews: [{ user: 'erzhan@example.com', rating: 5, comment: 'Тянет все игры на высоких.' }],
  },
  {
    name: 'Apple MacBook Air 13 M2',
    sku: 'MBA13-M2',
    category: 'laptops',
    price: 549990,
    stock: 0,
    tags: ['ноутбук', 'apple', 'macos'],
    description: 'Тонкий ноутбук на чипе M2, до 18 часов автономной работы.',
    attributes: [{ key: 'Чип', value: 'Apple M2' }],
  },
  {
    name: 'JBL Tune 520BT',
    sku: 'JBL-T520BT',
    category: 'audio',
    price: 24990,
    stock: 40,
    tags: ['наушники', 'bluetooth', 'jbl'],
    description: 'Беспроводные накладные наушники, до 57 часов работы.',
    reviews: [{ user: 'dana@example.com', rating: 4, comment: 'Лёгкие, держат долго.' }],
  },
  {
    name: 'Sony WH-1000XM5',
    sku: 'SONY-XM5',
    category: 'audio',
    price: 169990,
    stock: 5,
    tags: ['наушники', 'шумоподавление', 'sony'],
    description: 'Полноразмерные наушники с активным шумоподавлением.',
    reviews: [
      { user: 'aidos@example.com', rating: 5, comment: 'Лучшее шумоподавление.' },
      { user: 'arman@example.com', rating: 5 },
    ],
  },
  {
    name: 'Колонка JBL Flip 6',
    sku: 'JBL-FLIP6',
    category: 'audio',
    price: 59990,
    stock: 12,
    tags: ['колонка', 'bluetooth', 'jbl'],
    description: 'Портативная колонка с защитой IP67.',
  },
  {
    name: 'Внешний аккумулятор Anker 20000 мАч',
    sku: 'ANK-PB20K',
    category: 'accessories',
    price: 19990,
    stock: 30,
    tags: ['powerbank', 'зарядка', 'anker'],
    description: 'Power bank на 20000 мАч с USB-C PD 20 Вт.',
  },
  {
    name: 'Кабель Baseus USB-C — USB-C 1 м',
    sku: 'BSU-CC-1M',
    category: 'accessories',
    price: 2990,
    stock: 100,
    tags: ['кабель', 'usb-c', 'baseus'],
    description: 'Кабель с поддержкой быстрой зарядки 100 Вт.',
  },
  {
    name: 'Мышь Logitech MX Master 3S',
    sku: 'LOGI-MX3S',
    category: 'accessories',
    price: 54990,
    stock: 9,
    tags: ['мышь', 'беспроводная', 'logitech'],
    description: 'Эргономичная беспроводная мышь для работы.',
    reviews: [{ user: 'aigerim@example.com', rating: 5, comment: 'Очень удобная.' }],
  },
];

// Заказы: товары по sku, адрес — адрес покупателя по умолчанию
const orders = [
  { user: 'aidos@example.com', status: 'delivered', items: [{ sku: 'SM-A556-256', quantity: 1 }, { sku: 'BSU-CC-1M', quantity: 2 }] },
  { user: 'aidos@example.com', status: 'paid', items: [{ sku: 'SONY-XM5', quantity: 1 }], comment: 'Позвонить за час до доставки' },
  { user: 'dana@example.com', status: 'shipped', items: [{ sku: 'JBL-T520BT', quantity: 1 }, { sku: 'ANK-PB20K', quantity: 1 }] },
  { user: 'arman@example.com', status: 'new', items: [{ sku: 'LNV-IPS3-R5', quantity: 1 }, { sku: 'LOGI-MX3S', quantity: 1 }] },
  { user: 'arman@example.com', status: 'delivered', items: [{ sku: 'IPH15-128', quantity: 1 }] },
  { user: 'aigerim@example.com', status: 'cancelled', items: [{ sku: 'ASUS-TUF-F15', quantity: 1 }] },
  { user: 'aigerim@example.com', status: 'delivered', items: [{ sku: 'RN13-128', quantity: 2 }, { sku: 'JBL-FLIP6', quantity: 1 }] },
  { user: 'erzhan@example.com', status: 'new', items: [{ sku: 'ASUS-TUF-F15', quantity: 1 }, { sku: 'LOGI-MX3S', quantity: 1 }] },
];

// ТЕСТОВЫЕ пароли учебной базы (в БД попадут только bcrypt-хеши).
// В реальном проекте такие данные в репозиторий не кладут.
const TEST_PASSWORDS = {
  admin: 'Admin2026secure',
  customer: 'Customer2026',
};
for (const u of users) u.password = u.role === 'admin' ? TEST_PASSWORDS.admin : TEST_PASSWORDS.customer;

module.exports = { categories, users, products, orders, TEST_PASSWORDS };
