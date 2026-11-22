// ===== 站点配置（前端部署在 GitHub Pages，数据存于 Gitee，无需自建后端）=====
// Gitee 仓库信息（公开仓库，存放文章数据与图片）
window.SITE = {
  owner: "educational-innovation-zone",
  repo: "my-blog",
  branch: "master",
  dataPath: "data/posts.json", // 文章数据文件
  sitePath: "data/site.json",  // 站点设置（标题/副标题/侧边栏导航/关于我）
  imageDir: "data/images",     // 图片存放目录
};

// Gitee API 与图片直链前缀
window.GITEE_API = "https://gitee.com/api/v5";
window.RAW_BASE = `https://gitee.com/${window.SITE.owner}/${window.SITE.repo}/raw/${window.SITE.branch}`;

// ===== 服务端同步 Webhook（发布即上线）=====
// 后台保存/发布成功后立即 POST 触发；服务端把 Gitee 数据镜像到 Pages 仓库。
// 事件驱动，无轮询、无定时等待。该地址为公开端点，sharecode 非密钥。
window.SYNC = {
  endpoint: "https://essay-blog-31967.app.workbuddy.host/sync?sharecode=ZWX7DJVAZU",
};
