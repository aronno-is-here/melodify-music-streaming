import express from 'express';
import Song from '../models/Song.js';
import { protect, adminOnly } from '../middleware/auth.js';
import {
  AdminLyricsError,
  createAdminLyricsService,
} from '../services/adminLyricsService.js';
import { lyricsSourceDiscovery } from './lyricsRoutes.js';

export const ADMIN_LYRICS_LIST_ERROR = 'failed to load missing lyrics';
export const ADMIN_LYRICS_SAVE_ERROR = 'failed to save verified lyrics';
export const ADMIN_LYRICS_BODY_ERROR = 'invalid add lyrics body';

export const ADD_LYRICS_BODY_KEYS = Object.freeze([
  'lyrics',
  'language',
  'sourceUrl',
  'sourceProvider',
  'notes',
  'format',
  'replaceVerified',
]);

export const IMPORT_LYRICS_BODY_KEYS = Object.freeze([
  'text',
  'fileName',
  'format',
  'replaceVerified',
]);

export function createAdminLyricsRouter({
  adminLyricsService = createAdminLyricsService({
    SongModel: Song,
    lyricsDiscovery: lyricsSourceDiscovery,
  }),
  protectMiddleware = protect,
  adminOnlyMiddleware = adminOnly,
} = {}) {
  const router = express.Router();

  const mapError = (error) => {
    if (error instanceof AdminLyricsError) {
      return { status: error.status, message: error.message };
    }
    return null;
  };

  const hasUnknownKeys = (body, allowedKeys) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return true;
    return Object.keys(body).some((key) => !allowedKeys.includes(key));
  };

  router.use(protectMiddleware, adminOnlyMiddleware);

  router.get('/', async (req, res) => {
    try {
      const data = await adminLyricsService.listMissingLyrics(req.query);
      return res.json({ success: true, data });
    } catch (error) {
      const mapped = mapError(error);
      if (mapped) return res.status(mapped.status).json({ success: false, error: mapped.message });
      return res.status(500).json({ success: false, error: ADMIN_LYRICS_LIST_ERROR });
    }
  });

  router.post('/import', async (req, res) => {
    if (hasUnknownKeys(req.body, IMPORT_LYRICS_BODY_KEYS)) {
      return res.status(400).json({ success: false, error: ADMIN_LYRICS_BODY_ERROR });
    }
    try {
      const data = await adminLyricsService.bulkImport({
        text: req.body?.text,
        fileName: req.body?.fileName,
        format: req.body?.format,
        replaceVerified: req.body?.replaceVerified,
        verifiedBy: String(req.user?._id ?? ''),
      });
      return res.json({ success: true, data });
    } catch (error) {
      const mapped = mapError(error);
      if (mapped) return res.status(mapped.status).json({ success: false, error: mapped.message });
      return res.status(500).json({ success: false, error: ADMIN_LYRICS_SAVE_ERROR });
    }
  });

  router.post('/:songId', async (req, res) => {
    if (hasUnknownKeys(req.body, ADD_LYRICS_BODY_KEYS)) {
      return res.status(400).json({ success: false, error: ADMIN_LYRICS_BODY_ERROR });
    }
    try {
      const data = await adminLyricsService.saveVerifiedLyrics({
        songId: req.params.songId,
        lyrics: req.body?.lyrics,
        language: req.body?.language,
        sourceUrl: req.body?.sourceUrl,
        sourceProvider: req.body?.sourceProvider,
        notes: req.body?.notes,
        format: req.body?.format,
        replaceVerified: req.body?.replaceVerified,
        verifiedBy: String(req.user?._id ?? ''),
      });
      return res.json({ success: true, data });
    } catch (error) {
      const mapped = mapError(error);
      if (mapped) return res.status(mapped.status).json({ success: false, error: mapped.message });
      return res.status(500).json({ success: false, error: ADMIN_LYRICS_SAVE_ERROR });
    }
  });

  return router;
}

export default createAdminLyricsRouter();
