-- Add theme_color column to organizations table if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'organizations' AND column_name = 'theme_color') THEN
        ALTER TABLE organizations ADD COLUMN theme_color VARCHAR(20) DEFAULT 'teal';
    END IF;
END $$;

-- Update existing organizations to have default theme_color
UPDATE organizations SET theme_color = 'teal' WHERE theme_color IS NULL;
