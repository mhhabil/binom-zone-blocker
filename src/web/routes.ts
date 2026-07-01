import { Router, Request, Response } from 'express';
import type Redis from 'ioredis';
import { getCampaignMap, setMapping, removeMapping } from '../redis.js';

export function createCampaignRouter(redis: Redis): Router {
  const router = Router();

  router.get('/campaigns', async (_req: Request, res: Response) => {
    const campaigns = await getCampaignMap(redis);
    res.json({ campaigns });
  });

  router.post('/campaigns', async (req: Request, res: Response) => {
    const binomId = String(req.body?.binom_id ?? '').trim();
    const admavenId = String(req.body?.admaven_id ?? '').trim();

    if (!binomId || !admavenId) {
      res.status(400).json({ error: 'Both binom_id and admaven_id are required' });
      return;
    }

    const created = await setMapping(redis, binomId, admavenId);
    res.status(created ? 201 : 200).json({
      message: created
        ? `Mapping added: Binom ${binomId} → AdMaven ${admavenId}`
        : `Mapping updated: Binom ${binomId} → AdMaven ${admavenId}`,
      binom_id: binomId,
      admaven_id: admavenId,
    });
  });

  router.delete('/campaigns/:binomId', async (req: Request, res: Response) => {
    const binomId = req.params.binomId;
    const removed = await removeMapping(redis, binomId);
    if (removed) {
      res.json({ message: `Mapping for Binom ${binomId} removed`, binom_id: binomId });
    } else {
      res.status(404).json({ error: `Mapping for Binom ${binomId} not found` });
    }
  });

  return router;
}
