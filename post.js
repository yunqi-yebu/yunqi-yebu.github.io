// 文章详情页：按 ?id= 读取已发布文章并渲染 Markdown（数据来自 Gitee 仓库）
const postEl = document.getElementById("post");

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
    const cover = p.cover_image ? `<img class="post-cover" src="${p.cover_image}" alt="" referrerpolicy="no-referrer" />` : "";
    const meta = [fmtDate(p.created_at), p.category ? escapeHtml(p.category) : ""].filter(Boolean).join(" · ");
    // 本机访问量：进入详情页 +1（30 秒内刷新不重复计数）
    const views = window.bumpViewCount ? window.bumpViewCount(p.id) : 0;
    const viewBadge = `<span class="view-count" title="本机访问次数">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7.5 11-7.5 11 7.5 11 7.5-4 7.5-11 7.5-11-7.5-11-7.5z"/><circle cx="12" cy="12" r="3"/></svg>${views}</span>`;

    const rawContent = window.normalizeParagraphs
      ? window.normalizeParagraphs(p.content || "") : (p.content || "");
    const bodyHtml = window.protectImageHtml(
      typeof marked !== "undefined" && marked.parse
        ? marked.parse(rawContent)
        : `<p>${rawContent.replace(/</g, "&lt;")}</p>`
    );

    postEl.innerHTML = `
      <a class="post-back" href="index.html">← 随笔列表</a>
      <h1 class="post-title">${escapeHtml(p.title)}</h1>
      <div class="post-meta">${meta}${tags ? " &nbsp; " + tags : ""}<span class="meta-right">${viewBadge}</span></div>
      ${cover}
      <div class="post-body">${bodyHtml}</div>
    `;
    // 应用本篇的排版参数（字号/行距/首行缩进），无设置时保持默认
    const typo = p.typography || {};
    const bodyEl = postEl.querySelector(".post-body");
    if (bodyEl) {
      if (typo.fontSize) bodyEl.style.fontSize = String(typo.fontSize) + "px";
      if (typo.lineHeight) bodyEl.style.lineHeight = String(typo.lineHeight);
      if (Number(typo.indent) === 0) bodyEl.classList.add("no-indent");
    }
    if (window.markImageParagraphs) window.markImageParagraphs(postEl);
    document.title = `${p.title} · 云栖野步`;
  } catch (err) {
    console.error(err);
    postEl.innerHTML = '<div class="empty">加载失败，请稍后重试。</div>';
  }
}

load();
