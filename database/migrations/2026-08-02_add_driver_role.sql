-- Driver role
-- Adds a new role to the user_role enum so org staff can be invited as a
-- transportation Driver (dedicated driver portal + limited permissions).

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'Driver';
