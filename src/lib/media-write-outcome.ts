// Only known transaction/request rejections prove an uploaded file was never saved.
// Transport errors, connection shutdowns, and unknown completion must retain media.
export type MediaWriteError = { code?: string; message: string };
export function isConfirmedMediaWriteRejection(error: MediaWriteError): boolean {
  const code = error.code ?? "";
  return /^(22|23|28|42|44|P0)[A-Z0-9]{3}$/.test(code) ||
    ["40001", "40P01", "PGRST100", "PGRST102", "PGRST105", "PGRST106", "PGRST107", "PGRST108", "PGRST200", "PGRST201", "PGRST202", "PGRST203", "PGRST204", "PGRST205", "PGRST301", "PGRST302", "PGRST303"].includes(code);
}
export async function captureMediaWriteError(operation: PromiseLike<{ error: MediaWriteError | null }>): Promise<MediaWriteError | null> {
  try { return (await operation).error; }
  catch (error) {
    // A thrown transport failure cannot confirm whether the database committed.
    return {message:error instanceof Error ? error.message : "The database response was interrupted."};
  }
}

export async function captureMediaWriteResult<T>(operation: PromiseLike<{ data: T | null; error: MediaWriteError | null }>): Promise<{ data: T | null; error: MediaWriteError | null }> {
  try { return await operation; }
  catch (error) {
    return {data:null,error:{message:error instanceof Error ? error.message : "The database response was interrupted."}};
  }
}
