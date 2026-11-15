// 后台：Gitee 私人令牌登录 + 随笔管理 + 可视化图文编辑（纯 Gitee 实现）
const root = document.getElementById("app-root");

// 登录态：令牌保存在 sessionStorage（仅当前浏览器标签页会话内有效）
let TOKEN = sessionStorage.getItem("gitee_token") || "";
let USER = sessionStorage.getItem("gitee_user") || "";
let state = { posts: [], sha: null };

// ---------------- 工具函数 ----------------
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function makeExcerpt(md) {
  const text = (md || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 100);
}
function parseTags(str) {
  return [...new Set((str || "").split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean))];
}
function setMsg(el, text, kind) {
  el.textContent = text || "";
  el.className = "form-msg" + (kind ? " " + kind : "");
}
function genId() {
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// 图片压缩为 Blob（限制宽度 + JPEG 质量），减小仓库体积
function compressImage(file, maxW = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxW) { height = Math.round((height * maxW) / width); width = maxW; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("图片压缩失败"))),
          "image/jpeg", quality
        );
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function uploadImage(file) {
  const blob = await compressImage(file, 1600, 0.82);
  return Cloud.uploadImage(blob, TOKEN);
}

// ---------------- 登录 ----------------
function renderAuth() {
  root.innerHTML = `
    <div class="auth-card">
      <h2>后 台 登 录</h2>
      <div class="hint">输入你的 Gitee 私人令牌即可进入写作后台</div>
      <div class="field">
        <label>Gitee 私人令牌</label>
        <input type="password" id="token-input" placeholder="粘贴你的 Gitee 私人令牌" autocomplete="off" />
      </div>
      <div class="form-msg" id="auth-msg"></div>
      <button class="btn" id="login-btn" style="width:100%">登 录</button>
      <div class="hint" style="margin-top:14px;line-height:1.7">
        令牌获取：Gitee 网页 → 右上角头像 → <b>设置</b> → <b>私人令牌</b> → <b>生成新令牌</b>，
        勾选 <b>projects</b> 权限，提交后复制那串字符。
      </div>
    </div>`

  document.getElementById("login-btn").onclick = async () => {
    const btn = document.getElementById("login-btn");
    const msg = document.getElementById("auth-msg");
    const token = document.getElementById("token-input").value.trim();
    if (!token) { setMsg(msg, "请粘贴令牌", "err"); return; }
    btn.disabled = true; setMsg(msg, "验证中…");
    try {
      const me = await Cloud.verifyToken(token);
      if (!me) throw new Error("令牌无效");
      TOKEN = token;
      USER = me.login || me.name || "我";
      sessionStorage.setItem("gitee_token", TOKEN);
      sessionStorage.setItem("gitee_user", USER);
      renderApp();
    } catch (e) {
      setMsg(msg, "登录失败：" + (e.message || "令牌无效或无 projects 权限"), "err");
      btn.disabled = false;
    }
  };
}

// ---------------- 主界面（管理列表） ----------------
async function renderApp() {
  root.innerHTML = `
    <div class="admin-top">
      <h1>随 笔 后 台</h1>
      <div class="admin-user">
        <span>${escapeHtml(USER)}</span>
        <button class="btn btn-ghost btn-sm" id="logout-btn" style="margin-left:12px">退出</button>
      </div>
    </div>
    <div style="margin-bottom:20px">
      <button class="btn" id="new-btn">＋ 写新随笔</button>
      <a class="btn btn-ghost" href="index.html" target="_blank" style="margin-left:8px">查看前台 →</a>
    </div>
    <div class="posts-manage" id="posts-manage"><div class="empty">加载中…</div></div>`;

  document.getElementById("logout-btn").onclick = () => {
    sessionStorage.removeItem("gitee_token");
    sessionStorage.removeItem("gitee_user");
    TOKEN = ""; USER = "";
    renderAuth();
  };
  document.getElementById("new-btn").onclick = () => renderEditor(null);

  await loadMyPosts();
}

async function loadMyPosts() {
  const wrap = document.getElementById("posts-manage");
  try {
    const data = await Cloud.loadForWrite(TOKEN);
    state.posts = data.posts || [];
    state.sha = data.sha || null;
    const posts = state.posts;

    if (!posts.length) {
      wrap.innerHTML = '<div class="empty">还没有随笔，点击上方「写新随笔」开始吧。</div>';
      return;
    }
    wrap.innerHTML = posts
      .slice()
      .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
      .map((p) => {
        const badge = p.status === "published"
          ? '<span class="status-badge status-published">已发布</span>'
          : '<span class="status-badge status-draft">草稿</span>';
        const pubBtn = p.status === "published" ? "取消发布" : "发布";
        return `
          <div class="manage-item" data-id="${p.id}">
            <div>
              <div class="mi-title">${escapeHtml(p.title)}${badge}</div>
              <div class="mi-meta">${fmtDate(p.created_at)} · ${escapeHtml(p.category || "未分类")}</div>
            </div>
            <div class="mi-actions">
              <button class="btn btn-ghost btn-sm act-edit">编辑</button>
              <button class="btn btn-ghost btn-sm act-pub">${pubBtn}</button>
              <button class="btn btn-ghost btn-sm act-del">删除</button>
            </div>
          </div>`;
      }).join("");

    wrap.querySelectorAll(".manage-item").forEach((item) => {
      const id = item.dataset.id;
      const post = posts.find((x) => String(x.id) === String(id));
      item.querySelector(".act-edit").onclick = () => renderEditor(post);
      item.querySelector(".act-pub").onclick = async () => {
        post.status = post.status === "published" ? "draft" : "published";
        post.updated_at = new Date().toISOString();
        await persist();
        loadMyPosts();
      };
      item.querySelector(".act-del").onclick = async () => {
        if (!confirm(`确定删除《${post.title}》？此操作不可恢复。`)) return;
        state.posts = state.posts.filter((x) => String(x.id) !== String(id));
        await persist();
        loadMyPosts();
      };
    });
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<div class="empty">加载失败：' + (err.message || "未知错误") + "</div>";
  }
}

// 保存文章列表到仓库（返回最新 sha）
async function persist() {
  const r = await Cloud.savePosts(state.posts, TOKEN, state.sha);
  if (r && r.content && r.content.sha) state.sha = r.content.sha;
  return r;
}

// ---------------- 编辑器 ----------------
function renderEditor(post) {
  const isEdit = !!post;
  const form = {
    title: post?.title || "",
    category: post?.category || "",
    tags: (post?.tags || []).join(", "),
    cover_image: post?.cover_image || "",
    content: post?.content || "",
    status: post?.status || "draft",
  };

  root.innerHTML = `
    <div class="admin-top">
      <h1>${isEdit ? "编 辑 随 笔" : "写 新 随 笔"}</h1>
      <button class="btn btn-ghost btn-sm" id="back-btn">← 返回列表</button>
    </div>

    <div class="editor-meta">
      <div class="field full">
        <label>标题</label>
        <input type="text" id="f-title" value="${escapeHtml(form.title)}" placeholder="给这篇随笔起个名字" />
      </div>
      <div class="field">
        <label>分类</label>
        <input type="text" id="f-category" list="cat-list" value="${escapeHtml(form.category)}" placeholder="如：生活 / 读书" />
        <datalist id="cat-list"></datalist>
      </div>
      <div class="field">
        <label>标签（逗号分隔）</label>
        <input type="text" id="f-tags" value="${escapeHtml(form.tags)}" placeholder="如：旅行, 随笔" />
      </div>
    </div>

    <div class="field">
      <label>封面图（可选）</label>
      <input type="file" id="f-cover" accept="image/*" />
      <div class="cover-preview" id="cover-preview"></div>
    </div>

    <div class="editor-toolbar">
      <button class="btn btn-ghost btn-sm" id="insert-img" type="button">插入图片</button>
      <input type="file" id="f-img" accept="image/*" style="display:none" />
      <div class="spacer"></div>
      <select id="f-status" class="btn btn-ghost btn-sm" style="padding:6px 10px">
        <option value="draft" ${form.status === "draft" ? "selected" : ""}>存为草稿</option>
        <option value="published" ${form.status === "published" ? "selected" : ""}>直接发布</option>
      </select>
      <button class="btn" id="save-btn">保 存</button>
    </div>

    <div class="editor-grid">
      <div class="editor-pane">
        <h3>正 文（支持 Markdown：# 标题、**加粗**、![图](地址)、> 引用、- 列表）</h3>
        <textarea id="md-input" placeholder="在此书写你的随笔…">${escapeHtml(form.content)}</textarea>
      </div>
      <div class="preview-pane">
        <h3>实 时 预 览</h3>
        <div id="preview"></div>
      </div>
    </div>
    <div class="form-msg" id="editor-msg" style="margin-top:16px"></div>`;

  document.getElementById("back-btn").onclick = () => renderApp();

  const titleEl = document.getElementById("f-title");
  const catEl = document.getElementById("f-category");
  const tagsEl = document.getElementById("f-tags");
  const mdEl = document.getElementById("md-input");
  const previewEl = document.getElementById("preview");
  const statusEl = document.getElementById("f-status");
  const coverInput = document.getElementById("f-cover");
  const coverPreview = document.getElementById("cover-preview");
  const msg = document.getElementById("editor-msg");

  // 分类候选
  try {
    const cats = [...new Set(state.posts.map((d) => d.category).filter(Boolean))];
    document.getElementById("cat-list").innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}">`).join("");
  } catch (_) {}

  // 封面预览
  function refreshCover() {
    coverPreview.innerHTML = form.cover_image ? `<img src="${form.cover_image}" alt="封面预览" />` : "";
  }
  refreshCover();
  coverInput.onchange = async () => {
    const file = coverInput.files[0];
    if (!file) return;
    try {
      setMsg(msg, "封面上传中…");
      form.cover_image = await uploadImage(file);
      refreshCover();
      setMsg(msg, "");
    } catch (e) { setMsg(msg, "封面上传失败：" + (e.message || "请重试"), "err"); }
  };

  // 实时预览
  function refreshPreview() {
    previewEl.innerHTML = (typeof marked !== "undefined" && marked.parse)
      ? marked.parse(mdEl.value)
      : mdEl.value.replace(/</g, "&lt;").replace(/\n/g, "<br>");
  }
  mdEl.oninput = refreshPreview;
  refreshPreview();

  // 插入图片到正文光标处
  const imgFile = document.getElementById("f-img");
  document.getElementById("insert-img").onclick = () => imgFile.click();
  imgFile.onchange = async () => {
    const file = imgFile.files[0];
    if (!file) return;
    setMsg(msg, "图片上传中…");
    try {
      const url = await uploadImage(file);
      const token = `\n![${file.name.replace(/\.[^.]+$/, "")}](${url})\n`;
      const start = mdEl.selectionStart, end = mdEl.selectionEnd;
      mdEl.value = mdEl.value.slice(0, start) + token + mdEl.value.slice(end);
      mdEl.focus();
      refreshPreview();
      setMsg(msg, "");
    } catch (e) { setMsg(msg, "图片插入失败：" + (e.message || "请重试"), "err"); }
    imgFile.value = "";
  };

  // 保存
  document.getElementById("save-btn").onclick = async () => {
    const btn = document.getElementById("save-btn");
    const title = titleEl.value.trim();
    const content = mdEl.value;
    if (!title) { setMsg(msg, "请填写标题", "err"); return; }
    if (!content.trim()) { setMsg(msg, "正文不能为空", "err"); return; }

    const now = new Date().toISOString();
    const payload = {
      title,
      excerpt: makeExcerpt(content),
      content,
      cover_image: form.cover_image || null,
      category: catEl.value.trim() || "未分类",
      tags: parseTags(tagsEl.value),
      status: statusEl.value,
      updated_at: now,
    };

    btn.disabled = true; setMsg(msg, "保存中…");
    try {
      if (isEdit) {
        const idx = state.posts.findIndex((x) => String(x.id) === String(post.id));
        state.posts[idx] = { ...state.posts[idx], ...payload };
      } else {
        state.posts.push({ id: genId(), created_at: now, ...payload });
      }
      await persist();
      renderApp();
    } catch (e) {
      setMsg(msg, "保存失败：" + (e.message || "未知错误"), "err");
      btn.disabled = false;
    }
  };
}

// ---------------- 启动 ----------------
async function boot() {
  if (TOKEN) {
    try {
      const me = await Cloud.verifyToken(TOKEN);
      if (me) { USER = me.login || USER; renderApp(); return; }
    } catch (_) {}
    sessionStorage.removeItem("gitee_token");
    TOKEN = "";
  }
  renderAuth();
}
boot();
