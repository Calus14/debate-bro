// src/config.js
// Central config: read env on-demand (no capture at import time)
import winston from "winston";

import dotenv from "dotenv";
dotenv.config(); // load .env
dotenv.config({ path: ".env.local", override: true }); // then override from .env.local

export const config = {
    // App
    get NODE_ENV() { return process.env.NODE_ENV ?? "development"; },
    get LOG_LEVEL() { return process.env.LOG_LEVEL ?? "info"; },

    // Discord
    get DISCORD_TOKEN() { return process.env.DISCORD_TOKEN ?? ""; },
    get DEV_GUILD_ID() { return process.env.DEV_GUILD_ID ?? ""; },

    // AWS
    get AWS_REGION() { return process.env.AWS_REGION ?? "us-east-2"; },
    get S3_BUCKET_NAME() { return process.env.S3_BUCKET_NAME ?? ""; },

    // Storage layout
    // Adjust default if your tree differs
    get RECORDING_PREFIX() { return process.env.RECORDING_PREFIX ?? "bot/logs"; },

    get FLUSH_INTERVAL_MINUTES() { return process.env.FLUSH_INTERVAL_MINUTES ?? 3; },
    get FLUSH_INTERVAL_MS() { return process.env.FLUSH_INTERVAL_MS ?? 180000; },

    get PLAYBACK_MAX() { return process.env.PLAYBACK_MAX ?? 180; },

    get TIMEZONE() { return process.env.TIMEZONE ?? "UTC"; },
};

export function requireConfig(keys = []) {
    if (typeof keys === "string") {
        keys = [keys]; // wrap single string into an array
    }
    const missing = keys.filter(k => {
        const v = config[k];
        return v === undefined || v === null || String(v).length === 0;
    });
    if (missing.length) {
        throw new Error(`Missing required config: ${missing.join(", ")}`);
    }
}

export default function setupLogging() {
    const logger = winston.createLogger({
        level: config.LOG_LEVEL,
        transports: [new winston.transports.Console()],
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.printf(({ level, message, timestamp }) =>
                `${timestamp} ${level}: ${message}`
            )
        ),
    });
    // Optional: expose globally if your code already uses a global logger
    global.logger = logger;
}
