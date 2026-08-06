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

    // Start session
    session_start();

    // Check if user is already logged in
    if (isset($_SESSION['user_email'])) {
        header("Location: user_dashboard.html");
        exit();
    }

    // Initialize error message
    $error = '';

    // Check if form is submitted
    if ($_SERVER["REQUEST_METHOD"] == "POST") {
        // Get and sanitize input
        $email = filter_var(trim($_POST["email"]), FILTER_SANITIZE_EMAIL);
       
        // $password = password_hash(trim($_POST["password"]), PASSWORD_DEFAULT);
        $password=filter_var(trim($_POST["password"]), FILTER_SANITIZE_EMAIL);
        

        // Basic validation
        if (empty($email) || empty($password)) {
            $error = "Email and password are required.";
        } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $error = "Invalid email format.";
        } else {
            // Check if user exists
            $stmt = $pdo->prepare("SELECT email, password FROM users WHERE email = :email");
            $stmt->execute(['email' => $email]);
            $user = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($user['email'] && password_verify($password, $user['password'])) {
                // Successful login
                $_SESSION['user_email'] = $email;
                header("Location: user_dashboard.html");
                exit();
            } else {
                $error = "Invalid email or password.";
            }
        }
    }
} catch (PDOException $e) {
    $error = "Connection failed: " . $e->getMessage();
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Melodify - Log In</title>
    <style>
        :root {
            --primary-black: #121212;
            --secondary-black: #1E1E1E;
            --accent-black: #2A2A2A;
            --sky-blue: #00B4D8;
            --light-blue: #90E0EF;
            --white: #FFFFFF;
            --gray: #B3B3B3;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }

        body {
            background-color: var(--primary-black);
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            color: var(--white);
        }

        .login-container {
            text-align: center;
            padding: 40px;
            background-color: var(--secondary-black);
            border-radius: 10px;
            box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
            width: 100%;
            max-width: 400px;
        }

        .logo {
            font-size: 40px;
            color: var(--sky-blue);
            margin-bottom: 20px;
        }

        .logo span {
            color: var(--white);
        }

        .login-title {
            font-size: 24px;
            margin-bottom: 20px;
        }

        .social-login-btn {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-bottom: 20px;
        }

        .social-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 10px;
            background-color: var(--white);
            color: var(--primary-black);
            border: none;
            border-radius: 20px;
            font-weight: bold;
            cursor: pointer;
            transition: background-color 0.3s ease;
        }

        .social-btn img {
            width: 20px;
            height: 20px;
            margin-right: 10px;
        }

        .social-btn:hover {
            background-color: var(--light-blue);
        }

        .google-btn { background-color: #fff; }
        .facebook-btn { background-color: #fff; }
        .apple-btn { background-color: #fff; }

        .form-group {
            text-align: left;
            margin-bottom: 20px;
        }

        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-size: 14px;
            color: var(--gray);
            padding-left: 10px;
        }

        .form-group input {
            width: 100%;
            padding: 10px;
            border: 1px solid var(--gray);
            border-radius: 20px;
            background-color: var(--accent-black);
            color: var(--white);
            font-size: 14px;
        }

        .form-group input:focus {
            border-color: var(--sky-blue);
            outline: none;
        }

        .continue-btn {
            width: 100%;
            padding: 12px;
            background-color: var(--sky-blue);
            color: var(--primary-black);
            border: none;
            border-radius: 20px;
            font-weight: bold;
            font-size: 16px;
            cursor: pointer;
            transition: background-color 0.3s ease;
        }

        .continue-btn:hover {
            background-color: var(--light-blue);
        }

        .or-separator {
            display: flex;
            align-items: center;
            margin: 20px 0;
            color: var(--gray);
        }

        .or-separator::before,
        .or-separator::after {
            content: '';
            flex-grow: 1;
            height: 1px;
            background-color: var(--gray);
            margin: 0 10px;
        }

        .social-signup-btn {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-bottom: 20px;
        }

        .social-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 10px;
            background-color: var(--white);
            color: var(--primary-black);
            border: none;
            border-radius: 20px;
            font-weight: bold;
            cursor: pointer;
            transition: background-color 0.3s ease;
            text-decoration: none;
        }

        .social-btn img {
            width: 20px;
            height: 20px;
            margin-right: 10px;
        }

        .social-btn:hover {
            background-color: var(--light-blue);
        }

        .google-btn { background-color: #fff; }

        .signup-link {
            margin-top: 20px;
            font-size: 14px;
            color: var(--gray);
        }

        .signup-link a {
            color: var(--sky-blue);
            text-decoration: none;
        }

        .signup-link a:hover {
            text-decoration: underline;
        }

        .message {
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 15px;
            text-align: center;
            background: #dc3545;
            color: var(--white);
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">MELOD<span>IFY</span></div>
        <div class="login-title">Log in to Melodify</div>
        <?php if (!empty($error)): ?>
            <div class="message"><?php echo htmlspecialchars($error); ?></div>
        <?php endif; ?>
        <form class="login-form" method="POST" action="login.php">
            <div class="form-group">
                <label for="email">Email</label>
                <input type="email" id="email" name="email" placeholder="Enter your email" required>
            </div>
            <div class="form-group">
                <label for="password">Password</label>
                <input type="password" id="password" name="password" placeholder="Enter your password" required>
            </div>
            <button type="submit" class="continue-btn">Continue</button>
        </form>
        <div class="or-separator">or</div>
        <div class="social-signup-btn">
            <a href="auth.php" class="social-btn google-btn">
                <img src="https://www.google.com/favicon.ico" alt="Google"> Continue with Google
            </a>
        </div>
        <div class="signup-link">Don't have an account? <a href="signup_page.html">Sign up for Melodify</a></div>
    </div>
</body>
</html>