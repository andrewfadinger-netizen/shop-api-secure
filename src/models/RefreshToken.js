const { Schema, model } = require('mongoose');

// Refresh-токен хранится в БД только в виде SHA-256-хеша: утечка базы
// не даёт готовых токенов. Токены одной цепочки ротации объединены family.
const refreshTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    replacedBy: { type: String }, // хеш токена, который пришёл на смену
    createdByIp: { type: String },
    userAgent: { type: String, maxlength: 300 },
  },
  { timestamps: true, versionKey: false }
);

// TTL-индекс: MongoDB сама удаляет документы после expiresAt
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = model('RefreshToken', refreshTokenSchema);
