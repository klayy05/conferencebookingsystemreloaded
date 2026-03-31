const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.PORT = process.env.PORT || '3000';
process.env.NOTIFICATION_POLL_MS = process.env.NOTIFICATION_POLL_MS || '60000';

const { isRoomAvailable, recommendRooms } = require('./server');

function createRoom(overrides = {}) {
    return {
        id: '#RM-001',
        name: 'Meeting Room A',
        roomType: 'meeting',
        capacity: 10,
        floor: 'Ground Floor',
        features: ['Display screen', 'Whiteboard'],
        availability: {
            timezone: 'local',
            weeklyHours: [
                { day: 0, start: '07:00', end: '18:00' },
                { day: 1, start: '07:00', end: '18:00' },
                { day: 2, start: '07:00', end: '18:00' },
                { day: 3, start: '07:00', end: '18:00' },
                { day: 4, start: '07:00', end: '18:00' },
                { day: 5, start: '07:00', end: '18:00' },
                { day: 6, start: '07:00', end: '18:00' }
            ]
        },
        ...overrides
    };
}

test('isRoomAvailable rejects overlapping confirmed bookings', () => {
    const room = createRoom();
    const request = {
        date: '2026-03-30',
        startTime: '09:00',
        durationMs: 60 * 60 * 1000
    };
    const bookings = [
        {
            roomId: room.id,
            status: 'Confirmed',
            startTime: '2026-03-30T09:30:00',
            endTime: '2026-03-30T10:30:00'
        }
    ];

    const result = isRoomAvailable(room, request, bookings);

    assert.equal(result.available, false);
    assert.equal(result.reason, 'Room is already booked for the selected time.');
});

test('isRoomAvailable rejects requests outside working hours', () => {
    const room = createRoom();
    const request = {
        date: '2026-03-30',
        startTime: '06:30',
        durationMs: 60 * 60 * 1000
    };

    const result = isRoomAvailable(room, request, []);

    assert.equal(result.available, false);
    assert.equal(result.reason, 'Requested time is outside room working hours.');
});

test('recommendRooms chooses the best available room based on type, fit, and features', () => {
    const rooms = [
        createRoom({
            id: '#RM-001',
            name: 'Board Room',
            roomType: 'board',
            capacity: 20,
            features: ['Video conferencing', 'Large display']
        }),
        createRoom({
            id: '#RM-002',
            name: 'Training Room',
            roomType: 'training',
            capacity: 12,
            features: ['Projector', 'Whiteboard', 'Flexible seating']
        }),
        createRoom({
            id: '#RM-003',
            name: 'Meeting Room B',
            roomType: 'meeting',
            capacity: 8,
            features: ['Display screen']
        })
    ];

    const result = recommendRooms(rooms, [], {
        meetingType: 'training',
        attendeeCount: 10,
        date: '2026-03-30',
        startTime: '10:00',
        duration: '1 hr',
        requiredFeatures: ['Projector', 'Whiteboard']
    });

    assert.equal(result.error, undefined);
    assert.equal(result.bestMatch.room.id, '#RM-002');
    assert.ok(result.alternatives.some((option) => option.room.id === '#RM-001'));
    assert.ok(result.rejected.some((option) => option.roomId === '#RM-003'));
});
