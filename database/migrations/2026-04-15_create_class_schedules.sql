CREATE TABLE IF NOT EXISTS class_schedules (
    schedule_id SERIAL PRIMARY KEY,
    organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    class_id INT NOT NULL REFERENCES classes(class_id) ON DELETE CASCADE,
    school_year_id INT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
    term_id INT NOT NULL REFERENCES terms(term_id) ON DELETE CASCADE,
    reused_from_schedule_id INT REFERENCES class_schedules(schedule_id) ON DELETE SET NULL,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    updated_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, class_id, school_year_id, term_id)
);

CREATE TABLE IF NOT EXISTS class_schedule_entries (
    entry_id SERIAL PRIMARY KEY,
    schedule_id INT NOT NULL REFERENCES class_schedules(schedule_id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    subject_id INT REFERENCES subjects(subject_id) ON DELETE SET NULL,
    row_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT class_schedule_entries_day_check CHECK (day_of_week BETWEEN 1 AND 7),
    CONSTRAINT class_schedule_entries_time_check CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_class_schedules_org_class_term
    ON class_schedules (organization_id, class_id, term_id);

CREATE INDEX IF NOT EXISTS idx_class_schedule_entries_schedule_day_time
    ON class_schedule_entries (schedule_id, day_of_week, start_time, row_order);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'update_modified_column'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger WHERE tgname = 'update_class_schedules_modtime'
        ) THEN
            CREATE TRIGGER update_class_schedules_modtime
                BEFORE UPDATE ON class_schedules
                FOR EACH ROW
                EXECUTE FUNCTION update_modified_column();
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger WHERE tgname = 'update_class_schedule_entries_modtime'
        ) THEN
            CREATE TRIGGER update_class_schedule_entries_modtime
                BEFORE UPDATE ON class_schedule_entries
                FOR EACH ROW
                EXECUTE FUNCTION update_modified_column();
        END IF;
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'class_schedule_entries_day_check'
          AND table_name = 'class_schedule_entries'
    ) THEN
        ALTER TABLE class_schedule_entries DROP CONSTRAINT class_schedule_entries_day_check;
    END IF;

    ALTER TABLE class_schedule_entries
        ADD CONSTRAINT class_schedule_entries_day_check CHECK (day_of_week BETWEEN 1 AND 7);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;