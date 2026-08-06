        document.addEventListener('DOMContentLoaded', function() {
            // DOM Elements
            const recordBtn = document.getElementById('recordBtn');
            const stopBtn = document.getElementById('stopBtn');
            const playBtn = document.getElementById('playBtn');
            const saveBtn = document.getElementById('saveBtn');
            const volumeSlider = document.getElementById('volume');
            const playbackVolume = document.getElementById('playback-volume');
            const musicVolume = document.getElementById('music-volume');
            const visualizer = document.getElementById('visualizer');
            const timeElapsed = document.getElementById('time-elapsed');
            const timeTotal = document.getElementById('time-total');
            const lyricsContainer = document.querySelector('.lyrics-container');

            // Audio context and variables
            let audioContext;
            let analyser;
            let microphone;
            let recorder;
            let audioChunks = [];
            let isRecording = false;
            let startTime;
            let elapsedTimeInterval;
            let canvasContext = visualizer.getContext('2d');

            // Set canvas dimensions
            visualizer.width = visualizer.offsetWidth;
            visualizer.height = visualizer.offsetHeight;

            // Initialize audio context on user interaction
            function initAudio() {
                if (!audioContext) {
                    audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    analyser = audioContext.createAnalyser();
                    analyser.fftSize = 2048;
                    
                    // Set up visualizer
                    setupVisualizer();
                }
            }

            // Set up audio visualizer
            function setupVisualizer() {
                const bufferLength = analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                
                function draw() {
                    requestAnimationFrame(draw);
                    
                    analyser.getByteTimeDomainData(dataArray);
                    
                    canvasContext.fillStyle = '#1a237e';
                    canvasContext.fillRect(0, 0, visualizer.width, visualizer.height);
                    
                    canvasContext.lineWidth = 2;
                    canvasContext.strokeStyle = '#00ffff';
                    canvasContext.beginPath();
                    
                    const sliceWidth = visualizer.width / bufferLength;
                    let x = 0;
                    
                    for(let i = 0; i < bufferLength; i++) {
                        const v = dataArray[i] / 128.0;
                        const y = v * visualizer.height / 2;
                        
                        if(i === 0) {
                            canvasContext.moveTo(x, y);
                        } else {
                            canvasContext.lineTo(x, y);
                        }
                        
                        x += sliceWidth;
                    }
                    
                    canvasContext.lineTo(visualizer.width, visualizer.height / 2);
                    canvasContext.stroke();
                }
                
                draw();
            }

            // Update time display
            function updateTimeDisplay() {
                if (isRecording) {
                    const elapsed = Date.now() - startTime;
                    const seconds = Math.floor(elapsed / 1000);
                    const minutes = Math.floor(seconds / 60);
                    timeElapsed.textContent = `${minutes.toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
                }
            }

            // Start recording
            async function startRecording() {
                try {
                    initAudio();
                    
                    const stream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            sampleRate: 44100,
                        }
                    });
                    
                    microphone = audioContext.createMediaStreamSource(stream);
                    microphone.connect(analyser);
                    
                    recorder = new MediaRecorder(stream);
                    audioChunks = [];
                    
                    recorder.ondataavailable = event => {
                        audioChunks.push(event.data);
                    };
                    
                    recorder.onstop = () => {
                        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                        const audioUrl = URL.createObjectURL(audioBlob);
                        
                        // Enable play and save buttons
                        playBtn.disabled = false;
                        saveBtn.disabled = false;
                        
                        // Set up play button
                        playBtn.onclick = () => {
                            const audio = new Audio(audioUrl);
                            audio.play();
                        };
                    };
                    
                    recorder.start();
                    isRecording = true;
                    startTime = Date.now();
                    
                    // Update time display every second
                    elapsedTimeInterval = setInterval(updateTimeDisplay, 1000);
                    
                    // Update UI
                    recordBtn.disabled = true;
                    stopBtn.disabled = false;
                    
                    // Simulate lyrics display
                    simulateLyrics();
                    
                } catch (error) {
                    console.error('Error accessing microphone:', error);
                    alert('Could not access your microphone. Please check permissions.');
                }
            }

            // Stop recording
            function stopRecording() {
                if (recorder && isRecording) {
                    recorder.stop();
                    isRecording = false;
                    clearInterval(elapsedTimeInterval);
                    
                    // Disconnect microphone
                    if (microphone) {
                        microphone.disconnect();
                    }
                    
                    // Update UI
                    recordBtn.disabled = false;
                    stopBtn.disabled = true;
                    
                    // Stop lyrics simulation
                    clearInterval(lyricsInterval);
                }
            }

            // Save recording to server
            function saveRecording() {
                const recordingName = prompt('Enter a name for your recording:');
                if (recordingName) {
                    // Convert audio chunks to blob
                    const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                    
                    // Create form data to send to server
                    const formData = new FormData();
                    formData.append('audio', audioBlob, `${recordingName}.wav`);
                    formData.append('name', recordingName);
                    
                    // Send to server
                    fetch('/api/recordings', {
                        method: 'POST',
                        body: formData
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            // Add to recordings list
                            const recordingsList = document.getElementById('recordingsList');
                            const newRecording = document.createElement('div');
                            newRecording.className = 'recording-item';
                            newRecording.innerHTML = `
                                <span>${recordingName}</span>
                                <div>
                                    <button class="play-btn">Play</button>
                                    <button class="editor-btn">Edit</button>
                                </div>
                            `;
                            recordingsList.prepend(newRecording);
                            alert('Recording saved successfully!');
                        } else {
                            alert('Error saving recording: ' + data.message);
                        }
                    })
                    .catch(error => {
                        console.error('Error:', error);
                        alert('Error saving recording');
                    });
                }
            }

            // Simulate lyrics display
            let lyricsInterval;
            function simulateLyrics() {
                const lyrics = [
                    "This is the first line of the song",
                    "Now we're at the second line",
                    "Here comes the chorus part",
                    "Sing it loud and clear!",
                    "This is the final part of the song"
                ];
                
                let currentLine = 0;
                
                // Clear existing lyrics
                lyricsContainer.innerHTML = '';
                
                // Add lyrics lines
                lyrics.forEach(line => {
                    const div = document.createElement('div');
                    div.className = 'lyric-line';
                    div.textContent = line;
                    lyricsContainer.appendChild(div);
                });
                
                // Highlight current line
                lyricsInterval = setInterval(() => {
                    const lines = document.querySelectorAll('.lyric-line');
                    
                    // Remove active class from all lines
                    lines.forEach(line => line.classList.remove('active'));
                    
                    // Add active class to current line
                    if (currentLine < lines.length) {
                        lines[currentLine].classList.add('active');
                        // Scroll to keep active line visible
                        lines[currentLine].scrollIntoView({ behavior: 'smooth', block: 'center' });
                        currentLine++;
                    } else {
                        clearInterval(lyricsInterval);
                    }
                }, 3000);
            }

            // Event listeners
            recordBtn.addEventListener('click', startRecording);
            stopBtn.addEventListener('click', stopRecording);
            saveBtn.addEventListener('click', saveRecording);
            
            // Volume control
            volumeSlider.addEventListener('input', function() {
                console.log(`Microphone volume set to: ${volumeSlider.value}%`);
            });
            
            playbackVolume.addEventListener('input', function() {
                console.log(`Playback volume set to: ${playbackVolume.value}%`);
            });
            
            musicVolume.addEventListener('input', function() {
                console.log(`Music volume set to: ${musicVolume.value}%`);
            });
            
            // Effect controls
            document.getElementById('reverb').addEventListener('input', function() {
                console.log(`Reverb set to: ${this.value}%`);
            });
            
            document.getElementById('delay').addEventListener('input', function() {
                console.log(`Delay set to: ${this.value}%`);
            });
            
            document.getElementById('pitch').addEventListener('input', function() {
                console.log(`Pitch correction set to: ${this.value}%`);
            });
            
            // Editor buttons
            document.getElementById('trimBtn').addEventListener('click', function() {
                console.log('Trim button clicked');
            });
            
            document.getElementById('fadeInBtn').addEventListener('click', function() {
                console.log('Fade In button clicked');
            });
            
            document.getElementById('fadeOutBtn').addEventListener('click', function() {
                console.log('Fade Out button clicked');
            });
            
            document.getElementById('normalizeBtn').addEventListener('click', function() {
                console.log('Normalize button clicked');
            });
            
            // Initialize time display
            timeElapsed.textContent = '00:00';
            timeTotal.textContent = '00:00';
        });