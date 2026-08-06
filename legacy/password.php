<?php
// Database configuration
$host = 'localhost';
$dbname = 'melodify_db';
$username = 'root'; // Change to your MySQL username
$password = '';     // Change to your MySQL password

try {
    // Create database connection
    $pdo = new PDO("mysql:host=$host;dbname=$dbname", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // Check if form is submitted
    if ($_SERVER["REQUEST_METHOD"] == "POST") {
        // Get and sanitize input
        $email = filter_var(trim($_POST["email"]), FILTER_SANITIZE_EMAIL);
        $password = trim($_POST["password"]);

        // Basic password validation (can be expanded)
        if (strlen($password) < 10 || !preg_match("/[a-zA-Z]/", $password) || !preg_match("/[0-9#?!&]/", $password)) {
            die("Password must contain at least 10 characters, 1 letter, and 1 number or special character. <a href='javascript:history.back()'>Go back</a>");
        }

        // Hash the password
       $hashed_password = password_hash($password, PASSWORD_DEFAULT);

        // Update the user's record with the hashed password
        // $stmt = $pdo->prepare("UPDATE users SET password = :password WHERE email = :email");
        // $stmt->execute(['password' => $hashed_password, 'email' => $email]);

        // Redirect to dashboard
       header("Location: profile_making_page.php?email=" . urlencode($email) . "&password=" . urlencode($hashed_password ));
        exit();
    }
} catch (PDOException $e) {
    die("Connection failed: " . $e->getMessage());
}
?>