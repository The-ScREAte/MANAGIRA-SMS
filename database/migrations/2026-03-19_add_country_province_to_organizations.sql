-- Migration: Add organization_country and organization_province columns to organizations table
-- Date: 2026-03-19

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS organization_country VARCHAR(100),
  ADD COLUMN IF NOT EXISTS organization_province VARCHAR(100);
