// ===== 后台编辑模块：美篇式块编辑器 + 图片在线编辑器（裁剪/旋转/缩放/多图合并） =====
// BlockEditor：正文由"文字块/图片块"组成，可拖拽排序，保存时序列化回 Markdown 存入仓库。
// ImageEditor：Canvas 编辑弹窗，支持裁剪、旋转、缩放、多图合并，全程即时预览。
// 与 admin.js 的衔接：admin.js 提供 upload(blob)（上传 Gitee 返回 URL）与 onChange（刷新预览）。

// ---------------- Markdown <-> 块 ----------------
function mdToBlocks(md) {
  const blocks = [];
  const lines = String(md || "").split(/\r?\n/);
  let buf = [];
  const flush = () => {
    if (buf.length) { blocks.push({ type: "text", text: buf.join("\n") }); buf = []; }
  };
  for (const line of lines) {
    const m = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (m) { flush(); blocks.push({ type: "image", url: m[2], alt: m[1] || "" }); }
    else if (line.trim() === "") flush();
    else buf.push(line);
  }
  flush();
  return blocks.length ? blocks : [{ type: "text", text: "" }];
}
function blocksToMd(blocks) {
  return (blocks || [])
    .map((b) => b.type === "image"
      ? "\n![" + String(b.alt || "").replace(/[\[\]]/g, "") + "](" + b.url + ")\n"
      : String(b.text || "").trim())
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------- 块编辑器 ----------------
const BlockEditor = (() => {
  let host, opts, blocks = [];
  let dragIdx = null;

  function mount(el, options) {
    host = el;
    opts = options || {};
    blocks = mdToBlocks(opts.markdown || "");
    render();
    return {
      getMarkdown: () => blocksToMd(blocks),
      isEmpty: () => !blocks.some((b) => (b.type === "text" && String(b.text).trim()) || b.type === "image"),
    };
  }
  function changed() { if (opts.onChange) opts.onChange(); }
  function autosize(ta) { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }

  function render() {
    host.innerHTML = "";
    blocks.forEach((b, i) => {
      host.appendChild(buildBlock(b, i));
      host.appendChild(buildAddBar(i + 1));
    });
    if (!blocks.length) host.appendChild(buildAddBar(0));
    changed();
  }

  function buildAddBar(at) {
    const bar = document.createElement("div");
    bar.className = "blk-addbar";
    bar.innerHTML = '<span class="blk-addline"></span>' +
      '<button type="button" class="blk-add-btn" data-add="text" data-at="' + at + '">＋ 文字</button>' +
      '<button type="button" class="blk-add-btn" data-add="image" data-at="' + at + '">＋ 图片</button>' +
      '<span class="blk-addline"></span>';
    bar.querySelectorAll(".blk-add-btn").forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.at);
        if (btn.dataset.add === "text") {
          blocks.splice(idx, 0, { type: "text", text: "" });
          render();
          const tas = host.querySelectorAll("textarea.blk-text");
          const target = tas[Math.min(idx, tas.length - 1)];
          if (target) { target.focus(); autosize(target); }
        } else {
          ImageEditor.pickFiles({ upload: opts.upload, token: opts.token })
            .then((items) => {
              // items: [{url, alt}]，按选择顺序插入
              items.forEach((it, k) => blocks.splice(idx + k, 0, { type: "image", url: it.url, alt: it.alt }));
              render();
            }).catch(() => {});
        }
      };
    });
    return bar;
  }

  function buildBlock(b, i) {
    const blk = document.createElement("div");
    blk.className = "blk blk-" + b.type;
    blk.dataset.idx = i;

    const bar = document.createElement("div");
    bar.className = "blk-bar";
    bar.innerHTML =
      '<span class="blk-handle" title="拖拽排序" draggable="true">⠿</span>' +
      '<button type="button" class="blk-ctl" data-mv="-1" title="上移">↑</button>' +
      '<button type="button" class="blk-ctl" data-mv="1" title="下移">↓</button>' +
      '<button type="button" class="blk-ctl danger" data-del="1" title="删除块">✕</button>';

    bar.querySelector(".blk-handle").addEventListener("dragstart", (e) => {
      dragIdx = i;
      e.dataTransfer.effectAllowed = "move";
      blk.classList.add("dragging");
    });
    bar.querySelector(".blk-handle").addEventListener("dragend", () => {
      dragIdx = null; blk.classList.remove("dragging");
      host.querySelectorAll(".drop-hint").forEach((x) => x.classList.remove("drop-hint"));
    });
    bar.querySelectorAll(".blk-ctl").forEach((btn) => {
      btn.onclick = () => {
        if (btn.dataset.del) {
          if (!confirm("删除这个块？")) return;
          blocks.splice(i, 1); render(); return;
        }
        const j = i + Number(btn.dataset.mv);
        if (j < 0 || j >= blocks.length) return;
        [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
        render();
      };
    });

    const body = document.createElement("div");
    body.className = "blk-body";
    if (b.type === "text") {
      const ta = document.createElement("textarea");
      ta.className = "blk-text";
      ta.placeholder = "输入文字…（保留原有 Markdown 语法：# 标题、**加粗**、> 引用、- 列表）";
      ta.value = b.text || "";
      const sync = () => { b.text = ta.value; autosize(ta); changed(); };
      ta.addEventListener("input", sync);
      setTimeout(() => autosize(ta), 0);
      body.appendChild(ta);
    } else {
      body.innerHTML =
        '<div class="blk-img-wrap"><img src="' + b.url + '" alt="" referrerpolicy="no-referrer" /></div>' +
        '<div class="blk-img-ops">' +
        '<input type="text" class="blk-alt" placeholder="图片说明（可选）" value="' + String(b.alt || "").replace(/"/g, "&quot;") + '" />' +
        '<button type="button" class="blk-btn" data-edit="1">✎ 编辑图片</button>' +
        '<button type="button" class="blk-btn" data-replace="1">⇄ 替换</button>' +
        "</div>";
      body.querySelector(".blk-alt").addEventListener("input", (e) => { b.alt = e.target.value; changed(); });
      body.querySelector('[data-edit]').onclick = async () => {
        try {
          const blob = await ImageEditor.loadUrlAsBlob(b.url, opts.token);
          const items = await ImageEditor.openEdit({ blob, name: b.alt || "image.jpg", upload: opts.upload, token: opts.token });
          if (items && items[0]) { b.url = items[0].url; b.alt = items[0].alt || b.alt; render(); }
        } catch (err) { alert("图片加载失败：" + (err.message || err)); }
      };
      body.querySelector('[data-replace]').onclick = () => {
        ImageEditor.pickFiles({ upload: opts.upload, token: opts.token }).then((items) => {
          if (items && items[0]) { b.url = items[0].url; b.alt = items[0].alt || b.alt; render(); }
        }).catch(() => {});
      };
    }

    blk.appendChild(bar);
    blk.appendChild(body);

    // 拖拽落点提示
    blk.addEventListener("dragover", (e) => {
      if (dragIdx === null) return;
      e.preventDefault();
      const r = blk.getBoundingClientRect();
      blk.classList.toggle("drop-hint", true);
      blk.classList.toggle("drop-after", e.clientY > r.top + r.height / 2);
    });
    blk.addEventListener("dragleave", () => blk.classList.remove("drop-hint"));
    blk.addEventListener("drop", (e) => {
      e.preventDefault();
      if (dragIdx === null || dragIdx === i) return;
      const after = blk.classList.contains("drop-after");
      const moved = blocks.splice(dragIdx, 1)[0];
      let target = i;
      if (dragIdx < i) target = i - 1;
      blocks.splice(after ? target + 1 : target, 0, moved);
      dragIdx = null;
      render();
    });
    return blk;
  }
  return { mount };
})();

// ---------------- 图片编辑器（弹窗） ----------------
const ImageEditor = (() => {
  const MAX_DIM = 1800;          // 读入像素上限
  const VIEW_W = 780, VIEW_H = 520;
  let ov, canvas, octxOverlay, ctx, overlay;
  let src = null;                // 当前编辑位图（canvas）
  let origBlob = null, origName = "image.jpg";
  let sel = null, selStart = null, cropMode = false, busy = false;
  let cfg = null;                // {upload, token, onDone}
  let mergeImgs = [], mergeLayout = "h";

  function ensureDom() {
    if (ov) return;
    ov = document.createElement("div");
    ov.className = "imged-overlay";
    ov.innerHTML = `
      <div class="imged-modal">
        <div class="imged-head">
          <div class="imged-tabs" id="ie-tabs"></div>
          <button type="button" class="imged-close" id="ie-close">✕</button>
        </div>
        <div class="imged-stage" id="ie-stage"></div>
        <div class="imged-tools" id="ie-tools"></div>
        <div class="imged-foot">
          <span class="imged-hint" id="ie-hint"></span>
          <button type="button" class="imged-btn ghost" id="ie-skip">直接上传原图</button>
          <button type="button" class="imged-btn pri" id="ie-done">完成并上传</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector("#ie-close").onclick = close;
    ov.querySelector("#ie-skip").onclick = () => finishWithBlob(origBlob, origName);
    ov.querySelector("#ie-done").onclick = () => exportResult();
    canvas = document.createElement("canvas");
    canvas.className = "imged-canvas";
    overlay = document.createElement("canvas");
    overlay.className = "imged-overlay-canvas";
    ctx = canvas.getContext("2d");
    octxOverlay = overlay.getContext("2d");
    // 裁剪拖选
    let down = null;
    const pos = (e) => {
      const r = overlay.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
    };
    overlay.addEventListener("mousedown", (e) => {
      if (!cropMode) return;
      down = pos(e); selStart = down; sel = null;
    });
    overlay.addEventListener("mousemove", (e) => {
      if (!cropMode || !down) return;
      const p = pos(e);
      sel = { x: Math.min(down.x, p.x), y: Math.min(down.y, p.y), w: Math.abs(p.x - down.x), h: Math.abs(p.y - down.y) };
      drawOverlay();
    });
    window.addEventListener("mouseup", () => { down = null; });
    overlay.addEventListener("dblclick", () => { if (sel && sel.w > 8) applyCrop(); });
  }

  function openModal() { ensureDom(); ov.classList.add("open"); }
  function close() { ov.classList.remove("open"); sel = null; cropMode = false; }

  function setHint(t) { ov.querySelector("#ie-hint").textContent = t || ""; }

  // ---- 读入 ----
  function blobToCanvas(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        const k = Math.min(1, MAX_DIM / Math.max(w, h));
        w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c);
      };
      img.onerror = () => reject(new Error("图片解码失败"));
      img.src = URL.createObjectURL(blob);
    });
  }
  async function loadUrlAsBlob(url, token) {
    // 优先走 Gitee contents API（base64，天然无跨域污染）
    const m = String(url).match(/gitee\.com\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+?)(\?.*)?$/);
    if (m && token) {
      try {
        const api = window.GITEE_API + "/repos/" + m[1] + "/" + m[2] + "/contents/" + m[4] + "?ref=" + m[3];
        const r = await fetch(api, { headers: { Authorization: "token " + token } });
        if (r.ok) {
          const j = await r.json();
          if (j.content) {
            const bin = atob(String(j.content).replace(/\n/g, ""));
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            return new Blob([arr], { type: j.encoding === "base64" ? (j.name || "").toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg" : "application/octet-stream" });
          }
        }
      } catch (e) { /* 落到直接加载 */ }
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("无法跨域读取该图片")); img.src = url; });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    return canvasToBlob(c);
  }
  function canvasToBlob(c, q) {
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("导出失败"))), "image/jpeg", q || 0.85));
  }

  // ---- 入口 ----
  function pickFiles(opts2) {
    return new Promise((resolve, reject) => {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/*"; inp.multiple = true; inp.style.display = "none";
      document.body.appendChild(inp);
      inp.onchange = async () => {
        const files = Array.from(inp.files || []);
        inp.remove();
        if (!files.length) return reject(new Error("cancelled"));
        try {
          const items = await openEdit({ files, upload: opts2.upload, token: opts2.token });
          resolve(items || []);
        } catch (e) { reject(e); }
      };
      inp.click();
    });
  }

  async function openEdit(opts2) {
    // opts2: {files:[File]} 或 {blob, name}；返回 [{url, alt}]
    return new Promise((resolve, reject) => {
      openModal();
      cfg = { ...opts2, resolve, reject };
      if (opts2.files && opts2.files.length > 1) {
        startMerge(opts2.files);
      } else if (opts2.files && opts2.files.length === 1) {
        startSingle(opts2.files[0]);
      } else if (opts2.blob) {
        startSingleBlob(opts2.blob, opts2.name || "image.jpg");
      } else { reject(new Error("no input")); }
    });
  }

  async function startSingle(file) { await startSingleBlob(file, file.name || "image.jpg"); }
  async function startSingleBlob(blob, name) {
    origBlob = blob; origName = name;
    mergeImgs = [];
    src = await blobToCanvas(blob);
    sel = null; cropMode = false;
    renderTabs("edit");
    drawView();
    renderToolsSingle();
    setHint("拖动框选后点「应用裁剪」可裁剪；双击选区也可直接裁剪。");
  }

  async function startMerge(files) {
    mergeImgs = [];
    for (const f of files) mergeImgs.push({ img: await blobToCanvas(f), name: f.name || "image.jpg" });
    origBlob = files[0]; origName = "merged.jpg";
    src = null; sel = null; cropMode = false;
    renderTabs("merge");
    drawMerge();
    renderToolsMerge();
    setHint("多图将合并为一张图片上传；可切换横排 / 竖排。");
  }

  function renderTabs(active) {
    const tabs = ov.querySelector("#ie-tabs");
    const multi = (cfg.files && cfg.files.length > 1) || mergeImgs.length > 1;
    tabs.innerHTML = multi
      ? '<button type="button" class="ie-tab ' + (active === "merge" ? "active" : "") + '" id="tab-merge">多图合并</button>' +
        '<button type="button" class="ie-tab ' + (active === "edit" ? "active" : "") + '" id="tab-edit">单图编辑</button>' +
        '<span class="ie-tabinfo">合并＝并排成一张图；单图编辑＝逐张修图后分别插入</span>'
      : '<span class="ie-tab active">图片编辑</span>';
    if (multi) {
      tabs.querySelector("#tab-merge").onclick = () => { if (!busy) { src = null; renderTabs("merge"); drawMerge(); renderToolsMerge(); } };
      tabs.querySelector("#tab-edit").onclick = async () => {
        if (busy) return;
        const im = mergeImgs[0];
        src = await blobToCanvas(await canvasToBlob(im.img));
        renderTabs("edit"); drawView(); renderToolsSingle();
      };
    }
  }

  // ---- 单图编辑：视图 ----
  function drawView() {
    const stage = ov.querySelector("#ie-stage");
    stage.innerHTML = "";
    const k = Math.min(VIEW_W / src.width, VIEW_H / src.height, 1);
    canvas.width = Math.max(1, Math.round(src.width * k));
    canvas.height = Math.max(1, Math.round(src.height * k));
    overlay.width = canvas.width; overlay.height = canvas.height;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    stage.appendChild(canvas);
    stage.appendChild(overlay);
    drawOverlay();
  }
  function drawOverlay() {
    octxOverlay.clearRect(0, 0, overlay.width, overlay.height);
    if (!cropMode) return;
    octxOverlay.fillStyle = "rgba(0,0,0,0.35)";
    octxOverlay.fillRect(0, 0, overlay.width, overlay.height);
    if (sel && sel.w > 2 && sel.h > 2) {
      octxOverlay.clearRect(sel.x, sel.y, sel.w, sel.h);
      octxOverlay.drawImage(canvas, sel.x, sel.y, sel.w, sel.h, sel.x, sel.y, sel.w, sel.h);
      octxOverlay.strokeStyle = "#8a6f47"; octxOverlay.lineWidth = 2;
      octxOverlay.setLineDash([6, 4]);
      octxOverlay.strokeRect(sel.x, sel.y, sel.w, sel.h);
    }
  }
  function renderToolsSingle() {
    const t = ov.querySelector("#ie-tools");
    t.innerHTML = `
      <button type="button" class="imged-btn" id="t-rl">↺ 左转</button>
      <button type="button" class="imged-btn" id="t-rr">↻ 右转</button>
      <span class="imged-sep"></span>
      <button type="button" class="imged-btn" id="t-crop">⛶ 框选裁剪</button>
      <button type="button" class="imged-btn" id="t-cropok" style="display:none">✓ 应用裁剪</button>
      <button type="button" class="imged-btn" id="t-cropno" style="display:none">取消框选</button>
      <span class="imged-sep"></span>
      <label class="imged-lab">缩放 <input type="range" id="t-zoom" min="30" max="150" value="100" /> <span id="t-zoomv">100%</span></label>
      <button type="button" class="imged-btn ghost" id="t-reset">重置</button>`;
    t.querySelector("#t-rl").onclick = () => rotate(-90);
    t.querySelector("#t-rr").onclick = () => rotate(90);
    t.querySelector("#t-crop").onclick = () => {
      cropMode = true; sel = null;
      t.querySelector("#t-crop").style.display = "none";
      t.querySelector("#t-cropok").style.display = "";
      t.querySelector("#t-cropno").style.display = "";
      setHint("在图上按住鼠标拖出一个矩形框，然后点「应用裁剪」。");
      drawOverlay();
    };
    t.querySelector("#t-cropno").onclick = () => { cropMode = false; sel = null; renderToolsSingle(); drawOverlay(); setHint(""); };
    t.querySelector("#t-cropok").onclick = () => { if (sel && sel.w > 8 && sel.h > 8) { applyCrop(); renderToolsSingle(); setHint("已裁剪。"); } else { setHint("请先拖选出裁剪区域", true); } };
    t.querySelector("#t-zoom").oninput = (e) => { t.querySelector("#t-zoomv").textContent = e.target.value + "%"; };
    t.querySelector("#t-zoom").onchange = (e) => { applyZoom(Number(e.target.value) / 100); };
    t.querySelector("#t-reset").onclick = async () => { src = await blobToCanvas(origBlob); sel = null; cropMode = false; renderToolsSingle(); drawView(); };
    drawOverlay();
  }
  function rotate(deg) {
    const w = src.width, h = src.height;
    const c = document.createElement("canvas");
    c.width = h; c.height = w;
    const cx = c.getContext("2d");
    cx.translate(h / 2, w / 2);
    cx.rotate(deg * Math.PI / 180);
    cx.drawImage(src, -w / 2, -h / 2);
    src = c;
    sel = null;
    drawView();
  }
  function applyCrop() {
    const k = src.width / canvas.width;
    const sx = Math.round(sel.x * k), sy = Math.round(sel.y * k);
    const sw = Math.max(1, Math.round(sel.w * k)), sh = Math.max(1, Math.round(sel.h * k));
    const c = document.createElement("canvas");
    c.width = sw; c.height = sh;
    c.getContext("2d").drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    src = c; sel = null; cropMode = false;
    drawView();
  }
  function applyZoom(f) {
    const w = Math.max(40, Math.round(src.width * f));
    const h = Math.max(40, Math.round(src.height * f));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(src, 0, 0, w, h);
    src = c; drawView();
  }

  // ---- 多图合并 ----
  function drawMerge() {
    const stage = ov.querySelector("#ie-stage");
    stage.innerHTML = "";
    if (src) { drawView(); overlay.style.pointerEvents = "none"; return; }
    const gap = 14;
    let W, H;
    if (mergeLayout === "h") {
      H = Math.min(...mergeImgs.map((m) => m.img.height), 1100);
      W = mergeImgs.reduce((s, m) => s + Math.round(m.img.width * (H / m.img.height)), 0) + gap * (mergeImgs.length - 1);
    } else {
      W = Math.min(...mergeImgs.map((m) => m.img.width), 1100);
      H = mergeImgs.reduce((s, m) => s + Math.round(m.img.height * (W / m.img.width)), 0) + gap * (mergeImgs.length - 1);
    }
    src = document.createElement("canvas");
    src.width = W; src.height = H;
    const cx = src.getContext("2d");
    cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, W, H);
    let off = 0;
    for (const m of mergeImgs) {
      if (mergeLayout === "h") {
        const w = Math.round(m.img.width * (H / m.img.height));
        cx.drawImage(m.img, off, 0, w, H); off += w + gap;
      } else {
        const h = Math.round(m.img.height * (W / m.img.width));
        cx.drawImage(m.img, 0, off, W, h); off += h + gap;
      }
    }
    const k = Math.min(VIEW_W / W, VIEW_H / H, 1);
    canvas.width = Math.max(1, Math.round(W * k)); canvas.height = Math.max(1, Math.round(H * k));
    overlay.width = canvas.width; overlay.height = canvas.height;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    stage.appendChild(canvas); stage.appendChild(overlay);
  }
  function renderToolsMerge() {
    const t = ov.querySelector("#ie-tools");
    t.innerHTML = `
      <span class="imged-lab">排列方向：</span>
      <button type="button" class="imged-btn ${mergeLayout === "h" ? "pri" : ""}" id="t-h">左右并排</button>
      <button type="button" class="imged-btn ${mergeLayout === "v" ? "pri" : ""}" id="t-v">上下拼接</button>
      <span class="imged-sep"></span>
      <span class="imged-hint">共 ${mergeImgs.length} 张，按选择顺序合并</span>`;
    t.querySelector("#t-h").onclick = () => { mergeLayout = "h"; src = null; drawMerge(); renderToolsMerge(); };
    t.querySelector("#t-v").onclick = () => { mergeLayout = "v"; src = null; drawMerge(); renderToolsMerge(); };
  }

  // ---- 导出上传 ----
  async function exportResult() {
    if (busy) return;
    busy = true;
    const doneBtn = ov.querySelector("#ie-done");
    doneBtn.disabled = true; doneBtn.textContent = "上传中…";
    try {
      const out = [];
      if (src) {
        // src 可能是：编辑后的单图、合并结果画布 —— 统一导出上传
        const blob = await canvasToBlob(src);
        const url = await cfg.upload(blob);
        out.push({ url, alt: (origName || "image").replace(/\.[^.]+$/, "") });
      } else {
        throw new Error("没有可导出的图片");
      }
      close();
      cfg.resolve(out);
    } catch (e) {
      alert("上传失败：" + (e.message || e));
      cfg.reject && cfg.reject(e);
    } finally {
      busy = false;
      doneBtn.disabled = false; doneBtn.textContent = "完成并上传";
    }
  }
  async function finishWithBlob(blob, name) {
    try {
      const url = await cfg.upload(blob);
      const out = [{ url, alt: String(name || "image").replace(/\.[^.]+$/, "") }];
      close(); cfg.resolve(out);
    } catch (e) { alert("上传失败：" + (e.message || e)); }
  }

  return { pickFiles, openEdit, loadUrlAsBlob };
})();
