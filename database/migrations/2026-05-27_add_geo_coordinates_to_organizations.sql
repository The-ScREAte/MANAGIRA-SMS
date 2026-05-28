-- Migration: Add geo coordinates to organizations table for local SEO
-- Date: 2026-05-27
-- Purpose: Enables "near me" Google searches by storing lat/lng per school/org.
--          Schools set these via Account > Update from Google Maps coordinates.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS geo_lat DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS geo_lng DECIMAL(11, 8);
