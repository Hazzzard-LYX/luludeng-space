# LuLu & DengDeng Messages API

这个目录是独立的 Cloudflare Worker + D1 后端。GitHub Pages 继续托管静态页面，Worker 只处理 `luludeng.space/api/*`，不会接管网站的其他页面。

## 目录

- `src/index.js`：留言 API
- `wrangler.toml`：Worker 与 D1 binding 配置
- `schema.sql`：D1 数据库结构

## API

### `GET /api/messages`

返回所有 `visible = 1` 的留言，按 `created_at` 从早到晚排序。

### `POST /api/messages`

```json
{
  "author": "噜噜 & 噔噔",
  "content": "今天也很喜欢你。",
  "mood": "love"
}
```

- `author`：1-50 个字符
- `content`：1-500 个字符
- `mood`：可选，最多 32 个字符

### `DELETE /api/messages?id=<message-id>`

删除采用软删除：将 `visible` 改为 `0`，数据库仍保留原始留言，便于误删恢复。

需要恢复时，在 D1 Console 执行：

```sql
UPDATE messages SET visible = 1 WHERE id = '<message-id>';
```

## 安全范围

当前版本按“私人纪念网站、不增加复杂用户系统”的要求，不含账户系统。Origin 白名单可以阻止普通网页跨域调用，但它不是身份验证；若未来需要严格保护写入和删除接口，可单独给 `/api/*` 增加 Cloudflare Access。

## 准备工作

- 安装 Node.js 20 或更高版本（会同时提供 `npm` / `npx`）
- 拥有 `luludeng.space` 所在 Cloudflare 账户的 Workers 与 D1 权限

## Cloudflare Dashboard 配置

1. 进入 **Storage & Databases → D1 SQL Database → Create database**。
2. 数据库名称填写 `luludeng-messages`。
3. 创建后复制 Database ID，替换 `wrangler.toml` 中的占位 `database_id`。
4. 进入 **Workers & Pages → Create → Worker**，Worker 名称填写 `luludeng-api`，先完成一次默认部署。
5. 在 Worker 的 **Settings → Bindings → Add binding → D1 database** 中添加：
   - Variable name：`DB`
   - D1 database：`luludeng-messages`
6. 在 Worker 的 **Edit code** 中可粘贴 `src/index.js` 后部署；更推荐使用下方的 Wrangler 命令部署，它会以仓库文件为准并自动应用 `wrangler.toml` 中的 binding。
7. 在 Worker 的 **Settings → Domains & Routes → Add → Route** 中添加：
   - Route：`luludeng.space/api/*`
   - Zone：`luludeng.space`
8. 不要添加 `luludeng.space/*`，否则 Worker 会接管 GitHub Pages 的静态页面。

生产环境的前端调用地址仍然是：

```text
https://luludeng.space/api/messages
```

Worker 自身的预览地址会在部署后显示为：

```text
https://luludeng-api.<你的-workers.dev-子域>.workers.dev
```

## 初始化数据库

在仓库根目录执行：

```bash
npx wrangler d1 execute luludeng-messages --remote --file=worker/schema.sql --config=worker/wrangler.toml
```

也可以在 Dashboard 的 D1 Console 中复制并执行 `schema.sql` 的全部内容。

## 部署 Worker

先登录 Cloudflare：

```bash
npx wrangler login
```

确认已经替换 `database_id` 后部署：

```bash
npx wrangler deploy --config=worker/wrangler.toml
```

## 本地测试

初始化本地 D1：

```bash
npx wrangler d1 execute luludeng-messages --local --file=worker/schema.sql --config=worker/wrangler.toml
```

启动 Worker：

```bash
npx wrangler dev --local --config=worker/wrangler.toml
```

默认地址通常是 `http://127.0.0.1:8787`。另开终端测试：

```bash
curl http://127.0.0.1:8787/api/messages

curl -X POST http://127.0.0.1:8787/api/messages \
  -H "Content-Type: application/json" \
  -d '{"author":"噜噜","content":"本地测试留言","mood":"happy"}'
```

若要让本地静态页面直接连接本地 Worker，在加载 `message-board.js` 前设置：

```html
<script>window.LULU_MESSAGE_API_BASE = "http://127.0.0.1:8787";</script>
```

生产环境使用同域名 Worker Route，因此不需要设置这个变量。
