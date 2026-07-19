export const withMigrationHint = (message: string, migrationFile: string): string =>
  `${message} Apply ${migrationFile} in Supabase, then retry.`;
