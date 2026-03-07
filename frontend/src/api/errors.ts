export function getApiErrorMessage(error: unknown, fallback: string) {
  const err = error as { response?: { data?: { detail?: string } }; message?: string };
  return err?.response?.data?.detail || err?.message || fallback;
}
