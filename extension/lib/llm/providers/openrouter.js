/**
 * OpenRouter 网关：Chat Completions + Key 校验。
 */
import { LIMITS } from '../../config.js';

const API_BASE = 'https://openrouter.ai/api/v1';

export const id = 'openrouter';

export function chatCompletionsUrl() {
  return `${API_BASE}/chat/completions`;
}

export function requestHeaders(key) {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://localhost/extension',
    'X-Title': 'Blog Comment Backlink Manager',
  };
}

export function extendChatBody(body) {
  body.reasoning = { effort: LIMITS.aiReasoningEffort };
  return body;
}

export function providerLabel() {
  return 'OpenRouter';
}

/** 测试 API Key（GET /key） */
export async function testConnection(key) {
  const res = await fetch(`${API_BASE}/key`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const data = await res.json().catch(() => ({}));
  return {
    ok: true,
    label: data?.data?.label || '',
    usage: data?.data?.usage ?? null,
    limit: data?.data?.limit ?? null,
  };
}
