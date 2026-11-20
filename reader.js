// 读者端首页：拉取已发布随笔，按分类/标签筛选（数据来自 Gitee 仓库）
const essayListEl = document.getElementById("essay-list");
const categoryListEl = document.getElementById("category-list");
const tagListEl = document.getElementById("tag-list");

let allPosts = [];
let activeCategory = null;
let activeTag = null;

// 支持通过 URL 参数直接进入某分类/标签（如 index.html?cat=运动、index.html?tag=随笔）
const urlCat = new URLSearchParams(location.search).get("cat");
if (urlCat) activeCategory = urlCat;
const urlTag = new URLSearchParams(location.search).get("tag");
if (urlTag) activeTag = urlTag;

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

function renderChips() {
  const cats = [...new Set(allPosts.map((p) => p.category).filter(Boolean))];
  const tags = [...new Set(allPosts.flatMap((p) => p.tags || []).filter(Boolean))];

  categoryListEl.innerHTML =
    `<span class="chip ${!activeCategory ? "active" : ""}" data-cat="">全部</span>` +
    cats.map((c) => `<span class="chip ${activeCategory === c ? "active" : ""}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</span>`).join("");

  tagListEl.innerHTML =
    `<span class="chip ${!activeTag ? "active" : ""}" data-tag="">全部</span>` +
    tags.map((t) => `<span class="chip ${activeTag === t ? "active" : ""}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join("");

  categoryListEl.querySelectorAll(".chip").forEach((el) => {
    el.onclick = () => {
      activeCategory = el.dataset.cat || null;
      activeTag = null;
      renderChips();
      renderList();
    };
  });
  tagListEl.querySelectorAll(".chip").forEach((el) => {
    el.onclick = () => {
      activeTag = el.dataset.tag || null;
      activeCategory = null;
      renderChips();
      renderList();
    };
  });
}

function renderList() {
  let posts = allPosts;
  if (activeCategory) posts = posts.filter((p) => p.category === activeCategory);
  if (activeTag) posts = posts.filter((p) => (p.tags || []).includes(activeTag));

  if (!posts.length) {
    essayListEl.innerHTML = '<div class="empty">这里还没有内容。</div>';
    return;
  }

  // 全量渲染所有已发布文章：不设数量上限，列数由 CSS 自适应，
  // 当前已发布与后续新增的文章都会自动进入并列网格，无需改动代码。
  essayListEl.innerHTML = posts.map((p) => {
    const tags = (p.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");
    const cover = p.cover_image ? `<img class="essay-cover" src="${p.cover_image}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : "";
    const cat = p.category ? escapeHtml(p.category) : "";
    const metaLeft = [fmtDate(p.created_at), cat].filter(Boolean).join('<span class="dot">·</span>');
    // 访问量：本机 localStorage 计数，纯静态站无法统计所有访客
    const views = window.getViewCount ? window.getViewCount(p.id) : 0;
    const viewBadge = `<span class="view-count" title="本机访问次数">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7.5 11-7.5 11 7.5 11 7.5-4 7.5-11 7.5-11-7.5-11-7.5z"/><circle cx="12" cy="12" r="3"/></svg>${views}</span>`;
    return `
      <a class="essay" href="post.html?id=${p.id}">
        ${cover}
        <div class="essay-body">
          <h2 class="essay-title">${escapeHtml(p.title)}</h2>
          ${p.excerpt ? `<p class="essay-excerpt">${escapeHtml(p.excerpt)}</p>` : ""}
          ${tags ? `<div class="essay-tags">${tags}</div>` : ""}
          <div class="essay-meta">
            <span class="meta-left">${metaLeft}</span>
            ${viewBadge}
          </div>
        </div>
      </a>`;
  }).join("");
}

async function load() {
  try {
    allPosts = (await Cloud.getPosts())
      .filter((p) => p.status === "published")
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (!allPosts.length) {
      essayListEl.innerHTML = '<div class="empty">这里还没有发布任何随笔，去后台写第一篇吧。</div>';
      return;
    }
    renderChips();
    renderList();
  } catch (err) {
    console.error(err);
    essayListEl.innerHTML = '<div class="empty">加载失败，请稍后重试。</div>';
  }
}

load();

// 站点设置（标题/副标题/侧边栏导航/页脚）由后台维护，页面加载后套用
if (window.Cloud && Cloud.initChrome) Cloud.initChrome();
