import { useEffect, useRef, useState } from 'react';
import AppDialog from '../../components/ui/AppDialog.jsx';
import {
  ADMIN_MISSING_LYRICS_MESSAGES,
  MAX_LYRICS_TEXT_LENGTH,
  detectLyricsFormat,
  saveVerifiedLyrics,
  validateLyricsFileSelection,
} from '../../services/adminMissingLyrics.js';
import {
  ADD_LYRICS_FIELD_IDS,
  LYRICS_FILE_INPUT_ACCEPT,
  MISSING_LYRICS_MESSAGES,
  selectAddLyricsInitialValues,
  validateAddLyricsDraft,
} from './missingLyricsUi.js';

export default function AddLyricsDialog({ row, onClose, onSaved }) {
  const initial = selectAddLyricsInitialValues(row);
  const [language, setLanguage] = useState(initial.language);
  const [sourceUrl, setSourceUrl] = useState(initial.sourceUrl);
  const [sourceProvider, setSourceProvider] = useState(initial.sourceProvider);
  const [notes, setNotes] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [format, setFormat] = useState('plain');
  const [replaceVerified, setReplaceVerified] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    setLanguage(initial.language);
    setSourceUrl(initial.sourceUrl);
    setSourceProvider(initial.sourceProvider);
    setNotes('');
    setLyrics('');
    setFormat('plain');
    setReplaceVerified(false);
    setError('');
  }, [initial.songId, initial.language, initial.sourceUrl, initial.sourceProvider]);

  const handleLyricsChange = (event) => {
    const value = event.target.value;
    setLyrics(value);
    setFormat(detectLyricsFormat(value));
  };

  const handleFilePick = async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const check = validateLyricsFileSelection({ name: file.name, size: file.size, type: file.type });
    if (!check.ok) {
      setError(check.error);
      return;
    }
    try {
      const text = await file.text();
      setLyrics(text);
      setFormat(detectLyricsFormat(text));
      setError('');
    } catch {
      setError(ADMIN_MISSING_LYRICS_MESSAGES.PASTE_FAILED);
    }
  };

  const handleSave = async () => {
    if (inFlightRef.current) return;
    const validated = validateAddLyricsDraft({ lyrics, format });
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    if (initial.hasVerifiedLyrics && !replaceVerified) {
      setError('Verified lyrics already exist. Confirm Replace verified lyrics to overwrite.');
      return;
    }

    inFlightRef.current = true;
    setSaving(true);
    setError('');
    try {
      const body = {
        lyrics: validated.text,
        format: validated.format,
        language: language.trim(),
        sourceUrl: sourceUrl.trim(),
        sourceProvider: sourceProvider.trim(),
        notes: notes.trim(),
        replaceVerified,
      };
      const result = await saveVerifiedLyrics(initial.songId, body);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (onSaved) onSaved(result.data);
      if (onClose) onClose();
    } finally {
      inFlightRef.current = false;
      setSaving(false);
    }
  };

  if (!initial.songId) return null;

  const formatLabel = format === 'lrc' ? 'Synced (LRC)' : 'Plain text';

  return (
    <AppDialog
      open
      title={`Add lyrics — ${initial.title || 'Song'}`}
      onClose={saving ? () => {} : onClose}
      width="720px"
      labelledBy="add-lyrics-title"
      actions={(
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            {MISSING_LYRICS_MESSAGES.CANCEL}
          </button>
          <button type="button" className="btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : MISSING_LYRICS_MESSAGES.SAVE}
          </button>
        </>
      )}
    >
      <div className="add-lyrics-grid">
        <div className="form-group">
          <label htmlFor={ADD_LYRICS_FIELD_IDS.title}>Song</label>
          <input id={ADD_LYRICS_FIELD_IDS.title} type="text" value={initial.title} readOnly />
        </div>
        <div className="form-group">
          <label htmlFor={ADD_LYRICS_FIELD_IDS.artist}>Artist</label>
          <input id={ADD_LYRICS_FIELD_IDS.artist} type="text" value={initial.artist} readOnly />
        </div>
        <div className="form-group">
          <label htmlFor={ADD_LYRICS_FIELD_IDS.language}>Language</label>
          <input
            id={ADD_LYRICS_FIELD_IDS.language}
            type="text"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            maxLength={64}
            placeholder="hindi, bn-bd, english"
            disabled={saving}
          />
        </div>
        <div className="form-group">
          <label htmlFor={ADD_LYRICS_FIELD_IDS.format}>Synced-Plain</label>
          <input id={ADD_LYRICS_FIELD_IDS.format} type="text" value={formatLabel} readOnly />
        </div>
        <div className="form-group">
          <label htmlFor={ADD_LYRICS_FIELD_IDS.sourceUrl}>Source URL</label>
          <input
            id={ADD_LYRICS_FIELD_IDS.sourceUrl}
            type="url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            maxLength={1024}
            placeholder="https://"
            disabled={saving}
          />
        </div>
        <div className="form-group">
          <label htmlFor={ADD_LYRICS_FIELD_IDS.sourceProvider}>Source provider</label>
          <input
            id={ADD_LYRICS_FIELD_IDS.sourceProvider}
            type="text"
            value={sourceProvider}
            onChange={(event) => setSourceProvider(event.target.value)}
            maxLength={256}
            placeholder="lrclib, admin, manual"
            disabled={saving}
          />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor={ADD_LYRICS_FIELD_IDS.lyrics}>Lyrics text</label>
        <textarea
          id={ADD_LYRICS_FIELD_IDS.lyrics}
          className="add-lyrics-textarea"
          value={lyrics}
          onChange={handleLyricsChange}
          rows={12}
          spellCheck={false}
          placeholder="Paste plain lyrics, or LRC lines like [00:12.40]First line"
          disabled={saving}
          aria-describedby={`${ADD_LYRICS_FIELD_IDS.lyrics}-hint`}
        />
        <small id={`${ADD_LYRICS_FIELD_IDS.lyrics}-hint`} className="catalog-sync-hint">
          Paste plain text or LRC, or choose a .txt / .lrc file. Maximum {MAX_LYRICS_TEXT_LENGTH} characters.
        </small>
      </div>

      <div className="add-lyrics-file-row">
        <label htmlFor={ADD_LYRICS_FIELD_IDS.file}>
          Paste from file
          <input
            id={ADD_LYRICS_FIELD_IDS.file}
            ref={fileInputRef}
            type="file"
            accept={LYRICS_FILE_INPUT_ACCEPT}
            onChange={handleFilePick}
            disabled={saving}
          />
        </label>
        {initial.candidateUrl && (
          <a
            className="btn"
            href={initial.candidateUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {MISSING_LYRICS_MESSAGES.OPEN_SOURCE}
          </a>
        )}
      </div>

      <div className="form-group">
        <label htmlFor={ADD_LYRICS_FIELD_IDS.notes}>Notes</label>
        <textarea
          id={ADD_LYRICS_FIELD_IDS.notes}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          maxLength={1000}
          disabled={saving}
        />
      </div>

      {initial.hasVerifiedLyrics && (
        <div className="add-lyrics-replace">
          <label htmlFor={ADD_LYRICS_FIELD_IDS.replace}>
            <input
              id={ADD_LYRICS_FIELD_IDS.replace}
              type="checkbox"
              checked={replaceVerified}
              onChange={(event) => setReplaceVerified(event.target.checked)}
              disabled={saving}
            />
            {' '}
            {MISSING_LYRICS_MESSAGES.REPLACE_HINT}
          </label>
        </div>
      )}

      <div aria-live="polite">
        {error && (
          <div className="catalog-sync-feedback is-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </AppDialog>
  );
}
