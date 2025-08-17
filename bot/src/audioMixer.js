const BYTES_PER_SAMPLE = 2;
const FRAME_SIZE = 960; // 20ms @ 48kHz
const CHANNELS = 2;
const FRAME_BYTES = FRAME_SIZE * CHANNELS * BYTES_PER_SAMPLE;
const PREGain = 0.5; // -6dB

class AudioMixer {
    constructor() {
        this.userQueues = new Map();
        this.userLastActive = new Map();
        this.silence = Buffer.alloc(FRAME_BYTES);
        this.accum = new Int32Array(FRAME_SIZE * CHANNELS);
        this.mixBuf = Buffer.allocUnsafe(FRAME_BYTES);
    }

    pushPCMFrame(userId, frame) {
        if (frame.length !== FRAME_BYTES) return;
        if (!this.userQueues.has(userId)) this.userQueues.set(userId, []);
        this.userQueues.get(userId).push(frame);
        this.userLastActive.set(userId, Date.now());
    }

    mixNextFrame() {
        this._pruneIdle();
        if (this.userQueues.size === 0) return this.silence;
        this.accum.fill(0);

        for (const queue of this.userQueues.values()) {
            const frame = queue.length ? queue.shift() : this.silence;
            for (let i = 0, off = 0; i < this.accum.length; i++, off += 2) {
                this.accum[i] += (frame.readInt16LE(off) * PREGain) | 0;
            }
        }
        for (let i = 0, off = 0; i < this.accum.length; i++, off += 2) {
            let v = this.accum[i];
            if (v > 32767) v = 32767;
            else if (v < -32768) v = -32768;
            this.mixBuf.writeInt16LE(v, off);
        }
        return this.mixBuf;
    }

    _pruneIdle() {
        const now = Date.now();
        for (const [uid, q] of this.userQueues.entries()) {
            if (q.length === 0 && now - (this.userLastActive.get(uid) || 0) > 5000) {
                this.userQueues.delete(uid);
                this.userLastActive.delete(uid);
            }
        }
    }

    static *sliceIntoFrames(buf) {
        for (let off = 0; off + FRAME_BYTES <= buf.length; off += FRAME_BYTES) {
            yield buf.subarray(off, off + FRAME_BYTES);
        }
    }
}

export default AudioMixer;