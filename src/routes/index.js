const { Router } = require('express');
const validateId = require('../middleware/validateId');
const { authenticate, authorize } = require('../middleware/auth');
const { authLimiter } = require('../middleware/security');
const auth = require('../controllers/authController');
const categories = require('../controllers/categoryController');
const products = require('../controllers/productController');
const users = require('../controllers/userController');
const orders = require('../controllers/orderController');
const stats = require('../controllers/statsController');

const adminOnly = [authenticate, authorize('admin')];

/*
 * Матрица доступа
 *   гость     — каталог (категории, товары, отзывы) только на чтение, регистрация, вход
 *   customer  — + свой профиль, свои заказы (создать / смотреть / отменить), свои отзывы
 *   admin     — всё: управление каталогом, пользователями, всеми заказами, статистика
 */

function buildRouter({ authMax } = {}) {
  const limiter = authLimiter(authMax);

  // ---------- Аутентификация ----------
  const authRouter = Router();
  authRouter.post('/register', limiter, auth.register);
  authRouter.post('/login', limiter, auth.login);
  authRouter.post('/refresh', limiter, auth.refresh);
  authRouter.post('/logout', auth.logout);
  authRouter.post('/logout-all', authenticate, auth.logoutAll);
  authRouter.route('/me').get(authenticate, auth.me).patch(authenticate, auth.updateMe);
  authRouter.patch('/password', authenticate, auth.changePassword);

  // ---------- Каталог: читать могут все, менять — только admin ----------
  function catalogRouter(controller) {
    const router = Router();
    router.param('id', validateId);
    router.route('/').get(controller.list).post(...adminOnly, controller.create);
    router
      .route('/:id')
      .get(controller.get)
      .patch(...adminOnly, controller.update)
      .delete(...adminOnly, controller.remove);
    return router;
  }

  const productRouter = catalogRouter(products);
  productRouter.param('reviewId', validateId);
  productRouter.route('/:id/reviews').get(products.listReviews).post(authenticate, products.addReview);
  productRouter
    .route('/:id/reviews/:reviewId')
    .patch(authenticate, products.updateReview) // автор или admin — проверка в контроллере
    .delete(authenticate, products.deleteReview);

  // ---------- Пользователи: только admin ----------
  const userRouter = Router();
  userRouter.use(...adminOnly);
  userRouter.param('id', validateId);
  userRouter.route('/').get(users.list).post(users.create);
  userRouter.route('/:id').get(users.get).patch(users.update).delete(users.remove);

  // ---------- Заказы: любой вошедший; покупатель видит только свои ----------
  const orderRouter = Router();
  orderRouter.use(authenticate);
  orderRouter.param('id', validateId);
  orderRouter.route('/').get(orders.list).post(orders.create);
  orderRouter
    .route('/:id')
    .get(orders.get)
    .patch(orders.update)
    .delete(authorize('admin'), orders.remove);

  // ---------- Статистика: только admin ----------
  const statsRouter = Router();
  statsRouter.use(...adminOnly);
  statsRouter.get('/sales-by-category', stats.salesByCategory);
  statsRouter.get('/orders-by-status', stats.ordersByStatus);

  const api = Router();
  api.use('/auth', authRouter);
  api.use('/categories', catalogRouter(categories));
  api.use('/products', productRouter);
  api.use('/users', userRouter);
  api.use('/orders', orderRouter);
  api.use('/stats', statsRouter);
  return api;
}

module.exports = buildRouter;
