# RATC Meeting Room Booking

An internal meeting-room booking system for employees and admins, backed by a Node server and Supabase.

## What It Includes

- Landing page and sign-in page
- Employee and admin dashboards
- Room recommendation logic based on meeting type, capacity, features, floor, and live availability
- Room images and large room previews
- Supabase-backed employees, rooms, meetings, bookings, sessions, and notifications
- Backend email and SMS notification queue for booking confirmations and meeting reminders

## Project Files

- `index.html` - landing page
- `login.html` - sign-in page
- `user_dashboard.html` - employee dashboard
- `admin_dashboard.html` - admin dashboard
- `styles.css` - shared styles
- `script.js` - frontend logic
- `server.js` - API server, static file host, recommendation engine, notification worker
- `supabase/schema.sql` - base schema and seed data
- `supabase/notifications.sql` - notification tables and phone-number migration
- `data/db.json` - legacy local seed snapshot kept for reference; current runtime uses Supabase
- `.env.example` - required environment variables
- `assets/rooms/` - room images

## Start the Project

Do not open `index.html` directly.

Run the app through the backend:

1. Open a terminal in the project folder.
2. Run `npm install`
3. Copy `.env.example` to `.env`
4. Fill in your Supabase and provider values
5. Run `npm start`
6. Open `http://localhost:3000`

Optional validation:

- `npm run check`

## Supabase Setup

In your Supabase SQL editor, run:

1. `supabase/schema.sql`
2. `supabase/notifications.sql`

The second script adds:

- `employees.phone_number`
- `notifications`

## Environment Variables

Required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PORT`

Optional notification config:

- `NOTIFICATION_POLL_MS`
- `EMAIL_PROVIDER=resend`
- `RESEND_API_KEY`
- `NOTIFICATION_FROM_EMAIL`
- `SMS_PROVIDER=twilio`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`

If notification provider variables are missing, booking still works and notifications are marked as skipped.

## Demo Credentials

- Admin: `sarah.w@gnpcghana.com` / `Admin@123!`
- Employee: `john.doe@gnpcghana.com` / `User@123!`
- Employee: `jane.smith@gnpcghana.com` / `User@123!`
- Employee: `mike.j@gnpcghana.com` / `User@123!`
- Employee: `philip.0@gnpcghana.com` / `User@123!`
- Employee: `mark.a@gnpcghana.com` / `User@123!`

Demo phone numbers seeded for SMS testing:

- John Doe: `+233201111111`
- Jane Smith: `+233202222222`
- Mike Johnson: `+233203333333`
- Sarah Wilson: `+233204444444`
- Tom Brown: `+233205555555`
- Philip Obese: `+233538218158`
- Mark Afedi: `+233554198272`

## API Overview

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/dashboard`
- `GET /api/rooms`
- `GET /api/rooms/availability`
- `POST /api/recommendations`
- `GET /api/bookings`
- `POST /api/bookings`
- `DELETE /api/bookings/:id`
- `GET /api/employees`
- `POST /api/employees`
- `PATCH /api/employees/:id`
- `DELETE /api/employees/:id`
- `GET /api/meetings`
- `POST /api/meetings`
- `PATCH /api/meetings/:id`
- `DELETE /api/meetings/:id`

## Notifications

The backend queues notifications when a booking is created.

Current notification types:

- immediate booking confirmation
- 30-minute meeting reminder

Current channels:

- email via Resend
- SMS via Twilio

Notes:

- Email uses the employee email already stored in Supabase.
- SMS requires `employees.phone_number` to be populated.
- The worker scans pending notifications on server start and every `NOTIFICATION_POLL_MS`.
- The provided demo phone numbers are placeholders. Replace them with real verified numbers before live SMS tests.

## Current Limitations

- Some frontend flows may still rely on old browser-side state until fully migrated to API calls.
- `data/db.json` is not the active backend datastore and should not be treated as the source of truth.
- SMS cannot be sent for employees without phone numbers.
- No retry/backoff policy yet for failed notifications.
- No production auth hardening beyond the current custom backend flow.
