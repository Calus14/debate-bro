// src/commands/logs.js
// Lists available logs for a given day using the shared s3Logs helpers.
// Shows TZ-aware window, coverage, and sample audio filenames.

import { SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { getTranscriptCoverage, getAudioCoverage } from '../utils/s3Logs.js';

// ---------- tiny TZ/date utils (no Luxon) ----------
function partsInTZ(date, timeZone, opts) {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone, ...opts });
    const out = {};
    for (const p of dtf.formatToParts(date)) out[p.type] = p.value;
    return out;
}
function getTodayYMDInTZ(timeZone) {
    const now = new Date();
    const p = partsInTZ(now, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
    return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}
function parseMMDDYYYY(s) {
    const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec((s ?? '').trim());
    if (!m) return null;
    const mm = Number(m[1]), dd = Number(m[2]), yyyy = Number(m[3]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return { y: yyyy, m: mm, d: dd };
}
// 24h window centered at local noon (robust across TZ/DST without Luxon)
function localDayWindowUTC(ymd, tz) {
    const noonUTC = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, 12, 0, 0));
    const from = new Date(noonUTC.getTime() - 12 * 3600 * 1000);
    const to   = new Date(noonUTC.getTime() + 12 * 3600 * 1000);
    return { from, to };
}
function fmtInTZ(date, tz) {
    const p = partsInTZ(date, tz, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    });
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// ---------- slash command ----------
export const data = new SlashCommandBuilder()
    .setName('logs')
    .setDescription('List available logs for a given day (defaults to today in TIMEZONE)')
    .addStringOption(o =>
        o.setName('date')
            .setDescription('Optional date in MM/DD/YYYY (defaults to today in TIMEZONE)')
            .setRequired(false)
    );

export async function execute(bot, interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
        const dateStr = interaction.options.getString('date');
        const tz = config.TIMEZONE || 'UTC';

        const ymd = dateStr ? parseMMDDYYYY(dateStr) : getTodayYMDInTZ(tz);
        if (!ymd) {
            await interaction.editReply({ content: '❌ Invalid date format. Use MM/DD/YYYY.' });
            return;
        }

        const { from, to } = localDayWindowUTC(ymd, tz);

        // Use shared S3 helpers (these handle Bucket/Prefix/region internally)
        const tCov = await getTranscriptCoverage(from, to);
        const aCov = await getAudioCoverage(from, to);

        const tSegs = tCov?.segments ?? [];
        const aSegs = aCov?.needed ?? [];

        const tFirst = tSegs.length ? tSegs[0].start : null;
        const tLast  = tSegs.length ? tSegs[tSegs.length - 1].end : null;

        const aFirst = aSegs.length ? aSegs[0].start : null;
        const aLast  = aSegs.length ? aSegs[aSegs.length - 1].end : null;

        const mm = String(ymd.m).padStart(2, '0');
        const dd = String(ymd.d).padStart(2, '0');

        const lines = [];
        lines.push(`**Date (TZ=${tz})**: ${mm}/${dd}/${ymd.y}`);
        lines.push(`**Query window**: ${fmtInTZ(from, tz)} — ${fmtInTZ(to, tz)}`);
        lines.push('');

        lines.push(`**Transcripts**: ${tSegs.length} chunk(s)` + (tCov?.covered ? ' (continuous)' : ' (gaps possible)'));
        if (tFirst && tLast) lines.push(`• Window: ${fmtInTZ(tFirst, tz)} — ${fmtInTZ(tLast, tz)}`);

        lines.push(`**Audio**: ${aSegs.length} chunk(s)` + (aCov?.covered ? ' (continuous)' : ' (may have gaps)'));
        if (aFirst && aLast) lines.push(`• Window: ${fmtInTZ(aFirst, tz)} — ${fmtInTZ(aLast, tz)}`);

        // Sample keys (audio chunks expose .key)
        if (aSegs.length) {
            const sample = aSegs.slice(0, 10)
                .map(s => '• ' + (s.key?.split('/').pop() ?? '(unknown)'))
                .join('\n');
            if (sample.trim()) {
                lines.push('');
                lines.push('**Sample audio files (first 10):**');
                lines.push(sample);
            }
        }

        await interaction.editReply({ content: lines.join('\n') });
    } catch (err) {
        await interaction.editReply({ content: `❌ ${err.message}` });
    }
}

export default { data, execute };
