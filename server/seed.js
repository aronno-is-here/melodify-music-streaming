import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import Song from './models/Song.js';
import User from './models/User.js';
import Report from './models/Report.js';
import Subscription from './models/Subscription.js';

dotenv.config();

function generateRandomPassword() {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$';
  return Array.from(crypto.randomBytes(18)).map((b) => chars[b % chars.length]).join('');
}

const songs = [
  { title: 'Amar Dehokhan', artist: 'Odd Signature', genre: 'Melodious', file_path: 'assets/songs/bengali/amar_dehokhan.mp3', poster_url: 'assets/posters/Amar_Dehokhan_Poster.jpg', duration: '3:15', release_date: '2023-02-01' },
  { title: 'Bhalobasha Tarpor', artist: 'Arnob', genre: 'Romantic', file_path: 'assets/songs/bengali/bhalobasha_tarpor.mp3', poster_url: 'assets/posters/Bhalobasha_Tarpor_Poster.jfif', duration: '4:00', release_date: '2023-03-01' },
  { title: 'Dukkho Bilash', artist: 'Artcell', genre: 'Metal', file_path: 'assets/songs/bengali/dukkho_bilash.mp3', poster_url: 'assets/posters/Dukkho_Bilash_Poster.jpg', duration: '3:45', release_date: '2023-04-01' },
  { title: 'Keno Hothat Tumi Ele', artist: 'Romantic', genre: 'Hindi', file_path: 'assets/songs/bengali/keno_hothat_tumi_ele.mp3', poster_url: 'assets/posters/Keno_Hothat_Tumi_Ele_Poster.jpg', duration: '3:30', release_date: '2023-05-01' },
  { title: 'Nisshash', artist: 'Borbaad', genre: 'Rock', file_path: 'assets/songs/bengali/nisshash.mp3', poster_url: 'assets/posters/Nisshash_Poster.jpg', duration: '4:15', release_date: '2023-06-01' },
  { title: 'Khamoshiyan', artist: 'Arijit Singh', genre: 'Love', file_path: 'assets/songs/hindi/Khamoshiyan (Title Song) Lyrics - Arijit Singh - Rashmi S _ Jeet G - Ali Fazal _ Sapna P _ Gurmeet C(MP3_160K).mp3', poster_url: 'assets/posters/Khamoshiyan_Poster.jpg', duration: '3:50', release_date: '2023-07-01' },
  { title: 'Hasi Ban Gaye', artist: 'Ami Mishra', genre: 'Romantic', file_path: 'assets/songs/hindi/Hasi Ban Gaye Full Lyrics (Male Version) _  Hamari Adhuri Kahani _ Ami Mishra _ Emraan _ Vidya B(MP3_160K).mp3', poster_url: 'assets/posters/Hasi_Ban_Gaye_Poster.jpg', duration: '3:20', release_date: '2023-08-01' },
  { title: 'Labon Ko', artist: 'K.K.', genre: 'Romantic', file_path: 'assets/songs/hindi/LABON KO LABON PE FULL SONG (LYRICS) - K.K. _ BHOOL BHULAIYAA(MP3_160K).mp3', poster_url: 'assets/posters/Labon_Ko_Poster.jpg', duration: '4:10', release_date: '2023-09-01' },
  { title: 'Suraj Dooba Hae', artist: 'Arijit', genre: 'Happy', file_path: 'assets/songs/hindi/_Sooraj Dooba Hain_ FULL VIDEO SONG _ Arijit singh Aditi Singh Sharma _ T-SERIES(MP3_160K).mp3', poster_url: 'assets/posters/Sooraj_Dooba_Hain_Poster.jpg', duration: '3:55', release_date: '2023-10-01' },
  { title: 'Comfortably Numb', artist: 'Pink Floyd', genre: 'Pop', file_path: 'assets/songs/english/Comfortably Numb(MP3_160K).mp3', poster_url: 'assets/posters/Comfortably_Numb_Poster.jpeg', duration: '3:55', release_date: '2023-10-01' },
  { title: 'Die with a smile', artist: 'Bruno Mars and Lady Gaga', genre: 'Romantic', file_path: 'assets/songs/english/Lady GagaBruno Mars - Die With A Smile (Official Music Video)(MP3_160K).mp3', poster_url: 'assets/posters/Die_With_A_Smile_Poster.jpg', duration: '3:55', release_date: '2023-10-01' },
  { title: 'I Think They Call This Love', artist: 'Elliot James Reay', genre: 'Romantic', file_path: 'assets/songs/english/Elliot James Reay - I Think They Call This Love (Lyrics)(MP3_160K).mp3', poster_url: 'assets/posters/I_Think_They_Call_This_Love_Poster.jpg', duration: '3:15', release_date: '2023-10-01' },
  { title: 'Let Me Down Slowly', artist: 'Alec Benjamin', genre: 'Pop', file_path: 'assets/songs/english/Alec Benjamin - Let Me Down Slowly (Lyrics)(MP3_160K).mp3', poster_url: 'assets/posters/Let_Me_Down_Slowly_Poster.jpg', duration: '2:50', release_date: '2023-10-01' },
  { title: 'Perfect', artist: 'Ed Sheeran', genre: 'Romantic', file_path: 'assets/songs/english/Ed Sheeran - Perfect (D-Day Music Video)(MP3_160K).mp3', poster_url: 'assets/posters/Perfect_Poster.jpg', duration: '4:25', release_date: '2023-10-01' },
];

async function seed() {
  await connectDB();

  await Song.deleteMany({});
  await Song.insertMany(songs.map((s) => ({ ...s, release_date: new Date(s.release_date) })));
  console.log(`Seeded ${songs.length} songs`);

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@melodify.com';
  const adminPassword = process.env.ADMIN_PASSWORD || generateRandomPassword();
  if (!(await User.findOne({ email: adminEmail }))) {
    await User.create({
      email: adminEmail,
      password: await bcrypt.hash(adminPassword, 10),
      name: 'Administrator',
      dob: new Date('1990-01-01'),
      gender: 'prefer_not_to_say',
      country: 'Bangladesh',
      role: 'admin',
    });
    console.log(`Created admin user ${adminEmail}`);
    if (!process.env.ADMIN_PASSWORD) {
      console.log('==============================================================');
      console.log('  No ADMIN_PASSWORD was set in server/.env');
      console.log(`  A random password was generated for ${adminEmail}:`);
      console.log(`    ${adminPassword}`);
      console.log('  Save it somewhere safe (it is only printed this one time).');
      console.log('==============================================================');
    }
  }

  await Report.deleteMany({});
  await Report.insertMany([
    { type: 'report', user_email: 'user1@example.com', content_id: '1', reason: 'Inappropriate content', status: 'pending' },
    { type: 'claim', user_email: 'user2@example.com', content_id: '2', reason: 'Copyright violation', status: 'pending' },
    { type: 'report', user_email: 'user3@example.com', content_id: '3', reason: 'Spam', status: 'resolved' },
  ]);

  await Subscription.deleteMany({});
  await Subscription.insertMany([
    { user_email: 'user1@example.com', status: 'active', end_date: new Date('2025-12-31'), amount: 9.99 },
    { user_email: 'user2@example.com', status: 'expired', end_date: new Date('2025-01-01'), amount: 9.99 },
  ]);

  console.log('Seed complete');
  await mongoose.connection.close();
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});