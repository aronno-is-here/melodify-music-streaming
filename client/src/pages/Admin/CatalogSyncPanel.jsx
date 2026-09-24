import { useRef, useState } from 'react';
import { api } from '../../api/client.js';
import {
  buildCatalogSyncPayload,
  formatCatalogSyncStatus,
  mapCatalogSyncError,
  CATALOG_SYNC_DEFAULT_MAX_RESULTS,
  CATALOG_SYNC_MAX_RESULTS,
  CATALOG_SYNC_MIN_RESULTS,
  CATALOG_SYNC_MAX_QUERY_LENGTH,
  CATALOG_SYNC_MAX_GENRE_LENGTH,
  CATALOG_SYNC_MAX_LANGUAGE_LENGTH,
  CATALOG_SYNC_GENERIC_MESSAGE,
} from './catalogSyncUi.js';

const SUMMARY_FIELDS = [
  ['requested', 'Requested'],
  ['searched', 'Searched'],
  ['normalized', 'Normalized'],
  ['inserted', 'Inserted'],
  ['updated', 'Updated'],
  ['adoptedLegacy', 'Adopted Legacy'],
  ['skipped', 'Skipped'],
  ['conflicts', 'Conflicts'],
  ['failed', 'Failed'],
];

const asCount = (value) => (Number.isFinite(value) && value >= 0 ? value : 0);

export default function CatalogSyncPanel() {
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('');
  const [language, setLanguage] = useState('');
  const [maxResults, setMaxResults] = useState(String(CATALOG_SYNC_DEFAULT_MAX_RESULTS));
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [requestError, setRequestError] = useState('');
  const [summary, setSummary] = useState(null);
  const inFlightRef = useRef(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (inFlightRef.current || submitting) return;

    setValidationError('');
    setRequestError('');
    setSummary(null);

    const built = buildCatalogSyncPayload({
      query,
      genre,
      language,
      maxResults: maxResults === '' ? undefined : Number(maxResults),
    });
    if (!built.ok) {
      setValidationError(built.error);
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const data = await api.post('/api/admin/catalog-sync', built.payload);
      if (data && data.success === true && data.data && typeof data.data === 'object') {
        setSummary(data.data);
      } else {
        setRequestError(mapCatalogSyncError(data) || CATALOG_SYNC_GENERIC_MESSAGE);
      }
    } catch {
      setRequestError(CATALOG_SYNC_GENERIC_MESSAGE);
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  const results = Array.isArray(summary?.results) ? summary.results.slice(0, 10) : [];

  return (
    <section className="catalog-sync-panel" aria-labelledby="catalog-sync-heading">
      <div className="form-divider"><span>YouTube Catalog Sync</span></div>
      <h3 id="catalog-sync-heading">Sync from YouTube</h3>
      <p className="catalog-sync-hint">
        Manually search YouTube and persist eligible tracks through the admin catalog-sync endpoint.
        One request performs at most one search and one details lookup (max {CATALOG_SYNC_MAX_RESULTS} results).
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="catalog-sync-query">Search query *</label>
          <input
            id="catalog-sync-query"
            name="query"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Tahsan old songs"
            maxLength={CATALOG_SYNC_MAX_QUERY_LENGTH}
            required
            disabled={submitting}
            aria-required="true"
            aria-invalid={validationError ? 'true' : 'false'}
            aria-describedby={validationError ? 'catalog-sync-validation' : undefined}
          />
        </div>

        <div className="catalog-sync-grid">
          <div className="form-group">
            <label htmlFor="catalog-sync-genre">Genre (optional)</label>
            <input
              id="catalog-sync-genre"
              name="genre"
              type="text"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              placeholder="Pop, Rock, Hip-Hop, Bangla"
              maxLength={CATALOG_SYNC_MAX_GENRE_LENGTH}
              disabled={submitting}
              aria-describedby="catalog-sync-genre-hint"
            />
            <small id="catalog-sync-genre-hint" className="catalog-sync-hint">Trusted admin context only — not inferred.</small>
          </div>
          <div className="form-group">
            <label htmlFor="catalog-sync-language">Language (optional)</label>
            <input
              id="catalog-sync-language"
              name="language"
              type="text"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="English, Bangla, Hindi"
              maxLength={CATALOG_SYNC_MAX_LANGUAGE_LENGTH}
              disabled={submitting}
              aria-describedby="catalog-sync-language-hint"
            />
            <small id="catalog-sync-language-hint" className="catalog-sync-hint">Never inferred from the query.</small>
          </div>
          <div className="form-group">
            <label htmlFor="catalog-sync-max-results">Max results</label>
            <input
              id="catalog-sync-max-results"
              name="maxResults"
              type="number"
              value={maxResults}
              onChange={(e) => setMaxResults(e.target.value)}
              min={CATALOG_SYNC_MIN_RESULTS}
              max={CATALOG_SYNC_MAX_RESULTS}
              step={1}
              disabled={submitting}
              aria-describedby="catalog-sync-max-hint"
            />
            <small id="catalog-sync-max-hint" className="catalog-sync-hint">
              Integer {CATALOG_SYNC_MIN_RESULTS}–{CATALOG_SYNC_MAX_RESULTS} (server hard cap).
            </small>
          </div>
        </div>

        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? 'Syncing catalog...' : 'Sync Catalog'}
        </button>
      </form>

      <div aria-live="polite">
        {validationError && (
          <div id="catalog-sync-validation" className="catalog-sync-feedback is-error" role="alert">
            {validationError}
          </div>
        )}
        {requestError && (
          <div className="catalog-sync-feedback is-error" role="alert">
            {requestError}
          </div>
        )}
        {submitting && (
          <div className="catalog-sync-feedback is-loading">
            Syncing catalog… please wait.
          </div>
        )}
      </div>

      {summary && !submitting && (
        <div className="catalog-sync-feedback is-success" aria-live="polite">
          <h4>Sync summary{summary.query ? ` for “${summary.query}”` : ''}</h4>
          <div className="catalog-sync-summary">
            {SUMMARY_FIELDS.map(([key, label]) => (
              <div key={key} className="catalog-sync-stat">
                <span className="catalog-sync-stat-label">{label}</span>
                <span className="catalog-sync-stat-value">{asCount(summary[key])}</span>
              </div>
            ))}
          </div>

          {results.length > 0 && (
            <div className="catalog-sync-results-wrap">
              <table className="catalog-sync-results">
                <thead>
                  <tr>
                    <th scope="col">Video ID</th>
                    <th scope="col">Song ID</th>
                    <th scope="col">Status</th>
                    <th scope="col">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((item, index) => (
                    <tr key={`${item.videoId || 'item'}-${index}`}>
                      <td>{item.videoId || '—'}</td>
                      <td>{item.songId || '—'}</td>
                      <td>{formatCatalogSyncStatus(item.status)}</td>
                      <td>{item.reason ? formatCatalogSyncStatus(item.reason) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
