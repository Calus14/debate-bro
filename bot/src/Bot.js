import { Client, GatewayIntentBits, Partials, Collection, Events } from 'discord.js';
import Commands from './Commands.js';
import EventsMap from './Events.js';

class Bot {
    constructor() {
        this.client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
            partials: [Partials.Channel],
        });

        this.commands = new Collection(Object.entries(Commands).map(([name, def]) => [name, def]));
        this.sessions = new Map();
    }

    _registerEvents() {
        for (const [event, handler] of Object.entries(EventsMap)) {
            this.client.on(event, (...args) => handler(this, ...args));
        }
    }

    async start() {
        this._registerEvents();
        await this.client.login(process.env.DISCORD_BOT_TOKEN);
        await this.client.application.commands.set(Object.values(Commands).map(c => c.data));
    }
}

export default Bot;