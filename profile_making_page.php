<?php 

$email=$_GET['email'];
$password=$_GET['password'];

?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Melodify - Tell Us About Yourself</title>
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

        .profile-container {
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
            width: 66.67%;
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
            margin-bottom: 5px;
            font-size: 14px;
            color: var(--gray);
        }

        .form-group input,
        .form-group select {
            width: 100%;
            padding: 10px;
            border: 1px solid var(--gray);
            border-radius: 20px;
            background-color: var(--accent-black);
            color: var(--white);
            font-size: 14px;
        }

        .date-of-birth {
            display: flex;
            gap: 10px;
        }

        .date-of-birth select {
            flex: 1;
        }

        .gender-options {
            display: flex;
            justify-content: space-between;
        }

        .gender-option {
            display: flex;
            align-items: center;
        }

        .gender-option input {
            margin-right: 5px;
        }

        .country-select {
            width: 100%;
            padding: 10px;
            border: 1px solid var(--gray);
            border-radius: 20px;
            background-color: var(--accent-black);
            color: var(--white);
            font-size: 14px;
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
    <div class="profile-container">
        <div class="logo">MELOD<span>IFY</span></div>
        <div class="progress-indicator">Step 2 of 3</div>
        <div class="progress-bar">
            <div class="progress-bar-fill"></div>
        </div>
        <h2 class="signup-title">Tell us about yourself</h2>
        <form action="./profile_making.php" method="POST">
            <input type="hidden" name="email" id="email" value="<?php echo $email; ?>">
            <input type="hidden" name="password" id="password" value="<?php echo $password; ?>">
            <div class="form-group">
                <label for="name">Name</label>
                <input type="text" id="name" name="name" placeholder="Enter your name" required>
            </div>
            <div class="form-group">
                <label>Date of birth</label>
                <div class="date-of-birth">
                    <select id="day" name="day" required>
                        <option value="">Day</option>
                    </select>
                    <select id="month" name="month" required onchange="change_month(this)">
                        <option value="">Month</option>
                    </select>
                    <select id="year" name="year" required onchange="change_year(this)">
                        <option value="">Year</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Gender</label>
                <div class="gender-options">
                    <label class="gender-option">
                        <input type="radio" name="gender" value="man" required> Man
                    </label>
                    <label class="gender-option">
                        <input type="radio" name="gender" value="woman"> Woman
                    </label>
                    <label class="gender-option">
                        <input type="radio" name="gender" value="prefer_not_to_say"> Prefer not to say
                    </label>
                </div>
            </div>
            <div class="form-group">
                <label for="country">Country</label>
                <select id="country" name="country" class="country-select" required>
                    <option value="">Choose a country</option>
                    <option value="Bangladesh">Bangladesh</option>
                    <option value="India">India</option>
                    <option value="Pakistan">Pakistan</option>
                    <option value="USA">United States</option>
                    <option value="UK">United Kingdom</option>
                    <option value="Canada">Canada</option>
                    <option value="Australia">Australia</option>
                    <option value="Germany">Germany</option>
                    <option value="Japan">Japan</option>
                    <option value="Brazil">Brazil</option>
                </select>
            </div>
            <button type="submit" class="next-btn">Next</button>
        </form>
        <div class="footer-text">This site is protected by reCAPTCHA and the Google <a href="#">Privacy Policy</a> and <a href="#">Terms of Service</a> apply.</div>
    </div>

    <script>
        // Days in each month (index 0-11)
        const Days = [31,28,31,30,31,30,31,31,30,31,30,31];
        
        // Initialize when document is ready
        document.addEventListener('DOMContentLoaded', function() {
            // Populate day dropdown
            let dayOptions = '<option value="">Day</option>';
            for (let i = 1; i <= Days[0]; i++) {
                dayOptions += `<option value="${i}">${i}</option>`;
            }
            document.getElementById('day').innerHTML = dayOptions;
            
            // Populate month dropdown
            const monthNames = ["January", "February", "March", "April", "May", "June", 
                              "July", "August", "September", "October", "November", "December"];
            let monthOptions = '<option value="">Month</option>';
            for (let i = 0; i < 12; i++) {
                monthOptions += `<option value="${i + 1}">${monthNames[i]}</option>`;
            }
            document.getElementById('month').innerHTML = monthOptions;
            
            // Populate year dropdown
            const currentYear = new Date().getFullYear();
            let yearOptions = '<option value="">Year</option>';
            for (let i = currentYear - 21; i >= 1930; i--) {
                yearOptions += `<option value="${i}">${i}</option>`;
            }
            document.getElementById('year').innerHTML = yearOptions;
        });
        
        function isLeapYear(year) {
            year = parseInt(year);
            return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
        }
        
        function change_year(select) {
            const year = select.value;
            const monthSelect = document.getElementById('month');
            const daySelect = document.getElementById('day');
            
            if (!year || !monthSelect.value) return;
            
            // Update February days for leap year
            if (isLeapYear(year)) {
                Days[1] = 29;
            } else {
                Days[1] = 28;
            }
            
            // If February is selected, update days
            if (monthSelect.value == 2) {
                updateDayOptions(1); // February is index 1
            }
        }
        
        function change_month(select) {
            if (!select.value) return;
            const monthIndex = parseInt(select.value) - 1;
            updateDayOptions(monthIndex);
        }
        
        function updateDayOptions(monthIndex) {
            const daySelect = document.getElementById('day');
            const currentDay = daySelect.value;
            
            let dayOptions = '<option value="">Day</option>';
            for (let i = 1; i <= Days[monthIndex]; i++) {
                dayOptions += `<option value="${i}">${i}</option>`;
            }
            
            daySelect.innerHTML = dayOptions;
            
            // Try to preserve the selected day if it's still valid
            if (currentDay && currentDay <= Days[monthIndex]) {
                daySelect.value = currentDay;
            }
        }
    </script>
</body>
</html>