import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ADMIN_MISSING_LYRICS_MESSAGES,
  MAX_BULK_LYRICS_ENTRIES,
  fetchMissingLyricsQueue,
  findSongLyricsSources,
  importVerifiedLyrics,
  validateBulkFileSelection,
} from '../../services/adminMissingLyrics.js';
import {
  BULK_IMPORT_FILE_INPUT_ACCEPT,
  MISSING_LYRICS_MESSAGES,
  MISSING_LYRICS_VIEWS,
  buildImportCountCards,
  buildPagination,
  buildQueueRowActions,
  formatLanguageLabel,
  lyricsStatusLabel,
  lrclibStatusLabel,
  selectMissingLyricsView,
} from './missingLyricsUi.js';
import AddLyricsDialog from './AddLyricsDialog.jsx';

const LANGUAGE_OPTIONS = [
  { value: '', label: 'All languages' },
  { value: 'hindi', label: 'Hindi' },
  { value: 'bn-bd', label: 'Bangladeshi Bengali' },
  { value: 'bn-in', label: 'Kolkata/Indian Bengali' },
  { value: 'english', label: 'English' },
];

const EMPTY_DATA = {
  state: 'empty',
  q: '',
  language: '',
  missing: true,
  page: 1,
  limit: 20,
  total: 0,
  pages: 1,
  rows: [],
};

export default function MissingLyricsQueue() {
  const [searchDraft, setSearchDraft] = useState('');
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState('');
  const [missingOnly, setMissingOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [data, setData] = useState(EMPTY_DATA);
  const [view, setView] = useState(MISSING_LYRICS_VIEWS.LOADING);
  const [error, setError] = useState('');
  const [dialogRow, setDialogRow] = useState(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [importFile, setImportFile] = useState(null);
  const [importReplace, setImportReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState('');
  const generationRef = useRef(0);
  const importInputRef = useRef(null);

  const load = useCallback(async (next) => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setView(MISSING_LYRICS_VIEWS.LOADING);
    setError('');
    const result = await fetchMissingLyricsQueue(next);
    if (generation !== generationRef.current) return;
    if (!result.ok) {
      setError(result.error);
      setView(MISSING_LYRICS_VIEWS.ERROR);
      return;
    }
    setData(result.data);
    setView(selectMissingLyricsView({ rows: result.data.rows, total: result.data.total }));
  }, []);

  useEffect(() => {
    load({ q: query, language, missing: missingOnly, page });
  }, [load, query, language, missingOnly, page, refreshToken]);

  const applyFilters = (nextPage) => {
    setNotice('');
    setPage(nextPage);
    setRefreshToken((token) => token + 1);
  };

  const submitSearch = (event) => {
    event.preventDefault();
    setQuery(searchDraft.trim());
    applyFilters(1);
  };

  const handleFindSources = async (row) => {
    const result = await findSongLyricsSources(row.songId);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setActionError('');
    const candidate = result.candidates.find((entry) => entry && typeof entry.url === 'string') || null;
    setData((current) => ({
      ...current,
      rows: current.rows.map((entry) => (
        entry.songId === row.songId ? { ...entry, sourceCandidate: candidate } : entry
      )),
    }));
  };

  const handleImportFile = (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    setImportResult(null);
    setImportError('');
    if (!file) {
      setImportFile(null);
      return;
    }
    const check = validateBulkFileSelection({ name: file.name, size: file.size });
    if (!check.ok) {
      setImportFile(null);
      setImportError(check.error);
      return;
    }
    setImportFile(file);
  };

  const handleImport = async () => {
    if (importing) return;
    if (!importFile) {
      setImportError(ADMIN_MISSING_LYRICS_MESSAGES.NO_FILE_SELECTED);
      return;
    }
    setImporting(true);
    setImportError('');
    setImportResult(null);
    try {
      const text = await importFile.text();
      const result = await importVerifiedLyrics({
        text,
        fileName: importFile.name,
        replaceVerified: importReplace,
      });
      if (!result.ok) {
        setImportError(result.error);
        return;
      }
      setImportResult(result.data);
      setImportFile(null);
      setNotice('');
      setRefreshToken((token) => token + 1);
    } catch {
      setImportError(ADMIN_MISSING_LYRICS_MESSAGES.IMPORT_FAILED);
    } finally {
      setImporting(false);
    }
  };

  const pagination = buildPagination(data.page, data.pages);

  return (
    <section className="missing-lyrics-panel" aria-labelledby="missing-lyrics-heading">
      <div className="form-divider"><span>Lyrics Operations</span></div>
      <h3 id="missing-lyrics-heading">Missing Lyrics</h3>
      <p className="catalog-sync-hint">
        Work through songs that have no usable verified local lyrics. Save verified text with the
        Add Lyrics dialog, or import a CSV/JSON batch (max {MAX_BULK_LYRICS_ENTRIES} entries).
      </p>

      <form className="missing-lyrics-filters" onSubmit={submitSearch} noValidate>
        <div className="form-group">
          <label htmlFor="missing-lyrics-search">Search</label>
          <input
            id="missing-lyrics-search"
            type="search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Title, artist or album"
            maxLength={200}
          />
        </div>
        <div className="form-group">
          <label htmlFor="missing-lyrics-language">Language</label>
          <select
            id="missing-lyrics-language"
            value={language}
            onChange={(event) => { setNotice(''); setLanguage(event.target.value); setPage(1); }}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group missing-lyrics-missing-only">
          <label htmlFor="missing-lyrics-missing">
            <input
              id="missing-lyrics-missing"
              type="checkbox"
              checked={missingOnly}
              onChange={(event) => { setNotice(''); setMissingOnly(event.target.checked); setPage(1); }}
            />
            {' '}Missing only
          </label>
        </div>
        <button type="submit" className="btn">{MISSING_LYRICS_MESSAGES.REFRESH}</button>
      </form>

      <div aria-live="polite">
        {view === MISSING_LYRICS_VIEWS.LOADING && (
          <div className="catalog-sync-feedback is-loading" role="status">{MISSING_LYRICS_MESSAGES.LOADING}</div>
        )}
        {view === MISSING_LYRICS_VIEWS.ERROR && (
          <div className="catalog-sync-feedback is-error" role="alert">
            {error || ADMIN_MISSING_LYRICS_MESSAGES.QUEUE_FAILED}
          </div>
        )}
        {view === MISSING_LYRICS_VIEWS.EMPTY && (
          <div className="catalog-sync-feedback">{MISSING_LYRICS_MESSAGES.EMPTY}</div>
        )}
        {notice && <div className="catalog-sync-feedback is-success">{notice}</div>}
        {actionError && (
          <div className="catalog-sync-feedback is-error" role="alert">{actionError}</div>
        )}
      </div>

      {view === MISSING_LYRICS_VIEWS.READY && (
        <div className="missing-lyrics-table-wrap">
          <table className="missing-lyrics-table">
            <thead>
              <tr>
                <th scope="col">Song</th>
                <th scope="col">Artist</th>
                <th scope="col">Language</th>
                <th scope="col">Lyrics</th>
                <th scope="col">LRCLIB</th>
                <th scope="col">Source</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const actions = buildQueueRowActions(row);
                return (
                  <tr key={row.songId}>
                    <td>{row.title || '—'}</td>
                    <td>{row.artist || '—'}</td>
                    <td>{formatLanguageLabel(row)}</td>
                    <td>{lyricsStatusLabel(row.lyricsStatus)}</td>
                    <td>{lrclibStatusLabel(row.lrclibStatus)}</td>
                    <td>
                      {actions.canOpenSource ? (
                        <a href={actions.openSourceUrl} target="_blank" rel="noopener noreferrer">
                          {MISSING_LYRICS_MESSAGES.OPEN_SOURCE}
                        </a>
                      ) : (row.source || '—')}
                    </td>
                    <td className="missing-lyrics-actions">
                      <a className="missing-lyrics-action" href={actions.openSongHref}>
                        {MISSING_LYRICS_MESSAGES.OPEN_SONG}
                      </a>
                      <button
                        type="button"
                        className="missing-lyrics-action"
                        onClick={() => handleFindSources(row)}
                        disabled={!actions.canFindSources}
                      >
                        {MISSING_LYRICS_MESSAGES.FIND_SOURCES}
                      </button>
                      <button
                        type="button"
                        className="missing-lyrics-action"
                        onClick={() => setDialogRow(row)}
                        disabled={!actions.canAddLyrics}
                      >
                        {MISSING_LYRICS_MESSAGES.ADD_LYRICS}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pagination.show && (
        <nav className="missing-lyrics-pagination" aria-label="Missing lyrics pages">
          <button
            type="button"
            className="btn"
            disabled={!pagination.canPrev}
            onClick={() => applyFilters(pagination.page - 1)}
          >
            {MISSING_LYRICS_MESSAGES.PREVIOUS}
          </button>
          <span aria-live="polite">{pagination.label}</span>
          <button
            type="button"
            className="btn"
            disabled={!pagination.canNext}
            onClick={() => applyFilters(pagination.page + 1)}
          >
            {MISSING_LYRICS_MESSAGES.NEXT}
          </button>
        </nav>
      )}

      <div className="missing-lyrics-import">
        <div className="form-divider"><span>Batch import</span></div>
        <div className="missing-lyrics-import-row">
          <label htmlFor="missing-lyrics-import-file">
            Import file
            <input
              id="missing-lyrics-import-file"
              ref={importInputRef}
              type="file"
              accept={BULK_IMPORT_FILE_INPUT_ACCEPT}
              onChange={handleImportFile}
              disabled={importing}
            />
          </label>
          <label htmlFor="missing-lyrics-import-replace">
            <input
              id="missing-lyrics-import-replace"
              type="checkbox"
              checked={importReplace}
              onChange={(event) => setImportReplace(event.target.checked)}
              disabled={importing}
            />
            {' '}{MISSING_LYRICS_MESSAGES.REPLACE_HINT}
          </label>
          <button type="button" className="btn" onClick={handleImport} disabled={importing}>
            {importing ? 'Importing…' : MISSING_LYRICS_MESSAGES.IMPORT}
          </button>
        </div>
        <div aria-live="polite">
          {importError && (
            <div className="catalog-sync-feedback is-error" role="alert">{importError}</div>
          )}
          {importResult && (
            <div className="catalog-sync-feedback is-success" role="status">
              <p>{MISSING_LYRICS_MESSAGES.IMPORTED}</p>
              <div className="missing-lyrics-counts">
                {buildImportCountCards(importResult.counts).map((card) => (
                  <span key={card.key} className="catalog-sync-stat">
                    <span className="catalog-sync-stat-label">{card.label}</span>
                    <span className="catalog-sync-stat-value">{card.value}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {dialogRow && (
        <AddLyricsDialog
          row={dialogRow}
          onClose={() => setDialogRow(null)}
          onSaved={() => {
            setNotice(MISSING_LYRICS_MESSAGES.SAVED);
            setRefreshToken((token) => token + 1);
          }}
        />
      )}
    </section>
  );
}
