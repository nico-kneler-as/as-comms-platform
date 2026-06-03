DELETE FROM contact_identities
WHERE source = 'salesforce'
  AND kind = 'email'
  AND normalized_value IN (
    SELECT lower(alias) FROM project_aliases
  );
