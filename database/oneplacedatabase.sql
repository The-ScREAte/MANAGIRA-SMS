-- Drop all tables to ensure a clean slate
DO $$ DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema()) LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
END $$;

-- Drop all types to avoid conflicts
DO $$ DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT n.nspname as schema, t.typname as type
              FROM pg_type t
              LEFT JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
              WHERE (t.typname = 'user_role' OR t.typname = 'application_status' OR t.typname = 'attendance_status')
              AND (n.nspname NOT IN ('pg_catalog', 'information_schema'))) LOOP
        EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.schema) || '.' || quote_ident(r.type) || ' CASCADE';
    END LOOP;
END $$;

-- Create ENUM types for user roles, application status, and attendance status
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('Admin', 'Mini Admin', 'Manager', 'Supervisor', 'Teacher');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE application_status AS ENUM ('Pending', 'Approved', 'Declined');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE attendance_status AS ENUM ('Present', 'Absent');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Organizations Table
CREATE TABLE IF NOT EXISTS organizations (
    organization_id SERIAL PRIMARY KEY,
    organization_name VARCHAR(255) NOT NULL,
    organization_address VARCHAR(255) NOT NULL,
    organization_phone VARCHAR(15),
    subdomain VARCHAR(64) UNIQUE, -- <--- Added for per-org subdomain
    proof_of_existence_1 VARCHAR(255) NOT NULL,
    proof_of_existence_2 VARCHAR(255),
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    approved BOOLEAN DEFAULT false,
    on_hold BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    review_timestamp TIMESTAMP WITH TIME ZONE,
    deleted BOOLEAN DEFAULT false,
    logo_path VARCHAR(255),
    font_style VARCHAR(50)
);

CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now(); 
    RETURN NEW; 
END;
$$ LANGUAGE 'plpgsql';

CREATE TRIGGER update_organizations_modtime
    BEFORE UPDATE ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- Graduation Year Groups Table
CREATE TABLE IF NOT EXISTS graduation_year_groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE
);

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    account_type user_role NOT NULL,
    date_of_birth DATE,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    on_hold BOOLEAN DEFAULT FALSE
);

CREATE TRIGGER update_users_modtime
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- Classes Table
CREATE TABLE IF NOT EXISTS classes (
    class_id SERIAL PRIMARY KEY,
    class_name VARCHAR(255) NOT NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    graduation_year_group_id INT REFERENCES graduation_year_groups(id)
);

-- Subjects Table
CREATE TABLE IF NOT EXISTS subjects (
    subject_id SERIAL PRIMARY KEY,
    subject_name VARCHAR(255) NOT NULL,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    grad_year_group_id INT REFERENCES graduation_year_groups(id) ON DELETE CASCADE
);

-- Students Table
CREATE TABLE IF NOT EXISTS students (
    student_id SERIAL PRIMARY KEY,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    date_of_birth DATE,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    height DECIMAL(5,2),
    hometown VARCHAR(255),
    image_url VARCHAR(255),
    age INTEGER,
    total_percentage DECIMAL(5,2),
    grade VARCHAR(2),
    gender VARCHAR(10)
);

-- Guardians Table
CREATE TABLE IF NOT EXISTS guardians (
    guardian_id SERIAL PRIMARY KEY,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    address VARCHAR(255),
    phone VARCHAR(15),
    date_of_birth DATE,
    hometown VARCHAR(255),
    image_url VARCHAR(255),
    student_id INT REFERENCES students(student_id) ON DELETE CASCADE,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    CONSTRAINT unique_student_guardian UNIQUE (student_id, first_name)
);

-- Student_Subjects Table (many-to-many relationship)
CREATE TABLE IF NOT EXISTS student_subjects (
    student_id INT NOT NULL,
    subject_id INT NOT NULL,
    grade VARCHAR(255),
    PRIMARY KEY (student_id, subject_id),
    FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
    FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE
);

-- Assessments Table
CREATE TABLE IF NOT EXISTS assessments (
    assessment_id SERIAL PRIMARY KEY,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    subject_id INT REFERENCES subjects(subject_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    weight NUMERIC,
    category VARCHAR(50)
);

-- Assessment Results Table
CREATE TABLE IF NOT EXISTS assessment_results (
    result_id SERIAL PRIMARY KEY,
    assessment_id INT REFERENCES assessments(assessment_id) ON DELETE CASCADE,
    student_id INT REFERENCES students(student_id) ON DELETE CASCADE,
    score DECIMAL(5,2),
    grade VARCHAR(2),
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    title VARCHAR(255),
    total_subject_score NUMERIC(10, 2),
    total_percentage NUMERIC(5, 2),
    position INTEGER,
    category VARCHAR(50),
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE
);

-- Attendance Records Table
CREATE TABLE IF NOT EXISTS attendance_records (
    attendance_id SERIAL PRIMARY KEY,
    student_id INT REFERENCES students(student_id) ON DELETE CASCADE,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status attendance_status,
    marked_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    marked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, date)
);

CREATE TRIGGER update_attendance_modtime
    BEFORE UPDATE ON attendance_records
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- Admins Table
CREATE TABLE IF NOT EXISTS admins (
    admin_id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE
);

-- Announcements Table
CREATE TABLE IF NOT EXISTS announcements (
    announcement_id SERIAL PRIMARY KEY,
    message TEXT NOT NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    visibility VARCHAR(10) DEFAULT 'both'
);

-- School Events Table
CREATE TABLE IF NOT EXISTS school_events (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    event_date DATE,
    details TEXT,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    visibility VARCHAR(10) DEFAULT 'both'
);

-- School Years Table
CREATE TABLE IF NOT EXISTS school_years (
    id SERIAL PRIMARY KEY,
    year_label VARCHAR(255) NOT NULL,
    current BOOLEAN DEFAULT FALSE,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Terms Table
CREATE TABLE IF NOT EXISTS terms (
    term_id SERIAL PRIMARY KEY,
    school_year_id INT NOT NULL REFERENCES school_years(id),
    term_name VARCHAR(255) NOT NULL,
    start_date DATE,
    end_date DATE,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    year_id INT,
    current BOOLEAN DEFAULT FALSE
);

-- Term Classes Table (many-to-many relationship between terms and classes)
CREATE TABLE IF NOT EXISTS term_classes (
    term_id INT NOT NULL,
    class_id INT NOT NULL,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    PRIMARY KEY (term_id, class_id),
    FOREIGN KEY (term_id) REFERENCES terms(term_id) ON DELETE CASCADE,
    FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE CASCADE
);

-- Organization Texts Table
CREATE TABLE IF NOT EXISTS organization_texts (
    text_id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL,
    heading TEXT NOT NULL,
    paragraph TEXT NOT NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id)
);

-- Users Classes Table
CREATE TABLE IF NOT EXISTS user_classes (
    user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, class_id),
    main BOOLEAN DEFAULT FALSE
);

-- Users Subjects Table
CREATE TABLE IF NOT EXISTS user_subjects (
    user_id INTEGER REFERENCES users(user_id),
    subject_id INTEGER REFERENCES subjects(subject_id),
    PRIMARY KEY (user_id, subject_id)
);

-- Student Positions Table
CREATE TABLE IF NOT EXISTS student_positions (
    position_id SERIAL PRIMARY KEY,
    student_id INT REFERENCES students(student_id) ON DELETE CASCADE,
    subject_id INT REFERENCES subjects(subject_id) ON DELETE CASCADE,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    total_subject_score NUMERIC(10, 2),
    position INT,
    class_id INT REFERENCES classes(class_id),
    category VARCHAR(255),
    UNIQUE (student_id, subject_id, category)
);

-- Category Scores Table
CREATE TABLE IF NOT EXISTS category_scores (
    category_score_id SERIAL PRIMARY KEY,
    student_id INT REFERENCES students(student_id) ON DELETE CASCADE,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    subject_id INT REFERENCES subjects(subject_id) ON DELETE CASCADE,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    category VARCHAR(50),
    total_score DECIMAL(10, 2) DEFAULT 0,
    term_id INT,  -- This already exists
    UNIQUE (student_id, class_id, subject_id, category, organization_id)
);

-- Status Settings Table
CREATE TABLE IF NOT EXISTS status_settings (
    id SERIAL PRIMARY KEY,
    organization_id INT NOT NULL,
    cut_off_point INT,
    promoted_class VARCHAR(255),
    repeated_class VARCHAR(255),
    school_reopen_date DATE,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    activate_promotion BOOLEAN DEFAULT false,
    term_id INT,
    CONSTRAINT unique_org_class UNIQUE (organization_id, class_id)
);


-- Score Remarks Table
CREATE TABLE IF NOT EXISTS score_remarks (
    id SERIAL PRIMARY KEY,
    organization_id INT NOT NULL,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE,
    remark TEXT NOT NULL,
    from_percentage NUMERIC,
    to_percentage NUMERIC,
    CONSTRAINT unique_organization_class_score UNIQUE (organization_id, class_id, remark)
);

-- Organization Images Table
CREATE TABLE IF NOT EXISTS organization_images (
    image_id SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(organization_id),
    image_url TEXT NOT NULL,
    caption TEXT,
    allocation VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS report_settings (
    setting_id SERIAL PRIMARY KEY,
    organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
    signature_image_path VARCHAR(255), -- Path to the signature image
    class_id INT REFERENCES classes(class_id) ON DELETE CASCADE -- You can add additional columns as needed
);


-- Ensure indexes for optimization
CREATE INDEX IF NOT EXISTS idx_user_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_org_name ON organizations (organization_name);
CREATE INDEX IF NOT EXISTS idx_class_name ON classes (class_name);
CREATE INDEX IF NOT EXISTS idx_student_name ON students (first_name, last_name);

-- Update assessment_results to include category information from assessments (after table is created)
UPDATE assessment_results ar
SET category = a.category
FROM assessments a
WHERE ar.assessment_id = a.assessment_id;

-- Update assessment_results with assessment titles (after table is created)
UPDATE assessment_results ar
SET title = a.title
FROM assessments a
WHERE ar.assessment_id = a.assessment_id;

-- Additional ALTER statements (skip if column exists)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='terms' AND column_name='current_term') THEN
        ALTER TABLE terms ADD COLUMN current_term BOOLEAN DEFAULT false;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='assessment_results' AND column_name='total_category_score') THEN
        ALTER TABLE assessment_results ADD COLUMN total_category_score NUMERIC(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='assessment_results' AND column_name='term_id') THEN
        ALTER TABLE assessment_results ADD COLUMN term_id INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='category_scores' AND column_name='term_id') THEN
        ALTER TABLE category_scores ADD COLUMN term_id INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='students' AND column_name='term_id') THEN
        ALTER TABLE students ADD COLUMN term_id INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subjects' AND column_name='term_id') THEN
        ALTER TABLE subjects ADD COLUMN term_id INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='status_settings' AND column_name='term_id') THEN
        ALTER TABLE status_settings ADD COLUMN term_id INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_positions' AND column_name='term_id') THEN
        ALTER TABLE student_positions ADD COLUMN term_id INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_subjects' AND column_name='term_id') THEN
        ALTER TABLE student_subjects ADD COLUMN term_id INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='assessment_results' AND column_name='class_id') THEN
        ALTER TABLE assessment_results ADD COLUMN class_id INT;
    END IF;

    -- Add constraints if they don't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='fk_class' AND table_name='assessment_results') THEN
        ALTER TABLE assessment_results
        ADD CONSTRAINT fk_class
        FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_positions' AND column_name='total_category_score') THEN
        ALTER TABLE student_positions ADD COLUMN total_category_score NUMERIC(10, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_positions' AND column_name='class_id') THEN
        ALTER TABLE student_positions ADD COLUMN class_id INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_positions' AND column_name='category') THEN
        ALTER TABLE student_positions ADD COLUMN category VARCHAR(255);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='unique_student_subject_category' AND table_name='student_positions') THEN
        ALTER TABLE student_positions
        ADD CONSTRAINT unique_student_subject_category
        UNIQUE (student_id, subject_id, category);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='unique_student_class_subject_category_org' AND table_name='category_scores') THEN
        ALTER TABLE category_scores
        ADD CONSTRAINT unique_student_class_subject_category_org
        UNIQUE (student_id, class_id, subject_id, category, organization_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='score_remarks' AND column_name='class_id') THEN
        ALTER TABLE score_remarks ADD COLUMN class_id INT REFERENCES classes(class_id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='score_remarks' AND column_name='grade_label') THEN
        ALTER TABLE score_remarks ADD COLUMN grade_label TEXT;
    END IF;
END $$;

ALTER TABLE students ADD COLUMN graduation_year_group_id INT REFERENCES graduation_year_groups(id) ON DELETE SET NULL;
ALTER TABLE assessments ADD COLUMN max_score NUMERIC(5, 2);
-- Add class_id to the users table
ALTER TABLE users 
ADD COLUMN class_id INT REFERENCES classes(class_id) ON DELETE SET NULL;

ALTER TABLE organizations ADD COLUMN logo TEXT;
ALTER TABLE assessment_results ADD COLUMN subject_id INT REFERENCES subjects(subject_id);
 

ALTER TABLE assessments
ADD CONSTRAINT unique_class_subject_title UNIQUE (class_id, subject_id, title);


ALTER TABLE assessment_results ADD CONSTRAINT unique_student_assessment UNIQUE (student_id, assessment_id);
ALTER TABLE student_positions ADD CONSTRAINT unique_student_subject UNIQUE (student_id, subject_id);

ALTER TABLE assessments
ADD CONSTRAINT unique_assessment_title_subject UNIQUE (title, subject_id, organization_id);



CREATE TABLE enrollments (
    enrollment_id SERIAL PRIMARY KEY,
    school_year_id INTEGER REFERENCES school_years(id),
    term_id INTEGER REFERENCES terms(term_id),
    organization_id INTEGER REFERENCES organizations(organization_id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE enrolled_classes (
    enrolled_class_id SERIAL PRIMARY KEY,
    enrollment_id INTEGER REFERENCES enrollments(enrollment_id),
    class_id INTEGER REFERENCES classes(class_id)
);

CREATE TABLE enrolled_students (
    enrolled_student_id SERIAL PRIMARY KEY,
    enrollment_id INTEGER REFERENCES enrollments(enrollment_id),
    student_id INTEGER REFERENCES students(student_id),
    class_id INTEGER REFERENCES classes(class_id)
);

ALTER TABLE attendance_records
ADD COLUMN term_id INTEGER,
ADD CONSTRAINT fk_term
    FOREIGN KEY (term_id) 
    REFERENCES terms (term_id)
    ON DELETE CASCADE;

ALTER TABLE assessments
ADD COLUMN term_id integer;

ALTER TABLE assessments DROP CONSTRAINT unique_assessment_title_subject;
ALTER TABLE assessments ADD CONSTRAINT unique_assessment_title_class_subject UNIQUE (title, subject_id, class_id);
ALTER TABLE assessments ADD COLUMN group_id BIGINT;
CREATE SEQUENCE assessments_group_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER TABLE enrolled_students
DROP CONSTRAINT enrolled_students_student_id_fkey,
ADD CONSTRAINT enrolled_students_student_id_fkey
FOREIGN KEY (student_id)
REFERENCES students(student_id)
ON DELETE CASCADE;

ALTER TABLE organization_images ADD COLUMN slideshow_id INTEGER;
CREATE TABLE slideshows (
    slideshow_id SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(organization_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE organization_dashboard (
    organization_id INT PRIMARY KEY REFERENCES organizations(organization_id),
    order_data JSON NOT NULL
);
ALTER TABLE category_scores
ADD CONSTRAINT unique_category_score
UNIQUE (student_id, class_id, subject_id, organization_id, category, term_id);


ALTER TABLE status_settings 
ADD CONSTRAINT status_settings_unique UNIQUE (organization_id, class_id, term_id);

ALTER TABLE score_remarks 
ADD COLUMN term_id INTEGER,
ADD CONSTRAINT score_remarks_unique UNIQUE (organization_id, class_id, term_id, remark);

ALTER TABLE report_settings 
ADD COLUMN term_id INTEGER,
ADD CONSTRAINT report_settings_unique UNIQUE (organization_id, class_id, term_id);

ALTER TABLE status_settings
ADD UNIQUE (organization_id, class_id, term_id);


CREATE TABLE remarks (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL,
    remark TEXT NOT NULL,
    remark_type VARCHAR(20) NOT NULL CHECK (remark_type IN ('teacher', 'conduct', 'interest', 'attitude')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE status_settings ADD COLUMN term_end_date DATE;





ALTER TABLE organization_texts
DROP CONSTRAINT organization_texts_organization_id_fkey,
ADD CONSTRAINT organization_texts_organization_id_fkey
FOREIGN KEY (organization_id)
REFERENCES organizations (organization_id)
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE organization_images
DROP CONSTRAINT organization_images_organization_id_fkey,
ADD CONSTRAINT organization_images_organization_id_fkey
FOREIGN KEY (organization_id)
REFERENCES organizations (organization_id)
ON DELETE CASCADE;

ALTER TABLE enrollments
DROP CONSTRAINT enrollments_organization_id_fkey,
ADD CONSTRAINT enrollments_organization_id_fkey
FOREIGN KEY (organization_id)
REFERENCES organizations (organization_id)
ON DELETE CASCADE;

ALTER TABLE slideshows
DROP CONSTRAINT slideshows_organization_id_fkey,
ADD CONSTRAINT slideshows_organization_id_fkey
FOREIGN KEY (organization_id)
REFERENCES organizations (organization_id)
ON DELETE CASCADE;

ALTER TABLE user_subjects
DROP CONSTRAINT user_subjects_user_id_fkey,
ADD CONSTRAINT user_subjects_user_id_fkey
FOREIGN KEY (user_id)
REFERENCES users (user_id)
ON DELETE CASCADE;

ALTER TABLE enrolled_classes
DROP CONSTRAINT enrolled_classes_class_id_fkey,
ADD CONSTRAINT enrolled_classes_class_id_fkey
FOREIGN KEY (class_id)
REFERENCES classes (class_id)
ON DELETE CASCADE;

ALTER TABLE enrolled_students
DROP CONSTRAINT enrolled_students_class_id_fkey,
ADD CONSTRAINT enrolled_students_class_id_fkey
FOREIGN KEY (class_id)
REFERENCES classes (class_id)
ON DELETE CASCADE;

ALTER TABLE assessments ADD CONSTRAINT unique_test_per_term_class_subject 
UNIQUE (term_id, class_id, subject_id, organization_id, title);

 ALTER TYPE user_role ADD VALUE 'admin';
ALTER TYPE user_role ADD VALUE 'super_admin';
ALTER TABLE users ADD COLUMN username VARCHAR(255);
ALTER TABLE users ADD CONSTRAINT unique_username UNIQUE (username);

CREATE TABLE IF NOT EXISTS student_reports (
    id SERIAL PRIMARY KEY,
    organization_id INT NOT NULL,
    class_id INT NOT NULL,
    term_id INT NOT NULL,
    student_id INT NOT NULL,
    conduct_remarks TEXT,
    attitude_remarks TEXT,
    interest_remarks TEXT,
    teacher_remarks TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_report UNIQUE (organization_id, class_id, term_id, student_id)
);

-- Table for threads
CREATE TABLE help_threads (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    organization VARCHAR(255),
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    is_resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Table for messages within threads
CREATE TABLE help_messages (
    id SERIAL PRIMARY KEY,
    thread_id INT REFERENCES help_threads(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    organization VARCHAR(255),
    phone VARCHAR(20),
    email VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table for responses to messages
CREATE TABLE help_responses (
    id SERIAL PRIMARY KEY,
    help_message_id INT REFERENCES help_messages(id) ON DELETE CASCADE,
    response TEXT NOT NULL,
    responder_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE help_messages
ADD COLUMN is_response BOOLEAN DEFAULT FALSE;
ALTER TABLE help_threads
ADD COLUMN last_updated TIMESTAMP DEFAULT NOW();

CREATE OR REPLACE FUNCTION update_thread_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE help_threads
  SET last_updated = NOW()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_thread_timestamp_trigger
AFTER INSERT OR UPDATE ON help_messages
FOR EACH ROW
EXECUTE FUNCTION update_thread_timestamp();

ALTER TABLE help_messages ADD COLUMN IF NOT EXISTS is_response BOOLEAN DEFAULT FALSE;
ALTER TABLE help_threads ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE;


INSERT INTO users (user_id, first_name, last_name, email, password, account_type, organization_id, created_at, updated_at, on_hold, class_id, username)
VALUES (
    DEFAULT, -- Auto-incrementing ID
    'Admin', -- First Name
    'User', -- Last Name
    'admin@oneplace.com', -- Email
    '$2b$10$hash_here', -- Hashed Password (replace with bcrypt hash of 'admin123')
    'admin', -- Account Type
    NULL, -- No organization ID for admin
    NOW(), -- Created At
    NOW(), -- Updated At
    FALSE, -- On Hold
    NULL, -- No class ID for admin
    'admin' -- Username
);

ALTER TABLE organizations ADD COLUMN role VARCHAR(50) DEFAULT 'Manager';
ALTER TABLE users
ADD COLUMN reset_password_token VARCHAR(255),
ADD COLUMN reset_password_expires TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE guardians ADD COLUMN IF NOT EXISTS date_of_birth DATE;


ALTER TABLE organizations
ADD COLUMN reset_password_token VARCHAR(255),
ADD COLUMN reset_password_expires TIMESTAMP;
ALTER TABLE users ALTER COLUMN password DROP NOT NULL;

ALTER TABLE category_scores DROP CONSTRAINT category_scores_student_id_class_id_subject_id_category_org_key;

ALTER TABLE category_scores ADD CONSTRAINT category_scores_unique
UNIQUE (student_id, class_id, subject_id, category, organization_id, term_id);

-- Drop the existing constraint
ALTER TABLE assessments DROP CONSTRAINT unique_class_subject_title;

ALTER TABLE assessments DROP CONSTRAINT unique_assessment_title_class_subject;
ALTER TABLE assessments ADD CONSTRAINT unique_assessment_title_class_subject_term
UNIQUE (title, subject_id, class_id, term_id);

CREATE TABLE archived_student_info (
    id SERIAL PRIMARY KEY,
    student_id INT NOT NULL,
    graduation_year_group_id INT NOT NULL,
    archived_at TIMESTAMP DEFAULT NOW(),
    organization_id INT NOT NULL,
    FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
    FOREIGN KEY (graduation_year_group_id) REFERENCES graduation_year_groups(id) ON DELETE CASCADE
);


ALTER TABLE guardians ADD COLUMN email VARCHAR(255);
ALTER TABLE students ADD COLUMN graduated BOOLEAN DEFAULT FALSE;


CREATE TABLE plans (
    id SERIAL PRIMARY KEY,
    plan_name VARCHAR(255) NOT NULL,
);

CREATE TABLE features (
    id SERIAL PRIMARY KEY,
    feature_name VARCHAR(255) NOT NULL,
    price_usd DECIMAL(10, 2) NOT NULL
);

CREATE TABLE plan_features (
    id SERIAL PRIMARY KEY,
    plan_id INT REFERENCES plans(id) ON DELETE CASCADE,
    feature_id INT REFERENCES features(id) ON DELETE CASCADE
);

ALTER TABLE plans ADD COLUMN description TEXT;
ALTER TABLE plans ADD COLUMN is_active BOOLEAN DEFAULT FALSE;

ALTER TABLE plans ALTER COLUMN category DROP NOT NULL;

ALTER TABLE organizations 
ADD COLUMN stripe_customer_id VARCHAR(255);

CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON user_sessions (expire);
ALTER TABLE organizations 
ADD COLUMN hold_by VARCHAR(10) DEFAULT NULL;


-- Clear existing plans
DELETE FROM plans;

-- Insert fixed plans
INSERT INTO plans (id, plan_name, description, is_active) VALUES
(1, 'Basic / Starter Plan', 'A starter plan with essential features.', TRUE),
(2, 'Pro / Professional Plan', 'A professional plan with advanced features.', TRUE),
(3, 'Premium / Business Plan', 'A business plan with premium features.', TRUE),
(4, 'Enterprise / Custom Plan', 'A fully customizable enterprise plan.', TRUE);

-- Ensure sequence does not auto-increment beyond fixed IDs
ALTER SEQUENCE plans_id_seq RESTART WITH 5;




CREATE TABLE IF NOT EXISTS feature_routes (
  id SERIAL PRIMARY KEY,
  feature_id INTEGER REFERENCES features(id) ON DELETE CASCADE,
  route_path VARCHAR(255) NOT NULL UNIQUE
);


ALTER TABLE features
ADD CONSTRAINT unique_feature_name UNIQUE (feature_name);


ALTER TABLE organizations
ADD COLUMN plan_id INTEGER;

-- Add foreign key constraint to ensure data integrity
ALTER TABLE organizations
ADD CONSTRAINT fk_plan
FOREIGN KEY (plan_id) REFERENCES plans(id)
ON DELETE SET NULL;


ALTER TABLE plans ADD COLUMN total_cost DECIMAL(10,2) DEFAULT 0;

CREATE TABLE payments (
    id SERIAL PRIMARY KEY,
    organization_id INT NOT NULL,
    stripe_subscription_id VARCHAR(255) NOT NULL,
    stripe_payment_intent_id VARCHAR(255),
    amount_paid DECIMAL(10,2),
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE organizations ADD COLUMN scheduled_hold_date TIMESTAMP DEFAULT NULL;

CREATE TABLE promo_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    discount_percentage INT NOT NULL CHECK (discount_percentage > 0 AND discount_percentage <= 100),
    is_active BOOLEAN DEFAULT TRUE,
    expiration_date TIMESTAMP NOT NULL DEFAULT NOW() + INTERVAL '30 days',
    created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE payments ADD COLUMN discount_applied VARCHAR(50);
ALTER TABLE promo_codes ADD COLUMN applies_once BOOLEAN DEFAULT FALSE;
ALTER TABLE payments ADD COLUMN applies_once BOOLEAN DEFAULT FALSE;

CREATE TABLE class_positions (
  student_id INT NOT NULL,
  class_id INT NOT NULL,
  term_id INT NOT NULL,
  school_year_id INT NOT NULL,
  position INT NOT NULL,
  organization_id INT NOT NULL,
  PRIMARY KEY (student_id, class_id, term_id, school_year_id, organization_id)
);
ALTER TABLE status_settings DROP CONSTRAINT IF EXISTS status_settings_unique;


ALTER TABLE status_settings
ADD CONSTRAINT unique_status_per_class_org UNIQUE (organization_id, class_id);

CREATE TABLE promotion_schedule (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  current_term_id INTEGER NOT NULL,
  current_school_year_id INTEGER NOT NULL,
  target_term_id INTEGER NOT NULL,
  target_school_year_id INTEGER NOT NULL,
  scheduled_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'scheduled', -- can be scheduled, completed, reversed, canceled
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE promotion_schedule_classes (
  id SERIAL PRIMARY KEY,
  schedule_id INT REFERENCES promotion_schedule(id) ON DELETE CASCADE,
  class_id INT REFERENCES classes(class_id),
  organization_id INT NOT NULL
);

CREATE TABLE employment (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    external_link TEXT,
    application_mode TEXT NOT NULL DEFAULT 'external' CHECK (application_mode IN ('external', 'in_app')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE employment_applications (
    id SERIAL PRIMARY KEY,
    employment_id INTEGER NOT NULL REFERENCES employment(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    location TEXT NOT NULL,
    whatsapp_number TEXT,
    has_institution_experience BOOLEAN NOT NULL DEFAULT false,
    institution_experience_name TEXT,
    contact_via_text BOOLEAN NOT NULL DEFAULT false,
    contact_via_email BOOLEAN NOT NULL DEFAULT true,
    cover_letter TEXT NOT NULL,
    resume_url TEXT NOT NULL,
    resume_s3_key TEXT,
    resume_filename TEXT,
    cover_letter_url TEXT,
    cover_letter_s3_key TEXT,
    cover_letter_filename TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE donations (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    external_link TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE donations ADD COLUMN image_url TEXT;
ALTER TABLE donations ADD COLUMN s3_key TEXT;

CREATE TABLE admin_announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE announcement_views (
  view_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  announcement_id INTEGER NOT NULL,
  last_viewed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_announcement FOREIGN KEY (announcement_id) 
    REFERENCES admin_announcements(id) ON DELETE CASCADE,
  CONSTRAINT fk_user FOREIGN KEY (user_id) 
    REFERENCES users(user_id)
);

ALTER TABLE organizations
ADD COLUMN public_registration_enabled BOOLEAN DEFAULT false,
ADD COLUMN registration_start_date DATE,
ADD COLUMN registration_end_date DATE,
ADD COLUMN public_registration_price NUMERIC(10, 2) DEFAULT 0.00;
ADD COLUMN registration_description TEXT;

ALTER TABLE organizations
ALTER COLUMN public_registration_currency SET DEFAULT 'GHS';


CREATE TABLE pending_students (
  pending_id SERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  hometown TEXT,
  class_id INTEGER REFERENCES classes(class_id),
  graduation_year_group_id INTEGER REFERENCES graduation_year_groups(id),
  gender TEXT CHECK (gender IN ('Male', 'Female')),
  image_url TEXT,
  enrollment_type TEXT CHECK (enrollment_type IN ('current', 'future')),
  school_year_id INTEGER REFERENCES school_years(id),
  term_id INTEGER REFERENCES terms(term_id),
  organization_id INTEGER REFERENCES organizations(organization_id),
  stripe_payment_verified BOOLEAN DEFAULT false,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE pending_guardians (
  id SERIAL PRIMARY KEY,
  pending_id INTEGER REFERENCES pending_students(pending_id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  hometown TEXT
);

CREATE TABLE pending_student_subjects (
  id SERIAL PRIMARY KEY,
  pending_student_id INTEGER REFERENCES pending_students(pending_id) ON DELETE CASCADE,
  subject_id INTEGER REFERENCES subjects(subject_id),
  organization_id INTEGER REFERENCES organizations(organization_id)
);

CREATE TABLE flutterwave_accounts (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(organization_id) ON DELETE CASCADE,
  account_type VARCHAR(10) CHECK (account_type IN ('bank', 'momo')) NOT NULL,
  account_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  bank_or_provider TEXT NOT NULL,
  country VARCHAR(10) DEFAULT 'GH',
  subaccount_id TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE flutterwave_accounts
ADD COLUMN phone_number TEXT;
ALTER TABLE flutterwave_accounts ADD COLUMN notification_email VARCHAR(255);
ALTER TABLE admin_announcements ADD COLUMN organization_id INTEGER REFERENCES organizations(organization_id);
ALTER TABLE admin_announcements ADD COLUMN expiry_date TIMESTAMP;
-- Fix for admin_announcements
ALTER TABLE admin_announcements
DROP CONSTRAINT admin_announcements_organization_id_fkey,
ADD CONSTRAINT admin_announcements_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE;

-- Fix for organization_dashboard
ALTER TABLE organization_dashboard
DROP CONSTRAINT organization_dashboard_organization_id_fkey,
ADD CONSTRAINT organization_dashboard_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE;

-- Fix for pending_students
ALTER TABLE pending_students
DROP CONSTRAINT pending_students_organization_id_fkey,
ADD CONSTRAINT pending_students_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE;

-- Fix for promotion_schedule_classes (if you still want it)
ALTER TABLE promotion_schedule_classes
DROP CONSTRAINT promotion_schedule_classes_class_id_fkey,
ADD CONSTRAINT promotion_schedule_classes_class_id_fkey
  FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE CASCADE;

DELETE FROM student_reports
WHERE organization_id NOT IN (SELECT organization_id FROM organizations);
ALTER TABLE student_reports
DROP CONSTRAINT IF EXISTS student_report_organization_id_fkey;
ALTER TABLE student_reports
ADD CONSTRAINT student_report_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE;



CREATE UNIQUE INDEX one_primary_per_type_per_org 
ON flutterwave_accounts (organization_id, account_type) 
WHERE is_primary = TRUE;
-- Optional for stricter DB-level control (PostgreSQL partial index)
CREATE UNIQUE INDEX one_per_type_per_org 
ON flutterwave_accounts (organization_id, account_type);


ALTER TABLE student_reports
  ADD COLUMN promotion_status VARCHAR(10),
  ADD COLUMN promotion_class_id INTEGER;

ALTER TABLE school_years ADD COLUMN IF NOT EXISTS created_by_promotion BOOLEAN DEFAULT FALSE;
ALTER TABLE terms ADD COLUMN IF NOT EXISTS created_by_promotion BOOLEAN DEFAULT FALSE;
ALTER TABLE enrolled_students ADD COLUMN added_by_promotion BOOLEAN DEFAULT FALSE;
ALTER TABLE status_settings ADD COLUMN term_id INTEGER;
ALTER TABLE status_settings
ADD CONSTRAINT status_settings_unique_per_term
UNIQUE (organization_id, class_id, term_id);





-- Restore constraint (update if your FK structure is different)
ALTER TABLE students
ADD CONSTRAINT students_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(user_id);
ALTER TABLE pending_students ADD COLUMN payment_pending BOOLEAN DEFAULT false;
CREATE TABLE pending_student_payments (
  id SERIAL PRIMARY KEY,
  pending_student_id INTEGER NOT NULL REFERENCES pending_students(pending_id) ON DELETE CASCADE,
  payment_method_id INTEGER NOT NULL,
  organization_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE promotion_schedule
  ALTER COLUMN scheduled_date TYPE TIMESTAMP WITH TIME ZONE USING scheduled_date::timestamp;



Scenario	Test Card	Description
✅ Basic Success	4242 4242 4242 4242	Standard approval
✅ Visa Debit	4000 0566 5566 5556	Visa debit card
✅ Mastercard	5555 5555 5555 4444	Standard Mastercard
✅ American Express	3782 822463 10005	4-digit CVC required
✅ Discover	6011 1111 1111 1117	Discover Card
✅ Diners Club	3056 9309 8250 64	Diners Club


🧪 Test Cards (for card payments)
Card Type	Card Number	Expiry Date	CVV	PIN	OTP	Notes
Visa	5531 8866 5214 2950	09/32	564	3310	12345	Most commonly used test card
MasterCard	5199 6405 2300 1211	09/32	564	3310	12345	
Verve	5061 4600 3606 1234	09/32	564	3310	12345	Verve cards are supported
PreAuth Card	4000 0000 0000 0002	09/32	564	-	-	Will always fail (for negative tests)

Use OTP: 12345 when prompted

📱 Mobile Money (MoMo) Test Numbers
Provider	MoMo Number	OTP	Notes
MTN Ghana	0551234987	12345	Use this for MTN Ghana
Vodafone Ghana	0200000000	12345	Vodafone Ghana simulation
AirtelTigo Ghana	0270000000	12345	AirtelTigo simulation
MTN Uganda	256781000001	12345	For UGX testing
Safaricom Kenya (MPESA)	254708374149	12345	Kenya-based testing number


test OTP code (often 12345 or 123456)
Ensure the provider is selected correctly in your form (bankOrProvider = MTN, VDF, etc.)

🇬🇭 Ghana – GHS Bank Account
Field	Value
Account Number	1234567890
Account Name	Flutterwave Ghana Demo
Bank Code	GH123456 (use any string)
Bank Name	Any bank (e.g., GCB Bank)
Country	GH

⚠️ Ghana test accounts are loosely validated. Just use any 10-digit number and test bank code like GH123456.