let __toastQueue = 0;
const SESSION_STORAGE_KEY = 'activeSession';

let loadingCount = 0;

function showLoading() {
    loadingCount++;
    if (loadingCount === 1) {
        const div = document.createElement('div');
        div.id = 'loading';
        div.className = 'loading';
        div.innerHTML = 'Loading...';
        document.body.appendChild(div);
    }
}

function hideLoading() {
    loadingCount--;
    if (loadingCount === 0) {
        const div = document.getElementById('loading');
        if (div) div.remove();
    }
}
function getActiveSession() {
    try {
        const raw = localStorage.getItem(SESSION_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

// Show loading on a specific button
function showButtonLoading(button, originalText = null) {
    if (!button) return;
    button._originalText = originalText || button.textContent;
    button.textContent = '...';
    button.disabled = true;
    button.classList.add('btn-loading');
}

// Restore button
function hideButtonLoading(button) {
    if (!button) return;
    button.textContent = button._originalText || button.textContent;
    button.disabled = false;
    button.classList.remove('btn-loading');
}

function setActiveSession(user, token = '') {
    const session = {
        email: user.email,
        role: user.role,
        name: user.name,
        token,
        loggedInAt: new Date().toISOString()
    };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    localStorage.setItem('userEmail', user.email);
}

function clearActiveSession() {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem('userEmail');
}

function getCurrentUserEmail() {
    return getActiveSession()?.email || localStorage.getItem('userEmail') || '';
}

function getAuthToken() {
    return getActiveSession()?.token || '';
}

// ========================================
// API REQUEST HELPER
// ========================================
async function apiRequest(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = getAuthToken();

    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options.body !== undefined && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    showLoading();

    try {
        const response = await fetch(path, { ...options, headers });

        const contentType = response.headers.get('content-type') || '';
        const payload = response.status === 204
            ? null
            : contentType.includes('application/json')
                ? await response.json()
                : await response.text();

        if (!response.ok) {
            const message = typeof payload === 'string'
                ? payload
                : payload?.error || `Request failed with status ${response.status}`;
            const error = new Error(message);
            error.status = response.status;
            error.details = payload?.details || null;
            throw error;
        }

        return payload;
    } finally {
        hideLoading(); // This runs whether success OR error
    }
}

// ========================================
// REDIRECT
// ========================================
function redirectToDashboard(role) {
    window.location.href = role === 'Admin' ? 'admin_dashboard.html' : 'user_dashboard.html';
}

// ========================================
// DATE / TIME HELPERS
// ========================================
function formatDisplayDate(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text)
        ? new Date(`${text}T00:00:00`)
        : new Date(text);
    if (Number.isNaN(parsed.getTime())) return text;
    return parsed.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

function toDateInputValue(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
}

function toApiTimeValue(value) {
    const text = String(value || '').trim();
    if (/^\d{2}:\d{2}$/.test(text)) return text;
    const parsed = new Date(`2000-01-01 ${text}`);
    if (Number.isNaN(parsed.getTime())) return '';
    return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
}

function formatTimeRange(start, end) {
    try {
        const opts = { hour: 'numeric', minute: '2-digit' };
        return `${start.toLocaleTimeString([], opts)} - ${end.toLocaleTimeString([], opts)}`;
    } catch (e) {
        return '';
    }
}

// ========================================
// NORMALIZE API RESPONSES FOR UI
// ========================================
function normalizeEmployeeForUi(employee) {
    return { ...employee, joined: formatDisplayDate(employee.joinedAt) };
}

function normalizeMeetingForUi(meeting) {
    return { ...meeting, date: formatDisplayDate(meeting.date), rawDate: meeting.date };
}

function normalizeBookingForUi(booking) {
    return {
        ...booking,
        conference: booking.meetingName,
        date: formatDisplayDate(booking.bookingDate)
    };
}

// ========================================
// RUNTIME STATE (replaces BookingSystem localStorage)
// ========================================
const appState = {
    employees: [],
    rooms: [],
    bookings: [],
    meetings: [],
    settings: loadUiSettings(),
    adminSummary: null
};

// UI settings (language, timezone, notifications) are fine in localStorage
// as they are truly per-device preferences, not shared data
function loadUiSettings() {
    try {
        const raw = localStorage.getItem('userSettings');
        return raw ? JSON.parse(raw) : getDefaultSettings();
    } catch (e) {
        return getDefaultSettings();
    }
}

function saveUiSettings(settings) {
    localStorage.setItem('userSettings', JSON.stringify(settings));
}

function getDefaultSettings() {
    return {
        emailNotifications: true,
        smsReminders: true,
        newsletter: false,
        language: detectLanguage(),
        timezone: detectTimezone()
    };
}

function detectLanguage() {
    const lang = navigator.language || 'en';
    if (lang.startsWith('es')) return 'es';
    if (lang.startsWith('fr')) return 'fr';
    return 'en';
}

function detectTimezone() {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const map = {
            'Africa/Accra': 'GMT (UTC+00:00)',
            'America/New_York': 'UTC-5 (Eastern Time)',
            'America/Chicago': 'UTC-6 (Central Time)',
            'America/Denver': 'UTC-7 (Mountain Time)',
            'America/Los_Angeles': 'UTC-8 (Pacific Time)'
        };
        return map[tz] || 'UTC';
    } catch (e) {
        return 'UTC';
    }
}

// ========================================
// ROOM HELPERS (client-side scoring only - no localStorage)
// ========================================
function getCapacityLabel(capacity) {
    const value = Number(capacity) || 0;
    return value > 0 ? `${value}+` : 'N/A';
}

function getDefaultRoomImage(roomName, roomType) {
    const name = String(roomName || '').toLowerCase();
    if (name === 'meeting room a') return 'assets/rooms/meeting-room-a.jpeg';
    if (roomType === 'board') return 'assets/rooms/board-room-50+.jpeg';
    if (roomType === 'briefing') return 'assets/rooms/briefing-room-8+.jpeg';
    if (roomType === 'training') return 'assets/rooms/training-room-50+.jpeg';
    return 'assets/rooms/meeting-room-10+.jpeg';
}

function inferRoomType(roomName) {
    const name = String(roomName || '').toLowerCase();
    if (name.includes('training')) return 'training';
    if (name.includes('board')) return 'board';
    if (name.includes('briefing')) return 'briefing';
    return 'meeting';
}

function normalizeRoomForUi(room) {
    const roomType = room.roomType || inferRoomType(room.name);
    const capacity = typeof room.capacity === 'number' ? room.capacity : parseInt(String(room.capacity || '0'), 10);
    return {
        ...room,
        roomType,
        capacity: Number.isNaN(capacity) ? 0 : capacity,
        capacityLabel: room.capacityLabel || getCapacityLabel(capacity),
        floor: room.floor || room.location || 'Unassigned',
        features: Array.isArray(room.features) && room.features.length > 0 ? room.features : [],
        image: room.image || getDefaultRoomImage(room.name, roomType),
        availability: room.availability || { timezone: 'local', weeklyHours: [] }
    };
}

function getRoomById(roomId) {
    return appState.rooms.find(r => r.id === roomId) || null;
}

// ========================================
// CLIENT-SIDE ROOM AVAILABILITY CHECK
// (used only for UI display - server enforces real availability)
// ========================================
function parseScheduleTime(timeValue) {
    const match = String(timeValue || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    return { hours: parseInt(match[1], 10), minutes: parseInt(match[2], 10) };
}

function getRoomAvailabilityWindow(room, date) {
    const weeklyHours = room?.availability?.weeklyHours || [];
    const dayConfig = weeklyHours.find(slot => slot.day === date.getDay());
    if (!dayConfig) return null;
    const start = parseScheduleTime(dayConfig.start);
    const end = parseScheduleTime(dayConfig.end);
    if (!start || !end) return null;
    const windowStart = new Date(date);
    windowStart.setHours(start.hours, start.minutes, 0, 0);
    const windowEnd = new Date(date);
    windowEnd.setHours(end.hours, end.minutes, 0, 0);
    return { start: windowStart, end: windowEnd };
}

function isRoomBookedLocally(roomId, startTime, endTime) {
    return appState.bookings.some(booking => {
        if (booking.roomId !== roomId) return false;
        if (!booking.startTime || !booking.endTime) return false;
        const bStart = new Date(booking.startTime);
        const bEnd = new Date(booking.endTime);
        return startTime < bEnd && endTime > bStart;
    });
}

function getRoomAvailabilityStatus(room, startTime = new Date(), endTime = new Date(Date.now() + 3600000)) {
    if (!room || !(startTime instanceof Date) || !(endTime instanceof Date)) return 'Unavailable';
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime <= startTime) return 'Unavailable';
    const window = getRoomAvailabilityWindow(room, startTime);
    if (!window) return 'Unavailable';
    if (startTime < window.start || endTime > window.end) return 'Unavailable';
    return isRoomBookedLocally(room.id, startTime, endTime) ? 'Booked' : 'Available';
}

// ========================================
// CLIENT-SIDE ROOM RECOMMENDATION
// (server also does this - this is for the confirmation preview)
// ========================================
function parseFeatureList(value) {
    if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
    return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function parseDurationToMs(duration) {
    const normalized = String(duration || '').trim().toLowerCase();
    if (!normalized) return 3600000;
    const amount = parseInt(normalized, 10);
    if (Number.isNaN(amount) || amount <= 0) return 3600000;
    if (normalized.includes('min')) return amount * 60000;
    if (normalized.includes('hr')) return amount * 3600000;
    return 3600000;
}

function getMeetingTypeRules(meetingType) {
    const rules = {
        meeting: { preferredRoomTypes: ['meeting'], fallbackRoomTypes: ['briefing', 'board'] },
        training: { preferredRoomTypes: ['training'], fallbackRoomTypes: ['meeting'] },
        board: { preferredRoomTypes: ['board'], fallbackRoomTypes: ['meeting'] },
        briefing: { preferredRoomTypes: ['briefing'], fallbackRoomTypes: ['meeting'] }
    };
    return rules[meetingType] || rules.meeting;
}

function recommendRoomsLocally(input) {
    const attendeeCount = parseInt(input.attendeeCount, 10);
    const requestedDate = String(input.date || '').trim();
    const requestedStartTime = String(input.startTime || '').trim();
    const requestedDuration = String(input.duration || '1 hr').trim();
    const startTime = new Date(requestedDate + ' ' + requestedStartTime);
    const durationMs = parseDurationToMs(requestedDuration);
    const endTime = new Date(startTime.getTime() + durationMs);
    const meetingName = String(input.meetingName || input.conference || '').trim();
    const meetingType = String(input.meetingType || 'meeting').toLowerCase();
    const requiredFeatures = parseFeatureList(input.requiredFeatures);
    const preferredFloor = String(input.preferredFloor || '').trim();
    const preferredRoomId = String(input.preferredRoomId || '').trim();

    const request = { meetingName, meetingType, attendeeCount: Number.isNaN(attendeeCount) ? 0 : attendeeCount, date: requestedDate, startTime, endTime, duration: requestedDuration, requiredFeatures, preferredFloor, preferredRoomId };

    if (!meetingName) return { request, validationError: 'Meeting name is required.', bestMatch: null, alternatives: [], rejected: [] };
    if (!request.attendeeCount || request.attendeeCount <= 0) return { request, validationError: 'Attendee count must be greater than zero.', bestMatch: null, alternatives: [], rejected: [] };
    if (Number.isNaN(startTime.getTime())) return { request, validationError: 'A valid date and start time are required.', bestMatch: null, alternatives: [], rejected: [] };

    const scored = [];
    const rejected = [];

    appState.rooms.forEach(room => {
        const status = getRoomAvailabilityStatus(room, startTime, endTime);
        if (status !== 'Available') {
            rejected.push({ roomId: room.id, roomName: room.name, reason: status === 'Booked' ? 'Already booked for that time' : 'Outside available hours' });
            return;
        }

        const delta = room.capacity - request.attendeeCount;
        if (delta < 0) { rejected.push({ roomId: room.id, roomName: room.name, reason: `Capacity ${room.capacityLabel} is below ${request.attendeeCount} attendees` }); return; }

        const rules = getMeetingTypeRules(meetingType);
        let typeScore = rules.preferredRoomTypes.includes(room.roomType) ? 30 : rules.fallbackRoomTypes.includes(room.roomType) ? 18 : 8;
        let capacityScore = delta === 0 ? 35 : delta <= 2 ? 32 : delta <= 5 ? 28 : delta <= 10 ? 20 : 10;

        let featureScore = 20;
        if (requiredFeatures.length > 0) {
            const normalizedFeatures = room.features.map(f => f.toLowerCase());
            const matched = requiredFeatures.filter(f => normalizedFeatures.includes(f.toLowerCase()));
            featureScore = Math.round((matched.length / requiredFeatures.length) * 20);
        }

        const floorScore = preferredFloor && room.floor === preferredFloor ? 10 : 0;
        const preferenceScore = preferredRoomId && room.id === preferredRoomId ? 5 : 0;
        const totalScore = capacityScore + typeScore + featureScore + floorScore + preferenceScore;

        scored.push({
            room,
            score: totalScore,
            reasons: ['Available for the requested time', `Capacity fits (${room.capacityLabel})`, `${room.roomType} room`],
            capacityDelta: delta
        });
    });

    scored.sort((a, b) => b.score !== a.score ? b.score - a.score : a.capacityDelta - b.capacityDelta);

    return {
        request,
        validationError: '',
        bestMatch: scored[0] ? { room: scored[0].room, score: scored[0].score, reasons: scored[0].reasons } : null,
        alternatives: scored.slice(1),
        rejected
    };
}

function buildRecommendationSummary(result) {
    if (!result.bestMatch) {
        const reasons = result.rejected.slice(0, 3).map(item => `- ${item.roomName}: ${item.reason}`);
        return `No suitable room is available.\n${reasons.join('\n')}`;
    }
    const best = result.bestMatch;
    const alternatives = result.alternatives.slice(0, 3).map(opt => `- ${opt.room.name}`).join('\n');
    const bestReasons = best.reasons.map(r => `- ${r}`).join('\n');
    return `Best match: ${best.room.name}\nType: ${best.room.roomType}\nCapacity: ${best.room.capacityLabel}\nFloor: ${best.room.floor}\nFeatures: ${best.room.features.join(', ')}\n\nWhy this room:\n${bestReasons}${alternatives ? `\n\nAlternatives:\n${alternatives}` : ''}`;
}

// ========================================
// TOAST NOTIFICATIONS
// ========================================
function showToast(message, type = 'info', durationMs = 3500) {
    try {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        toast.innerHTML = `<div class="toast__title">${{ info: 'Info', success: 'Success', warning: 'Warning', error: 'Error' }[type] || 'Info'}</div><div class="toast__message"></div>`;
        toast.querySelector('.toast__message').textContent = String(message);
        container.appendChild(toast);
        setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, durationMs);
    } catch (e) {
        console.log('[toast]', type, message);
    }
}

// ========================================
// MODAL SYSTEM
// ========================================
let __uiModalEl = null;

function ensureUIModal() {
    if (__uiModalEl) return __uiModalEl;
    const overlay = document.createElement('div');
    overlay.className = 'ui-modal-overlay';
    overlay.id = 'ui-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
        <div class="ui-modal">
            <div class="ui-modal__header"><div class="ui-modal__title" id="ui-modal-title"></div></div>
            <div class="ui-modal__body" id="ui-modal-body"></div>
            <div class="ui-modal__footer">
                <button type="button" class="ui-btn ui-btn--ghost" id="ui-modal-cancel">Cancel</button>
                <button type="button" class="ui-btn ui-btn--primary" id="ui-modal-ok">OK</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    __uiModalEl = {
        overlay,
        okBtn: overlay.querySelector('#ui-modal-ok'),
        cancelBtn: overlay.querySelector('#ui-modal-cancel'),
        titleEl: overlay.querySelector('#ui-modal-title'),
        bodyEl: overlay.querySelector('#ui-modal-body')
    };
    return __uiModalEl;
}

function hideUIModal() {
    if (__uiModalEl) __uiModalEl.overlay.classList.remove('show');
}

function showInfoModal(title, message) {
    const ui = ensureUIModal();
    ui.titleEl.textContent = title || 'Details';
    ui.bodyEl.textContent = String(message || '');
    ui.cancelBtn.style.display = 'none';
    ui.okBtn.textContent = 'Close';
    return new Promise(resolve => {
        const onOk = () => { cleanup(); resolve(); };
        const onOverlay = e => { if (e.target === ui.overlay) onOk(); };
        function cleanup() {
            ui.okBtn.removeEventListener('click', onOk);
            ui.overlay.removeEventListener('click', onOverlay);
            hideUIModal();
        }
        ui.okBtn.addEventListener('click', onOk);
        ui.overlay.addEventListener('click', onOverlay);
        ui.overlay.classList.add('show');
    });
}

function showConfirmModal(message, okText = 'Yes', cancelText = 'Cancel') {
    const ui = ensureUIModal();
    ui.titleEl.textContent = 'Please confirm';
    ui.bodyEl.textContent = String(message || '');
    ui.cancelBtn.style.display = '';
    ui.okBtn.textContent = okText;
    ui.cancelBtn.textContent = cancelText;
    return new Promise(resolve => {
        const onOk = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };
        const onOverlay = e => { if (e.target === ui.overlay) onCancel(); };
        function cleanup() {
            ui.okBtn.removeEventListener('click', onOk);
            ui.cancelBtn.removeEventListener('click', onCancel);
            ui.overlay.removeEventListener('click', onOverlay);
            hideUIModal();
        }
        ui.okBtn.addEventListener('click', onOk);
        ui.cancelBtn.addEventListener('click', onCancel);
        ui.overlay.addEventListener('click', onOverlay);
        ui.overlay.classList.add('show');
    });
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function showFormModal(config) {
    const ui = ensureUIModal();
    ui.titleEl.textContent = config.title || 'Form';
    ui.cancelBtn.style.display = '';
    ui.okBtn.textContent = config.submitText || 'Save';
    ui.cancelBtn.textContent = config.cancelText || 'Cancel';
    const fields = Array.isArray(config.fields) ? config.fields : [];

    const fieldHtml = fields.map(f => {
        const id = `ui_field_${f.name}`;
        const label = escapeHtml(f.label || f.name);
        const hint = f.hint ? `<div class="ui-form__hint">${escapeHtml(f.hint)}</div>` : '';
        if (f.type === 'select') {
            const options = (f.options || []).map(opt => {
                const val = typeof opt === 'string' ? opt : opt.value;
                const text = typeof opt === 'string' ? opt : (opt.label || opt.value);
                const selected = String(f.value || '') === String(val) ? 'selected' : '';
                return `<option value="${escapeHtml(val)}" ${selected}>${escapeHtml(text)}</option>`;
            }).join('');
            return `<div class="ui-form__group"><label for="${id}">${label}</label><select id="${id}" name="${escapeHtml(f.name)}">${options}</select>${hint}</div>`;
        }
        const inputType = f.type || 'text';
        const value = f.value != null ? `value="${escapeHtml(f.value)}"` : '';
        const placeholder = f.placeholder ? `placeholder="${escapeHtml(f.placeholder)}"` : '';
        const min = f.min != null ? `min="${escapeHtml(String(f.min))}"` : '';
        const max = f.max != null ? `max="${escapeHtml(String(f.max))}"` : '';
        return `<div class="ui-form__group"><label for="${id}">${label}</label><input id="${id}" name="${escapeHtml(f.name)}" type="${escapeHtml(inputType)}" ${value} ${placeholder} ${min} ${max} />${hint}</div>`;
    }).join('');

    ui.bodyEl.innerHTML = `<form id="ui-form-modal" class="ui-form">${fieldHtml}</form>`;

    return new Promise(resolve => {
        const onOk = () => {
            const result = {};
            fields.forEach(f => {
                const el = ui.bodyEl.querySelector(`[name="${f.name}"]`);
                result[f.name] = el ? el.value : '';
            });
            cleanup();
            resolve(result);
        };
        const onCancel = () => { cleanup(); resolve(null); };
        const onOverlay = e => { if (e.target === ui.overlay) onCancel(); };
        const onKeyDown = e => {
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); onOk(); }
        };
        function cleanup() {
            ui.okBtn.removeEventListener('click', onOk);
            ui.cancelBtn.removeEventListener('click', onCancel);
            ui.overlay.removeEventListener('click', onOverlay);
            document.removeEventListener('keydown', onKeyDown);
            hideUIModal();
        }
        ui.okBtn.addEventListener('click', onOk);
        ui.cancelBtn.addEventListener('click', onCancel);
        ui.overlay.addEventListener('click', onOverlay);
        document.addEventListener('keydown', onKeyDown);
        ui.overlay.classList.add('show');
        const firstField = ui.bodyEl.querySelector('input, select, textarea');
        if (firstField) setTimeout(() => firstField.focus(), 0);
    });
}

// ========================================
// LANGUAGE SYSTEM
// ========================================
const translations = {
    en: {
        'RATC User Panel': 'RATC User Panel', 'RATC Employee Panel': 'RATC Employee Panel',
        'RATC Admin Panel': 'RATC Admin Panel', 'Dashboard': 'Dashboard',
        'My Bookings': 'My Bookings', 'Book a Room': 'Book a Room',
        'Profile': 'Profile', 'Settings': 'Settings', 'Overview': 'Overview',
        'Manage Users': 'Manage Users', 'Manage Employees': 'Manage Employees',
        'Conferences': 'Conferences', 'Meetings': 'Meetings', 'Bookings': 'Bookings',
        'Logout': 'Logout', 'Welcome back, User!': 'Welcome back, User!',
        'Admin Overview': 'Admin Overview', 'Account Settings': 'Account Settings',
        'My Profile': 'My Profile', 'Upcoming Conferences': 'Upcoming Conferences',
        'Upcoming Meetings': 'Upcoming Meetings', 'Sign In': 'Sign In',
        'Save Settings': 'Save Settings', 'Edit Profile': 'Edit Profile',
        'Add New User': 'Add New User', 'Add New Employee': 'Add New Employee',
        'Add Conference': 'Add Conference', 'Add Meeting': 'Add Meeting',
        'Create Booking': 'Create Booking', 'Book Now': 'Book Now',
        'View': 'View', 'Edit': 'Edit', 'Export': 'Export',
        'Email Address': 'Email Address', 'Password': 'Password',
        'Full Name': 'Full Name', 'Phone': 'Phone', 'Organization': 'Organization',
        'Member Since': 'Member Since', 'Email notifications': 'Email notifications',
        'SMS reminders': 'SMS reminders', 'Weekly newsletter': 'Weekly newsletter',
        'Language:': 'Language:', 'Timezone:': 'Timezone:',
        'Confirmed': 'Confirmed', 'Pending': 'Pending', 'Active': 'Active',
        'Inactive': 'Inactive', 'Available': 'Available', 'Booked': 'Booked',
        'Unavailable': 'Unavailable', 'No active bookings': 'No active bookings',
        'No upcoming conferences': 'No upcoming conferences'
    },
    es: {
        'Dashboard': 'Panel de Control', 'My Bookings': 'Mis Reservas',
        'Book a Room': 'Reservar Sala', 'Profile': 'Perfil', 'Settings': 'Configuración',
        'Logout': 'Cerrar Sesión', 'Sign In': 'Iniciar Sesión',
        'Email Address': 'Dirección de Correo', 'Password': 'Contraseña',
        'Available': 'Disponible', 'Booked': 'Reservado', 'Confirmed': 'Confirmado'
    },
    fr: {
        'Dashboard': 'Tableau de Bord', 'My Bookings': 'Mes Réservations',
        'Book a Room': 'Réserver une Salle', 'Profile': 'Profil', 'Settings': 'Paramètres',
        'Logout': 'Déconnexion', 'Sign In': 'Se Connecter',
        'Email Address': 'Adresse Email', 'Password': 'Mot de Passe',
        'Available': 'Disponible', 'Booked': 'Réservé', 'Confirmed': 'Confirmé'
    }
};

function applyLanguage(lang) {
    document.querySelectorAll('[data-translate]').forEach(el => {
        const key = el.getAttribute('data-translate');
        if (translations[lang]?.[key]) el.textContent = translations[lang][key];
    });
}

// ========================================
// RESPONSIVE TABLE LABELS
// ========================================
function applyResponsiveTableLabels() {
    document.querySelectorAll('.table-container table').forEach(table => {
        const headers = Array.from(table.querySelectorAll('thead th')).map(th =>
            th.textContent.replace(/\s+/g, ' ').trim() || 'Value'
        );
        table.querySelectorAll('tbody tr').forEach(row => {
            Array.from(row.children).forEach((cell, i) => {
                if (cell.tagName === 'TD') cell.setAttribute('data-label', headers[i] || `Column ${i + 1}`);
            });
        });
    });
}

// ========================================
// STATUS HELPER
// ========================================
function getStatusClass(status) {
    const map = {
        'Active': 'active', 'Available': 'available', 'Confirmed': 'confirmed',
        'Upcoming': 'upcoming', 'Pending': 'pending', 'Full': 'full',
        'Inactive': 'inactive', 'Booked': 'booked', 'Unavailable': 'inactive'
    };
    return map[status] || 'pending';
}

// ========================================
// PASSWORD UTILITIES
// ========================================
function getPasswordStrength(password) {
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[@$!%*?&]/.test(password)) score++;
    return score;
}

function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

// ========================================
// DOWNLOAD UTILITY
// ========================================
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ========================================
// BOOKING FORM HELPERS
// ========================================
function getRecommendationFormFields(defaults = {}) {
    return [
        { name: 'conference', label: 'Meeting Name', value: defaults.conference || 'Team Meeting' },
        {
            name: 'meetingType', label: 'Meeting Type', type: 'select',
            value: defaults.meetingType || 'meeting',
            options: [
                { value: 'meeting', label: 'Meeting' }, { value: 'training', label: 'Training' },
                { value: 'board', label: 'Board' }, { value: 'briefing', label: 'Briefing' }
            ]
        },
        { name: 'attendeeCount', label: 'Attendee Count', type: 'number', min: 1, value: defaults.attendeeCount || 6 },
        { name: 'date', label: 'Date', value: defaults.date || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
        {
            name: 'startTime', label: 'Start Time', type: 'select',
            value: defaults.startTime || '09:00 AM',
            options: defaults.timeOptions || []
        },
        { name: 'duration', label: 'Duration', value: defaults.duration || '1 hr', hint: 'Examples: 30 mins, 1 hr, 2 hrs' },
        { name: 'requiredFeatures', label: 'Required Features', value: defaults.requiredFeatures || '', hint: 'Comma-separated, e.g. Projector, Whiteboard' },
        {
            name: 'preferredFloor', label: 'Preferred Floor', type: 'select',
            value: defaults.preferredFloor || '',
            options: [{ value: '', label: 'No preference' }, 'Ground Floor', '2nd Floor', '3rd Floor']
        }
    ];
}

const TIME_OPTIONS = [
    '07:00 AM','07:30 AM','08:00 AM','08:30 AM','09:00 AM','09:30 AM',
    '10:00 AM','10:30 AM','11:00 AM','11:30 AM','12:00 PM','12:30 PM',
    '01:00 PM','01:30 PM','02:00 PM','02:30 PM','03:00 PM','03:30 PM',
    '04:00 PM','04:30 PM','05:00 PM'
];

async function confirmRecommendedRoom(result) {
    if (result.validationError) { showToast(result.validationError, 'error'); return false; }
    const summary = buildRecommendationSummary(result);
    if (!result.bestMatch) { await showInfoModal('No Suitable Room', summary); return false; }
    return showConfirmModal(`${summary}\n\nBook this recommended room?`, 'Book Room', 'Cancel');
}

// ========================================
// DOM READY
// ========================================
document.addEventListener('DOMContentLoaded', () => {

    const loginForm = document.getElementById('loginForm');
    const errorMsg = document.getElementById('errorMsg');
    const isAdminPage = !!document.getElementById('overview');
    const isUserPage = !!document.getElementById('dashboard') && !!document.getElementById('my-bookings');

    let session = getActiveSession();

    // ── Auth guards ──────────────────────────────────────────────
    if (loginForm && session) {
        redirectToDashboard(session.role);
        return;
    }

    if ((isAdminPage || isUserPage) && (!session || !session.token)) {
        window.location.href = 'login.html';
        return;
    }

    if (isAdminPage && session?.role !== 'Admin') {
        redirectToDashboard(session.role);
        return;
    }

    if (isUserPage && session?.role === 'Admin') {
        redirectToDashboard(session.role);
        return;
    }

    // ── Login form ───────────────────────────────────────────────
    if (loginForm) {
        const passwordInput = document.getElementById('password');
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

        loginForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            const email = document.getElementById('email').value.trim();
            const password = passwordInput.value;
            const normalizedEmail = email.toLowerCase();

            errorMsg.style.display = 'none';
            errorMsg.innerHTML = '';

            if (!passwordRegex.test(password)) {
                errorMsg.style.display = 'block';
                errorMsg.innerHTML = `<strong>Password Requirements:</strong><br>
                    • At least 8 characters<br>• At least one uppercase letter<br>
                    • At least one lowercase letter<br>• At least one number<br>
                    • At least one special character (@$!%*?&)`;
                return;
            }

            if (!normalizedEmail.endsWith('@gnpcghana.com')) {
                errorMsg.style.display = 'block';
                errorMsg.innerHTML = 'Only company email addresses (@gnpcghana.com) are allowed.';
                return;
            }

            try {
                const result = await apiRequest('/api/auth/login', {
                    method: 'POST',
                    body: JSON.stringify({ email: normalizedEmail, password })
                });
                setActiveSession(result.employee, result.token);
                redirectToDashboard(result.employee.role);
            } catch (error) {
                errorMsg.style.display = 'block';
                errorMsg.innerHTML = error.message || 'Invalid email or password.';
            }
        });

        passwordInput.addEventListener('input', function () {
            if (this.value.length > 0 && passwordRegex.test(this.value)) {
                errorMsg.style.display = 'none';
            }
        });

        const toggleBtn = document.querySelector('.toggle-password');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function () {
                const isPassword = passwordInput.type === 'password';
                passwordInput.type = isPassword ? 'text' : 'password';
                toggleBtn.textContent = isPassword ? '🙈' : '👁️';
                toggleBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
            });
        }
        return; // login page — stop here
    }

    // ── Mobile nav ───────────────────────────────────────────────
    const mobileNavToggle = document.querySelector('[data-mobile-nav-toggle]');
    const mobileNav = document.querySelector('[data-mobile-nav]');
    if (mobileNavToggle && mobileNav) {
        mobileNavToggle.addEventListener('click', () => mobileNav.classList.toggle('is-open'));
    }

    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (!href || href === '#') return;
            const target = document.querySelector(href);
            if (!target) return;
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            if (mobileNav) mobileNav.classList.remove('is-open');
        });
    });

    // ── Dashboard sidebar toggle ─────────────────────────────────
    const dashboardNavToggle = document.querySelector('[data-dashboard-nav-toggle]');
    const dashboardSidebar = document.querySelector('.dashboard-container .sidebar');
    const dashboardBackdrop = document.querySelector('[data-dashboard-backdrop]');
    const mobileDashboardMedia = window.matchMedia('(max-width: 768px)');

    const setDashboardNavState = (isOpen) => {
        if (!dashboardSidebar || !dashboardNavToggle || !dashboardBackdrop) return;
        dashboardSidebar.classList.toggle('is-open', isOpen);
        dashboardBackdrop.classList.toggle('is-visible', isOpen);
        dashboardBackdrop.hidden = !isOpen;
        dashboardNavToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    };

    if (dashboardNavToggle && dashboardSidebar && dashboardBackdrop) {
        dashboardNavToggle.addEventListener('click', () => setDashboardNavState(!dashboardSidebar.classList.contains('is-open')));
        dashboardBackdrop.addEventListener('click', () => setDashboardNavState(false));
        document.addEventListener('keydown', e => { if (e.key === 'Escape') setDashboardNavState(false); });
        mobileDashboardMedia.addEventListener('change', e => { if (!e.matches) setDashboardNavState(false); });
    }

    // ── Dashboard init ───────────────────────────────────────────
    initializeDashboard().catch(error => showToast(error.message || 'Unable to initialize the dashboard.', 'error'));

    async function initializeDashboard() {
        // Always verify session with server
        if (getAuthToken()) {
            try {
                const authResponse = await apiRequest('/api/auth/me');
                session = getActiveSession();
                setActiveSession(authResponse.employee, session?.token || '');
            } catch (error) {
                console.warn('Session verification failed, retrying...', error.message);
                // Wait 1 second and retry once before giving up
                await new Promise(resolve => setTimeout(resolve, 1000));
                try {
                    const authResponse = await apiRequest('/api/auth/me');
                    session = getActiveSession();
                    setActiveSession(authResponse.employee, session?.token || '');
                } catch (retryError) {
                    clearActiveSession();
                    window.location.href = 'login.html';
                    return;
                }
            }
        }
    
        // Fetch all data from API with retry
        try {
            await refreshData();
        } catch (error) {
            console.warn('Initial data load failed, retrying...', error.message);
            await new Promise(resolve => setTimeout(resolve, 1000));
            await refreshData();
        }

        // Fetch all data from API (not localStorage)
        await refreshData();

        applyLanguage(appState.settings.language);
        updateEmailDisplay();
        applyResponsiveTableLabels();
        loadSettingsDisplay();

        // Render all sections
        updateBookingsDisplay();
        updateUsersDisplay();
        updateConferencesDisplay();
        updateRoomsDisplay();
        initializeRoomPreviewShowcase();
        updateUpcomingMeetings();
        updateDashboardStats();
        renderRecentBookings();

        const languageSelect = document.getElementById('langSelect');
        if (languageSelect) {
            languageSelect.addEventListener('change', function () {
                appState.settings.language = this.value;
                saveUiSettings(appState.settings);
                applyLanguage(this.value);
            });
        }
        applyResponsiveTableLabels();
    }

    // ── Data fetching from API ───────────────────────────────────
    async function refreshData() {
        if (isAdminPage) {
            await refreshAdminData();
        } else {
            await refreshUserData();
        }
    }

    async function refreshAdminData() {
        const [dashboardData, employeesData, meetingsData, bookingsData, roomsData] = await Promise.all([
            apiRequest('/api/dashboard'),
            apiRequest('/api/employees'),
            apiRequest('/api/meetings'),
            apiRequest('/api/bookings'),
            apiRequest('/api/rooms')
        ]);

        appState.adminSummary = dashboardData.summary;
        appState.employees = employeesData.employees.map(normalizeEmployeeForUi);
        appState.meetings = meetingsData.meetings.map(normalizeMeetingForUi);
        appState.bookings = bookingsData.bookings.map(normalizeBookingForUi);
        appState.rooms = roomsData.rooms.map(normalizeRoomForUi);
    }

    async function refreshUserData() {
        const [bookingsData, roomsData, meetingsData] = await Promise.all([
            apiRequest('/api/bookings'),
            apiRequest('/api/rooms'),
            apiRequest('/api/meetings')
        ]);

        appState.bookings = bookingsData.bookings.map(normalizeBookingForUi);
        appState.rooms = roomsData.rooms.map(normalizeRoomForUi);
        appState.meetings = meetingsData.meetings.map(normalizeMeetingForUi);
    }

    async function refreshAdminViews() {
        await refreshAdminData();
        updateBookingsDisplay();
        updateUsersDisplay();
        updateConferencesDisplay();
        updateDashboardStats();
        renderRecentBookings();
        updateUpcomingMeetings();
    }

    async function refreshUserViews() {
        await refreshUserData();
        updateBookingsDisplay();
        updateRoomsDisplay();
        updateDashboardStats();
        updateUpcomingMeetings();
    }

    // ── Email display ────────────────────────────────────────────
    function updateEmailDisplay() {
        const email = getCurrentUserEmail();
        const userInfoSpan = document.querySelector('.user-info strong');
        if (userInfoSpan && email) userInfoSpan.textContent = email;
        const profileEmailSpan = document.getElementById('profileEmail');
        if (profileEmailSpan && email) profileEmailSpan.textContent = email;
    }

    // ── Logout ───────────────────────────────────────────────────
    document.querySelectorAll('.logout-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.preventDefault();
            try {
                if (getAuthToken()) await apiRequest('/api/auth/logout', { method: 'POST' });
            } catch (error) {
                console.warn('Logout request failed:', error.message);
            }
            clearActiveSession();
            window.location.href = 'login.html';
        });
    });

    // ── DISPLAY FUNCTIONS ────────────────────────────────────────

    function updateBookingsDisplay() {
        const userEmail = getCurrentUserEmail();

        // User dashboard - My Bookings (only show current user's bookings)
        const myBookingsTable = document.querySelector('#my-bookings tbody');
        if (myBookingsTable) {
            const userBookings = appState.bookings.filter(b => b.userEmail === userEmail);
            myBookingsTable.innerHTML = '';
            if (userBookings.length === 0) {
                myBookingsTable.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:#6b7280;">No active bookings</td></tr>';
            } else {
                userBookings.forEach(booking => {
                    const row = document.createElement('tr');
                    const start = booking.startTime ? new Date(booking.startTime) : null;
                    const end = booking.endTime ? new Date(booking.endTime) : null;
                    const timeRange = (start && end) ? formatTimeRange(start, end) : (booking.duration || 'N/A');
                    row.innerHTML = `
                        <td>${booking.id}</td>
                        <td>${booking.conference}</td>
                        <td>${booking.date}</td>
                        <td>${timeRange}</td>
                        <td>${booking.roomName || ''}</td>
                        <td><span class="status ${getStatusClass(booking.status)}">${booking.status}</span></td>
                        <td class="table-actions">
                            <button class="btn btn-sm btn-view">View</button>
                            <button class="btn btn-sm btn-delete">Delete</button>
                        </td>`;
                    myBookingsTable.appendChild(row);
                });
            }
        }

        // Admin dashboard - All Bookings with pagination
        const adminBookingsTable = document.querySelector('#bookings tbody');
        if (adminBookingsTable) {
            const rowsPerPage = 5;
            let currentPage = 1;

            function renderBookingsPage(page) {
                adminBookingsTable.innerHTML = '';
                const start = (page - 1) * rowsPerPage;
                const pageBookings = appState.bookings.slice(start, start + rowsPerPage);
                const totalPages = Math.max(1, Math.ceil(appState.bookings.length / rowsPerPage));

                pageBookings.forEach(booking => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${booking.id}</td>
                        <td>${booking.userEmail}</td>
                        <td>${booking.conference}</td>
                        <td>${booking.roomName || ''}</td>
                        <td>${booking.date}</td>
                        <td>${booking.duration || ''}</td>
                        <td><span class="status ${getStatusClass(booking.status)}">${booking.status}</span></td>
                        <td class="table-actions">
                            <button class="btn btn-sm btn-view">View</button>
                            <button class="btn btn-sm btn-delete">Delete</button>
                        </td>`;
                    adminBookingsTable.appendChild(row);
                });

                const prevBtn = document.querySelector('#bookingsPagination .pagination-prev');
                const nextBtn = document.querySelector('#bookingsPagination .pagination-next');
                const info = document.querySelector('#bookingsPagination .pagination-info');
                if (prevBtn) prevBtn.disabled = page === 1;
                if (nextBtn) nextBtn.disabled = page === totalPages;
                if (info) info.textContent = `Page ${page} of ${totalPages}`;
            }

            renderBookingsPage(currentPage);

            const bPrev = document.querySelector('#bookingsPagination .pagination-prev');
            const bNext = document.querySelector('#bookingsPagination .pagination-next');
            if (bPrev) bPrev.onclick = () => { if (currentPage > 1) renderBookingsPage(--currentPage); };
            if (bNext) bNext.onclick = () => { const t = Math.max(1, Math.ceil(appState.bookings.length / rowsPerPage)); if (currentPage < t) renderBookingsPage(++currentPage); };
        }

        updateDashboardStats();
        applyResponsiveTableLabels();
    }

    function updateRoomsDisplay() {
        const bookRoomTable = document.querySelector('#book-room tbody');
        if (!bookRoomTable) return;

        const rowsPerPage = 5;
        let currentPage = 1;

        function renderPage(page) {
            bookRoomTable.innerHTML = '';
            const start = (page - 1) * rowsPerPage;
            const pageRooms = appState.rooms.slice(start, start + rowsPerPage);
            const totalPages = Math.ceil(appState.rooms.length / rowsPerPage);

            pageRooms.forEach(room => {
                const row = document.createElement('tr');
                const previewStart = new Date();
                const previewEnd = new Date(previewStart.getTime() + 3600000);
                const availabilityStatus = getRoomAvailabilityStatus(room, previewStart, previewEnd);
                const isAvailable = availabilityStatus === 'Available';
                const roomFeatures = Array.isArray(room.features) ? room.features.join(', ') : '';

                row.innerHTML = `
                    <td>${room.id}</td>
                    <td><img class="room-thumbnail" src="${escapeHtml(room.image)}" alt="${escapeHtml(room.name)}" /></td>
                    <td>${room.name}</td>
                    <td>${room.capacityLabel || getCapacityLabel(room.capacity)}</td>
                    <td>${room.floor}</td>
                    <td>${room.duration || 'N/A'}</td>
                    <td><span class="status ${getStatusClass(availabilityStatus)}">${availabilityStatus}</span></td>
                    <td class="table-actions">
                        <button class="btn btn-sm ${isAvailable ? 'btn-primary' : ''} book-room-btn"
                            ${isAvailable ? '' : 'disabled'}
                            data-room-id="${room.id}"
                            title="${escapeHtml(room.roomType)} | ${escapeHtml(roomFeatures)}">
                            ${isAvailable ? 'Book Now' : availabilityStatus}
                        </button>
                    </td>`;
                bookRoomTable.appendChild(row);
            });

            const prevBtn = document.querySelector('.pagination-prev');
            const nextBtn = document.querySelector('.pagination-next');
            const info = document.querySelector('.pagination-info');
            if (prevBtn) prevBtn.disabled = page === 1;
            if (nextBtn) nextBtn.disabled = page === totalPages;
            if (info) info.textContent = `Page ${page} of ${totalPages}`;
        }

        renderPage(currentPage);

        const prevBtn = document.querySelector('.pagination-prev');
        const nextBtn = document.querySelector('.pagination-next');
        if (prevBtn) prevBtn.onclick = () => { if (currentPage > 1) renderPage(--currentPage); };
        if (nextBtn) nextBtn.onclick = () => { const t = Math.ceil(appState.rooms.length / rowsPerPage); if (currentPage < t) renderPage(++currentPage); };

        const typeSelect = document.getElementById('roomTypePreviewSelect');
        const roomSelect = document.getElementById('roomPreviewSelect');
        if (typeSelect) renderRoomPreviewOptions(typeSelect.value || 'meeting', roomSelect?.value || '');
    }

    function updateUsersDisplay() {
        const usersTable = document.querySelector('#manage-users tbody');
        if (!usersTable) return;
    
        const rowsPerPage = 5;
        let currentPage = 1;
    
        function renderUsersPage(page) {
            usersTable.innerHTML = '';
            const start = (page - 1) * rowsPerPage;
            const pageUsers = appState.employees.slice(start, start + rowsPerPage);
            const totalPages = Math.max(1, Math.ceil(appState.employees.length / rowsPerPage));
    
            pageUsers.forEach(user => {
                const row = document.createElement('tr');
                row.setAttribute('data-id', user.id);
                row.innerHTML = `
                    <td>${user.id}</td>
                    <td>${user.name}</td>
                    <td>${user.email}</td>
                    <td>${user.role}</td>
                    <td>${user.joined || formatDisplayDate(user.joinedAt)}</td>
                    <td><span class="status ${getStatusClass(user.status)}">${user.status}</span></td>
                    <td class="table-actions">
                        <button class="btn btn-sm btn-edit">Edit</button>
                        <button class="btn btn-sm btn-delete">Delete</button>
                    </td>
                `;
                usersTable.appendChild(row);
            });

            const prevBtn = document.querySelector('#usersPagination .pagination-prev');
            const nextBtn = document.querySelector('#usersPagination .pagination-next');
            const info = document.querySelector('#usersPagination .pagination-info');
            if (prevBtn) prevBtn.disabled = page === 1;
            if (nextBtn) nextBtn.disabled = page === totalPages;
            if (info) info.textContent = `Page ${page} of ${totalPages}`;
        }

        renderUsersPage(currentPage);
        applyResponsiveTableLabels();
        const uPrev = document.querySelector('#usersPagination .pagination-prev');
        const uNext = document.querySelector('#usersPagination .pagination-next');
        if (uPrev) uPrev.onclick = () => { if (currentPage > 1) renderUsersPage(--currentPage); };
        if (uNext) uNext.onclick = () => { const t = Math.max(1, Math.ceil(appState.employees.length / rowsPerPage)); if (currentPage < t) renderUsersPage(++currentPage); };
    }

    function updateConferencesDisplay() {
        const confTable = document.querySelector('#conferences tbody');
        if (!confTable) return;

        const rowsPerPage = 5;
        let currentPage = 1;

        function renderConfsPage(page) {
            confTable.innerHTML = '';
            const start = (page - 1) * rowsPerPage;
            const pageConfs = appState.meetings.slice(start, start + rowsPerPage);
            const totalPages = Math.max(1, Math.ceil(appState.meetings.length / rowsPerPage));

            pageConfs.forEach(conf => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${conf.id}</td>
                    <td>${conf.name}</td>
                    <td>${conf.date}</td>
                    <td>${conf.location}</td>
                    <td>${conf.capacity}</td>
                    <td><span class="status ${getStatusClass(conf.status)}">${conf.status}</span></td>
                    <td class="table-actions">
                        <button class="btn btn-sm btn-edit">Edit</button>
                        <button class="btn btn-sm btn-delete">Delete</button>
                    </td>`;
                confTable.appendChild(row);
            });

            const prevBtn = document.querySelector('#confPagination .pagination-prev');
            const nextBtn = document.querySelector('#confPagination .pagination-next');
            const info = document.querySelector('#confPagination .pagination-info');
            if (prevBtn) prevBtn.disabled = page === 1;
            if (nextBtn) nextBtn.disabled = page === totalPages;
            if (info) info.textContent = `Page ${page} of ${totalPages}`;
        }

        renderConfsPage(currentPage);
        const cPrev = document.querySelector('#confPagination .pagination-prev');
        const cNext = document.querySelector('#confPagination .pagination-next');
        if (cPrev) cPrev.onclick = () => { if (currentPage > 1) renderConfsPage(--currentPage); };
        if (cNext) cNext.onclick = () => { const t = Math.max(1, Math.ceil(appState.meetings.length / rowsPerPage)); if (currentPage < t) renderConfsPage(++currentPage); };
        applyResponsiveTableLabels();
    }

    function updateUpcomingMeetings() {
        const upcomingTable = document.querySelector('#dashboard tbody');
        if (!upcomingTable) return;
        upcomingTable.innerHTML = '';
        const upcoming = appState.meetings.filter(m => m.status === 'Upcoming');
        if (upcoming.length === 0) {
            upcomingTable.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;color:#6b7280;">No upcoming meetings</td></tr>';
        } else {
            upcoming.forEach(meeting => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${meeting.name}</td>
                    <td>${meeting.date}</td>
                    <td>${meeting.location}</td>
                    <td><span class="status ${getStatusClass(meeting.status)}">${meeting.status}</span></td>`;
                upcomingTable.appendChild(row);
            });
        }
    }

    function renderRecentBookings() {
        const container = document.getElementById('recent-bookings-list');
        if (!container) return;
        const recent = appState.bookings.slice(0, 3);
        if (!recent.length) {
            container.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:1rem;color:#6b7280;">No recent bookings</td></tr>';
            return;
        }
        container.innerHTML = '';
        recent.forEach(b => {
            const tr = document.createElement('tr');
            tr.setAttribute('data-id', b.id);
            tr.innerHTML = `
                <td>${b.id}</td>
                <td>${b.userEmail}</td>
                <td>${b.conference}</td>
                <td>${b.roomName || ''}</td>
                <td>${b.date}</td>
                <td>${b.duration || ''}</td>
                <td><span class="status ${getStatusClass(b.status)}">${b.status}</span></td>
                <td class="table-actions">
                    <button class="btn btn-sm btn-view">View</button>
                    <button class="btn btn-sm btn-delete">Delete</button>
                </td>`;
            container.appendChild(tr);
        });
        applyResponsiveTableLabels();
    }

    function updateDashboardStats() {
        const userEmail = getCurrentUserEmail();
        const userBookings = appState.bookings.filter(b => b.userEmail === userEmail);
        const upcomingMeetings = appState.meetings.filter(m => m.status === 'Upcoming').length;
        const previewStart = new Date();
        const previewEnd = new Date(previewStart.getTime() + 3600000);
        const availableRooms = appState.rooms.filter(r => getRoomAvailabilityStatus(r, previewStart, previewEnd) === 'Available').length;

        // User dashboard cards
        const cards = document.querySelectorAll('#dashboard .card .value');
        if (cards.length >= 3) {
            cards[0].textContent = upcomingMeetings;
            cards[1].textContent = userBookings.length;
            cards[2].textContent = availableRooms;
        }

        // Admin dashboard cards
        const adminCards = document.querySelectorAll('#overview .card .value');
        if (adminCards.length >= 3) {
            adminCards[0].textContent = appState.adminSummary?.employees?.total ?? appState.employees.length;
            adminCards[1].textContent = appState.adminSummary?.rooms?.total ?? appState.rooms.length;
            adminCards[2].textContent = appState.adminSummary?.bookings?.total ?? appState.bookings.length;
        }
    }

    // ── Room preview showcase ─────────────────────────────────────
    function updateRoomPreviewCard(room) {
        const imageEl = document.getElementById('roomPreviewImage');
        const titleEl = document.getElementById('roomPreviewTitle');
        const metaEl = document.getElementById('roomPreviewMeta');
        const featuresEl = document.getElementById('roomPreviewFeatures');
        if (!imageEl || !titleEl || !metaEl || !featuresEl) return;
        if (!room) {
            imageEl.removeAttribute('src');
            imageEl.alt = 'No room selected';
            titleEl.textContent = 'Room Preview';
            metaEl.textContent = 'Choose a room type to preview available spaces.';
            featuresEl.textContent = '';
            return;
        }
        imageEl.src = room.image;
        imageEl.alt = room.name;
        titleEl.textContent = room.name;
        metaEl.textContent = `${room.roomType} room | ${room.capacityLabel} | ${room.floor}`;
        featuresEl.textContent = `Features: ${room.features.join(', ')}`;
    }

    function renderRoomPreviewOptions(selectedType = 'meeting', selectedRoomId = '') {
        const typeSelect = document.getElementById('roomTypePreviewSelect');
        const roomSelect = document.getElementById('roomPreviewSelect');
        if (!typeSelect || !roomSelect) return;
        const matchingRooms = appState.rooms.filter(r => r.roomType === selectedType);
        roomSelect.innerHTML = matchingRooms.map(room => {
            const selected = room.id === selectedRoomId ? 'selected' : '';
            return `<option value="${escapeHtml(room.id)}" ${selected}>${escapeHtml(room.name)}</option>`;
        }).join('');
        const chosen = matchingRooms.find(r => r.id === roomSelect.value) || matchingRooms[0] || null;
        if (chosen) roomSelect.value = chosen.id;
        updateRoomPreviewCard(chosen);
    }

    function initializeRoomPreviewShowcase() {
        const typeSelect = document.getElementById('roomTypePreviewSelect');
        const roomSelect = document.getElementById('roomPreviewSelect');
        if (!typeSelect || !roomSelect) return;
        renderRoomPreviewOptions(typeSelect.value || 'meeting');
        typeSelect.addEventListener('change', function () { renderRoomPreviewOptions(this.value); });
        roomSelect.addEventListener('change', function () { updateRoomPreviewCard(getRoomById(this.value)); });
    }

    // ── Settings display ─────────────────────────────────────────
    function loadSettingsDisplay() {
        const langSelect = document.getElementById('langSelect');
        if (langSelect) langSelect.value = appState.settings.language || 'en';
        const tzSelect = document.getElementById('tzSelect');
        if (tzSelect) {
            const tz = appState.settings.timezone || 'UTC';
            const found = Array.from(tzSelect.options).some(opt => opt.value === tz || opt.text === tz);
            if (found) tzSelect.value = tz;
        }
        const checkboxes = document.querySelectorAll('.settings-form input[type="checkbox"]');
        if (checkboxes.length >= 3) {
            checkboxes[0].checked = !!appState.settings.emailNotifications;
            checkboxes[1].checked = !!appState.settings.smsReminders;
            checkboxes[2].checked = !!appState.settings.newsletter;
        }
    }

    // ── Sidebar navigation ───────────────────────────────────────
    const userSectionTitles = {
        'dashboard': 'Welcome back!', 'my-bookings': 'My Bookings',
        'book-room': 'Book a Room', 'profile': 'My Profile', 'settings': 'Settings'
    };
    const adminSectionTitles = {
        'overview': 'Admin Overview', 'manage-users': 'Manage Employees',
        'conferences': 'Meetings', 'bookings': 'Bookings'
    };

    document.querySelectorAll('.sidebar ul li a[data-section]').forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            const sectionId = this.getAttribute('data-section');
            document.querySelectorAll('.sidebar ul li a[data-section]').forEach(l => l.classList.remove('active'));
            this.classList.add('active');
            document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
            const selected = document.getElementById(sectionId);
            if (selected) selected.style.display = 'block';
            const headerTitle = document.querySelector('.header h1');
            if (headerTitle) {
                const titles = isAdminPage ? adminSectionTitles : userSectionTitles;
                headerTitle.textContent = titles[sectionId] || sectionId;
            }
            if (mobileDashboardMedia.matches) setDashboardNavState(false);
        });
    });

    // ── Delegated click handlers ─────────────────────────────────
    document.addEventListener('click', async e => {

        // VIEW button
        if (e.target.classList.contains('btn-view')) {
            const row = e.target.closest('tr');
            const cells = row.querySelectorAll('td');
            const id = cells[0]?.textContent?.trim();
            const booking = appState.bookings.find(b => b.id === id);
            if (booking) {
                const start = booking.startTime ? new Date(booking.startTime) : null;
                const end = booking.endTime ? new Date(booking.endTime) : null;
                const timeRange = (start && end) ? formatTimeRange(start, end) : (booking.duration || 'N/A');
                await showInfoModal('Booking Details', `Booking ID: ${booking.id}\nUser: ${booking.userEmail}\nMeeting: ${booking.conference}\nDate: ${booking.date}\nTime: ${timeRange}\nRoom: ${booking.roomName}\nStatus: ${booking.status}`);
            } else {
                let details = '';
                cells.forEach(cell => details += cell.textContent + '\n');
                await showInfoModal('Details', details);
            }
            return;
        }

        // DELETE button
        if (e.target.classList.contains('btn-delete')) {
            const row = e.target.closest('tr');
            const id = (row.getAttribute('data-id') || row.querySelector('td')?.textContent)?.trim();
            if (!id) return;

            // My Bookings (user)
            if (row.closest('#my-bookings')) {
                if (!await showConfirmModal('Delete this booking?')) return;
                try {
                    await apiRequest(`/api/bookings/${encodeURIComponent(id)}`, { method: 'DELETE' });
                    await refreshUserViews();
                    showToast('Booking deleted.', 'success');
                } catch (error) { showToast(error.message || 'Unable to delete booking.', 'error'); }
                return;
            }

            // Admin bookings / recent bookings
            if (row.closest('#bookings') || row.closest('#recent-bookings-list') || row.closest('#overview')) {
                if (!await showConfirmModal(`Delete booking ${id}?`)) return;
                try {
                    await apiRequest(`/api/bookings/${encodeURIComponent(id)}`, { method: 'DELETE' });
                    await refreshAdminViews();
                    showToast('Booking deleted.', 'success');
                } catch (error) { showToast(error.message || 'Unable to delete booking.', 'error'); }
                return;
            }

            // Manage users
            if (row.closest('#manage-users')) {
                
                const id = (row.getAttribute('data-id') || row.querySelector('td')?.textContent)?.trim();
  
                if (!await showConfirmModal('Delete this employee?')) return;
                try {
                    console.log('Sending DELETE to:', `/api/employees/${encodeURIComponent(id)}`); 
                    await apiRequest(`/api/employees/${encodeURIComponent(id)}`, { method: 'DELETE' });
                    console.log('Delete successful'); 
                    await refreshAdminViews();
                    showToast('Employee deleted.', 'success');
                } catch (error) { 
                    console.error('Delete error:', error); 
                    showToast(error.message || 'Unable to delete employee.', 'error'); 
                }
                return;
            }

            // Conferences/meetings
            if (row.closest('#conferences')) {
                if (!await showConfirmModal('Delete this meeting?')) return;
                try {
                    await apiRequest(`/api/meetings/${encodeURIComponent(id)}`, { method: 'DELETE' });
                    await refreshAdminViews();
                    showToast('Meeting deleted.', 'success');
                } catch (error) { showToast(error.message || 'Unable to delete meeting.', 'error'); }
                return;
            }
        }

        // EDIT button
        if (e.target.classList.contains('btn-edit')) {
            const row = e.target.closest('tr');
            const id = row.querySelectorAll('td')[0]?.textContent?.trim();
            console.log("edit btn is hit. ID:", id);  // 👈 ADD ID HERE
        
            if (row.closest('#manage-users')) {
                console.log("Found #manage-users section");  // 👈 ADD THIS
                const user = appState.employees.find(u => u.id === id);
                console.log("User found:", user);  // 👈 ADD THIS
                if (!user) return;
                
                console.log("About to show form modal");  // 👈 ADD THIS
                const formData = await showFormModal({
                    title: `Update Employee ${id}`,
                    submitText: 'Save Changes',
                    fields: [
                        { name: 'name', label: 'Full Name', value: user.name || '' },
                        { name: 'email', label: 'Email', type: 'email', value: user.email || '' },
                        { name: 'phoneNumber', label: 'Phone Number', value: user.phoneNumber || '' },
                        { name: 'role', label: 'Role', type: 'select', value: user.role || 'User', options: ['User', 'Admin'] },
                        { name: 'status', label: 'Status', type: 'select', value: user.status || 'Active', options: ['Active', 'Inactive'] },
                        { name: 'joinedAt', label: 'Joined Date', type: 'date', value: toDateInputValue(user.joinedAt || user.joined) },
                        { name: 'password', label: 'New Password', type: 'password', placeholder: 'Leave blank to keep current' }
                    ]
                });
                console.log("Form modal returned:", formData);  // 👈 ADD THIS
                if (!formData) return;
                
                const payload = {
                    name: (formData.name || '').trim(),
                    email: (formData.email || '').trim(),
                    phoneNumber: (formData.phoneNumber || '').trim(),
                    role: formData.role || 'User',
                    status: formData.status || 'Active',
                    joinedAt: toDateInputValue(formData.joinedAt)
                };
                if (formData.password) payload.password = formData.password;
                try {
                    await apiRequest(`/api/employees/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
                    await refreshAdminViews();
                    showToast(`Employee ${id} updated.`, 'success');
                } catch (error) { showToast(error.message || 'Unable to update employee.', 'error'); }
                return;
            }

            if (row.closest('#conferences')) {
                const conf = appState.meetings.find(c => c.id === id);
                if (!conf) return;
                const formData = await showFormModal({
                    title: `Update Meeting ${id}`,
                    submitText: 'Save Changes',
                    fields: [
                        { name: 'name', label: 'Meeting Name', value: conf.name || '' },
                        { name: 'date', label: 'Date', type: 'date', value: toDateInputValue(conf.rawDate || conf.date) },
                        { name: 'location', label: 'Location', value: conf.location || '' },
                        { name: 'capacity', label: 'Capacity', type: 'number', min: 1, value: conf.capacity || '' },
                        { name: 'status', label: 'Status', type: 'select', value: conf.status || 'Active', options: ['Active', 'Upcoming', 'Full', 'Cancelled'] }
                    ]
                });
                if (!formData) return;
                try {
                    await apiRequest(`/api/meetings/${encodeURIComponent(id)}`, {
                        method: 'PATCH',
                        body: JSON.stringify({
                            name: (formData.name || '').trim(),
                            date: toDateInputValue(formData.date),
                            location: (formData.location || '').trim(),
                            capacity: Number(formData.capacity),
                            status: formData.status || 'Active'
                        })
                    });
                    await refreshAdminViews();
                    showToast(`Meeting ${id} updated.`, 'success');
                } catch (error) { showToast(error.message || 'Unable to update meeting.', 'error'); }
                return;
            }
        }

        // BOOK ROOM button (user)
        if (e.target.classList.contains('book-room-btn') && !e.target.disabled) {
            const row = e.target.closest('tr');
            const roomId = row.querySelector('td')?.textContent?.trim();
            const room = getRoomById(roomId);

            const formData = await showFormModal({
                title: room ? `Book ${room.name}` : 'Find the Best Room',
                submitText: 'Book Room',
                fields: getRecommendationFormFields({
                    conference: 'Team Meeting',
                    attendeeCount: room ? room.capacity : 6,
                    preferredFloor: room ? room.floor : '',
                    timeOptions: TIME_OPTIONS
                })
            });
            if (!formData) return;

            // Preview recommendation locally first
            const localResult = recommendRoomsLocally({
                conference: formData.conference,
                meetingName: formData.conference,
                meetingType: formData.meetingType,
                attendeeCount: formData.attendeeCount,
                date: formData.date,
                startTime: formData.startTime,
                duration: formData.duration,
                requiredFeatures: formData.requiredFeatures,
                preferredFloor: formData.preferredFloor,
                preferredRoomId: roomId
            });

            const confirmed = await confirmRecommendedRoom(localResult);
            if (!confirmed || !localResult.bestMatch) return;

            // POST to API — this is what saves to the database
            try {
                const created = await apiRequest('/api/bookings', {
                    method: 'POST',
                    body: JSON.stringify({
                        meetingName: formData.conference,
                        meetingType: formData.meetingType,
                        attendeeCount: Number(formData.attendeeCount),
                        date: toDateInputValue(formData.date),
                        startTime: toApiTimeValue(formData.startTime),
                        duration: formData.duration,
                        requiredFeatures: formData.requiredFeatures || '',
                        preferredFloor: formData.preferredFloor || '',
                        roomId: localResult.bestMatch.room.id
                    })
                });
                await refreshUserViews();
                showToast(`Room "${localResult.bestMatch.room.name}" booked for "${formData.conference}"!\nDate: ${formData.date} at ${formData.startTime}`, 'success', 5000);
            } catch (error) {
                showToast(error.message || 'Unable to create booking.', 'error');
            }
            return;
        }

        // Dropdown toggle
        if (e.target.classList.contains('dropdown-toggle') || e.target.closest('.dropdown-toggle')) {
            e.preventDefault();
            const dropdown = e.target.closest('.dropdown');
            if (dropdown) dropdown.querySelector('.dropdown-menu')?.classList.toggle('show');
            return;
        }

        // Close dropdowns when clicking outside
        if (!e.target.closest('.dropdown')) {
            document.querySelectorAll('.dropdown-menu').forEach(menu => menu.classList.remove('show'));
        }
    });

    // ── Add New Employee ─────────────────────────────────────────
    const addUserBtn = document.querySelector('.add-user-btn');
    if (addUserBtn) {
        addUserBtn.addEventListener('click', async function () {
            const formData = await showFormModal({
                title: 'Add New Employee',
                submitText: 'Add Employee',
                fields: [
                    { name: 'name', label: 'Full Name', placeholder: 'John Doe' },
                    { name: 'email', label: 'Email', type: 'email', placeholder: 'john.doe@gnpcghana.com' },
                    { name: 'phoneNumber', label: 'Phone Number', placeholder: '+233201111111' },
                    { name: 'role', label: 'Role', type: 'select', value: 'User', options: ['User', 'Admin'] },
                    { name: 'status', label: 'Status', type: 'select', value: 'Active', options: ['Active', 'Inactive'] },
                    { name: 'joinedAt', label: 'Joined Date', type: 'date', value: new Date().toISOString().slice(0, 10) },
                    { name: 'password', label: 'Password', type: 'password', placeholder: 'Min 8 chars, uppercase, lowercase, number, special char' }
                ]
            });
            if (!formData) return;
            const name = (formData.name || '').trim();
            const email = (formData.email || '').trim();
            const password = formData.password || '';
            if (!name || !email || !password) { showToast('Please fill all required fields.', 'warning'); return; }
            if (!email.toLowerCase().endsWith('@gnpcghana.com')) { showToast('Only @gnpcghana.com emails are allowed.', 'error'); return; }
            if (getPasswordStrength(password) < 5) { showToast('Password does not meet complexity requirements.', 'error'); return; }
            try {
                await apiRequest('/api/employees', {
                    method: 'POST',
                    body: JSON.stringify({
                        name, email,
                        phoneNumber: (formData.phoneNumber || '').trim(),
                        role: formData.role || 'User',
                        status: formData.status || 'Active',
                        joinedAt: toDateInputValue(formData.joinedAt),
                        password
                    })
                });
                await refreshAdminViews();
                showToast(`Employee ${name} added successfully!`, 'success');
            } catch (error) { showToast(error.message || 'Unable to add employee.', 'error'); }
        });
    }

    // ── Add Meeting ──────────────────────────────────────────────
    const addConfBtn = document.querySelector('.add-conf-btn');
    if (addConfBtn) {
        addConfBtn.addEventListener('click', async function () {
            const formData = await showFormModal({
                title: 'Add Meeting',
                submitText: 'Add Meeting',
                fields: [
                    { name: 'name', label: 'Meeting Name', placeholder: 'Team Sync' },
                    { name: 'date', label: 'Date', type: 'date', value: new Date().toISOString().slice(0, 10) },
                    { name: 'location', label: 'Location', placeholder: 'Main Hall C' },
                    { name: 'capacity', label: 'Capacity', type: 'number', min: 1, value: 20 },
                    { name: 'status', label: 'Status', type: 'select', value: 'Upcoming', options: ['Active', 'Upcoming', 'Full', 'Cancelled'] }
                ]
            });
            if (!formData) return;
            const name = (formData.name || '').trim();
            const capacity = parseInt(formData.capacity, 10);
            if (!name || Number.isNaN(capacity) || capacity <= 0) { showToast('Please provide valid meeting details.', 'warning'); return; }
            try {
                await apiRequest('/api/meetings', {
                    method: 'POST',
                    body: JSON.stringify({
                        name,
                        date: toDateInputValue(formData.date),
                        location: (formData.location || '').trim(),
                        capacity,
                        status: formData.status || 'Upcoming'
                    })
                });
                await refreshAdminViews();
                showToast(`Meeting "${name}" added successfully!`, 'success');
            } catch (error) { showToast(error.message || 'Unable to add meeting.', 'error'); }
        });
    }

    // ── Create Booking (Admin) ───────────────────────────────────
    const createBookingBtn = document.querySelector('.create-booking-btn');
    if (createBookingBtn) {
        createBookingBtn.addEventListener('click', async function () {
            const formData = await showFormModal({
                title: 'Create Booking',
                submitText: 'Create Booking',
                fields: [
                    { name: 'user', label: 'Employee Email', type: 'email', placeholder: 'employee@gnpcghana.com' },
                    ...getRecommendationFormFields({ conference: 'Team Sync', attendeeCount: 8, timeOptions: TIME_OPTIONS })
                ]
            });
            if (!formData) return;
            const userEmail = (formData.user || '').trim();
            if (!userEmail) { showToast('Please provide an employee email.', 'warning'); return; }
            try {
                const bookingPayload = {
                    userEmail,
                    meetingName: (formData.conference || '').trim(),
                    meetingType: formData.meetingType || 'meeting',
                    attendeeCount: Number(formData.attendeeCount),
                    date: toDateInputValue(formData.date),
                    startTime: toApiTimeValue(formData.startTime),
                    duration: (formData.duration || '').trim(),
                    requiredFeatures: (formData.requiredFeatures || '').trim(),
                    preferredFloor: (formData.preferredFloor || '').trim()
                };
                // Get recommendation from server
                const recommendation = await apiRequest('/api/recommendations', { method: 'POST', body: JSON.stringify(bookingPayload) });
                const confirmed = await confirmRecommendedRoom(recommendation);
                if (!confirmed || !recommendation.bestMatch) return;

                const created = await apiRequest('/api/bookings', {
                    method: 'POST',
                    body: JSON.stringify({ ...bookingPayload, roomId: recommendation.bestMatch.room.id })
                });
                await refreshAdminViews();
                showToast(`Booking ${created.booking.id} created successfully!`, 'success');
            } catch (error) { showToast(error.message || 'Unable to create booking.', 'error'); }
        });
    }

    // ── Export buttons ───────────────────────────────────────────
    document.querySelectorAll('.export-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            const format = this.getAttribute('data-format');
            const table = this.closest('.table-container')?.querySelector('table');
            const section = this.closest('.table-container')?.querySelector('h3')?.textContent || 'export';
            if (!table) return;
            const rows = Array.from(table.querySelectorAll('tr'));
            let content = '';
            rows.forEach(row => {
                const cells = Array.from(row.querySelectorAll('th, td'));
                const sep = format === 'csv' ? ',' : format === 'docx' ? ' | ' : '\t';
                content += cells.map(c => c.textContent).join(sep) + '\n';
            });
            const mimeMap = { csv: 'text/csv', xlsx: 'application/vnd.ms-excel', docx: 'application/msword', pdf: 'application/pdf' };
            const extMap = { csv: '.csv', xlsx: '.xls', docx: '.doc', pdf: '.pdf' };
            downloadFile(content, section + (extMap[format] || '.txt'), mimeMap[format] || 'text/plain');
            this.closest('.dropdown-menu')?.classList.remove('show');
        });
    }); 

    // ── Save Settings ────────────────────────────────────────────
    const saveSettingsBtn = document.querySelector('.save-settings-btn');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', function () {
            const checkboxes = document.querySelectorAll('.settings-form input[type="checkbox"]');
            const langSelect = document.getElementById('langSelect');
            const tzSelect = document.getElementById('tzSelect');

            appState.settings = {
                emailNotifications: checkboxes[0]?.checked || false,
                smsReminders: checkboxes[1]?.checked || false,
                newsletter: checkboxes[2]?.checked || false,
                language: langSelect?.value || 'en',
                timezone: tzSelect ? (tzSelect.value || tzSelect.options[tzSelect.selectedIndex]?.text) : 'UTC'
            };

            saveUiSettings(appState.settings); // save to localStorage (this is fine - it's a UI preference)
            applyLanguage(appState.settings.language);
            showToast('Settings saved successfully!', 'success');

            if (appState.settings.emailNotifications || appState.settings.smsReminders) {
                if ('Notification' in window && Notification.permission === 'default') {
                    Notification.requestPermission();
                }
            }
        });
    }
});