<?php
session_start();
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

        // Validate email
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            die("Invalid email format. <a href='javascript:history.back()'>Go back</a>");
        }

        // Check if email already exists
        $stmt = $pdo->prepare("SELECT email FROM users WHERE email = :email");
        $stmt->execute(['email' => $email]);
        if ($stmt->rowCount() > 0) {
            die("Email already registered. <a href='javascript:history.back()'>Go back</a>");
        }

        // Store email in session and redirect to password creation page
        $_SESSION['signup_email'] = $email;
        header("Location: password_page.php");
        exit();
    }
} catch (PDOException $e) {
    die("Connection failed: " . $e->getMessage());
}
?>