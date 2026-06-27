export const isMissingColumnError = (
  error: { message?: string | null } | null | undefined,
  columnName: string
): boolean => {
  const message = error?.message?.toLowerCase() ?? "";
  const column = columnName.toLowerCase();

  return (
    message.includes(`.${column}`) ||
    message.includes(`'${column}'`) ||
    message.includes(`"${column}"`) ||
    message.includes(`column ${column}`)
  ) && (message.includes("does not exist") || message.includes("schema cache"));
};

export const withMigrationHint = (message: string, migrationFile: string): string =>
  `${message} Apply ${migrationFile} in Supabase, then retry.`;
