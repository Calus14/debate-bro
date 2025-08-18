// src/commands/playback.js
import { SlashCommandBuilder, ChannelType } from 'discord.js';
import config from '../config.js';
import { getAudioCoverage, build3MinWav } from '../utils/s3Logs.js';
import { getVoiceConnection, createAudioPlayer, createAudioResource, AudioPlayerStatus } from '@discordjs/voice';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---- Tiny timezone helpers (no Luxon) ----
function partsInTZ(date, timeZone, opts) {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone, ...opts });
    const out = {};
    for (const p of dtf.formatToParts(date)) out[p.type] = p.value;
    return out;
}
function getTodayYMDInTZ(timeZone) {
    const d = partsInTZ(new Date(), timeZone, { year:'numeric', month:'2-digit', day:'2-digit' });
    return { y: +d.year, m: +d.month, d: +d.day };
}
function parseMMDDYYYY(s) {
    const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return { m: +m[1], d: +m[2], y: +m[3] };
}
function parseHHMM(s) {
    const m = s?.match(/^(\d{2}):(\d{2})$/);
    if (!m) return null;
    const hh = +m[1], mm = +m[2];
    if (hh > 23 || mm > 59) return null;
    return { hh, mm };
}
function zonedLocalToUtc(y, m, d, hh, mm, timeZone) {
    let t = Date.UTC(y, m - 1, d, hh, mm);
    for (let i = 0; i < 3; i++) {
        const parts = partsInTZ(new Date(t), timeZone, {
            year:'numeric', month:'2-digit', day:'2-digit',
            hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
        });
        const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
        const offsetMin = -(asUtc - t) / 60000;
        const t2 = Date.UTC(y, m - 1, d, hh, mm) - offsetMin * 60000;
        if (t2 === t) break;
        t = t2;
    }
    return new Date(t);
}

const LOGS_TZ = () => (config?.logs?.timezone || 'UTC');
const MAX_SECONDS = () => Number(config?.playback?.maxSeconds ?? 180);

export const data = new SlashCommandBuilder()
    .setName('playback')
    .setDescription('Play up to 3 minutes of audio from the logs for a given time range')
    // REQUIRED FIRST
    .addStringOption(o =>
        o.setName('from')
            .setDescription('Start time HH:MM in LOGS_TZ')
            .setRequired(true))
    .addStringOption(o =>
        o.setName('to')
            .setDescription('End time HH:MM in LOGS_TZ')
            .setRequired(true))
    // OPTIONAL AFTER
    .addChannelOption(o =>
        o.setName('channel')
            .setDescription('Voice channel to play into (defaults to your current)')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(false))
    .addStringOption(o =>
        o.setName('date')
            .setDescription('Optional date in MM/DD/YYYY (defaults to today in LOGS_TZ)')
            .setRequired(false));

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
        const dateStr = interaction.options.getString('date');
        const fromStr = interaction.options.getString('from');
        const toStr   = interaction.options.getString('to');

        const tz = LOGS_TZ();
        const limit = MAX_SECONDS();

        const fromHM = parseHHMM(fromStr);
        const toHM   = parseHHMM(toStr);
        if (!fromHM || !toHM) throw new Error('Invalid time format. Use HH:MM (24h).');

        let ymd = dateStr ? parseMMDDYYYY(dateStr) : getTodayYMDInTZ(tz);
        if (!ymd) throw new Error('Invalid date format. Use MM/DD/YYYY.');

        const from = zonedLocalToUtc(ymd.y, ymd.m, ymd.d, fromHM.hh, fromHM.mm, tz);
        const to   = zonedLocalToUtc(ymd.y, ymd.m, ymd.d, toHM.hh, toHM.mm, tz);
        if (+to <= +from) throw new Error('`to` must be after `from`.');

        const requestedSeconds = Math.round((+to - +from) / 1000);
        if (requestedSeconds > limit) {
            return interaction.editReply({ content: 'Bro you can only have 3 minutes of playback at a time!' });
        }

        const coverage = await getAudioCoverage(from, to);
        if (!coverage.covered) throw new Error('We do not have WAV audio for the full time period requested.');

        const outfile = path.join(os.tmpdir(), `playback-${Date.now()}.wav`);
        await build3MinWav(coverage, from, to, outfile);

        let targetChannel = interaction.options.getChannel('channel');
        if (!targetChannel) {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            targetChannel = member?.voice?.channel;
        }
        if (!targetChannel) throw new Error('Join a voice channel or pass the channel option.');

        const conn = getVoiceConnection(interaction.guild.id);
        if (!conn) throw new Error('Not connected to a voice channel. Use /join first or invite the bot.');

        const player = createAudioPlayer();
        const resource = createAudioResource(fs.createReadStream(outfile));
        conn.subscribe(player);
        player.play(resource);

        player.once(AudioPlayerStatus.Playing, () => {
            interaction.editReply({
                content: `Playing ${Math.min(limit, requestedSeconds)}s from ${fromStr} to ${toStr} (${tz}).`
            }).catch(() => {});
        });

        player.on('error', (e) => {
            interaction.followUp({ ephemeral: true, content: `Playback error: ${e.message}` }).catch(() => {});
        });
    } catch (err) {
        await interaction.editReply({ content: `❌ ${err.message}` });
    }
}

export default { data, execute };
