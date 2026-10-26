/**
 * 设置页：读写 chrome.storage.local 的 bcm_store.settings，改动即保存。
 */
import { DEFAULT_SETTINGS, applyProviderModels, PROVIDER_PRESETS, normalizeAiProvider } from '../lib/config.js';
import { setLanguage, t, applyI18n } from '../lib/i18n.js';

const STORAGE_KEY = 'bcm_store';
const $ = (sel) => document.querySelector(sel);

let settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
let saveTimer = null;

const MODEL_FIELDS = [
  ['discover', '#model-discover'],
  ['classify', '#model-classify'],
  ['formDetect', '#model-formdetect'],
  ['commentGen', '#model-commentgen'],
];

function readStore() {
  return chrome.storage.local.get(STORAGE_KEY).then((data) => data[STORAGE_KEY] || {});
}

function currentProvider() {
  return normalizeAiProvider(settings.aiProvider);
}

function syncProviderPanels() {
  const p = currentProvider();
  document.querySelectorAll('input[name="ai-provider"]').forEach((el) => {
    el.checked = el.value === p;
  });
  $('#key-panel-deepseek').hidden = p !== 'deepseek';
  $('#key-panel-openrouter').hidden = p !== 'openrouter';
}

function syncModelPlaceholders() {
  const model = PROVIDER_PRESETS[currentProvider()].defaultModel;
  for (const [, sel] of MODEL_FIELDS) {
    $(sel).placeholder = model || '';
  }
}

function applyModelsToFields() {
  for (const [role, sel] of MODEL_FIELDS) {
    $(sel).value = settings.models[role] || '';
  }
}

/**
 * 保存统一走后台 setSettings 消息（后台内存态是唯一数据源）。
 */
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const flash = $('#saved-flash');
    try {
      await chrome.runtime.sendMessage({
        type: 'setSettings',
        patch: {
          aiProvider: settings.aiProvider,
          openrouterKey: settings.openrouterKey,
          deepseekKey: settings.deepseekKey,
          models: settings.models,
          identity: settings.identity,
          language: settings.language,
          summaryLang: settings.summaryLang,
          aiTimeoutMs: settings.aiTimeoutMs,
        },
      });
      flash.classList.add('show');
      setTimeout(() => flash.classList.remove('show'), 1200);
    } catch (e) {
      flash.textContent = e.message;
      flash.classList.add('show', 'err');
      setTimeout(() => { flash.classList.remove('show', 'err'); flash.textContent = '已保存'; }, 2500);
    }
  }, 500);
}

function bindField(sel, get, set) {
  const el = $(sel);
  el.value = get();
  el.addEventListener('input', () => { set(el.value); saveSettings(); });
  el.addEventListener('change', () => { set(el.value); saveSettings(); });
}

async function runTest(provider) {
  const p = normalizeAiProvider(provider);
  const key = p === 'deepseek' ? $('#deepseek-key').value.trim() : $('#api-key').value.trim();
  const out = $('#test-result');
  if (!key) { out.textContent = t('testFail'); out.className = 'hint err'; return; }
  out.textContent = '...';
  out.className = 'hint';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'testKey', key, provider: p });
    if (res && res.ok) {
      const extra = res.limit != null ? ` (usage ${res.usage ?? '-'}/${res.limit})` : res.usage != null ? ` (used $${res.usage})` : '';
      out.textContent = t('testOk') + extra;
      out.className = 'hint ok';
    } else {
      out.textContent = `${t('testFail')} ${res?.error || ''}`;
      out.className = 'hint err';
    }
  } catch (e) {
    out.textContent = `${t('testFail')} ${e.message}`;
    out.className = 'hint err';
  }
}

async function init() {
  const store = await readStore();
  settings = {
    ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    ...(store.settings || {}),
    models: { ...DEFAULT_SETTINGS.models, ...(store.settings?.models || {}) },
    identity: { ...DEFAULT_SETTINGS.identity, ...(store.settings?.identity || {}) },
    openaiCompat: { ...DEFAULT_SETTINGS.openaiCompat, ...(store.settings?.openaiCompat || {}) },
  };
  settings.aiProvider = normalizeAiProvider(settings.aiProvider);

  setLanguage(settings.language);
  $('#lang-select').value = settings.language;
  applyI18n();

  syncProviderPanels();
  syncModelPlaceholders();

  document.querySelectorAll('input[name="ai-provider"]').forEach((el) => {
    el.addEventListener('change', () => {
      if (!el.checked) return;
      const next = normalizeAiProvider(el.value);
      if (settings.aiProvider === next) return;
      settings.aiProvider = next;
      applyProviderModels(settings);
      applyModelsToFields();
      syncProviderPanels();
      syncModelPlaceholders();
      saveSettings();
    });
  });

  bindField('#deepseek-key', () => settings.deepseekKey, (v) => (settings.deepseekKey = v.trim()));
  bindField('#api-key', () => settings.openrouterKey, (v) => (settings.openrouterKey = v.trim()));
  $('#btn-test-deepseek').addEventListener('click', () => runTest('deepseek'));
  $('#btn-test-openrouter').addEventListener('click', () => runTest('openrouter'));

  for (const [role, sel] of MODEL_FIELDS) {
    bindField(sel, () => settings.models[role], (v) => (settings.models[role] = v.trim()));
  }

  bindField('#id-name', () => settings.identity.name, (v) => (settings.identity.name = v));
  bindField('#id-email', () => settings.identity.email, (v) => (settings.identity.email = v));
  bindField('#id-website', () => settings.identity.website, (v) => (settings.identity.website = v.trim()));

  $('#summary-lang').value = settings.summaryLang || 'zh';
  $('#summary-lang').addEventListener('change', (e) => { settings.summaryLang = e.target.value; saveSettings(); });

  const timeoutEl = $('#ai-timeout');
  timeoutEl.value = Math.round((settings.aiTimeoutMs || 20000) / 1000);
  timeoutEl.addEventListener('change', () => {
    settings.aiTimeoutMs = Math.round(Number(timeoutEl.value) || 20) * 1000;
    saveSettings();
  });

  $('#lang-select').addEventListener('change', (e) => {
    settings.language = e.target.value;
    setLanguage(settings.language);
    applyI18n();
    saveSettings();
  });
}

init();
