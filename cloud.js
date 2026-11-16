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

// 公开读取文章列表（无需令牌）：返回数组
async function getPosts() {
  try {
    const json = await giteeFetch(
      `/repos/${window.SITE.owner}/${window.SITE.repo}/contents/${window.SITE.dataPath}`
    );
    const content = json.content ? b64ToUtf8(json.content) : "[]";
    return JSON.parse(content) || [];
  } catch (e) {
    console.warn("读取文章失败：", e);
    return [];
  }
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

// 保存文章列表（覆盖写入）
async function savePosts(posts, token, sha) {
  const body = {
    message: "更新随笔 · 云栖野步",
    content: utf8ToB64(JSON.stringify(posts, null, 2)),
    branch: window.SITE.branch,
  };
  if (sha) body.sha = sha;
  return giteeFetch(
    `/repos/${window.SITE.owner}/${window.SITE.repo}/contents/${window.SITE.dataPath}`,
    { method: "PUT", token, body }
  );
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
