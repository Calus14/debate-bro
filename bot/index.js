import dotenv from 'dotenv';
dotenv.config(); // loads .env if present
dotenv.config({ path: '.env.local', override: true }); // overrides with .env.local

import setupLogging from './src/config.js';
import Bot from './src/Bot.js';

setupLogging();
const bot = new Bot();
bot.start();
console.log("✅ Bot Started");