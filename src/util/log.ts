import type { LogLevel } from "../types.js";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  constructor(private level: LogLevel = "info") {}

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string): void {
    this.write("debug", message);
  }

  info(message: string): void {
    this.write("info", message);
  }

  warn(message: string): void {
    this.write("warn", message);
  }

  error(message: string): void {
    this.write("error", message);
  }

  private write(level: LogLevel, message: string): void {
    if (LEVELS[level] < LEVELS[this.level]) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}`;
    if (level === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
  }
}
