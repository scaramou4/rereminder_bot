require('dotenv').config();
const { agenda } = require('./src/agendaScheduler');

(async function() {
  await agenda.start();
  const numRemoved = await agenda.cancel({});
  console.log(`Очистка jobs: удалено ${numRemoved} задач.`);
  process.exit(0);
})();