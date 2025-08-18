// src/commands/transcript.js
import { SlashCommandBuilder } from 'discord.js';
import config from '../config.js';
import { getTranscriptCoverage, buildTranscriptText } from '../utils/s3Logs.js';

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
/** Build a UTC Date that represents (y-m-d hh:mm) in `timeZone`. */
function zonedLocalToUtc(y, m, d, hh, mm, timeZone) {
    // initial guess (as if UTC)
    let t = Date.UTC(y, m - 1, d, hh, mm);
    // compute zone offset at that instant, adjust; iterate to handle DST edges
    for (let i = 0; i < 3; i++) {
        const parts = partsInTZ(new Date(t), timeZone, {
            year:'numeric', month:'2-digit', day:'2-digit',
            hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
        });
        const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
        const offsetMin = -(asUtc - t) / 60000; // see analysis
        const t2 = Date.UTC(y, m - 1, d, hh, mm) - offsetMin * 60000;
        if (t2 === t) break;
        t = t2;
    }
    return new Date(t);
}
function fmtInTZ(date, timeZone) {
    const p = partsInTZ(date, timeZone, {
        year:'numeric', month:'2-digit', day:'2-digit',
        hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
    });
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

const LOGS_TZ = () => (config?.logs?.timezone || 'UTC');

export const data = new SlashCommandBuilder()
    .setName('transcript')
    .setDescription('Builds a transcript over a time range and returns bro-literally-what-was-said.txt')
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

        const fromHM = parseHHMM(fromStr);
        const toHM   = parseHHMM(toStr);
        if (!fromHM || !toHM) throw new Error('Invalid time format. Use HH:MM (24h).');

        let ymd = dateStr ? parseMMDDYYYY(dateStr) : getTodayYMDInTZ(tz);
        if (!ymd) throw new Error('Invalid date format. Use MM/DD/YYYY.');

        const from = zonedLocalToUtc(ymd.y, ymd.m, ymd.d, fromHM.hh, fromHM.mm, tz);
        const to   = zonedLocalToUtc(ymd.y, ymd.m, ymd.d, toHM.hh, toHM.mm, tz);
        if (+to <= +from) throw new Error('`to` must be after `from`.');

        const { covered, segments, missing } = await getTranscriptCoverage(from, to);
        if (!covered) {
            const missTxt = missing
                .map(m => `[${fmtInTZ(m.start, tz)} → ${fmtInTZ(m.end, tz)}]`)
                .join(', ');
            throw new Error(`We don't have transcription for the full window in ${tz}. Missing: ${missTxt}`);
        }

        const text = buildTranscriptText(segments, from, to);
        await interaction.editReply({
            content: `Transcript ready (timezone: ${tz}).`,
            files: [{ attachment: Buffer.from(text, 'utf8'), name: 'bro-literally-what-was-said.txt' }]
        });
    } catch (err) {
        await interaction.editReply({ content: `❌ ${err.message}` });
    }
}

export default { data, execute };
