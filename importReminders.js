// importReminders.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');
const { DateTime } = require('luxon');

// Импортируем функции из reminderScheduler
const { createReminder, scheduleReminder } = require('./src/reminderScheduler');

async function importReminders() {
  // Подключаемся к MongoDB
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/reminders', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log("Connected to MongoDB");

  // Задаем userId, от имени которого будут создаваться напоминания
  const userId = '1719436';

  // Путь к CSV файлу
  const filePath = path.join(__dirname, 'reminders.csv');

  const reminders = [];

  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => {
        console.log("Read row:", data);
        reminders.push(data);
      })
      .on('end', async () => {
        console.log(`Read ${reminders.length} reminders from CSV`);
        for (const row of reminders) {
          try {
            console.log(`Processing reminder id ${row.id}`);
            // Предполагается, что дата в формате YYYY-MM-DD, время – HH:mm
            const dateStr = row.date;
            const timeStr = row.time;
            const dt = DateTime.fromFormat(`${dateStr} ${timeStr}`, 'yyyy-MM-dd HH:mm', { zone: 'Europe/Moscow' });
            if (!dt.isValid) {
              console.error(`Invalid date/time for reminder id ${row.id}: ${dt.invalidExplanation}`);
              continue;
            }
            const dateObj = dt.toJSDate();
            console.log(`Parsed datetime for reminder id ${row.id}: ${dt.toISO()}`);
            let description = row.description;
            // Если в CSV присутствует поле repeat, обрабатываем его:
            let repeat = row.repeat && row.repeat.trim() !== '' ? row.repeat.trim() : null;
            // Если repeat содержит фиксированную дату (например, "каждое 8 апреля в 09:00"),
            // то преобразуем его в "1 год"
            if (repeat && /^(каждое|каждый)\s+\d+\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i.test(repeat)) {
              repeat = "1 год";
            }
            console.log(`Creating reminder id ${row.id} with description: "${description}", repeat: ${repeat}`);
            const reminder = await createReminder(userId, description, dateObj, repeat);
            // Сразу планируем задачу в Agenda
            await scheduleReminder(reminder);
            console.log(`Imported reminder id ${row.id}`);
          } catch (err) {
            console.error(`Error importing reminder id ${row.id}: ${err.message}`);
          }
        }
      })
      .on('error', (err) => {
        console.error("Error reading CSV:", err);
        reject(err);
      });
  });
}

importReminders()
  .then(() => {
    console.log('All reminders imported.');
    process.exit(0);
  })
  .catch(err => {
    console.error('Import error:', err);
    process.exit(1);
  });