const { joinVoiceChannel, EndBehaviorType } = require('@discordjs/voice');
const prism = require('prism-media');
const wav = require('wav');
const path = require('path');
const fs = require('fs');
const AudioMixer = require('./AudioMixer');
const { uploadFile } = require('./S3Uploader');

const END_SILENCE_MS = Number(process.env.END_SILENCE_MS || 30000); // silence timeout per user

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
        this.outputPath = path.join(__dirname, `../recording_${this.guildId}_${Date.now()}.wav`);
        this.writer = new wav.FileWriter(this.outputPath, {
            channels: 2,
            sampleRate: 48000,
            bitDepth: 16
        });

        this.subscriptions = new Map();
        this.mixerTimer = null;

        // Determine how often to flush the recording to disk (in milliseconds). Default is 5 minutes.
        const intervalMinutes = process.env.FLUSH_INTERVAL_MINUTES || 5;
        const intervalMs = process.env.FLUSH_INTERVAL_MS;
        this.flushIntervalMs = Number(intervalMs) > 0 ? Number(intervalMs) : Number(intervalMinutes) * 60 * 1000;
        this.flushTimer = null;

        // Track the start time of the recording for relative timestamps
        this.recordStart = Date.now();
        // Map to store currently active speakers and the time they started speaking
        this.activeSpeakers = new Map();
        // Array to store segments of speech with start and end times
        this.segments = [];
    }

    start() {
        this._wireSpeaking();
        // always write a frame every 20 ms, even if it’s silence
        this.mixerTimer = setInterval(() => {
            const frame = this.mixer.mixNextFrame();
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
    }

    _wireSpeaking() {
        this.receiver.speaking.on('start', userId => {
            if (this.subscriptions.has(userId)) return;
            const opusStream = this.receiver.subscribe(userId, {
                end: { behavior: EndBehaviorType.AfterSilence, duration: END_SILENCE_MS }
            });
            const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });

            const cleanup = () => {
                try { opusStream.removeAllListeners(); } catch {}
                try { decoder.removeAllListeners(); } catch {}
                try { opusStream.destroy(); } catch {}
                try { decoder.destroy(); } catch {}
                this.subscriptions.delete(userId);
            };
            opusStream.once('end', cleanup);
            opusStream.once('close', cleanup);
            opusStream.once('finish', cleanup);
            decoder.once('end', cleanup);
            decoder.on('error', cleanup);
            opusStream.on('error', cleanup);

            // Record when the user starts speaking relative to the beginning of the recording
            if (!this.activeSpeakers.has(userId)) {
                const startTime = Date.now() - this.recordStart;
                this.activeSpeakers.set(userId, startTime);
            }

            decoder.on('data', (pcm) => {
                // slice PCM into 20‑ms frames (960 samples/channel @ 48 kHz, stereo 16‑bit)
                for (let off = 0; off + 960 * 2 * 2 <= pcm.length; off += 960 * 2 * 2) {
                    this.mixer.pushPCMFrame(userId, pcm.subarray(off, off + 960 * 2 * 2));
                }
            });

            opusStream.pipe(decoder);
            this.subscriptions.set(userId, { opusStream, decoder });
        });

        // safety: tear down lingering streams after the silence window
        this.receiver.speaking.on('end', userId => {
            const sub = this.subscriptions.get(userId);
            if (!sub) return;

            // Record when the user stops speaking relative to the beginning of the recording
            const startTime = this.activeSpeakers.get(userId);
            if (startTime !== undefined) {
                const endTime = Date.now() - this.recordStart;
                this.segments.push({ userId, start: startTime, end: endTime });
                this.activeSpeakers.delete(userId);
            }

            setTimeout(() => {
                if (this.subscriptions.has(userId)) {
                    try { sub.opusStream.destroy(); } catch {}
                    try { sub.decoder.destroy(); } catch {}
                    this.subscriptions.delete(userId);
                }
            }, END_SILENCE_MS + 250);
        });
    }

    /**
     * Flush the current recording to disk and start a new one.
     * This method finalizes the current WAV and metadata files, uploads them to S3 (if configured),
     * and resets internal state so that recording continues uninterrupted into a new file.
     */
    _flushSegment() {
        const flushTime = Date.now();
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
        } catch (err) {
            console.error('Failed to write metadata file during flush:', err);
        }
        // Finalize the WAV file
        try {
            this.writer.end();
        } catch {}
        // Upload the files to S3 if S3 is configured
        try {
            const wavKey = path.basename(this.outputPath);
            const jsonKey = path.basename(metadataPath);
            uploadFile(this.outputPath, wavKey).catch(() => {});
            uploadFile(metadataPath, jsonKey).catch(() => {});
        } catch (err) {
            console.error('Failed to upload files to S3:', err);
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
    }

    stop() {
        clearInterval(this.mixerTimer);
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
        } catch (err) {
            console.error('Failed to write metadata file:', err);
        }

        // Finalize the WAV file
        this.writer.end();

        // Upload final files to S3
        try {
            const wavKey = path.basename(this.outputPath);
            const jsonKey = path.basename(metadataPath);
            uploadFile(this.outputPath, wavKey).catch(() => {});
            uploadFile(metadataPath, jsonKey).catch(() => {});
        } catch (err) {
            console.error('Failed to upload files to S3:', err);
        }

        this.connection.destroy();
        // Return both the audio and metadata file paths
        return { audioPath: this.outputPath, metadataPath };
    }
}

module.exports = RecorderSession;
