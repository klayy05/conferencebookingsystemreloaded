create table if not exists public.employees (
    id text primary key,
    name text not null,
    email text not null unique,
    phone_number text,
    role text not null check (role in ('User', 'Admin')),
    status text not null check (status in ('Active', 'Inactive')),
    joined_at date,
    password_hash text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.rooms (
    id text primary key,
    name text not null unique,
    room_type text not null check (room_type in ('meeting', 'training', 'board', 'briefing')),
    capacity integer not null check (capacity > 0),
    capacity_label text not null,
    floor text not null,
    location text not null,
    duration text,
    image_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.room_features (
    id bigint generated always as identity primary key,
    room_id text not null references public.rooms(id) on delete cascade,
    feature_name text not null,
    created_at timestamptz not null default now(),
    unique (room_id, feature_name)
);

create table if not exists public.room_availability (
    id bigint generated always as identity primary key,
    room_id text not null references public.rooms(id) on delete cascade,
    day_of_week integer not null check (day_of_week between 0 and 6),
    start_time time not null,
    end_time time not null,
    created_at timestamptz not null default now(),
    unique (room_id, day_of_week, start_time, end_time)
);

create table if not exists public.meetings (
    id text primary key,
    name text not null,
    meeting_date date not null,
    location text,
    capacity integer,
    status text not null check (status in ('Active', 'Upcoming', 'Full', 'Cancelled')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.bookings (
    id text primary key,
    employee_id text not null references public.employees(id) on delete cascade,
    meeting_name text not null,
    room_id text not null references public.rooms(id) on delete restrict,
    booking_date date not null,
    start_time timestamptz not null,
    end_time timestamptz not null,
    duration text not null,
    status text not null check (status in ('Confirmed', 'Pending', 'Cancelled')),
    created_at timestamptz not null default now()
);

create table if not exists public.sessions (
    token text primary key,
    employee_id text not null references public.employees(id) on delete cascade,
    created_at timestamptz not null default now()
);

create index if not exists idx_employees_email on public.employees(email);
create index if not exists idx_bookings_employee_id on public.bookings(employee_id);
create index if not exists idx_bookings_room_id on public.bookings(room_id);
create index if not exists idx_bookings_start_time on public.bookings(start_time);
create index if not exists idx_room_features_room_id on public.room_features(room_id);
create index if not exists idx_room_availability_room_id on public.room_availability(room_id);
create index if not exists idx_sessions_employee_id on public.sessions(employee_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists set_employees_updated_at on public.employees;
create trigger set_employees_updated_at
before update on public.employees
for each row
execute function public.set_updated_at();

drop trigger if exists set_rooms_updated_at on public.rooms;
create trigger set_rooms_updated_at
before update on public.rooms
for each row
execute function public.set_updated_at();

drop trigger if exists set_meetings_updated_at on public.meetings;
create trigger set_meetings_updated_at
before update on public.meetings
for each row
execute function public.set_updated_at();

insert into public.employees (id, name, email, phone_number, role, status, joined_at, password_hash)
values
    ('#USR-001', 'John Doe', 'john.doe@gnpcghana.com', '+233201111111', 'User', 'Active', '2023-01-15', '707a4218449e343592f9bee67e8a451e2545af33e319a6bc3b3306a71ac68585'),
    ('#USR-002', 'Jane Smith', 'jane.smith@gnpcghana.com', '+233202222222', 'User', 'Active', '2023-02-20', '707a4218449e343592f9bee67e8a451e2545af33e319a6bc3b3306a71ac68585'),
    ('#USR-003', 'Mike Johnson', 'mike.j@gnpcghana.com', '+233203333333', 'User', 'Active', '2023-03-10', '707a4218449e343592f9bee67e8a451e2545af33e319a6bc3b3306a71ac68585'),
    ('#USR-004', 'Sarah Wilson', 'sarah.w@gnpcghana.com', '+233204444444', 'Admin', 'Active', '2023-04-05', '6cf0ea55e5fd5e692e007b16339a83f4319370cdb8b6193c1630820119cbba50'),
    ('#USR-005', 'Tom Brown', 'tom.brown@gnpcghana.com', '+233205555555', 'User', 'Inactive', '2023-05-12', 'b02d5044422d3c8fb256c5e61e27672d430761bb56e7705194504b92164d1e0b'),
    ('#USR-006', 'Philip Obese', 'philip.0@gnpcghana.com', '+233538218158', 'User', 'Active', '2026-03-24', '707a4218449e343592f9bee67e8a451e2545af33e319a6bc3b3306a71ac68585'),
    ('#USR-007', 'Mark Afedi', 'mark.a@gnpcghana.com', '+233554198272', 'User', 'Active', '2026-03-24', '707a4218449e343592f9bee67e8a451e2545af33e319a6bc3b3306a71ac68585')
on conflict (id) do nothing;

insert into public.rooms (id, name, room_type, capacity, capacity_label, floor, location, duration, image_url)
values
    ('#RM-001', 'Meeting Room A', 'meeting', 10, '10+', 'Ground Floor', 'Ground Floor', '2 hrs', 'assets/rooms/meeting-room-a.jpeg'),
    ('#RM-002', 'Meeting Room B', 'meeting', 10, '10+', '2nd Floor', '2nd Floor', '1.5 hrs', 'assets/rooms/meeting-room-10+.jpeg'),
    ('#RM-003', 'Meeting Room C', 'meeting', 10, '10+', '3rd Floor', '3rd Floor', '45 mins', 'assets/rooms/meeting-room-10+.jpeg'),
    ('#RM-004', 'Training Room 1', 'training', 20, '20+', '2nd Floor', '2nd Floor', '1 hr', 'assets/rooms/training-room-50+.jpeg'),
    ('#RM-005', 'Training Room 2', 'training', 50, '50+', '3rd Floor', '3rd Floor', '3 hrs', 'assets/rooms/training-room-50+.jpeg'),
    ('#RM-006', 'Board Room', 'board', 50, '50+', '3rd Floor', '3rd Floor', '30 mins', 'assets/rooms/board-room-50+.jpeg'),
    ('#RM-007', 'Briefing Room', 'briefing', 10, '10+', 'Ground Floor', 'Ground Floor', '2 hrs', 'assets/rooms/briefing-room-8+.jpeg')
on conflict (id) do nothing;

insert into public.room_features (room_id, feature_name)
values
    ('#RM-001', 'Display screen'),
    ('#RM-001', 'Whiteboard'),
    ('#RM-002', 'Display screen'),
    ('#RM-002', 'Whiteboard'),
    ('#RM-003', 'Display screen'),
    ('#RM-003', 'Whiteboard'),
    ('#RM-004', 'Projector'),
    ('#RM-004', 'Whiteboard'),
    ('#RM-004', 'Flexible seating'),
    ('#RM-005', 'Projector'),
    ('#RM-005', 'PA system'),
    ('#RM-005', 'Flexible seating'),
    ('#RM-006', 'Video conferencing'),
    ('#RM-006', 'Large display'),
    ('#RM-006', 'Executive table'),
    ('#RM-007', 'Display screen'),
    ('#RM-007', 'Whiteboard')
on conflict (room_id, feature_name) do nothing;

insert into public.room_availability (room_id, day_of_week, start_time, end_time)
select room_id, day_of_week, start_time, end_time
from (
    values
        ('#RM-001', 1, '07:00'::time, '18:00'::time),
        ('#RM-001', 2, '07:00'::time, '18:00'::time),
        ('#RM-001', 3, '07:00'::time, '18:00'::time),
        ('#RM-001', 4, '07:00'::time, '18:00'::time),
        ('#RM-001', 5, '07:00'::time, '18:00'::time),
        ('#RM-002', 1, '07:00'::time, '18:00'::time),
        ('#RM-002', 2, '07:00'::time, '18:00'::time),
        ('#RM-002', 3, '07:00'::time, '18:00'::time),
        ('#RM-002', 4, '07:00'::time, '18:00'::time),
        ('#RM-002', 5, '07:00'::time, '18:00'::time),
        ('#RM-003', 1, '07:00'::time, '18:00'::time),
        ('#RM-003', 2, '07:00'::time, '18:00'::time),
        ('#RM-003', 3, '07:00'::time, '18:00'::time),
        ('#RM-003', 4, '07:00'::time, '18:00'::time),
        ('#RM-003', 5, '07:00'::time, '18:00'::time),
        ('#RM-004', 1, '07:00'::time, '18:00'::time),
        ('#RM-004', 2, '07:00'::time, '18:00'::time),
        ('#RM-004', 3, '07:00'::time, '18:00'::time),
        ('#RM-004', 4, '07:00'::time, '18:00'::time),
        ('#RM-004', 5, '07:00'::time, '18:00'::time),
        ('#RM-005', 1, '07:00'::time, '18:00'::time),
        ('#RM-005', 2, '07:00'::time, '18:00'::time),
        ('#RM-005', 3, '07:00'::time, '18:00'::time),
        ('#RM-005', 4, '07:00'::time, '18:00'::time),
        ('#RM-005', 5, '07:00'::time, '18:00'::time),
        ('#RM-006', 1, '07:00'::time, '18:00'::time),
        ('#RM-006', 2, '07:00'::time, '18:00'::time),
        ('#RM-006', 3, '07:00'::time, '18:00'::time),
        ('#RM-006', 4, '07:00'::time, '18:00'::time),
        ('#RM-006', 5, '07:00'::time, '18:00'::time),
        ('#RM-007', 1, '07:00'::time, '18:00'::time),
        ('#RM-007', 2, '07:00'::time, '18:00'::time),
        ('#RM-007', 3, '07:00'::time, '18:00'::time),
        ('#RM-007', 4, '07:00'::time, '18:00'::time),
        ('#RM-007', 5, '07:00'::time, '18:00'::time)
) as source(room_id, day_of_week, start_time, end_time)
on conflict (room_id, day_of_week, start_time, end_time) do nothing;

insert into public.meetings (id, name, meeting_date, location, capacity, status)
values
    ('#CONF-001', 'Weekly Operations Sync', '2026-10-12', 'Meeting Room A', 10, 'Active'),
    ('#CONF-002', 'Design Workshop', '2026-10-15', 'Training Room 1', 20, 'Active'),
    ('#CONF-003', 'Board Strategy Review', '2026-11-01', 'Board Room', 12, 'Active')
on conflict (id) do nothing;
