type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  meta?: unknown;
}

class Logger {
  private logLevel: LogLevel;

  constructor() {
    this.logLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };
    
    return levels[level] >= levels[this.logLevel];
  }

  private formatMessage(level: LogLevel, message: string, meta?: unknown): string {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      meta,
    };
    
    return JSON.stringify(entry);
  }

  private log(level: LogLevel, message: string, meta?: unknown): void {
    if (!this.shouldLog(level)) return;

    const formatted = this.formatMessage(level, message, meta);
    
    // Use console.error for error and warn, console.log for others
    if (level === 'error' || level === 'warn') {
      // eslint-disable-next-line no-console
      console.error(formatted);
    } else {
      // eslint-disable-next-line no-console
      console.log(formatted);
    }
  }

  debug(message: string, meta?: unknown): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.log('warn', message, meta);
  }

  error(message: string, error?: unknown): void {
    const meta = error instanceof Error 
      ? { 
          message: error.message, 
          stack: error.stack,
          name: error.name
        }
      : error;
    this.log('error', message, meta);
  }
}

export const logger = new Logger();
