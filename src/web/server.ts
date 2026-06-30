import express from 'express';
import cors from 'cors';
import path from 'path';
import type Redis from 'ioredis';
import type { Logger } from '../logger.js';
import { createCampaignRouter } from './routes.js';

export function createServer(redis: Redis, logger: Logger): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.resolve(__dirname, 'public')));

  app.use('/api', createCampaignRouter(redis));

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, 'unhandled server error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

export function startServer(redis: Redis, logger: Logger): void {
  const app = createServer(redis, logger);
  const port = parseInt(process.env.PORT ?? '3000', 10);

  app.listen(port, () => {
    logger.info({ port }, `Web UI running at http://localhost:${port}`);
  });
}
