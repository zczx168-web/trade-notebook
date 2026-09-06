# 交易纠错本

基于提供的交易复盘源码整理的静态网站，面向 GitHub Pages，所有前端依赖随源码保存，无需依赖第三方 CDN。

## 当前功能

- 独立的我的账本与示例账本，真实交易记录不混入示例。
- 交易新增、编辑、删除，按日期、市场、盈亏、关键词筛选。
- 根据开仓价、平仓价、方向、手数、乘数、手续费计算净盈亏；支持直接录入净盈亏。
- 累计盈亏、胜率、平均盈亏比、最大单笔盈亏、最大日终回撤。
- 自定义错误标签、错误分布、关联亏损、Top 3 改进建议、开仓理由与复盘笔记。
- CSV 导出、JSON 完整备份与恢复，中文复盘报告可通过浏览器打印保存为 PDF。
- 月度会员 19.90 元 / 30 天、永久会员 199 元的会员界面。
- 登录、注册、密码找回及支付的前端接口边界；尚未连接服务器，不假装发送短信或收款。

## 本地打开

直接打开 `site/index.html`。不需要运行开发服务器。

数据存放在当前浏览器的 localStorage。`file:`、本地 HTTP 和 GitHub Pages 是不同的存储环境，切换环境时请通过 JSON 备份迁移。不会将账本内容提交到 GitHub。清除浏览器数据会丢失记录，备份文件包含交易笔记，请妥善保存。

首次没有个人交易时显示带明确标签的示例账本。新增交易会切换到我的账本。当前为本地版本，统计、报告与备份均可使用。

## 验证与依赖

```powershell
npm ci
npm run vendor
npm test
npm run test:browser
```

浏览器测试使用本机 Chrome，覆盖 1440、768、390、320 像素视口、图表像素、增删改、做空盈亏、刷新保存、筛选、导入导出、中文报告和未配置服务状态。生成的截图和测试 PDF 保存在被 Git 忽略的 `test-results/` 中。

## 发布到 GitHub Pages

```powershell
pwsh -File scripts/deploy.ps1
```

脚本优先使用已登录的 GitHub CLI，再尝试 Git Credential Manager 中已有的 GitHub 凭据。凭据只传给当前进程的 GitHub CLI，不写入源码、不输出密钥。没有现成登录时会提示先执行 `gh auth login --web --scopes workflow`。

脚本创建当前账号的公开仓库 `trade-notebook`，启用 GitHub Actions Pages 部署并推送当前提交。若同名仓库已经存在且不是当前项目的远端，会停止，避免覆盖其他项目。`.github/workflows/pages.yml` 会在 `main` 更新时运行测试并发布 `site/`，不会发布测试输出、node_modules 或交易数据。

## 短信、账号与支付

GitHub Pages 不运行服务器，也无法接收支付异步通知。当前未部署账号服务器、数据库、短信服务或支付网关，因此对应操作不可用。完整接入要求见 `docs/backend-contract.md`。

只在 `site/config.js` 填写公开的 HTTPS API 地址和收银台域名白名单。商户 ID、商户密钥、短信凭据应由服务器配置，不得写到网页或 GitHub 仓库。前端不保存密码、不校验模拟验证码、不信任 localStorage 中的会员标记、不通过支付回跳参数开通会员。

提供源码中的调试开通按钮已移除；做空盈亏方向已修正；报告使用浏览器中文字体并保留完整笔记，避免默认 PDF 字体乱码与笔记截断。

正式售卖前还需确定运营主体、会员权益、服务与退款条款。仅靠前端隐藏内容或 localStorage 无法建立可靠的付费权限系统。

## 文件

| 路径 | 用途 |
| --- | --- |
| `site/index.html` | 页面结构 |
| `site/styles.css` | 桌面、手机与打印样式 |
| `site/app.js` | 交互、图表、存储、账号与支付接口 |
| `site/core.js` | 交易校验、计算、筛选与 CSV |
| `site/config.js` | 公开服务地址配置 |
| `site/vendor/` | Chart.js、Lucide 与许可文件 |
| `tests/` | 计算与浏览器验证 |
| `.github/workflows/pages.yml` | GitHub Pages 自动发布 |

Chart.js 采用 MIT 许可，Lucide 采用 ISC 许可，完整声明随依赖保留。
