/** Log levels supported by lemura */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    FATAL = 4,
}

/** Severity levels for user-facing logs */
export type Severity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

/** Metadata for structured logging and error reporting */
export interface LogMetadata {
    problem?: string;
    hints?: string[];
    severity?: Severity;
    [key: string]: unknown;
}

/**
 * Enhanced logger interface for lemura.
 * Supports structured logging with problems and hints.
 */
export interface ILogger {
    /** Log a debug message (trace-level details) */
    debug(message: string, metadata?: LogMetadata): void;
    /** Log an informational message */
    info(message: string, metadata?: LogMetadata): void;
    /** Log a warning */
    warn(message: string, metadata?: LogMetadata): void;
    /** Log an error */
    error(message: string, metadata?: LogMetadata): void;
    /** Log a fatal error that prevents execution */
    fatal(message: string, metadata?: LogMetadata): void;

    /** Set the minimum log level to display */
    setLevel(level: LogLevel): void;
}
