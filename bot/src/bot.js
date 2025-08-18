import { Client, GatewayIntentBits, Partials, Collection, Events } from 'discord.js';
import { config, requireConfig } from "./config.js";
import commands from "./commands/index.js";
import EventsMap from './events.js';

class Bot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildVoiceStates,
            ],
            partials: [Partials.Channel],
        });

        this.commands = new Collection(commands);
        this.sessions = new Map();
    }

    _registerEvents() {
        for (const [event, handler] of Object.entries(EventsMap)) {
            this.client.on(event, (...args) => handler(this, ...args));
        }
    }

    async start() {
        requireConfig(["DISCORD_TOKEN"]);
        this._registerEvents();
        await this.client.login(config.DISCORD_TOKEN);
        // Register slash commands (use toJSON() when available)
        const body = [...this.commands.values()].map(c => c.data.toJSON ? c.data.toJSON() : c.data);
        // For fast dev, set guild-scoped if DEV_GUILD_ID is provided; otherwise registers globally.
        const guildId = config.DEV_GUILD_ID;
        await this.client.application.commands.set(body, guildId);
    }
}

export default Bot;