require('dotenv').config({ path: '.env.local', override: true });
const { setupLogging } = require('./src/config');
const Bot = require('./src/Bot');

setupLogging();
const bot = new Bot();
bot.start();