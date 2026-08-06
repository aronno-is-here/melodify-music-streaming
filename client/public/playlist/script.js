
        document.addEventListener('DOMContentLoaded', function() {
            // Menu toggle functionality
            const menuBtn = document.querySelector('.menu-btn');
            const menuOptions = document.querySelector('.menu-options');
            
            menuBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                menuOptions.classList.toggle('show');
            });
            
            // Options buttons functionality
            const optionsBtns = document.querySelectorAll('.options-btn');
            
            optionsBtns.forEach(btn => {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const menu = this.nextElementSibling;
                    
                    // Close any other open menus
                    document.querySelectorAll('.options-menu.show').forEach(openMenu => {
                        if (openMenu !== menu) {
                            openMenu.classList.remove('show');
                        }
                    });
                    
                    menu.classList.toggle('show');
                });
            });
            
            // Close menus when clicking elsewhere
            document.addEventListener('click', function() {
                document.querySelectorAll('.menu-options.show, .options-menu.show').forEach(menu => {
                    menu.classList.remove('show');
                });
            });
            
            // Prevent menu close when clicking inside menu
            document.querySelectorAll('.menu-options, .options-menu').forEach(menu => {
                menu.addEventListener('click', function(e) {
                    e.stopPropagation();
                });
            });
            
            // Play button functionality
            const playBtn = document.querySelector('.play-btn');
            let isPlaying = false;
            
            playBtn.addEventListener('click', function() {
                isPlaying = !isPlaying;
                
                if (isPlaying) {
                    this.innerHTML = '<i class="fas fa-pause"></i>';
                    // Show floating player
                    document.querySelector('.floating-player').classList.add('show');
                    // Set first song as playing
                    document.querySelector('.song-row').classList.add('playing');
                } else {
                    this.innerHTML = '<i class="fas fa-play"></i>';
                    // Hide floating player
                    document.querySelector('.floating-player').classList.remove('show');
                    // Remove playing class
                    document.querySelectorAll('.song-row.playing').forEach(row => {
                        row.classList.remove('playing');
                    });
                }
            });
            
            // Song row click functionality
            const songRows = document.querySelectorAll('.song-row');
            
            songRows.forEach(row => {
                row.addEventListener('click', function(e) {
                    if (!e.target.closest('.options-btn')) {
                        // Remove playing class from all rows
                        document.querySelectorAll('.song-row.playing').forEach(r => {
                            r.classList.remove('playing');
                        });
                        
                        // Add playing class to clicked row
                        this.classList.add('playing');
                        
                        // Ensure play button shows pause state
                        isPlaying = true;
                        playBtn.innerHTML = '<i class="fas fa-pause"></i>';
                        
                        // Show floating player
                        document.querySelector('.floating-player').classList.add('show');
                        
                        // Update floating player info
                        const title = this.querySelector('.song-title').textContent;
                        const artist = this.querySelector('.song-artist').textContent;
                        const imgSrc = this.querySelector('.song-image').src;
                        
                        document.querySelector('.floating-title').textContent = title;
                        document.querySelector('.floating-artist').textContent = artist;
                        document.querySelector('.floating-player img').src = imgSrc;
                    }
                });
            });
            
            // Search functionality
            const searchBar = document.querySelector('.search-bar');
            
            searchBar.addEventListener('focus', function() {
                this.parentElement.classList.add('focused');
            });
            
            searchBar.addEventListener('blur', function() {
                this.parentElement.classList.remove('focused');
            });
            
            // Simulate loading more songs on scroll
            window.addEventListener('scroll', function() {
                const scrollPosition = window.scrollY;
                const windowHeight = window.innerHeight;
                const documentHeight = document.body.scrollHeight;
                
                if (scrollPosition + windowHeight > documentHeight - 200) {
                    // Here you would typically load more content
                    console.log('Load more songs...');
                }
            });
        });
    