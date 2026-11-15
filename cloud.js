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
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const safeExt = ["jpg", "jpeg", "png", "webp", "gif", "svg"].includes(ext) ? ext : "png";
  const fname = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
  const path = `${window.SITE.imageDir}/${fname}`;
  const b64 = await fileToBase64(file);
  const body = {
    message: "上传图片 · 云栖野步",
    content: b64,
    branch: window.SITE.branch,
  };
  await giteeFetch(
    `/repos/${window.SITE.owner}/${window.SITE.repo}/contents/${path}`,
    { method: "PUT", token, body }
  );
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

// 暴露到全局，供各页面调用
window.Cloud = {
  getPosts,
  getPost,
  verifyToken,
  loadForWrite,
  savePosts,
  uploadImage,
};
