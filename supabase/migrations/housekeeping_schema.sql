CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  email text,
  role text NOT NULL CHECK (role IN ('manager', 'supervisor', 'attendant', 'houseman', 'public_area', 'ra')),
  name text,
  is_preregistered boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_preregistered boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique ON public.profiles (email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.rooms (
  room_number int PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('dirty', 'in_progress', 'pending_inspection', 'released')),
  task text CHECK (task IN ('checkout', 'stay', 'vip_stay', 'linen_change', 'full_service')),
  post_release_request text CHECK (post_release_request IN ('houseman', 'public_area')),
  post_release_request_details jsonb,
  post_release_request_rush boolean NOT NULL DEFAULT false,
  post_release_request_claimed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  post_release_request_claimed_at timestamptz,
  dnd boolean NOT NULL DEFAULT false,
  dnd_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  dnd_at timestamptz,
  inspected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  released_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  released_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS task text;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS post_release_request text;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS post_release_request_details jsonb;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS post_release_request_rush boolean NOT NULL DEFAULT false;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS post_release_request_claimed_by uuid;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS post_release_request_claimed_at timestamptz;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS dnd boolean NOT NULL DEFAULT false;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS dnd_by uuid;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS dnd_at timestamptz;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS inspected_by uuid;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS released_by uuid;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS released_at timestamptz;

ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_task_check;
ALTER TABLE public.rooms
ADD CONSTRAINT rooms_task_check CHECK (task IN ('checkout', 'stay', 'vip_stay', 'linen_change', 'full_service'));

ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_post_release_request_check;
ALTER TABLE public.rooms
ADD CONSTRAINT rooms_post_release_request_check CHECK (post_release_request IN ('houseman', 'public_area'));

ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_inspected_by_fkey;
ALTER TABLE public.rooms
ADD CONSTRAINT rooms_inspected_by_fkey FOREIGN KEY (inspected_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_released_by_fkey;
ALTER TABLE public.rooms
ADD CONSTRAINT rooms_released_by_fkey FOREIGN KEY (released_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_dnd_by_fkey;
ALTER TABLE public.rooms
ADD CONSTRAINT rooms_dnd_by_fkey FOREIGN KEY (dnd_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_post_release_request_claimed_by_fkey;
ALTER TABLE public.rooms
ADD CONSTRAINT rooms_post_release_request_claimed_by_fkey FOREIGN KEY (post_release_request_claimed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rooms_set_updated_at ON public.rooms;
CREATE TRIGGER rooms_set_updated_at
BEFORE UPDATE ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO anon;
GRANT INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO authenticated;

CREATE TABLE IF NOT EXISTS public.room_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_number int NOT NULL REFERENCES public.rooms(room_number) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task text NOT NULL CHECK (task IN ('checkout', 'stay', 'vip_stay', 'linen_change', 'full_service')),
  started_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  expected_minutes numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.room_work ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.room_work TO authenticated;
GRANT DELETE ON public.room_work TO authenticated;

CREATE TABLE IF NOT EXISTS public.work_days (
  work_date date PRIMARY KEY,
  archived_at timestamptz NOT NULL DEFAULT now(),
  timezone text NOT NULL DEFAULT 'Australia/Sydney',
  rooms_count int NOT NULL DEFAULT 0,
  room_work_count int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.work_history_rooms (
  work_date date NOT NULL REFERENCES public.work_days(work_date) ON DELETE CASCADE,
  room_number int NOT NULL,
  status text NOT NULL,
  task text,
  post_release_request text,
  post_release_request_details jsonb,
  post_release_request_rush boolean NOT NULL DEFAULT false,
  post_release_request_claimed_by uuid,
  post_release_request_claimed_at timestamptz,
  dnd boolean NOT NULL DEFAULT false,
  dnd_by uuid,
  dnd_at timestamptz,
  assigned_to uuid,
  inspected_by uuid,
  released_by uuid,
  released_at timestamptz,
  updated_at timestamptz,
  PRIMARY KEY (work_date, room_number)
);

CREATE TABLE IF NOT EXISTS public.work_history_room_work (
  work_date date NOT NULL REFERENCES public.work_days(work_date) ON DELETE CASCADE,
  id uuid NOT NULL,
  room_number int NOT NULL,
  staff_id uuid NOT NULL,
  task text NOT NULL,
  started_at timestamptz NOT NULL,
  done_at timestamptz,
  expected_minutes numeric NOT NULL,
  created_at timestamptz,
  PRIMARY KEY (work_date, id)
);

ALTER TABLE public.work_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_history_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_history_room_work ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.work_days TO authenticated;
GRANT SELECT ON public.work_history_rooms TO authenticated;
GRANT SELECT ON public.work_history_room_work TO authenticated;

CREATE OR REPLACE FUNCTION public.app_current_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.claim_post_release_request(p_room_number int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  role_name := public.app_current_role();
  IF role_name NOT IN ('houseman', 'public_area') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.rooms
  SET
    post_release_request_claimed_by = auth.uid(),
    post_release_request_claimed_at = now()
  WHERE
    room_number = p_room_number
    AND status = 'released'
    AND post_release_request = role_name
    AND post_release_request_claimed_by IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not claimable';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_post_release_request(p_room_number int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  role_name := public.app_current_role();
  IF role_name NOT IN ('houseman', 'public_area') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.rooms
  SET
    post_release_request = NULL,
    post_release_request_details = NULL,
    post_release_request_rush = false,
    post_release_request_claimed_by = NULL,
    post_release_request_claimed_at = NULL
  WHERE
    room_number = p_room_number
    AND status = 'released'
    AND post_release_request = role_name
    AND (post_release_request_claimed_by IS NULL OR post_release_request_claimed_by = auth.uid());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_post_release_request(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_post_release_request(int) TO authenticated;

DROP POLICY IF EXISTS work_days_select_admin ON public.work_days;
CREATE POLICY work_days_select_admin
ON public.work_days
FOR SELECT
TO authenticated
USING (public.app_current_role() IN ('manager', 'supervisor'));

DROP POLICY IF EXISTS work_history_rooms_select_admin ON public.work_history_rooms;
CREATE POLICY work_history_rooms_select_admin
ON public.work_history_rooms
FOR SELECT
TO authenticated
USING (public.app_current_role() IN ('manager', 'supervisor'));

DROP POLICY IF EXISTS work_history_room_work_select_admin ON public.work_history_room_work;
CREATE POLICY work_history_room_work_select_admin
ON public.work_history_room_work
FOR SELECT
TO authenticated
USING (public.app_current_role() IN ('manager', 'supervisor'));

CREATE OR REPLACE FUNCTION public.archive_and_reset_daily(p_timezone text DEFAULT 'Australia/Sydney')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tz text := COALESCE(NULLIF(p_timezone, ''), 'Australia/Sydney');
  local_now timestamp := (now() AT TIME ZONE tz);
  local_day_start timestamp := date_trunc('day', local_now);
  day_start timestamptz := local_day_start AT TIME ZONE tz;
  target_work_date date := (local_day_start - interval '1 day')::date;
  rooms_n int;
  work_n int;
BEGIN
  IF auth.uid() IS NOT NULL AND public.app_current_role() NOT IN ('manager', 'supervisor') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF extract(hour from local_now) <> 0 OR extract(minute from local_now) >= 10 THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.work_days d WHERE d.work_date = target_work_date) THEN
    RETURN;
  END IF;

  SELECT count(*) INTO rooms_n FROM public.rooms;
  SELECT count(*) INTO work_n FROM public.room_work WHERE started_at < day_start;

  INSERT INTO public.work_days (work_date, archived_at, timezone, rooms_count, room_work_count)
  VALUES (target_work_date, now(), tz, rooms_n, work_n);

  INSERT INTO public.work_history_rooms (
    work_date, room_number, status, task, post_release_request, post_release_request_details, post_release_request_rush,
    post_release_request_claimed_by, post_release_request_claimed_at,
    dnd, dnd_by, dnd_at,
    assigned_to, inspected_by, released_by, released_at, updated_at
  )
  SELECT
    target_work_date,
    r.room_number,
    r.status,
    r.task,
    r.post_release_request,
    r.post_release_request_details,
    COALESCE(r.post_release_request_rush, false),
    r.post_release_request_claimed_by,
    r.post_release_request_claimed_at,
    COALESCE(r.dnd, false),
    r.dnd_by,
    r.dnd_at,
    r.assigned_to,
    r.inspected_by,
    r.released_by,
    r.released_at,
    r.updated_at
  FROM public.rooms r
  ON CONFLICT (work_date, room_number) DO UPDATE SET
    status = EXCLUDED.status,
    task = EXCLUDED.task,
    post_release_request = EXCLUDED.post_release_request,
    post_release_request_details = EXCLUDED.post_release_request_details,
    post_release_request_rush = EXCLUDED.post_release_request_rush,
    post_release_request_claimed_by = EXCLUDED.post_release_request_claimed_by,
    post_release_request_claimed_at = EXCLUDED.post_release_request_claimed_at,
    dnd = EXCLUDED.dnd,
    dnd_by = EXCLUDED.dnd_by,
    dnd_at = EXCLUDED.dnd_at,
    assigned_to = EXCLUDED.assigned_to,
    inspected_by = EXCLUDED.inspected_by,
    released_by = EXCLUDED.released_by,
    released_at = EXCLUDED.released_at,
    updated_at = EXCLUDED.updated_at;

  INSERT INTO public.work_history_room_work (
    work_date, id, room_number, staff_id, task, started_at, done_at, expected_minutes, created_at
  )
  SELECT
    target_work_date,
    w.id,
    w.room_number,
    w.staff_id,
    w.task,
    w.started_at,
    w.done_at,
    w.expected_minutes,
    w.created_at
  FROM public.room_work w
  WHERE w.started_at < day_start
  ON CONFLICT (work_date, id) DO NOTHING;

  DELETE FROM public.room_work WHERE started_at < day_start;
  DELETE FROM public.rooms;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_and_reset_daily(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_and_reset_daily(text) TO authenticated;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
ON public.profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

DROP POLICY IF EXISTS profiles_select_admin ON public.profiles;
CREATE POLICY profiles_select_admin
ON public.profiles
FOR SELECT
TO authenticated
USING (public.app_current_role() IN ('manager', 'supervisor'));

DROP POLICY IF EXISTS profiles_select_leadership ON public.profiles;
CREATE POLICY profiles_select_leadership
ON public.profiles
FOR SELECT
TO authenticated
USING (role IN ('manager', 'supervisor'));

DROP POLICY IF EXISTS profiles_select_preregistered_public ON public.profiles;
CREATE POLICY profiles_select_preregistered_public
ON public.profiles
FOR SELECT
TO anon
USING (is_preregistered = true);

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_insert_staff_admin ON public.profiles;
CREATE POLICY profiles_insert_staff_admin
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  (
    public.app_current_role() = 'manager'
    AND role IN ('supervisor', 'attendant', 'ra', 'houseman', 'public_area')
  )
  OR (
    public.app_current_role() = 'supervisor'
    AND role IN ('attendant', 'ra', 'houseman', 'public_area')
  )
);

DROP POLICY IF EXISTS profiles_update_staff_admin ON public.profiles;
CREATE POLICY profiles_update_staff_admin
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  (
    public.app_current_role() = 'manager'
    AND role IN ('supervisor', 'attendant', 'ra', 'houseman', 'public_area')
  )
  OR (
    public.app_current_role() = 'supervisor'
    AND role IN ('attendant', 'ra', 'houseman', 'public_area')
  )
)
WITH CHECK (role IN ('supervisor', 'attendant', 'ra', 'houseman', 'public_area'));

DROP POLICY IF EXISTS profiles_update_claim_preregistered ON public.profiles;
CREATE POLICY profiles_update_claim_preregistered
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  is_preregistered = true
  AND email = current_setting('request.jwt.claim.email', true)
  AND role IN ('attendant', 'ra', 'houseman', 'public_area')
)
WITH CHECK (
  id = auth.uid()
  AND is_preregistered = false
  AND email = current_setting('request.jwt.claim.email', true)
  AND role IN ('attendant', 'ra', 'houseman', 'public_area')
);

DROP POLICY IF EXISTS rooms_select_by_role_or_assignment ON public.rooms;
CREATE POLICY rooms_select_by_role_or_assignment
ON public.rooms
FOR SELECT
TO authenticated
USING (
  public.app_current_role() IN ('manager', 'supervisor')
  OR assigned_to = auth.uid()
  OR (
    status = 'released'
    AND post_release_request IS NOT NULL
    AND post_release_request = public.app_current_role()
    AND public.app_current_role() IN ('houseman', 'public_area')
    AND (
      post_release_request_claimed_by IS NULL
      OR post_release_request_claimed_by = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS rooms_insert_manager ON public.rooms;
CREATE POLICY rooms_insert_manager
ON public.rooms
FOR INSERT
TO authenticated
WITH CHECK (public.app_current_role() = 'manager');

DROP POLICY IF EXISTS rooms_insert_manager_or_supervisor ON public.rooms;
CREATE POLICY rooms_insert_manager_or_supervisor
ON public.rooms
FOR INSERT
TO authenticated
WITH CHECK (public.app_current_role() IN ('manager', 'supervisor'));

DROP POLICY IF EXISTS rooms_delete_manager ON public.rooms;
CREATE POLICY rooms_delete_manager
ON public.rooms
FOR DELETE
TO authenticated
USING (public.app_current_role() IN ('manager', 'supervisor'));

DROP POLICY IF EXISTS rooms_update_manager_any ON public.rooms;
CREATE POLICY rooms_update_manager_any
ON public.rooms
FOR UPDATE
TO authenticated
USING (public.app_current_role() = 'manager')
WITH CHECK (public.app_current_role() = 'manager' AND (status <> 'released' OR task = 'checkout'));

DROP POLICY IF EXISTS rooms_update_supervisor_assign_only ON public.rooms;
CREATE POLICY rooms_update_supervisor_assign_only
ON public.rooms
FOR UPDATE
TO authenticated
USING (public.app_current_role() = 'supervisor')
WITH CHECK (
  public.app_current_role() = 'supervisor'
  AND status = (SELECT r.status FROM public.rooms r WHERE r.room_number = rooms.room_number)
);

DROP POLICY IF EXISTS rooms_update_supervisor_release ON public.rooms;
CREATE POLICY rooms_update_supervisor_release
ON public.rooms
FOR UPDATE
TO authenticated
USING (
  public.app_current_role() = 'supervisor'
  AND status = 'pending_inspection'
  AND task = 'checkout'
  AND inspected_by = auth.uid()
)
WITH CHECK (
  status = 'released'
  AND released_by = auth.uid()
  AND assigned_to = (SELECT r.assigned_to FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND inspected_by = auth.uid()
  AND inspected_by = (SELECT r.inspected_by FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND task = 'checkout'
  AND task = (SELECT r.task FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND (post_release_request IS NULL OR post_release_request IN ('houseman', 'public_area'))
);

DROP POLICY IF EXISTS rooms_update_clear_post_release_request ON public.rooms;
CREATE POLICY rooms_update_clear_post_release_request
ON public.rooms
FOR UPDATE
TO authenticated
USING (
  public.app_current_role() IN ('houseman', 'public_area')
  AND status = 'released'
  AND post_release_request = public.app_current_role()
  AND (
    post_release_request_claimed_by IS NULL
    OR post_release_request_claimed_by = auth.uid()
  )
)
WITH CHECK (
  status = (SELECT r.status FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND assigned_to = (SELECT r.assigned_to FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND inspected_by = (SELECT r.inspected_by FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND released_by = (SELECT r.released_by FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND released_at = (SELECT r.released_at FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND task = (SELECT r.task FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND post_release_request IS NULL
  AND post_release_request_details IS NULL
  AND post_release_request_rush = false
  AND post_release_request_claimed_by IS NULL
  AND post_release_request_claimed_at IS NULL
);

DROP POLICY IF EXISTS rooms_update_claim_post_release_request ON public.rooms;
CREATE POLICY rooms_update_claim_post_release_request
ON public.rooms
FOR UPDATE
TO authenticated
USING (
  public.app_current_role() IN ('houseman', 'public_area')
  AND status = 'released'
  AND post_release_request = public.app_current_role()
  AND post_release_request_claimed_by IS NULL
)
WITH CHECK (
  status = (SELECT r.status FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND assigned_to = (SELECT r.assigned_to FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND inspected_by IS NOT DISTINCT FROM (SELECT r.inspected_by FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND released_by IS NOT DISTINCT FROM (SELECT r.released_by FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND released_at IS NOT DISTINCT FROM (SELECT r.released_at FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND task IS NOT DISTINCT FROM (SELECT r.task FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND post_release_request = (SELECT r.post_release_request FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND post_release_request_details IS NOT DISTINCT FROM (SELECT r.post_release_request_details FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND post_release_request_rush IS NOT DISTINCT FROM (SELECT r.post_release_request_rush FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND post_release_request_claimed_by = auth.uid()
  AND post_release_request_claimed_at IS NOT NULL
);

DROP POLICY IF EXISTS rooms_update_supervisor_override_post_release_request ON public.rooms;
CREATE POLICY rooms_update_supervisor_override_post_release_request
ON public.rooms
FOR UPDATE
TO authenticated
USING (
  public.app_current_role() = 'supervisor'
  AND status = 'released'
  AND inspected_by = auth.uid()
  AND post_release_request IN ('houseman', 'public_area')
)
WITH CHECK (
  status = (SELECT r.status FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND assigned_to = (SELECT r.assigned_to FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND inspected_by = auth.uid()
  AND released_by = (SELECT r.released_by FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND released_at = (SELECT r.released_at FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND task = (SELECT r.task FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND post_release_request IS NULL
  AND post_release_request_details IS NULL
  AND post_release_request_rush = false
  AND post_release_request_claimed_by IS NULL
  AND post_release_request_claimed_at IS NULL
);

DROP POLICY IF EXISTS rooms_update_staff_dirty_to_in_progress ON public.rooms;
CREATE POLICY rooms_update_staff_dirty_to_in_progress
ON public.rooms
FOR UPDATE
TO authenticated
USING (
  public.app_current_role() IN ('attendant', 'houseman', 'public_area', 'ra', 'supervisor')
  AND assigned_to = auth.uid()
  AND status = 'dirty'
  AND dnd = false
)
WITH CHECK (
  assigned_to = auth.uid()
  AND status = 'in_progress'
  AND dnd = false
);

DROP POLICY IF EXISTS rooms_update_staff_in_progress_to_pending ON public.rooms;
CREATE POLICY rooms_update_staff_in_progress_to_pending
ON public.rooms
FOR UPDATE
TO authenticated
USING (
  public.app_current_role() IN ('attendant', 'houseman', 'public_area', 'ra', 'supervisor')
  AND assigned_to = auth.uid()
  AND status = 'in_progress'
  AND dnd = false
)
WITH CHECK (
  assigned_to = auth.uid()
  AND status = 'pending_inspection'
  AND dnd = false
);

DROP POLICY IF EXISTS rooms_update_mark_dnd ON public.rooms;
CREATE POLICY rooms_update_mark_dnd
ON public.rooms
FOR UPDATE
TO authenticated
USING (
  public.app_current_role() IN ('attendant', 'houseman', 'public_area', 'ra', 'supervisor')
  AND assigned_to = auth.uid()
  AND status = 'dirty'
  AND dnd = false
  AND task IN ('stay', 'vip_stay', 'linen_change', 'full_service')
)
WITH CHECK (
  status = (SELECT r.status FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND assigned_to = auth.uid()
  AND inspected_by IS NOT DISTINCT FROM (SELECT r.inspected_by FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND released_by IS NOT DISTINCT FROM (SELECT r.released_by FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND released_at IS NOT DISTINCT FROM (SELECT r.released_at FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND task IS NOT DISTINCT FROM (SELECT r.task FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND post_release_request IS NOT DISTINCT FROM (SELECT r.post_release_request FROM public.rooms r WHERE r.room_number = rooms.room_number)
  AND dnd = true
  AND dnd_by = auth.uid()
  AND dnd_at IS NOT NULL
);

DROP POLICY IF EXISTS room_work_select_staff_or_admin ON public.room_work;
CREATE POLICY room_work_select_staff_or_admin
ON public.room_work
FOR SELECT
TO authenticated
USING (staff_id = auth.uid() OR public.app_current_role() IN ('manager', 'supervisor'));

DROP POLICY IF EXISTS room_work_insert_own ON public.room_work;
CREATE POLICY room_work_insert_own
ON public.room_work
FOR INSERT
TO authenticated
WITH CHECK (staff_id = auth.uid());

DROP POLICY IF EXISTS room_work_update_own_done_at ON public.room_work;
CREATE POLICY room_work_update_own_done_at
ON public.room_work
FOR UPDATE
TO authenticated
USING (staff_id = auth.uid())
WITH CHECK (staff_id = auth.uid());

DROP POLICY IF EXISTS room_work_update_admin ON public.room_work;
CREATE POLICY room_work_update_admin
ON public.room_work
FOR UPDATE
TO authenticated
USING (public.app_current_role() IN ('manager', 'supervisor'))
WITH CHECK (public.app_current_role() IN ('manager', 'supervisor'));

DROP POLICY IF EXISTS room_work_delete_admin ON public.room_work;
CREATE POLICY room_work_delete_admin
ON public.room_work
FOR DELETE
TO authenticated
USING (public.app_current_role() IN ('manager', 'supervisor'));

