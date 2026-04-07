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