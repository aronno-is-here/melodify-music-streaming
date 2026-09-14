import { useEffect, useLayoutEffect } from 'react';
import { Link } from 'react-router-dom';
import usePlayer from '../../hooks/usePlayer.js';
import cssRaw from './MelodifyStudio.css?raw';

export default function MelodifyStudio() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'MelodifyStudio');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const player = usePlayer();
  const song = player.currentSong;

  return (
    <div className="studio-page">
      <header className="studio-header">
        <Link to="/dashboard" className="studio-back" aria-label="Back to Dashboard">
          <i className="fa-solid fa-chevron-left"></i>
          <span>Dashboard</span>
        </Link>
        <div className="studio-logo">
          MELOD<span>IFY</span> STUDIO
        </div>
      </header>

      <main className="studio-content">
        <div className="studio-hero">
          <div className="studio-hero-icon">
            <i className="fa-solid fa-microphone-lines"></i>
          </div>
          <h1>Melodify Studio</h1>
          <p>Sing along with synchronized lyrics and practice with chords</p>
        </div>

        {song ? (
          <div className="studio-now-playing">
            <div className="studio-song-card">
              <img
                className="studio-poster"
                src={song.poster_url || 'https://picsum.photos/120/120?random'}
                alt={song.title}
                onError={(e) => { e.target.src = 'https://picsum.photos/120/120?random'; }}
              />
              <div className="studio-song-info">
                <h2>{song.title}</h2>
                <p>{song.artist}</p>
                <p className="studio-genre">{song.genre}</p>
              </div>
            </div>

            <div className="studio-features">
              {song.lyrics ? (
                <div className="studio-feature-card">
                  <i className="fa-solid fa-music"></i>
                  <h3>Lyrics</h3>
                  <p>View synchronized lyrics for this song</p>
                  <Link to="/dashboard" className="studio-feature-btn">View Lyrics</Link>
                </div>
              ) : (
                <div className="studio-feature-card disabled">
                  <i className="fa-solid fa-music"></i>
                  <h3>Lyrics</h3>
                  <p>Lyrics not yet available for this song</p>
                </div>
              )}

              {song.chords ? (
                <div className="studio-feature-card">
                  <i className="fa-solid fa-guitar"></i>
                  <h3>Chords</h3>
                  <p>Practice with chord progressions</p>
                  <Link to="/dashboard" className="studio-feature-btn">View Chords</Link>
                </div>
              ) : (
                <div className="studio-feature-card disabled">
                  <i className="fa-solid fa-guitar"></i>
                  <h3>Chords</h3>
                  <p>Chord data not yet available for this song</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="studio-empty">
            <i className="fa-solid fa-play"></i>
            <p>Select a song from the Dashboard to get started</p>
            <Link to="/dashboard" className="studio-feature-btn">Go to Dashboard</Link>
          </div>
        )}
      </main>
    </div>
  );
}
