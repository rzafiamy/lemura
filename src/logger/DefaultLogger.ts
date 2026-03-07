import { ILogger, LogLevel, LogMetadata, Severity } from '../types/logger.js';

/**
 * Default colorized logger for lemura.
 * Uses ANSI escape codes for beautiful colors without dependencies.
 */
export class DefaultLogger implements ILogger {
    private level: LogLevel = LogLevel.INFO;

    private readonly COLORS: Record<Severity | 'RESET', string> = {
        DEBUG: '\x1b[36m', // Cyan
        INFO: '\x1b[32m',  // Green
        WARN: '\x1b[33m',  // Yellow
        ERROR: '\x1b[31m', // Red
        FATAL: '\x1b[41m\x1b[37m', // White on Red background
        RESET: '\x1b[0m',
    };

    setLevel(level: LogLevel): void {
        this.level = level;
    }

    debug(message: string, metadata?: LogMetadata): void {
        if (this.level <= LogLevel.DEBUG) this.log('DEBUG', message, metadata);
    }

    info(message: string, metadata?: LogMetadata): void {
        if (this.level <= LogLevel.INFO) this.log('INFO', message, metadata);
    }

    warn(message: string, metadata?: LogMetadata): void {
        if (this.level <= LogLevel.WARN) this.log('WARN', message, metadata);
    }

    error(message: string, metadata?: LogMetadata): void {
        if (this.level <= LogLevel.ERROR) this.log('ERROR', message, metadata);
    }

    fatal(message: string, metadata?: LogMetadata): void {
        if (this.level <= LogLevel.FATAL) this.log('FATAL', message, metadata);
    }

    private log(severity: Severity, message: string, metadata?: LogMetadata): void {
        const timestamp = new Date().toISOString();
        const color = this.COLORS[severity] || this.COLORS.RESET;
        const reset = this.COLORS.RESET;

        console.log(`${timestamp} [${color}${severity}${reset}] ${message}`);

        if (metadata) {
            if (metadata.problem) {
                console.log(`  ${color}PROBLEM:${reset} ${metadata.problem}`);
            }
            if (metadata.hints && metadata.hints.length > 0) {
                console.log(`  ${color}HINTS:${reset}`);
                metadata.hints.forEach(hint => console.log(`    - ${hint}`));
            }

            // Log other metadata fields if they are not system fields
            const otherKeys = Object.keys(metadata).filter(k => !['problem', 'hints', 'severity'].includes(k));
            if (otherKeys.length > 0) {
                otherKeys.forEach(key => {
                    const value = metadata[key];
                    if (typeof value === 'object') {
                        console.log(`  ${key}: ${JSON.stringify(value, null, 2).replace(/\n/g, '\n  ')}`);
                    } else {
                        console.log(`  ${key}: ${value}`);
                    }
                });
            }
        }
    }
}
