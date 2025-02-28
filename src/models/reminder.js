const mongoose = require('mongoose');

const cycleSchema = new mongoose.Schema({
  plannedTime: { type: Date, required: true },
  postponedReminder: { type: Date, required: true },
  messageId: { type: Number, required: true }
}, { _id: false });

const reminderSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  description: { type: String, required: true },
  datetime: { type: Date }, // Убрано required: true
  repeat: { type: String, default: null },
  nextReminder: { type: Date, default: null },
  lastNotified: { type: Date, default: null },
  cycles: { type: [cycleSchema], default: [] },
  messageId: { type: Number, default: null },
  postponedReminder: { type: Date, default: null },
  completed: { type: Boolean, default: false },
  // Новые поля для инерционного цикла:
  inertiaMessageId: { type: Number, default: null },
  initialMessageEdited: { type: Boolean, default: false }
});

module.exports = mongoose.models.Reminder || mongoose.model('Reminder', reminderSchema);