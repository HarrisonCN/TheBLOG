# 账号安全与隐私中心（L22 · 1.22.0）

这份文档说明 L22 的设计取舍：会话与设备、Passkey、安全记录与登录提醒、数据导出、注销冷静期与清除策略、隐私权限面板、管理员二次验证。
代码：`worker/src/security.ts`（路由与 D1）、`worker/src/security-core.ts`（纯函数，`web/src/security-core.ts` 是逐字相同的副本，测试会比对）、
`web/src/security-client.ts`（`/me/security/`，按需加载）、`web/src/admin-security.ts`（后台「二次验证」，按需加载）、`web/src/demo/mock-security.ts`（演示站）。
迁移：`worker/migrations/0019_security.sql`（只做加法，执行与回滚步骤写在文件头部）。

## 会话与设备

- 会员令牌仍然只存 sha256（`member_sessions.token_hash`）。0019 给会话加了 `device_label`、`ip_prefix`、`method`、`created_at`、`last_seen_at`。
- **不保存原始 User-Agent 和 IP**：设备名由 UA 推出（「Chrome · macOS」）；网络是 IPv4 /24 或 IPv6 /48 前缀加 `JWT_SECRET` 盐后的 sha256 前 16 位，只用来判断「是不是新网络」，页面上只显示前 4 位。
- 「最近活跃」最多每 5 分钟写一次，避免每个请求都写 D1。
- 会话在列表里用令牌哈希的前 16 位指代（不能反推令牌）。可以退出某一台、退出其它所有设备、退出全部设备（包括本机）。
- 申请注销时会退出其它所有设备：防止被盗的会话在冷静期里撤销注销或继续操作。

## 安全记录与登录提醒

- `security_events` 记录：登录（含方式）、新设备 / 新网络登录、Passkey 添加 / 改名 / 删除 / 计数异常、退出设备、导出、申请 / 撤销注销、隐私设置修改；站长的后台登录、二次验证开启 / 关闭 / 失败、恢复码使用记在 `member_id IS NULL` 的行里。
- **保留 180 天**，定时任务清理更早的记录。账号被清除时它的记录随外键级联删除，只留一条匿名的 `account_purged`（`#会员编号`）。
- **登录提醒**：本次登录的设备在历史登录里从没出现过 → 「新设备」；设备见过但网络没见过 → 「新网络」；账号第一次登录不提醒。提醒是站内通知（`system` 类型）；只有用户自己在 L15 通知设置里打开了邮件提醒才会发邮件。可以在隐私权限面板关闭登录提醒。
- 提醒失败不会影响登录（`recordLogin` 吞掉错误并记日志）。

## Passkey

- 可选：邮箱验证码登录一直可用；Passkey 只是更快的登录方式。每个账号最多 10 个。
- **无用户名登录**：注册时要求可发现凭据（`residentKey: required`），登录时 `allowCredentials` 为空，浏览器让用户选择账号；服务器按凭据 ID 找到公钥。
- `user.id`（user handle）由会员编号和 `JWT_SECRET` 推出（sha256 前 16 字节），不暴露自增编号，也不用另存。
- challenge 存在 `webauthn_challenges`，5 分钟有效、**取出即删除**（一次性）；注册 challenge 绑定会员。
- 注册时校验：`clientDataJSON` 的 type / challenge / origin（`WEBAUTHN_ORIGINS`，默认 `SITE_URL` 的 origin）/ crossOrigin，`authenticatorData` 的 rpIdHash（`WEBAUTHN_RP_ID`，默认 `SITE_URL` 的主机名）、用户在场（UP）标志，以及凭据公钥。只接受 **ES256（-7）和 RS256（-257）**；COSE 公钥转成 JWK 存进 D1。
- 登录时校验同样的 clientData / authData，再用存下的公钥校验签名（`authenticatorData || SHA-256(clientDataJSON)`；ES256 的 DER 签名先转成 r‖s）。
- **签名计数**：认证器支持计数（新旧任一方非 0）时必须严格递增，否则拒绝登录、写 `passkey_counter` 记录并提醒用户——这通常意味着凭据被复制了。同步型 Passkey（iCloud 钥匙串、Google 密码管理器）计数恒为 0，不受影响。

### 为什么不校验 attestation

我们请求 `attestation: "none"`，也不校验 `attStmt` 的证书链，原因：

1. **我们不需要知道认证器是什么牌子**。attestation 的用途是让依赖方限制只允许特定型号的硬件（企业场景）；个人博客只需要「这把公钥属于这个账号」，这一点由注册时已登录的会话 + 一次性 challenge + origin / rpId 校验保证。
2. **隐私**：完整 attestation 会暴露认证器型号，部分情况下可以跨站关联用户；浏览器在 `none` 时会主动抹掉这些信息。
3. **可用性**：同步型 Passkey 大多不提供可验证的 attestation；校验证书链需要维护 FIDO MDS 元数据和根证书，出错时会把正常用户挡在门外。
4. 不校验 attestation **不影响登录安全**：登录靠的是私钥签名，伪造的「认证器类型」不能帮攻击者登录别人的账号。

这符合 WebAuthn Level 2/3 对「不关心认证器来源」的依赖方的建议（attestation conveyance = none）。

## 数据导出

- `GET /api/security/export`：一个 JSON 文件（`format: theblog-export/2`），包含 L15 导出的全部内容（账号、资料、关注、拉黑、收藏、评论、通知、作品、话题订阅、合集、活动投稿、项目、私信……）加上上传文件记录、登录设备（不含会话 ID 和网络标记）、Passkey（不含凭据 ID）、安全记录和注销状态。
- 媒体文件不打包进 JSON：`mediaManifest` 列出归档里出现的每个图片 / 音频地址和它在归档里的位置，用户可以逐个下载。（Worker 里打 ZIP 会受 CPU 和内存限制，按需生成再放 R2 又要处理过期清理；清单是更简单、可验证的折中。）
- 每 24 小时最多 3 次，每次写一条安全记录。L15 的 `/api/social/me/export` 保留不变。

## 注销与清除策略（7 天冷静期）

1. 用户在「数据与注销」里输入自己的用户名确认 → `members.deletion_requested_at = now`，退出其它所有设备，写安全记录并发站内通知。
2. **冷静期 7 天**：账号照常可用，可以随时「撤销注销」。页面显示清除日期和剩余天数。
3. 到期后，Cron（每 15 分钟，`scheduledSecurity`，每轮最多 20 个账号）调用 `purgeMember`，与 L15「立即注销」是同一个函数：
   - **硬删除**：资料与用户名、关注 / 粉丝、拉黑 / 静音、收藏、通知与通知偏好、作品（含修订与媒体记录）及作品下的评论、回应、提及，项目 / 摄影专题（`purgeStudio`）、私信（`purgeDm`）、话题订阅 / 活动投稿 / 合集（`purgeDiscovery`）；删除会员行后，会话、Passkey、安全记录等外键关联的数据级联删除；
   - **匿名化保留**：站长文章下的评论（`member_id` 置空，显示为匿名）、举报记录（举报人置空）、通知里的触发者（置空）；审核日志只记编号，保留用于审计；
   - 最后删除会员行，并写一条匿名的 `account_purged` 记录。
4. 清除不可撤销；需要恢复只能从 D1 备份 / Time Travel 恢复（见 `docs/ops.md`），这也会恢复其他所有数据，所以只在误操作时使用。

L15 的「立即注销」接口（`POST /api/social/me/delete`）保留以兼容旧客户端；界面上的注销入口都改为冷静期流程。

## 隐私权限面板

`GET/PUT /api/security/privacy` 把分散在各处的开关集中在一个面板里，读写的仍是原来的表，不重复存储：

| 开关 | 存在哪里 |
| --- | --- |
| 主页可见性（所有人 / 登录好朋友 / 仅自己）、可被搜索、公开关注列表 | `user_profiles`（L15） |
| 谁可以发私信、已读回执、在线状态 | `dm_settings`（L19） |
| 新设备 / 新网络登录提醒 | `security_prefs`（L22） |
| 邮件提醒（只读显示，在「我的 → 通知设置」修改） | `notification_prefs`（L15） |

同一个面板显示拉黑名单，可以直接取消拉黑。

## 管理员二次验证（TOTP）

- 标准 TOTP（RFC 6238：SHA-1、6 位、30 秒），兼容 Google Authenticator / Microsoft Authenticator / 1Password / Bitwarden 等。允许前后各 1 个时间步的误差；**同一时间步的码只能用一次**（`last_step` 条件更新，防重放）。
- 开启：后台「二次验证」生成 20 字节随机密钥，显示 `otpauth://` 链接、二维码（`uqr` 生成的 SVG，项目已有的依赖）和可手动输入的 Base32 密钥；输入一次正确的验证码才真正开启，同时生成 **10 个一次性恢复码**（只显示一次，服务器只存加盐哈希）。
- 密钥用 `JWT_SECRET` 派生的 AES-GCM 密钥加密后存在 `admin_totp`。**更换 `JWT_SECRET` 会让二次验证密钥无法解密**：轮换前先关闭二次验证，轮换后重新开启。
- 登录：密码正确后，如果开启了二次验证，接口只返回一个 5 分钟有效的 `preAuth` 令牌（用另一把派生密钥签名，即使塞进 Cookie 也不会被当成会话），`POST /api/auth/2fa` 提交验证码或恢复码后才签发会话 Cookie。每个 preAuth 最多试 5 次、成功后作废；每个 IP 每 15 分钟 5 次、全站 30 次。
- 关闭和重新生成恢复码都需要当前验证码（关闭也可以用恢复码）。所有成功 / 失败都写进后台安全记录。
- **手机丢了又没有恢复码**：在 D1 里执行 `UPDATE admin_totp SET enabled_at = NULL WHERE id = 1;` 关闭二次验证（需要 Cloudflare 账号权限，这是有意的最后手段）。
- `API_TOKEN`（脚本 / MCP 的 Bearer 令牌）不受二次验证影响：它本身就是独立的高强度密钥，请妥善保管并定期轮换。

## 演示站

GitHub Pages 演示站没有服务器，`mock-security.ts` 用同一份 `security-core.ts` 实现同样的接口和规则：

- 「登录设备」里除了本机，还有两台标明「演示数据」的虚构设备，可以退出；网络标记是虚构的。
- Passkey 是真的：浏览器 / 系统认证器创建凭据，公钥只保存在这个浏览器的 localStorage 里，登录时同样校验 clientData、rpIdHash、签名与计数。RP ID 是当前页面的主机名（本地测试必须用 `localhost`，WebAuthn 不允许 IP 地址做 RP ID）。
- 管理员二次验证的密钥只保存在这个浏览器里；可以用真实的验证器 App 扫码体验。
- 没有定时任务：冷静期到期的账号在下一次请求时清除。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `WEBAUTHN_RP_ID` | Passkey 的 RP ID，默认 `SITE_URL` 的主机名。必须是前端页面的域名或它的上级域名；改了之后已有的 Passkey 全部失效。 |
| `WEBAUTHN_ORIGINS` | 允许的 WebAuthn 来源，逗号分隔，默认 `SITE_URL` 的 origin。 |
