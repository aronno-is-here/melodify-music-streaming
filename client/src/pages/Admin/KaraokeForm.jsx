import { useState } from 'react';
import { api } from '../../api/client.js';
import { getActiveAuthToken } from '../../auth/authToken.js';
import { ADMIN_KARAOKE_MESSAGES } from './adminContentWorkspacesUi.js';

const GENRES = ['Pop', 'Rock', 'Bengali', 'Hindi', 'Romantic', 'Metal', 'Melodious', 'Love', 'Happy', 'Bollywood', 'Classical', 'Jazz', 'R&B'];

export default function KaraokeForm({ onSuccess, onError }) {
  const [mode, setMode] = useState('youtube');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [genre, setGenre] = useState('Pop');
  const [duration, setDuration] = useState('3:00');
  const [youtubeId, setYoutubeId] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [audioFile, setAudioFile] = useState(null);
  const [posterFile, setPosterFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !artist.trim()) {
      onError('Title and artist are required');
      return;
    }
    if (mode === 'upload' && !audioFile) {
      onError('Audio file is required for upload mode');
      return;
    }

    setSubmitting(true);
    try {
      let data;
      if (mode === 'youtube') {
        data = await api.post('/api/karaoke', {
          title: title.trim(),
          artist: artist.trim(),
          genre,
          duration,
          youtube_id: youtubeId,
          poster_url: posterUrl || (youtubeId ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` : ''),
        });
      } else {
        const formData = new FormData();
        formData.append('title', title.trim());
        formData.append('artist', artist.trim());
        formData.append('genre', genre);
        formData.append('duration', duration);
        formData.append('audio_file', audioFile);
        if (posterFile) formData.append('poster_file', posterFile);

        const token = getActiveAuthToken();
        const res = await fetch('/api/karaoke/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        data = await res.json();
      }

      if (data.success) {
        onSuccess(data.karaoke);
        setTitle('');
        setArtist('');
        setYoutubeId('');
        setPosterUrl('');
        setAudioFile(null);
        setPosterFile(null);
      } else {
        onError(data.error || ADMIN_KARAOKE_MESSAGES.ADD_FAILED);
      }
    } catch {
      onError(ADMIN_KARAOKE_MESSAGES.UPLOAD_FAILED);
    }
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="admin-form karaoke-form">
      <fieldset className="admin-form-section">
        <legend>Track information</legend>
        <div className="form-group">
          <label htmlFor="karaoke-title">Title *</label>
          <input id="karaoke-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title" required />
        </div>
        <div className="form-group">
          <label htmlFor="karaoke-artist">Artist *</label>
          <input id="karaoke-artist" type="text" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist name" required />
        </div>
        <div className="admin-form-grid">
          <div className="form-group">
            <label htmlFor="karaoke-genre">Genre</label>
            <select id="karaoke-genre" value={genre} onChange={(e) => setGenre(e.target.value)}>
              {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="karaoke-duration">Duration</label>
            <input id="karaoke-duration" type="text" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="3:00" />
          </div>
        </div>
      </fieldset>

      <fieldset className="admin-form-section">
        <legend>Source</legend>
        <div className="karaoke-source-toggle" role="group" aria-label="Karaoke source">
          <button
            type="button"
            className={`karaoke-source-option${mode === 'youtube' ? ' is-active' : ''}`}
            aria-pressed={mode === 'youtube'}
            onClick={() => setMode('youtube')}
          >
            YouTube ID
          </button>
          <button
            type="button"
            className={`karaoke-source-option${mode === 'upload' ? ' is-active' : ''}`}
            aria-pressed={mode === 'upload'}
            onClick={() => setMode('upload')}
          >
            Upload Audio File
          </button>
        </div>

        {mode === 'youtube' ? (
          <>
            <div className="form-group">
              <label htmlFor="karaoke-youtube-id">YouTube Video ID</label>
              <input id="karaoke-youtube-id" type="text" value={youtubeId} onChange={(e) => setYoutubeId(e.target.value)} placeholder="e.g. dQw4w9WgXcQ" />
            </div>
            <div className="form-group">
              <label htmlFor="karaoke-poster-url">Poster URL (optional)</label>
              <input id="karaoke-poster-url" type="text" value={posterUrl} onChange={(e) => setPosterUrl(e.target.value)} placeholder="Auto-generated from YouTube ID if empty" />
            </div>
          </>
        ) : (
          <>
            <div className="form-group">
              <label htmlFor="karaoke-audio-file">Audio File (MP3, WAV, WebM, M4A) *</label>
              <input id="karaoke-audio-file" type="file" accept=".mp3,.wav,.webm,.m4a,.ogg" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} />
            </div>
            <div className="form-group">
              <label htmlFor="karaoke-poster-file">Poster Image (optional)</label>
              <input id="karaoke-poster-file" type="file" accept=".jpg,.jpeg,.png" onChange={(e) => setPosterFile(e.target.files?.[0] || null)} />
            </div>
          </>
        )}
      </fieldset>

      <button type="submit" className="btn btn-primary karaoke-form-submit" disabled={submitting}>
        {submitting ? 'Adding...' : 'Add Karaoke Track'}
      </button>
    </form>
  );
}
