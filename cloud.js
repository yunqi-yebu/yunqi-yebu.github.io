// ===== Gitee 数据层（浏览器端直接调用 Gitee 接口）=====
// 文章以 JSON 文件形式存于仓库 data/posts.json；图片存于 data/images/。
// 重要：公开读取无需令牌；写入（发布文章/上传图片）需要仓库的私人令牌（projects 权限）。

function utf8ToB64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64ToUtf8(b64) {
  return decodeURIComponent(escape(atob(b64.replace(/\s/g, ""))));
}

// 通用 Gitee 接口请求
async function giteeFetch(path, { method = "GET", token, body } = {}) {
  const url = new URL(window.GITEE_API + path);
  if (token) url.searchParams.set("access_token", token);
  const res = await fetch(url.toString(), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  if (!res.ok) {
    const msg = (json && (json.message || json.msg)) || `请求失败(${res.status})`;
    throw new Error(msg);
  }
  return json;
}

// 首选：与站点同源的 data/*.json（发布通道会把 Gitee 数据镜像到 Pages 仓库，同源读取无跨域/限流问题）
async function fetchSameOrigin(path) {
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`同源读取失败(${res.status})`);
  let text = await res.text();
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 去 BOM
  return text;
}

// 匿名读取仓库文本文件：先走 contents API，被 Gitee 限流(403)时回退 raw 直链。
// 注意：两者均无 CORS 头，仅供无跨域限制的场景使用；浏览器端读取请走 fetchSameOrigin。
async function fetchPublicFile(path) {
  try {
    const json = await giteeFetch(
      `/repos/${window.SITE.owner}/${window.SITE.repo}/contents/${path}`
    );
    if (json && json.content) return b64ToUtf8(json.content);
  } catch (e) {
    console.warn("contents API 读取失败，尝试 raw 直链：", e && e.message);
  }
  const rawUrl = `https://gitee.com/${window.SITE.owner}/${window.SITE.repo}/raw/${window.SITE.branch}/${path}?t=${Date.now()}`;
  const res = await fetch(rawUrl, { referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(`raw 直链读取失败(${res.status})`);
  return await res.text();
}

// 公开读取文章列表（无需令牌）：返回数组；彻底失败时抛错（调用方展示"加载失败"而非误报"没有文章"）
async function getPosts() {
  try {
    const text = await fetchSameOrigin(window.SITE.dataPath);
    const data = JSON.parse(text);
    if (Array.isArray(data)) return data;
  } catch (e) {
    console.warn("同源文章数据不可用，回退 Gitee：", e && e.message);
  }
  const text = await fetchPublicFile(window.SITE.dataPath);
  const data = JSON.parse(text.replace(/^\uFEFF/, ""));
  if (!Array.isArray(data)) throw new Error("文章数据格式异常");
  return data;
}

// 按 id 取单篇
async function getPost(id) {
  const posts = await getPosts();
  return posts.find((p) => String(p.id) === String(id)) || null;
}

// 校验私人令牌是否有效
async function verifyToken(token) {
  const json = await giteeFetch("/user", { token });
  return json && json.login ? json : null;
}

// 读取文章（含 sha，用于写入）
async function loadForWrite(token) {
  try {
    const json = await giteeFetch(
      `/repos/${window.SITE.owner}/${window.SITE.repo}/contents/${window.SITE.dataPath}`,
      { token }
    );
    const content = json.content ? b64ToUtf8(json.content) : "[]";
    return { posts: JSON.parse(content) || [], sha: json.sha || null };
  } catch (e) {
    return { posts: [], sha: null }; // 文件不存在则从头创建
  }
}

// ===== 服务端 Webhook 即时同步（发布即上线）=====
// 后台每次保存/发布/站点设置成功后立即触发事件；服务端收到后把 Gitee 数据
// 镜像到 GitHub Pages 仓库。事件驱动，无定时器、无轮询、无 1 小时等待。
// fire-and-forget：同步服务不可用时静默降级，绝不阻塞或中断原有保存流程。
function notifySync() {
  const url = window.SYNC && window.SYNC.endpoint;
  if (!url) return;
  try {
    fetch(url, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "text/plain" }, // 简单请求，避开 CORS 预检
      body: "sync",
      keepalive: true,                            // 页面跳转/关闭也能发出
      cache: "no-store",
    }).catch(() => {});
  } catch (_) {}
}

// 保存文章列表（覆盖写入）
async function savePosts(posts, token, sha) {
  const body = {
    message: "更新随笔 · 云栖野步",
    content: utf8ToB64(JSON.stringify(posts, null, 2)),
    branch: window.SITE.branch,
  };
  if (sha) body.sha = sha;
  const res = await giteeFetch(
    `/repos/${window.SITE.owner}/${window.SITE.repo}/contents/${window.SITE.dataPath}`,
    { method: "PUT", token, body }
  );
  notifySync(); // 发布/保存成功后立即触发服务端同步
  return res;
}

// 上传图片，返回可公开访问的直链
async function uploadImage(file, token) {
  // file 可能是压缩后的 Blob（无 name 属性），需兜底；后台压缩输出为 JPEG，默认用 jpg
  const rawName = file.name || "image.jpg";
  const ext = (rawName.split(".").pop() || "jpg").toLowerCase();
  const safeExt = ["jpg", "jpeg", "png", "webp", "gif", "svg"].includes(ext) ? ext : "jpg";
  const fname = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
  const path = `${window.SITE.imageDir}/${fname}`;
  const b64 = await fileToBase64(file);
  const body = {
    message: "上传图片 · 云栖野步",
    content: b64,
    branch: window.SITE.branch,
  };
  const apiPath = `/repos/${window.SITE.owner}/${window.SITE.repo}/contents/${path}`;
  // Gitee API：新建文件必须用 POST；更新已存在文件用 PUT 且必须带 sha。
  // 图片文件名含时间戳几乎不会重复，但为稳妥先探测是否存在，再决定方法。
  let sha = null;
  try {
    const existing = await giteeFetch(apiPath, { token });
    if (existing && existing.sha) sha = existing.sha;
  } catch (_) { /* 404 表示文件不存在，按新建处理 */ }
  if (sha) {
    body.sha = sha;
    await giteeFetch(apiPath, { method: "PUT", token, body });
  } else {
    await giteeFetch(apiPath, { method: "POST", token, body });
  }
  return `${window.RAW_BASE}/${path}`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ===== 图片防盗链处理 =====
// Gitee raw 直链对外站 Referer 有防盗链：从 GitHub Pages 加载图片时会被替换成 favicon。
// 解决方案：给 HTML 中所有 <img> 补 referrerpolicy="no-referrer"，浏览器请求时不带 Referer。
function protectImageHtml(html) {
  return (html || "").replace(/<img\b([^>]*)>/gi, (full, attrs) => {
    if (/\breferrerpolicy\s*=/i.test(attrs)) return full; // 已有则跳过
    return `<img${attrs} referrerpolicy="no-referrer">`;
  });
}

// ===== 段落规范化 =====
// 随笔按中文习惯"一行一段"书写，但 Markdown 默认把单换行合并进同一段，
// 导致首行缩进无法逐段生效。渲染前把普通文字行的单换行补成段落分隔，
// 同时保留代码块、列表、引用、表格等块结构不被拆散。
function normalizeParagraphs(md) {
  const lines = String(md || "").split(/\r?\n/);
  const out = [];
  let inFence = false;
  const isBlock = (s) => /^\s*(#{1,6}\s|>|[-*+]\s|\d+\.\s|\|)/.test(s);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^\s*```/.test(trimmed)) { inFence = !inFence; out.push(line); continue; }
    out.push(line);
    if (inFence) continue;
    const next = lines[i + 1];
    if (next === undefined) continue;
    const nt = next.trim();
    if (!trimmed || !nt) continue;                 // 已有空行，保持原样
    if (/^!\[/.test(trimmed)) { out.push(""); continue; } // 图片独立成段
    if (isBlock(trimmed) && isBlock(nt)) continue;  // 列表/表格连续行不拆
    if (!isBlock(trimmed) && !isBlock(nt)) out.push(""); // 普通文字：一行一段
  }
  return out.join("\n");
}

// 暴露到全局，供各页面调用
window.Cloud = {
  getPosts,
  getPost,
  verifyToken,
  loadForWrite,
  savePosts,
  uploadImage,
};
window.protectImageHtml = protectImageHtml;
window.normalizeParagraphs = normalizeParagraphs;

// ===== 本机访问量 =====
// 纯静态站没有后端，访问量用浏览器 localStorage 按文章在本机计数：
// 每打开一次文章详情 +1；30 秒内重复打开同一篇不重复计数（避免刷新刷量）。
const VIEWS_KEY = "yqyb_view_counts";
const VIEWS_GAP_MS = 30 * 1000;

function loadViewStore() {
  try { return JSON.parse(localStorage.getItem(VIEWS_KEY) || "{}"); } catch (_) { return {}; }
}
function saveViewStore(s) {
  try { localStorage.setItem(VIEWS_KEY, JSON.stringify(s)); } catch (_) {}
}
function getViewCount(id) {
  if (!id) return 0;
  const s = loadViewStore();
  return (s[id] && s[id].count) || 0;
}
function bumpViewCount(id) {
  if (!id) return 0;
  const s = loadViewStore();
  const now = Date.now();
  const rec = s[id] || { count: 0, last: 0 };
  if (now - (rec.last || 0) > VIEWS_GAP_MS) rec.count += 1;
  rec.last = now;
  s[id] = rec;
  saveViewStore(s);
  return rec.count;
}

// 给"含图片的段落"打标记，作为 CSS :has() 在旧浏览器不支持时的兜底
function markImageParagraphs(container) {
  if (!container) return;
  container.querySelectorAll("p").forEach((p) => {
    if (p.querySelector("img")) p.classList.add("has-img");
  });
}
window.markImageParagraphs = markImageParagraphs;
window.getViewCount = getViewCount;
window.bumpViewCount = bumpViewCount;

// ===== 站点设置（标题/副标题/侧边栏导航/关于我）=====
// 存于仓库 data/site.json，与文章数据同一套读写方式；后台可编辑，前台读取后渲染。
// 文件不存在时用 DEFAULT_SITE（与页面内置的默认文案一致），保证站点始终可用。
const DEFAULT_SITE = {
  title: "云栖野步",
  subtitle: "做 知 识 传 递 的 催 化 剂",
  footer: "© 云栖野步 · 由 Gitee 免费托管",
  nav: [
    { label: "首页", href: "index.html" },
    { label: "运动", href: "index.html?cat=运动" },
    { label: "随笔", href: "index.html?cat=随笔" },
    { label: "关于我", href: "about.html" },
  ],
  subNav: [{ label: "后台写作 →", href: "admin.html" }],
  about: {
    title: "关于我",
    note: "",
    content: "这里写一段关于你的介绍……\n\n可以介绍你的兴趣、写作方向，或者任何想对读者说的话。",
    rules: [
      "浏览本站无需注册登录；发表评论同样免登录，但须经博主人工确认后才会展示。",
      "评论区内欢迎真诚交流，谢绝广告、引战及任何违法违规内容，违者一律移除。",
      "站内文字与图片均为本人原创记录，如需引用或转载，请事先告知并注明来源。",
      "全站内容遵循知识共享「署名—非商业性使用—禁止演绎 4.0」许可协议（CC BY-NC-ND 4.0）。",
    ],
  },
};
const SITE_CACHE_KEY = "yqyb_site_cache";

function normalizeSite(raw) {
  const base = JSON.parse(JSON.stringify(DEFAULT_SITE));
  const s = Object.assign(base, raw || {});
  s.nav = Array.isArray(s.nav) ? s.nav : base.nav;
  s.subNav = Array.isArray(s.subNav) ? s.subNav : base.subNav;
  s.about = Object.assign({}, DEFAULT_SITE.about, s.about || {});
  // 站点说明列表：允许字符串数组或换行分隔的字符串，统一转为非空字符串数组
  let rules = s.about.rules;
  if (typeof rules === "string") rules = rules.split("\n");
  s.about.rules = Array.isArray(rules)
    ? rules.map((r) => String(r).trim()).filter(Boolean)
    : DEFAULT_SITE.about.rules;
  s.nav = s.nav.filter((it) => it && (it.label || it.href));
  s.subNav = s.subNav.filter((it) => it && (it.label || it.href));
  return s;
}

// 公开读取站点设置（无需令牌）；失败时退回本机缓存，再退回默认值
// 镜像与本机缓存按 updated_at 取较新者：后台刚保存、镜像尚未同步完成的几秒内，
// 前台刷新也能立刻显示新增栏目，不会被旧镜像反向覆盖。
function pickNewerSite(remote, cached) {
  const ts = (s) => (s && Date.parse(s.updated_at)) || 0;
  return ts(cached) > ts(remote) ? cached : remote;
}
async function getSite() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(SITE_CACHE_KEY) || "null"); } catch (_) {}
  // 同源镜像优先（发布通道保持同步），失败再走 Gitee，最后回退缓存/默认
  try {
    const text = await fetchSameOrigin(window.SITE.sitePath);
    const data = text ? JSON.parse(text.replace(/^\uFEFF/, "")) : null;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const chosen = pickNewerSite(data, cached);
      try { localStorage.setItem(SITE_CACHE_KEY, JSON.stringify(chosen)); } catch (_) {}
      return normalizeSite(chosen);
    }
  } catch (_) {}
  try {
    const text = await fetchPublicFile(window.SITE.sitePath);
    const data = text ? JSON.parse(text.replace(/^\uFEFF/, "")) : null;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const chosen = pickNewerSite(data, cached);
      try { localStorage.setItem(SITE_CACHE_KEY, JSON.stringify(chosen)); } catch (_) {}
      return normalizeSite(chosen);
    }
  } catch (_) { /* 文件不存在属正常情况 */ }
  return normalizeSite(cached || DEFAULT_SITE);
}

// 读取站点设置（含 sha，用于写入）
async function loadSiteForWrite(token) {
  try {
    const json = await giteeFetch(
      `/repos/${window.SITE.owner}/${window.SITE.repo}/contents/${window.SITE.sitePath}`,
      { token }
    );
    const content = json.content ? b64ToUtf8(json.content) : "{}";
    return { site: normalizeSite(JSON.parse(content) || {}), sha: json.sha || null };
  } catch (e) {
    return { site: normalizeSite({}), sha: null }; // 文件不存在则新建
  }
}

// 保存站点设置（已存在则 PUT+sha，不存在则 POST 新建）
async function saveSite(site, token, sha) {
  const path = `/repos/${window.SITE.owner}/${window.SITE.repo}/contents/${window.SITE.sitePath}`;
  const body = {
    message: "更新站点设置 · 云栖野步",
    content: utf8ToB64(JSON.stringify(site, null, 2)),
    branch: window.SITE.branch,
  };
  let useSha = sha;
  if (!useSha) {
    try {
      const existing = await giteeFetch(path, { token });
      if (existing && existing.sha) useSha = existing.sha;
    } catch (_) {}
  }
  if (useSha) {
    body.sha = useSha;
    const res = await giteeFetch(path, { method: "PUT", token, body });
    notifySync();
    return res;
  }
  const res = await giteeFetch(path, { method: "POST", token, body });
  notifySync();
  return res;
}

function siteEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
// 判断导航项是否当前页（用于高亮），支持 index.html?cat=xxx 这类带参数的链接
function navIsActive(href) {
  const [path, qs] = String(href || "").split("?");
  const curPath = location.pathname.split("/").pop() || "index.html";
  const p = path || "index.html";
  if (p !== curPath) return false;
  const target = new URLSearchParams(qs || "");
  const cur = new URLSearchParams(location.search);
  if (![...target.keys()].length) return cur.toString() === "";
  for (const [k, v] of target) if (cur.get(k) !== v) return false;
  return true;
}
function renderNavList(container, items) {
  if (!container || !Array.isArray(items)) return;
  container.innerHTML = items.map((it) => {
    const active = navIsActive(it.href) ? ' class="active"' : "";
    return `<a href="${siteEsc(it.href || "#")}"${active}>${siteEsc(it.label || "")}</a>`;
  }).join("");
}

// 把站点设置应用到当前页面：标题、副标题、侧边栏导航、页脚、浏览器标题
function applySiteChrome(site) {
  const s = normalizeSite(site);
  document.querySelectorAll(".site-title").forEach((el) => { el.textContent = s.title; });
  document.querySelectorAll(".site-sub").forEach((el) => { el.textContent = s.subtitle; });
  document.querySelectorAll("[data-site-footer]").forEach((el) => { el.textContent = s.footer; });
  renderNavList(document.querySelector(".site-nav:not(.site-nav-sub)"), s.nav);
  renderNavList(document.querySelector(".site-nav-sub"), s.subNav);
  if (document.title && document.title.indexOf("云栖野步") >= 0) {
    document.title = document.title.split("云栖野步").join(s.title);
  }
  window.__site = s;
  return s;
}

// 各页面启动时调用：先套用本机缓存（无闪烁），再拉取最新设置
function initChrome() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(SITE_CACHE_KEY) || "null"); } catch (_) {}
  if (cached) applySiteChrome(cached);
  return getSite().then((s) => {
    applySiteChrome(s);
    if (typeof window.onSiteLoaded === "function") window.onSiteLoaded(s);
    return s;
  });
}

Object.assign(window.Cloud, {
  getSite, loadSiteForWrite, saveSite, applySiteChrome, initChrome,
});
window.DEFAULT_SITE = DEFAULT_SITE;
