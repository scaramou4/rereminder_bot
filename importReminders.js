// importReminders.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');
const { DateTime } = require('luxon');

// Импортируем функцию createReminder из reminderScheduler
const { createReminder } = require('./src/reminderScheduler');

async function importReminders() {
  // Подключаемся к MongoDB
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/reminders', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log("Connected to MongoDB");

  // Задаем userId, от имени которого будут создаваться напоминания
  const userId = '1719436';

  // Путь к CSV файлу (обновите путь, если необходимо)
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
            const description = row.description;
            const repeat = row.repeat && row.repeat.trim() !== '' ? row.repeat.trim() : null;
            console.log(`Creating reminder id ${row.id} with description: "${description}", repeat: ${repeat}`);
            await createReminder(userId, description, dateObj, repeat);
            console.log(`Imported reminder id ${row.id}`);
          } catch (err) {
            console.error(`Error importing reminder id ${row.id}: ${err.message}`);
          }
        }
        console.log('Import finished.');
        resolve();
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