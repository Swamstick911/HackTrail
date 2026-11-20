export function collectorUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('Use a local collector URL, such as http://127.0.0.1:47654.');
  }
  return url.origin;
}

export class CollectorError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class LocalClient {
  private token = '';
  readonly baseUrl: string;

  constructor(
    url: string,
    private timeoutMs = 3000,
  ) {
    this.baseUrl = collectorUrl(url);
  }

  async request<T>(path: string, body?: unknown, retry = true): Promise<T> {
    if (!this.token) {
      const response = await fetch(this.baseUrl + '/api/session', {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error('The local collector did not accept the connection.');
      this.token = ((await response.json()) as { token: string }).token;
    }
    const headers: Record<string, string> = { Authorization: 'Bearer ' + this.token };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(this.baseUrl + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status === 401 && retry) {
      this.token = '';
      return this.request(path, body, false);
    }
    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ error: 'Collector request failed.' }))) as { error: string };
      throw new CollectorError(error.error, response.status);
    }
    return response.json() as Promise<T>;
  }
}
