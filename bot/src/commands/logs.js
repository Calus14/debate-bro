// src/commands/logs.js
import { SlashCommandBuilder } from "discord.js";
import { listChannelLogs } from "../utils/s3Logs.js";

export default {
    data: new SlashCommandBuilder()
        .setName("logs")
        .setDescription("List recorded chunks for this channel and which have transcripts"),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const { guildId, channelId, channel } = interaction;
        const { entries, prefixUsed, bucket } = await listChannelLogs({
            guildId,
            channelId,
            channelName: channel?.name,
        });

        if (!entries.length) {
            await interaction.editReply(`No recordings under \`${bucket}/${prefixUsed}\`.`);
            return;
        }

        const lines = entries.slice(0, 40).map(e => {
            const tsUnix = e.ts ? Math.floor(e.ts.getTime() / 1000) : null;
            const when = tsUnix ? `<t:${tsUnix}:f>` : "unknown time";
            const dateTag = e.dateFolder ? ` (${e.dateFolder})` : "";
            const wav = e.wav ? "🎙️ wav" : "—";
            const trn = e.json ? "📝 transcript" : "—";
            return `${when}${dateTag}  ${wav}  ${trn}`;
        });

        await interaction.editReply(
            [`Prefix: \`${bucket}/${prefixUsed}\``, "Latest:", lines.join("\n"), entries.length > 40 ? `…and ${entries.length - 40} more.` : ""]
                .filter(Boolean)
                .join("\n")
        );
    },
};