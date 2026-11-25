# LuLu & DengDeng API

这个目录是独立的 Cloudflare Worker 后端：D1 保存留言、照片记录和地图足迹，R2 保存上传的照片文件。GitHub Pages 继续托管静态页面。

- API 地址：`https://api.luludeng.space`（Worker 自定义域名，workers.dev 地址已关闭）
- 登录：Cloudflare Access 保护整个 `api.luludeng.space`，只有允许的邮箱能通过邮箱验证码登录
- 前端通过根目录的 `api.js` 调用 API，所有请求都带上 Access 的登录 Cookie

## 目录

- `src/index.js`：全部 API，包括 Access 令牌校验
- `wrangler.toml`：Worker、自定义域名、D1、R2 配置
- `schema.sql`：D1 数据库结构（可重复执行）
- `.dev.vars.example`：本地开发用的环境变量示例

## 登录是怎么工作的

1. `login.html` 先请求 `GET /api/session`。已登录就直接进入网站。
2. 未登录时点击“用邮箱验证码登录”，浏览器打开 `https://api.luludeng.space/api/login?return=<登录页地址>`。
3. Cloudflare Access 先拦下这个请求，显示邮箱验证码登录页；登录成功后，Access 在 `api.luludeng.space` 上写入 Cookie，再放行请求。
4. Worker 把浏览器送回 `return` 地址（只允许 `ALLOWED_ORIGINS` 里的网站），登录页再次确认后进入网站。

Worker 不只依赖 Access 拦截：每个请求都会校验 Access 附带的 `Cf-Access-Jwt-Assertion` 签名令牌（签名、AUD、签发方、过期时间、邮箱白名单）。缺少配置或校验失败一律返回 401。

## API

除 `OPTIONS` 预检外，所有接口都需要登录。

### 登录

- `GET /api/session`：已登录返回 `{"ok": true, "email": "..."}`，否则 401。
- `GET /api/login?return=<url>`：在浏览器里打开（不是 fetch），登录后跳回 `return`。

### 留言

- `GET /api/messages`：返回所有 `visible = 1` 的留言，按时间从早到晚排序。
- `POST /api/messages`：`{"author": "噜噜 & 噔噔", "content": "今天也很喜欢你。", "mood": "love"}`
  - `author` 1-50 字符，`content` 1-5000 字符，`title`（主题）可选、最多 30 字符，`mood` 可选、最多 32 字符
- `DELETE /api/messages?id=<id>`：软删除（`visible = 0`）。恢复：
  `UPDATE messages SET visible = 1 WHERE id = '<id>';`

### 照片

- `GET /api/photos`：`{"photos": [...上传的照片], "hidden": [...被隐藏的仓库照片路径]}`。
  前端会把 `photos-manifest.js` 里的仓库照片和这里的上传照片合并显示。
- `POST /api/photos?address=<地址>&filename=<文件名>`：请求体是照片原始字节，最大 25MB，支持 JPG / PNG / WEBP / GIF / AVIF。
  - 地址已经在地图上（上海、香港、深圳、苏州，或之前确认过的地点）→ 直接显示，返回 `needsLocation: false`。
  - 新地址 → 照片先以 `pending` 状态保存，返回 `needsLocation: true` 和 `pendingId`，前端跳转到地图选位置。
- `POST /api/photos/confirm`：`{"pendingId": "...", "lat": 30.1, "lng": 120.2}`，新增地图足迹并让照片显示出来。
- `DELETE /api/photos?id=<id>`：软删除上传的照片（R2 文件保留）。恢复：
  `UPDATE photos SET status = 'visible' WHERE id = '<id>';`
- `DELETE /api/photos?path=assets/...`：仓库里的照片无法由 Worker 删除，改为从照片墙隐藏。恢复：
  `DELETE FROM hidden_static_photos WHERE src = '<path>';`
- `GET /api/photos/file/<key>`：读取 R2 中的照片文件。

### 需求反馈

- `GET /api/feedback`：返回 `{"items": [...待处理/已完成], "deletedLog": [...已删除记录]}`。
- `POST /api/feedback`：`{"type": "bug", "content": "..."}`，`type` 必须是 `bug` / `feature` / `other`，`content` 1-500 字符。
- `POST /api/feedback/check`：`{"id": "...", "done": true, "note": "做了什么"}`，标记完成（`note` 必填，最多 200 字，显示为“完成总结”）；`{"id": "...", "done": false}` 取消完成并清空总结。
- `DELETE /api/feedback?id=<id>&reason=<理由>`：软删除，`reason` 必填（最多 100 字符），删除人、时间和理由会保留在 `deletedLog` 里。恢复：
  `UPDATE feedback_items SET visible = 1, deleted_by = NULL, deleted_at = NULL, deleted_reason = NULL WHERE id = '<id>';`

### 地图足迹

- `GET /api/places`：通过上传照片确认过的地点 `{"places": [{"name", "lat", "lng"}]}`。
  `places-data.js` 里的静态足迹仍然有效，前端会合并显示。

## 仍然公开的内容

Access 只保护 API（留言、上传的照片、新增足迹）。GitHub Pages 上的静态文件仍然是公开的：页面本身，以及仓库 `assets/` 里的照片，知道地址就能打开。仓库本身也是公开的。若要保护它们，需要把这些照片改为上传到 R2，或把网站迁到 Cloudflare Pages 并用 Access 保护整个网站。

## 上线步骤

需要 Node.js 20+，以及 `luludeng.space` 所在 Cloudflare 账户的 Workers、D1、R2、Zero Trust 权限。命令都在仓库根目录执行。

### 1. 准备资源

```bash
npx wrangler login
npx wrangler r2 bucket create luludeng-photos
npx wrangler d1 execute luludeng-messages --remote --file=worker/schema.sql --config=worker/wrangler.toml
```

### 2. 创建 Access 应用（Cloudflare Dashboard → Zero Trust）

1. 第一次进入 Zero Trust 会让你起一个团队名，记下团队域名，例如 `yourteam.cloudflareaccess.com`（**Settings → Custom Pages** 也能看到）。选 Free 计划即可（50 人以内免费）。
2. **Settings → Authentication → Login methods**：确认有 **One-time PIN**（邮箱验证码）。
3. **Access → Applications → Add an application → Self-hosted**：
   - Application name：`luludeng-api`
   - Session duration：例如 `1 month`（多久需要重新输验证码）
   - Application domain：子域 `api`，域名 `luludeng.space`，路径留空
4. **Policies**：新建 Allow 策略，Include → **Emails**，填你们两个人的邮箱。
5. **Settings → CORS**：
   - 开启 **Bypass options requests to origin**
6. **Settings → Cookies**：SameSite 选 **Lax**（`luludeng.space` 和 `api.luludeng.space` 属于同一站点，Lax 足够，也最稳）。
7. 保存后，在应用的 **Overview / Basic information** 里复制 **Application Audience (AUD) Tag**。

### 3. 设置 Worker 密钥（不会写进仓库）

```bash
npx wrangler secret put ACCESS_TEAM_DOMAIN --config=worker/wrangler.toml   # 例如 yourteam.cloudflareaccess.com
npx wrangler secret put ACCESS_AUD --config=worker/wrangler.toml           # 第 2 步复制的 AUD Tag
npx wrangler secret put ALLOWED_EMAILS --config=worker/wrangler.toml       # 两个邮箱，用英文逗号分隔
```

### 4. 部署 Worker

```bash
npx wrangler deploy --config=worker/wrangler.toml
```

部署会自动为 `api.luludeng.space` 创建 DNS 记录和证书，并关闭旧的 workers.dev 地址。

### 5. 检查后再发布前端

- 无痕窗口打开 `https://api.luludeng.space/api/messages`：应该跳到 Access 登录页，而不是直接看到留言。
- 用允许的邮箱登录后再打开：应该看到留言 JSON。
- `curl https://api.luludeng.space/api/messages`：应该得到跳转到 cloudflareaccess.com 的 302（或 403），看不到留言。
- 确认无误后，把分支合并到 `main`，GitHub Pages 会自动发布前端。

## 本地测试

```bash
cp worker/.dev.vars.example worker/.dev.vars
npx wrangler d1 execute luludeng-messages --local --file=worker/schema.sql --config=worker/wrangler.toml
npx wrangler dev --local --config=worker/wrangler.toml
```

`.dev.vars` 会跳过 Access 校验（只在本地生效），并允许 `http://127.0.0.1:4173` 调用。让本地静态页面连接本地 Worker：在加载 `api.js` 前设置

```html
<script>window.LULU_API_BASE = "http://127.0.0.1:8787";</script>
```
