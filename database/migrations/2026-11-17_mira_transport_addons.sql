-- Mira and transportation are add-ons a school buys, not part of a plan: they come off Pro and
-- Premium, and the plan lines stop promising them. Safe to run more than once.
DELETE FROM plan_features
 WHERE feature_id IN (SELECT id FROM features WHERE feature_name IN ('Mira Basic', 'Mira Full', 'Transportation'));
UPDATE plans SET description = 'For schools that test online and issue transcripts.'
 WHERE plan_name = 'Pro' AND description = 'For schools that test online, issue transcripts and start using Mira.';
UPDATE plans SET description = 'The whole platform, with Report builder, your website and priority support.'
 WHERE plan_name = 'Premium' AND description = 'The whole platform, with your website, buses and priority support.';
