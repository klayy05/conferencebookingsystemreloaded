
const fs = require('fs');
const path = require('path');
loadEnv(path.join(__dirname, '.env'));
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { createClient } = require('@supabase/supabase-js');
const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ROOT_DIR = __dirname;
const NOTIFICATION_POLL_MS = Number(process.env.NOTIFICATION_POLL_MS || 60000);
const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || '').toLowerCase();
const SMS_PROVIDER = (process.env.SMS_PROVIDER || '').toLowerCase();
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const NOTIFICATION_FROM_EMAIL = process.env.NOTIFICATION_FROM_EMAIL || '';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || '';

function validateRuntimeConfig() {
    const errors = [];
    const supportedEmailProviders = new Set(['', 'resend']);
    const supportedSmsProviders = new Set(['', 'twilio']);

    if (!SUPABASE_URL) {
        errors.push('SUPABASE_URL is required.');
    }

    if (!SUPABASE_SERVICE_ROLE_KEY) {
        errors.push('SUPABASE_SERVICE_ROLE_KEY is required.');
    }

    if (!Number.isInteger(PORT) || PORT <= 0) {
        errors.push('PORT must be a positive integer.');
    }

    if (!Number.isInteger(NOTIFICATION_POLL_MS) || NOTIFICATION_POLL_MS <= 0) {
        errors.push('NOTIFICATION_POLL_MS must be a positive integer.');
    }

    if (!supportedEmailProviders.has(EMAIL_PROVIDER)) {
        errors.push(`EMAIL_PROVIDER must be one of: ${Array.from(supportedEmailProviders).filter(Boolean).join(', ')}.`);
    }

    if (EMAIL_PROVIDER === 'resend') {
        if (!RESEND_API_KEY) {
            errors.push('RESEND_API_KEY is required when EMAIL_PROVIDER=resend.');
        }
        if (!NOTIFICATION_FROM_EMAIL) {
            errors.push('NOTIFICATION_FROM_EMAIL is required when EMAIL_PROVIDER=resend.');
        }
    }

    if (!supportedSmsProviders.has(SMS_PROVIDER)) {
        errors.push(`SMS_PROVIDER must be one of: ${Array.from(supportedSmsProviders).filter(Boolean).join(', ')}.`);
    }

    if (SMS_PROVIDER === 'twilio') {
        if (!TWILIO_ACCOUNT_SID) {
            errors.push('TWILIO_ACCOUNT_SID is required when SMS_PROVIDER=twilio.');
        }
        if (!TWILIO_AUTH_TOKEN) {
            errors.push('TWILIO_AUTH_TOKEN is required when SMS_PROVIDER=twilio.');
        }
        if (!TWILIO_FROM_NUMBER) {
            errors.push('TWILIO_FROM_NUMBER is required when SMS_PROVIDER=twilio.');
        }
    }

    if (errors.length) {
        throw new Error(`Invalid runtime configuration:\n- ${errors.join('\n- ')}`);
    }
}

validateRuntimeConfig();

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
});

const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp'
};

const STATIC_PAGES = new Set([
    '/',
    '/index.html',
    '/login.html',
    '/user_dashboard.html',
    '/admin_dashboard.html',
    '/styles.css',
    '/script.js',
    '/README.md'
]);

let notificationSupportChecked = false;
let notificationsEnabled = false;

function logEvent(level, message, meta = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...meta
    };
    const writer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    writer(JSON.stringify(entry));
}

function loadEnv(envPath) {
    if (!fs.existsSync(envPath)) {
        return;
    }

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }

        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        let value = line.slice(separatorIndex + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (!(key in process.env)) {
            process.env[key] = value;
        }
    }
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function createId(prefix) {
    return `${prefix}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function createToken() {
    return crypto.randomBytes(32).toString('hex');
}

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8'
    });
    response.end(JSON.stringify(payload));
}

function sendNoContent(response) {
    response.writeHead(204);
    response.end();
}

function sendError(response, statusCode, message, details) {
    sendJson(response, statusCode, {
        error: message,
        ...(details ? { details } : {})
    });
}

class ApiError extends Error {
    constructor(statusCode, message, details) {
        super(message);
        this.name = 'ApiError';
        this.statusCode = statusCode;
        this.details = details || null;
    }
}

function notFound(response) {
    sendError(response, 404, 'Not found');
}

async function readJsonBody(request) {
    const chunks = [];

    for await (const chunk of request) {
        chunks.push(chunk);
    }

    if (!chunks.length) {
        return {};
    }

    const raw = Buffer.concat(chunks).toString('utf8');
    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new Error('Invalid JSON request body');
    }
}

function fail(statusCode, message, details) {
    throw new ApiError(statusCode, message, details);
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function isValidIsoDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function sanitizeOptionalText(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const text = String(value).trim();
    return text ? text : null;
}

function requireNonEmptyString(value, fieldName, label) {
    const text = String(value || '').trim();
    if (!text) {
        fail(400, `${label} is required`, [{ field: fieldName, message: `${label} is required.` }]);
    }
    return text;
}

function validateEnum(value, allowedValues, fieldName, label) {
    if (!allowedValues.includes(value)) {
        fail(400, `${label} is invalid`, [
            {
                field: fieldName,
                message: `${label} must be one of: ${allowedValues.join(', ')}.`
            }
        ]);
    }
    return value;
}

function validateOptionalCapacity(value, fieldName) {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    const numericValue = Number(value);
    if (!Number.isInteger(numericValue) || numericValue <= 0) {
        fail(400, 'Capacity is invalid', [
            {
                field: fieldName,
                message: 'Capacity must be a positive whole number.'
            }
        ]);
    }

    return numericValue;
}

function validateEmployeeCreatePayload(body) {
    const name = requireNonEmptyString(body.name, 'name', 'Name');
    const email = requireNonEmptyString(body.email, 'email', 'Email').toLowerCase();
    const password = String(body.password || '');
    const joinedAt = body.joinedAt || new Date().toISOString().slice(0, 10);
    const role = body.role === 'Admin' ? 'Admin' : 'User';
    const status = body.status === 'Inactive' ? 'Inactive' : 'Active';
    const phoneNumber = sanitizeOptionalText(body.phoneNumber);

    const details = [];
    if (!isValidEmail(email)) {
        details.push({ field: 'email', message: 'Email must be a valid email address.' });
    }
    if (password.length < 8) {
        details.push({ field: 'password', message: 'Password must be at least 8 characters long.' });
    }
    if (!isValidIsoDate(joinedAt)) {
        details.push({ field: 'joinedAt', message: 'Joined date must use YYYY-MM-DD format.' });
    }

    if (details.length) {
        fail(400, 'Employee payload is invalid', details);
    }

    return {
        id: createId('#USR-'),
        name,
        email,
        phone_number: phoneNumber,
        role,
        status,
        joined_at: joinedAt,
        password_hash: sha256(password)
    };
}

function validateEmployeeUpdatePayload(body) {
    const updates = {};
    const details = [];

    if (typeof body.name === 'string') {
        const name = body.name.trim();
        if (!name) {
            details.push({ field: 'name', message: 'Name cannot be empty.' });
        } else {
            updates.name = name;
        }
    }

    if (typeof body.email === 'string') {
        const email = body.email.trim().toLowerCase();
        if (!isValidEmail(email)) {
            details.push({ field: 'email', message: 'Email must be a valid email address.' });
        } else {
            updates.email = email;
        }
    }

    if (body.phoneNumber !== undefined) {
        updates.phone_number = sanitizeOptionalText(body.phoneNumber);
    }

    if (body.role !== undefined) {
        updates.role = validateEnum(body.role, ['User', 'Admin'], 'role', 'Role');
    }

    if (body.status !== undefined) {
        updates.status = validateEnum(body.status, ['Active', 'Inactive'], 'status', 'Status');
    }

    if (body.joinedAt !== undefined) {
        if (!isValidIsoDate(body.joinedAt)) {
            details.push({ field: 'joinedAt', message: 'Joined date must use YYYY-MM-DD format.' });
        } else {
            updates.joined_at = body.joinedAt;
        }
    }

    if (body.password !== undefined) {
        const password = String(body.password || '');
        if (password.length < 8) {
            details.push({ field: 'password', message: 'Password must be at least 8 characters long.' });
        } else {
            updates.password_hash = sha256(password);
        }
    }

    if (!Object.keys(updates).length && !details.length) {
        fail(400, 'No employee updates were provided');
    }

    if (details.length) {
        fail(400, 'Employee payload is invalid', details);
    }

    return updates;
}

function validateMeetingCreatePayload(body) {
    const name = requireNonEmptyString(body.name, 'name', 'Meeting name');
    const date = requireNonEmptyString(body.date, 'date', 'Meeting date');
    const location = sanitizeOptionalText(body.location) || '';
    const capacity = validateOptionalCapacity(body.capacity, 'capacity');
    const status = body.status || 'Active';

    const details = [];
    if (!isValidIsoDate(date)) {
        details.push({ field: 'date', message: 'Meeting date must use YYYY-MM-DD format.' });
    }
    if (!['Active', 'Upcoming', 'Full', 'Cancelled'].includes(status)) {
        details.push({
            field: 'status',
            message: 'Meeting status must be one of: Active, Upcoming, Full, Cancelled.'
        });
    }

    if (details.length) {
        fail(400, 'Meeting payload is invalid', details);
    }

    return {
        id: createId('#CONF-'),
        name,
        meeting_date: date,
        location,
        capacity,
        status
    };
}

function validateMeetingUpdatePayload(body) {
    const updates = {};
    const details = [];

    if (typeof body.name === 'string') {
        const name = body.name.trim();
        if (!name) {
            details.push({ field: 'name', message: 'Meeting name cannot be empty.' });
        } else {
            updates.name = name;
        }
    }

    if (body.date !== undefined) {
        if (!isValidIsoDate(body.date)) {
            details.push({ field: 'date', message: 'Meeting date must use YYYY-MM-DD format.' });
        } else {
            updates.meeting_date = body.date;
        }
    }

    if (body.location !== undefined) {
        updates.location = sanitizeOptionalText(body.location) || '';
    }

    if (body.capacity !== undefined) {
        updates.capacity = validateOptionalCapacity(body.capacity, 'capacity');
    }

    if (body.status !== undefined) {
        if (!['Active', 'Upcoming', 'Full', 'Cancelled'].includes(body.status)) {
            details.push({
                field: 'status',
                message: 'Meeting status must be one of: Active, Upcoming, Full, Cancelled.'
            });
        } else {
            updates.status = body.status;
        }
    }

    if (!Object.keys(updates).length && !details.length) {
        fail(400, 'No meeting updates were provided');
    }

    if (details.length) {
        fail(400, 'Meeting payload is invalid', details);
    }

    return updates;
}

function validateBookingPayload(body, sessionEmployeeRole) {
    const meetingName = String(body.meetingName || body.title || '').trim();
    const details = [];

    if (!meetingName) {
        details.push({ field: 'meetingName', message: 'Meeting name is required.' });
    }

    if (sessionEmployeeRole === 'Admin' && body.userEmail !== undefined) {
        const email = String(body.userEmail || '').trim().toLowerCase();
        if (!email) {
            details.push({ field: 'userEmail', message: 'User email cannot be empty.' });
        } else if (!isValidEmail(email)) {
            details.push({ field: 'userEmail', message: 'User email must be a valid email address.' });
        }
    }

    if (details.length) {
        fail(400, 'Booking payload is invalid', details);
    }

    return {
        meetingName
    };
}

function mapSupabaseError(error) {
    const code = error && error.code ? String(error.code) : '';
    if (code === '23505') {
        return new ApiError(409, 'A record with the same unique value already exists');
    }
    if (code === '23503') {
        return new ApiError(409, 'This change references a related record that does not exist or cannot be removed');
    }
    if (code === '23514') {
        return new ApiError(400, 'The request violates a data validation rule');
    }
    return new ApiError(500, error.message || 'Internal server error');
}

function sanitizePath(pathname) {
    const decodedPath = decodeURIComponent(pathname);
    const candidate = decodedPath === '/' ? '/index.html' : decodedPath;
    const resolved = path.normalize(path.join(ROOT_DIR, candidate));

    if (!resolved.startsWith(ROOT_DIR)) {
        return null;
    }

    return resolved;
}

async function serveStatic(requestUrl, response) {
    const pathname = requestUrl.pathname;
    if (!(STATIC_PAGES.has(pathname) || pathname.startsWith('/assets/'))) {
        notFound(response);
        return;
    }

    const filePath = sanitizePath(pathname);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        notFound(response);
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream'
    });
    fs.createReadStream(filePath).pipe(response);
}

function getAuthToken(request) {
    const header = request.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : null;
}

async function selectAll(table, orderColumn) {
    let query = supabase.from(table).select('*');
    if (orderColumn) {
        query = query.order(orderColumn, { ascending: true });
    }

    const { data, error } = await query;
    if (error) {
        throw error;
    }
    return data || [];
}

function normalizeEmployee(row) {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        phoneNumber: row.phone_number || null,
        role: row.role,
        status: row.status,
        joinedAt: row.joined_at,
        passwordHash: row.password_hash,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function normalizeRoom(row, features, availability) {
    return {
        id: row.id,
        name: row.name,
        roomType: row.room_type,
        capacity: row.capacity,
        capacityLabel: row.capacity_label,
        floor: row.floor,
        location: row.location,
        duration: row.duration,
        image: row.image_url,
        features,
        availability: {
            timezone: 'local',
            weeklyHours: availability.map((slot) => ({
                day: slot.day_of_week,
                start: String(slot.start_time).slice(0, 5),
                end: String(slot.end_time).slice(0, 5)
            }))
        }
    };
}

function normalizeMeeting(row) {
    return {
        id: row.id,
        name: row.name,
        date: row.meeting_date,
        location: row.location,
        capacity: row.capacity,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function normalizeBooking(row, employeesById, roomsById) {
    const employee = employeesById.get(row.employee_id);
    const room = roomsById.get(row.room_id);

    return {
        id: row.id,
        employeeId: row.employee_id,
        userEmail: employee ? employee.email : null,
        userName: employee ? employee.name : null,
        meetingName: row.meeting_name,
        roomId: row.room_id,
        roomName: room ? room.name : null,
        bookingDate: row.booking_date,
        startTime: row.start_time,
        endTime: row.end_time,
        duration: row.duration,
        status: row.status,
        createdAt: row.created_at
    };
}

async function loadAppData() {
    const [employeeRows, roomRows, roomFeatureRows, roomAvailabilityRows, meetingRows, bookingRows, sessionRows] =
        await Promise.all([
            selectAll('employees', 'id'),
            selectAll('rooms', 'id'),
            selectAll('room_features', 'id'),
            selectAll('room_availability', 'id'),
            selectAll('meetings', 'id'),
            selectAll('bookings', 'created_at'),
            selectAll('sessions', 'created_at')
        ]);

    const employees = employeeRows.map(normalizeEmployee);
    const employeesById = new Map(employees.map((employee) => [employee.id, employee]));

    const roomFeaturesByRoomId = new Map();
    for (const row of roomFeatureRows) {
        const features = roomFeaturesByRoomId.get(row.room_id) || [];
        features.push(row.feature_name);
        roomFeaturesByRoomId.set(row.room_id, features);
    }

    const roomAvailabilityByRoomId = new Map();
    for (const row of roomAvailabilityRows) {
        const slots = roomAvailabilityByRoomId.get(row.room_id) || [];
        slots.push(row);
        roomAvailabilityByRoomId.set(row.room_id, slots);
    }

    const rooms = roomRows.map((row) =>
        normalizeRoom(
            row,
            roomFeaturesByRoomId.get(row.id) || [],
            roomAvailabilityByRoomId.get(row.id) || []
        )
    );
    const roomsById = new Map(rooms.map((room) => [room.id, room]));

    const meetings = meetingRows.map(normalizeMeeting);
    const bookings = bookingRows.map((row) => normalizeBooking(row, employeesById, roomsById));
    const sessions = sessionRows.map((row) => ({
        token: row.token,
        employeeId: row.employee_id,
        createdAt: row.created_at
    }));

    return {
        employees,
        employeesById,
        rooms,
        roomsById,
        meetings,
        bookings,
        sessions
    };
}

async function getSessionUser(request) {
    const token = getAuthToken(request);
    if (!token) {
        return null;
    }

    const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('token, employee_id, created_at')
        .eq('token', token)
        .maybeSingle();

    if (sessionError) {
        throw sessionError;
    }

    if (!session) {
        return null;
    }

    const { data: employee, error: employeeError } = await supabase
        .from('employees')
        .select('*')
        .eq('id', session.employee_id)
        .maybeSingle();

    if (employeeError) {
        throw employeeError;
    }

    if (!employee || employee.status !== 'Active') {
        await supabase.from('sessions').delete().eq('token', token);
        return null;
    }

    return {
        token,
        employee: normalizeEmployee(employee)
    };
}

async function requireAuth(request, response) {
    const session = await getSessionUser(request);
    if (!session) {
        sendError(response, 401, 'Authentication required');
        return null;
    }
    return session;
}

function requireAdmin(session, response) {
    if (session.employee.role !== 'Admin') {
        sendError(response, 403, 'Admin access required');
        return false;
    }
    return true;
}

function parseFeatureList(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
    }

    if (typeof value === 'string') {
        return value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }

    return [];
}

function parseDurationToMs(duration) {
    if (typeof duration === 'number' && Number.isFinite(duration)) {
        return duration * 60 * 1000;
    }

    if (typeof duration !== 'string') {
        return null;
    }

    const normalized = duration.trim().toLowerCase();
    const hoursMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*h(?:r|rs)?$/);
    if (hoursMatch) {
        return Math.round(Number(hoursMatch[1]) * 60 * 60 * 1000);
    }

    const minutesMatch = normalized.match(/^(\d+)\s*mins?$/);
    if (minutesMatch) {
        return Number(minutesMatch[1]) * 60 * 1000;
    }

    const clockMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
    if (clockMatch) {
        return (Number(clockMatch[1]) * 60 + Number(clockMatch[2])) * 60 * 1000;
    }

    return null;
}

function getMeetingTypeRules(meetingType) {
    const type = String(meetingType || 'meeting').toLowerCase();
    const rules = {
        meeting: {
            preferredRoomTypes: ['meeting'],
            fallbackRoomTypes: ['briefing', 'board']
        },
        training: {
            preferredRoomTypes: ['training'],
            fallbackRoomTypes: ['meeting']
        },
        board: {
            preferredRoomTypes: ['board'],
            fallbackRoomTypes: ['meeting']
        },
        briefing: {
            preferredRoomTypes: ['briefing'],
            fallbackRoomTypes: ['meeting']
        }
    };

    return rules[type] || rules.meeting;
}

function buildDateTime(date, time) {
    return new Date(`${date}T${time}:00`);
}

function getRoomAvailabilityWindow(room, date) {
    const day = buildDateTime(date, '00:00').getDay();
    return room.availability.weeklyHours.filter((slot) => slot.day === day);
}

function areTimeRangesOverlapping(startA, endA, startB, endB) {
    return startA < endB && startB < endA;
}

function isRoomBooked(roomId, startDate, endDate, bookings) {
    return bookings.some((booking) => {
        if (booking.roomId !== roomId || booking.status === 'Cancelled') {
            return false;
        }

        const bookingStart = new Date(booking.startTime);
        const bookingEnd = new Date(booking.endTime);
        return areTimeRangesOverlapping(startDate, endDate, bookingStart, bookingEnd);
    });
}

function isRoomAvailable(room, request, bookings) {
    const startDate = buildDateTime(request.date, request.startTime);
    const endDate = request.endTime
        ? buildDateTime(request.date, request.endTime)
        : new Date(startDate.getTime() + request.durationMs);

    const windows = getRoomAvailabilityWindow(room, request.date);
    if (!windows.length) {
        return { available: false, reason: 'Room is unavailable on the selected day.' };
    }

    const withinWorkingHours = windows.some((slot) => {
        const windowStart = buildDateTime(request.date, slot.start);
        const windowEnd = buildDateTime(request.date, slot.end);
        return startDate >= windowStart && endDate <= windowEnd;
    });

    if (!withinWorkingHours) {
        return { available: false, reason: 'Requested time is outside room working hours.' };
    }

    if (isRoomBooked(room.id, startDate, endDate, bookings)) {
        return { available: false, reason: 'Room is already booked for the selected time.' };
    }

    return { available: true };
}

function buildRecommendationRequest(input) {
    const attendeeCount = Number(input.attendeeCount || input.capacity || 0);
    const requiredFeatures = parseFeatureList(input.requiredFeatures);
    const durationMs =
        parseDurationToMs(input.duration) ||
        parseDurationToMs(input.durationMinutes) ||
        parseDurationToMs(input.roomDuration);
    const startTime = input.startTime;
    const endTime = input.endTime;

    return {
        meetingType: String(input.meetingType || 'meeting').toLowerCase(),
        attendeeCount,
        date: input.date,
        startTime,
        endTime,
        duration: input.duration || input.durationMinutes || null,
        durationMs:
            durationMs ||
            (startTime && endTime
                ? buildDateTime(input.date, endTime).getTime() - buildDateTime(input.date, startTime).getTime()
                : null),
        requiredFeatures,
        preferredFloor: input.preferredFloor || '',
        strictRoomType: Boolean(input.strictRoomType),
        strictFeatures: Boolean(input.strictFeatures),
        preferredRoomId: input.roomId || input.preferredRoomId || null
    };
}

function validateRecommendationRequest(requestData) {
    if (!requestData.date) {
        return 'Meeting date is required.';
    }
    if (!requestData.startTime) {
        return 'Meeting start time is required.';
    }
    if (!requestData.durationMs || requestData.durationMs <= 0) {
        return 'Meeting duration is required.';
    }
    if (!Number.isFinite(requestData.attendeeCount) || requestData.attendeeCount <= 0) {
        return 'Attendee count must be greater than zero.';
    }
    return null;
}

function scoreCapacityFit(room, attendeeCount) {
    const delta = room.capacity - attendeeCount;
    if (delta < 0) {
        return { rejected: true, reason: 'Room capacity is below attendee count.' };
    }
    if (delta === 0) return { score: 35, reason: 'Capacity is an exact fit.' };
    if (delta <= 2) return { score: 32, reason: 'Capacity is a close fit.' };
    if (delta <= 5) return { score: 28, reason: 'Capacity comfortably fits the meeting.' };
    if (delta <= 10) return { score: 20, reason: 'Capacity fits but leaves extra room.' };
    return { score: 10, reason: 'Capacity fits but the room is larger than needed.' };
}

function scoreRoomTypeFit(room, meetingType, strictRoomType) {
    const rules = getMeetingTypeRules(meetingType);
    if (rules.preferredRoomTypes.includes(room.roomType)) {
        return { score: 30, reason: `${capitalize(room.roomType)} room matches the meeting type.` };
    }
    if (rules.fallbackRoomTypes.includes(room.roomType)) {
        return { score: 18, reason: `${capitalize(room.roomType)} room is a usable fallback.` };
    }
    if (strictRoomType) {
        return { rejected: true, reason: 'Room type does not match the requested meeting type.' };
    }
    return { score: 8, reason: 'Room type is acceptable but not ideal.' };
}

function scoreFeatureFit(room, requiredFeatures, strictFeatures) {
    if (!requiredFeatures.length) {
        return { score: 20, reason: 'No required features specified.' };
    }

    const normalizedRoomFeatures = room.features.map((feature) => feature.toLowerCase());
    const matched = requiredFeatures.filter((feature) =>
        normalizedRoomFeatures.includes(feature.toLowerCase())
    );

    if (strictFeatures && matched.length < requiredFeatures.length) {
        return { rejected: true, reason: 'Room is missing one or more required features.' };
    }

    const score = Math.round((matched.length / requiredFeatures.length) * 20);
    return {
        score,
        reason:
            matched.length === requiredFeatures.length
                ? 'All requested features are available.'
                : `${matched.length} of ${requiredFeatures.length} requested features are available.`
    };
}

function scoreFloorPreference(room, preferredFloor) {
    if (!preferredFloor) {
        return { score: 0, reason: null };
    }
    if (room.floor === preferredFloor) {
        return { score: 10, reason: 'Matches the preferred floor.' };
    }
    return { score: 0, reason: 'Different floor from the preferred location.' };
}

function scorePreference(room, preferredRoomId) {
    if (preferredRoomId && room.id === preferredRoomId) {
        return { score: 5, reason: 'Matches the originally selected room.' };
    }
    return { score: 0, reason: null };
}

function recommendRooms(rooms, bookings, rawRequest) {
    const requestData = buildRecommendationRequest(rawRequest);
    const validationError = validateRecommendationRequest(requestData);
    if (validationError) {
        return { error: validationError };
    }

    const accepted = [];
    const rejected = [];

    for (const room of rooms) {
        const availabilityCheck = isRoomAvailable(room, requestData, bookings);
        if (!availabilityCheck.available) {
            rejected.push({ roomId: room.id, roomName: room.name, reason: availabilityCheck.reason });
            continue;
        }

        const capacityScore = scoreCapacityFit(room, requestData.attendeeCount);
        if (capacityScore.rejected) {
            rejected.push({ roomId: room.id, roomName: room.name, reason: capacityScore.reason });
            continue;
        }

        const typeScore = scoreRoomTypeFit(room, requestData.meetingType, requestData.strictRoomType);
        if (typeScore.rejected) {
            rejected.push({ roomId: room.id, roomName: room.name, reason: typeScore.reason });
            continue;
        }

        const featureScore = scoreFeatureFit(room, requestData.requiredFeatures, requestData.strictFeatures);
        if (featureScore.rejected) {
            rejected.push({ roomId: room.id, roomName: room.name, reason: featureScore.reason });
            continue;
        }

        const floorScore = scoreFloorPreference(room, requestData.preferredFloor);
        const preferenceScore = scorePreference(room, requestData.preferredRoomId);
        const totalScore =
            capacityScore.score +
            typeScore.score +
            featureScore.score +
            floorScore.score +
            preferenceScore.score;

        accepted.push({
            room,
            score: totalScore,
            reasons: [
                'Available for the requested time.',
                capacityScore.reason,
                typeScore.reason,
                featureScore.reason,
                floorScore.reason,
                preferenceScore.reason
            ].filter(Boolean),
            capacityDelta: room.capacity - requestData.attendeeCount
        });
    }

    accepted.sort((left, right) => {
        if (right.score !== left.score) {
            return right.score - left.score;
        }
        if (left.capacityDelta !== right.capacityDelta) {
            return left.capacityDelta - right.capacityDelta;
        }
        return left.room.name.localeCompare(right.room.name);
    });

    const bestMatch = accepted[0] || null;
    const alternatives = accepted.slice(1, 4);

    return {
        request: requestData,
        bestMatch: bestMatch
            ? {
                  roomId: bestMatch.room.id,
                  roomName: bestMatch.room.name,
                  score: bestMatch.score,
                  reasons: bestMatch.reasons,
                  room: bestMatch.room
              }
            : null,
        alternatives: alternatives.map((entry) => ({
            roomId: entry.room.id,
            roomName: entry.room.name,
            score: entry.score,
            reasons: entry.reasons,
            room: entry.room
        })),
        rejected
    };
}

function buildBookingResponse(booking, employeesById, roomsById) {
    const employee = employeesById.get(booking.employeeId);
    const room = roomsById.get(booking.roomId);

    return {
        id: booking.id,
        userEmail: employee ? employee.email : null,
        userName: employee ? employee.name : null,
        roomId: booking.roomId,
        roomName: room ? room.name : null,
        roomType: room ? room.roomType : null,
        meetingName: booking.meetingName,
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        endTime: booking.endTime,
        duration: booking.duration,
        status: booking.status,
        createdAt: booking.createdAt
    };
}

function getDashboardSummary(data, employee) {
    const userBookings =
        employee.role === 'Admin'
            ? data.bookings
            : data.bookings.filter((booking) => booking.employeeId === employee.id);

    return {
        employees: {
            total: data.employees.length,
            active: data.employees.filter((item) => item.status === 'Active').length
        },
        rooms: {
            total: data.rooms.length,
            byType: data.rooms.reduce((accumulator, room) => {
                accumulator[room.roomType] = (accumulator[room.roomType] || 0) + 1;
                return accumulator;
            }, {})
        },
        meetings: {
            total: data.meetings.length,
            active: data.meetings.filter((item) => item.status === 'Active').length
        },
        bookings: {
            total: userBookings.length,
            confirmed: userBookings.filter((item) => item.status === 'Confirmed').length,
            pending: userBookings.filter((item) => item.status === 'Pending').length
        }
    };
}

function capitalize(value) {
    const text = String(value || '');
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function publicEmployee(employee) {
    return {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        phoneNumber: employee.phoneNumber,
        role: employee.role,
        status: employee.status,
        joinedAt: employee.joinedAt
    };
}

function toRoomResponse(room, availabilityStatus) {
    return {
        id: room.id,
        name: room.name,
        roomType: room.roomType,
        capacity: room.capacity,
        capacityLabel: room.capacityLabel,
        floor: room.floor,
        location: room.location,
        duration: room.duration,
        image: room.image,
        features: room.features,
        availability: room.availability,
        ...(availabilityStatus ? { availabilityStatus } : {})
    };
}

async function ensureNotificationSupport() {
    if (notificationSupportChecked) {
        return notificationsEnabled;
    }

    notificationSupportChecked = true;
    try {
        const { error } = await supabase.from('notifications').select('id').limit(1);
        notificationsEnabled = !error;
        if (error) {
            logEvent('warn', 'Notifications disabled: run supabase/notifications.sql to enable backend messaging.');
        }
    } catch (error) {
        notificationsEnabled = false;
        logEvent('warn', 'Notifications disabled', { error: error.message });
    }

    return notificationsEnabled;
}

function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60 * 1000);
}

function buildNotificationMessage(notification) {
    const payload = notification.payload || {};
    const meetingName = payload.meetingName || 'Meeting';
    const roomName = payload.roomName || 'assigned room';
    const startTime = payload.startTime ? new Date(payload.startTime).toLocaleString() : '';

    switch (notification.notification_type) {
        case 'booking_confirmation':
            return {
                subject: `Booking confirmed: ${meetingName}`,
                text: `Your meeting "${meetingName}" has been booked in ${roomName}. Start time: ${startTime}.`
            };
        case 'meeting_reminder':
            return {
                subject: `Reminder: ${meetingName} starts soon`,
                text: `Reminder: your meeting "${meetingName}" starts at ${startTime} in ${roomName}.`
            };
        default:
            return {
                subject: `Meeting update: ${meetingName}`,
                text: `Update for "${meetingName}" in ${roomName}.`
            };
    }
}

async function sendEmailNotification(notification) {
    if (EMAIL_PROVIDER !== 'resend' || !RESEND_API_KEY || !NOTIFICATION_FROM_EMAIL) {
        return { status: 'skipped', error: 'Email provider is not configured.' };
    }

    const payload = notification.payload || {};
    if (!payload.email) {
        return { status: 'skipped', error: 'Notification recipient email is missing.' };
    }

    const message = buildNotificationMessage(notification);
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: NOTIFICATION_FROM_EMAIL,
            to: [payload.email],
            subject: message.subject,
            text: message.text
        })
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        return {
            status: 'failed',
            error: result.message || `Email provider request failed with status ${response.status}.`
        };
    }

    return {
        status: 'sent',
        providerMessageId: result.id || null
    };
}

async function sendSmsNotification(notification) {
    if (
        SMS_PROVIDER !== 'twilio' ||
        !TWILIO_ACCOUNT_SID ||
        !TWILIO_AUTH_TOKEN ||
        !TWILIO_FROM_NUMBER
    ) {
        return { status: 'skipped', error: 'SMS provider is not configured.' };
    }

    const payload = notification.payload || {};
    if (!payload.phoneNumber) {
        return { status: 'skipped', error: 'Notification recipient phone number is missing.' };
    }

    const message = buildNotificationMessage(notification);
    const body = new URLSearchParams({
        To: payload.phoneNumber,
        From: TWILIO_FROM_NUMBER,
        Body: message.text
    });

    const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
        {
            method: 'POST',
            headers: {
                Authorization:
                    'Basic ' +
                    Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: body.toString()
        }
    );

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        return {
            status: 'failed',
            error: result.message || `SMS provider request failed with status ${response.status}.`
        };
    }

    return {
        status: 'sent',
        providerMessageId: result.sid || null
    };
}

async function dispatchNotification(notification) {
    if (notification.channel === 'email') {
        return sendEmailNotification(notification);
    }

    if (notification.channel === 'sms') {
        return sendSmsNotification(notification);
    }

    return {
        status: 'skipped',
        error: `Unsupported notification channel: ${notification.channel}`
    };
}

async function markNotification(notificationId, result) {
    const updates = {
        status: result.status,
        provider_message_id: result.providerMessageId || null,
        last_error: result.error || null,
        sent_at: result.status === 'sent' ? new Date().toISOString() : null
    };

    const { error } = await supabase.from('notifications').update(updates).eq('id', notificationId);
    if (error) {
        throw error;
    }
}

async function processPendingNotifications() {
    if (!(await ensureNotificationSupport())) {
        return;
    }

    const { data: notifications, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_for', new Date().toISOString())
        .order('scheduled_for', { ascending: true })
        .limit(25);

    if (error) {
        logEvent('warn', 'Unable to load pending notifications', { error: error.message });
        return;
    }

    for (const notification of notifications || []) {
        try {
            const result = await dispatchNotification(notification);
            await markNotification(notification.id, result);
        } catch (dispatchError) {
            await markNotification(notification.id, {
                status: 'failed',
                error: dispatchError.message
            });
        }
    }
}

async function queueBookingNotifications(booking, employee, room) {
    if (!(await ensureNotificationSupport())) {
        return;
    }

    const startDate = new Date(booking.startTime);
    const now = new Date();
    const notifications = [];
    const payload = {
        bookingId: booking.id,
        employeeId: employee.id,
        employeeName: employee.name,
        email: employee.email,
        phoneNumber: employee.phoneNumber,
        meetingName: booking.meetingName,
        roomName: room ? room.name : booking.roomName,
        startTime: booking.startTime,
        endTime: booking.endTime
    };

    notifications.push({
        id: createId('#NTF-'),
        booking_id: booking.id,
        employee_id: employee.id,
        channel: 'email',
        notification_type: 'booking_confirmation',
        scheduled_for: now.toISOString(),
        status: 'pending',
        payload
    });

    const reminderAt = addMinutes(startDate, -30);
    if (reminderAt > now) {
        notifications.push({
            id: createId('#NTF-'),
            booking_id: booking.id,
            employee_id: employee.id,
            channel: 'email',
            notification_type: 'meeting_reminder',
            scheduled_for: reminderAt.toISOString(),
            status: 'pending',
            payload
        });
    }

    if (employee.phoneNumber) {
        notifications.push({
            id: createId('#NTF-'),
            booking_id: booking.id,
            employee_id: employee.id,
            channel: 'sms',
            notification_type: 'booking_confirmation',
            scheduled_for: now.toISOString(),
            status: 'pending',
            payload
        });

        if (reminderAt > now) {
            notifications.push({
                id: createId('#NTF-'),
                booking_id: booking.id,
                employee_id: employee.id,
                channel: 'sms',
                notification_type: 'meeting_reminder',
                scheduled_for: reminderAt.toISOString(),
                status: 'pending',
                payload
            });
        }
    }

    const { error } = await supabase.from('notifications').insert(notifications);
    if (error) {
        throw error;
    }
}

async function handleApi(request, response, requestUrl) {
    if (request.method === 'POST' && requestUrl.pathname === '/api/auth/login') {
        const body = await readJsonBody(request);
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');

        const { data: employeeRow, error } = await supabase
            .from('employees')
            .select('*')
            .ilike('email', email)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!employeeRow || employeeRow.password_hash !== sha256(password)) {
            sendError(response, 401, 'Invalid email or password');
            return;
        }

        if (employeeRow.status !== 'Active') {
            sendError(response, 403, 'This employee account is inactive');
            return;
        }

        const token = createToken();
        const { error: insertError } = await supabase.from('sessions').insert({
            token,
            employee_id: employeeRow.id
        });

        if (insertError) {
            throw insertError;
        }

        sendJson(response, 200, {
            token,
            employee: publicEmployee(normalizeEmployee(employeeRow))
        });
        return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/auth/logout') {
        const token = getAuthToken(request);
        if (token) {
            const { error } = await supabase.from('sessions').delete().eq('token', token);
            if (error) {
                throw error;
            }
        }
        sendNoContent(response);
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/auth/me') {
        const session = await requireAuth(request, response);
        if (!session) {
            return;
        }

        sendJson(response, 200, {
            employee: publicEmployee(session.employee)
        });
        return;
    }

    const session = await requireAuth(request, response);
    if (!session) {
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/dashboard') {
        const data = await loadAppData();
        sendJson(response, 200, {
            employee: publicEmployee(session.employee),
            summary: getDashboardSummary(data, session.employee)
        });
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/rooms') {
        const data = await loadAppData();
        const date = requestUrl.searchParams.get('date');
        const startTime = requestUrl.searchParams.get('startTime');
        const duration = requestUrl.searchParams.get('duration');

        const rooms = data.rooms.map((room) => {
            let availabilityStatus = null;
            if (date && startTime && duration) {
                const check = isRoomAvailable(
                    room,
                    buildRecommendationRequest({
                        date,
                        startTime,
                        duration,
                        attendeeCount: 1
                    }),
                    data.bookings
                );
                availabilityStatus = check.available ? 'available' : check.reason;
            }
            return toRoomResponse(room, availabilityStatus);
        });

        sendJson(response, 200, { rooms });
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/rooms/availability') {
        const data = await loadAppData();
        const roomId = requestUrl.searchParams.get('roomId');
        const requestPayload = buildRecommendationRequest({
            date: requestUrl.searchParams.get('date'),
            startTime: requestUrl.searchParams.get('startTime'),
            endTime: requestUrl.searchParams.get('endTime'),
            duration: requestUrl.searchParams.get('duration'),
            attendeeCount: Number(requestUrl.searchParams.get('attendeeCount') || 1)
        });

        const validationError = validateRecommendationRequest(requestPayload);
        if (validationError) {
            sendError(response, 400, validationError);
            return;
        }

        const rooms = roomId ? data.rooms.filter((room) => room.id === roomId) : data.rooms;
        const availability = rooms.map((room) => {
            const result = isRoomAvailable(room, requestPayload, data.bookings);
            return {
                roomId: room.id,
                roomName: room.name,
                available: result.available,
                ...(result.reason ? { reason: result.reason } : {})
            };
        });

        sendJson(response, 200, { availability });
        return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/recommendations') {
        const body = await readJsonBody(request);
        const data = await loadAppData();
        const recommendation = recommendRooms(data.rooms, data.bookings, body);

        if (recommendation.error) {
            sendError(response, 400, recommendation.error);
            return;
        }

        sendJson(response, 200, recommendation);
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/bookings') {
        const data = await loadAppData();
        const bookings =
            session.employee.role === 'Admin'
                ? data.bookings
                : data.bookings.filter((booking) => booking.employeeId === session.employee.id);

        sendJson(response, 200, {
            bookings: bookings.map((booking) =>
                buildBookingResponse(booking, data.employeesById, data.roomsById)
            )
        });
        return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/bookings') {
        const body = await readJsonBody(request);
        const validatedBooking = validateBookingPayload(body, session.employee.role);
        const data = await loadAppData();

        let owner = session.employee;
        if (session.employee.role === 'Admin' && body.userEmail) {
            owner = data.employees.find(
                (employee) => employee.email.toLowerCase() === String(body.userEmail).toLowerCase()
            );
            if (!owner) {
                sendError(response, 400, 'Employee email does not match a known account');
                return;
            }
        }

        const recommendation = recommendRooms(data.rooms, data.bookings, body);
        if (recommendation.error) {
            sendError(response, 400, recommendation.error);
            return;
        }

        let room = null;
        if (body.roomId) {
            room = data.roomsById.get(body.roomId) || null;
            if (!room) {
                sendError(response, 400, 'Selected room was not found');
                return;
            }

            const availability = isRoomAvailable(room, recommendation.request, data.bookings);
            if (!availability.available) {
                sendError(response, 409, availability.reason);
                return;
            }
        } else if (recommendation.bestMatch) {
            room = recommendation.bestMatch.room;
        }

        if (!room) {
            sendError(response, 409, 'No suitable room is currently available');
            return;
        }

        const startDate = buildDateTime(recommendation.request.date, recommendation.request.startTime);
        const endDate = recommendation.request.endTime
            ? buildDateTime(recommendation.request.date, recommendation.request.endTime)
            : new Date(startDate.getTime() + recommendation.request.durationMs);

        const insertPayload = {
            id: createId('#BKG-'),
            employee_id: owner.id,
            meeting_name: validatedBooking.meetingName,
            room_id: room.id,
            booking_date: recommendation.request.date,
            start_time: startDate.toISOString(),
            end_time: endDate.toISOString(),
            duration: body.duration || room.duration || '1 hr',
            status: 'Confirmed'
        };

        const { data: insertedRows, error } = await supabase
            .from('bookings')
            .insert(insertPayload)
            .select('*')
            .single();

        if (error) {
            throw error;
        }

        const normalized = normalizeBooking(insertedRows, data.employeesById, data.roomsById);
        await queueBookingNotifications(normalized, owner, room);
        await processPendingNotifications();
        sendJson(response, 201, {
            booking: buildBookingResponse(normalized, data.employeesById, data.roomsById),
            recommendation
        });
        return;
    }

    if (request.method === 'DELETE' && requestUrl.pathname.startsWith('/api/bookings/')) {
        const bookingId = requestUrl.pathname.split('/').pop();
        const data = await loadAppData();
        const booking = data.bookings.find((item) => item.id === bookingId);

        if (!booking) {
            notFound(response);
            return;
        }

        const ownsBooking = booking.employeeId === session.employee.id;
        if (session.employee.role !== 'Admin' && !ownsBooking) {
            sendError(response, 403, 'You can only cancel your own bookings');
            return;
        }

        const { error } = await supabase.from('bookings').delete().eq('id', bookingId);
        if (error) {
            throw error;
        }

        sendNoContent(response);
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/employees') {
        if (!requireAdmin(session, response)) {
            return;
        }

        const data = await loadAppData();
        sendJson(response, 200, {
            employees: data.employees.map(publicEmployee)
        });
        return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/employees') {
        if (!requireAdmin(session, response)) {
            return;
        }

        const body = await readJsonBody(request);
        const payload = validateEmployeeCreatePayload(body);

        const { data: insertedRow, error } = await supabase
            .from('employees')
            .insert(payload)
            .select('*')
            .single();

        if (error) {
            throw error;
        }

        sendJson(response, 201, {
            employee: publicEmployee(normalizeEmployee(insertedRow))
        });
        return;
    }

    if (request.method === 'PATCH' && requestUrl.pathname.startsWith('/api/employees/')) {
        if (!requireAdmin(session, response)) {
            return;
        }

        const employeeId = requestUrl.pathname.split('/').pop();
        const body = await readJsonBody(request);
        const updates = validateEmployeeUpdatePayload(body);

        const { data: updatedRow, error } = await supabase
            .from('employees')
            .update(updates)
            .eq('id', employeeId)
            .select('*')
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!updatedRow) {
            notFound(response);
            return;
        }

        sendJson(response, 200, {
            employee: publicEmployee(normalizeEmployee(updatedRow))
        });
        return;
    }

    if (request.method === 'DELETE' && requestUrl.pathname.startsWith('/api/employees/')) {
        if (!requireAdmin(session, response)) {
            return;
        }

        const employeeId = requestUrl.pathname.split('/').pop();
        await supabase.from('sessions').delete().eq('employee_id', employeeId);
        const { error } = await supabase.from('employees').delete().eq('id', employeeId);
        if (error) {
            throw error;
        }

        sendNoContent(response);
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/meetings') {
        const data = await loadAppData();
        sendJson(response, 200, { meetings: data.meetings });
        return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/meetings') {
        if (!requireAdmin(session, response)) {
            return;
        }

        const body = await readJsonBody(request);
        const payload = validateMeetingCreatePayload(body);

        const { data: insertedRow, error } = await supabase
            .from('meetings')
            .insert(payload)
            .select('*')
            .single();

        if (error) {
            throw error;
        }

        sendJson(response, 201, {
            meeting: normalizeMeeting(insertedRow)
        });
        return;
    }

    if (request.method === 'PATCH' && requestUrl.pathname.startsWith('/api/meetings/')) {
        if (!requireAdmin(session, response)) {
            return;
        }

        const meetingId = requestUrl.pathname.split('/').pop();
        const body = await readJsonBody(request);
        const updates = validateMeetingUpdatePayload(body);

        const { data: updatedRow, error } = await supabase
            .from('meetings')
            .update(updates)
            .eq('id', meetingId)
            .select('*')
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!updatedRow) {
            notFound(response);
            return;
        }

        sendJson(response, 200, {
            meeting: normalizeMeeting(updatedRow)
        });
        return;
    }

    if (request.method === 'DELETE' && requestUrl.pathname.startsWith('/api/meetings/')) {
        if (!requireAdmin(session, response)) {
            return;
        }

        const meetingId = requestUrl.pathname.split('/').pop();
        const { error } = await supabase.from('meetings').delete().eq('id', meetingId);
        if (error) {
            throw error;
        }

        sendNoContent(response);
        return;
    }

    notFound(response);
}

const server = http.createServer(async (request, response) => {
    const startedAt = Date.now();
    const requestId =
        typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : createId('REQ-');

    response.setHeader('X-Request-Id', requestId);
    response.on('finish', () => {
        logEvent('info', 'Request completed', {
            requestId,
            method: request.method,
            path: request.url,
            statusCode: response.statusCode,
            durationMs: Date.now() - startedAt
        });
    });

    try {
        const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

        if (requestUrl.pathname.startsWith('/api/')) {
            await handleApi(request, response, requestUrl);
            return;
        }

        await serveStatic(requestUrl, response);
    } catch (error) {
        logEvent('error', 'Request failed', {
            requestId,
            method: request.method,
            path: request.url,
            error: error.message || 'Internal server error'
        });

        if (error instanceof ApiError) {
            sendError(response, error.statusCode, error.message, error.details);
            return;
        }

        if (error && error.code) {
            const apiError = mapSupabaseError(error);
            sendError(response, apiError.statusCode, apiError.message, apiError.details);
            return;
        }

        const statusCode = error.message === 'Invalid JSON request body' ? 400 : 500;
        sendError(response, statusCode, error.message || 'Internal server error');
    }
});

if (require.main === module) {
    setInterval(() => {
        processPendingNotifications().catch((error) => {
            logEvent('warn', 'Notification worker error', { error: error.message });
        });
    }, NOTIFICATION_POLL_MS);

    processPendingNotifications().catch((error) => {
        logEvent('warn', 'Initial notification scan failed', { error: error.message });
    });

    server.listen(PORT, () => {
        logEvent('info', 'Server started', { port: PORT, url: `http://localhost:${PORT}` });
    });
}

module.exports = {
    ApiError,
    areTimeRangesOverlapping,
    buildDateTime,
    buildRecommendationRequest,
    isRoomAvailable,
    recommendRooms,
    validateBookingPayload,
    validateEmployeeCreatePayload,
    validateEmployeeUpdatePayload,
    validateMeetingCreatePayload,
    validateMeetingUpdatePayload
};
