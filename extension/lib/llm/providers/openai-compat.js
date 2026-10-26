/**
 * 自定义 OpenAI 兼容网关（第二期 UI；逻辑先预留）。
 */
import { extendChatBody } from './deepseek.js';

export const id = 'openai_compat';
export { extendChatBody };

export function chatCompletionsUrl(settings) {
  const base = String(settings.openaiCompat?.baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('未配置 OpenAI 兼容 API Base URL');
  if (!/^https:\/\//i.test(base)) throw new Error('OpenAI 兼容 Base URL 必须为 https 地址');
  return `${base}/chat/completions`;
}

export function requestHeaders(key) {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

export function providerLabel() {
  return 'OpenAI 兼容 API';
}

export async function testConnection(key, settings) {
  const url = chatCompletionsUrl(settings);
  const res = await fetch(url, {
    method: 'POST',
    headers: requestHeaders(key),
    body: JSON.stringify({
      model: settings.models?.classify || settings.models?.commentGen || 'deepseek-flash',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 8,
      thinking: { type: 'disabled' },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 120)}` };
  }
  return { ok: true };
}
