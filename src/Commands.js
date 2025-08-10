const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const RecorderSession = require('./RecorderSession');

// Use the global logger if available; otherwise fall back to console.
const logger = global.logger || console;

module.exports = {
    join: {
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
    },

    leave: {
        data: new SlashCommandBuilder().setName('leave').setDescription('Leave and stop recording voice channel.'),
        async execute(bot, interaction) {
            const session = bot.sessions.get(interaction.guildId);
            if (!session) {
                return interaction.reply({ content: " I'm not recording here!", flags: MessageFlags.Ephemeral });
            }

            const outPaths = session.stop();
            bot.sessions.delete(interaction.guildId);

            try {
                logger.info(`Leave command invoked by guild ${interaction.guildId}: recording stopped; files are ${outPaths.audioPath} and ${outPaths.metadataPath}`);
            } catch {}

            await interaction.reply({
                content: 'Finished listening, feel free to ask for a transcript whenever you want',
                flags: MessageFlags.Ephemeral
            });
        }
    }
};