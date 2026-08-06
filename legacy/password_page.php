<?php
session_start();

$email=$_SESSION['signup_email'];

?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Melodify - Create Password</title>
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

        .password-container {
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

        .progress-indicator {
            font-size: 14px;
            color: var(--gray);
            margin-bottom: 20px;
        }

        .progress-bar {
            height: 5px;
            background-color: var(--accent-black);
            border-radius: 5px;
            margin-bottom: 20px;
        }

        .progress-bar-fill {
            height: 100%;
            background-color: var(--sky-blue);
            width: 33.33%; /* Step 1 of 3 */
            border-radius: 5px;
        }

        .signup-title {
            font-size: 24px;
            margin-bottom: 20px;
        }

        .form-group {
            text-align: left;
            margin-bottom: 20px;
        }

        .form-group label {
            display: block;
            margin-left: 5px;
            margin-bottom: 5px;
            font-size: 14px;
            color: var(--gray);
        }

 

        .password-input {
            position: relative;
        }

        .password-input input {
            width: 100%;
            padding: 10px 40px 10px 10px;
            border: 1px solid var(--gray);
            border-radius: 20px;
            background-color: var(--accent-black);
            color: var(--white);
            font-size: 14px;
        }

        .toggle-password {
            position: absolute;
            top: 50%;
            right: 10px;
            transform: translateY(-50%);
            cursor: pointer;
            color: var(--gray);
            font-size: 18px;
        }

        .password-requirements h3 {
            font-size: 16px;
            margin-bottom: 10px;
        }

        .password-requirements ul {
            list-style-type: disc;
            padding-left: 30px;
            padding-bottom: 15px;
            text-align: left;
        }

        .password-requirements li {
            margin-bottom: 5px;
            color: var(--gray);
        }

        li::marker{
            color: #00B4D8;
        }

        .requirement-icon {
            margin-right: 5px;
            color: var(--sky-blue);
        }

        .next-btn {
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

        .next-btn:hover {
            background-color: var(--light-blue);
        }

        .footer-text {
            margin-top: 20px;
            font-size: 12px;
            color: var(--gray);
        }

        .footer-text a {
            color: var(--sky-blue);
            text-decoration: none;
        }

        .footer-text a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="password-container">
        <div class="logo">MELOD<span>IFY</span></div>
        <div class="progress-indicator">Step 1 of 3</div>
        <div class="progress-bar">
            <div class="progress-bar-fill"></div>
        </div>

        <h2 class="signup-title">Create a password</h2>

        <form action="password.php" method="POST">
            <input type="hidden" name="email" value="<?php echo $email?>">

            <div class="form-group">
                <label for="password">Password</label>

                <div class="password-input">
                    <input type="password" id="password" name="password" placeholder="Enter your password" required>

                    <span class="toggle-password" onclick="togglePasswordVisibility()">👁️</span>
                </div>
            </div>

            <div class="password-requirements">
                <h3>Your password must contain at least</h3>

                <ul>
                    <li><span class="requirement-icon"></span> 1 letter</li>
                    <li><span class="requirement-icon"></span> 1 number or special character (example: #?!&)</li>
                    <li><span class="requirement-icon"></span> 10 characters</li>
                </ul>
            </div>

            <button type="submit" class="next-btn">Next</button>
        </form>

        <div class="footer-text">This site is protected by reCAPTCHA and the Google <a href="https://policies.google.com/privacy">Privacy Policy</a> and <a href="https://policies.google.com/terms">Terms of Service</a> apply.</div>
    </div>




    <script>
        function togglePasswordVisibility() {
            const passwordInput = document.getElementById("password");
            const toggleIcon = document.querySelector(".toggle-password");
            if (passwordInput.type === "password") {
                passwordInput.type = "text";
                toggleIcon.textContent = "👁️‍🗨️"; // Change icon to indicate visibility
            } else {
                passwordInput.type = "password";
                toggleIcon.textContent = "👁️"; // Revert to default eye icon
            }
        }
    </script>



</body>
</html>