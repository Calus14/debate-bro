// src/utils/s3Logs.js
// READ-ONLY S3 helpers for layout:
//   <prefix>/<MM_DD_YYYY>/recording_<epochMs>.wav
//   <prefix>/<MM_DD_YYYY>/recording_<epochMs>.transcription.json
//   <prefix>/<MM_DD_YYYY>/recording_<epochMs>.metadata

import { config } from '../config.js';
import {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
    HeadObjectCommand,
} from '@aws-sdk/client-s3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// --------------------------- internal config access ---------------------------
function readSettings() {
    const bucket = config.S3_BUCKET_NAME;
    const prefix = bucket && !bucket.endsWith('/') ? bucket + '/' : bucket;
    const timeZone = config.TIMEZONE;
    const audioExt = '.wav';
    const chunkMinutes = config.FLUSH_INTERVAL_MINUTES;
    const maxPlaybackSeconds = config.PLAYBACK_MAX;
    const region = config.AWS_REGION;
    return { bucket, prefix, timeZone, audioExt, chunkMinutes, maxPlaybackSeconds, region };
}

let _s3 = null;
function getS3() {
    if (_s3) return _s3;
    const { region } = readSettings();
    _s3 = new S3Client(region ? { region } : {});
    return _s3;
}

// --------------------------- date formatting (no Luxon) -----------------------
function partsInTZ(date, timeZone, opts) {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone, ...opts });
    const out = {};
    for (const p of dtf.formatToParts(date)) out[p.type] = p.value;
    return out;
}
function folderNamesFor(date, timeZone) {
    const d = partsInTZ(date, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
    const mm = d.month, dd = d.day, yyyy = d.year;
    return {
        mm_dd_yyyy: `${mm}_${dd}_${yyyy}/`,
        yyyy_mm_dd: `${yyyy}-${mm}-${dd}/`,
    };
}
function formatYMD_HMS_inTZ(date, timeZone) {
    const d = partsInTZ(date, timeZone, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    });
    return `${d.year}-${d.month}-${d.day} ${d.hour}:${d.minute}:${d.second}`;
}

// --------------------------- S3 basic ops -------------------------------------
async function listKeysForDay(date) {
    const { bucket, prefix, timeZone } = readSettings();
    const s3 = getS3();
    const folders = folderNamesFor(date, timeZone);

    // Prefer MM_DD_YYYY, fall back to ISO if empty
    let pfx = prefix + folders.mm_dd_yyyy;
    let res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: pfx }));
    let keys = (res.Contents || []).map(o => o.Key).filter(Boolean);

    if (keys.length === 0) {
        pfx = prefix + folders.yyyy_mm_dd;
        res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: pfx }));
        keys = (res.Contents || []).map(o => o.Key).filter(Boolean);
    }
    return { prefix: pfx, keys };
}

async function getObjectBuffer(Key) {
    const { bucket } = readSettings();
    const s3 = getS3();
    const data = await s3.send(new GetObjectCommand({ Bucket: bucket, Key }));
    const chunks = [];
    for await (const c of data.Body) chunks.push(c);
    return Buffer.concat(chunks);
}

async function headExists(Key) {
    const { bucket } = readSettings();
    const s3 = getS3();
    try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key }));
        return true;
    } catch {
        return false;
    }
}

function readUInt32LE(buf, o) { return buf.readUInt32LE(o); }
function readUInt16LE(buf, o) { return buf.readUInt16LE(o); }

function parseWavHeader(buf) {
    // Basic RIFF/WAVE scan to find 'fmt ' and 'data' chunks
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('Not a RIFF/WAVE file');
    }
    let pos = 12;
    let fmt = null;
    let dataOffset = -1;
    let dataLength = 0;

    while (pos + 8 <= buf.length) {
        const id = buf.toString('ascii', pos, pos + 4);
        const size = readUInt32LE(buf, pos + 4);
        const chunkStart = pos + 8;
        const next = chunkStart + size + (size % 2); // chunks are padded to even

        if (id === 'fmt ') {
            // PCM fmt chunk is 16 bytes (or more for extensible)
            const audioFormat = readUInt16LE(buf, chunkStart + 0);
            const numChannels = readUInt16LE(buf, chunkStart + 2);
            const sampleRate  = readUInt32LE(buf, chunkStart + 4);
            // const byteRate = readUInt32LE(buf, chunkStart + 8);
            const blockAlign  = readUInt16LE(buf, chunkStart + 12);
            const bitsPerSample = readUInt16LE(buf, chunkStart + 14);
            fmt = { audioFormat, numChannels, sampleRate, blockAlign, bitsPerSample, size };
        } else if (id === 'data') {
            dataOffset = chunkStart;
            dataLength = size;
        }
        pos = next;
    }

    if (!fmt) throw new Error('WAV fmt chunk not found');
    if (dataOffset < 0) throw new Error('WAV data chunk not found');
    if (fmt.audioFormat !== 1) throw new Error('Only PCM (audioFormat=1) supported');

    return {
        channels: fmt.numChannels,
        sampleRate: fmt.sampleRate,
        bitsPerSample: fmt.bitsPerSample,
        blockAlign: fmt.blockAlign,
        dataOffset,
        dataLength,
    };
}

function makeWavHeader({ sampleRate, channels, bitsPerSample, dataLength }) {
    const blockAlign = (channels * bitsPerSample) >> 3;
    const byteRate = sampleRate * blockAlign;
    const riffSize = 36 + dataLength; // 4 + (8+fmt) + (8+data)
    const buf = Buffer.alloc(44);

    buf.write('RIFF', 0, 4, 'ascii');
    buf.writeUInt32LE(riffSize, 4);
    buf.write('WAVE', 8, 4, 'ascii');

    buf.write('fmt ', 12, 4, 'ascii');
    buf.writeUInt32LE(16, 16);                 // fmt chunk size
    buf.writeUInt16LE(1, 20);                  // PCM
    buf.writeUInt16LE(channels, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(byteRate, 28);
    buf.writeUInt16LE(blockAlign, 32);
    buf.writeUInt16LE(bitsPerSample, 34);

    buf.write('data', 36, 4, 'ascii');
    buf.writeUInt32LE(dataLength, 40);
    return buf;
}

function secondsToByteOffset(seconds, sampleRate, blockAlign) {
    const frames = Math.max(0, Math.floor(seconds * sampleRate));
    return frames * blockAlign;
}

// --------------------------- parsing recording keys --------------------------
/** recording_<epochMs>.(wav|metadata|transcription.json) */
function parseRecordingKey(key) {
    const base = path.basename(key);
    const m = base.match(/^recording_(\d+)\.(wav|metadata|transcription\.json)$/i);
    if (!m) return null;
    const epochMs = Number(m[1]);
    const ext = m[2].toLowerCase();
    let type = 'other';
    if (ext === 'wav') type = 'audio';
    else if (ext === 'metadata') type = 'meta';
    else if (ext === 'transcription.json') type = 'transcript';
    const start = new Date(epochMs); // absolute; tz only matters for folder naming
    return { key, epochMs, type, ext, start };
}

async function readDurationSeconds(prefix, epochMs) {
    const { chunkMinutes } = readSettings();
    const metaKey = `${prefix}recording_${epochMs}.metadata`;
    if (await headExists(metaKey)) {
        try {
            const meta = JSON.parse((await getObjectBuffer(metaKey)).toString('utf8'));
            if (typeof meta.duration_sec === 'number') return Math.max(1, Math.round(meta.duration_sec));
            if (typeof meta.duration_ms === 'number') return Math.max(1, Math.round(meta.duration_ms / 1000));
            if (typeof meta.lengthSec === 'number') return Math.max(1, Math.round(meta.lengthSec));
        } catch (e) {
            console.warn('[s3Logs] Bad metadata JSON for', epochMs, e?.message);
        }
    }
    return chunkMinutes * 60;
}

// --------------------------- transcripts -------------------------------------
export async function getTranscriptCoverage(from, to) {
    const { keys, prefix } = await listKeysForDay(from);
    const segments = [];

    for (const k of keys) {
        const info = parseRecordingKey(k);
        if (!info || info.type !== 'transcript') continue;

        const durSec = await readDurationSeconds(prefix, info.epochMs);
        const end = new Date(info.start.getTime() + durSec * 1000);
        if (end <= from || info.start >= to) continue; // no intersection

        const raw = (await getObjectBuffer(k)).toString('utf8');

        let items = [];
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) items = parsed;
            else if (Array.isArray(parsed.segments)) items = parsed.segments;
            else if (typeof parsed.text === 'string') items = [{ text: parsed.text }];
            else items = [{ text: raw }];
        } catch {
            items = [{ text: raw }];
        }

        segments.push({ key: k, start: info.start, end, items });
    }

    segments.sort((a, b) => a.start - b.start);

    // coverage over [from, to)
    let cursor = +from;
    const missing = [];
    for (const seg of segments) {
        if (+seg.end <= cursor) continue;
        if (+seg.start > cursor) {
            missing.push({ start: new Date(cursor), end: seg.start });
        }
        cursor = Math.max(cursor, +seg.end);
        if (cursor >= +to) break;
    }
    if (cursor < +to) missing.push({ start: new Date(cursor), end: to });

    return { covered: missing.length === 0, segments, missing };
}

export function buildTranscriptText(segments, from, to) {
    const { timeZone } = readSettings();
    const header =
        `Timezone: ${timeZone}\n` +
        `Window: ${formatYMD_HMS_inTZ(from, timeZone)} — ${formatYMD_HMS_inTZ(to, timeZone)}\n` +
        `Chunks: ${segments.length}\n\n`;
    const lines = [];
    for (const seg of segments) {
        for (const it of seg.items) {
            const t = (it?.text ?? '').toString().trim();
            if (t) lines.push(t);
        }
    }
    return header + lines.join('\n') + '\n';
}

// --------------------------- audio -------------------------------------------
export async function getAudioCoverage(from, to) {
    const { keys, prefix } = await listKeysForDay(from);
    const audio = [];

    for (const k of keys) {
        const info = parseRecordingKey(k);
        if (!info || info.type !== 'audio') continue;

        const durSec = await readDurationSeconds(prefix, info.epochMs);
        const end = new Date(info.start.getTime() + durSec * 1000);
        if (end <= from || info.start >= to) continue;

        audio.push({ key: k, start: info.start, end, epochMs: info.epochMs });
    }

    audio.sort((a, b) => a.start - b.start);

    // Greedy collect consecutive coverage
    let cursor = +from;
    const needed = [];
    for (const seg of audio) {
        if (+seg.end <= cursor) continue;
        if (+seg.start > cursor) break; // gap
        needed.push(seg);
        cursor = Math.max(cursor, +seg.end);
        if (cursor >= +to) break;
    }
    const covered = cursor >= +to;
    return { covered, needed };
}

export async function build3MinWav(coverage, from, to, outfile) {
    // Compute desired duration (respecting playback limit)
    const { maxPlaybackSeconds } = readSettings();
    const wantSec = Math.min(maxPlaybackSeconds, Math.max(1, Math.round((+to - +from) / 1000)));
    if (!coverage?.needed?.length) throw new Error('No audio files found for that period.');

    // Download up to two WAV chunks
    const parts = [];
    for (const seg of coverage.needed.slice(0, 2)) {
        const buf = await getObjectBuffer(seg.key);
        parts.push({ buf, seg });
    }

    // Parse headers and validate compatibility
    const h0 = parseWavHeader(parts[0].buf);
    for (let i = 1; i < parts.length; i++) {
        const hi = parseWavHeader(parts[i].buf);
        if (
            hi.channels !== h0.channels ||
            hi.sampleRate !== h0.sampleRate ||
            hi.bitsPerSample !== h0.bitsPerSample
        ) {
            throw new Error('Incompatible WAV chunk format; consider enabling ffmpeg path.');
        }
    }

    const { sampleRate, channels, bitsPerSample, blockAlign } = h0;

    // Helper to clamp a slice within a chunk
    function sliceFromChunk(part, startDate, seconds, preferFromStart = false) {
        const { buf, seg } = part;
        const h = parseWavHeader(buf);
        const data = buf.subarray(h.dataOffset, h.dataOffset + h.dataLength);

        // Offset seconds from the beginning of this chunk
        const startSec = preferFromStart ? 0 : Math.max(0, (+startDate - +seg.start) / 1000);
        const startByte = secondsToByteOffset(startSec, sampleRate, blockAlign);
        const sliceLenBytes = secondsToByteOffset(seconds, sampleRate, blockAlign);

        const clampedStart = Math.min(startByte, data.length);
        const clampedEnd = Math.min(clampedStart + sliceLenBytes, data.length);
        const actual = data.subarray(clampedStart, clampedEnd);
        const actualSec = actual.length / blockAlign / sampleRate;

        return { pcm: actual, seconds: actualSec };
    }

    // Case A: All within first file
    const first = parts[0];
    if (parts.length === 1 || new Date(from.getTime() + wantSec * 1000) <= first.seg.end) {
        const { pcm } = sliceFromChunk(first, from, wantSec, false);
        const header = makeWavHeader({
            sampleRate,
            channels,
            bitsPerSample,
            dataLength: pcm.length,
        });
        fs.writeFileSync(outfile, Buffer.concat([header, pcm]));
        return outfile;
    }

    // Case B: Span first + second
    const second = parts[1];

    const firstAvailSec = Math.max(0, (+first.seg.end - +from) / 1000);
    const { pcm: part1 } = sliceFromChunk(first, from, firstAvailSec, false);

    const need2 = Math.max(0, wantSec - firstAvailSec);
    const { pcm: part2 } = sliceFromChunk(second, second.seg.start, need2, true);

    const combinedPCM = Buffer.concat([part1, part2]);
    const header = makeWavHeader({
        sampleRate,
        channels,
        bitsPerSample,
        dataLength: combinedPCM.length,
    });
    fs.writeFileSync(outfile, Buffer.concat([header, combinedPCM]));
    return outfile;
}
