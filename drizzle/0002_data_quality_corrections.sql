-- Repair lawn-service records captured by the overly broad "care" classifier.
UPDATE businesses
SET
  industry = 'Local services',
  score = 88,
  opportunity = 'Local SEO + lead generation',
  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE industry = 'Healthcare'
  AND (
    LOWER(name) LIKE '%lawncare%'
    OR LOWER(name) LIKE '%lawn care%'
  );

--> statement-breakpoint

-- St. Petersburg is in Pinellas County; cover observed spelling variants.
UPDATE businesses
SET
  county = 'Pinellas',
  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE county = 'Unassigned'
  AND LOWER(TRIM(city)) IN (
    'st. petersburg',
    'st petersburg',
    'saint petersburg'
  );
