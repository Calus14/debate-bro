const { SlashCommandBuilder } = require('discord.js');
const RecorderSession = require('./RecorderSession');

module.exports = {
    join: {
        data: new SlashCommandBuilder()
            .setName('join')
            .setDescription('Join and start recording voice channel.'),
        async execute(bot, interaction) {
            const channel = interaction.member?.voice?.channel;
            if (!channel)
                return interaction.reply({ content: "⚠️ You aren't in a voice channel!", ephemeral: true });
            if (bot.sessions.has(interaction.guildId))
                return interaction.reply({ content: "⚠️ Already recording!", ephemeral: true });

            const session = new RecorderSession(channel);
            session.start();
            bot.sessions.set(interaction.guildId, session);

            await interaction.reply({ content: ' Recording started. Use `/leave` to stop.', ephemeral: true });
        }
    },

    leave: {
        data: new SlashCommandBuilder()
            .setName('leave')
            .setDescription('Leave and stop recording voice channel.'),
        async execute(bot, interaction) {
            const session = bot.sessions.get(interaction.guildId);
            if (!session)
                return interaction.reply({ content: " I'm not recording here!", ephemeral: true });

            const outPaths = session.stop();
            bot.sessions.delete(interaction.guildId);
            // Compose a message that includes both the audio and metadata file paths
            await interaction.reply({
                content: `✅ Recording stopped and saved: ${outPaths.audioPath}\n📄 Metadata saved: ${outPaths.metadataPath}`,
                ephemeral: true
            });
        }
    }
};
