// 读者端首页：拉取已发布随笔，按分类/标签筛选（数据来自 Gitee 仓库）
const essayListEl = document.getElementById("essay-list");
const categoryListEl = document.getElementById("category-list");
const tagListEl = document.getElementById("tag-list");

let allPosts = [];
let activeCategory = null;
let activeTag = null;

// 支持通过 URL 参数 ?cat=分类 直接进入某分类（如 index.html?cat=运动）
const urlCat = new URLSearchParams(location.search).get("cat");
if (urlCat) activeCategory = urlCat;

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}·${p(d.getMonth() + 1)}·${p(d.getDate())}`;
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

  essayListEl.innerHTML = posts.map((p) => {
    const tags = (p.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");
    const cover = p.cover_image ? `<img class="essay-cover" src="${p.cover_image}" alt="" loading="lazy" />` : "";
    const cat = p.category ? `<span>${escapeHtml(p.category)}</span>` : "";
    const meta = [fmtDate(p.created_at), cat].filter(Boolean).join('<span class="dot">·</span>');
    return `
      <a class="essay" href="post.html?id=${p.id}">
        ${cover}
        <h2 class="essay-title">${escapeHtml(p.title)}</h2>
        <div class="essay-meta">${meta}</div>
        ${p.excerpt ? `<p class="essay-excerpt">${escapeHtml(p.excerpt)}</p>` : ""}
        ${tags ? `<div class="essay-tags">${tags}</div>` : ""}
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
