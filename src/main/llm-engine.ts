import { z } from 'zod';
import type { ErrorCode, Settings } from '../shared/contracts';

export class LLMError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().trim().min(1) }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

export class LLMEngine {
  constructor(
    private readonly settings: Pick<{ get(): Settings }, 'get'>,
    private readonly request: typeof fetch = fetch,
  ) {}

  async complete(system: string, user: string): Promise<string> {
    const config = this.settings.get();
    const missing = [!config.LLM_BASE_URL && '接口地址', !config.LLM_API_KEY && 'API 密钥', !config.LLM_MODEL_ID && '模型名称'].filter(Boolean);
    if (missing.length) throw new LLMError('LLM_CONFIG_MISSING', `请先在配置中填写${missing.join('、')}`);
    let response: Response;
    let body: unknown;
    const signal = AbortSignal.timeout(60_000);
    try {
      response = await this.request(`${config.LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.LLM_API_KEY}` },
        body: JSON.stringify({
          model: config.LLM_MODEL_ID,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          stream: false,
          enable_thinking: false,
        }),
        signal,
        redirect: 'error',
      });
      if (!response.ok) {
        const message =
          response.status === 401 || response.status === 403
            ? '模型鉴权失败，请检查 API 密钥及访问权限'
            : response.status === 429
              ? '模型请求过于频繁或额度不足，请稍后重试'
              : response.status >= 500
                ? '模型服务暂时不可用，请稍后重试'
                : `模型请求失败（HTTP ${response.status}），请检查接口地址、模型名称及关闭思考参数是否受支持`;
        await response.body?.cancel();
        throw new LLMError('LLM_REQUEST_FAILED', message);
      }
      // Read under the same timeout as the request, including a slow response body.
      const raw = await response.text();
      try {
        body = JSON.parse(raw);
      } catch {
        throw new LLMError('LLM_RESPONSE_INVALID', '模型返回的响应不是有效 JSON，请重试');
      }
    } catch (error) {
      if (error instanceof LLMError) throw error;
      throw new LLMError('LLM_REQUEST_FAILED', signal.aborted ? '模型响应超时，请稍后重试' : '无法连接模型服务，请检查接口地址及网络连接');
    }
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success || (parsed.data.choices[0].finish_reason && parsed.data.choices[0].finish_reason !== 'stop')) {
      throw new LLMError('LLM_RESPONSE_INVALID', '模型未返回完整的文本结果，请重试');
    }
    return parsed.data.choices[0].message.content;
  }
}
