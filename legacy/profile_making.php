<?php
// Database configuration
$host = 'localhost';
$dbname = 'melodify_db';
$username = 'root';
$password = ''; // Your MySQL password

try {
    // Create database connection
    $pdo = new PDO("mysql:host=$host;dbname=$dbname", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // Check if form is submitted
    if ($_SERVER["REQUEST_METHOD"] == "POST") {
        // Get and sanitize input
        $email = filter_var(trim($_POST["email"]), FILTER_SANITIZE_EMAIL);
        $name = filter_var(trim($_POST["name"]), FILTER_SANITIZE_STRING);
        $day = filter_var(trim($_POST["day"]), FILTER_SANITIZE_NUMBER_INT);
        $month = filter_var(trim($_POST["month"]), FILTER_SANITIZE_NUMBER_INT);
        $year = filter_var(trim($_POST["year"]), FILTER_SANITIZE_NUMBER_INT);
        $dob = "$year-$month-$day";
        $gender = filter_var(trim($_POST["gender"]), FILTER_SANITIZE_STRING);
        $country = filter_var(trim($_POST["country"]), FILTER_SANITIZE_STRING);

        // Hash the password
        // $hashed_password = password_hash(trim($_POST["password"]), PASSWORD_DEFAULT);
        $password=$_POST['password'];
        // Basic validation
        if (empty($name) || empty($dob) || empty($gender) || empty($country) || empty($email) || empty($_POST["password"])) {
            die("All fields are required. <a href='javascript:history.back()'>Go back</a>");
        }

        // Validate date
        if (!checkdate($month, $day, $year)) {
            die("Invalid date of birth. <a href='javascript:history.back()'>Go back</a>");
        }

        // Insert user into database
        $stmt = $pdo->prepare("INSERT INTO users (name, password, dob, gender, country, email)
                               VALUES (:name, :password, :dob, :gender, :country, :email)");
        $stmt->execute([
            'name' => $name,
            'password' => $password,
            'dob' => $dob,
            'gender' => $gender,
            'country' => $country,
            'email' => $email
        ]);

        // Start session and store user email
        session_start();
        $_SESSION['user_email'] = $email;

        // Redirect to dashboard
        header("Location: ./user_dashboard.html");
        exit();
    }
} catch (PDOException $e) {
    die("Connection failed: " . $e->getMessage());
}
?>