const { joinVoiceChannel, EndBehaviorType } = require('@discordjs/voice');
const prism = require('prism-media');
const wav = require('wav');
const path = require('path');
const AudioMixer = require('./AudioMixer');

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
    }

    start() {
        this._wireSpeaking();
        // always write a frame every 20 ms, even if it’s silence
        this.mixerTimer = setInterval(() => {
            const frame = this.mixer.mixNextFrame();
            this.writer.write(frame);
        }, 20);
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
            setTimeout(() => {
                if (this.subscriptions.has(userId)) {
                    try { sub.opusStream.destroy(); } catch {}
                    try { sub.decoder.destroy(); } catch {}
                    this.subscriptions.delete(userId);
                }
            }, END_SILENCE_MS + 250);
        });
    }

    stop() {
        clearInterval(this.mixerTimer);
        for (const { opusStream, decoder } of this.subscriptions.values()) {
            try { opusStream.destroy(); } catch {}
            try { decoder.destroy(); } catch {}
        }
        this.writer.end();
        this.connection.destroy();
        return this.outputPath;
    }
}

module.exports = RecorderSession;