// ===== 站点配置（前端部署在 GitHub Pages，数据存于 Gitee，无需自建后端）=====
// Gitee 仓库信息（公开仓库，存放文章数据与图片）
window.SITE = {
  owner: "educational-innovation-zone",
  repo: "my-blog",
  branch: "master",
  dataPath: "data/posts.json", // 文章数据文件
  imageDir: "data/images",     // 图片存放目录
};

// Gitee API 与图片直链前缀
window.GITEE_API = "https://gitee.com/api/v5";
window.RAW_BASE = `https://gitee.com/${window.SITE.owner}/${window.SITE.repo}/raw/${window.SITE.branch}`;
