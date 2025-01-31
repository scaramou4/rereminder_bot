const schedule = require('node-schedule');
const mongoose = require('mongoose');
const bot = require('./botInstance');

const reminderSchema = new mongoose.Schema({
  userId: String,
  description: String,
  datetime: Date,
  repeat: String,
});

const Reminder = mongoose.models.Reminder || mongoose.model('Reminder', reminderSchema);

async function checkReminders() {
  const now = new Date();
  now.setSeconds(0, 0);

  const reminders = await Reminder.find({
    datetime: {
      $gte: now,
      $lt: new Date(now.getTime() + 60000)
    }
  });

  for (let reminder of reminders) {
    bot.sendMessage(reminder.userId, `🔔 ${reminder.description}`);

    if (reminder.repeat) {
      let newDate = new Date(reminder.datetime);
      if (reminder.repeat === "daily") newDate.setDate(newDate.getDate() + 1);
      if (reminder.repeat === "weekly") newDate.setDate(newDate.getDate() + 7);
      if (reminder.repeat === "monthly") newDate.setMonth(newDate.getMonth() + 1);

      reminder.datetime = newDate;
      await reminder.save();
    } else {
      await Reminder.deleteOne({ _id: reminder._id });
    }
  }
}

schedule.scheduleJob("* * * * *", checkReminders);
module.exports = { checkReminders };