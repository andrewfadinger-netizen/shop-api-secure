// Заполняет базу тестовыми данными: npm run seed
// ВНИМАНИЕ: перед заполнением очищает коллекции categories, products, users, orders, refreshtokens.
// Тестовые логины: email из seed-data.js, пароли — TEST_PASSWORDS там же.
const mongoose = require('mongoose');
const config = require('../src/config');
const { connectDB } = require('../src/db');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');
const User = require('../src/models/User');
const Order = require('../src/models/Order');
const RefreshToken = require('../src/models/RefreshToken');
const data = require('./seed-data');

const MODELS = [Category, Product, User, Order, RefreshToken];

async function seed({ log = console.log } = {}) {
  await Promise.all(MODELS.map((M) => M.deleteMany({})));
  // Индексы из схем: создать недостающие, удалить лишние
  await Promise.all(MODELS.map((M) => M.syncIndexes()));

  const categories = await Category.create(data.categories);
  const categoryId = Object.fromEntries(categories.map((c) => [c.slug, c._id]));

  const users = await User.create(data.users);
  const userByEmail = Object.fromEntries(users.map((u) => [u.email, u]));

  const products = await Product.create(
    data.products.map((p) => ({
      ...p,
      category: categoryId[p.category],
      reviews: (p.reviews || []).map((r) => ({ ...r, user: userByEmail[r.user]._id })),
    }))
  );
  const productBySku = Object.fromEntries(products.map((p) => [p.sku, p]));

  // Заказы — последовательно, чтобы createdAt шли в порядке массива
  for (const o of data.orders) {
    const user = userByEmail[o.user];
    const address = user.addresses.find((a) => a.isDefault);
    await Order.create({
      user: user._id,
      status: o.status,
      comment: o.comment,
      shippingAddress: { city: address.city, street: address.street, zip: address.zip },
      items: o.items.map(({ sku, quantity }) => {
        const p = productBySku[sku];
        return { product: p._id, name: p.name, sku: p.sku, price: p.price, quantity };
      }),
    });
  }

  const counts = {};
  for (const M of MODELS) counts[M.collection.name] = await M.countDocuments();
  log('База заполнена:', counts);
  return counts;
}

if (require.main === module) {
  connectDB(config.mongoUri)
    .then(() => seed())
    .then(() => mongoose.disconnect())
    .catch(async (err) => {
      console.error('Ошибка заполнения базы:', err.message);
      await mongoose.disconnect();
      process.exit(1);
    });
}

module.exports = { seed };
