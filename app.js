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

        // Setup Auth Listener
        supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN') {
                currentUser = session.user;
                updateUserGreeting();
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

        // Coffee types (editable)
        let coffeeTypes = [
            { emoji: '☕', name: 'Espresso' },
            { emoji: '🥛', name: 'Latte' },
            { emoji: '⚪', name: 'Flat White' },
            { emoji: '🥃', name: 'Americano' },
            { emoji: '☁️', name: 'Cappuccino' },
            { emoji: '🍫', name: 'Mocha' }
        ];

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
            updateUserGreeting();
            fetchCoffeeEntries();
            switchView('view-calendar');
        } else {
            if (error) console.error('Error fetching session:', error.message);
            switchView('view-login');
        }

        function updateUserGreeting() {
            const greetingEl = document.getElementById('user-greeting');
            if (!greetingEl) return;

            if (!currentUser) {
                greetingEl.textContent = 'Mar'; // Fallback
                return;
            }

            const hour = new Date().getHours();
            let timeOfDay = 'Morning';
            if (hour >= 12 && hour < 17) timeOfDay = 'Afternoon';
            else if (hour >= 17 || hour < 4) timeOfDay = 'Evening';

            const name = localStorage.getItem('monicoffee_display_name')
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
                        redirectTo: window.location.origin + window.location.pathname
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
            const savedName = localStorage.getItem('monicoffee_display_name');
            if (savedName) inputDisplayName.value = savedName;
            else if (currentUser) {
                inputDisplayName.value = currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || '';
            }
        }

        if (btnSaveDisplayName) {
            btnSaveDisplayName.addEventListener('click', () => {
                const newName = inputDisplayName?.value?.trim();
                if (newName) {
                    localStorage.setItem('monicoffee_display_name', newName);
                    updateUserGreeting();
                    alert('Display name saved!');
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

        // --- ADD COFFEE MODAL ---
        const btnAddCup = document.getElementById('btn-add-cup-main');
        const modalAddCoffee = document.getElementById('modal-add-coffee');
        const btnCancelAdd = document.getElementById('btn-cancel-add');
        const btnSaveCoffee = document.getElementById('btn-save-coffee');

        if (btnAddCup) btnAddCup.addEventListener('click', () => { updateAddCoffeeDateTime(); rebuildTypeGrid(); modalAddCoffee.classList.add('active'); });
        if (btnCancelAdd) btnCancelAdd.addEventListener('click', () => modalAddCoffee.classList.remove('active'));

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
            dtPickerOverlay.classList.add('active');
        });

        if (btnDtPickerDone) btnDtPickerDone.addEventListener('click', () => {
            const now = new Date();
            selectedDateTime = new Date(now.getFullYear(), now.getMonth(), pickerSelectedDtDate, pickerSelectedDtHour, pickerSelectedDtMinute);
            updateAddCoffeeDateTimeDisplay();
            dtPickerOverlay.classList.remove('active');
        });

        if (dtPickerOverlay) dtPickerOverlay.addEventListener('click', (e) => {
            if (e.target === dtPickerOverlay) dtPickerOverlay.classList.remove('active');
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
        }

        // --- FORM STATE ---
        let selectedDateTime = new Date();
        let selectedType = 'Americano';
        let selectedSize = 'Small';
        let selectedTemp = 'Iced';
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

                const entry = {
                    user_id: currentUser ? currentUser.id : null,
                    type: selectedType, size: selectedSize, temp: selectedTemp,
                    time: timeStr, price, sticker: null,
                    emoji: getTypeEmoji(selectedType),
                    date_string: selectedDateTime.toDateString() // mapping dateString to date_string
                };

                if (uploadedPhotoBlob) {
                    // Process with imgly bg removal
                    btnSaveCoffee.textContent = 'Processing...';
                    btnSaveCoffee.disabled = true;
                    try {
                        const stickerBlob = await removeBackground(uploadedPhotoBlob);
                        // Upload to Supabase Storage
                        const fileName = `${currentUser ? currentUser.id : 'anon'}/${Date.now()}.png`;
                        const { data: uploadData, error: uploadError } = await supabase.storage
                            .from('stickers')
                            .upload(fileName, stickerBlob, {
                                contentType: 'image/png',
                                upsert: false
                            });
                        if (uploadError) {
                            console.error('Storage upload error:', uploadError.message);
                        } else {
                            // Get public URL
                            const { data: urlData } = supabase.storage
                                .from('stickers')
                                .getPublicUrl(fileName);
                            entry.sticker = urlData.publicUrl;
                        }
                    } catch (err) {
                        console.error('BG removal / upload failed:', err);
                    }
                    btnSaveCoffee.textContent = 'Save';
                    btnSaveCoffee.disabled = false;
                }

                if (currentUser) {
                    const { data, error } = await supabase.from('coffee_entries').insert([entry]).select();
                    if (error) {
                        console.error('Insert error:', error.message);
                    } else if (data) {
                        coffeeEntries.unshift(data[0]); // Add to local array
                    }
                } else {
                    coffeeEntries.unshift(entry); // Fallback for local testing
                }

                renderTodayCoffee();
                updateCalendarStickers();
                modalAddCoffee.classList.remove('active');
                resetPhotoBox();
            });
        }

        function renderTodayCoffee() {
            if (!todayCoffeeList) return;
            const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

            const todayStr = new Date().toDateString();
            const allWithIdx = coffeeEntries.map((e, idx) => ({ ...e, originalIdx: idx }));
            const todaysCoffees = allWithIdx.filter(e => e.date_string === todayStr);
            const pastCoffees = allWithIdx.filter(e => e.date_string && e.date_string !== todayStr);

            // --- TODAY ---
            if (todaysCoffees.length === 0) {
                todayCoffeeList.innerHTML = `<div class="card empty-state-card"><div class="empty-state-icon">☕</div><p class="empty-state-text">None, take a sip!</p></div>`;
            } else {
                todayCoffeeList.innerHTML = '';
                todaysCoffees.forEach((entry) => {
                    const tempIcon = entry.temp === 'Hot' ? '♨️' : '🧊';
                    const stickerHtml = entry.sticker
                        ? `<img src="${entry.sticker}" alt="sticker" class="coffee-item-sticker">`
                        : `<span class="coffee-item-emoji">${entry.emoji || '☕'}</span>`;

                    todayCoffeeList.insertAdjacentHTML('beforeend', `
                    <div class="swipe-container">
                        <div class="swipe-content coffee-item-card" data-idx="${entry.originalIdx}">
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
                            <button class="action-btn delete-btn" data-del="${entry.id || entry.originalIdx}"><i class="ph ph-trash"></i><span>Delete</span></button>
                        </div>
                    </div>`);
                });
                todayCoffeeList.querySelectorAll('.swipe-content').forEach(initSwipe);
                todayCoffeeList.querySelectorAll('.delete-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const delId = btn.dataset.del;
                        if (currentUser && typeof delId === 'string' && delId.length > 5) {
                            const { error } = await supabase.from('coffee_entries').delete().eq('id', delId);
                            if (!error) {
                                const idx = coffeeEntries.findIndex(e => e.id === delId);
                                if (idx !== -1) coffeeEntries.splice(idx, 1);
                            } else {
                                console.error('Delete error', error.message);
                            }
                        } else {
                            coffeeEntries.splice(parseInt(delId), 1);
                        }
                        renderTodayCoffee();
                        updateCalendarStickers();
                    });
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
                    const tempIcon = entry.temp === 'Hot' ? '♨️' : '🧊';
                    const stickerHtml = entry.sticker
                        ? `<img src="${entry.sticker}" alt="sticker" class="coffee-item-sticker">`
                        : `<span class="coffee-item-emoji">${entry.emoji || '☕'}</span>`;
                    pastCoffeeList.insertAdjacentHTML('beforeend', `
                        <div class="card coffee-item-card" style="margin-bottom:10px;">
                            <div class="coffee-item-info">
                                <div class="coffee-item-icon">${stickerHtml}</div>
                                <div class="coffee-item-text">
                                    <h3>${entry.type} ${tempIcon}</h3>
                                    <p>${entry.size} • ${entry.time}</p>
                                </div>
                            </div>
                            ${entry.price ? `<div class="coffee-item-price">${entry.price}</div>` : ''}
                        </div>`);
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
        const dayOverlay = document.getElementById('day-overlay');
        const dayOverlayBackdrop = document.getElementById('day-overlay-backdrop');
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
            const dayCoffees = coffeeEntries.filter(e => e.date_string === dateStr);
            dayOverlayCupCount.textContent = `${dayCoffees.length} Cup${dayCoffees.length !== 1 ? 's' : ''}`;

            dayOverlayRecords.innerHTML = '';
            if (dayCoffees.length === 0) {
                dayOverlayRecords.innerHTML = '<div class="card empty-state-card"><div class="empty-state-icon">☕</div><p class="empty-state-text">No records yet</p></div>';
            } else {
                dayCoffees.forEach(entry => {
                    const tempIcon = entry.temp === 'Hot' ? '♨️' : '🧊';
                    const stickerHtml = entry.sticker
                        ? `<img src="${entry.sticker}" alt="sticker" class="coffee-item-sticker">`
                        : `<span class="coffee-item-emoji">${entry.emoji || '☕'}</span>`;
                    dayOverlayRecords.insertAdjacentHTML('beforeend', `
                        <div class="card coffee-item-card" style="margin-bottom:10px;">
                            <div class="coffee-item-info">
                                <div class="coffee-item-icon">${stickerHtml}</div>
                                <div class="coffee-item-text">
                                    <h3>${entry.type} ${tempIcon}</h3>
                                    <p>${entry.size} • ${entry.time}</p>
                                </div>
                            </div>
                            ${entry.price ? `<div class="coffee-item-price">${entry.price}</div>` : ''}
                        </div>`);
                });
            }

            // Set selected date for Add a Cup
            btnAddCupOverlay.onclick = () => {
                selectedDateTime = date;
                closeDayOverlay();
                if (modalAddCoffee) modalAddCoffee.classList.add('active');
            };

            // Show overlay
            dayOverlayBackdrop.classList.add('active');
            dayOverlay.classList.add('active');
        }

        function closeDayOverlay() {
            dayOverlay.classList.remove('active');
            dayOverlayBackdrop.classList.remove('active');
        }

        // Close on backdrop click
        if (dayOverlayBackdrop) dayOverlayBackdrop.addEventListener('click', closeDayOverlay);

        // Swipe-down to close
        const dayOverlayHandle = document.getElementById('day-overlay-handle');
        if (dayOverlayHandle && dayOverlay) {
            let swipeStartY = 0, swipeCurrentY = 0, isSwiping = false;

            dayOverlayHandle.addEventListener('touchstart', (e) => {
                swipeStartY = e.touches[0].clientY;
                isSwiping = true;
                dayOverlay.style.transition = 'none';
            }, { passive: true });

            dayOverlayHandle.addEventListener('touchmove', (e) => {
                if (!isSwiping) return;
                swipeCurrentY = e.touches[0].clientY;
                const diff = swipeCurrentY - swipeStartY;
                if (diff > 0) {
                    dayOverlay.style.transform = `translateY(${diff}px)`;
                }
            }, { passive: true });

            dayOverlayHandle.addEventListener('touchend', () => {
                isSwiping = false;
                dayOverlay.style.transition = 'transform 0.35s cubic-bezier(0.32,0.72,0,1)';
                const diff = swipeCurrentY - swipeStartY;
                if (diff > 120) {
                    closeDayOverlay();
                    dayOverlay.style.transform = '';
                } else {
                    dayOverlay.style.transform = 'translateY(0)';
                }
                swipeCurrentY = 0;
            });
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

        let currentPeriod = 'month';

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
                // fallback
                if (currentPeriod === 'week') statsSubtitle.textContent = `Week of ${MONTHS_FULL[pickerSelectedMonth]} ${pickerSelectedYear}`;
                else if (currentPeriod === 'month') statsSubtitle.textContent = `${MONTHS_FULL[pickerSelectedMonth]} ${pickerSelectedYear}`;
                else statsSubtitle.textContent = `${pickerSelectedYear}`;
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

        if (btnOpenPicker) btnOpenPicker.addEventListener('click', () => { buildPicker(); pickerOverlay.classList.add('active'); });
        if (btnPickerDone) btnPickerDone.addEventListener('click', () => { pickerOverlay.classList.remove('active'); updateStatsSubtitle(); });
        if (pickerOverlay) pickerOverlay.addEventListener('click', (e) => { if (e.target === pickerOverlay) { pickerOverlay.classList.remove('active'); updateStatsSubtitle(); } });
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

        if (btnOpenTypeEditor) btnOpenTypeEditor.addEventListener('click', () => {
            editingTypes = coffeeTypes.map(t => ({ ...t }));
            renderTypeEditor();
            modalTypeEditor.classList.add('active');
        });

        if (btnCloseTypeEditor) btnCloseTypeEditor.addEventListener('click', () => modalTypeEditor.classList.remove('active'));

        if (btnSaveTypes) btnSaveTypes.addEventListener('click', () => {
            // Read values from inputs
            typeEditorList.querySelectorAll('.type-editor-row').forEach((row, i) => {
                editingTypes[i].name = row.querySelector('.type-name-input').value;
                editingTypes[i].emoji = row.querySelector('.type-emoji-btn').textContent;
            });
            coffeeTypes = editingTypes.map(t => ({ ...t }));
            modalTypeEditor.classList.remove('active');
        });

        function renderTypeEditor() {
            typeEditorList.innerHTML = '';
            editingTypes.forEach((t, i) => {
                const row = document.createElement('div');
                row.className = 'type-editor-row';
                row.draggable = true;
                row.dataset.idx = i;
                row.innerHTML = `
                <span class="drag-handle">☰</span>
                <button class="type-emoji-btn" title="Change emoji">${t.emoji}</button>
                <input type="text" class="type-name-input" value="${t.name}">
            `;
                // Emoji click → prompt for new emoji
                row.querySelector('.type-emoji-btn').addEventListener('click', () => {
                    const newEmoji = prompt('Enter new emoji:', t.emoji);
                    if (newEmoji) {
                        row.querySelector('.type-emoji-btn').textContent = newEmoji;
                        editingTypes[i].emoji = newEmoji;
                    }
                });
                typeEditorList.appendChild(row);
            });

            // Drag & Drop reorder
            let dragIdx = null;
            typeEditorList.querySelectorAll('.type-editor-row').forEach(row => {
                row.addEventListener('dragstart', (e) => {
                    dragIdx = parseInt(row.dataset.idx);
                    row.style.opacity = '0.4';
                });
                row.addEventListener('dragend', () => { row.style.opacity = '1'; });
                row.addEventListener('dragover', (e) => { e.preventDefault(); });
                row.addEventListener('drop', (e) => {
                    e.preventDefault();
                    const dropIdx = parseInt(row.dataset.idx);
                    if (dragIdx !== null && dragIdx !== dropIdx) {
                        const [moved] = editingTypes.splice(dragIdx, 1);
                        editingTypes.splice(dropIdx, 0, moved);
                        renderTypeEditor();
                    }
                    dragIdx = null;
                });
            });
        }

        // ============================================================
        // SETTINGS — LANGUAGE PICKER
        // ============================================================
        const langOverlay = document.getElementById('lang-overlay');
        const btnOpenLang = document.getElementById('btn-open-language');
        const btnLangDone = document.getElementById('btn-lang-done');

        if (btnOpenLang) btnOpenLang.addEventListener('click', () => langOverlay.classList.add('active'));
        if (btnLangDone) btnLangDone.addEventListener('click', () => langOverlay.classList.remove('active'));
        if (langOverlay) langOverlay.addEventListener('click', (e) => { if (e.target === langOverlay) langOverlay.classList.remove('active'); });

        // Language option selection
        document.querySelectorAll('.lang-option').forEach(opt => {
            opt.addEventListener('click', () => {
                document.querySelectorAll('.lang-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                const lang = opt.querySelector('span').textContent;
                document.getElementById('current-lang').textContent = lang;
            });
        });
    } catch (err) {
        console.error('App initialization error:', err);
    }
})();
