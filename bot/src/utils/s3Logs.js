import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const REGION = process.env.AWS_REGION || "us-east-2";
const BUCKET = process.env.S3_BUCKET_NAME;

if (!BUCKET) {
    console.warn("[/logs] S3_BUCKET_NAME not set; /logs will fail until set.");
}

const s3 = new S3Client({ region: REGION });

// Safety name changes for s3
function safeKeyPart(s) {
    return String(s ?? "").trim().replace(/[^\w.\-]+/g, "_");
}

async function listAll(bucket, prefix) {
    const out = [];
    let ContinuationToken;
    do {
        const res = await s3.send(
            new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefix,
                ContinuationToken,
            })
        );
        (res.Contents || []).forEach((o) => out.push(o));
        ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return out;
}

// pull MM_DD_YYYY from .../channel/<nameOrId>/<MM_DD_YYYY>/...
function keyDateFolder(key) {
    const m = key.match(/\/channel\/[^/]+\/([^/]+)\//);
    return m ? m[1] : null;
}

function summarize(objects) {
    const map = new Map();
    for (const o of objects) {
        const key = o.Key;
        if (!key.endsWith(".wav") && !key.endsWith(".transcription.json")) continue;

        const base = key.replace(/\.transcription\.json$/, "").replace(/\.wav$/, "");
        let rec = map.get(base);
        if (!rec) {
            rec = { base, wav: null, json: null, ts: null, dateFolder: keyDateFolder(key) };
            map.set(base, rec);
        }
        if (key.endsWith(".wav")) rec.wav = key;
        if (key.endsWith(".transcription.json")) rec.json = key;

        // prefer epoch in filename e.g., recording_1755393555127
        let ts = null;
        const m = base.match(/(?:^|_)recording_(\d{10,})$/) || base.match(/(\d{10,})$/);
        if (m) ts = new Date(Number(m[1]));
        else if (o.LastModified) ts = new Date(o.LastModified);

        if (!rec.ts && ts) rec.ts = ts;
    }
    return Array.from(map.values()).sort((a, b) => (a.ts?.getTime() || 0) - (b.ts?.getTime() || 0));
}

/**
 * Lists WAV/transcript pairs under:
 *   guild/<guildId>/channel/<channelId>/...
 *   (falls back to sanitized channel name)
 */
export async function listChannelLogs({ guildId, channelId, channelName }) {
    if (!BUCKET) throw new Error("S3_BUCKET_NAME env var is required");

    const idBase   = `guild/${guildId}/channel/${channelId}/`;
    const nameBase = channelName ? `guild/${guildId}/channel/${safeKeyPart(channelName)}/` : null;

    const prefixes = [idBase, nameBase].filter(Boolean);

    for (const prefix of prefixes) {
        const objs = await listAll(BUCKET, prefix);
        const entries = summarize(objs);
        if (entries.length) return { entries, prefixUsed: prefix, bucket: BUCKET };
    }
    return { entries: [], prefixUsed: idBase, bucket: BUCKET };
}