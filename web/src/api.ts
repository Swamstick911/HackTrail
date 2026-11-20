let tokenPromise: Promise<string> | undefined;

async function localToken() {
  tokenPromise ??= fetch('/api/session', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Could not connect to the local collector.');
      return ((await response.json()) as { token: string }).token;
    })
    .catch((error) => {
      tokenPromise = undefined;
      throw error;
    });
  return tokenPromise;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await localToken();
  const headers = new Headers(options.headers);
  headers.set('Authorization', 'Bearer ' + token);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch('/api' + path, {
    ...options,
    headers,
  });
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({ error: 'The collector could not complete this request.' }))) as {
      error: string;
    };
    throw new Error(body.error);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
