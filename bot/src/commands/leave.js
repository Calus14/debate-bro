import { SlashCommandBuilder, MessageFlags } from 'discord.js';

// Use the global logger if available; otherwise fall back to console.
const logger = global.logger || console;

export default {
    data: new SlashCommandBuilder().setName('leave').setDescription('Leave and stop recording voice channel.'),
    async execute(bot, interaction) {
        const session = bot.sessions.get(interaction.guildId);
        if (!session) {
            return interaction.reply({content: " I'm not recording here!", flags: MessageFlags.Ephemeral});
        }

        const outPaths = session.stop();
        bot.sessions.delete(interaction.guildId);

        try {
            logger.info(`Leave command invoked by guild ${interaction.guildId}: recording stopped; files are ${outPaths.audioPath} and ${outPaths.metadataPath}`);
        } catch {
        }

        await interaction.reply({
            content: 'Finished listening, feel free to ask for a transcript whenever you want',
            flags: MessageFlags.Ephemeral
        });
    }
};