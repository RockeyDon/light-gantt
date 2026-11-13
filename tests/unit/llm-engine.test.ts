import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMEngine } from '../../src/main/llm-engine';
import type { Settings } from '../../src/shared/contracts';

const config: Settings = { LLM_BASE_URL: 'https://example.test/api/v1///', LLM_API_KEY: 'secret', LLM_MODEL_ID: 'model', theme: 'light' };
const success = () => new Response(JSON.stringify({ choices: [{ message: { content: 'result' }, finish_reason: 'stop' }] }));
afterEach(() => vi.useRealTimers());

describe('LLMEngine', () => {
  it('uses fresh saved settings, standard chat completions, no streaming or thinking, and a deadline', async () => {
    const get = vi
      .fn()
      .mockReturnValueOnce(config)
      .mockReturnValueOnce({ ...config, LLM_MODEL_ID: 'updated' });
    const request = vi.fn<typeof fetch>().mockImplementation(async () => success());
    const engine = new LLMEngine({ get }, request);
    expect(await engine.complete('system prompt', 'user text')).toBe('result');
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('https://example.test/api/v1/chat/completions');
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' } });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(options?.body as string)).toEqual({
      model: 'model',
      stream: false,
      enable_thinking: false,
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user text' },
      ],
    });
    await engine.complete('system prompt', 'next input');
    expect(JSON.parse(request.mock.calls[1][1]?.body as string).model).toBe('updated');
  });

  it.each(['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL_ID'] as const)('reports missing %s before any network call', async (field) => {
    const request = vi.fn<typeof fetch>();
    await expect(new LLMEngine({ get: () => ({ ...config, [field]: '' }) }, request).complete('s', 'u')).rejects.toMatchObject({ code: 'LLM_CONFIG_MISSING' });
    expect(request).not.toHaveBeenCalled();
  });

  it('lists all missing settings in Chinese', async () => {
    const engine = new LLMEngine({ get: () => ({ ...config, LLM_BASE_URL: '', LLM_API_KEY: '', LLM_MODEL_ID: '' }) });
    await expect(engine.complete('s', 'u')).rejects.toThrow('接口地址、API 密钥、模型名称');
  });

  it.each([
    [401, '鉴权'],
    [403, '鉴权'],
    [429, '过于频繁'],
    [500, '暂时不可用'],
    [400, '关闭思考参数'],
    [404, 'HTTP 404'],
  ])('maps HTTP %s without exposing service text or retrying', async (status, message) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('sensitive secret service response', { status: status as number }));
    const promise = new LLMEngine({ get: () => config }, request).complete('s', 'u');
    await expect(promise).rejects.toThrow(message as string);
    await expect(promise).rejects.not.toThrow('secret');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reports network failure without including request or credential details', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('network error secret'));
    await expect(new LLMEngine({ get: () => config }, request).complete('s', 'u')).rejects.toThrow('无法连接模型服务');
  });

  it('enforces the timeout while receiving the response body', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal;
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      signal = options!.signal!;
      return {
        ok: true,
        text: () =>
          new Promise<string>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
      } as Response;
    });
    // Mock the timeout primitive because Node's native AbortSignal timer bypasses fake timers.
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    try {
      const result = new LLMEngine({ get: () => config }, request).complete('s', 'u');
      const rejection = expect(result).rejects.toThrow('模型响应超时');
      await vi.advanceTimersByTimeAsync(60_000);
      await rejection;
    } finally {
      timeout.mockRestore();
    }
  });

  it.each([
    'not JSON',
    '{}',
    '{"choices":[]}',
    '{"choices":[{"message":{"content":null}}]}',
    '{"choices":[{"message":{"content":" "}}]}',
    '{"choices":[{"message":{"content":"partial"},"finish_reason":"length"}]}',
  ])('rejects incompatible or incomplete response: %s', async (body) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    await expect(new LLMEngine({ get: () => config }, request).complete('s', 'u')).rejects.toMatchObject({ code: 'LLM_RESPONSE_INVALID' });
  });
});
