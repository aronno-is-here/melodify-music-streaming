import express from 'express';
import { protect } from '../middleware/auth.js';
import { parseCatalogSearchQuery } from '../utils/catalogSearchRequest.js';
import { parseCatalogImportRequest } from '../utils/catalogImportRequest.js';
import { createCatalogDiscoveryService } from '../services/catalogDiscoveryService.js';
import {
  CatalogImportError,
  CATALOG_IMPORT_MESSAGES,
  createCatalogImportService,
} from '../services/catalogImportService.js';
import { REGIONAL_DISCOVERY } from '../services/regionalCatalog.js';

export const CATALOG_ROUTE_MESSAGES = Object.freeze({
  invalidSearchQuery: 'invalid catalog search query',
  searchFailed: 'failed to search catalog',
});

export function createCatalogRouter({
  protectMiddleware = protect,
  catalogDiscoveryService = createCatalogDiscoveryService(),
  catalogImportService = createCatalogImportService(),
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

  router.post('/import', protectMiddleware, async (req, res) => {
    const parsed = parseCatalogImportRequest(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ success: false, error: CATALOG_IMPORT_MESSAGES.invalidRequest });
    }
    try {
      const result = await catalogImportService.importProviderTrack(parsed.value);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error instanceof CatalogImportError) {
        if (error.code === 'UNSUPPORTED_PROVIDER') {
          return res.status(400).json({ success: false, error: CATALOG_IMPORT_MESSAGES.unsupportedProvider });
        }
        if (error.code === 'PROVIDER_UNAVAILABLE') {
          return res.status(503).json({ success: false, error: CATALOG_IMPORT_MESSAGES.providerUnavailable });
        }
      }
      return res.status(500).json({ success: false, error: CATALOG_IMPORT_MESSAGES.importFailed });
    }
  });

  return router;
}

const router = createCatalogRouter();

export default router;
