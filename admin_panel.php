<?php
session_start();

// Database configuration
$host = 'localhost';
$dbname = 'melodify_db';
$username = 'root';
$password = ''; // Update with your MySQL password

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    die("Connection failed: " . $e->getMessage());
}

// Admin authentication (simple for demo; use JWT in production)
if (!isset($_SESSION['admin_logged_in'])) {
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['admin_login'])) {
        $admin_email = $_POST['admin_email'];
        $admin_pass = $_POST['admin_password'];
        if ($admin_email === 'admin@melodify.com' && $admin_pass === 'admin123') { // Demo credentials
            $_SESSION['admin_logged_in'] = true;
        } else {
            $login_error = "Invalid credentials. Demo: admin@melodify.com / admin123";
        }
    }
    if (!isset($_SESSION['admin_logged_in'])) {
        ?>
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Melodify - Admin Login</title>
            <style>
                body { background: #121212; color: #fff; font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .login-form { background: #1e1e1e; padding: 30px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); }
                .login-form h2 { text-align: center; color: #00b4d8; margin-bottom: 20px; }
                .login-form input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #00b4d8; border-radius: 5px; background: #2a2a2a; color: #fff; }
                .login-form button { width: 100%; padding: 10px; background: #00b4d8; color: #000; border: none; border-radius: 5px; cursor: pointer; }
                .error { color: #ff6b6b; text-align: center; margin: 10px 0; }
            </style>
        </head>
        <body>
            <form class="login-form" method="POST">
                <h2>Admin Login</h2>
                <?php if (isset($login_error)): ?><div class="error"><?php echo $login_error; ?></div><?php endif; ?>
                <input type="email" name="admin_email" placeholder="Email" required>
                <input type="password" name="admin_password" placeholder="Password" required>
                <button type="submit" name="admin_login">Login</button>
            </form>
        </body>
        </html>
        <?php
        exit();
    }
}

// Handle actions (e.g., add song, edit user)
$message = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['add_song'])) {
        $title = $_POST['title'];
        $artist = $_POST['artist'];
        $genre = $_POST['genre'];
        $duration = $_POST['duration'];
        $poster_url = $_POST['poster_url'];
        $file_path = $_POST['file_path'];
        $release_date = $_POST['release_date'];
        $stmt = $pdo->prepare("INSERT INTO songs (title, artist, genre, file_path, poster_url, duration, release_date) VALUES (?, ?, ?, ?, ?, ?, ?)");
        if ($stmt->execute([$title, $artist, $genre, $file_path, $poster_url, $duration, $release_date])) {
            $message = "Song added successfully!";
        } else {
            $message = "Error adding song.";
        }
    }
    // Add similar handling for other actions (edit user, ban, etc.)
}

// Fetch data
$users = $pdo->query("SELECT * FROM users LIMIT 20")->fetchAll(PDO::FETCH_ASSOC);
$songs = $pdo->query("SELECT * FROM songs LIMIT 20")->fetchAll(PDO::FETCH_ASSOC);
$reports = $pdo->query("SELECT * FROM moderation_reports LIMIT 10")->fetchAll(PDO::FETCH_ASSOC); // Assume moderation_reports table
$analytics = [
    'total_users' => $pdo->query("SELECT COUNT(*) FROM users")->fetchColumn(),
    'total_songs' => $pdo->query("SELECT COUNT(*) FROM songs")->fetchColumn(),
    'daily_plays' => rand(1000, 5000), // Demo
    'revenue' => rand(1000, 5000) // Demo
];
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Melodify Admin Panel</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;700&display=swap" rel="stylesheet">
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
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Roboto', sans-serif; }
        body { background: var(--primary-black); color: var(--white); }
        .header { background: var(--sky-blue); color: var(--white); padding: 10px 20px; display: flex; justify-content: space-between; align-items: center; }
        .nav { display: flex; gap: 20px; }
        .nav a { color: var(--white); text-decoration: none; padding: 5px 10px; border-radius: 4px; transition: background 0.3s; }
        .nav a:hover { background: var(--light-blue); }
        .logout-btn { background: #ff6b6b; color: var(--white); border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; }
        .main { display: flex; height: calc(100vh - 60px); }
        .sidebar { width: 250px; background: var(--secondary-black); padding: 20px; }
        .sidebar h3 { margin-bottom: 10px; color: var(--sky-blue); }
        .sidebar ul { list-style: none; }
        .sidebar li { margin: 5px 0; }
        .sidebar a { color: var(--gray); text-decoration: none; display: block; padding: 10px; border-radius: 4px; transition: background 0.3s; }
        .sidebar a:hover, .sidebar a.active { background: var(--sky-blue); color: var(--white); }
        .content { flex: 1; padding: 20px; overflow-y: auto; }
        .card { background: var(--secondary-black); padding: 20px; margin-bottom: 20px; border-radius: 8px; border: 1px solid var(--sky-blue); }
        .card h2 { color: var(--sky-blue); margin-bottom: 15px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid var(--gray); }
        th { background: var(--accent-black); }
        .btn { background: var(--sky-blue); color: var(--white); border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; margin: 2px; }
        .btn:hover { background: var(--light-blue); }
        .btn-danger { background: #ff6b6b; }
        .form-group { margin-bottom: 15px; }
        .form-group label { display: block; margin-bottom: 5px; }
        .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 8px; background: var(--accent-black); border: 1px solid var(--gray); border-radius: 4px; color: var(--white); }
        .message { padding: 10px; margin-bottom: 10px; border-radius: 4px; }
        .success { background: #4caf50; color: var(--white); }
        .error { background: #ff6b6b; color: var(--white); }
        @media (max-width: 768px) { .sidebar { width: 100%; } .main { flex-direction: column; } }
    </style>
</head>
<body>
    <div class="header">
        <h1>Melodify Admin Panel</h1>
        <div>
            <a href="logout.php" class="logout-btn">Logout</a>
        </div>
    </div>
    <div class="main">
        <nav class="sidebar">
            <h3>Navigation</h3>
            <ul>
                <li><a href="#dashboard" class="active">Dashboard</a></li>
                <li><a href="#users">User Management</a></li>
                <li><a href="#music">Music Catalog</a></li>
                <li><a href="#moderation">Content Moderation</a></li>
                <li><a href="#analytics">Analytics</a></li>
                <li><a href="#subscriptions">Subscriptions</a></li>
                <li><a href="#settings">System Settings</a></li>
            </ul>
        </nav>
        <main class="content">
            <?php if (isset($message)): ?>
                <div class="message <?php echo strpos($message, 'successfully') !== false ? 'success' : 'error'; ?>"><?php echo $message; ?></div>
            <?php endif; ?>

            <!-- Dashboard Section -->
            <div id="dashboard" class="card">
                <h2>Dashboard</h2>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px;">
                    <div class="card">
                        <h3>Total Users: <?php echo $analytics['total_users']; ?></h3>
                    </div>
                    <div class="card">
                        <h3>Total Songs: <?php echo $analytics['total_songs']; ?></h3>
                    </div>
                    <div class="card">
                        <h3>Daily Plays: <?php echo $analytics['daily_plays']; ?></h3>
                    </div>
                    <div class="card">
                        <h3>Revenue: $<?php echo $analytics['revenue']; ?></h3>
                    </div>
                </div>
            </div>

            <!-- User Management Section -->
            <div id="users" class="card" style="display: none;">
                <h2>User Management</h2>
                <input type="text" placeholder="Search users..." id="userSearch" style="width: 100%; padding: 10px; margin-bottom: 10px; background: var(--accent-black); border: 1px solid var(--gray); color: var(--white); border-radius: 4px;">
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Subscription</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="userTable">
                        <?php foreach ($users as $user): ?>
                            <tr>
                                <td><?php echo $user['id']; ?></td>
                                <td><?php echo htmlspecialchars($user['name']); ?></td>
                                <td><?php echo htmlspecialchars($user['email']); ?></td>
                                <td><?php echo $user['subscription_status'] ?? 'Trial'; ?></td>
                                <td>
                                    <button class="btn" onclick="editUser(<?php echo $user['id']; ?>)">Edit</button>
                                    <button class="btn btn-danger" onclick="banUser(<?php echo $user['id']; ?>)">Ban</button>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>

            <!-- Music Catalog Section -->
            <div id="music" class="card" style="display: none;">
                <h2>Music Catalog</h2>
                <form method="POST">
                    <div class="form-group">
                        <label>Title</label>
                        <input type="text" name="title" required>
                    </div>
                    <div class="form-group">
                        <label>Artist</label>
                        <input type="text" name="artist" required>
                    </div>
                    <div class="form-group">
                        <label>Genre</label>
                        <select name="genre" required>
                            <option value="Pop">Pop</option>
                            <option value="Rock">Rock</option>
                            <option value="Bengali">Bengali</option>
                            <option value="Hindi">Hindi</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Duration</label>
                        <input type="text" name="duration" placeholder="3:45" required>
                    </div>
                    <div class="form-group">
                        <label>Poster URL</label>
                        <input type="text" name="poster_url" required>
                    </div>
                    <div class="form-group">
                        <label>File Path</label>
                        <input type="text" name="file_path" required>
                    </div>
                    <div class="form-group">
                        <label>Release Date</label>
                        <input type="date" name="release_date" required>
                    </div>
                    <button type="submit" name="add_song" class="btn">Add Song</button>
                </form>
                <table style="margin-top: 20px;">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Title</th>
                            <th>Artist</th>
                            <th>Genre</th>
                            <th>Duration</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($songs as $song): ?>
                            <tr>
                                <td><?php echo $song['id']; ?></td>
                                <td><?php echo htmlspecialchars($song['title']); ?></td>
                                <td><?php echo htmlspecialchars($song['artist']); ?></td>
                                <td><?php echo htmlspecialchars($song['genre']); ?></td>
                                <td><?php echo htmlspecialchars($song['duration']); ?></td>
                                <td>
                                    <button class="btn" onclick="editSong(<?php echo $song['id']; ?>)">Edit</button>
                                    <button class="btn btn-danger" onclick="deleteSong(<?php echo $song['id']; ?>)">Delete</button>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>

            <!-- Content Moderation Section -->
            <div id="moderation" class="card" style="display: none;">
                <h2>Content Moderation</h2>
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Type</th>
                            <th>User</th>
                            <th>Content ID</th>
                            <th>Reason</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($reports as $report): ?>
                            <tr>
                                <td><?php echo $report['id']; ?></td>
                                <td><?php echo htmlspecialchars($report['type']); ?></td>
                                <td><?php echo htmlspecialchars($report['user_email']); ?></td>
                                <td><?php echo htmlspecialchars($report['content_id']); ?></td>
                                <td><?php echo htmlspecialchars($report['reason']); ?></td>
                                <td><?php echo htmlspecialchars($report['status']); ?></td>
                                <td>
                                    <button class="btn" onclick="resolveReport(<?php echo $report['id']; ?>)">Resolve</button>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>

            <!-- Analytics Section -->
            <div id="analytics" class="card" style="display: none;">
                <h2>Analytics Dashboard</h2>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px;">
                    <div class="card">
                        <h3>Total Users: <?php echo $analytics['total_users']; ?></h3>
                    </div>
                    <div class="card">
                        <h3>Total Songs: <?php echo $analytics['total_songs']; ?></h3>
                    </div>
                    <div class="card">
                        <h3>Daily Plays: <?php echo $analytics['daily_plays']; ?></h3>
                    </div>
                    <div class="card">
                        <h3>Revenue: $<?php echo $analytics['revenue']; ?></h3>
                    </div>
                </div>
                <canvas id="userGrowthChart" width="400" height="200"></canvas>
                <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
                <script>
                    const ctx = document.getElementById('userGrowthChart').getContext('2d');
                    const chart = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: ['Jan', 'Feb', 'Mar', 'Apr'],
                            datasets: [{ label: 'User Growth', data: [100, 150, 200, 250], borderColor: '#00b4d8' }]
                        },
                        options: { responsive: true }
                    });
                </script>
            </div>

            <!-- Subscription Management Section -->
            <div id="subscriptions" class="card" style="display: none;">
                <h2>Subscription & Payment Management</h2>
                <table>
                    <thead>
                        <tr>
                            <th>User ID</th>
                            <th>User Email</th>
                            <th>Status</th>
                            <th>End Date</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php 
                        $subscriptions = $pdo->query("SELECT * FROM subscriptions LIMIT 10")->fetchAll(PDO::FETCH_ASSOC); // Assume subscriptions table
                        foreach ($subscriptions as $sub): ?>
                            <tr>
                                <td><?php echo $sub['user_id']; ?></td>
                                <td><?php echo htmlspecialchars($sub['email']); ?></td>
                                <td><?php echo $sub['status']; ?></td>
                                <td><?php echo $sub['end_date']; ?></td>
                                <td>
                                    <button class="btn" onclick="extendSubscription(<?php echo $sub['id']; ?>)">Extend</button>
                                    <button class="btn btn-danger" onclick="cancelSubscription(<?php echo $sub['id']; ?>)">Cancel</button>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>

            <!-- System Settings Section -->
            <div id="settings" class="card" style="display: none;">
                <h2>System Settings</h2>
                <form method="POST">
                    <div class="form-group">
                        <label>Default Theme</label>
                        <select name="theme">
                            <option value="dark">Dark</option>
                            <option value="light">Light</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Max Downloads per User</label>
                        <input type="number" name="max_downloads" value="5">
                    </div>
                    <button type="submit" name="save_settings" class="btn">Save Settings</button>
                </form>
            </div>
        </main>
    </div>

    <script>
        // Navigation script
        document.querySelectorAll('.sidebar a').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.card').forEach(card => card.style.display = 'none');
                const targetId = link.getAttribute('href').substring(1);
                document.getElementById(targetId).style.display = 'block';
                document.querySelectorAll('.sidebar a').forEach(a => a.classList.remove('active'));
                link.classList.add('active');
            });
        });

        // Demo functions for actions
        function editUser(id) { alert('Editing user ' + id); }
        function banUser(id) { alert('Banning user ' + id); }
        function editSong(id) { alert('Editing song ' + id); }
        function deleteSong(id) { if (confirm('Delete song?')) alert('Deleted ' + id); }
        function resolveReport(id) { alert('Resolved report ' + id); }
        function extendSubscription(id) { alert('Extended ' + id); }
        function cancelSubscription(id) { alert('Canceled ' + id); }

        // User search
        document.getElementById('userSearch').addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const rows = document.querySelectorAll('#userTable tr');
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(query) ? '' : 'none';
            });
        });
    </script>
</body>
</html>