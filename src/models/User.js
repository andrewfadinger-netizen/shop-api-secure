const bcrypt = require('bcryptjs');
const { Schema, model } = require('mongoose');
const config = require('../config');
const { addressSchema } = require('./schemas/address');

const ROLES = ['customer', 'admin'];

// Пароль: 8–72 символа (72 байта — предел bcrypt), минимум одна буква и одна цифра
const PASSWORD_RE = /^(?=.*[A-Za-zА-Яа-яЁё])(?=.*\d).{8,72}$/;

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Имя обязательно'],
      trim: true,
      minlength: [2, 'Имя: минимум 2 символа'],
      maxlength: [60, 'Имя: не длиннее 60 символов'],
    },
    email: {
      type: String,
      required: [true, 'Email обязателен'],
      trim: true,
      lowercase: true,
      unique: true, // создаёт уникальный индекс email_1
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Некорректный email'],
    },
    // Хранится только bcrypt-хеш. select: false — поле не попадает в выборки,
    // пока его не запросят явно (.select('+password')).
    password: {
      type: String,
      required: [true, 'Пароль обязателен'],
      select: false,
      validate: {
        validator(value) {
          // хеш уже прошёл проверку при установке пароля
          return this.isModified('password') ? PASSWORD_RE.test(value) : true;
        },
        message: 'Пароль: 8–72 символа, хотя бы одна буква и одна цифра',
      },
    },
    passwordChangedAt: { type: Date, select: false },
    // Версия токенов: записывается в JWT (claim ver). При смене пароля растёт на 1,
    // и все ранее выданные access-токены сразу перестают приниматься.
    tokenVersion: { type: Number, default: 0 },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    phone: {
      type: String,
      trim: true,
      match: [/^\+7\d{10}$/, 'Телефон в формате +7XXXXXXXXXX'],
    },
    role: {
      type: String,
      enum: { values: ROLES, message: 'Роль должна быть customer или admin' },
      default: 'customer',
    },
    // Встроенные документы: адреса читаются всегда вместе с пользователем,
    // их мало (ограничение — 5) и без пользователя они не имеют смысла.
    addresses: {
      type: [addressSchema],
      validate: {
        validator: (list) => list.length <= 5,
        message: 'Не более 5 адресов у одного пользователя',
      },
    },
  },
  {
    timestamps: true,
    id: false,
    toJSON: {
      virtuals: true,
      // Секретные поля не уходят клиенту, даже если их выбрали
      transform(doc, ret) {
        delete ret.password;
        delete ret.passwordChangedAt;
        delete ret.tokenVersion;
        delete ret.failedLoginAttempts;
        delete ret.lockUntil;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

userSchema.index({ role: 1 });
userSchema.index({ 'addresses.city': 1 }); // индекс по полю встроенного массива (multikey)

// Ровно один адрес по умолчанию: если не отмечен ни один — первый,
// если отмечено несколько — остаётся первый отмеченный.
userSchema.pre('validate', function normalizeDefaultAddress() {
  if (!this.addresses || this.addresses.length === 0) return;
  let found = false;
  for (const addr of this.addresses) {
    if (addr.isDefault && !found) found = true;
    else addr.isDefault = false;
  }
  if (!found) this.addresses[0].isDefault = true;
});

// Хеширование пароля перед сохранением (после валидации открытого пароля)
userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, config.bcryptRounds);
  if (!this.isNew) {
    this.passwordChangedAt = new Date();
    this.tokenVersion = (this.tokenVersion || 0) + 1;
  }
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(String(candidate), this.password);
};

userSchema.methods.isLocked = function isLocked() {
  return Boolean(this.lockUntil && this.lockUntil.getTime() > Date.now());
};

// Виртуальная связь «пользователь → его заказы» (ссылка хранится в Order.user).
userSchema.virtual('orders', {
  ref: 'Order',
  localField: '_id',
  foreignField: 'user',
});

userSchema.statics.ROLES = ROLES;
userSchema.statics.PASSWORD_RE = PASSWORD_RE;

module.exports = model('User', userSchema);
