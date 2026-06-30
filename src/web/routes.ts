import { Router, Request, Response } from 'express';
import type Redis from 'ioredis';
import { getCampaigns, addCampaign, removeCampaign } from '../redis.js';

export function createCampaignRouter(redis: Redis): Router {
  const router = Router();

  router.get('/campaigns', async (_req: Request, res: Response) => {
    const ids = await getCampaigns(redis);
    res.json({ campaigns: ids });
  });

  router.post('/campaigns', async (req: Request, res: Response) => {
    const id = String(req.body?.id ?? '').trim();
    if (!id) {
      res.status(400).json({ error: 'Campaign ID is required' });
      return;
    }
    const added = await addCampaign(redis, id);
    if (added) {
      res.status(201).json({ message: `Campaign ${id} added`, id });
    } else {
      res.status(409).json({ message: `Campaign ${id} already tracked`, id });
    }
  });

  router.delete('/campaigns/:id', async (req: Request, res: Response) => {
    const id = req.params.id;
    const removed = await removeCampaign(redis, id);
    if (removed) {
      res.json({ message: `Campaign ${id} removed`, id });
    } else {
      res.status(404).json({ error: `Campaign ${id} not found` });
    }
  });

  return router;
}
