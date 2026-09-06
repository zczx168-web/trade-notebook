# 后端接入约定（尚未实现或部署）

前端发布到 GitHub Pages 后，交易记录仍是本地账本。以下接口是后续接入的约定，不代表网站已具备在线账号、短信验证、收款或跨设备同步。

当前另外提供固定微信收款码的人工收款渠道，配置位于 `manualPayment`。该渠道不调用下述接口，不生成服务器订单或支付状态，不自动确认付款。客服人工核账后，通过本机签发工具发放设备绑定的数字签名激活码，客户在网站验证后解锁会员功能。详见 `manual-activation.md`；此方案没有在线管理后台或服务端权限校验。

## 公开配置

当前网页 CSP 使用 `connect-src 'none'` 禁止外部请求。部署真实后端前，必须将该指令改为明确的可信 API 域名，并重新测试，不要用通配符放开所有外连。

```javascript
window.TRADE_CONFIG = Object.freeze({
  apiBase: 'https://api.your-domain.example',
  checkoutOrigins: ['https://pay.your-domain.example']
});
```

API 服务需允许 Pages 的明确 Origin，支持凭据和 `X-CSRF-Token`，不能使用凭据加通配符 CORS。请求采用 `credentials: include`。跨站 Cookie 通常需要 `Secure; HttpOnly; SameSite=None`，部分浏览器会阻止第三方 Cookie；生产推荐使用自有域名将前后端放在同一站点，并重新进行真实浏览器登录与回跳测试。

## 账号接口

- `GET /me`：包括匿名会话在内返回 `{user: null | {phone}, csrfToken, membership: {type: 'free' | 'month' | 'forever', expiresAt: null | ISO8601}}`。用于启动 CSRF 会话和读取已验证的会员状态。
- `POST /auth/code`：`{phone, purpose: 'login' | 'register' | 'reset'}`，成功响应 `{ok: true}`。必须实际调用短信服务并验证服务商响应后才返回成功。
- `POST /auth/login`：`{phone, code}`，验证短信、建立 Cookie 会话，响应 `{ok: true}`。
- `POST /auth/register`：`{phone, code, password}`，验证短信并创建账号，建立 Cookie 会话，响应 `{ok: true}`。
- `POST /auth/reset`：`{phone, code, password}`，验证短信后更新密码，吊销旧会话，响应 `{ok: true}`。
- `POST /auth/logout`：`{}`，吊销会话，响应 `{ok: true}`。

验证码需限时、单次使用、限制尝试次数，并按手机号、IP、会话限流；不得在响应或日志泄露验证码。密码使用成熟密码哈希库储存，不能明文保存。所有修改请求均验证 CSRF，服务器重新验证全部输入。前端校验仅改善体验，不能当作安全边界。

## 订单接口

- `POST /pay/orders`：`{goodsType: 'month' | 'forever', payType: 'wxpay' | 'alipay', returnUrl}`，响应 `{orderNo, payUrl}`。
- `GET /pay/orders/:orderNo`：响应 `{orderNo, status: 'pending' | 'success' | 'fail' | 'expired'}`。需登录，且只能查询当前账号的订单。

服务器按商品表确定价格：月度 1990 分、永久 19900 分，不接受浏览器提交的金额作为定价。订单必须由服务器生成、绑定用户并持久化，考虑重复提交和并发幂等。`returnUrl` 只能取受控的本站白名单 URL。

返回的 `payUrl` 必须是 HTTPS，域名须在前端 `checkoutOrigins` 中。前端只跳转服务器返回的已签名收银台地址。订单编号允许 1 至 100 位字母、数字、下划线与短横线。

## 彩虹易支付

服务器构造与所部署版本匹配的标准易支付参数。常见微信渠道标识是 `wxpay`，须以网关实际文档为准。`pid`、`key` 只由服务器持有；签名采用网关版本要求的规范化与算法，不能省略签名或让浏览器生成签名。

`notify_url` 必须指向公网服务器。处理通知时验证签名、商户、订单号、支付状态、币种及精确的分单位金额；必要时调用网关查单。通过数据库事务和唯一约束保证重复回调只发放一次权益，再返回网关约定的成功确认文本。月卡续期从当前到期时间与服务器当前时间中的较晚值开始，永久会员不能被月卡回调降级。

回跳页面、URL 参数、本地存储或二维码页面关闭都不能证明付款成功。前端只查询后端订单并重新读取 `/me`，没有本地模拟开通。自动查询最长 10 分钟，连续错误 3 次后暂停，用户可手动恢复查询。

## 正式上线前

通过真实沙盒或网关测试环境检查签名、金额篡改、重放通知、通知先于回跳、浏览器关闭后付款、续期、永久权益、跨用户查单、退款以及短信失败场景。当前仓库的浏览器测试仅验证静态版与未配置服务的状态，不声称验证真实付款。

需要可靠的付费访问控制时，付费内容和权益校验必须由服务端执行。当前本地版用签名激活码控制个人图表、错误分析和完整报告入口，不能阻止用户修改客户端代码绕过限制。未来迁移至后端时，应基于核账记录导入真实权益并绑定经过验证的账号，不能直接信任客户端提交的会员状态。
