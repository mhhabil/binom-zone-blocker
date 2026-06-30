import pino from 'pino';
import fs from 'fs';
import path from 'path';

const logsDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const today = new Date().toISOString().slice(0, 10);
const logFile = path.join(logsDir, `blocker-${today}.log`);

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
  },
  pino.multistream([
    {
      stream: process.stdout,
      level: (process.env.LOG_LEVEL ?? 'info') as pino.Level,
    },
    {
      stream: pino.destination({ dest: logFile, sync: false }),
      level: 'debug',
    },
  ])
);

export type Logger = typeof logger;
