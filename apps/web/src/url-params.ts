export function applyHashParams(current: URLSearchParams, next: Record<string, string | null>): URLSearchParams {
  const params = new URLSearchParams(current);
  for (const [key, value] of Object.entries(next)) {
    if (value === null || value === "") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }
  return params;
}

export function hashWithParams(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `#${path}?${query}` : `#${path}`;
}
