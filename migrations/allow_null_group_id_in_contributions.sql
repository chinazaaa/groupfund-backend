-- Migration: Allow NULL group_id in contribution tables to preserve history when groups are deleted
-- This allows contributions to remain in the database even after a group is deleted

-- For birthday_contributions
-- Drop the existing foreign key constraint
ALTER TABLE birthday_contributions 
  DROP CONSTRAINT IF EXISTS birthday_contributions_group_id_fkey;

-- Re-add the foreign key with ON DELETE SET NULL to preserve contributions
ALTER TABLE birthday_contributions 
  ADD CONSTRAINT birthday_contributions_group_id_fkey 
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL;

-- Make group_id nullable (it might already be, but ensure it)
ALTER TABLE birthday_contributions 
  ALTER COLUMN group_id DROP NOT NULL;

-- For subscription_contributions
-- Drop the existing foreign key constraint
ALTER TABLE subscription_contributions 
  DROP CONSTRAINT IF EXISTS subscription_contributions_group_id_fkey;

-- Re-add the foreign key with ON DELETE SET NULL
ALTER TABLE subscription_contributions 
  ADD CONSTRAINT subscription_contributions_group_id_fkey 
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL;

-- Make group_id nullable
ALTER TABLE subscription_contributions 
  ALTER COLUMN group_id DROP NOT NULL;

-- For general_contributions
-- Drop the existing foreign key constraint
ALTER TABLE general_contributions 
  DROP CONSTRAINT IF EXISTS general_contributions_group_id_fkey;

-- Re-add the foreign key with ON DELETE SET NULL
ALTER TABLE general_contributions 
  ADD CONSTRAINT general_contributions_group_id_fkey 
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL;

-- Make group_id nullable
ALTER TABLE general_contributions 
  ALTER COLUMN group_id DROP NOT NULL;

-- Note: We need to drop unique constraints that include group_id since NULL values would violate them
-- These constraints will need to be recreated without group_id or made partial

-- Drop unique constraint from birthday_contributions if it includes group_id
-- (Note: birthday_contributions doesn't have a unique constraint with group_id in the base schema,
--  but if one was added, it would need to be dropped or modified)

-- Drop unique constraint from subscription_contributions
ALTER TABLE subscription_contributions 
  DROP CONSTRAINT IF EXISTS subscription_contributions_group_id_contributor_id_subscription_period_start_key;

-- Recreate it as a partial unique constraint (only when group_id is not NULL)
-- This allows multiple NULL group_ids for the same contributor and period
CREATE UNIQUE INDEX IF NOT EXISTS subscription_contributions_unique_when_group_exists 
  ON subscription_contributions (group_id, contributor_id, subscription_period_start) 
  WHERE group_id IS NOT NULL;

-- Drop unique constraint from general_contributions
ALTER TABLE general_contributions 
  DROP CONSTRAINT IF EXISTS general_contributions_group_id_contributor_id_key;

-- Recreate it as a partial unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS general_contributions_unique_when_group_exists 
  ON general_contributions (group_id, contributor_id) 
  WHERE group_id IS NOT NULL;

