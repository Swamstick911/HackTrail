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

async function request(path: string, options: RequestInit = {}, retry = true): Promise<Response> {
  const token = await localToken();
  const headers = new Headers(options.headers);
  headers.set('Authorization', 'Bearer ' + token);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch('/api' + path, {
    ...options,
    headers,
  });
  if (response.status === 401 && retry) {
    tokenPromise = undefined;
    return request(path, options, false);
  }
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({ error: 'The collector could not complete this request.' }))) as {
      error: string;
    };
    throw new Error(body.error);
  }
  return response;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await request(path, options);
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

export function saveDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadExtension() {
  saveDownload(await (await request('/integrations/vscode')).blob(), 'hacktrail.vsix');
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
