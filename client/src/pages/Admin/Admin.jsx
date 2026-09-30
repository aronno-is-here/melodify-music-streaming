import { useEffect, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import cssRaw from './Admin.css?raw';
import KaraokeForm from './KaraokeForm.jsx';
import CatalogSyncPanel from './CatalogSyncPanel.jsx';
import MissingLyricsQueue from './MissingLyricsQueue.jsx';
import AdminAIRecommendation from './AdminAIRecommendation.jsx';
import {
  CHORD_FORMATS,
  CHORD_IMPORT_EXTENSIONS,
  readChordImportFile,
} from '../../utils/chordSheet.js';
import {
  CHORD_EDITOR_STATES,
  CHORD_EDITOR_STATE_LABELS,
  buildChordPreview,
  evaluateChordDraftSave,
  hasChordContent,
  selectChordListStatus,
} from './chordEditorUi.js';

const SECTIONS = ['dashboard', 'users', 'music', 'missing-lyrics', 'karaoke', 'moderation', 'subscriptions', 'ai-recommendation'];

const EXISTING_SECTIONS = new Set(['dashboard', 'users', 'music', 'missing-lyrics', 'karaoke', 'moderation', 'subscriptions']);

const sectionLabel = (s) => {
  if (s === 'ai-recommendation') return 'AI Recommendation';
  if (s === 'missing-lyrics') return 'Missing Lyrics';
  if (s === 'karaoke') return 'Melodify Studio';
  return s.charAt(0).toUpperCase() + s.slice(1).replace('moderation', ' Content Moderation');
};

const LYRICS_SOURCE_OPTIONS = ['db_verified', 'lrclib', 'legacy_unverified', 'none'];
const CHORDS_SOURCE_OPTIONS = ['db_verified', 'chordify', 'other', 'none'];
const LYRICS_MATCH_STATUS_OPTIONS = ['EXACT', 'HIGH', 'AMBIGUOUS', 'NONE'];

const toText = (value) => (typeof value === 'string' ? value : '');
const toTrimmedText = (value) => toText(value).trim();

const formatDateTimeLocal = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const toCapoDraft = (value) => (value === null || value === undefined || value === '' ? '' : String(value));

const toTimelineDraft = (value) => {
  if (!Array.isArray(value) || value.length === 0) return '';
  return JSON.stringify(value, null, 2);
};

const parseTimelineDraft = (value) => {
  const trimmed = toText(value).trim();
  if (!trimmed) return { ok: true, value: [] };
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return { ok: false, value: null };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, value: null };
  }
};

const toCapoPayload = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : null;
};

export default function Admin() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'Admin');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [section, setSection] = useState(() => {
    if (location.pathname === '/admin/ai-recommendation') return 'ai-recommendation';
    if (
      location.state &&
      typeof location.state.section === 'string' &&
      EXISTING_SECTIONS.has(location.state.section)
    ) {
      return location.state.section;
    }
    return 'dashboard';
  });

  const handleSectionClick = (s) => {
    if (s === 'ai-recommendation') {
      setSection('ai-recommendation');
      navigate('/admin/ai-recommendation');
      return;
    }
    if (location.pathname === '/admin/ai-recommendation') {
      navigate('/admin', { state: { section: s } });
      setSection(s);
      return;
    }
    setSection(s);
  };

  useEffect(() => {
    if (location.pathname === '/admin/ai-recommendation') {
      setSection('ai-recommendation');
    }
  }, [location.pathname]);

  const [stats, setStats] = useState({ users: 0, songs: 0, plays: 0, revenue: 0, activeSubs: 0, pendingReports: 0, recentPlays: [], monthlyRevenue: 0, lastMonthRevenue: 0, monthlySubs: 0, totalSubs: 0, revenueByPlan: {} });
  const [users, setUsers] = useState([]);
  const [songs, setSongs] = useState([]);
  const [reports, setReports] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [karaokeTracks, setKaraokeTracks] = useState([]);
  const [message, setMessage] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [editingSong, setEditingSong] = useState(null);
  const [sourceUrlDraft, setSourceUrlDraft] = useState('');
  const [lyricsSources, setLyricsSources] = useState({ status: 'idle', candidates: [] });
  const [chordTimelineDraft, setChordTimelineDraft] = useState('');
  const [chordNotice, setChordNotice] = useState(null);
  const [chordWorkflow, setChordWorkflow] = useState(CHORD_EDITOR_STATES.EMPTY);
  const [chordPreview, setChordPreview] = useState(null);
  const [chordSaving, setChordSaving] = useState(false);
  const [chordReplaceArmed, setChordReplaceArmed] = useState(false);
  const [chordHasExisting, setChordHasExisting] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    const [s, u, sg, r, sub, kar] = await Promise.all([
      api.get('/api/admin/stats'),
      api.get('/api/admin/users'),
      api.get('/api/songs?limit=100'),
      api.get('/api/admin/reports'),
      api.get('/api/admin/subscriptions'),
      api.get('/api/karaoke/all'),
    ]);
    if (s.success) setStats(s.stats);
    if (u.success) setUsers(u.users);
    if (sg.success) setSongs(sg.songs);
    if (r.success) setReports(r.reports);
    if (sub.success) setSubscriptions(sub.subscriptions);
    if (kar.success) setKaraokeTracks(kar.karaoke);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    loadAll();
    const interval = setInterval(() => loadAll(true), 30000);
    return () => clearInterval(interval);
  }, []);

  const showMessage = (msg, isError = false) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  const openSongEditor = (song) => {
    setEditingSong(song);
    setSourceUrlDraft(typeof song.lyrics_source_url === 'string' ? song.lyrics_source_url : '');
    setLyricsSources({ status: 'idle', candidates: [] });
    setChordTimelineDraft(toTimelineDraft(song.chord_timeline));
    setChordHasExisting(hasChordContent(song));
    setChordWorkflow(CHORD_EDITOR_STATES.EMPTY);
    setChordPreview(null);
    setChordReplaceArmed(false);
    setChordNotice(null);
  };

  const manageSongChords = (song) => {
    openSongEditor(song);
    window.setTimeout(() => {
      const chordEditor = document.getElementById('song-chords-editor');
      if (chordEditor && typeof chordEditor.scrollIntoView === 'function') {
        chordEditor.scrollIntoView({ block: 'start' });
      }
    }, 0);
  };

  const loadLyricsSources = async (refresh = false) => {
    if (!editingSong?._id) return;
    setLyricsSources({ status: 'loading', candidates: [] });
    const data = await api.get(
      `/api/lyrics/${editingSong._id}/sources${refresh ? '?refresh=1' : ''}`,
    );
    if (data.success) {
      setLyricsSources({
        status: 'ready',
        candidates: Array.isArray(data.candidates) ? data.candidates : [],
      });
    } else {
      setLyricsSources({ status: 'error', candidates: [] });
      showMessage(data.error || 'Failed to load suggested sources', true);
    }
  };

  useEffect(() => {
    const editId = location.state && typeof location.state.editSongId === 'string'
      ? location.state.editSongId
      : null;
    if (!editId || songs.length === 0) return;
    const target = songs.find((song) => song._id === editId);
    if (!target) return;
    openSongEditor(target);
    navigate('/admin', { replace: true, state: { section: 'music' } });
  }, [location.state, songs]);

  const deleteUser = async (id) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    const data = await api.del(`/api/admin/users/${id}`);
    if (data.success) {
      showMessage('User deleted');
      setUsers((prev) => prev.filter((u) => u._id !== id));
    } else {
      showMessage(data.error || 'Failed to delete user', true);
    }
  };

  const updateUserRole = async (id, role) => {
    const data = await api.put(`/api/admin/users/${id}`, { role });
    if (data.success) {
      showMessage('User updated');
      setUsers((prev) => prev.map((u) => (u._id === id ? { ...u, role } : u)));
      setEditingUser(null);
    } else {
      showMessage(data.error || 'Failed to update user', true);
    }
  };

  const deleteSong = async (id) => {
    if (!confirm('Are you sure you want to delete this song?')) return;
    const data = await api.del(`/api/songs/${id}`);
    if (data.success) {
      showMessage('Song deleted');
      setSongs((prev) => prev.filter((s) => s._id !== id));
    } else {
      showMessage(data.error || 'Failed to delete song', true);
    }
  };

  const deleteKaraoke = async (id) => {
    if (!confirm('Are you sure you want to delete this karaoke track?')) return;
    const data = await api.del(`/api/karaoke/${id}`);
    if (data.success) {
      showMessage('Karaoke track deleted');
      setKaraokeTracks((prev) => prev.filter((k) => k._id !== id));
    } else {
      showMessage(data.error || 'Failed to delete karaoke track', true);
    }
  };

  const updateSong = async (id, updates, options = {}) => {
    const closeEditor = options.closeEditor !== false;
    const showSuccess = options.showSuccess !== false;
    const data = await api.put(`/api/songs/${id}`, updates);
    if (data.success) {
      if (showSuccess) showMessage('Song updated');
      setSongs((prev) => prev.map((s) => (s._id === id ? data.song : s)));
      if (closeEditor) setEditingSong(null);
      return data.song;
    } else {
      showMessage(data.error || 'Failed to update song', true);
      return null;
    }
  };

  const updateSongContent = async (id, updates) => {
    const data = await api.put(`/api/songs/${id}/content`, updates);
    if (data.success) {
      return data.song;
    }
    showMessage(data.error || 'Failed to update song content', true);
    return null;
  };

  const patchChordDraft = (patch) => {
    setEditingSong((prev) => (prev ? { ...prev, ...patch } : prev));
    setChordReplaceArmed(false);
    setChordPreview(null);
    if (chordWorkflow === CHORD_EDITOR_STATES.PREVIEW_READY || chordWorkflow === CHORD_EDITOR_STATES.SUCCESS) {
      setChordWorkflow(CHORD_EDITOR_STATES.FILE_SELECTED);
    }
  };

  const buildChordDraftPayload = (timeline) => ({
    chords: toText(editingSong.chords),
    chords_verified: editingSong.chords_verified === true,
    chords_source: CHORDS_SOURCE_OPTIONS.includes(editingSong.chords_source) ? editingSong.chords_source : 'none',
    chords_provider_id: toText(editingSong.chords_provider_id).trim(),
    chordify_url: toText(editingSong.chordify_url).trim(),
    chordify_embed_url: toText(editingSong.chordify_embed_url).trim(),
    chords_reference_url: toText(editingSong.chords_reference_url).trim(),
    chords_last_checked_at: toText(editingSong.chords_last_checked_at),
    chords_format: CHORD_FORMATS.includes(editingSong.chords_format) ? editingSong.chords_format : 'plain',
    chords_key: toText(editingSong.chords_key).trim(),
    chords_capo: toCapoPayload(editingSong.chords_capo),
    chords_tuning: toText(editingSong.chords_tuning).trim(),
    chords_notes: toText(editingSong.chords_notes).trim(),
    chords_verified_by: toText(editingSong.chords_verified_by).trim(),
    chord_timeline: timeline,
  });

  const onChordImportChange = async (extension, event) => {
    const input = event.target;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    setChordPreview(null);
    setChordWorkflow(CHORD_EDITOR_STATES.PARSING);
    const result = await readChordImportFile(file, extension);
    if (!result.ok) {
      setChordNotice({ text: result.error, isError: true });
      setChordWorkflow(CHORD_EDITOR_STATES.ERROR);
      return;
    }
    patchChordDraft({ chords: result.text, chords_format: result.format, chords_verified: false });
    if (result.doc) {
      patchChordDraft({
        ...(result.doc.verifiedProvided ? { chords_verified: result.doc.verified } : {}),
        chords_key: result.doc.key || '',
        chords_capo: result.doc.capo === undefined ? null : result.doc.capo,
        chords_tuning: result.doc.tuning,
        chords_notes: result.doc.notes,
        chords_verified_by: result.doc.verifiedBy,
        ...(result.doc.source ? { chords_source: result.doc.source } : {}),
        ...(result.doc.sourceUrl ? { chords_reference_url: result.doc.sourceUrl } : {}),
      });
      setChordTimelineDraft(toTimelineDraft(result.doc.timeline));
    }
    const timelineText = result.doc ? toTimelineDraft(result.doc.timeline) : chordTimelineDraft;
    const evaluation = evaluateChordDraftSave({ text: result.text, format: result.format, timelineText });
    if (evaluation.ok) {
      setChordPreview(buildChordPreview({ text: result.text, timeline: evaluation.timeline }));
      setChordWorkflow(CHORD_EDITOR_STATES.PREVIEW_READY);
      setChordNotice({ text: `${file.name} imported as ${result.format}. Preview it below, then press Save Chords.`, isError: false });
    } else {
      setChordWorkflow(CHORD_EDITOR_STATES.ERROR);
      setChordNotice({ text: evaluation.error, isError: true });
    }
  };

  const clearChordDraft = () => {
    patchChordDraft({
      chords: '',
      chords_format: 'plain',
      chords_key: '',
      chords_capo: null,
      chords_tuning: '',
      chords_notes: '',
      chords_verified_by: '',
      chords_verified: false,
      chord_timeline: null,
    });
    setChordTimelineDraft('');
    setChordPreview(null);
    setChordWorkflow(CHORD_EDITOR_STATES.EMPTY);
    setChordNotice({ text: 'Chords cleared. Save to keep the change.', isError: false });
  };

  const previewChords = () => {
    if (!editingSong?._id) return;
    const evaluation = evaluateChordDraftSave({
      text: toText(editingSong.chords),
      format: editingSong.chords_format,
      timelineText: chordTimelineDraft,
    });
    if (!evaluation.ok) {
      setChordPreview(null);
      setChordWorkflow(CHORD_EDITOR_STATES.ERROR);
      setChordNotice({ text: evaluation.error, isError: true });
      return;
    }
    setChordPreview(buildChordPreview({ text: toText(editingSong.chords), timeline: evaluation.timeline }));
    setChordWorkflow(CHORD_EDITOR_STATES.PREVIEW_READY);
    setChordNotice(null);
  };

  const saveChordsOnly = async () => {
    if (!editingSong?._id || chordSaving) return;
    const evaluation = evaluateChordDraftSave({
      text: toText(editingSong.chords),
      format: editingSong.chords_format,
      timelineText: chordTimelineDraft,
    });
    if (!evaluation.ok) {
      setChordNotice({ text: evaluation.error, isError: true });
      setChordWorkflow(CHORD_EDITOR_STATES.ERROR);
      return;
    }
    if (chordHasExisting && !chordReplaceArmed) {
      setChordReplaceArmed(true);
      setChordNotice({ text: 'Existing chords will be replaced. Press Save Chords again to confirm.', isError: false });
      return;
    }
    setChordSaving(true);
    setChordWorkflow(CHORD_EDITOR_STATES.SAVING);
    try {
      const song = await updateSongContent(editingSong._id, buildChordDraftPayload(evaluation.timeline));
      if (!song) {
        setChordWorkflow(CHORD_EDITOR_STATES.ERROR);
        return;
      }
      setSongs((prev) => prev.map((item) => (item._id === song._id ? song : item)));
      setEditingSong(song);
      setChordHasExisting(hasChordContent(song));
      setChordReplaceArmed(false);
      setChordPreview(buildChordPreview({ text: toText(song.chords), timeline: song.chord_timeline }));
      setChordWorkflow(CHORD_EDITOR_STATES.SUCCESS);
      setChordNotice({ text: 'Chords saved.', isError: false });
    } finally {
      setChordSaving(false);
    }
  };

  const saveSongEdits = async (event) => {
    event.preventDefault();
    if (!editingSong?._id) return;

    const timelineDraft = parseTimelineDraft(chordTimelineDraft);
    if (!timelineDraft.ok) {
      setChordNotice({ text: 'Chord timeline must be a JSON array.', isError: true });
      return;
    }

    const formData = new FormData(event.target);
    const metadataPayload = {
      title: toTrimmedText(formData.get('title')),
      artist: toTrimmedText(formData.get('artist')),
      genre: toTrimmedText(formData.get('genre')),
      duration: toTrimmedText(formData.get('duration')),
    };

    const contentPayload = {
      lyrics: toText(formData.get('lyrics')),
      lyrics_verified: formData.get('lyrics_verified') === 'on',
      lyrics_source: toTrimmedText(formData.get('lyrics_source')) || 'none',
      lyrics_source_url: sourceUrlDraft.trim(),
      lyrics_notes: toTrimmedText(formData.get('lyrics_notes')),
      lyrics_provider_id: toTrimmedText(formData.get('lyrics_provider_id')),
      lyrics_language: toTrimmedText(formData.get('lyrics_language')),
      lyrics_match_status: toTrimmedText(formData.get('lyrics_match_status')) || 'NONE',
      lyrics_last_checked_at: toText(formData.get('lyrics_last_checked_at')),
      ...buildChordDraftPayload(timelineDraft.value),
    };

    const metadataSong = await updateSong(editingSong._id, metadataPayload, { closeEditor: false, showSuccess: false });
    if (!metadataSong) return;

    const contentSong = await updateSongContent(editingSong._id, contentPayload);
    if (!contentSong) {
      setEditingSong({ ...editingSong, ...metadataSong });
      return;
    }

    showMessage('Song updated');
    setChordNotice(null);
    setSongs((prev) => prev.map((song) => (song._id === editingSong._id ? contentSong : song)));
    setEditingSong(null);
  };

  const resolveReport = async (id, status) => {
    const data = await api.put(`/api/admin/reports/${id}`, { status });
    if (data.success) {
      showMessage(`Report ${status}`);
      setReports((prev) => prev.map((r) => (r._id === id ? { ...r, status } : r)));
    } else {
      showMessage(data.error || 'Failed to update report', true);
    }
  };

  const deleteReport = async (id) => {
    if (!confirm('Delete this report?')) return;
    const data = await api.del(`/api/admin/reports/${id}`);
    if (data.success) {
      showMessage('Report deleted');
      setReports((prev) => prev.filter((r) => r._id !== id));
    } else {
      showMessage(data.error || 'Failed to delete report', true);
    }
  };

  const updateSubscription = async (id, status) => {
    const data = await api.put(`/api/admin/subscriptions/${id}`, { status });
    if (data.success) {
      showMessage('Subscription updated');
      setSubscriptions((prev) => prev.map((s) => (s._id === id ? { ...s, status } : s)));
    } else {
      showMessage(data.error || 'Failed to update subscription', true);
    }
  };

  const addSong = async (e) => {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const hasYouTubeId = formData.get('youtube_id')?.trim();
    const hasSongFile = formData.get('song_file')?.size > 0;

    if (!hasYouTubeId && !hasSongFile) {
      showMessage('Please provide either a YouTube ID or upload a song file', true);
      return;
    }

    if (hasYouTubeId) {
      const body = {
        title: formData.get('title'),
        artist: formData.get('artist'),
        genre: formData.get('genre'),
        duration: formData.get('duration') || '3:00',
        youtube_id: hasYouTubeId,
        release_date: formData.get('release_date') || undefined,
        poster_url: formData.get('poster_url')?.trim() || undefined,
      };
      const data = await api.post('/api/songs', body);
      if (data.success) {
        showMessage('Song added successfully!');
        form.reset();
        loadAll();
      } else {
        showMessage(data.error || 'Failed to add song', true);
      }
    } else {
      const data = await api.post('/api/songs/upload', formData);
      if (data.success) {
        showMessage('Song uploaded successfully!');
        form.reset();
        loadAll();
      } else {
        showMessage(data.error || 'Failed to upload song', true);
      }
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = userSearch.toLowerCase();
    return u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
  });

  const chordDraftEvaluation = editingSong
    ? evaluateChordDraftSave({
      text: toText(editingSong.chords),
      format: editingSong.chords_format,
      timelineText: chordTimelineDraft,
    })
    : { ok: false };
  const chordSaveDisabled = !editingSong?._id
    || chordSaving
    || chordWorkflow === CHORD_EDITOR_STATES.PARSING
    || !chordDraftEvaluation.ok;

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#121212', color: '#fff' }}>
        <p>Loading admin panel...</p>
      </div>
    );
  }

  return (
    <>
      <div className="header">
        <h1>Melodify Admin Panel</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#b3b3b3' }}>{user?.email}</span>
          <button className="logout-btn" onClick={() => logout()}>Logout</button>
        </div>
      </div>
      <div className="main">
        <nav className="sidebar">
          <h3>Navigation</h3>
          <ul>
            {SECTIONS.map((s) => (
              <li key={s}>
                <a className={section === s ? 'active' : ''} onClick={() => handleSectionClick(s)}>
                  {sectionLabel(s)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main className="content">
          {message && <div className={`message ${message.includes('success') || message.includes('updated') || message.includes('deleted') ? 'success' : 'error'}`}>{message}</div>}

          {section === 'dashboard' && (
            <div id="dashboard" className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                <h2>Dashboard</h2>
                <button className="btn" onClick={() => loadAll(true)} disabled={refreshing}>
                  {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 15 }}>
                <div className="card stat-card"><h3>Users</h3><p className="stat-value">{stats.users}</p></div>
                <div className="card stat-card"><h3>Songs</h3><p className="stat-value">{stats.songs || songs.length}</p></div>
                <div className="card stat-card"><h3>Plays</h3><p className="stat-value">{stats.plays}</p></div>
                <div className="card stat-card"><h3>Active Subs</h3><p className="stat-value">{stats.activeSubs}</p></div>
                <div className="card stat-card"><h3>Pending Reports</h3><p className="stat-value">{stats.pendingReports}</p></div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 15, marginTop: 20 }}>
                <div className="card stat-card" style={{ borderLeft: '3px solid #4caf50' }}>
                  <h3>Total Revenue</h3>
                  <p className="stat-value" style={{ color: '#4caf50' }}>${stats.revenue}</p>
                  <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{stats.totalSubs || 0} total subscriptions</p>
                </div>
                <div className="card stat-card" style={{ borderLeft: '3px solid #00b4d8' }}>
                  <h3>This Month</h3>
                  <p className="stat-value" style={{ color: '#00b4d8' }}>${stats.monthlyRevenue}</p>
                  <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{stats.monthlySubs || 0} new subs</p>
                </div>
                <div className="card stat-card" style={{ borderLeft: '3px solid #888' }}>
                  <h3>Last Month</h3>
                  <p className="stat-value">${stats.lastMonthRevenue}</p>
                  <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                    {stats.monthlyRevenue > stats.lastMonthRevenue ? (
                      <span style={{ color: '#4caf50' }}>+{stats.lastMonthRevenue > 0 ? Math.round(((stats.monthlyRevenue - stats.lastMonthRevenue) / stats.lastMonthRevenue) * 100) : 100}% vs last month</span>
                    ) : stats.monthlyRevenue < stats.lastMonthRevenue ? (
                      <span style={{ color: '#ff6b6b' }}>-{stats.lastMonthRevenue > 0 ? Math.round(((stats.lastMonthRevenue - stats.monthlyRevenue) / stats.lastMonthRevenue) * 100) : 100}% vs last month</span>
                    ) : (
                      <span>Same as last month</span>
                    )}
                  </p>
                </div>
              </div>

              {Object.keys(stats.revenueByPlan || {}).length > 0 && (
                <div style={{ marginTop: 15 }}>
                  <h3 style={{ color: 'var(--sky-blue)', marginBottom: 10 }}>Revenue by Plan</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                    {Object.entries(stats.revenueByPlan).map(([plan, data]) => (
                      <div key={plan} className="card" style={{ padding: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{plan}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#00b4d8' }}>${data.revenue}</div>
                        <div style={{ fontSize: 11, color: '#888' }}>{data.subs} active subscriber{data.subs !== 1 ? 's' : ''}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {stats.recentPlays && stats.recentPlays.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <h3 style={{ color: 'var(--sky-blue)', marginBottom: 10 }}>Recent Plays</h3>
                  <table>
                    <thead>
                      <tr><th>User</th><th>Song</th><th>When</th></tr>
                    </thead>
                    <tbody>
                      {stats.recentPlays.map((play, i) => (
                        <tr key={i}>
                          <td>{play.user?.name || play.user?.email || 'Unknown'}</td>
                          <td>{play.song?.title || 'Unknown'} - {play.song?.artist || ''}</td>
                          <td>{play.playedAt ? new Date(play.playedAt).toLocaleString() : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {section === 'users' && (
            <div id="users" className="card">
              <h2>User Management</h2>
              <input
                type="text"
                placeholder="Search users..."
                style={{ width: '100%', padding: 10, marginBottom: 10, background: 'var(--accent-black, #000)', border: '1px solid var(--gray, #333)', color: 'var(--white, #fff)', borderRadius: 4 }}
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
              />
              <table>
                <thead>
                  <tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => (
                    <tr key={u._id}>
                      <td>{u._id.slice(-6)}</td>
                      <td>{u.name}</td>
                      <td>{u.email}</td>
                      <td>
                        {editingUser === u._id ? (
                          <select value={u.role} onChange={(e) => updateUserRole(u._id, e.target.value)}>
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                          </select>
                        ) : u.role}
                      </td>
                      <td>
                        <button className="btn" onClick={() => setEditingUser(u._id)}>Edit</button>
                        <button className="btn btn-danger" onClick={() => deleteUser(u._id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {section === 'music' && (
            <div id="music" className="card">
              <h2>Music Catalog</h2>
              <form onSubmit={addSong} style={{ marginBottom: 20 }}>
                <div className="form-group"><label>Title *</label><input type="text" name="title" required /></div>
                <div className="form-group"><label>Artist *</label><input type="text" name="artist" required /></div>
                <div className="form-group">
                  <label>Genre *</label>
                  <select name="genre" required>
                    <option value="">Select genre</option>
                    <option value="Pop">Pop</option>
                    <option value="Rock">Rock</option>
                    <option value="Bengali">Bengali</option>
                    <option value="Hindi">Hindi</option>
                    <option value="Romantic">Romantic</option>
                    <option value="Metal">Metal</option>
                    <option value="Melodious">Melodious</option>
                    <option value="Love">Love</option>
                    <option value="Happy">Happy</option>
                  </select>
                </div>
                <div className="form-group"><label>Duration</label><input type="text" name="duration" placeholder="3:45" /></div>
                <div className="form-group"><label>Release Date</label><input type="date" name="release_date" className="date-input" /></div>
                <div className="form-divider"><span>Add via YouTube</span></div>
                <div className="form-group"><label>YouTube ID</label><input type="text" name="youtube_id" placeholder="e.g. dQw4w9WgXcQ" /></div>
                <div className="form-group"><label>Poster URL (optional)</label><input type="url" name="poster_url" placeholder="https://img.youtube.com/vi/ID/hqdefault.jpg" /></div>
                <div className="form-divider"><span>— OR Upload File —</span></div>
                <div className="form-group"><label>Song File (MP3/WAV)</label><input type="file" name="song_file" accept=".mp3,.wav" /></div>
                <div className="form-group"><label>Poster Image (JPG/PNG)</label><input type="file" name="poster_file" accept=".jpg,.jpeg,.png" /></div>
                <button type="submit" className="btn">Add Song</button>
              </form>
              {editingSong && (
                <div style={{ marginBottom: 20, padding: 15, border: '1px solid #00b4d8', borderRadius: 8 }}>
                  <h3>Edit Song</h3>
                  <form onSubmit={saveSongEdits}>
                    <div className="form-group"><label>Title</label><input type="text" name="title" defaultValue={editingSong.title} required /></div>
                    <div className="form-group"><label>Artist</label><input type="text" name="artist" defaultValue={editingSong.artist} required /></div>
                    <div className="form-group"><label>Genre</label><input type="text" name="genre" defaultValue={editingSong.genre} required /></div>
                    <div className="form-group"><label>Duration</label><input type="text" name="duration" defaultValue={editingSong.duration} /></div>
                    <div className="form-divider"><span>Lyrics Verification</span></div>
                    <div className="form-group"><label>Lyrics</label><textarea name="lyrics" defaultValue={editingSong.lyrics || ''} rows={5} className="admin-multiline-input" /></div>
                    <div className="admin-verify-grid">
                      <div className="form-group"><label>Lyrics Source</label><select name="lyrics_source" defaultValue={editingSong.lyrics_source || 'none'}>{LYRICS_SOURCE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
                      <div className="form-group"><label>Match Status</label><select name="lyrics_match_status" defaultValue={editingSong.lyrics_match_status || 'NONE'}>{LYRICS_MATCH_STATUS_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
                      <div className="form-group"><label>Provider ID</label><input type="text" name="lyrics_provider_id" defaultValue={editingSong.lyrics_provider_id || ''} /></div>
                      <div className="form-group"><label>Language</label><input type="text" name="lyrics_language" defaultValue={editingSong.lyrics_language || ''} /></div>
                      <div className="form-group"><label>Last Checked</label><input type="datetime-local" name="lyrics_last_checked_at" defaultValue={formatDateTimeLocal(editingSong.lyrics_last_checked_at)} /></div>
                      <div className="form-group"><label>Source URL</label><input type="url" name="lyrics_source_url" value={sourceUrlDraft} onChange={(event) => setSourceUrlDraft(event.target.value)} placeholder="https://…" /></div>
                      <div className="form-group"><label>Notes</label><input type="text" name="lyrics_notes" defaultValue={editingSong.lyrics_notes || ''} maxLength={1000} /></div>
                    </div>
                    <label className="admin-checkbox-row"><input type="checkbox" name="lyrics_verified" defaultChecked={editingSong.lyrics_verified === true} /> Lyrics verified</label>

                    <div className="form-divider"><span>Suggested Sources</span></div>
                    <div className="admin-sources-panel">
                      {lyricsSources.status === 'idle' && (
                        <p className="admin-sources-hint">Discover source pages for this song, then paste verified lyrics above.</p>
                      )}
                      {lyricsSources.status === 'loading' && (
                        <p className="admin-sources-hint" role="status">Finding source pages…</p>
                      )}
                      {lyricsSources.status === 'error' && (
                        <p className="admin-sources-hint" role="alert">Unable to load suggested sources.</p>
                      )}
                      {lyricsSources.status === 'ready' && lyricsSources.candidates.length === 0 && (
                        <p className="admin-sources-hint">No source pages found for this song yet.</p>
                      )}
                      {lyricsSources.status === 'ready' && lyricsSources.candidates.length > 0 && (
                        <ul className="admin-source-list">
                          {lyricsSources.candidates.map((candidate) => (
                            <li key={candidate.url} className="admin-source-row">
                              <span className="admin-source-label">
                                {[candidate.providerLabel, candidate.title, candidate.artist].filter(Boolean).join(' — ')}
                              </span>
                              <a className="btn" href={candidate.url} target="_blank" rel="noopener noreferrer">Open Source</a>
                              <button type="button" className="btn" onClick={() => setSourceUrlDraft(candidate.url)}>Use URL</button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="admin-source-actions">
                        <button type="button" className="btn" onClick={() => loadLyricsSources(false)} disabled={lyricsSources.status === 'loading'}>Find Sources</button>
                        <button type="button" className="btn" onClick={() => loadLyricsSources(true)} disabled={lyricsSources.status === 'loading'}>Refresh Sources</button>
                      </div>
                    </div>

                    <div className="form-divider"><span>Chords Verification</span></div>
                    <div className="admin-chord-heading-row" id="song-chords-editor">
                      <h4 className="admin-chord-heading">Manage Chords</h4>
                      <p className="admin-chord-current">Current chord status: {selectChordListStatus(editingSong)}</p>
                    </div>
                    <div className="form-group"><label>Paste Chords</label><textarea name="chords" rows={6} className="admin-multiline-input" value={toText(editingSong.chords)} onChange={(event) => patchChordDraft({ chords: event.target.value })} /></div>
                    <div className="admin-verify-grid">
                      <div className="form-group"><label>Format</label><select name="chords_format" value={CHORD_FORMATS.includes(editingSong.chords_format) ? editingSong.chords_format : 'plain'} onChange={(event) => patchChordDraft({ chords_format: event.target.value })}>{CHORD_FORMATS.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
                      <div className="form-group"><label>Key</label><input type="text" name="chords_key" value={toText(editingSong.chords_key)} onChange={(event) => patchChordDraft({ chords_key: event.target.value })} /></div>
                      <div className="form-group"><label>Capo</label><input type="number" min="0" max="12" name="chords_capo" value={toCapoDraft(editingSong.chords_capo)} onChange={(event) => patchChordDraft({ chords_capo: event.target.value })} /></div>
                      <div className="form-group"><label>Tuning</label><input type="text" name="chords_tuning" value={toText(editingSong.chords_tuning)} onChange={(event) => patchChordDraft({ chords_tuning: event.target.value })} /></div>
                      <div className="form-group"><label>Verified By</label><input type="text" name="chords_verified_by" value={toText(editingSong.chords_verified_by)} onChange={(event) => patchChordDraft({ chords_verified_by: event.target.value })} /></div>
                      <div className="form-group"><label>Chords Source</label><select name="chords_source" value={CHORDS_SOURCE_OPTIONS.includes(editingSong.chords_source) ? editingSong.chords_source : 'none'} onChange={(event) => patchChordDraft({ chords_source: event.target.value })}>{CHORDS_SOURCE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
                      <div className="form-group"><label>Provider ID</label><input type="text" name="chords_provider_id" value={toText(editingSong.chords_provider_id)} onChange={(event) => patchChordDraft({ chords_provider_id: event.target.value })} /></div>
                      <div className="form-group"><label>Chordify URL</label><input type="url" name="chordify_url" value={toText(editingSong.chordify_url)} onChange={(event) => patchChordDraft({ chordify_url: event.target.value })} /></div>
                      <div className="form-group"><label>Chordify Embed URL</label><input type="url" name="chordify_embed_url" value={toText(editingSong.chordify_embed_url)} onChange={(event) => patchChordDraft({ chordify_embed_url: event.target.value })} /></div>
                      <div className="form-group"><label>Reference URL</label><input type="url" name="chords_reference_url" value={toText(editingSong.chords_reference_url)} onChange={(event) => patchChordDraft({ chords_reference_url: event.target.value })} /></div>
                      <div className="form-group"><label>Last Checked</label><input type="datetime-local" name="chords_last_checked_at" value={formatDateTimeLocal(editingSong.chords_last_checked_at)} onChange={(event) => patchChordDraft({ chords_last_checked_at: event.target.value })} /></div>
                    </div>
                    <div className="form-group"><label>Notes</label><textarea name="chords_notes" rows={2} className="admin-multiline-input" value={toText(editingSong.chords_notes)} onChange={(event) => patchChordDraft({ chords_notes: event.target.value })} /></div>
                    <div className="form-group"><label>Chord Timeline (JSON)</label><textarea name="chord_timeline" rows={3} className="admin-multiline-input" value={chordTimelineDraft} onChange={(event) => { setChordTimelineDraft(event.target.value); setChordReplaceArmed(false); }} placeholder='[{"time":4,"chord":"G"}]' /></div>
                    <label className="admin-checkbox-row"><input type="checkbox" name="chords_verified" checked={editingSong.chords_verified === true} onChange={(event) => patchChordDraft({ chords_verified: event.target.checked })} /> Chords verified</label>
                    {chordHasExisting ? (
                      <p className="admin-chord-notice warn" role="status">Existing chords will be replaced.</p>
                    ) : null}
                    <div className="admin-chord-actions">
                      <button type="button" className="btn" disabled={chordWorkflow === CHORD_EDITOR_STATES.PARSING || chordSaving} onClick={previewChords}>Preview</button>
                      <button type="button" className="btn" disabled={chordSaveDisabled} onClick={saveChordsOnly}>Save Chords</button>
                      <button type="button" className="btn" disabled={chordSaving} onClick={clearChordDraft}>Clear Chords</button>
                    </div>
                    <div className="admin-chord-import-group">
                      <span className="admin-chord-import-title">Import Chord File</span>
                      <span className="admin-chord-import-accepted">Accepted: {CHORD_IMPORT_EXTENSIONS.map((extension) => `.${extension}`).join(', ')}</span>
                      <div className="admin-chord-import-actions">
                        {CHORD_IMPORT_EXTENSIONS.map((extension) => (
                          <label className="btn admin-chord-import" key={extension}>
                            {`Import .${extension}`}
                            <input type="file" accept={`.${extension}`} className="admin-chord-file" onChange={(event) => onChordImportChange(extension, event)} disabled={chordSaving} />
                          </label>
                        ))}
                      </div>
                    </div>
                    <p className="admin-chord-state" role="status">{CHORD_EDITOR_STATE_LABELS[chordWorkflow]}</p>
                    {chordPreview && chordPreview.kind !== 'empty' ? (
                      <div className="admin-chord-preview" role="region" aria-label="Chord preview">
                        <span className="admin-chord-preview-label">{chordPreview.kind === 'timeline' ? 'Preview (timed)' : 'Preview'}</span>
                        <pre className="admin-chord-preview-body">{chordPreview.kind === 'timeline' ? chordPreview.lines.join('\n') : chordPreview.text}</pre>
                      </div>
                    ) : null}
                    {chordNotice ? (
                      <p className={`admin-chord-notice${chordNotice.isError ? ' error' : ''}`} role={chordNotice.isError ? 'alert' : 'status'}>
                        {chordNotice.text}
                      </p>
                    ) : null}
                    <button type="submit" className="btn">Save</button>
                    <button type="button" className="btn" onClick={() => setEditingSong(null)} style={{ marginLeft: 10 }}>Cancel</button>
                  </form>
                </div>
              )}
              <CatalogSyncPanel />
              <table style={{ marginTop: 20 }}>
                <thead>
                  <tr><th>ID</th><th>Title</th><th>Artist</th><th>Genre</th><th>Duration</th><th>Chords</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {songs.map((song) => (
                    <tr key={song._id}>
                      <td>{song._id.slice(-6)}</td>
                      <td>{song.title}</td>
                      <td>{song.artist}</td>
                      <td>{song.genre}</td>
                      <td>{song.duration}</td>
                      <td>{selectChordListStatus(song)}</td>
                      <td>
                        <button className="btn" onClick={() => openSongEditor(song)}>Edit</button>
                        <button className="btn admin-manage-chords" onClick={() => manageSongChords(song)}>Manage Chords</button>
                        <button className="btn btn-danger" onClick={() => deleteSong(song._id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {section === 'missing-lyrics' && <MissingLyricsQueue />}

          {section === 'karaoke' && (
            <div id="karaoke" className="card">
              <h2>Karaoke Tracks Management</h2>
              <p style={{ color: '#b3b3b3', marginBottom: 16, fontSize: 13 }}>
                Manage backing tracks available in Melodify Studio for karaoke recording.
              </p>

              <div className="form-divider">Add New Karaoke Track</div>
              <KaraokeForm onSuccess={(k) => { setKaraokeTracks((prev) => [k, ...prev]); showMessage('Karaoke track added'); }} onError={(e) => showMessage(e, true)} />

              <div className="form-divider">Existing Karaoke Tracks ({karaokeTracks.length})</div>
              {karaokeTracks.length === 0 ? (
                <p>No karaoke tracks yet</p>
              ) : (
                <table>
                  <thead>
                    <tr><th>Title</th><th>Artist</th><th>Genre</th><th>Duration</th><th>Available</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {karaokeTracks.map((k) => (
                      <tr key={k._id}>
                        <td>{k.title}</td>
                        <td>{k.artist}</td>
                        <td>{k.genre}</td>
                        <td>{k.duration}</td>
                        <td>{k.available ? 'Yes' : 'No'}</td>
                        <td>
                          <button className="btn" onClick={async () => {
                            const data = await api.put(`/api/karaoke/${k._id}`, { available: !k.available });
                            if (data.success) {
                              setKaraokeTracks((prev) => prev.map((t) => t._id === k._id ? { ...t, available: !t.available } : t));
                              showMessage(`Karaoke track ${k.available ? 'hidden' : 'shown'} in Studio`);
                            }
                          }}>{k.available ? 'Hide' : 'Show'}</button>
                          <button className="btn btn-danger" onClick={() => deleteKaraoke(k._id)} style={{ marginLeft: 5 }}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {section === 'moderation' && (
            <div id="moderation" className="card">
              <h2>Content Moderation</h2>
              {reports.length === 0 ? <p>No reports</p> : (
                <table>
                  <thead>
                    <tr><th>ID</th><th>Type</th><th>User</th><th>Reason</th><th>Status</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {reports.map((r) => (
                      <tr key={r._id}>
                        <td>{r._id.slice(-6)}</td>
                        <td>{r.type}</td>
                        <td>{r.user_email}</td>
                        <td>{r.reason}</td>
                        <td>{r.status}</td>
                        <td>
                          {r.status === 'pending' && (
                            <>
                              <button className="btn" onClick={() => resolveReport(r._id, 'resolved')}>Resolve</button>
                              <button className="btn" onClick={() => resolveReport(r._id, 'dismissed')} style={{ marginLeft: 5 }}>Dismiss</button>
                            </>
                          )}
                          <button className="btn btn-danger" onClick={() => deleteReport(r._id)} style={{ marginLeft: 5 }}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {section === 'subscriptions' && (
            <div id="subscriptions" className="card">
              <h2>Subscription Management</h2>
              {subscriptions.length === 0 ? <p>No subscriptions</p> : (
                <table>
                  <thead>
                    <tr><th>User Email</th><th>Plan</th><th>Status</th><th>End Date</th><th>Amount</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {subscriptions.map((sub) => (
                      <tr key={sub._id}>
                        <td>{sub.user_email}</td>
                        <td>{sub.plan}</td>
                        <td>{sub.status}</td>
                        <td>{sub.end_date ? String(sub.end_date).slice(0, 10) : '-'}</td>
                        <td>${sub.amount}</td>
                        <td>
                          {sub.status === 'active' ? (
                            <button className="btn btn-danger" onClick={() => updateSubscription(sub._id, 'expired')}>Expire</button>
                          ) : (
                            <button className="btn" onClick={() => updateSubscription(sub._id, 'active')}>Activate</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {section === 'ai-recommendation' && <AdminAIRecommendation />}
        </main>
      </div>
    </>
  );
}
