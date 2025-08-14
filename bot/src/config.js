// logging_config.js
import fs from 'node:fs';
import path from 'node:path';
import { createLogger, format, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

function setupLogging() {
    const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
    const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

    // ensure log dir exists
    fs.mkdirSync(LOG_DIR, { recursive: true });

    const rotateTransport = new DailyRotateFile({
        dirname: LOG_DIR,
        filename: 'app-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '50m',
        maxFiles: '14d', // keep 14 days
        level: LOG_LEVEL,
    });

    const logger = createLogger({
        level: LOG_LEVEL,
        format: format.combine(
            format.timestamp(),
            format.errors({ stack: true }),
            format.json()
        ),
        transports: [
            rotateTransport,
            // still echo to console
            new transports.Console({
                level: LOG_LEVEL,
                format: format.combine(
                    format.colorize(),
                    format.timestamp(),
                    format.printf(({ level, message, timestamp, stack, ...meta }) =>
                        stack
                            ? `${timestamp} ${level}: ${message}\n${stack}`
                            : `${timestamp} ${level}: ${message}${Object.keys(meta).length ? ' ' + JSON.stringify(meta) : ''}`
                    )
                ),
            }),
        ],
    });

    // keep the same global API you already use
    global.logger = logger;
}

export default setupLogging;
