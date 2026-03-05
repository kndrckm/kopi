import { removeBackground } from './bg-removal.js';
import { supabase } from './supabase.js';

let currentUser = null;

// Initialize App — modules run after DOM is ready, no need for DOMContentLoaded
(async () => {
    try {

        // Declare shared state early to avoid TDZ issues with auth callbacks
        const todayCoffeeList = document.getElementById('today-coffee-list');
        let coffeeEntries = [];
        let isDraggingNav = false;
        let navStartX = 0;
        let indInitialLeft = 0;
        let userDisplayName = null;
        let selectedDateTime = new Date();
        let selectedType = 'Americano';
        let selectedSize = 'Small';
        let selectedTemp = 'Iced';
        const STICKER_SIZE = 80; // Manual size control
        const stickerPhysics = {
            particles: [],
            gravity: { x: 0, y: 0 },
            animReq: null,
            container: null,
            init(containerEl) {
                this.container = containerEl;
                if (!this.animReq) this.loop();
            },
            add(el, x, y, rotation) {
                this.particles.push({
                    el, x, y, rotation,
                    vx: (Math.random() - 0.5) * 6, // Slightly faster scatter
                    vy: (Math.random() - 0.5) * 6,
                    w: STICKER_SIZE, h: STICKER_SIZE
                });
            },
            clear() {
                this.particles = [];
                if (this.animReq) {
                    cancelAnimationFrame(this.animReq);
                    this.animReq = null;
                }
            },
            loop() {
                if (this.particles.length > 0 && this.container) {
                    const cw = this.container.clientWidth;
                    const ch = this.container.clientHeight;
                    const friction = 0.97;
                    const sensitivity = 0.2;
                    this.particles.forEach((p, i) => {
                        p.vx += this.gravity.x * sensitivity;
                        p.vy += this.gravity.y * sensitivity;
                        p.vx *= friction;
                        p.vy *= friction;
                        p.x += p.vx;
                        p.y += p.vy;

                        // Wall collisions (using container bounds)
                        if (p.x < 0) { p.x = 0; p.vx *= -0.4; }
                        if (p.x > cw - p.w) { p.x = cw - p.w; p.vx *= -0.4; }
                        if (p.y < 0) { p.y = 0; p.vy *= -0.4; }
                        if (p.y > ch - p.h) { p.y = ch - p.h; p.vy *= -0.4; }

                        // Inter-particle collisions (Simple Circle-based)
                        for (let j = i + 1; j < this.particles.length; j++) {
                            const p2 = this.particles[j];
                            const dx = (p2.x + p2.w / 2) - (p.x + p.w / 2);
                            const dy = (p2.y + p2.h / 2) - (p.y + p.h / 2);
                            const dist = Math.sqrt(dx * dx + dy * dy);
                            const minDist = (p.w + p2.w) / 2 * 0.8; // some overlap allowed for aesthetics

                            if (dist < minDist) {
                                // Resolve overlap
                                const angle = Math.atan2(dy, dx);
                                const targetX = p.x + p.w / 2 + Math.cos(angle) * minDist;
                                const targetY = p.y + p.h / 2 + Math.sin(angle) * minDist;
                                const ax = (targetX - (p2.x + p2.w / 2)) * 0.1;
                                const ay = (targetY - (p2.y + p2.h / 2)) * 0.1;

                                p.vx -= ax;
                                p.vy -= ay;
                                p2.vx += ax;
                                p2.vy += ay;
                            }
                        }

                        p.el.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${p.rotation}deg)`;
                    });
                }
                this.animReq = requestAnimationFrame(() => this.loop());
            }
        };

        window.addEventListener('deviceorientation', (e) => {
            // Gamma is left-to-right tilt (-90 to 90), Beta is front-to-back tilt (-180 to 180)
            stickerPhysics.gravity.x = (e.gamma || 0) / 45;
            stickerPhysics.gravity.y = (e.beta || 0) / 45;
        });

        // Setup Auth Listener
        supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN') {
                currentUser = session.user;
                // Profile & types fetched in getSession block on first load
                // This handles subsequent sign-ins (e.g., OAuth redirect)
                fetchUserProfile().then(() => updateUserGreeting());
                fetchCoffeeTypes();
                fetchCoffeeEntries();
            } else if (event === 'SIGNED_OUT') {
                currentUser = null;
                coffeeEntries = [];
                renderTodayCoffee();
                updateCalendarStickers();
                updateUserGreeting();
                switchView('view-login');
            }
        });

        // --- APP NAVIGATION ---
        const navItems = document.querySelectorAll('.nav-item');
        const views = document.querySelectorAll('.view');
        const bottomNav = document.getElementById('bottom-nav');
        const btnGetStarted = document.getElementById('btn-get-started');
        const navPill = document.getElementById('nav-pill');
        const indicator = document.getElementById('nav-indicator');

        const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        // Coffee types (editable, DB-backed)
        const DEFAULT_COFFEE_TYPES = [
            { emoji: '☕', name: 'Espresso' },
            { emoji: '🥛', name: 'Latte' },
            { emoji: '⚪', name: 'Flat White' },
            { emoji: '🥃', name: 'Americano' },
            { emoji: '☁️', name: 'Cappuccino' },
            { emoji: '🍫', name: 'Mocha' }
        ];
        let coffeeTypes = [...DEFAULT_COFFEE_TYPES];

        async function fetchCoffeeTypes() {
            if (!currentUser) return;
            const { data, error } = await supabase
                .from('user_coffee_types')
                .select('*')
                .eq('user_id', currentUser.id)
                .order('sort_order', { ascending: true });
            if (error) {
                console.error('Fetch types error:', error.message);
                return;
            }
            if (data && data.length > 0) {
                coffeeTypes = data.map(d => ({ id: d.id, emoji: d.emoji, name: d.name }));
            } else {
                // Insert defaults for new user
                const inserts = DEFAULT_COFFEE_TYPES.map((t, i) => ({
                    user_id: currentUser.id, emoji: t.emoji, name: t.name, sort_order: i
                }));
                const { data: inserted, error: insErr } = await supabase
                    .from('user_coffee_types').insert(inserts).select();
                if (!insErr && inserted) {
                    coffeeTypes = inserted.map(d => ({ id: d.id, emoji: d.emoji, name: d.name }));
                }
            }
            rebuildTypeGrid();
        }

        // Build calendar
        const calendarGrid = document.getElementById('calendar-grid');
        const calHeaderDate = document.querySelector('#view-calendar .page-header p');

        if (calendarGrid) {
            const now = new Date();
            const year = now.getFullYear(), month = now.getMonth(), today = now.getDate();
            if (calHeaderDate) calHeaderDate.textContent = `${DAYS_SHORT[now.getDay()]}, ${today} ${MONTHS_FULL[month]} ${year}`;

            const firstDay = new Date(year, month, 1).getDay();
            const totalDays = new Date(year, month + 1, 0).getDate();

            calendarGrid.innerHTML = '';
            for (let i = 0; i < firstDay; i++) {
                const el = document.createElement('div');
                el.classList.add('cal-day', 'empty');
                calendarGrid.appendChild(el);
            }
            for (let d = 1; d <= totalDays; d++) {
                const el = document.createElement('div');
                el.classList.add('cal-day');
                el.dataset.day = d;
                if (d === today) el.classList.add('today');
                el.textContent = d;
                calendarGrid.appendChild(el);
            }
        }

        // Check for an active session on load
        const { data: { session }, error } = await supabase.auth.getSession();
        if (session) {
            currentUser = session.user;
            await fetchUserProfile();
            await fetchCoffeeTypes();
            updateUserGreeting();
            fetchCoffeeEntries();
            switchView('view-calendar');
        } else {
            if (error) console.error('Error fetching session:', error.message);
            switchView('view-login');
        }


        async function fetchUserProfile() {
            if (!currentUser) return;
            const { data, error } = await supabase
                .from('user_profiles')
                .select('display_name')
                .eq('user_id', currentUser.id)
                .maybeSingle();
            if (data && data.display_name) {
                userDisplayName = data.display_name;
            }
        }

        function updateUserGreeting() {
            const greetingEl = document.getElementById('user-greeting');
            if (!greetingEl) return;

            if (!currentUser) {
                greetingEl.textContent = 'Mar';
                return;
            }

            const hour = new Date().getHours();
            let timeOfDay = 'Morning';
            if (hour >= 12 && hour < 17) timeOfDay = 'Afternoon';
            else if (hour >= 17 || hour < 4) timeOfDay = 'Evening';

            const name = userDisplayName
                || currentUser.user_metadata?.full_name
                || currentUser.email.split('@')[0];
            greetingEl.textContent = `${timeOfDay}, ${name}`;
        }



        // Init indicator position
        setTimeout(() => {
            const activeBtn = document.querySelector('.nav-item.active');
            if (activeBtn && indicator) indicator.style.left = `${activeBtn.offsetLeft}px`;
        }, 50);

        // isDraggingNav, navStartX, indInitialLeft moved to top of IIFE

        function switchView(viewId) {
            views.forEach(v => v.classList.remove('active'));
            document.getElementById(viewId).classList.add('active');
            if (bottomNav) bottomNav.classList.toggle('hidden', ['view-onboarding', 'view-login', 'view-nickname'].includes(viewId));

            // Refresh stats tab indicator position if opening statistics
            if (viewId === 'view-statistics') {
                setTimeout(() => {
                    const activeTab = document.querySelector('.tab-btn.active');
                    const statTabIndicator = document.getElementById('stat-tab-indicator');
                    if (activeTab && statTabIndicator) {
                        statTabIndicator.style.left = `${activeTab.offsetLeft}px`;
                        statTabIndicator.style.width = `${activeTab.offsetWidth}px`;
                    }
                }, 10);
                requestDeviceOrientation();
            }

            navItems.forEach(btn => {
                const isActive = btn.dataset.target === viewId;
                btn.classList.toggle('active', isActive);
                if (isActive && indicator && !isDraggingNav) {
                    // Gooey elastic effect
                    const currentLeft = indicator.offsetLeft;
                    const targetLeft = btn.offsetLeft;
                    const distance = Math.abs(targetLeft - currentLeft);

                    if (distance > 0) {
                        // stretch width based on distance
                        const stretchWidth = 48 + (distance * 0.5);
                        indicator.style.transition = 'left 0.4s cubic-bezier(0.25, 1, 0.5, 1), width 0.2s ease-in, transform 0.2s';

                        // IF moving right, keep left same temporarily and stretch width
                        if (targetLeft > currentLeft) {
                            indicator.style.width = `${stretchWidth}px`;
                        } else {
                            // IF moving left, move left immediately but stretch width rightwards
                            indicator.style.left = `${targetLeft}px`;
                            indicator.style.width = `${stretchWidth}px`;
                        }

                        // Then snap back to original size and target pos
                        setTimeout(() => {
                            indicator.style.transition = 'left 0.4s cubic-bezier(0.25, 1, 0.5, 1), width 0.3s cubic-bezier(0.25, 1, 0.5, 1), transform 0.2s';
                            indicator.style.width = '48px';
                            indicator.style.left = `${targetLeft}px`;
                        }, 150);
                    } else {
                        indicator.style.left = `${targetLeft}px`;
                    }
                }
            });
        }

        if (navPill && indicator) {
            navPill.addEventListener('touchstart', (e) => {
                const tgt = e.target.closest('.nav-item');
                if (tgt && tgt.classList.contains('active')) {
                    isDraggingNav = true;
                    navStartX = e.touches[0].clientX;
                    indInitialLeft = indicator.offsetLeft;
                    indicator.classList.add('dragging');
                    indicator.style.transition = 'transform 0.2s';
                }
            }, { passive: true });

            document.addEventListener('touchmove', (e) => {
                if (!isDraggingNav) return;
                const deltaX = e.touches[0].clientX - navStartX;
                let newLeft = indInitialLeft + deltaX;
                // clamp
                const minLeft = navItems[0].offsetLeft;
                const maxLeft = navItems[navItems.length - 1].offsetLeft;
                if (newLeft < minLeft) newLeft = minLeft;
                if (newLeft > maxLeft) newLeft = maxLeft;
                indicator.style.left = `${newLeft}px`;
            }, { passive: true });

            document.addEventListener('touchend', (e) => {
                if (!isDraggingNav) return;
                isDraggingNav = false;
                indicator.classList.remove('dragging');

                // Snap to closest
                let closest = navItems[0];
                let minDiff = Infinity;
                const center = indicator.offsetLeft + indicator.offsetWidth / 2;
                navItems.forEach(btn => {
                    const btnCenter = btn.offsetLeft + btn.offsetWidth / 2;
                    const diff = Math.abs(btnCenter - center);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closest = btn;
                    }
                });
                switchView(closest.dataset.target);
            });
        }

        if (btnGetStarted) {
            btnGetStarted.addEventListener('click', () => {
                switchView('view-login');
            });
        }

        const btnGoogleLogin = document.getElementById('btn-google-login');
        const btnLoginSkip = document.getElementById('btn-login-skip');
        const btnSaveNickname = document.getElementById('btn-save-nickname');
        const inputNickname = document.getElementById('input-nickname');

        if (btnGoogleLogin) {
            btnGoogleLogin.addEventListener('click', async () => {
                const { error } = await supabase.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo: window.location.origin + (window.location.pathname.endsWith('/') ? window.location.pathname : window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1))
                    }
                });
                if (error) {
                    console.error('Google login error:', error.message);
                    alert('Login failed: ' + error.message);
                }
            });
        }

        const btnLogout = document.getElementById('btn-logout');
        if (btnLogout) {
            btnLogout.addEventListener('click', async () => {
                const { error } = await supabase.auth.signOut();
                if (error) console.error('Error logging out:', error.message);
            });
        }

        // --- DISPLAY NAME (Nickname) ---
        const inputDisplayName = document.getElementById('input-display-name');
        const btnSaveDisplayName = document.getElementById('btn-save-display-name');

        // Pre-fill current display name
        if (inputDisplayName) {
            if (userDisplayName) inputDisplayName.value = userDisplayName;
            else if (currentUser) {
                inputDisplayName.value = currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || '';
            }
        }

        if (btnSaveDisplayName) {
            btnSaveDisplayName.addEventListener('click', async () => {
                const newName = inputDisplayName?.value?.trim();
                if (newName && currentUser) {
                    const { error } = await supabase
                        .from('user_profiles')
                        .upsert({ user_id: currentUser.id, display_name: newName, updated_at: new Date().toISOString() });
                    if (error) {
                        console.error('Save profile error:', error.message);
                    } else {
                        userDisplayName = newName;
                        updateUserGreeting();
                        showSaveToast();
                    }
                }
            });
        }

        if (btnLoginSkip) {
            btnLoginSkip.addEventListener('click', () => {
                switchView('view-calendar');
            });
        }

        if (btnSaveNickname) {
            btnSaveNickname.addEventListener('click', () => {
                if (inputNickname && inputNickname.value.trim() !== '') {
                    // Mock saving nickname
                    switchView('view-calendar');
                } else {
                    alert('Please enter a nickname.');
                }
            });
        }
        navItems.forEach(btn => btn.addEventListener('click', () => { if (btn.dataset.target) switchView(btn.dataset.target); }));

        // ============================================================
        // UNIFIED BOTTOM SHEET SYSTEM
        // ============================================================
        const sheetStack = []; // tracks open sheets for stacking

        function openSheet(el, options = {}) {
            if (!el) return;
            // Stack: mark previous top sheet as stacked
            if (sheetStack.length > 0) {
                const prev = sheetStack[sheetStack.length - 1];
                prev.classList.add('stacked');
                // If noStack, prevent the parent from visually scaling down
                if (options.noStack) {
                    prev.classList.add('no-stack');
                }
            }
            sheetStack.push(el);
            // Update z-index so newer sheets are on top
            el.style.zIndex = 200 + sheetStack.length * 10;
            el.classList.add('active');
        }

        function closeSheet(el) {
            if (!el) return;
            // Reset inline styles left by swipe gesture
            const sc = el.querySelector('.sheet-content');
            if (sc) {
                sc.style.transform = '';
                sc.style.transition = '';
            }
            el.style.background = '';
            el.classList.remove('active');
            // Remove from stack
            const idx = sheetStack.indexOf(el);
            if (idx > -1) sheetStack.splice(idx, 1);
            // Unstack the new top sheet
            if (sheetStack.length > 0) {
                const top = sheetStack[sheetStack.length - 1];
                top.classList.remove('stacked');
                top.classList.remove('no-stack');
            }
            el.style.zIndex = '';
        }

        // Click-to-dismiss on backdrop (the dark area)
        document.querySelectorAll('.modal-view').forEach(mv => {
            mv.addEventListener('click', (e) => {
                if (e.target === mv) closeSheet(mv);
            });
        });

        // Swipe-to-dismiss on sheet-content
        document.querySelectorAll('.modal-view .sheet-content').forEach(sc => {
            let startY = 0, currentY = 0, isDragging = false;
            let lastTouchY = 0, lastTouchTime = 0;

            sc.addEventListener('touchstart', (e) => {
                // Only start drag if not on a button/input/scrollable area that has scroll
                const target = e.target;
                if (target.closest('button, input, select, textarea, .picker-overlay')) return;
                const scrollable = target.closest('.modal-body');
                if (scrollable && scrollable.scrollTop > 0) return;
                startY = e.touches[0].clientY;
                currentY = startY;
                lastTouchY = startY;
                lastTouchTime = Date.now();
                isDragging = true;
                sc.style.transition = 'none';
            }, { passive: true });

            sc.addEventListener('touchmove', (e) => {
                if (!isDragging) return;
                lastTouchY = currentY;
                lastTouchTime = Date.now();
                currentY = e.touches[0].clientY;
                const diff = currentY - startY;
                if (diff > 0) {
                    sc.style.transform = `translateY(${diff}px)`;
                    // Fade backdrop proportionally
                    const mv = sc.closest('.modal-view');
                    const opacity = Math.max(0, 0.45 - (diff / 800));
                    mv.style.background = `rgba(0,0,0,${opacity})`;
                }
            }, { passive: true });

            sc.addEventListener('touchend', () => {
                if (!isDragging) return;
                isDragging = false;
                const diff = currentY - startY;
                const mv = sc.closest('.modal-view');

                // Calculate velocity (px/ms) for fast-swipe dismiss
                const timeDelta = Date.now() - lastTouchTime;
                const velocity = timeDelta > 0 ? (currentY - lastTouchY) / timeDelta : 0;

                sc.style.transition = '';
                mv.style.background = '';

                // Dismiss if threshold reached OR fast downward swipe
                if (diff > 100 || (diff > 20 && velocity > 0.5)) {
                    closeSheet(mv);
                } else {
                    sc.style.transform = '';
                }
                currentY = 0;
                startY = 0;
                lastTouchY = 0;
                lastTouchTime = 0;
            });

            // Handle interrupted gestures (e.g., system notification overlay)
            sc.addEventListener('touchcancel', () => {
                if (!isDragging) return;
                isDragging = false;
                sc.style.transition = '';
                sc.style.transform = '';
                const mv = sc.closest('.modal-view');
                mv.style.background = '';
                currentY = 0;
                startY = 0;
                lastTouchY = 0;
                lastTouchTime = 0;
            });
        });

        // --- ADD COFFEE MODAL ---
        const btnAddCup = document.getElementById('btn-add-cup-main');
        const modalAddCoffee = document.getElementById('modal-add-coffee');
        const btnCancelAdd = document.getElementById('btn-cancel-add');
        const btnSaveCoffee = document.getElementById('btn-save-coffee');

        if (btnAddCup) btnAddCup.addEventListener('click', () => { updateAddCoffeeDateTime(); rebuildTypeGrid(); openSheet(modalAddCoffee); });
        if (btnCancelAdd) btnCancelAdd.addEventListener('click', () => closeSheet(modalAddCoffee));

        // --- DATE/TIME PICKER ---
        const btnOpenDtPicker = document.getElementById('btn-open-dt-picker');
        const dtPickerOverlay = document.getElementById('dt-picker-overlay');
        const btnDtPickerDone = document.getElementById('btn-dt-picker-done');
        const pickerDtDateCol = document.getElementById('picker-dt-date');
        const pickerDtHourCol = document.getElementById('picker-dt-hour');
        const pickerDtMinuteCol = document.getElementById('picker-dt-minute');

        let pickerSelectedDtDate = new Date().getDate();
        let pickerSelectedDtHour = new Date().getHours();
        let pickerSelectedDtMinute = new Date().getMinutes();

        function buildDtPicker() {
            const now = new Date();
            const todayDate = now.getDate();

            pickerDtDateCol.innerHTML = '';
            for (let d = 1; d <= todayDate; d++) {
                const item = document.createElement('div');
                item.className = 'picker-item' + (d === pickerSelectedDtDate ? ' selected' : '');
                item.textContent = d;
                item.addEventListener('click', () => { pickerSelectedDtDate = d; updateDtPickerSel(); });
                pickerDtDateCol.appendChild(item);
            }

            pickerDtHourCol.innerHTML = '';
            for (let h = 0; h < 24; h++) {
                const item = document.createElement('div');
                item.className = 'picker-item' + (h === pickerSelectedDtHour ? ' selected' : '');
                item.textContent = String(h).padStart(2, '0');
                item.addEventListener('click', () => { pickerSelectedDtHour = h; updateDtPickerSel(); });
                pickerDtHourCol.appendChild(item);
            }

            pickerDtMinuteCol.innerHTML = '';
            for (let m = 0; m < 60; m++) {
                const item = document.createElement('div');
                item.className = 'picker-item' + (m === pickerSelectedDtMinute ? ' selected' : '');
                item.textContent = String(m).padStart(2, '0');
                item.addEventListener('click', () => { pickerSelectedDtMinute = m; updateDtPickerSel(); });
                pickerDtMinuteCol.appendChild(item);
            }

            setTimeout(() => {
                scrollTo(pickerDtDateCol, pickerSelectedDtDate - 1);
                scrollTo(pickerDtHourCol, pickerSelectedDtHour);
                scrollTo(pickerDtMinuteCol, pickerSelectedDtMinute);
            }, 50);
        }

        function updateDtPickerSel() {
            pickerDtDateCol.querySelectorAll('.picker-item').forEach((item, i) => item.classList.toggle('selected', (i + 1) === pickerSelectedDtDate));
            pickerDtHourCol.querySelectorAll('.picker-item').forEach((item, i) => item.classList.toggle('selected', i === pickerSelectedDtHour));
            pickerDtMinuteCol.querySelectorAll('.picker-item').forEach((item, i) => item.classList.toggle('selected', i === pickerSelectedDtMinute));
        }

        if (btnOpenDtPicker) btnOpenDtPicker.addEventListener('click', () => {
            pickerSelectedDtDate = selectedDateTime.getDate();
            pickerSelectedDtHour = selectedDateTime.getHours();
            pickerSelectedDtMinute = selectedDateTime.getMinutes();
            buildDtPicker();
            openSheet(dtPickerOverlay, { noStack: true });
        });

        if (btnDtPickerDone) btnDtPickerDone.addEventListener('click', () => {
            const now = new Date();
            selectedDateTime = new Date(now.getFullYear(), now.getMonth(), pickerSelectedDtDate, pickerSelectedDtHour, pickerSelectedDtMinute);
            updateAddCoffeeDateTimeDisplay();
            closeSheet(dtPickerOverlay);
        });

        function updateAddCoffeeDateTimeDisplay() {
            const dateEl = document.getElementById('add-coffee-date');
            const timeEl = document.getElementById('add-coffee-time');
            if (dateEl) dateEl.textContent = `${DAYS_SHORT[selectedDateTime.getDay()]}, ${selectedDateTime.getDate()} ${MONTHS_FULL[selectedDateTime.getMonth()].substring(0, 3)}`;
            if (timeEl) timeEl.textContent = `${String(selectedDateTime.getHours()).padStart(2, '0')}.${String(selectedDateTime.getMinutes()).padStart(2, '0')}`;
        }

        function updateAddCoffeeDateTime() {
            selectedDateTime = new Date();
            updateAddCoffeeDateTimeDisplay();
        }

        // Rebuild type grid from editable coffeeTypes array
        function rebuildTypeGrid() {
            const grid = document.querySelector('.coffee-type-grid');
            if (!grid) return;
            grid.innerHTML = '';
            coffeeTypes.forEach((t, i) => {
                const div = document.createElement('div');
                div.className = 'type-card-lg' + (t.name === selectedType ? ' active' : '');
                div.innerHTML = `<span class="type-emoji">${t.emoji}</span><span>${t.name}</span>`;
                div.addEventListener('click', () => {
                    grid.querySelectorAll('.type-card-lg').forEach(c => c.classList.remove('active'));
                    div.classList.add('active');
                    selectedType = t.name;
                });
                grid.appendChild(div);
            });
            // +Others card
            const othersDiv = document.createElement('div');
            othersDiv.className = 'type-card-lg';
            othersDiv.innerHTML = '<span class="type-emoji" style="font-size:36px;">＋</span><span>Others</span>';
            othersDiv.addEventListener('click', () => openNewTypeModal());
            grid.appendChild(othersDiv);
        }

        // --- FORM STATE ---
        let uploadedPhotoDataUrl = null;
        let uploadedPhotoBlob = null;

        document.querySelectorAll('.size-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedSize = btn.textContent;
            });
        });
        document.querySelectorAll('.temp-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.temp-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedTemp = btn.textContent.includes('Iced') ? 'Iced' : 'Hot';
            });
        });

        // --- PHOTO UPLOAD ---
        const photoBox = document.getElementById('photo-placeholder');
        const photoInput = document.getElementById('photo-input');
        if (photoBox && photoInput) {
            photoBox.addEventListener('click', (e) => { if (!e.target.closest('.remove-photo-btn')) photoInput.click(); });
            photoInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                uploadedPhotoBlob = file;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    uploadedPhotoDataUrl = ev.target.result;
                    photoBox.innerHTML = `<img src="${ev.target.result}" alt="coffee photo"><button class="remove-photo-btn" id="btn-remove-photo"><i class="ph ph-x"></i></button>`;
                    document.getElementById('btn-remove-photo').addEventListener('click', (evt) => { evt.stopPropagation(); resetPhotoBox(); });
                };
                reader.readAsDataURL(file);
            });
        }
        function resetPhotoBox() {
            uploadedPhotoDataUrl = null;
            uploadedPhotoBlob = null;
            if (photoBox) photoBox.innerHTML = `<i class="ph ph-camera"></i><span class="photo-upload-title">Add Photo</span><span class="photo-upload-hint">Capture your coffee moment</span>`;
            if (photoInput) photoInput.value = '';
        }

        // ============================================================
        // SAVE COFFEE — Database Operations
        // ============================================================
        // coffeeEntries & todayCoffeeList declared at top of IIFE

        async function fetchCoffeeEntries() {
            if (!currentUser) return;
            const { data, error } = await supabase
                .from('coffee_entries')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Error fetching entries:', error.message);
            } else {
                coffeeEntries = data || [];
                renderTodayCoffee();
                updateCalendarStickers();
                updateStatistics();
            }
        }

        function getTypeEmoji(typeName) {
            const found = coffeeTypes.find(t => t.name === typeName);
            return found ? found.emoji : '☕';
        }

        if (btnSaveCoffee) {
            btnSaveCoffee.addEventListener('click', async () => {
                const now = new Date();
                const timeStr = `${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`;
                const priceInput = modalAddCoffee.querySelector('input[type="number"]');
                const price = priceInput ? parseFloat(priceInput.value) || 0 : 0;
                const hasPhoto = !!uploadedPhotoBlob;
                const photoBlob = uploadedPhotoBlob; // capture reference before reset

                const entry = {
                    user_id: currentUser ? currentUser.id : null,
                    type: selectedType, size: selectedSize, temp: selectedTemp,
                    time: timeStr, price, sticker: null,
                    emoji: getTypeEmoji(selectedType),
                    date_string: selectedDateTime.toDateString()
                };

                // Close modal + show toast immediately
                closeSheet(modalAddCoffee);
                resetPhotoBox();
                showSaveToast();

                // Add skeleton loading row if photo needs processing
                let skeletonId = null;
                if (hasPhoto) {
                    skeletonId = 'skeleton-' + Date.now();
                    const skeletonHtml = `<div id="${skeletonId}" class="coffee-item-skeleton"><div class="skeleton-circle"></div><div class="skeleton-lines"><div class="skeleton-line"></div><div class="skeleton-line"></div></div></div>`;
                    if (todayCoffeeList) {
                        const emptyState = todayCoffeeList.querySelector('.empty-state-card');
                        if (emptyState) todayCoffeeList.innerHTML = '';
                        todayCoffeeList.insertAdjacentHTML('afterbegin', skeletonHtml);
                    }
                }

                // Process photo in background
                if (hasPhoto) {
                    try {
                        const stickerBlob = await removeBackground(photoBlob);
                        const fileName = `${currentUser ? currentUser.id : 'anon'}/${Date.now()}.png`;
                        const { data: uploadData, error: uploadError } = await supabase.storage
                            .from('stickers')
                            .upload(fileName, stickerBlob, {
                                contentType: 'image/png',
                                upsert: false
                            });
                        if (!uploadError) {
                            const { data: urlData } = supabase.storage
                                .from('stickers')
                                .getPublicUrl(fileName);
                            entry.sticker = urlData.publicUrl;
                        } else {
                            console.error('Storage upload error:', uploadError.message);
                        }
                    } catch (err) {
                        console.error('BG removal / upload failed:', err);
                    }
                }

                // Insert into DB
                if (currentUser) {
                    const { data, error } = await supabase.from('coffee_entries').insert([entry]).select();
                    if (error) {
                        console.error('Insert error:', error.message);
                    } else if (data && data[0]) {
                        coffeeEntries.unshift(data[0]);
                    }
                } else {
                    coffeeEntries.unshift(entry);
                }

                // Remove skeleton and render real data
                if (skeletonId) {
                    const skel = document.getElementById(skeletonId);
                    if (skel) skel.remove();
                }
                renderTodayCoffee();
                updateCalendarStickers();
                updateStatistics();
            });
        }

        // Show save success toast
        function showSaveToast() {
            const toast = document.getElementById('save-toast');
            if (!toast) return;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 1500);
        }

        // ============================================================
        // COFFEE LIST RENDERING & SWIPE ACTIONS
        // ============================================================
        let deleteTargetId = null;
        let deleteTargetIdx = null;
        const modalConfirmDelete = document.getElementById('modal-confirm-delete');
        const btnCancelDelete = document.getElementById('btn-cancel-delete');
        const btnConfirmDelete = document.getElementById('btn-confirm-delete');

        if (btnCancelDelete) btnCancelDelete.addEventListener('click', () => closeSheet(modalConfirmDelete));
        if (btnConfirmDelete) btnConfirmDelete.addEventListener('click', async () => {
            if (deleteTargetId || deleteTargetIdx !== null) {
                await executeDelete(deleteTargetId, deleteTargetIdx);
                closeSheet(modalConfirmDelete);
            }
        });

        function openDeleteConfirm(id, idx) {
            deleteTargetId = id;
            deleteTargetIdx = idx;
            openSheet(modalConfirmDelete);
        }

        async function executeDelete(id, idx) {
            if (currentUser && id && typeof id === 'string' && id.length > 5) {
                const { error } = await supabase.from('coffee_entries').delete().eq('id', id);
                if (!error) {
                    const findIdx = coffeeEntries.findIndex(e => e.id === id);
                    if (findIdx !== -1) coffeeEntries.splice(findIdx, 1);
                } else {
                    console.error('Delete error', error.message);
                }
            } else if (idx !== null) {
                coffeeEntries.splice(idx, 1);
            }
            renderTodayCoffee();
            updateCalendarStickers();
            updateStatistics();
        }

        function createCoffeeItemRow(entry, idx) {
            const tempIcon = entry.temp === 'Hot' ? '♨️' : '🧊';
            const stickerHtml = entry.sticker
                ? `<img src="${entry.sticker}" alt="sticker" class="coffee-item-sticker">`
                : `<span class="coffee-item-emoji">${entry.emoji || '☕'}</span>`;

            const rowHtml = `
            <div class="swipe-container">
                <div class="swipe-content coffee-item-card" data-idx="${idx}">
                    <div class="coffee-item-info">
                        <div class="coffee-item-icon">${stickerHtml}</div>
                        <div class="coffee-item-text">
                            <h3>${entry.type} ${tempIcon}</h3>
                            <p>${entry.size} • ${entry.time}</p>
                        </div>
                    </div>
                    ${entry.price ? `<div class="coffee-item-price">${entry.price}</div>` : ''}
                </div>
                <div class="swipe-actions">
                    <button class="action-btn share-btn"><i class="ph ph-export"></i><span>Share</span></button>
                    <button class="action-btn delete-btn" data-id="${entry.id || ''}" data-idx="${idx}"><i class="ph ph-trash"></i><span>Delete</span></button>
                </div>
            </div>`;

            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = rowHtml.trim();
            const container = tempDiv.firstChild;

            // Initialize Swipe
            const content = container.querySelector('.swipe-content');
            initSwipe(content);

            // Delete Event
            container.querySelector('.delete-btn').addEventListener('click', () => {
                openDeleteConfirm(entry.id, idx);
            });

            // Share Event (Placeholder)
            container.querySelector('.share-btn').addEventListener('click', () => {
                alert('Share functionality coming soon!');
            });

            return container;
        }

        function renderTodayCoffee() {
            if (!todayCoffeeList) return;
            const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

            const todayStr = new Date().toDateString();
            const allWithIdx = coffeeEntries.map((e, idx) => ({ ...e, originalIdx: idx }));
            const todaysCoffees = allWithIdx.filter(e => e.date_string === todayStr);
            const pastCoffees = allWithIdx.filter(e => e.date_string && e.date_string !== todayStr);

            // --- TODAY ---
            todayCoffeeList.innerHTML = '';
            if (todaysCoffees.length === 0) {
                todayCoffeeList.innerHTML = `<div class="card empty-state-card"><div class="empty-state-icon">☕</div><p class="empty-state-text">None, take a sip!</p></div>`;
            } else {
                todaysCoffees.forEach((entry) => {
                    todayCoffeeList.appendChild(createCoffeeItemRow(entry, entry.originalIdx));
                });
            }

            // --- PAST RECORDS ---
            const pastCoffeeList = document.getElementById('past-coffee-list');
            if (!pastCoffeeList) return;
            pastCoffeeList.innerHTML = '';

            if (pastCoffees.length === 0) return;

            // Group by date_string, sorted newest first
            const grouped = {};
            pastCoffees.forEach(e => {
                if (!grouped[e.date_string]) grouped[e.date_string] = [];
                grouped[e.date_string].push(e);
            });

            const sortedDates = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a));

            sortedDates.forEach(dateStr => {
                const d = new Date(dateStr);
                const header = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
                pastCoffeeList.insertAdjacentHTML('beforeend', `<div class="past-date-header">${header}</div>`);

                grouped[dateStr].forEach(entry => {
                    pastCoffeeList.appendChild(createCoffeeItemRow(entry, entry.originalIdx));
                });
            });
        }

        // ============================================================
        // CALENDAR
        // ============================================================
        function updateCalendarStickers() {
            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth();
            const today = now.getDate();

            document.querySelectorAll('.cal-day').forEach(day => {
                if (day.classList.contains('empty')) return;
                const dayNum = parseInt(day.textContent) || parseInt(day.dataset.day);
                const thisCellDateStr = new Date(currentYear, currentMonth, dayNum).toDateString();

                const coffeesForDay = coffeeEntries.filter(e => e.date_string === thisCellDateStr);

                // Remove old click listener by cloning
                const newDay = day.cloneNode(false);
                day.parentNode.replaceChild(newDay, day);
                newDay.className = day.className;
                newDay.dataset.day = dayNum;

                if (coffeesForDay.length > 0) {
                    newDay.classList.add('has-coffee');
                    newDay.textContent = '';

                    const gridCount = Math.min(coffeesForDay.length, 4);
                    const gridClass = gridCount <= 1 ? 'grid-1' : gridCount <= 2 ? 'grid-2' : 'grid-4';
                    const gridDiv = document.createElement('div');
                    gridDiv.className = `cal-day-grid ${gridClass}`;

                    for (let i = 0; i < gridCount; i++) {
                        const c = coffeesForDay[i];
                        if (c.sticker) {
                            const img = document.createElement('img');
                            img.src = c.sticker;
                            img.alt = '';
                            gridDiv.appendChild(img);
                        } else {
                            const span = document.createElement('span');
                            span.className = 'cal-emoji';
                            span.textContent = c.emoji || '☕';
                            gridDiv.appendChild(span);
                        }
                    }
                    newDay.appendChild(gridDiv);

                    // Click to open day detail overlay
                    newDay.addEventListener('click', () => openDayOverlay(new Date(currentYear, currentMonth, dayNum)));
                } else {
                    newDay.classList.remove('has-coffee');
                    newDay.textContent = dayNum;

                    // Even empty days can be clicked
                    newDay.addEventListener('click', () => openDayOverlay(new Date(currentYear, currentMonth, dayNum)));
                }
            });
        }

        function initSwipe(el) {
            let startX = 0, currentTranslate = 0, isDragging = false;
            const limit = -150;
            el.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; isDragging = true; el.style.transition = 'none'; }, { passive: true });
            el.addEventListener('touchmove', (e) => {
                if (!isDragging) return;
                let val = currentTranslate + (e.touches[0].clientX - startX);
                if (val > 0) val = 0;
                if (val < limit - 20) val = limit - 20;
                el.style.transform = `translateX(${val}px)`;
            }, { passive: true });
            el.addEventListener('touchend', () => {
                isDragging = false;
                el.style.transition = 'transform 0.3s cubic-bezier(0.1, 0.7, 0.1, 1)';
                const currentX = new DOMMatrix(el.style.transform).m41;
                currentTranslate = currentX < limit / 2 ? limit : 0;
                el.style.transform = `translateX(${currentTranslate}px)`;
            });
        }

        // ============================================================
        // DAY DETAIL OVERLAY (BOTTOM SHEET)
        // ============================================================
        const dayOverlayWrapper = document.getElementById('day-overlay-wrapper');
        const dayOverlayTitle = document.getElementById('day-overlay-title');
        const dayOverlaySub = document.getElementById('day-overlay-subtitle');
        const dayOverlayCupCount = document.getElementById('day-overlay-cup-count');
        const dayOverlayRecords = document.getElementById('day-overlay-records');
        const btnAddCupOverlay = document.getElementById('btn-add-cup-overlay');

        function openDayOverlay(date) {
            const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

            dayOverlayTitle.textContent = `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
            dayOverlaySub.textContent = dayNames[date.getDay()];

            const dateStr = date.toDateString();
            const dayCoffees = coffeeEntries
                .map((e, idx) => ({ ...e, originalIdx: idx }))
                .filter(e => e.date_string === dateStr);
            dayOverlayCupCount.textContent = `${dayCoffees.length} Cup${dayCoffees.length !== 1 ? 's' : ''}`;

            dayOverlayRecords.innerHTML = '';
            if (dayCoffees.length === 0) {
                dayOverlayRecords.innerHTML = '<div class="card empty-state-card"><div class="empty-state-icon">☕</div><p class="empty-state-text">No records yet</p></div>';
            } else {
                dayCoffees.forEach(entry => {
                    dayOverlayRecords.appendChild(createCoffeeItemRow(entry, entry.originalIdx));
                });
            }

            // Hide Add a Cup for future dates
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const compareDate = new Date(date);
            compareDate.setHours(0, 0, 0, 0);
            const isFuture = compareDate > today;

            if (btnAddCupOverlay) {
                btnAddCupOverlay.style.display = isFuture ? 'none' : '';
            }

            // Set selected date for Add a Cup (use selected date with current time)
            if (!isFuture) {
                btnAddCupOverlay.onclick = () => {
                    const now = new Date();
                    selectedDateTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), now.getHours(), now.getMinutes());
                    closeSheet(dayOverlayWrapper);
                    updateAddCoffeeDateTimeDisplay();
                    rebuildTypeGrid();
                    openSheet(modalAddCoffee);
                };
            }

            // Show overlay
            openSheet(dayOverlayWrapper);
        }

        // Build calendar logic moved up


        // ============================================================
        // STATISTICS
        // ============================================================
        const statsSubtitle = document.getElementById('stats-subtitle');
        const subWeek = document.getElementById('stats-sub-week');
        const subMonth = document.getElementById('stats-sub-month');
        const subYear = document.getElementById('stats-sub-year');
        const tabBtns = document.querySelectorAll('.tab-btn');
        const statTabIndicator = document.getElementById('stat-tab-indicator');

        // Init indicator position
        setTimeout(() => {
            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab && statTabIndicator) {
                statTabIndicator.style.left = `${activeTab.offsetLeft}px`;
                statTabIndicator.style.width = `${activeTab.offsetWidth}px`;
            }
        }, 50);

        let currentPeriod = 'week';

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const currentTab = document.querySelector('.tab-btn.active');
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentPeriod = btn.dataset.period;

                // Gooey elastic effect for tabs
                if (statTabIndicator && currentTab) {
                    const currentLeft = statTabIndicator.offsetLeft;
                    const targetLeft = btn.offsetLeft;
                    const targetWidth = btn.offsetWidth;
                    const distance = Math.abs(targetLeft - currentLeft);

                    if (distance > 0) {
                        const stretchWidth = targetWidth + (distance * 0.5);
                        statTabIndicator.style.transition = 'left 0.4s cubic-bezier(0.25, 1, 0.5, 1), width 0.2s ease-in';

                        if (targetLeft > currentLeft) {
                            statTabIndicator.style.width = `${stretchWidth}px`;
                        } else {
                            statTabIndicator.style.left = `${targetLeft}px`;
                            statTabIndicator.style.width = `${stretchWidth}px`;
                        }

                        setTimeout(() => {
                            statTabIndicator.style.transition = 'left 0.4s cubic-bezier(0.25, 1, 0.5, 1), width 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
                            statTabIndicator.style.width = `${targetWidth}px`;
                            statTabIndicator.style.left = `${targetLeft}px`;
                        }, 150);
                    } else {
                        statTabIndicator.style.width = `${targetWidth}px`;
                        statTabIndicator.style.left = `${targetLeft}px`;
                    }
                }
                updateStatsSubtitle();
                updateStatistics();
                requestDeviceOrientation();
            });
        });

        function updateStatsSubtitle() {
            if (subWeek && subMonth && subYear) {
                if (currentPeriod === 'week') {
                    subWeek.classList.remove('hidden');
                    subMonth.classList.remove('hidden');
                    subMonth.textContent = `${MONTHS_FULL[pickerSelectedMonth]} `;
                    subYear.textContent = pickerSelectedYear;
                } else if (currentPeriod === 'month') {
                    subWeek.classList.add('hidden');
                    subMonth.classList.remove('hidden');
                    subMonth.textContent = `${MONTHS_FULL[pickerSelectedMonth]} `;
                    subYear.textContent = pickerSelectedYear;
                } else {
                    subWeek.classList.add('hidden');
                    subMonth.classList.add('hidden');
                    subYear.textContent = pickerSelectedYear;
                }
            } else if (statsSubtitle) {
                if (currentPeriod === 'week') statsSubtitle.textContent = `Week of ${MONTHS_FULL[pickerSelectedMonth]} ${pickerSelectedYear}`;
                else if (currentPeriod === 'month') statsSubtitle.textContent = `${MONTHS_FULL[pickerSelectedMonth]} ${pickerSelectedYear}`;
                else statsSubtitle.textContent = `${pickerSelectedYear}`;
            }
        }

        // ============================================================
        // UPDATE STATISTICS
        // ============================================================
        function updateStatistics() {
            const now = new Date();
            let filtered = [];

            if (currentPeriod === 'week') {
                const dayOfWeek = now.getDay();
                const weekStart = new Date(now);
                weekStart.setDate(now.getDate() - dayOfWeek);
                weekStart.setHours(0, 0, 0, 0);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 7);
                filtered = coffeeEntries.filter(e => {
                    const d = new Date(e.date_string);
                    return d >= weekStart && d < weekEnd;
                });
            } else if (currentPeriod === 'month') {
                filtered = coffeeEntries.filter(e => {
                    const d = new Date(e.date_string);
                    return d.getMonth() === (typeof pickerSelectedMonth !== 'undefined' ? pickerSelectedMonth : now.getMonth())
                        && d.getFullYear() === (typeof pickerSelectedYear !== 'undefined' ? pickerSelectedYear : now.getFullYear());
                });
            } else {
                filtered = coffeeEntries.filter(e => {
                    const d = new Date(e.date_string);
                    return d.getFullYear() === (typeof pickerSelectedYear !== 'undefined' ? pickerSelectedYear : now.getFullYear());
                });
            }

            // Stickers display — Fluid Physics Scene
            const chartArea = document.getElementById('stats-chart-area');
            if (chartArea) {
                stickerPhysics.clear();

                if (filtered.length === 0) {
                    chartArea.innerHTML = '<div class="stickers-display"><p style="color:var(--text-muted);font-size:14px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);">No coffee yet</p></div>';
                } else {
                    chartArea.innerHTML = '<div class="stickers-display" id="physics-container"></div>';
                    const container = document.getElementById('physics-container');
                    stickerPhysics.init(container);

                    const cw = chartArea.clientWidth || 300;
                    const ch = chartArea.clientHeight || 200;

                    filtered.forEach((e) => {
                        const el = document.createElement('div');
                        el.className = 'sticker-layer';

                        if (e.sticker) {
                            el.innerHTML = `<img src="${e.sticker}" alt="" class="sticker-img">`;
                        } else {
                            el.innerHTML = `<span class="sticker-emoji">${e.emoji || '☕'}</span>`;
                        }

                        container.appendChild(el);

                        // Random start pos within bounds
                        const startX = Math.random() * (cw - STICKER_SIZE);
                        const startY = Math.random() * (ch - STICKER_SIZE);
                        const rotate = Math.floor(Math.random() * 60) - 30;

                        stickerPhysics.add(el, startX, startY, rotate);
                    });
                }
            }

            // Total cups & spend
            const totalCupsEl = document.getElementById('stat-total-cups');
            const totalSpendEl = document.getElementById('stat-total-spend');
            if (totalCupsEl) totalCupsEl.textContent = filtered.length;
            if (totalSpendEl) {
                const totalSpend = filtered.reduce((sum, e) => sum + (e.price || 0), 0);
                totalSpendEl.textContent = totalSpend.toLocaleString();
            }

            // Most popular
            const popularEl = document.getElementById('stat-most-popular');
            if (popularEl && filtered.length > 0) {
                const typeCounts = {};
                filtered.forEach(e => { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; });
                const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
                const topEmoji = (coffeeTypes.find(t => t.name === topType[0]) || {}).emoji || '☕';
                popularEl.innerHTML = `<div class="popular-icon">${topEmoji}</div><div class="popular-text"><h3>${topType[0]}</h3><p>${topType[1]} Cups</p></div>`;
            } else if (popularEl) {
                popularEl.innerHTML = '<div class="popular-icon">☕</div><div class="popular-text"><h3>—</h3><p>0 Cups</p></div>';
            }

            // Daily Cups bar chart
            const dailyChart = document.getElementById('daily-cups-chart');
            if (dailyChart) {
                let dayLabels, dayCounts;

                if (currentPeriod === 'week') {
                    // Week: 7 daily bars (S M T W T F S)
                    dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
                    dayCounts = new Array(7).fill(0);
                    filtered.forEach(e => {
                        const d = new Date(e.date_string);
                        const idx = d.getDay();
                        if (idx >= 0 && idx < 7) dayCounts[idx]++;
                    });
                } else if (currentPeriod === 'month') {
                    // Month: group by weeks (W1, W2, ... W4-6)
                    const selMonth = typeof pickerSelectedMonth !== 'undefined' ? pickerSelectedMonth : now.getMonth();
                    const selYear = typeof pickerSelectedYear !== 'undefined' ? pickerSelectedYear : now.getFullYear();
                    const firstDayOfMonth = new Date(selYear, selMonth, 1).getDay();
                    const totalDaysInMonth = new Date(selYear, selMonth + 1, 0).getDate();
                    const totalWeeks = Math.ceil((firstDayOfMonth + totalDaysInMonth) / 7);
                    dayLabels = Array.from({ length: totalWeeks }, (_, i) => `W${i + 1}`);
                    dayCounts = new Array(totalWeeks).fill(0);
                    filtered.forEach(e => {
                        const d = new Date(e.date_string);
                        const dayOfMonth = d.getDate();
                        const weekIdx = Math.floor((firstDayOfMonth + dayOfMonth - 1) / 7);
                        if (weekIdx >= 0 && weekIdx < totalWeeks) dayCounts[weekIdx]++;
                    });
                } else {
                    // Year: 12 monthly bars
                    dayLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    dayCounts = new Array(12).fill(0);
                    filtered.forEach(e => {
                        const d = new Date(e.date_string);
                        dayCounts[d.getMonth()]++;
                    });
                }

                const maxCount = Math.max(...dayCounts, 1);
                let chartHtml = '';
                dayLabels.forEach((label, i) => {
                    const h = (dayCounts[i] / maxCount) * 90;
                    const countLabel = dayCounts[i] > 0 ? dayCounts[i] : '';
                    chartHtml += `<div class="daily-bar-col">
                        <span class="daily-bar-count">${countLabel}</span>
                        <div class="daily-bar" style="height:${Math.max(h, 4)}px;${dayCounts[i] === 0 ? 'opacity:0.2;' : ''}"></div>
                        <span class="daily-bar-label">${label}</span>
                    </div>`;
                });
                dailyChart.innerHTML = chartHtml;
            }

            // By Type donut chart
            const byTypeChart = document.getElementById('by-type-chart');
            if (byTypeChart) {
                if (filtered.length === 0) {
                    byTypeChart.innerHTML = '<p style="color:var(--text-muted);font-size:14px;">No data</p>';
                    return;
                }
                const typeCounts = {};
                filtered.forEach(e => { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; });
                const total = filtered.length;
                const entries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);

                const DONUT_COLORS = ['#8b6b4a', '#b8956a', '#d4b896', '#c9a87c', '#a68b6b', '#e8d5c0', '#6b4f35'];
                let gradientParts = [];
                let cumPct = 0;
                entries.forEach(([type, count], i) => {
                    const pct = (count / total) * 100;
                    const color = DONUT_COLORS[i % DONUT_COLORS.length];
                    gradientParts.push(`${color} ${cumPct}% ${cumPct + pct}%`);
                    cumPct += pct;
                });

                let legendHtml = '';
                entries.forEach(([type, count], i) => {
                    const pct = Math.round((count / total) * 100);
                    const color = DONUT_COLORS[i % DONUT_COLORS.length];
                    const emoji = (coffeeTypes.find(t => t.name === type) || {}).emoji || '☕';
                    legendHtml += `<div class="legend-item"><span class="legend-dot" style="background:${color}"></span>${emoji} ${type}<span class="legend-pct">${pct}%</span></div>`;
                });

                byTypeChart.innerHTML = `
                    <div class="donut-chart" style="background:conic-gradient(${gradientParts.join(',')});">
                        <div class="donut-hole"><span class="donut-total">${total}</span><span class="donut-label">total</span></div>
                    </div>
                    <div class="donut-legend">${legendHtml}</div>`;
            }
        }

        // Year/Month Picker
        const pickerOverlay = document.getElementById('picker-overlay');
        const btnOpenPicker = document.getElementById('btn-open-picker');
        const btnPickerDone = document.getElementById('btn-picker-done');
        const pickerYearCol = document.getElementById('picker-year');
        const pickerMonthCol = document.getElementById('picker-month');
        let pickerSelectedYear = new Date().getFullYear();
        let pickerSelectedMonth = new Date().getMonth();

        function buildPicker() {
            pickerYearCol.innerHTML = '';
            for (let y = 2025; y <= 2026; y++) {
                const item = document.createElement('div');
                item.classList.add('picker-item');
                if (y === pickerSelectedYear) item.classList.add('selected');
                item.textContent = y;
                item.addEventListener('click', () => { pickerSelectedYear = y; updatePickerSel(); });
                pickerYearCol.appendChild(item);
            }
            pickerMonthCol.innerHTML = '';
            MONTHS_FULL.forEach((m, i) => {
                const item = document.createElement('div');
                item.classList.add('picker-item');
                if (i === pickerSelectedMonth) item.classList.add('selected');
                item.textContent = m;
                item.addEventListener('click', () => { pickerSelectedMonth = i; updatePickerSel(); });
                pickerMonthCol.appendChild(item);
            });
            setTimeout(() => {
                scrollTo(pickerYearCol, pickerSelectedYear - 2025);
                scrollTo(pickerMonthCol, pickerSelectedMonth);
            }, 50);
        }

        function scrollTo(col, idx) { const item = col.children[idx]; if (item) col.scrollTo({ top: item.offsetTop - col.offsetHeight / 2 + 20, behavior: 'smooth' }); }
        function updatePickerSel() {
            pickerYearCol.querySelectorAll('.picker-item').forEach((item, i) => item.classList.toggle('selected', (2025 + i) === pickerSelectedYear));
            pickerMonthCol.querySelectorAll('.picker-item').forEach((item, i) => item.classList.toggle('selected', i === pickerSelectedMonth));
        }

        if (btnOpenPicker) btnOpenPicker.addEventListener('click', () => { buildPicker(); openSheet(pickerOverlay); });
        if (btnPickerDone) btnPickerDone.addEventListener('click', () => { closeSheet(pickerOverlay); updateStatsSubtitle(); });
        updateStatsSubtitle();

        // ============================================================
        // SETTINGS — COFFEE TYPE EDITOR
        // ============================================================
        const modalTypeEditor = document.getElementById('modal-type-editor');
        const btnOpenTypeEditor = document.getElementById('btn-open-type-editor');
        const btnCloseTypeEditor = document.getElementById('btn-close-type-editor');
        const btnSaveTypes = document.getElementById('btn-save-types');
        const typeEditorList = document.getElementById('type-editor-list');

        let editingTypes = [];
        let editingTypeIdx = null; // for edit mode

        if (btnOpenTypeEditor) btnOpenTypeEditor.addEventListener('click', () => {
            editingTypes = coffeeTypes.map(t => ({ ...t }));
            renderTypeEditor();
            openSheet(modalTypeEditor);
        });

        if (btnCloseTypeEditor) btnCloseTypeEditor.addEventListener('click', () => closeSheet(modalTypeEditor));

        if (btnSaveTypes) btnSaveTypes.addEventListener('click', async () => {
            // Save to DB
            coffeeTypes = editingTypes.map(t => ({ ...t }));
            closeSheet(modalTypeEditor);
            rebuildTypeGrid();

            if (currentUser) {
                // Delete all existing, re-insert with order
                await supabase.from('user_coffee_types').delete().eq('user_id', currentUser.id);
                const inserts = coffeeTypes.map((t, i) => ({
                    user_id: currentUser.id, emoji: t.emoji, name: t.name, sort_order: i
                }));
                const { data, error } = await supabase.from('user_coffee_types').insert(inserts).select();
                if (!error && data) {
                    coffeeTypes = data.map(d => ({ id: d.id, emoji: d.emoji, name: d.name }));
                }
            }
            showSaveToast();
        });

        // +Others button in type editor
        const btnAddOthersEditor = document.getElementById('btn-add-others-editor');
        if (btnAddOthersEditor) {
            btnAddOthersEditor.addEventListener('click', () => {
                openNewTypeModal(true); // fromEditor = true
            });
        }

        function renderTypeEditor() {
            typeEditorList.innerHTML = '';
            // Match the grid style of the selection screen
            typeEditorList.classList.add('coffee-type-grid');

            editingTypes.forEach((t, i) => {
                const card = document.createElement('div');
                card.className = 'type-card-lg';
                card.style.position = 'relative';
                card.innerHTML = `
                    <span class="type-emoji">${t.emoji}</span>
                    <span>${t.name}</span>
                    <button class="type-delete-btn" title="Delete" style="position: absolute; top: -6px; right: -6px; background: #FF3B30; color: white; border: none; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 14px; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.15); z-index: 2;">
                        <i class="ph-bold ph-trash"></i>
                    </button>
                `;

                // Click to edit
                card.addEventListener('click', (e) => {
                    if (e.target.closest('.type-delete-btn')) return;
                    editingTypeIdx = i;
                    openEditTypeModal(t, true);
                });

                // Delete logic
                card.querySelector('.type-delete-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (editingTypes.length <= 1) return;
                    editingTypes.splice(i, 1);
                    renderTypeEditor();
                });

                typeEditorList.appendChild(card);
            });
        }

        // ============================================================
        // NEW / EDIT COFFEE TYPE MODAL
        // ============================================================
        const modalNewType = document.getElementById('modal-new-type');
        const newTypeTitle = document.getElementById('new-type-title');
        const newTypeIconEmoji = document.getElementById('new-type-icon-emoji');
        const btnEditTypeIcon = document.getElementById('btn-edit-type-icon');
        const inputNewTypeName = document.getElementById('input-new-type-name');
        const btnCancelNewType = document.getElementById('btn-cancel-new-type');
        const btnSaveNewType = document.getElementById('btn-save-new-type');
        let newTypeEmoji = '☕';
        let newTypeFromEditor = false;

        function openNewTypeModal(fromEditor = false) {
            newTypeFromEditor = fromEditor;
            editingTypeIdx = null;
            newTypeEmoji = '☕';
            if (newTypeTitle) newTypeTitle.textContent = 'New Coffee Type';
            if (newTypeIconEmoji) newTypeIconEmoji.textContent = newTypeEmoji;
            if (inputNewTypeName) inputNewTypeName.value = '';
            if (modalNewType) openSheet(modalNewType, { noStack: true });
        }

        function openEditTypeModal(typeObj, fromEditor = false) {
            newTypeFromEditor = fromEditor;
            newTypeEmoji = typeObj.emoji;
            if (newTypeTitle) newTypeTitle.textContent = 'Edit Coffee Type';
            if (newTypeIconEmoji) newTypeIconEmoji.textContent = typeObj.emoji;
            if (inputNewTypeName) inputNewTypeName.value = typeObj.name;
            if (modalNewType) openSheet(modalNewType, { noStack: true });
        }

        if (btnCancelNewType) btnCancelNewType.addEventListener('click', () => {
            closeSheet(modalNewType);
        });

        if (btnEditTypeIcon) btnEditTypeIcon.addEventListener('click', () => {
            openIconPicker(newTypeEmoji, (emoji) => {
                newTypeEmoji = emoji;
                if (newTypeIconEmoji) newTypeIconEmoji.textContent = emoji;
            });
        });

        // Also allow clicking the icon preview itself
        if (newTypeIconEmoji) newTypeIconEmoji.addEventListener('click', () => {
            openIconPicker(newTypeEmoji, (emoji) => {
                newTypeEmoji = emoji;
                newTypeIconEmoji.textContent = emoji;
            });
        });

        if (btnSaveNewType) btnSaveNewType.addEventListener('click', async () => {
            const name = inputNewTypeName?.value?.trim();
            if (!name) return;

            const newType = { emoji: newTypeEmoji, name };

            if (newTypeFromEditor) {
                // Editing within the type editor
                if (editingTypeIdx !== null) {
                    editingTypes[editingTypeIdx].emoji = newTypeEmoji;
                    editingTypes[editingTypeIdx].name = name;
                } else {
                    editingTypes.push(newType);
                }
                renderTypeEditor();
            } else {
                // Adding from Add Coffee → save directly to DB
                coffeeTypes.push(newType);
                if (currentUser) {
                    const { data, error } = await supabase.from('user_coffee_types')
                        .insert([{ user_id: currentUser.id, emoji: newTypeEmoji, name, sort_order: coffeeTypes.length - 1 }])
                        .select();
                    if (!error && data && data[0]) {
                        coffeeTypes[coffeeTypes.length - 1].id = data[0].id;
                    }
                }
                rebuildTypeGrid();
            }
            closeSheet(modalNewType);
        });

        // ============================================================
        // ICON PICKER
        // ============================================================
        const iconPickerOverlay = document.getElementById('icon-picker-overlay');
        const iconPickerSelected = document.getElementById('icon-picker-selected');
        const iconPickerGrid = document.getElementById('icon-picker-grid');
        const inputOtherEmoji = document.getElementById('input-other-emoji');
        const btnIconPickerDone = document.getElementById('btn-icon-picker-done');

        const ICON_EMOJIS = [
            '☕', '🥤', '🧋', '🍵', '🫖',
            '🥛', '🍼', '🧃', '🥃', '🍷',
            '🥂', '🍾', '🍸', '🍹', '☁️',
            '⚪', '🔥', '🧊', '🍫', '🍪',
            '🥐', '🧈', '🍰', '🎂', '🌟'
        ];

        let iconPickerCallback = null;
        let selectedIconEmoji = '☕';

        function openIconPicker(currentEmoji, callback) {
            selectedIconEmoji = currentEmoji;
            iconPickerCallback = callback;
            if (iconPickerSelected) iconPickerSelected.textContent = currentEmoji;
            if (inputOtherEmoji) inputOtherEmoji.value = '';

            // Build grid
            if (iconPickerGrid) {
                iconPickerGrid.innerHTML = '';
                ICON_EMOJIS.forEach(emoji => {
                    const item = document.createElement('div');
                    item.className = 'icon-picker-item' + (emoji === currentEmoji ? ' selected' : '');
                    item.textContent = emoji;
                    item.addEventListener('click', () => {
                        selectedIconEmoji = emoji;
                        iconPickerSelected.textContent = emoji;
                        if (inputOtherEmoji) inputOtherEmoji.value = '';
                        iconPickerGrid.querySelectorAll('.icon-picker-item').forEach(i => i.classList.remove('selected'));
                        item.classList.add('selected');
                    });
                    iconPickerGrid.appendChild(item);
                });
            }

            // Listen for custom emoji input
            if (inputOtherEmoji) {
                inputOtherEmoji.oninput = () => {
                    const val = inputOtherEmoji.value.trim();
                    if (val) {
                        selectedIconEmoji = val;
                        if (iconPickerSelected) iconPickerSelected.textContent = val;
                        iconPickerGrid.querySelectorAll('.icon-picker-item').forEach(i => i.classList.remove('selected'));
                    }
                };
            }

            if (iconPickerOverlay) openSheet(iconPickerOverlay);
        }

        if (btnIconPickerDone) btnIconPickerDone.addEventListener('click', () => {
            if (iconPickerCallback) iconPickerCallback(selectedIconEmoji);
            closeSheet(iconPickerOverlay);
        });

        // ============================================================
        // SETTINGS — LANGUAGE PICKER
        // ============================================================
        const langOverlay = document.getElementById('lang-overlay');
        const btnOpenLang = document.getElementById('btn-open-language');
        const btnLangDone = document.getElementById('btn-lang-done');

        if (btnOpenLang) btnOpenLang.addEventListener('click', () => openSheet(langOverlay));
        if (btnLangDone) btnLangDone.addEventListener('click', () => closeSheet(langOverlay));

        // Language option selection
        document.querySelectorAll('.lang-option').forEach(opt => {
            opt.addEventListener('click', () => {
                document.querySelectorAll('.lang-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                const lang = opt.querySelector('span').textContent;
                document.getElementById('current-lang').textContent = lang;
            });
        });
        async function requestDeviceOrientation() {
            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                try {
                    const permission = await DeviceOrientationEvent.requestPermission();
                    if (permission === 'granted') {
                        console.log('DeviceOrientation permission granted');
                    }
                } catch (error) {
                    console.error('DeviceOrientation permission error:', error);
                }
            }
        }
    } catch (err) {
        console.error('App initialization error:', err);
    }
})();
