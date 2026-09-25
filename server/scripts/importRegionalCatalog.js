import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import { createCatalogDiscoveryService, MAX_CATALOG_LIMIT } from '../services/catalogDiscoveryService.js';
import { createCatalogImportService } from '../services/catalogImportService.js';
import { REGIONAL_DISCOVERY, normalizeRegionTag } from '../services/regionalCatalog.js';

export const DEFAULT_SEARCH_LIMIT = 10;
export const DEFAULT_IMPORT_LIMIT = 10;
export const MAX_IMPORT_LIMIT = 50;

const REGION_HINTS = Object.freeze(
  REGIONAL_DISCOVERY.reduce((acc, entry) => {
    acc[entry.id] = Array.isArray(entry.searchHints) ? entry.searchHints : [];
    return acc;
  }, {})
);

const toTrimmed = (value) => (typeof value === 'string' ? value.trim() : '');

const parsePositiveBoundedInteger = (value, max, flagName) => {
  if (!/^\d+$/.test(String(value))) {
    throw new Error(`Invalid ${flagName} value`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`Invalid ${flagName} value`);
  }
  return parsed;
};

export const parseRegionalImportArgs = (argv) => {
  const args = Array.isArray(argv) ? argv : [];
  let regionTag = '';
  let query = '';
  let genre = '';
  let language = '';
  let searchLimit = DEFAULT_SEARCH_LIMIT;
  let importLimit = DEFAULT_IMPORT_LIMIT;
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--region') {
      regionTag = toTrimmed(args[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--query') {
      query = toTrimmed(args[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--genre') {
      genre = toTrimmed(args[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--language') {
      language = toTrimmed(args[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--search-limit') {
      searchLimit = parsePositiveBoundedInteger(args[index + 1], MAX_CATALOG_LIMIT, '--search-limit');
      index += 1;
      continue;
    }
    if (token === '--import-limit') {
      importLimit = parsePositiveBoundedInteger(args[index + 1], MAX_IMPORT_LIMIT, '--import-limit');
      index += 1;
      continue;
    }
    if (token === '--dry-run') {
      dryRun = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  const normalizedRegion = normalizeRegionTag(regionTag);
  if (!normalizedRegion) {
    throw new Error('Invalid or missing --region value');
  }

  const regionHints = REGION_HINTS[normalizedRegion] || [];
  const effectiveQuery = query || regionHints[0] || '';
  if (!effectiveQuery) {
    throw new Error('Missing search query for region');
  }

  return {
    regionTag: normalizedRegion,
    query: effectiveQuery,
    genre,
    language,
    searchLimit,
    importLimit,
    dryRun,
  };
};

export const runRegionalCatalogImport = async ({
  searchCatalog,
  importProviderTrack,
  options,
}) => {
  const discovery = await searchCatalog({
    query: options.query,
    regionTag: options.regionTag,
    localLimit: options.searchLimit,
    externalLimit: options.searchLimit,
    includeExternal: true,
    broadenExternal: true,
  });

  const externalCandidates = Array.isArray(discovery.externalResults)
    ? discovery.externalResults
      .filter((entry) => entry && entry.sourceType === 'external')
      .slice(0, options.importLimit)
    : [];

  const imported = [];
  const failures = [];
  const counters = { inserted: 0, existing: 0, adoptedLegacy: 0 };

  for (const candidate of externalCandidates) {
    const item = {
      provider: candidate.provider || 'youtube',
      providerTrackId: candidate.providerTrackId,
      title: candidate.title || '',
      artist: candidate.artist || '',
    };
    if (!item.providerTrackId) {
      failures.push({ ...item, error: 'missing providerTrackId' });
      continue;
    }
    if (options.dryRun) {
      imported.push({ ...item, status: 'dry-run' });
      continue;
    }

    try {
      const result = await importProviderTrack({
        provider: item.provider,
        providerTrackId: item.providerTrackId,
        regionTag: options.regionTag,
        genre: options.genre || undefined,
        language: options.language || undefined,
      });
      if (result?.status === 'inserted') counters.inserted += 1;
      if (result?.status === 'existing') counters.existing += 1;
      if (result?.status === 'adopted-legacy') counters.adoptedLegacy += 1;
      imported.push({
        ...item,
        status: result?.status || 'unknown',
        songId: result?.song?._id || null,
      });
    } catch (error) {
      failures.push({
        ...item,
        error: error && typeof error.message === 'string' ? error.message : 'import failed',
      });
    }
  }

  return {
    regionTag: options.regionTag,
    query: options.query,
    externalState: discovery.externalState,
    localCount: Array.isArray(discovery.localResults) ? discovery.localResults.length : 0,
    externalCount: Array.isArray(discovery.externalResults) ? discovery.externalResults.length : 0,
    importAttempted: externalCandidates.length,
    dryRun: options.dryRun,
    counters,
    imported,
    failures,
  };
};

export const runRegionalImportCli = async ({ argv = process.argv.slice(2), writeOut = console.log, writeErr = console.error } = {}) => {
  try {
    const options = parseRegionalImportArgs(argv);
    await connectDB();
    const discoveryService = createCatalogDiscoveryService();
    const importService = createCatalogImportService();
    const summary = await runRegionalCatalogImport({
      searchCatalog: discoveryService.searchCatalog,
      importProviderTrack: importService.importProviderTrack,
      options,
    });
    writeOut(JSON.stringify({ success: true, summary }, null, 2));
    return 0;
  } catch (error) {
    writeErr(JSON.stringify({ success: false, error: error?.message || 'regional import failed' }));
    return 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
};

const scriptPath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (entryPath && entryPath === scriptPath) {
  runRegionalImportCli().then((code) => {
    process.exitCode = code;
  });
}
