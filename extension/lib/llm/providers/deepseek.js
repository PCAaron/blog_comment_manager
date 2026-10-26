/**
 * DeepSeek 官方 API（OpenAI 兼容 Chat Completions）。
 * @see https://api-docs.deepseek.com/zh-cn/
 */
const CHAT_URL = 'https://api.deepseek.com/chat/completions';
const TEST_MODEL = 'deepseek-flash';

export const id = 'deepseek';

export function chatCompletionsUrl() {
  return CHAT_URL;
}

export function requestHeaders(key) {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

/** 关闭默认思考模式，避免 reasoning 占满 max_tokens 导致 content 为空 */
export function extendChatBody(body) {
  body.thinking = { type: 'disabled' };
  return body;
}

export function providerLabel() {
  return 'DeepSeek';
}

/** 最小对话请求验证 Key */
export async function testConnection(key) {
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: requestHeaders(key),
    body: JSON.stringify({
      model: TEST_MODEL,
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
