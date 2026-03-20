import { app } from 'electron';
import path from 'path';
import fs from 'fs';

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_ROTATED_FILES = 3;

let logDir: string;
let logFilePath: string;
let initialized = false;

function ensureInitialized() {
  if (initialized) return;
  logDir = path.join(app.getPath('userData'), 'logs');
  logFilePath = path.join(logDir, 'error.log');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  initialized = true;
}

function rotateIfNeeded() {
  try {
    if (!fs.existsSync(logFilePath)) return;
    const stat = fs.statSync(logFilePath);
    if (stat.size < MAX_LOG_SIZE) return;

    // Rotate: error.log -> error.1.log -> error.2.log -> error.3.log (deleted)
    for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
      const older = path.join(logDir, `error.${i}.log`);
      if (i === MAX_ROTATED_FILES) {
        if (fs.existsSync(older)) fs.unlinkSync(older);
      } else {
        const newer = path.join(logDir, `error.${i + 1}.log`);
        if (fs.existsSync(older)) fs.renameSync(older, newer);
      }
    }
    fs.renameSync(logFilePath, path.join(logDir, 'error.1.log'));
  } catch {
    // Rotation failure is non-fatal
  }
}

function formatEntry(level: string, source: string, message: string, stack?: string): string {
  const timestamp = new Date().toISOString();
  let entry = `[${timestamp}] [${level.toUpperCase()}] [${source}] ${message}`;
  if (stack) {
    entry += '\n' + stack;
  }
  return entry + '\n';
}

export function logError(source: string, message: string, stack?: string) {
  ensureInitialized();
  rotateIfNeeded();
  try {
    fs.appendFileSync(logFilePath, formatEntry('error', source, message, stack));
  } catch {
    // If we can't write logs, there's nothing useful to do
  }
}

export function logWarn(source: string, message: string) {
  ensureInitialized();
  try {
    fs.appendFileSync(logFilePath, formatEntry('warn', source, message));
  } catch {
    // Non-fatal
  }
}

export function logInfo(source: string, message: string) {
  ensureInitialized();
  try {
    fs.appendFileSync(logFilePath, formatEntry('info', source, message));
  } catch {
    // Non-fatal
  }
}

export function getLogPath(): string {
  ensureInitialized();
  return logFilePath;
}

export function getRecentLogs(lines: number = 200): string {
  ensureInitialized();
  try {
    if (!fs.existsSync(logFilePath)) return '';
    const content = fs.readFileSync(logFilePath, 'utf-8');
    const allLines = content.split('\n');
    return allLines.slice(-lines).join('\n');
  } catch {
    return '';
  }
}
