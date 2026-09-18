import { useState } from 'react';
import { api } from '../../api/client.js';

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

        const token = localStorage.getItem('melodify_token');
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
        onError(data.error || 'Failed to create karaoke track');
      }
    } catch (err) {
      onError('Network error: ' + err.message);
    }
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" className={`btn ${mode === 'youtube' ? '' : 'btn-danger'}`} onClick={() => setMode('youtube')} style={{ background: mode === 'youtube' ? '#00b4d8' : '#2a2a2a' }}>
          YouTube ID
        </button>
        <button type="button" className={`btn ${mode === 'upload' ? '' : 'btn-danger'}`} onClick={() => setMode('upload')} style={{ background: mode === 'upload' ? '#00b4d8' : '#2a2a2a' }}>
          Upload Audio File
        </button>
      </div>

      <div className="form-group">
        <label>Title *</label>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title" required />
      </div>
      <div className="form-group">
        <label>Artist *</label>
        <input type="text" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist name" required />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="form-group">
          <label>Genre</label>
          <select value={genre} onChange={(e) => setGenre(e.target.value)}>
            {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Duration</label>
          <input type="text" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="3:00" />
        </div>
      </div>

      {mode === 'youtube' ? (
        <>
          <div className="form-group">
            <label>YouTube Video ID</label>
            <input type="text" value={youtubeId} onChange={(e) => setYoutubeId(e.target.value)} placeholder="e.g. dQw4w9WgXcQ" />
          </div>
          <div className="form-group">
            <label>Poster URL (optional)</label>
            <input type="text" value={posterUrl} onChange={(e) => setPosterUrl(e.target.value)} placeholder="Auto-generated from YouTube ID if empty" />
          </div>
        </>
      ) : (
        <>
          <div className="form-group">
            <label>Audio File (MP3, WAV, WebM, M4A) *</label>
            <input type="file" accept=".mp3,.wav,.webm,.m4a,.ogg" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} />
          </div>
          <div className="form-group">
            <label>Poster Image (optional)</label>
            <input type="file" accept=".jpg,.jpeg,.png" onChange={(e) => setPosterFile(e.target.files?.[0] || null)} />
          </div>
        </>
      )}

      <button type="submit" className="btn" disabled={submitting} style={{ marginTop: 8 }}>
        {submitting ? 'Adding...' : 'Add Karaoke Track'}
      </button>
    </form>
  );
}
