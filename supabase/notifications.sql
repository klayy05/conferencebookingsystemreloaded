alter table if exists public.employees
add column if not exists phone_number text;

insert into public.employees (id, name, email, phone_number, role, status, joined_at, password_hash)
values (
    '#USR-006',
    'Philip Obese',
    'philip.0@gnpcghana.com',
    '+233538218158',
    'User',
    'Active',
    '2026-03-24',
    '707a4218449e343592f9bee67e8a451e2545af33e319a6bc3b3306a71ac68585'
)
on conflict (id) do nothing;

insert into public.employees (id, name, email, phone_number, role, status, joined_at, password_hash)
values (
    '#USR-007',
    'Mark Afedi',
    'mark.a@gnpcghana.com',
    '+233554198272',
    'User',
    'Active',
    '2026-03-24',
    '707a4218449e343592f9bee67e8a451e2545af33e319a6bc3b3306a71ac68585'
)
on conflict (id) do nothing;

update public.employees
set phone_number = data.phone_number
from (
    values
        ('#USR-001', '+233201111111'),
        ('#USR-002', '+233202222222'),
        ('#USR-003', '+233203333333'),
        ('#USR-004', '+233204444444'),
        ('#USR-005', '+233205555555'),
        ('#USR-006', '+233538218158'),
        ('#USR-007', '+233554198272')
) as data(id, phone_number)
where public.employees.id = data.id
  and (public.employees.phone_number is null or public.employees.phone_number = '');

create table if not exists public.notifications (
    id text primary key,
    booking_id text not null references public.bookings(id) on delete cascade,
    employee_id text not null references public.employees(id) on delete cascade,
    channel text not null check (channel in ('email', 'sms')),
    notification_type text not null check (notification_type in ('booking_confirmation', 'meeting_reminder')),
    scheduled_for timestamptz not null,
    status text not null check (status in ('pending', 'sent', 'failed', 'skipped')),
    provider_message_id text,
    last_error text,
    payload jsonb not null default '{}'::jsonb,
    sent_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists idx_notifications_status_scheduled_for
on public.notifications(status, scheduled_for);

create index if not exists idx_notifications_booking_id
on public.notifications(booking_id);
