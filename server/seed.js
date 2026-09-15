import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import Song from './models/Song.js';
import User from './models/User.js';
import Report from './models/Report.js';
import Subscription from './models/Subscription.js';
import Playlist from './models/Playlist.js';

dotenv.config();

function generateRandomPassword() {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$';
  return Array.from(crypto.randomBytes(18)).map((b) => chars[b % chars.length]).join('');
}

const yt = (id) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`;

const lyrics = {
  khamoshiyan: `ख़ामोशियाँ आवाज़ हैं
तुम सुनने तो आओ कभी
छूकर तुम्हें खिल जाएँगी
घर इनको बुलाओ कभी
बेक़रार हैं बात करने को
कहने दो इनको ज़रा

ख़ामोशियाँ, तेरी-मेरी ख़ामोशियाँ
ख़ामोशियाँ, लिपटी हुईं ख़ामोशियाँ

क्या उस गली में कभी तेरा जाना हुआ
जहाँ से ज़माने को गुज़रे ज़माना हुआ
मेरा समय तो वहीं पे है ठहरा हुआ
बताऊँ तुम्हें क्या मेरे साथ क्या-क्या हुआ

ख़ामोशियाँ एक साज़ है
तुम धुन कोई लाओ ज़रा
ख़ामोशियाँ अल्फ़ाज़ हैं
कभी आ, गुनगुना ले ज़रा
बेक़रार हैं बात करने को
कहने दो इनको ज़रा

ख़ामोशियाँ, तेरी-मेरी ख़ामोशियाँ
ख़ामोशियाँ, लिपटी हुईं ख़ामोशियाँ

नदिया का पानी भी ख़ामोश बहता यहाँ
खिली चाँदनी में छिपी लाख ख़ामोशियाँ
बारिश की बूँदों की होती कहाँ है ज़ुबान
सुलगते दिलों में है ख़ामोश उठता धुआँ

ख़ामोशियाँ आकाश हैं
तुम उड़ने तो आओ ज़रा
ख़ामोशियाँ एहसास हैं
तुम्हें महसूस होती हैं क्या?
बेक़रार हैं बात करने को
कहने दो इनको ज़रा

ख़ामोशियाँ, तेरी-मेरी ख़ामोशियाँ
ख़ामोशियाँ, लिपटी हुईं ख़ामोशियाँ
ख़ामोशियाँ, तेरी-मेरी ख़ामोशियाँ
ख़ामोशियाँ, लिपटी हुई ख़ामोशियाँ`,

  hasiBanGaye: `हाँ हँसी बन गए
हाँ नमी बन गए
तुम मेरे आसमान
मेरी ज़मीन बन गए

हाँ हँसी बन गए
हाँ नमी बन गए
तुम मेरे आसमान
मेरी ज़मीन बन गए

हाँ हम बदलने लागे
गिरने सँभलने लागे
जब से है जाना तुम्हें
तेरी ओर चलने लागे

हाँ हम बदलने लागे
गिरने सँभलने लागे
जब से है जाना तुम्हें
तेरी ओर चलने लागे

हर सफ़र हर जगह
हर कहीं बन गए
मानते थे ख़ुदा
और हाँ वही बन गए

हाँ हँसी बन गए
हाँ नमी बन गए
तुम मेरे आसमान
मेरी ज़मीन बन गए

पहचानते ही नहीं अब लोग तन्हा मुझे
मेरी निगाहों में भी हैं ढूँढते वो तुझे
पहचानते ही नहीं अब लोग तन्हा मुझे
मेरी निगाहों में भी हैं ढूँढते वो तुझे

हम थे ढूँढते जिसे वो कमी बन गए
तुम मेरे इश्क़ की सर-ज़मीन बन गए

हाँ हँसी बन गए
हाँ नमी बन गए
तुम मेरे आसमान
मेरी ज़मीन बन गए

हाँ हँसी बन गए
हाँ नमी बन गए
तुम मेरे आसमान
मेरी ज़मीन बन गए`,

  labonKo: `लबों को लबों पे सजाओ क्या हो तुम, मुझे अब बताओ
लबों को लबों पे सजाओ क्या हो तुम, मुझे अब बताओ

तोड़ दो ख़ुद को तुम बाहों में मेरी
बाहों में मेरी, बाहों में मेरी, बाहों में
बाहों में मेरी, बाहों में मेरी, बाहों में

तेरे एहसासों में, भीगे लम्हातों में
मुझको डूबा, तिश्नगी सी है
तेरी अदाओं से, दिलकश ख़तों से
इन लम्हों में ज़िंदगी सी है

हया को ज़रा भूल जाओ
मेरी ही तरह पेश आओ
खो भी दो ख़ुद को तुम रातों में मेरी
रातों में मेरी, रातों में मेरी, रातों में...

लबों को लबों पे सजाओ क्या हो तुम, मुझे अब बताओ

तेरे जज़्बातों में, महकी सी साँसों में
ये जो महक संदली सी है
दिल की पनाहों में, बिखरी सी आहों में
सोने की ख़्वाहिश जगी सी है

चेहरे से चेहरा छुपाओ
सीने की धड़कन सुनाओ
देख लो ख़ुद को तुम आँखों में मेरी
आँखों में मेरी, आँखों में मेरी, आँखों में

लबों को लबों पे सजाओ क्या हो तुम, मुझे अब बताओ`,

  surajDoobaHae: `मतलबी हो जा ज़रा मतलबी
दुनिया की सुनता है क्यों
ख़ुद की भी सुन ले कभी

मतलबी हो जा ज़रा मतलबी
दुनिया की सुनता है क्यों
ख़ुद की भी सुन ले कभी

कुछ बात ग़लत भी हो जाए
कुछ देर ये दिल खो जाए
बेफ़िक्र धड़कने, इस तरह से चले
शोर गूँजे यहां से वहाँ

सूरज डूबा है यारों
दो घूँट नशे के मारो
रस्ते भुला दो सारे घरबार के

सूरज डूबा है यारों
दो घूँट नशे के मारो
ग़म तुम भुला दो सारे संसार के

Ask me for anything
I can give you everything
रास्ते भुला दे सारे संसार के
ओ ओ...

अता पता रहे ना किसी का हमें
यही कहे ये पल ज़िंदगी का हमें
अता पता रहे ना किसी का
यही कहे ये पल ज़िंदगी का

की ख़ुदग़र्ज़ सी, ख्वाहिश लिए
बे-सांस भी हम तुम जियें
है गुलाबी गुलाबी समां

सूरज डूबा है यारों
दो घूँट नशे के मारो
रस्ते भुला दो सारे घरबार के

सूरज डूबा है यारों
दो घूँट नशे के मारो
ग़म तुम भुला दो सारे संसार के

मतलबी हो जा ज़रा मतलबी
दुनिया की सुनता है क्यों
ख़ुद की भी सुन ले कभी

चलें नहीं उड़े आसमां पे अभी
पता ना हो है जाना कहाँ पे अभी
चलें नहीं उड़े आसमां पे
पता ना हो है जाना कहाँ पे

कि बे-मंज़िलें हो सब रास्ते
दुनिया से हो ज़रा फ़ासले
कुछ ख़ुद से भी हो दूरियां

सूरज डूबा है यारों
दो घूँट नशे के मारो
रस्ते भुला दो सारे घरबार के

सूरज डूबा है यारों
दो घूँट नशे के मारो
ग़म तुम भुला दो सारे संसार के

Ask me for anything
I can give you everything
Ask me for anything
I can give you everything
ओ ओ ओ...`,
};

const songs = [
  { title: 'Amar Dehokhan', artist: 'Odd Signature', genre: 'Melodious', youtube_id: 'OUu19JIk-_k', poster_url: yt('OUu19JIk-_k'), duration: '7:10', release_date: '2020-10-25' },
  { title: 'Bhalobasha Tarpor', artist: 'Arnob', genre: 'Romantic', youtube_id: 'sjRZJByUGGg', poster_url: yt('sjRZJByUGGg'), duration: '4:34', release_date: '2025-02-28' },
  { title: 'Dukkho Bilash', artist: 'Artcell', genre: 'Metal', youtube_id: 'ECh1rS2ipJw', poster_url: yt('ECh1rS2ipJw'), duration: '6:42', release_date: '2002-01-30' },
  { title: 'Keno Hothat Tumi Ele', artist: 'Tahsan', genre: 'Bengali', youtube_id: 'gXxYPU2dsnQ', poster_url: yt('gXxYPU2dsnQ'), duration: '4:43', release_date: '2020-06-14' },
  { title: 'Nisshash', artist: 'G.M. Ashraf', genre: 'Bengali', youtube_id: 'VHz3srJjAV4', poster_url: yt('VHz3srJjAV4'), duration: '5:22', release_date: '2025-03-28' },
  { title: 'Khamoshiyan', artist: 'Arijit Singh', genre: 'Love', youtube_id: 'c0viCB5k3Mg', poster_url: yt('c0viCB5k3Mg'), duration: '3:17', release_date: '2015-03-19', lyrics: lyrics.khamoshiyan },
  { title: 'Hasi Ban Gaye', artist: 'Ami Mishra', genre: 'Romantic', youtube_id: '5c9iFQZE74E', poster_url: yt('5c9iFQZE74E'), duration: '2:45', release_date: '2023-06-09', lyrics: lyrics.hasiBanGaye },
  { title: 'Labon Ko', artist: 'K.K.', genre: 'Romantic', youtube_id: 'vlbsHZfM2mY', poster_url: yt('vlbsHZfM2mY'), duration: '5:41', release_date: '2007-09-05', lyrics: lyrics.labonKo },
  { title: 'Suraj Dooba Hae', artist: 'Arijit Singh', genre: 'Happy', youtube_id: 'nJZcbidTutE', poster_url: yt('nJZcbidTutE'), duration: '4:24', release_date: '2014-12-19', lyrics: lyrics.surajDoobaHae },
  { title: 'Comfortably Numb', artist: 'Pink Floyd', genre: 'Pop', youtube_id: '4FLjT5V5Hog', poster_url: yt('4FLjT5V5Hog'), duration: '6:22', release_date: '1979-11-30' },
  { title: 'Die with a smile', artist: 'Bruno Mars and Lady Gaga', genre: 'Romantic', youtube_id: 'Fn6Ul6sYqro', poster_url: yt('Fn6Ul6sYqro'), duration: '4:11', release_date: '2024-08-16' },
  { title: 'I Think They Call This Love', artist: 'Elliot James Reay', genre: 'Romantic', youtube_id: 'e1mOmdykmwI', poster_url: yt('e1mOmdykmwI'), duration: '3:09', release_date: '2024-07-17' },
  { title: 'Let Me Down Slowly', artist: 'Alec Benjamin', genre: 'Pop', youtube_id: '50VNCymT-Cs', poster_url: yt('50VNCymT-Cs'), duration: '2:58', release_date: '2018-11-23' },
  { title: 'Perfect', artist: 'Ed Sheeran', genre: 'Romantic', youtube_id: '2Vv-BfVoq4g', poster_url: yt('2Vv-BfVoq4g'), duration: '4:23', release_date: '2017-09-26' },
];

async function seed() {
  await connectDB();

  await Song.deleteMany({});
  await Song.insertMany(songs.map((s) => ({ ...s, release_date: new Date(s.release_date) })));
  console.log(`Seeded ${songs.length} songs (${songs.filter((s) => s.lyrics).length} with lyrics)`);

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
  const futureDate = new Date();
  futureDate.setMonth(futureDate.getMonth() + 3);
  const pastDate = new Date();
  pastDate.setMonth(pastDate.getMonth() - 1);
  await Subscription.insertMany([
    { user_email: 'user1@example.com', status: 'active', end_date: futureDate, plan: 'Individual', amount: 219 },
    { user_email: 'user2@example.com', status: 'expired', end_date: pastDate, plan: 'Student', amount: 109 },
  ]);

  await Playlist.deleteMany({});
  if (process.env.ADMIN_EMAIL || process.env.ADMIN_PASSWORD) {
    const dbSongs = await Song.find();
    const byTitle = Object.fromEntries(dbSongs.map((s) => [s.title.toLowerCase(), s]));
    const picks = (titles) => titles.map((t) => byTitle[t.toLowerCase()]).filter(Boolean).map((s) => ({ songId: s._id }));
    const playlists = [];
    if (byTitle['perfect'] && byTitle['let me down slowly'] && byTitle['i think they call this love'] && byTitle['die with a smile']) {
      playlists.push({ user_email: adminEmail, title: 'My English Mix', items: picks(['Perfect', 'Let Me Down Slowly', 'I Think They Call This Love', 'Die with a smile']) });
    }
    if (byTitle['dukkho bilash'] && byTitle['amar dehokhan'] && byTitle['nisshash'] && byTitle['keno hothat tumi ele']) {
      playlists.push({ user_email: adminEmail, title: 'Bangla Rock Favorites', items: picks(['Dukkho Bilash', 'Amar Dehokhan', 'Nisshash', 'Keno Hothat Tumi Ele']) });
    }
    if (playlists.length) {
      await Playlist.insertMany(playlists);
      console.log(`Seeded ${playlists.length} playlists for ${adminEmail}`);
    }
  }

  console.log('Seed complete');
  await mongoose.connection.close();
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});