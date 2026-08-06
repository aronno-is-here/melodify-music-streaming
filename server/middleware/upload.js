import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const uploadsRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

const audioDir = path.join(uploadsRoot, 'songs', 'uploads');
const posterDir = path.join(uploadsRoot, 'posters');

fs.mkdirSync(audioDir, { recursive: true });
fs.mkdirSync(posterDir, { recursive: true });

const sanitize = (name) => name.replace(/[^A-Za-z0-9\-_\.]/g, '_');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, file.fieldname === 'song_file' ? audioDir : posterDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, sanitize(req.body.title || 'song') + ext);
  },
});

const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'song_file') {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ['.mp3', '.wav'].includes(ext));
  } else if (file.fieldname === 'poster_file') {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ['.jpg', '.jpeg', '.png'].includes(ext));
  } else {
    cb(null, true);
  }
};

export const upload = multer({ storage, fileFilter, limits: { fileSize: 60 * 1024 * 1024 } });