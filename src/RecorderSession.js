const { joinVoiceChannel, EndBehaviorType } = require('@discordjs/voice');
const prism = require('prism-media');
const wav = require('wav');
const path = require('path');
const AudioMixer = require('./AudioMixer');

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
        this.mixerTimer = setInterval(() => {
            const frame = this.mixer.mixNextFrame();
            this.writer.write(frame);
        }, 20);
    }

    _wireSpeaking() {
        this.receiver.speaking.on('start', userId => {
            if (this.subscriptions.has(userId)) return;

            const opusStream = this.receiver.subscribe(userId, {
                end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 }
            });
            const decoder = new prism.opus.Decoder({
                rate: 48000,
                channels: 2,
                frameSize: 960
            });

            opusStream.pipe(decoder).on('data', chunk => {
                for (const frame of AudioMixer.sliceIntoFrames(chunk)) {
                    this.mixer.pushPCMFrame(userId, frame);
                }
            });

            const cleanup = () => {
                opusStream.removeAllListeners();
                decoder.removeAllListeners();
                this.subscriptions.delete(userId);
            };
            opusStream.once('end', cleanup);

            this.subscriptions.set(userId, { opusStream, decoder });
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
