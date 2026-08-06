const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const port = process.env.PORT || 3000;

// Middleware
app.use(express.static('../public'));
app.use(express.json());

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'uploads/';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// Socket.io for real-time features
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Handle real-time lyrics synchronization
  socket.on('lyrics-update', (data) => {
    socket.broadcast.emit('lyrics-change', data);
  });
  
  // Handle real-time effects
  socket.on('effect-change', (data) => {
    socket.broadcast.emit('effect-update', data);
  });
  
  // Handle collaborative editing
  socket.on('edit-action', (data) => {
    socket.broadcast.emit('edit-update', data);
  });
  
  // Handle volume changes
  socket.on('volume-change', (data) => {
    socket.broadcast.emit('volume-update', data);
  });
  
  // Handle recording events
  socket.on('recording-started', () => {
    console.log('Recording started by client:', socket.id);
    socket.broadcast.emit('recording-status', { status: 'started', user: socket.id });
  });
  
  socket.on('recording-stopped', () => {
    console.log('Recording stopped by client:', socket.id);
    socket.broadcast.emit('recording-status', { status: 'stopped', user: socket.id });
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// Endpoint to save recordings
app.post('/api/recordings', upload.single('audio'), (req, res) => {
  const recordingName = req.body.name;
  const audioFile = req.file;
  
  // Here you would typically store recording metadata in a database
  console.log(`Saved recording: ${recordingName}, file: ${audioFile.filename}`);
  
  // Broadcast to all connected clients
  io.emit('recording-saved', { 
    name: recordingName, 
    filename: audioFile.filename,
    timestamp: new Date(),
    user: 'current-user' // In a real app, you would use actual user authentication
  });
  
  res.json({ 
    success: true, 
    message: 'Recording saved successfully',
    filename: audioFile.filename
  });
});

// Endpoint to get list of recordings
app.get('/api/recordings', (req, res) => {
  // In a real application, you would get this from a database
  const recordings = [
    { id: 1, name: 'My Recording #1', filename: 'recording1.wav', timestamp: new Date() },
    { id: 2, name: 'Awesome Cover', filename: 'recording2.wav', timestamp: new Date() }
  ];
  
  res.json(recordings);
});

// Endpoint to apply audio effects
app.post('/api/effects', (req, res) => {
  const { effect, parameters } = req.body;
  
  // In a real application, you would process the audio here
  console.log(`Applying effect: ${effect} with parameters:`, parameters);
  
  res.json({ 
    success: true, 
    message: `Effect ${effect} applied successfully` 
  });
});

server.listen(port, () => {
  console.log(`Real-time karaoke app listening at http://localhost:${port}`);
});