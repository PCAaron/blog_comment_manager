/**
 * 多服务商 LLM 客户端：chat / chatJSON / 连接测试。
 */
import { getState } from '../storage.js';
import { LIMITS, normalizeAiProvider } from '../config.js';
import * as openrouter from './providers/openrouter.js';
import * as deepseek from './providers/deepseek.js';
import * as openaiCompat from './providers/openai-compat.js';

const ADAPTERS = {
  openrouter,
  deepseek,
  openai_compat: openaiCompat,
};

let _lastCallAt = 0;

async function throttle() {
  const wait = LIMITS.aiDelayMs - (Date.now() - _lastCallAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  _lastCallAt = Date.now();
}

export function getKeyForProvider(settings, provider) {
  const p = normalizeAiProvider(provider);
  if (p === 'deepseek') return String(settings.deepseekKey || '').trim();
  if (p === 'openai_compat') return String(settings.openaiCompat?.apiKey || '').trim();
  return String(settings.openrouterKey || '').trim();
}

export function hasConfiguredKey(settings) {
  const p = normalizeAiProvider(settings.aiProvider);
  if (p === 'openai_compat') {
    const base = String(settings.openaiCompat?.baseUrl || '').trim();
    return !!getKeyForProvider(settings, p) && !!base;
  }
  return !!getKeyForProvider(settings, p);
}

function keyMissingError(provider) {
  const adapter = ADAPTERS[normalizeAiProvider(provider)];
  return new Error(`未配置 ${adapter.providerLabel()} API Key，请先到设置页填写`);
}

export function getModel(role) {
  const { settings } = getState();
  return settings.models[role] || settings.models.classify;
}

function resolveAdapter(settings) {
  return ADAPTERS[normalizeAiProvider(settings.aiProvider)];
}

function chatUrl(adapter, settings) {
  if (adapter.id === 'openai_compat') return openaiCompat.chatCompletionsUrl(settings);
  return adapter.chatCompletionsUrl();
}

/** 基础对话。返回 assistant 文本。 */
export async function chat(role, messages, { maxTokens = 1000, temperature = 0.4, json = true } = {}) {
  const settings = getState().settings;
  const adapter = resolveAdapter(settings);
  const provider = adapter.id;
  const key = getKeyForProvider(settings, provider);
  if (!hasConfiguredKey(settings)) throw keyMissingError(provider);

  await throttle();
  let body = {
    model: getModel(role),
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (json) body.response_format = { type: 'json_object' };
  body = adapter.extendChatBody(body);

  const timeoutMs = Number(settings.aiTimeoutMs) || 20000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const label = adapter.providerLabel();
  let res;
  try {
    res = await fetch(chatUrl(adapter, settings), {
      method: 'POST',
      headers: adapter.requestHeaders(key),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error(`AI 请求超时（${Math.round(timeoutMs / 1000)} 秒），可在设置页调整`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${label} ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content) {
    const why = choice?.finish_reason === 'length' ? '（输出被 max_tokens 截断：思考占用了全部额度）' : '';
    throw new Error(`${label} 返回为空${why}`);
  }
  return content;
}

/** 对话并解析 JSON（要求模型输出 json_object）。解析失败时尝试提取 {...} / [...]。 */
export async function chatJSON(role, system, user, opts = {}) {
  const text = await chat(role, [
    { role: 'system', content: system + '\n只输出合法 JSON，不要输出任何解释文字。' },
    { role: 'user', content: user },
  ], { ...opts, json: true });
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/[[{][\s\S]*[\]}]/);
    if (m) return JSON.parse(m[0]);
    throw new Error('AI 返回的 JSON 无法解析: ' + text.slice(0, 120));
  }
}

/** 测试指定服务商的 API Key */
export async function testConnection(provider, key, settings = getState().settings) {
  const p = normalizeAiProvider(provider || settings.aiProvider);
  const adapter = ADAPTERS[p];
  const trimmed = String(key || '').trim();
  if (!trimmed) return { ok: false, error: 'Key 为空' };
  if (p === 'openai_compat') return openaiCompat.testConnection(trimmed, settings);
  return adapter.testConnection(trimmed);
}

/** 兼容旧名：按当前或指定服务商测试 Key */
export async function testKey(key, provider) {
  return testConnection(provider, key);
}
