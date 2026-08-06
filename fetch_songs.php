<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$host = 'localhost';
$dbname = 'melodify_db';
$username = 'root';
$password = '';

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // Fetch all songs (limit to 4 for display)
    $stmt = $pdo->query("SELECT id, title, artist, genre, file_path, poster_url, duration, release_date FROM songs LIMIT 4");
    $songs = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Verify poster file existence
    $base_dir = __DIR__ . '/Posters/';
    foreach ($songs as &$song) {
        $poster_path = $song['poster_url'];
        $full_path = $base_dir . basename($poster_path);
        if (!file_exists($full_path) || !is_file($full_path)) {
            $song['poster_url'] = 'Posters/default_poster.jpg';
        }
    }
    unset($song);

    echo json_encode(['success' => true, 'songs' => $songs]);
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>