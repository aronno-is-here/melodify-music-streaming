<?php
session_start();
if (!isset($_SESSION['user_email'])) {
    header("Location: login.php");
    exit();
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Melodify - Dashboard</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
        integrity="sha512-iecdLmaskl7CVkqkXNQ/ZH/XLlvWZOJyj7Yy7tcenmpD1ypASozpmT/E0iPtmFIB46ZmdtAc9eNBvH0H/ZpiBw=="
        crossorigin="anonymous" referrerpolicy="no-referrer" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" />
    <link href="https://fonts.googleapis.com/css2?family=Merienda:wght@300..900&display=swap" rel="stylesheet" />
    <link href="https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,100..900;1,100..900&display=swap"
        rel="stylesheet" />
    <style>
        :root {
            --primary-black: #121212;
            --secondary-black: #1e1e1e;
            --accent-black: #2a2a2a;
            --sky-blue: #00b4d8;
            --light-blue: #90e0ef;
            --white: #ffffff;
            --gray: #b3b3b3;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        }

        html, body {
            overflow: hidden;
            height: 100%;
        }

        .logo {
            font-size: 50px;
            font-weight: bold;
            color: var(--sky-blue);
        }

        .logo span {
            color: var(--white);
        }

        header {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 60px;
            background-color: black;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100;
            transition-duration: 1s;
        }

        header:hover {
            box-shadow: 0 10px 10px rgba(7, 134, 238, 0.2);
        }

        main {
            margin-top: 60px;
            height: calc(100vh - 60px);
            display: grid;
            grid-template-columns: 25% 50% 25%;
            gap: 15px;
            padding: 20px;
            background-color: black;
            transition: grid-template-columns 0.3s ease;
        }

        main.collapsed {
            grid-template-columns: 2.5% 72.5% 25%;
        }

        .scroll-grid {
            background-color: #121212;
            border-radius: 8px;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
            margin-left: -15px;
            margin-right: 15px;
            padding: 15px;
            overflow-y: hidden;
            height: 100%;
            display: flex;
            flex-direction: column;
            scrollbar-width: none;
        }

        .scroll-grid:hover {
            overflow-y: auto;
            scrollbar-width: thin;
        }

        .scroll-grid:nth-child(1)::-webkit-scrollbar,
        .scroll-grid:nth-child(2)::-webkit-scrollbar,
        .scroll-grid:nth-child(3)::-webkit-scrollbar {
            width: 8px;
        }

        .scroll-grid:nth-child(1)::-webkit-scrollbar-thumb,
        .scroll-grid:nth-child(2)::-webkit-scrollbar-thumb,
        .scroll-grid:nth-child(3)::-webkit-scrollbar-thumb {
            background-color: var(--sky-blue);
            border-radius: 4px;
        }

        .scroll-grid:nth-child(1):hover,
        .scroll-grid:nth-child(2):hover,
        .scroll-grid:nth-child(3):hover {
            scrollbar-color: var(--sky-blue) #121212;
        }

        main.collapsed .scroll-grid:nth-child(1) .library-search,
        main.collapsed .scroll-grid:nth-child(1) .add-song-btn {
            display: none;
        }

        .scroll-grid h2 {
            font-size: 24px;
            color: var(--white);
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .scroll-grid:nth-child(2) h2 {
            font-size: 40px;
            font-family: "Roboto", sans-serif;
        }

        .scroll-grid:nth-child(3) h2 {
            font-size: 24px;
            font-family: "Roboto", sans-serif;
        }

        .add-song-btn {
            background: var(--primary-black);
            border: 1px solid var(--sky-blue);
            color: var(--sky-blue);
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 14px;
            cursor: pointer;
            transition: background-color 0.3s ease, color 0.3s ease;
        }

        .add-song-btn:hover {
            background: var(--sky-blue);
            color: var(--white);
        }

        .library-search {
            display: flex;
            align-items: center;
            background-color: var(--primary-black);
            border: 2px solid var(--sky-blue);
            border-radius: 25px;
            padding: 8px 12px;
            margin: 10px 0;
            width: 100%;
            transition: border-color 0.3s ease, box-shadow 0.3s ease;
        }

        .library-search:hover,
        .library-search:has(input:focus) {
            border-color: var(--light-blue);
            box-shadow: 0 0 8px var(--light-blue);
        }

        .library-search i {
            color: var(--sky-blue);
            font-size: 16px;
            margin: 0 8px;
            transition: color 0.3s ease, transform 0.3s ease;
        }

        .library-search i:hover {
            color: var(--light-blue);
            transform: scale(1.1);
        }

        .library-search input {
            flex: 1;
            background: transparent;
            border: none;
            outline: none;
            color: var(--white);
            font-size: 14px;
        }

        .library-search input::placeholder {
            color: var(--gray);
        }

        .search-container {
            width: 100%;
            margin-top: 20px;
            background: var(--primary-black);
        }

        .search-bar {
            display: flex;
            align-items: center;
            background-color: var(--primary-black);
            border: 2px solid var(--sky-blue);
            border-radius: 25px;
            padding: 10px 15px;
            margin: 0 10px;
            width: calc(100% - 20px);
            transition: border-color 0.3s ease, box-shadow 0.3s ease;
        }

        .search-bar:hover,
        .search-bar:has(input:focus) {
            border-color: var(--light-blue);
            box-shadow: 0 0 8px var(--light-blue);
        }

        .search-bar i {
            color: var(--sky-blue);
            font-size: 20px;
            margin: 0 10px;
            transition: color 0.3s ease, transform 0.3s ease;
        }

        .search-bar i:hover {
            color: var(--light-blue);
            transform: scale(1.1);
        }

        .search-bar input {
            flex: 1;
            background: transparent;
            border: none;
            outline: none;
            color: var(--white);
            font-size: 16px;
            margin-top: -3px;
        }

        .search-bar input::placeholder {
            color: var(--gray);
        }

        .songs-container {
            width: 100%;
            margin-top: 20px;
            background: var(--primary-black);
            padding: 20px 0;
            border-radius: 8px;
        }

        .songs-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 50px;
        }

        .song-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            position: relative;
        }

        .song-poster {
            width: 150px;
            height: 150px;
            object-fit: cover;
            border-radius: 5px;
            transition: opacity 0.3s ease;
        }

        .song-item:hover .song-poster {
            opacity: 0.6;
        }

        .song-item .play-button {
            position: absolute;
            bottom: 35px;
            right: 5px;
            width: 40px;
            height: 40px;
            background-color: var(--sky-blue);
            color: var(--white);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transform: scale(0.8);
            transition: opacity 0.3s ease, transform 0.3s ease;
            cursor: pointer;
        }

        .song-item:hover .play-button {
            opacity: 1;
            transform: scale(1);
        }

        .song-item .play-button i {
            font-size: 18px;
        }

        .song-info {
            text-align: center;
            margin-top: 5px;
        }

        .song-name {
            color: var(--white);
            font-size: 14px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            width: 150px;
        }

        .artist-name {
            color: var(--gray);
            font-size: 12px;
        }

        .now-playing-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }

        .now-playing-header h2 {
            font-size: 24px;
            color: var(--white);
            font-family: "Roboto", sans-serif;
        }

        .song-details {
            color: var(--white);
            margin-bottom: 15px;
        }

        .song-details h3 {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 5px;
        }

        .song-details p {
            font-size: 14px;
            color: var(--gray);
            margin: 2px 0;
        }

        .progress-container {
            width: 100%;
            height: 6px;
            background: var(--secondary-black);
            border-radius: 3px;
            margin-bottom: 15px;
            position: relative;
        }

        .progress-bar {
            width: 0%;
            height: 100%;
            background: var(--sky-blue);
            border-radius: 3px;
            transition: width 0.1s linear;
        }

        .controls {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 10px;
            margin-bottom: 15px;
        }

        .control-btn {
            background: var(--accent-black);
            border: none;
            color: var(--sky-blue);
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: background 0.3s ease, color 0.3s ease, transform 0.3s ease;
        }

        .control-btn:hover,
        .control-btn:focus {
            background: var(--sky-blue);
            color: var(--white);
            transform: scale(1.1);
        }

        .control-btn.active {
            color: var(--light-blue);
        }

        .control-btn i {
            font-size: 18px;
        }

        .play-btn {
            width: 50px;
            height: 50px;
        }

        .play-btn i {
            font-size: 22px;
        }

        .volume-container {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 15px;
        }

        .volume-btn {
            background: none;
            border: none;
            color: var(--sky-blue);
            font-size: 18px;
            cursor: pointer;
            transition: color 0.3s ease, transform 0.3s ease;
        }

        .volume-btn:hover,
        .volume-btn:focus {
            color: var(--light-blue);
            transform: scale(1.1);
        }

        .volume-slider {
            width: 100px;
            height: 6px;
            background: var(--secondary-black);
            border-radius: 3px;
            outline: none;
        }

        .volume-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 12px;
            height: 12px;
            background: var(--sky-blue);
            border-radius: 50%;
            cursor: pointer;
        }

        .volume-slider::-moz-range-thumb {
            width: 12px;
            height: 12px;
            background: var(--sky-blue);
            border-radius: 50%;
            cursor: pointer;
        }

        .add-song-popup {
            display: none;
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: var(--secondary-black);
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
            z-index: 10000;
            width: 400px;
            max-width: 90%;
            color: var(--white);
        }

        .add-song-popup.active {
            display: block;
        }

        .add-song-popup h3 {
            font-size: 22px;
            margin-bottom: 15px;
            font-family: "Roboto", sans-serif;
        }

        .add-song-popup label {
            display: block;
            margin-bottom: 5px;
            font-size: 14px;
        }

        .add-song-popup input[type="text"],
        .add-song-popup select,
        .add-song-popup input[type="file"] {
            width: 100%;
            padding: 8px;
            margin-bottom: 10px;
            background: var(--primary-black);
            border: 1px solid var(--sky-blue);
            border-radius: 4px;
            color: var(--white);
            font-size: 14px;
        }

        .add-song-popup button {
            padding: 8px 16px;
            background: var(--sky-blue);
            color: var(--white);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.3s ease;
        }

        .add-song-popup button:hover {
            background: var(--light-blue);
        }

        .add-song-popup .close-btn {
            position: absolute;
            top: 10px;
            right: 10px;
            background: none;
            border: none;
            font-size: 16px;
            color: var(--sky-blue);
            cursor: pointer;
        }

        .add-song-popup .close-btn:hover {
            color: var(--light-blue);
        }

        .overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 9999;
        }

        .overlay.active {
            display: block;
        }

        @media (max-width: 768px) {
            main {
                grid-template-columns: 1fr;
                padding: 10px;
            }

            .scroll-grid {
                margin-bottom: 15px;
                margin-right: 0;
            }

            main.collapsed {
                grid-template-columns: 1fr;
            }

            .songs-grid {
                grid-template-columns: repeat(2, 1fr);
                gap: 20px;
            }

            .song-poster {
                width: 120px;
                height: 120px;
            }

            .song-item .play-button {
                bottom: 30px;
                right: 5px;
                width: 35px;
                height: 35px;
            }

            .song-item .play-button i {
                font-size: 16px;
            }

            .song-name, .artist-name {
                width: 120px;
                font-size: 12px;
            }

            .search-bar {
                padding: 8px 12px;
                margin: 0 5px;
            }

            .search-bar i {
                font-size: 16px;
                margin: 0 8px;
            }

            .search-bar input {
                font-size: 14px;
            }

            .scroll-grid h2 {
                font-size: 20px;
            }

            .add-song-btn {
                padding: 4px 8px;
                font-size: 12px;
            }

            .add-song-popup {
                width: 80%;
            }
        }
    </style>
</head>
<body>
    <header>
        <div class="logo">MELOD<span>IFY</span></div>
    </header>
    <div class="profile-container">
        <button class="profile-btn" aria-label="Open profile menu">
            <i class="fa-solid fa-user"></i>
        </button>
        <div class="profile-menu" id="profile-menu">
            <ul>
                <li>View Profile</li>
                <li>Logout</li>
            </ul>
        </div>
    </div>
    <main id="mainContainer">
        <div class="scroll-grid">
            <h2>
                <button class="toggle-btn">◀</button>
                <span class="grid-title">Library</span>
                <button class="add-song-btn">Add Song</button>
            </h2>
            <div class="library-search">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" placeholder="Search in Library" />
            </div>
        </div>
        <div class="scroll-grid">
            <div class="search-container">
                <div class="search-bar">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" placeholder="Search by songs or artists" />
                    <i class="fa-solid fa-face-smile"></i>
                </div>
            </div>
            <div class="songs-container">
                <h2>Songs</h2>
                <div class="songs-grid">
                    <!-- Dynamically populated via JavaScript -->
                </div>
            </div>
        </div>
        <div class="scroll-grid">
            <div class="now-playing-header">
                <h2 id="right-heading">Now Playing</h2>
            </div>
            <img class="song-poster" src="Posters/default_poster.jpg" alt="Now Playing Song Poster" />
            <div class="song-details">
                <h3>No Song Selected</h3>
                <p>Artist: None</p>
                <p>Genre: None</p>
                <p>Duration: 0:00</p>
                <p>Release Date: None</p>
            </div>
            <div class="progress-container">
                <div class="progress-bar"></div>
            </div>
            <div class="controls">
                <button class="control-btn shuffle-btn" aria-label="Toggle shuffle" data-shuffle="off">
                    <i class="fa-solid fa-shuffle"></i>
                </button>
                <button class="control-btn prev-btn" aria-label="Previous song">
                    <i class="fa-solid fa-backward"></i>
                </button>
                <button class="control-btn play-btn" aria-label="Play song" data-state="play">
                    <i class="fa-solid fa-play"></i>
                </button>
                <button class="control-btn next-btn" aria-label="Next song">
                    <i class="fa-solid fa-forward"></i>
                </button>
                <button class="control-btn repeat-btn" aria-label="Toggle repeat" data-repeat="off">
                    <i class="fa-solid fa-repeat"></i>
                </button>
            </div>
            <div class="volume-container">
                <button class="volume-btn" aria-label="Toggle mute" data-muted="false">
                    <i class="fa-solid fa-volume-high"></i>
                </button>
                <input type="range" class="volume-slider" min="0" max="100" value="50" aria-label="Volume control" />
            </div>
            <audio id="audio-player"></audio>
        </div>
        <div class="overlay"></div>
        <div class="add-song-popup">
            <button class="close-btn">✕</button>
            <h3>Add New Song</h3>
            <form id="add-song-form" enctype="multipart/form-data">
                <label for="title">Title</label>
                <input type="text" id="title" name="title" required />
                <label for="artist">Artist</label>
                <input type="text" id="artist" name="artist" required />
                <label for="genre">Genre</label>
                <select id="genre" name="genre" required>
                    <option value="Bengali">Bengali</option>
                    <option value="Hindi">Hindi</option>
                    <option value="English">English</option>
                </select>
                <label for="song_file">Song File (MP3/WAV)</label>
                <input type="file" id="song_file" name="song_file" accept=".mp3,.wav" required />
                <label for="poster_file">Poster Image (JPG/PNG)</label>
                <input type="file" id="poster_file" name="poster_file" accept=".jpg,.jpeg,.png" required />
                <label for="duration">Duration (e.g., 3:30)</label>
                <input type="text" id="duration" name="duration" placeholder="3:30" />
                <label for="release_date">Release Date</label>
                <input type="date" id="release_date" name="release_date" />
                <button type="submit">Upload Song</button>
            </form>
        </div>
    </main>
    <script>
document.addEventListener('DOMContentLoaded', () => {
    const songsGrid = document.querySelector('.songs-grid');
    const audioPlayer = document.querySelector('#audio-player');
    const playBtn = document.querySelector('.play-btn');
    const prevBtn = document.querySelector('.prev-btn');
    const nextBtn = document.querySelector('.next-btn');
    const shuffleBtn = document.querySelector('.shuffle-btn');
    const repeatBtn = document.querySelector('.repeat-btn');
    const volumeBtn = document.querySelector('.volume-btn');
    const volumeSlider = document.querySelector('.volume-slider');
    const progressBar = document.querySelector('.progress-bar');
    const songDetails = document.querySelector('.song-details');
    const nowPlayingPoster = document.querySelector('.scroll-grid:nth-child(3) .song-poster');
    const addSongBtn = document.querySelector('.add-song-btn');
    const addSongPopup = document.querySelector('.add-song-popup');
    const overlay = document.querySelector('.overlay');
    const closePopupBtn = document.querySelector('.add-song-popup .close-btn');
    const addSongForm = document.querySelector('#add-song-form');
    const toggleBtn = document.querySelector('.toggle-btn');
    const profileBtn = document.querySelector('.profile-btn');
    const profileMenu = document.querySelector('#profile-menu');
    let songs = [];
    let currentSongIndex = -1;
    let isPlaying = false;

    // Fetch songs from backend
    function fetchSongs() {
        fetch('fetch_songs.php')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    songs = data.songs;
                    renderSongs(songs);
                    if (songs.length > 0 && currentSongIndex === -1) {
                        currentSongIndex = 0;
                        updateNowPlaying(songs[currentSongIndex]);
                    }
                } else {
                    console.error('Failed to fetch songs:', data.error);
                }
            })
            .catch(error => console.error('Error fetching songs:', error));
    }

    // Render songs in the grid
    function renderSongs(songs) {
        songsGrid.innerHTML = '';
        songs.forEach((song, index) => {
            const songItem = document.createElement('div');
            songItem.className = 'song-item';
            songItem.innerHTML = `
                <img class="song-poster" src="${song.poster_url}" alt="${song.title} Poster" />
                <div class="play-button" data-index="${index}">
                    <i class="fa-solid fa-play"></i>
                </div>
                <div class="song-info">
                    <div class="song-name">${song.title}</div>
                    <div class="artist-name">${song.artist}</div>
                </div>
            `;
            songsGrid.appendChild(songItem);
        });

        // Add event listeners to play buttons
        document.querySelectorAll('.song-item .play-button').forEach(button => {
            button.addEventListener('click', () => {
                const index = parseInt(button.dataset.index);
                if (index === currentSongIndex && isPlaying) {
                    audioPlayer.pause();
                    isPlaying = false;
                    button.querySelector('i').classList.remove('fa-pause');
                    button.querySelector('i').classList.add('fa-play');
                    playBtn.querySelector('i').classList.remove('fa-pause');
                    playBtn.querySelector('i').classList.add('fa-play');
                } else {
                    currentSongIndex = index;
                    playSong(songs[currentSongIndex]);
                }
            });
        });
    }

    // Update now playing section
    function updateNowPlaying(song) {
        songDetails.innerHTML = `
            <h3>${song.title}</h3>
            <p>Artist: ${song.artist}</p>
            <p>Genre: ${song.genre}</p>
            <p>Duration: ${song.duration}</p>
            <p>Release Date: ${song.release_date}</p>
        `;
        nowPlayingPoster.src = song.poster_url;
        audioPlayer.src = song.file_path;
    }

    // Play a song
    function playSong(song) {
        updateNowPlaying(song);
        audioPlayer.play();
        isPlaying = true;
        playBtn.querySelector('i').classList.remove('fa-play');
        playBtn.querySelector('i').classList.add('fa-pause');
        document.querySelectorAll('.song-item .play-button').forEach(button => {
            const index = parseInt(button.dataset.index);
            button.querySelector('i').classList.remove('fa-pause');
            button.querySelector('i').classList.add('fa-play');
            if (index === currentSongIndex) {
                button.querySelector('i').classList.remove('fa-play');
                button.querySelector('i').classList.add('fa-pause');
            }
        });
    }

    // Toggle play/pause
    playBtn.addEventListener('click', () => {
        if (songs.length === 0) return;
        if (isPlaying) {
            audioPlayer.pause();
            isPlaying = false;
            playBtn.querySelector('i').classList.remove('fa-pause');
            playBtn.querySelector('i').classList.add('fa-play');
            document.querySelectorAll('.song-item .play-button')[currentSongIndex].querySelector('i').classList.remove('fa-pause');
            document.querySelectorAll('.song-item .play-button')[currentSongIndex].querySelector('i').classList.add('fa-play');
        } else {
            playSong(songs[currentSongIndex]);
        }
    });

    // Previous song
    prevBtn.addEventListener('click', () => {
        if (songs.length === 0) return;
        if (shuffleBtn.dataset.shuffle === 'on') {
            currentSongIndex = Math.floor(Math.random() * songs.length);
        } else {
            currentSongIndex = (currentSongIndex - 1 + songs.length) % songs.length;
        }
        playSong(songs[currentSongIndex]);
    });

    // Next song
    nextBtn.addEventListener('click', () => {
        if (songs.length === 0) return;
        if (shuffleBtn.dataset.shuffle === 'on') {
            currentSongIndex = Math.floor(Math.random() * songs.length);
        } else {
            currentSongIndex = (currentSongIndex + 1) % songs.length;
        }
        playSong(songs[currentSongIndex]);
    });

    // Auto-play next song on end
    audioPlayer.addEventListener('ended', () => {
        if (repeatBtn.dataset.repeat === 'on') {
            playSong(songs[currentSongIndex]);
        } else {
            nextBtn.click();
        }
    });

    // Update progress bar
    audioPlayer.addEventListener('timeupdate', () => {
        if (audioPlayer.duration) {
            const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
            progressBar.style.width = `${progress}%`;
        }
    });

    // Shuffle toggle
    shuffleBtn.addEventListener('click', () => {
        shuffleBtn.dataset.shuffle = shuffleBtn.dataset.shuffle === 'off' ? 'on' : 'off';
        shuffleBtn.classList.toggle('active');
    });

    // Repeat toggle
    repeatBtn.addEventListener('click', () => {
        repeatBtn.dataset.repeat = repeatBtn.dataset.repeat === 'off' ? 'on' : 'off';
        repeatBtn.classList.toggle('active');
    });

    // Volume control
    volumeBtn.addEventListener('click', () => {
        const isMuted = volumeBtn.dataset.muted === 'false';
        volumeBtn.dataset.muted = isMuted ? 'true' : 'false';
        volumeBtn.dataset.volume = isMuted ? volumeSlider.value : '0';
        volumeSlider.value = isMuted ? 0 : volumeBtn.dataset.volume;
        audioPlayer.volume = volumeSlider.value / 100;
        volumeBtn.querySelector('i').classList.toggle('fa-volume-high', !isMuted);
        volumeBtn.querySelector('i').classList.toggle('fa-volume-mute', isMuted);
    });

    volumeSlider.addEventListener('input', () => {
        const volume = volumeSlider.value;
        audioPlayer.volume = volume / 100;
        volumeBtn.dataset.muted = volume === '0' ? 'true' : 'false';
        volumeBtn.querySelector('i').classList.toggle('fa-volume-high', volume !== '0');
        volumeBtn.querySelector('i').classList.toggle('fa-volume-mute', volume === '0');
    });

    // Toggle collapse
    toggleBtn.addEventListener('click', () => {
        document.querySelector('#mainContainer').classList.toggle('collapsed');
    });

    // Profile menu
    profileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        profileMenu.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!profileBtn.contains(e.target) && !profileMenu.contains(e.target)) {
            profileMenu.classList.remove('active');
        }
    });

    profileMenu.querySelectorAll('li').forEach(item => {
        item.addEventListener('click', () => {
            if (item.textContent === 'Logout') {
                window.location.href = 'logout.php';
            }
            profileMenu.classList.remove('active');
        });
    });

    // Add song popup
    addSongBtn.addEventListener('click', () => {
        addSongPopup.classList.add('active');
        overlay.classList.add('active');
    });

    closePopupBtn.addEventListener('click', () => {
        addSongPopup.classList.remove('active');
        overlay.classList.remove('active');
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && addSongPopup.classList.contains('active')) {
            addSongPopup.classList.remove('active');
            overlay.classList.remove('active');
        }
    });

    addSongForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = new FormData(addSongForm);
        fetch('upload_song.php', {
            method: 'POST',
            body: formData
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    alert('Song uploaded successfully');
                    addSongPopup.classList.remove('active');
                    overlay.classList.remove('active');
                    addSongForm.reset();
                    fetchSongs();
                } else {
                    alert('Error uploading song: ' + data.error);
                }
            })
            .catch(error => alert('Error uploading song: ' + error));
    });

    // Search functionality
    document.querySelector('.search-bar input').addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const filteredSongs = songs.filter(song =>
            song.title.toLowerCase().includes(searchTerm) ||
            song.artist.toLowerCase().includes(searchTerm)
        );
        renderSongs(filteredSongs);
    });

    // Initial fetch
    fetchSongs();
});
    </script>
</body>
</html>