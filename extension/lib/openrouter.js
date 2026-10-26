/**
 * AI 业务角色（分类/表单/摘要/评论等）。底层请求走 lib/llm/client 多服务商适配。
 */
import { LIMITS } from './config.js';
import { chat, chatJSON } from './llm/client.js';

export { chat, chatJSON, getModel, testKey, testConnection, hasConfiguredKey } from './llm/client.js';

// ================= 四个 AI 角色 =================

/** 链接分类：判断页面是否为免登录可评论的博客文章 */
export async function classifyPage({ url, title, text }) {
  const system = [
    '你是网页分类助手。判断给定网页是否属于以下类型：',
    '- blog_comment：博客文章页，且无需登录/注册即可发表评论（如 WordPress 文章带评论表单）',
    '- profile：个人主页/关于页等可直接留下链接的页面',
    '- other：其他（论坛需登录、电商、纯列表页、需要注册等）',
    '只输出 JSON：{"type":"blog_comment|profile|other","commentable":true/false,"reason":"简短中文原因"}',
  ].join('\n');
  const user = `URL: ${url}\n标题: ${title || '(无)'}\n正文摘录:\n${(text || '').slice(0, LIMITS.articleTextChunk)}`;
  const out = await chatJSON('classify', system, user, { maxTokens: 800, temperature: 0.1 });
  return {
    type: ['blog_comment', 'profile'].includes(out.type) ? out.type : 'other',
    commentable: !!out.commentable,
    reason: out.reason || '',
  };
}

/** 表单识别：从评论表单 HTML 中识别各字段选择器 */
export async function detectForm({ formHtml, pageUrl }) {
  const system = [
    '你是表单识别助手。从博客评论表单的 HTML 中找出各字段对应的 CSS 选择器。',
    '优先使用 id 选择器（如 #comment），其次 name 属性（如 textarea[name="comment"]）。',
    'linkMethod 表示该站留外链的方式：website_field(有独立网址输入框) / comment_body(只能在正文放链接) / author_link(昵称带链接)。',
    '只输出 JSON：',
    '{"comment":"正文选择器","author":"昵称选择器","email":"邮箱选择器","url":"网址选择器(无则空串)",',
    ' "submit":"提交按钮选择器","saveInfo":"记住我复选框选择器(无则空串)","linkMethod":"website_field","formSelector":"表单选择器"}',
    '找不到的字段给空字符串。',
  ].join('\n');
  const user = `页面: ${pageUrl}\n表单 HTML:\n${(formHtml || '').slice(0, LIMITS.formHtmlChunk)}`;
  const out = await chatJSON('formDetect', system, user, { maxTokens: 1000, temperature: 0.1 });
  return out;
}

/**
 * 标题与摘要：把可能截断的长正文提炼成摘要，同时给出指定语言的标题（原文不同语言则翻译），
 * 并识别文章正文语言（生成评论时评论语言跟随文章语言）。
 * lang ∈ zh/en（标题与摘要的输出语言）；返回 { title, summary, language }。
 */
export async function summarizeArticle({ title, text, lang = 'zh' }) {
  const langName = lang === 'en' ? '英文' : '中文';
  const system = [
    '你是文章摘要助手。阅读给定博客文章，输出三样东西：',
    `1. title：文章标题的${langName}版本（原文已是${langName}则原样保留，否则翻译）；`,
    `2. summary：用 3-5 句${langName}概括核心观点、关键论据和结论，保留具体细节（人名、数据、步骤、推荐），不要泛泛而谈；`,
    '3. language：文章正文使用的语言名（如 "中文"、"English"、"日本語"）。',
    '只输出 JSON：{"title":"...","summary":"...","language":"..."}',
  ].join('\n');
  const user = `文章标题: ${title || '(无)'}\n正文:\n${(text || '').slice(0, LIMITS.articleTextChunk)}`;
  const out = await chatJSON('classify', system, user, { maxTokens: 1000, temperature: 0.3 });
  const summary = String(out.summary || '').trim().slice(0, 1000);
  if (!summary) throw new Error('摘要为空');
  return {
    title: String(out.title || '').trim().slice(0, 200) || title || '',
    summary,
    language: String(out.language || '').trim().slice(0, 30),
  };
}

/** 评论身份：根据文章内容生成不起眼的读者昵称与邮箱 */
export async function generateIdentity({ title, text }) {
  const system = [
    '为一条博客评论生成一个真实感的读者身份。',
    'name：普通的英文昵称/人名（不要名人、不要关键词堆砌）。',
    'email：与之匹配的邮箱，使用常见免费邮箱域名（gmail.com / outlook.com / yahoo.com 等），用户名部分像真人。',
    '只输出 JSON：{"name":"...","email":"..."}',
  ].join('\n');
  const user = `文章标题: ${title || '(无)'}\n文章摘要:\n${(text || '').slice(0, 800)}`;
  const out = await chatJSON('classify', system, user, { maxTokens: 600, temperature: 0.9 });
  const name = String(out.name || '').trim().slice(0, 40);
  const email = String(out.email || '').trim().slice(0, 60);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('生成的身份不合法');
  return { name, email };
}

/**
 * 把占位符替换成 <a> 链接：href 的右引号前插入换行（<a href="url\n">锚文本</a>）。
 * 没有占位符时链接追加到正文末尾；锚文本兜底用主关键词。
 */
export function buildCommentWithLink(text, targetUrl, fallbackAnchor) {
  const link = (anchor) => `<a href="${targetUrl}\n">${anchor}</a>`;
  const src = String(text || '').trim();
  const m = src.match(/\{\{LINK:([^}]+)\}\}/);
  if (m) {
    const anchor = m[1].trim().slice(0, 100) || fallbackAnchor;
    return src.replace(/\s*\{\{LINK:[^}]+\}\}/, ' ' + link(anchor)).trim();
  }
  return `${src} ${link(fallbackAnchor)}`.trim();
}

/**
 * 评论生成：自然相关评论（语言跟随文章）+ 正文内嵌主关键词变体锚链接（website 字段留空，链接只走正文）。
 */
export async function generateComment({ url, title, text }, { targetUrl, siteIntro = '', mainKeyword = '', articleLang = '' } = {}) {
  const system = [
    '你是一位真实的博客读者，要给一篇博客文章写一条自然、相关、有观点的评论。',
    articleLang
      ? `评论必须使用${articleLang}书写（与文章语言一致，这是硬性要求）。`
      : '评论必须使用与文章相同的语言书写（这是硬性要求）。',
    '写作依据是下方 AI 生成的文章标题与摘要：评论要围绕摘要里的具体论点或细节展开，不要泛泛而谈。',
    '要求：2-4 句，口语化、具体地回应文章观点；像真人，不要奉承开头（不要用 "Great post!" 这类空洞话）；',
    '不要出现 markdown；不要暴露你是 AI。',
    targetUrl ? [
      '评论中要用 {{LINK:锚文本}} 占位符标出提到我网站的链接位置（必须且仅一次）。',
      '关键要求——链接必须与文章正文有真实交集：先从摘要里找一个和我的网站主题能自然衔接的场景、需求或步骤，',
      '围绕它写一句你自己的真实经历或看法，再把链接嵌进这一句里，让读者觉得提到这个网站顺理成章。',
      '禁止生硬插入：不要在无关句子的句尾甩链接，不要用 "顺便推荐一个网站" 这类突兀话术。',
      '占位符绝不能省略：找不到直接交集时，就写使用这类产品/服务的通用真实体验，把链接嵌进那句里；',
      '哪怕只是使用场景相似也要自然带出——不带链接的评论是无效评论。',
      `锚文本要求：基于我的主关键词「${mainKeyword || siteIntro || targetUrl}」做变体——可加相关前缀/后缀、同义词或长尾组合`,
      '（例如 "best X"、"X for beginners"、"cheap X alternatives"），不要每次都用一模一样的裸关键词；锚文本要与所在句子的语义连贯。',
      `我的网站：${targetUrl}${siteIntro ? `\n网站介绍：${siteIntro}` : ''}`,
    ].join('\n') : '不要在评论里放任何链接，也不要输出占位符。',
  ].join('\n');
  const user = [
    `文章标题: ${title || '(无)'}`,
    `文章 URL: ${url}`,
    `文章语言: ${articleLang || '(未识别，请自行判断)'}`,
    '文章摘要:',
    (text || '').slice(0, LIMITS.articleTextChunk),
  ].join('\n');
  const call = (extra) => chat('commentGen', [
    { role: 'system', content: extra ? `${system}\n${extra}` : system },
    { role: 'user', content: user },
  ], { maxTokens: 1500, temperature: 0.8, json: false });

  const first = (await call()).trim();
  if (!targetUrl) return first.replace(/\s*\{\{LINK:[^}]+\}\}/g, '');
  if (/\{\{LINK:[^}]*\}\}/.test(first)) return buildCommentWithLink(first, targetUrl, mainKeyword || 'this website');
  const retry = (await call('注意：上一次输出没有包含 {{LINK:锚文本}} 占位符，这次必须包含且仅一次——从摘要里找与我网站主题最接近的点自然带出。')).trim();
  if (/\{\{LINK:[^}]*\}\}/.test(retry)) return buildCommentWithLink(retry, targetUrl, mainKeyword || 'this website');
  throw new Error('评论未带链接：AI 两次输出都未包含链接占位符');
}

/** 评论译文：目标语言同 summaryLang，仅供助手页展示 */
export async function translateComment(comment, lang = 'zh') {
  const langName = lang === 'en' ? '英文' : '中文';
  const system = [
    `你是翻译助手。把给定的博客评论翻译成${langName}，忠实原意、保持口语化语气。`,
    '评论中可能含有 HTML 标签（如 <a>）：翻译时去掉所有 HTML 标签，只保留纯文本。',
    '只输出译文本身，不要输出任何解释。',
  ].join('\n');
  const text = await chat('commentGen', [
    { role: 'system', content: system },
    { role: 'user', content: String(comment || '').slice(0, 2000) },
  ], { maxTokens: 800, temperature: 0.3, json: false });
  const out = text.trim().slice(0, 2000);
  if (!out) throw new Error('译文为空');
  return out;
}

/** 链接发现：从列表页 HTML 提取候选文章链接（拦截不到 API 时的兜底） */
export async function discoverLinks(html, baseUrl) {
  const system = [
    '从网页 HTML 中提取所有指向文章/详情页的链接（排除导航、分类、标签、登录、页脚链接）。',
    '只输出 JSON：{"links":["绝对URL1","绝对URL2",...]}，最多 50 条。',
  ].join('\n');
  const user = `基准地址: ${baseUrl}\nHTML:\n${(html || '').slice(0, LIMITS.discoverHtmlChunk)}`;
  const out = await chatJSON('discover', system, user, { maxTokens: 2500, temperature: 0.1 });
  return Array.isArray(out.links) ? out.links.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u)) : [];
}
