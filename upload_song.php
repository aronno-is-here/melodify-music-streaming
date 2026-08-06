<?php
header('Content-Type: application/json');

$host = 'localhost';
$dbname = 'melodify_db';
$username = 'root';
$password = '';

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $title = $_POST['title'] ?? '';
        $artist = $_POST['artist'] ?? '';
        $genre = $_POST['genre'] ?? '';
        $duration = $_POST['duration'] ?? '3:00';
        $release_date = $_POST['release_date'] ?? '2023-01-01';

        // Validate inputs
        if (empty($title) || empty($artist) || empty($genre)) {
            echo json_encode(['success' => false, 'error' => 'Title, artist, and genre are required']);
            exit;
        }

        // Handle song file upload
        $song_dir = __DIR__ . '/Songs/' . $genre . ' songs/';
        if (!is_dir($song_dir)) {
            mkdir($song_dir, 0755, true);
        }
        $song_file = $_FILES['song_file'];
        $song_ext = strtolower(pathinfo($song_file['name'], PATHINFO_EXTENSION));
        if (!in_array($song_ext, ['mp3', 'wav'])) {
            echo json_encode(['success' => false, 'error' => 'Invalid song file format']);
            exit;
        }
        $song_filename = preg_replace('/[^A-Za-z0-9\-_\.]/', '_', $title) . '.' . $song_ext;
        $song_path = $song_dir . $song_filename;
        if (!move_uploaded_file($song_file['tmp_name'], $song_path)) {
            echo json_encode(['success' => false, 'error' => 'Failed to upload song file']);
            exit;
        }
        $relative_song_path = 'Songs/' . $genre . ' songs/' . $song_filename;

        // Handle poster file upload
        $poster_dir = __DIR__ . '/Posters/';
        if (!is_dir($poster_dir)) {
            mkdir($poster_dir, 0755, true);
        }
        $poster_file = $_FILES['poster_file'];
        $poster_ext = strtolower(pathinfo($poster_file['name'], PATHINFO_EXTENSION));
        if (!in_array($poster_ext, ['jpg', 'jpeg', 'png'])) {
            echo json_encode(['success' => false, 'error' => 'Invalid poster file format']);
            exit;
        }
        $poster_filename = preg_replace('/[^A-Za-z0-9\-_\.]/', '_', $title) . '.' . $poster_ext;
        $poster_path = $poster_dir . $poster_filename;
        if (!move_uploaded_file($poster_file['tmp_name'], $poster_path)) {
            echo json_encode(['success' => false, 'error' => 'Failed to upload poster file']);
            exit;
        }
        $relative_poster_path = 'Posters/' . $poster_filename;

        // Insert into database
        $stmt = $pdo->prepare("INSERT INTO songs (title, artist, genre, file_path, poster_url, duration, release_date) VALUES (:title, :artist, :genre, :file_path, :poster_url, :duration, :release_date)");
        $stmt->execute([
            'title' => $title,
            'artist' => $artist,
            'genre' => $genre,
            'file_path' => $relative_song_path,
            'poster_url' => $relative_poster_path,
            'duration' => $duration,
            'release_date' => $release_date
        ]);

        echo json_encode(['success' => true, 'message' => 'Song uploaded successfully']);
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid request method']);
    }
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>