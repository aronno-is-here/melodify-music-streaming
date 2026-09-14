
        document.addEventListener('DOMContentLoaded', function() {
            // Elements
            const playBtn = document.getElementById('playBtn');
            const footerPlayBtn = document.getElementById('footerPlayBtn');
            const addBtn = document.getElementById('addBtn');
            const downloadBtn = document.getElementById('downloadBtn');
            const menuBtn = document.getElementById('menuBtn');
            const trackItems = document.querySelectorAll('.track-item');
            const nowPlayingTitle = document.querySelector('.now-playing-title');
            const nowPlayingArtist = document.querySelector('.now-playing-artist');
            const nowPlayingImg = document.querySelector('.now-playing-img');
            
            // State
            let isPlaying = false;
            let currentTrack = null;
            let currentAudio = null;
            
            // Play/Pause button functionality
            function togglePlay() {
                isPlaying = !isPlaying;
                
                if (isPlaying) {
                    playBtn.innerHTML = '<i class="fas fa-pause"></i>';
                    footerPlayBtn.innerHTML = '<i class="fas fa-pause"></i>';
                    
                    if (!currentTrack) {
                        // If nothing is playing, start with first track
                        playTrack(trackItems[0]);
                    } else {
                        // Resume current track
                        currentAudio.play();
                    }
                } else {
                    playBtn.innerHTML = '<i class="fas fa-play"></i>';
                    footerPlayBtn.innerHTML = '<i class="fas fa-play"></i>';
                    
                    if (currentAudio) {
                        currentAudio.pause();
                    }
                }
            }
            
            // Play a specific track
            function playTrack(trackElement) {
                // Reset previous track
                if (currentTrack) {
                    currentTrack.classList.remove('playing');
                    currentAudio.pause();
                    currentAudio.currentTime = 0;
                }
                
                // Set new track
                currentTrack = trackElement;
                currentAudio = currentTrack.querySelector('audio');
                
                // Update UI
                trackItems.forEach(item => item.classList.remove('playing'));
                currentTrack.classList.add('playing');
                
                // Update now playing info
                const trackTitle = currentTrack.querySelector('.track-title').textContent;
                const trackArtist = currentTrack.querySelector('.track-artist').textContent;
                
                nowPlayingTitle.textContent = trackTitle;
                nowPlayingArtist.textContent = trackArtist;
                
                // Play audio
                currentAudio.play();
                isPlaying = true;
                playBtn.innerHTML = '<i class="fas fa-pause"></i>';
                footerPlayBtn.innerHTML = '<i class="fas fa-pause"></i>';
                
                // Update progress bar as audio plays
                currentAudio.addEventListener('timeupdate', function() {
                    const progressPercent = (currentAudio.currentTime / currentAudio.duration) * 100;
                    currentTrack.querySelector('.progress-bar').style.transform = `scaleX(${progressPercent / 100})`;
                    
                    // Update footer player progress
                    document.querySelector('.progress-bar-current').style.width = `${progressPercent}%`;
                    
                    // Update time displays
                    const currentMinutes = Math.floor(currentAudio.currentTime / 60);
                    const currentSeconds = Math.floor(currentAudio.currentTime % 60);
                    const totalMinutes = Math.floor(currentAudio.duration / 60);
                    const totalSeconds = Math.floor(currentAudio.duration % 60);
                    
                    document.querySelector('.progress-time:first-child').textContent = 
                        `${currentMinutes}:${currentSeconds < 10 ? '0' : ''}${currentSeconds}`;
                    document.querySelector('.progress-time:last-child').textContent = 
                        `${totalMinutes}:${totalSeconds < 10 ? '0' : ''}${totalSeconds}`;
                });
                
                // When audio ends, play next track
                currentAudio.addEventListener('ended', function() {
                    const nextTrack = currentTrack.nextElementSibling;
                    if (nextTrack && nextTrack.classList.contains('track-item')) {
                        playTrack(nextTrack);
                    } else {
                        // If last track, stop playback
                        isPlaying = false;
                        playBtn.innerHTML = '<i class="fas fa-play"></i>';
                        footerPlayBtn.innerHTML = '<i class="fas fa-play"></i>';
                        currentTrack.classList.remove('playing');
                        currentTrack = null;
                        currentAudio = null;
                        
                        // Reset now playing info
                        nowPlayingTitle.textContent = 'Not Playing';
                        nowPlayingArtist.textContent = 'Select a song to play';
                    }
                });
            }
            
            // Event listeners
            playBtn.addEventListener('click', togglePlay);
            footerPlayBtn.addEventListener('click', togglePlay);
            
            addBtn.addEventListener('click', function() {
                if (this.classList.contains('added')) {
                    this.innerHTML = '<i class="far fa-heart"></i>';
                    this.classList.remove('added');
                } else {
                    this.innerHTML = '<i class="fas fa-heart"></i>';
                    this.classList.add('added');
                }
            });
            
            downloadBtn.addEventListener('click', function() {
                alert('Downloading Shotto album...');
            });
            
            menuBtn.addEventListener('click', function() {
                alert('Menu options:\n\n• Add to Playlist\n• Share Album\n• Go to Artist');
            });
            
            // Add click event to each track
            trackItems.forEach(track => {
                track.addEventListener('click', function() {
                    playTrack(this);
                });
            });
            
            // Back button functionality
            document.querySelector('.back-button').addEventListener('click', function() {
                window.history.back();
            });
        });
    