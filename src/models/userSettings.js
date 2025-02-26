const mongoose = require('mongoose');

const userSettingsSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  postponeSettings: { type: [String], default: ["5 мин", "10 мин", "15 мин", "30 мин", "1 час", "2 часа", "3 часа", "4 часа", "1 день", "2 дня", "3 дня", "7 дней", "1 неделя", "утро", "вечер"] },
  // По умолчанию выбраны: "30 мин", "1 час", "3 часа", "утро", "вечер"
  selectedPostponeSettings: { type: [String], default: ["30 мин", "1 час", "3 часа", "утро", "вечер"] },
  timezone: { type: String, default: 'Europe/Moscow' }
});

module.exports = mongoose.model('UserSettings', userSettingsSchema);