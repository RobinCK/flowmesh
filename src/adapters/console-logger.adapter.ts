import { LoggerAdapter } from '../types';

export class ConsoleLoggerAdapter implements LoggerAdapter {
  log(message: string, context?: unknown): void {
    console.log(`[LOG] ${message}`, context || '');
  }

  error(message: string, error?: Error, context?: unknown): void {
    console.error(`[ERROR] ${message}`, error || '', context || '');
  }

  warn(message: string, context?: unknown): void {
    console.warn(`[WARN] ${message}`, context || '');
  }

  debug(message: string, context?: unknown): void {
    console.debug(`[DEBUG] ${message}`, context || '');
  }
}
