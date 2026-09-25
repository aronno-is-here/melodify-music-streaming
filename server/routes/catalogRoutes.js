import express from 'express';
import { protect } from '../middleware/auth.js';
import { parseCatalogSearchQuery } from '../utils/catalogSearchRequest.js';
import { createCatalogDiscoveryService } from '../services/catalogDiscoveryService.js';
import { REGIONAL_DISCOVERY } from '../services/regionalCatalog.js';

export const CATALOG_ROUTE_MESSAGES = Object.freeze({
  invalidSearchQuery: 'invalid catalog search query',
  searchFailed: 'failed to search catalog',
});

export function createCatalogRouter({
  protectMiddleware = protect,
  catalogDiscoveryService = createCatalogDiscoveryService(),
} = {}) {
  const router = express.Router();

  router.get('/regions', protectMiddleware, (_req, res) => {
    res.status(200).json({ success: true, data: REGIONAL_DISCOVERY.map((entry) => ({ id: entry.id, label: entry.label })) });
  });

  router.get('/search', protectMiddleware, async (req, res) => {
    const parsed = parseCatalogSearchQuery(req.query);
    if (!parsed.ok) {
      return res.status(400).json({ success: false, error: CATALOG_ROUTE_MESSAGES.invalidSearchQuery });
    }
    try {
      const result = await catalogDiscoveryService.searchCatalog({
        query: parsed.value.query,
        regionTag: parsed.value.regionTag,
        localLimit: parsed.value.limit,
        externalLimit: parsed.value.limit,
        includeExternal: parsed.value.includeExternal,
        broadenExternal: parsed.value.broadenExternal,
      });
      return res.status(200).json({ success: true, data: result });
    } catch {
      return res.status(500).json({ success: false, error: CATALOG_ROUTE_MESSAGES.searchFailed });
    }
  });

  return router;
}

const router = createCatalogRouter();

export default router;
