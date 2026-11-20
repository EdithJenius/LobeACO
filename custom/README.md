# 定制功能与本机部署

本目录包含店铺管理器源码和 LobeHub 的本机部署配置，不含店铺账号、登录会话、密钥、采集数据或专家包。专家管理、导入和团队界面等代码保留，用户自行导入的专家包不在仓库中。

## 目录

- `taobao-browser/`：店铺管理器及各平台适配源码；运行数据生成在其 `runtime/` 目录。
- `deployment/`：Docker Compose、前端桥接与启动脚本。
- 仓库根目录：定制的 LobeHub 源码，基于上游 20261112 版本。

## 本机部署

需要 Windows、Node.js、Docker Desktop，以及与 LobeHub 项目要求一致的依赖环境。

1. 在仓库根目录安装 LobeHub 依赖，按项目说明准备构建环境；在 `custom/taobao-browser` 执行 `npm ci` 和 `npx playwright install chromium`。
2. 在 `custom/deployment` 执行 `node setup-secrets.cjs`，生成本机专用 `.env` 和搜索服务配置；不要将它们提交到 Git。
3. 在 `custom/deployment` 执行 `./checkout-spa.ps1 -Build` 构建桌面和移动前端，再执行 `./start.ps1`。浏览器访问 `http://localhost:3210`。
4. 在店铺管理中重新绑定店铺，由账号持有人完成官方登录和安全验证。模型凭据、专家包和其他个人数据也需自行配置或导入。

部署脚本与运行中机器的逻辑一致，已按仓库目录调整相对路径；尚未在全新机器上完成端到端部署验证。服务初始化及镜像下载可能需要额外的系统环境配置。停止服务前请按店铺操作规范处理已打开的店铺窗口。
