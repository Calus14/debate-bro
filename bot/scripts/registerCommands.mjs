import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import commands from '../src/commands/index.js';

// Note to self copy .env.local to .env and run, just dont commit the change

const token   = process.env.DISCORD_BOT_TOKEN;
const appId   = process.env.DISCORD_BOT_APP_ID;
const guildId = process.env.DEV_GUILD_ID;  // optional; omit for global

const rest = new REST({ version: '10' }).setToken(token);
const body = [...commands.values()].map(c => c.data.toJSON?.() ?? c.data);

(async () => {
    try {
        if (guildId) {
            await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: [] }); // clear
            await rest.put(Routes.applicationGuildCommands(appId, guildId), { body });     // set
            console.log(`Registered ${body.length} guild commands to ${guildId}`);
        } else {
            await rest.put(Routes.applicationCommands(appId), { body });
            console.log(`Registered ${body.length} GLOBAL commands`);
        }
    } catch (e) {
        console.error('Register failed:', e);
        process.exit(1);
    }
})();