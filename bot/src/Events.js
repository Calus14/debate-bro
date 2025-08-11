const { Events } = require('discord.js');

module.exports = {
    [Events.ClientReady]: (bot, client) => {
        logger.info(`✅ ${client.user.tag} is online!`);
    },
    [Events.InteractionCreate]: async (bot, interaction) => {
        if (!interaction.isChatInputCommand()) return;
        const command = bot.commands.get(interaction.commandName);
        if (!command) return;
        await command.execute(bot, interaction);
    }
};
