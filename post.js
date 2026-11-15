// 文章详情页：按 ?id= 读取已发布文章并渲染 Markdown（数据来自 Gitee 仓库）
const postEl = document.getElementById("post");

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()} 年 ${p(d.getMonth() + 1)} 月 ${p(d.getDate())} 日`;
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function load() {
  const id = new URLSearchParams(location.search).get("id");
  if (!id) {
    postEl.innerHTML = '<div class="empty">缺少文章 ID。<a href="index.html">返回列表</a></div>';
    return;
  }

  try {
    const p = await Cloud.getPost(id);
    if (!p || p.status !== "published") {
      postEl.innerHTML = '<div class="empty">文章不存在或未发布。<a href="index.html">返回列表</a></div>';
      return;
    }

    const tags = (p.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(" ");
    const cover = p.cover_image ? `<img class="post-cover" src="${p.cover_image}" alt="" />` : "";
    const meta = [fmtDate(p.created_at), p.category ? escapeHtml(p.category) : ""].filter(Boolean).join(" · ");

    const bodyHtml = typeof marked !== "undefined" && marked.parse
      ? marked.parse(p.content || "")
      : `<p>${(p.content || "").replace(/</g, "&lt;")}</p>`;

    postEl.innerHTML = `
      <a class="post-back" href="index.html">← 随笔列表</a>
      <h1 class="post-title">${escapeHtml(p.title)}</h1>
      <div class="post-meta">${meta}${tags ? " &nbsp; " + tags : ""}</div>
      ${cover}
      <div class="post-body">${bodyHtml}</div>
    `;
    document.title = `${p.title} · 云栖野步`;
  } catch (err) {
    console.error(err);
    postEl.innerHTML = '<div class="empty">加载失败，请稍后重试。</div>';
  }
}

load();
