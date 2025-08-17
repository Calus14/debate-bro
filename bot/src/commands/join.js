import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import RecorderSession from '../recorderSession.js';

// Use the global logger if available; otherwise fall back to console.
const logger = global.logger || console;

export default {
    data: new SlashCommandBuilder().setName('join').setDescription('Join and start recording voice channel.'),
    async execute(bot, interaction) {
        const channel = interaction.member?.voice?.channel;
        if (!channel) {
            return interaction.reply({ content: "⚠️ You aren't in a voice channel!", flags: MessageFlags.Ephemeral });
        }
        if (bot.sessions.has(interaction.guildId)) {
            return interaction.reply({ content: "⚠️ Already recording!", flags: MessageFlags.Ephemeral });
        }

        const session = new RecorderSession(channel);
        session.start();
        bot.sessions.set(interaction.guildId, session);

        try {
            logger.info(`Join command invoked by guild ${interaction.guildId}: recording started`);
        } catch {}

        await interaction.reply({ content: ' Recording started. Use `/leave` to stop.', flags: MessageFlags.Ephemeral });
    }
};