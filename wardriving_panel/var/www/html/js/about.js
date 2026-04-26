        function toggleMenu() {
            const m = document.getElementById('nav-menu');
            const o = document.getElementById('menu-overlay');
            m.classList.toggle('active');
            o.style.display = m.classList.contains('active') ? 'block' : 'none';
        }