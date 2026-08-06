CREATE DATABASE IF NOT EXISTS melodify_db;
USE melodify_db;

-- Users table with password nullable from start
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    dob DATE NOT NULL,
    gender ENUM('man', 'woman', 'prefer_not_to_say') NOT NULL,
    country VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Songs table (single creation)
CREATE TABLE songs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    artist VARCHAR(255) NOT NULL,
    genre VARCHAR(50) NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    poster_url VARCHAR(255) DEFAULT 'https://picsum.photos/150/150?random',
    duration VARCHAR(10) DEFAULT '3:00',
    release_date DATE DEFAULT '2023-01-01'
);

-- Playlists table (single creation)
CREATE TABLE playlists (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);

-- Playlist_songs junction table
CREATE TABLE playlist_songs (
    playlist_id INT,
    song_id INT,
    PRIMARY KEY (playlist_id, song_id),
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

/*CREATE TABLE moderation_reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    content_id INT NOT NULL,
    reason TEXT NOT NULL,
    status ENUM('pending', 'resolved', 'dismissed') DEFAULT 'pending',
    admin_notes TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);

INSERT INTO users (email, password, name, dob, gender, country) VALUES
('user1@example.com', 'hashed_password1', 'User One', '1990-01-01', 'man', 'India'),
('user2@example.com', 'hashed_password2', 'User Two', '1992-02-02', 'woman', 'Bangladesh'),
('user3@example.com', 'hashed_password3', 'User Three', '1985-03-03', 'prefer_not_to_say', 'USA');

INSERT INTO moderation_reports (type, user_email, content_id, reason, status) VALUES
('report', 'user1@example.com', 1, 'Inappropriate content', 'pending'),
('claim', 'user2@example.com', 2, 'Copyright violation', 'pending'),
('report', 'user3@example.com', 3, 'Spam', 'resolved'); 


CREATE TABLE subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    status ENUM('active', 'expired') DEFAULT 'active',
    end_date DATE,
    amount DECIMAL(10,2),
    FOREIGN KEY (user_email) REFERENCES users(email)
);

INSERT INTO subscriptions (user_email, status, end_date, amount) VALUES
('user1@example.com', 'active', '2025-12-31', 9.99),
('user2@example.com', 'expired', '2025-01-01', 9.99);


*/

-- Cleaned INSERT statement with consistent paths
INSERT INTO songs (title, artist, genre, file_path, poster_url, duration, release_date) VALUES
('Amar Dehokhan', 'Odd Signature', 'Melodious', 'songs/bengali/amar_dehokhan.mp3', 'posters/bengali/amar_dehokhan.jpg', '3:15', '2023-02-01'),
('Bhalobasha Tarpor', 'Arnob', 'Romantic', 'songs/bengali/bhalobasha_tarpor.mp3', 'posters/bengali/bhalobasha_tarpor.jpg', '4:00', '2023-03-01'),
('Dukkho Bilash', 'Artcell', 'Metal', 'songs/bengali/dukkho_bilash.mp3', 'posters/bengali/dukkho_bilash.jpg', '3:45', '2023-04-01'),
('Keno Hothat Tumi Ele', 'Romantic', 'Hindi', 'songs/hindi/keno_hothat.mp3', 'posters/hindi/keno_hothat.jpg', '3:30', '2023-05-01'),
('Nisshash', 'Borbaad', 'Rock', 'songs/hindi/nisshash.mp3', 'posters/hindi/nisshash.jpg', '4:15', '2023-06-01'),
('Khamoshiyan', 'Arijit Singh', 'Love', 'songs/hindi/khamoshiyan.mp3', 'posters/hindi/khamoshiyan.jpg', '3:50', '2023-07-01'),
('Hasi Ban Gaye', 'Ami Mishra', 'Romantic', 'songs/english/hasi_ban_gaye.mp3', 'posters/english/hasi_ban_gaye.jpg', '3:20', '2023-08-01'),
('Labon Ko', 'KK', 'Romantic', 'songs/english/labon_ko.mp3', 'posters/english/labon_ko.jpg', '4:10', '2023-09-01'),
('Suraj Dooba Hainn', 'Arijit', 'Happy', 'songs/english/suraj_dooba.mp3', 'posters/english/suraj_dooba.jpg', '3:55', '2023-10-01'),
('Comfortably Numb', 'Pink Floyd', 'Pop', 'songs/english/comfortably_numb.mp3', 'posters/english/comfortably_numb.jpg', '3:55', '2023-10-01'),
('Die with a smile', 'Bruno Mars and Lady Gaga', 'Romantic', 'songs/english/die_with_smile.mp3', 'posters/english/die_with_smile.jpg', '3:55', '2023-10-01');