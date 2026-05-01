import { describe, it, expect, vi, afterEach } from 'vitest';
import { cdpJsonUrl, probeCdpEndpoint } from '../src/cdp/cdp-probe.js';

describe('cdpJsonUrl', () => {
  it('добавляет /json без лишнего слэша', () => {
    expect(cdpJsonUrl('http://127.0.0.1:9222')).toBe('http://127.0.0.1:9222/json');
    expect(cdpJsonUrl('http://127.0.0.1:9222/')).toBe('http://127.0.0.1:9222/json');
  });
});

describe('probeCdpEndpoint', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('ok: HTTP 200 и JSON-массив', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => [{ type: 'page', title: 'Cursor' }],
      }),
    );

    const r = await probeCdpEndpoint('http://127.0.0.1:9222', 1000);
    expect(r).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9222/json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('не ok: HTTP не 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({}),
      }),
    );

    const r = await probeCdpEndpoint('http://127.0.0.1:9222', 1000);
    expect(r).toEqual({ ok: false, reason: 'HTTP 404 Not Found' });
  });

  it('не ok: ответ не массив', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ foo: 1 }),
      }),
    );

    const r = await probeCdpEndpoint('http://127.0.0.1:9222', 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('не JSON-массив');
    }
  });

  it('не ok: сеть / отказ соединения', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const r = await probeCdpEndpoint('http://127.0.0.1:59999', 1000);
    expect(r).toEqual({ ok: false, reason: 'ECONNREFUSED' });
  });
});
