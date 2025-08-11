require('dotenv').config(); // loads .env if present
require('dotenv').config({ path: '.env.local', override: true }); // overrides with .env.local
const { setupLogging } = require('./src/config');
const Bot = require('./src/Bot');

setupLogging();
const bot = new Bot();
bot.start();