// src/models/userSettings.js

const mongoose = require('mongoose');

const userSettingsSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  
  // Набор опций для ручного откладывания
  postponeSettings: {
    type: [String],
    default: [
      "5 мин", "10 мин", "15 мин", "30 мин",
      "1 час", "2 часа", "3 часа", "4 часа",
      "1 день", "2 дня", "3 дня", "7 дней",
      "1 неделя", "утро", "вечер", "…"
    ]
  },

  // Какие из postponeSettings выбраны
  selectedPostponeSettings: {
    type: [String],
    default: ["30 мин", "1 час", "3 часа", "утро", "вечер", "…"]
  },

  // Часовой пояс пользователя
  timezone: { type: String, default: 'Europe/Moscow' },

  // Автооткладывание (в минутах)
  autoPostponeDelay: { type: Number, default: 15 },

  // Новые поля для хранения выбранного времени утра и вечера
  morningTime: { type: String, default: "9:00" },
  eveningTime: { type: String, default: "18:00" }
});

module.exports = mongoose.model('UserSettings', userSettingsSchema);