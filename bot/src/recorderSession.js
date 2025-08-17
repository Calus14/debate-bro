import { joinVoiceChannel, EndBehaviorType } from '@discordjs/voice';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import prism from 'prism-media';
import wav from 'wav';
import path from 'path';
import fs from 'fs';
import AudioMixer from './audioMixer.js';
import uploadFile from './utils/s3Uploader.js';

// Use the global logger if available; otherwise fall back to console.  This
// allows the bot to integrate with the winston logger defined in config.js
// while still working when no custom logger is provided.
const logger = global.logger || console;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const END_SILENCE_MS = Number(process.env.END_SILENCE_MS || 30000); // silence timeout per user


const LOGS_TZ = process.env.LOGS_TZ || "America/Chicago";

function currentDateFolder(t = new Date()) {
    // Build MM_DD_YYYY in a fixed TZ
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: LOGS_TZ,
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
    }).formatToParts(t);
    const get = (type) => parts.find(p => p.type === type)?.value;
    const mm = get("month");
    const dd = get("day");
    const yyyy = get("year");
    return `${mm}_${dd}_${yyyy}`;
}

function safeKeyPart(s) {
    // S3-safe-ish: keep letters/numbers/_-. replace everything else with _
    return String(s ?? "")
        .trim()
        .replace(/[^\w.\-]+/g, "_");
}

class RecorderSession {
    constructor(channel) {
        this.channel = channel;
        this.guildId = channel.guild.id;
        this.connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: this.guildId,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false
        });

        this.receiver = this.connection.receiver;
        this.mixer = new AudioMixer();
        this.outputPath = path.join(__dirname, `../recording_${Date.now()}.wav`);
        this.writer = new wav.FileWriter(this.outputPath, {
            channels: 2,
            sampleRate: 48000,
            bitDepth: 16
        });

        this.subscriptions = new Map();
        this.mixerTimer = null;

        // Determine how often to flush the recording to disk (in milliseconds). Default is 3 minutes.
        const intervalMinutes = process.env.FLUSH_INTERVAL_MINUTES || 3;
        const intervalMs = process.env.FLUSH_INTERVAL_MS;
        this.flushIntervalMs = Number(intervalMs) > 0 ? Number(intervalMs) : Number(intervalMinutes) * 60 * 1000;
        this.flushTimer = null;

        // Track the start time of the recording for relative timestamps
        this.recordStart = Date.now();
        // Map to store currently active speakers and the time they started speaking
        this.activeSpeakers = new Map();
        // Array to store segments of speech with start and end times
        this.segments = [];

        // Preallocate a buffer of silence for one 20 ms frame (960 samples/channel, 2 channels,
        // 16 bits per sample). This will be used to write a single stream of silence when no
        // speakers are active, preventing multiple streams from emitting their own silence.
        this.silenceFrame = Buffer.alloc(960 * 2 * 2);

        // Log creation of a new recording session.  Include the guild ID and
        // the initial output path for the WAV file so operators can trace
        // where files are stored on disk.
        try {
            logger.info(
                `RecorderSession created for guild ${this.guildId}, initial output path ${this.outputPath}`
            );
        } catch {}
    }

    start() {
        this._wireSpeaking();
        // always write a frame every 20 ms, even if it’s silence
        this.mixerTimer = setInterval(() => {
            // Write a single stream of silence when no speakers are active.  Otherwise
            // delegate to the mixer to combine the active user streams.
            let frame;
            if (this.activeSpeakers.size === 0) {
                frame = this.silenceFrame;
            } else {
                frame = this.mixer.mixNextFrame();
            }
            this.writer.write(frame);
        }, 20);

        // schedule periodic flushes of the recording
        this.flushTimer = setInterval(() => {
            try {
                this._flushSegment();
            } catch (err) {
                console.error('Error during periodic flush:', err);
            }
        }, this.flushIntervalMs);

        // Emit a log indicating that recording has started for this guild.  This
        // helps correlate audio files with when recording began.
        try {
            logger.info(`Recording started for guild ${this.guildId}`);
        } catch {}
    }

    _wireSpeaking() {
        this.receiver.speaking.on('start', (userId) => {
            const existing = this.subscriptions.get(userId);
            let opusStream, decoder;

            if (!existing) {
                opusStream = this.receiver.subscribe(userId, {
                    end: { behavior: EndBehaviorType.Manual }
                });

                decoder = new prism.opus.Decoder({
                    rate: 48000,
                    channels: 2,
                    frameSize: 960
                });

                // idempotent cleanup; also finalizes any open segment
                const cleanup = (() => {
                    let done = false;
                    return () => {
                        if (done) return; done = true;

                        const startTime = this.activeSpeakers.get(userId);
                        if (startTime !== undefined) {
                            const endTime = Date.now() - this.recordStart;
                            this.segments.push({ userId, start: startTime, end: endTime });
                            this.activeSpeakers.delete(userId);
                            logger.info("removing user " + userId);
                        }

                        try { opusStream.removeAllListeners(); decoder.removeAllListeners(); } catch {}
                        try { opusStream.destroy(); decoder.destroy(); } catch {}
                        this.subscriptions.delete(userId);
                    };
                })();

                opusStream.once('end', cleanup);
                opusStream.once('close', cleanup);
                opusStream.on('error', cleanup);
                decoder.on('error', cleanup);

                decoder.on('data', (pcm) => {
                    for (const frame of AudioMixer.sliceIntoFrames(pcm)) {
                        this.mixer.pushPCMFrame(userId, frame);
                    }
                });

                // set sub before piping to avoid races
                this.subscriptions.set(userId, { opusStream, decoder });
                opusStream.pipe(decoder);
            }

            // (re)start a segment if not already marked active
            if (!this.activeSpeakers.has(userId)) {
                logger.info("adding speaker " + userId);
                const startTime = Date.now() - this.recordStart;
                this.activeSpeakers.set(userId, startTime);
            }
        });

        this.receiver.speaking.on('end', (userId) => {
            const startTime = this.activeSpeakers.get(userId);
            if (startTime !== undefined) {
                const endTime = Date.now() - this.recordStart;
                this.segments.push({ userId, start: startTime, end: endTime });
                this.activeSpeakers.delete(userId);
                logger.info("removing user " + userId);
            }
            // no stream teardown here; subscriptions persist between pauses
        });
    }

    /**
     * Flush the current recording to disk and start a new one.
     * This method finalizes the current WAV and metadata files, uploads them to S3 (if configured),
     * and resets internal state so that recording continues uninterrupted into a new file.
     */
    _flushSegment() {
        const flushTime = Date.now();

        // Log the beginning of a flush operation.  Include a timestamp to aid
        // in debugging when segments were rotated.
        try {
            logger.info(
                `Flushing recording for guild ${this.guildId} at ${new Date(flushTime).toISOString()}`
            );
        } catch {}
        // Finalize segments for any speakers currently active
        for (const [userId, startTime] of this.activeSpeakers.entries()) {
            // Record the end time relative to the start of this recording
            this.segments.push({ userId, start: startTime, end: flushTime - this.recordStart });
            // Reset the start time to 0 for the next segment
            this.activeSpeakers.set(userId, 0);
        }
        // Write metadata for the segment
        const metadataPath = this.outputPath.replace(/\.wav$/, '.json');
        try {
            fs.writeFileSync(metadataPath, JSON.stringify(this.segments, null, 2));
            // Log successful metadata write along with number of segments
            try {
                logger.info(
                    `Metadata written for guild ${this.guildId}: ${metadataPath} (segments=${this.segments.length})`
                );
            } catch {}
        } catch (err) {
            logger.error('Failed to write metadata file during flush:', err);
        }
        // Finalize the WAV file
        try {
            this.writer.end();
            // Log that the current WAV file has been finalized
            try {
                logger.info(`WAV segment finalized: ${this.outputPath}`);
            } catch {}
        } catch {}
        // Upload the files to S3 if S3 is configured
        try {
            const channelKey = safeKeyPart(this.channel?.name ?? this.channel?.id ?? "unknown");
            const dateFolder = currentDateFolder();

            const baseName = path.basename(this.outputPath).replace(/\.wav$/, '');
            const prefix = `guild/${this.guildId}/channel/${channelKey}/${dateFolder}/${baseName}`;
            const wavKey  = `${prefix}.wav`;
            const metaKey = `${prefix}.metadata`;

            // Upload JSON file and log success or failure
            uploadFile(metadataPath, metaKey)
                .then(() => {
                    try {
                        logger.info(`Uploaded JSON metadata to S3: ${metaKey}`);
                    } catch {}
                })
                .catch((err) => {
                    logger.error(`Failed to upload JSON metadata to S3: ${metaKey}`, err);
                });
            // Upload WAV file and log success or failure
            uploadFile(this.outputPath, wavKey)
                .then(() => {
                    try {
                        logger.info(`Uploaded WAV to S3: ${wavKey}`);
                    } catch {}
                })
                .catch((err) => {
                    logger.error(`Failed to upload WAV to S3: ${wavKey}`, err);
                });

        } catch (err) {
            logger.error('Failed to upload files to S3:', err);
        }
        // Prepare for the next segment
        const newTime = flushTime;
        this.outputPath = path.join(__dirname, `../recording_${this.guildId}_${newTime}.wav`);
        this.writer = new wav.FileWriter(this.outputPath, {
            channels: 2,
            sampleRate: 48000,
            bitDepth: 16
        });
        this.segments = [];
        this.recordStart = newTime;
        // Log that a new recording segment has begun
        try {
            logger.info(`Starting new recording segment for guild ${this.guildId}: ${this.outputPath}`);
        } catch {}
    }

    stop() {
        clearInterval(this.mixerTimer);
        // Indicate that recording is about to stop
        try {
            logger.info(`Stopping recording for guild ${this.guildId}`);
        } catch {}
        // Stop the periodic flush timer
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        for (const { opusStream, decoder } of this.subscriptions.values()) {
            try { opusStream.destroy(); } catch {}
            try { decoder.destroy(); } catch {}
        }

        // Finalize any speakers that are still active at the time of stopping
        const now = Date.now();
        for (const [userId, startTime] of this.activeSpeakers.entries()) {
            this.segments.push({ userId, start: startTime, end: now - this.recordStart });
        }
        this.activeSpeakers.clear();

        // Write the metadata about who spoke when to a sidecar JSON file
        const metadataPath = this.outputPath.replace(/\.wav$/, '.json');
        try {
            fs.writeFileSync(metadataPath, JSON.stringify(this.segments, null, 2));
            // Log final metadata written
            try {
                logger.info(
                    `Final metadata written for guild ${this.guildId}: ${metadataPath} (segments=${this.segments.length})`
                );
            } catch {}
        } catch (err) {
            logger.error('Failed to write metadata file:', err);
        }

        // Finalize the WAV file
        this.writer.end();
        try {
            logger.info(`Final WAV written: ${this.outputPath}`);
        } catch {}

        // Upload final files to S3
        try {
            const channelKey = safeKeyPart(this.channel?.name ?? this.channel?.id ?? "unknown");
            const dateFolder = currentDateFolder();

            const baseName = path.basename(this.outputPath).replace(/\.wav$/, '');
            const prefix = `guild/${this.guildId}/channel/${channelKey}/${dateFolder}/${baseName}`;
            const wavKey  = `${prefix}.wav`;
            const metaKey = `${prefix}.metadata`;

            uploadFile(metadataPath, metaKey)
                .then(() => {
                    try {
                        logger.info(`Uploaded final JSON metadata to S3: ${metaKey}`);
                    } catch {}
                })
                .catch((err) => {
                    logger.error(`Failed to upload final JSON metadata to S3: ${metaKey}`, err);
                });

            uploadFile(this.outputPath, wavKey)
                .then(() => {
                    try {
                        logger.info(`Uploaded final WAV to S3: ${wavKey}`);
                    } catch {}
                })
                .catch((err) => {
                    logger.error(`Failed to upload final WAV to S3: ${wavKey}`, err);
                });
        } catch (err) {
            logger.error('Failed to upload files to S3:', err);
        }

        this.connection.destroy();
        try {
            logger.info(`Recording session stopped for guild ${this.guildId}`);
        } catch {}
        // Return both the audio and metadata file paths
        return { audioPath: this.outputPath, metadataPath };
    }
}

export default RecorderSession;