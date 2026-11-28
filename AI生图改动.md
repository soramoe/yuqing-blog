# AI 生图改动（2026-11-28 交接文档，2026-11-29 更新）

> **读者**：接手本项目的 AI 助手 / 开发者。读完本文即可继续开发，无需考古对话记录。
> **项目**：xhz6.com 博客（Astro，Cloudflare Pages + D1 + R2），仓库 `soramoe/yuqing-blog`，main 分支推送即自动部署 Pages。
> **本文覆盖**：2026-11-28 当天完成的全部 AI 生图系统改动（42+1 个 commit）+ Colab 侧改动 + 生产环境实况 + 待办与坑；2026-11-29 补充 **Colab 完全移除**。
> **密钥零容忍**：本文不含任何密钥。云端模型密钥在 D1 `image_provider.api_key` / Pages 环境变量。

---

## 0. 系统一句话架构

用户在 `/ai-image/`（登录 + 积分墙）提交中文提示词 → `POST /api/ai-image/generate` 预扣积分并落 `image_job` → `src/lib/image-service.ts` 调 `image-router.ts` 按 **features 白名单** 选择供应商适配器 → 云端适配器出图 → 存 R2 `ai/images/` → 失败自动退积分。

## 0.5 2026-11-29：Colab 已完全移除（当前状态以此节为准）

Colab SDXL 自建管线、排队/付费插队、提示词翻译、掉线站内信与定时探活 Worker 已整体下线。**下文与 Colab 相关的内容仅作历史记录。**

- 适配器：仅保留 `workers-ai` / `dashscope-images` / `openai-images` / `ark-images` / `bigmodel-image`（`IMAGE_PROVIDER_ADAPTERS`）。`colab-sdxl` 已从类型、路由、后台新增表单和前台模型列表中移除；后台供应商列表与 PATCH 也会过滤/拒绝对应的遗留行。
- 已删除：`src/lib/translate.ts`、`src/lib/system-notify.ts`、`functions/api/ai-image/queue.ts`、`functions/api/ai-image/health.ts`、`colab-probe-worker/`，以及 `IMAGE_COLAB_URL` / `IMAGE_COLAB_KEY` / `IMAGE_TRANSLATE_API_KEY` 环境变量。
- 提示词：AI 生图页的方舟 Seedream / 智谱 GLM 原生理解中文，直接传原文；互动小说插画的英文提示词由 `createSceneBrief` 自行生成，与已删除的翻译模块无关。
- 数据：`image_provider` 的 `colab-sdxl` 行**保留**（维持 `image_attempt` 历史关联）但 `enabled=0`；`image_setting.queue_jump_points` 删除（迁移 `0030` / `0031`）。
- 后台首页仪表盘不再显示「Colab 生图服务」卡片，生图状态以剩余供应商的探活/冷却结果为准。
- **部署顺序：先部署本批代码，再执行 `0030`、`0031` 迁移。** `0031` 会删除 `queue_jump_points`，旧代码仍会 SELECT 该列，顺序反了会 500。`0030` 可重复执行；`0031` 只需执行一次。生产环境如还配置了 `IMAGE_COLAB_*` / `IMAGE_TRANSLATE_API_KEY`，部署后从 Pages 环境变量中删除。

## 1. 请求链路关键约定（2026-11-28 历史约定，Colab 相关已作废）

| 环节 | 约定 |
|---|---|
| features 白名单 | `image_provider.features` 决定能力：`image_studio`=AI 生图页可用，`story_chapter`=互动小说可用，`admin_test`=后台可测试。路由时只挑 `enabled=1` 且含目标 feature 的供应商 |
| 开关层级 | `image_setting.enabled` 是总开关（所有生图）；`image_setting.story_enabled` 是**互动小说插画独立开关**，仅在总开关开启时生效。关闭后 `/api/story/illustration` 在调用场景改写 LLM 前直接 503，`/api/story/status` 的 `imageGenerationEnabled` 变为 false（前台隐藏插画选项）。后台在「生图控制」页单独勾选 |
| 指定模型 | 前端传 `model`（即 provider id）时**只**调用该供应商，并给出精确错误（不存在 / 冷却中 / 未绑定密钥） |
| 积分 | 「AI 生图」按清晰度分别计价：1K = `studio_points`（当前 500），2K = `studio_hd_points`（当前 1000）；互动小说插画 1K/2K = `standard_points`/`hd_points`。`chargeImageJob` / `refundImageJob` 原子扣退（point_account + point_transaction） |
| 提示词 | AI 生图页的方舟 Seedream / 智谱 GLM 原生理解中文，直接传原文；互动小说插画由 `createSceneBrief` 生成中英双语画面描述，英文经 `englishPrompt` 下发给需要英文的适配器（如 Workers AI），不再走单独的翻译链路 |
| 冷却熔断 | `image_provider.consecutive_failures / cooldown_until`，达到 `failure_threshold` 后冷却 `cooldown_seconds`；后台一键清零 |
| 密钥脱敏 | 管理端点返回 provider 时剥掉 apiKey，给 `hasApiKey` + `apiKeyMasked` |
| 参考图 | 仅方舟支持 img2img（`init_image` data URL，页面限 8MB、API 限 12M 字符）；其余模型回退纯文生图并在响应 `note` 标注「参考图已忽略」 |

## 2. 尺寸表（image-service.ts，auto=不传宽高走模型默认）

| 比例 | standard(1K) | hd(2K) |
|---|---|---|
| 1:1 | 1024×1024 | 1536×1536 |
| 4:5 | 864×1080 | 1248×1560 |
| 16:9 | 1280×720 | 1920×1088 |
| 9:16 | 720×1280 | 1088×1920 |
| 4:3 | 1152×864 | 1536×1152 |
| 3:4 | 864×1152 | 1152×1536 |
| 21:9 | 1344×576 | 1920×832 |
| auto | 模型自适应 | 模型自适应 |

## 3. 今天的 git 提交（全部已推送，按主题分组）

**基础链路**：`f5d1abe` AI 生图页面 + Colab 代理 → `0befab9` 接入积分/站内信/掉线提醒
**翻译**：`483aaa2` LLM 智能改写 → `61e255d` 移除千问链路 → `0c2fe4d` 独立密钥 `IMAGE_TRANSLATE_API_KEY` → `62c702c` 拟人动物保护 + 默认负面词
**积分/排队**：`7bf12ea` 定价校准 → `2ebe601` VIP 队列 + 付费插队 → `ea459f9` 排队满文案 → `f486a94` 我的生图历史页 → `84302b6` 后台重置冷却
**后台体系**：`435a74c` 后台重组 + AdminNav → `8542dda` 公告管理页 → `c89e603` 账户页站长工具精简 → `2d876ec` 模型自选/绑定/用量面板 → `43b13fc` 模型卡片视觉升级 → `476c816` 实时监控（15s 刷新）→ `ba3b18a` **独立 AI 配置面板**（`/admin/ai-config/`），生图管理瘦身为运营参数页 → `c2bea6f`/`d96f365`/`ead510a` 状态行与 PATCH 修复 → `3c9e5f1` 新增/删除供应商 + 在线拉取模型列表 → `90b334d` 类型标注
**通知**：`4c2b9cb` 站内信编号导航 → `2c7a497` 邮件结果写入站内信 + **定时探活 Worker** → `56913b5` 登录态缓存消除闪烁
**火山方舟**：`622bee9` ark-images 适配器（Seedream 原生中文直传不走翻译）→ `da78539` 修复 `.slice` 作用于 Promise 的优先级 bug
**UI 坑修复**：`8ba46de` 公告管理选择器崩溃 → `2343468` 动态元素样式全局化 → `015a2b5` 安全响应头 + functions 独立 tsconfig + `english_prompt` 落库
**大重构**：`9611e70` **生图页重做为左右布局工作台**（模型卡片 / 参考图 img2img / 批量 1-4 并发+槽位进度 / 1K·2K / 7 种比例含 auto / 可上传站内图库 / 计时器 / 历史区）
**收尾修复**：`b23f0e5` auto 比例下三个云端适配器 size 缺省 1024×1024（修掉 `"undefinedxundefined"` 非法参数）
**下午追加**：`5637896` 模型选择改为**下拉框**（模型卡片 UI 崩坏弃用）；火山方舟按官方 API 重写——`seedreamSize` 总像素守卫 [921600(1280x720), 8294400(2880x2880)]、参考图走 `image:[Base64]`（Seedream 5.x 单图生图语义）；新增智谱 **GLM 适配器** `bigmodel-image`（`POST https://open.bigmodel.cn/api/paas/v4/images/generations`、Bearer、返回 URL 由 `fetchProviderImage` 二次下载、`glmSize` 512–2048 且 32 倍数、prompt≤1000）；0027 迁移建 `glm-image` 供应商行 → `8d91b1d` 方舟 `SetLimitExceeded` 映射为「安全体验模式额度上限」明确提示

**链路补洞（交接后追加）**：`f6fafef` 生图 POST 真正接收 `init_image` 与全部 7 种比例（含 auto）——此前页面虽发了这两个字段，但 API 只白名单 3 种比例、且完全忽略 `init_image`，导致「大重构」的参考图/竖版/超宽/auto 全部静默失效（9:16 等被压成 1:1）。同时：Colab 适配器透传 `init_image`/`strength`；参考图只下发给支持 img2img 的适配器并在 note 提示；原生中文模型跳过翻译；插队只对 Colab 扣费；方舟/智谱 baseUrl 兼容完整 `/images/generations` 地址；后台新增供应商适配器白名单补 ark / GLM；模型列表按适配器拉取；未知适配器不再回落成千问。

**全站生图挂掉的根因（2026-11-28 下午定位）**：`015a2b5` 给 `image_job` 的 INSERT 列清单加了 `english_prompt`，但 VALUES 没补对应的 `?` → `D1_ERROR: 15 values for 16 columns`，**从那次部署起任何模型、任何用户都在建任务时 500**，前端只显示「生图任务创建失败。」且 D1 里无任何 `image_job` / `image_attempt` 记录（所以容易误判成供应商问题）。`335b393` 先临时把底层错误透到前端用于定位，`cdbba19` 补回占位符并恢复通用文案（保留 `console.error`）。修复后已用前台「火山方舟 Seedream」真实出图验证：job `7160ae13…`、1280×720、9.2s、扣 500 积分、`image_asset` 落库成功，方舟的「安全体验模式」限制当前也已解除（直调 200）。

**互动小说生图独立开关（2026-11-28 下午）**：`e4d303e` + 迁移 `0028`。`image_setting` 新增 `story_enabled`（默认 1）；后台「生图控制」页新增「互动小说生图」开关（总开关关闭时置灰）。关闭后：`/api/story/illustration` 在 LLM 场景改写之前就 503、服务层对 `story_chapter` 二次校验、`/api/story/status` 的 `imageGenerationEnabled` 置 false（前台隐藏插画选项）。迁移同时给现有的 `image_studio` 供应商补了 `story_chapter` 能力——此前白名单里**没有任何启用的 story_chapter 供应商**，小说插画本来是无模型可用的。

**后台首页仪表盘（2026-11-28 傍晚）**：`ddd5ae7` + `29960af` + `9041a14`（供应商徽标以探活结果为准，Colab 离线时不再误显示「就绪」）。去掉与 AdminNav 重复的 8 张入口卡片，改为运行状态：站点在线+API 延迟、生图总开关、互动小说插画开关、Colab 探活；生图面板（今日任务/成功失败、1K·2K 单价、本月预算、供应商状态）；互动小说面板（站点 Key、回合积分/上限、试玩额度）；最近 8 次生图调用。数据来自 `/api/admin/status`、`/api/admin/image`、`/api/ai-image/generate`、`/api/story/status`，60 秒自动刷新。注意动态 DOM 样式必须写在 `<style is:global>`。

> 同日另有 deals 数据巡检合并（PR #2 等），与生图无关。

## 4. 今天完成但不在 git 里的改动

> 以下 Colab 侧内容已于 2026-11-29 整体下线，仅保留作历史记录。

1. **Colab 笔记本 `yuyueyu.ipynb` 一键启动格 → v3**（已写入并保存到 Drive，现已停用）：
   - 新增 `init_image`（data URL / 纯 base64）+ `strength` → 有参考图走 img2img，无则文生图
   - 新增 `GET /queue` 排队状态端点
   - `GenQueue`：最多 4 人排队，VIP（`x-queue-jump`）插到最前，普通请求最长等 300s
   - 208 行语法校验通过；**本地备份**：`C:\Users\14055\.zcode\workspace\default\colab-oneclick-v3.py`
   - ⚠️ **尚未运行**（GPU 额度用完，见 §7）
2. **探活 Worker 已部署**（已下线）：`yuqing-probe.lwmoonmoe.workers.dev`，cron `*/15`，绑 D1，6 小时去重，掉线时站内信+邮件。仓库内 `colab-probe-worker/` 已删除；如线上 Worker 仍存在，可在 Cloudflare 控制台删除。
3. **生产 D1 运维操作**（通过后台 UI / 迁移）：0023-0026 迁移已执行；火山方舟密钥已由站长绑定、模型已切到 `doubao-seedream-5-5-261028`；`studio_points` 由 40 调为 500。

## 5. 生产环境实况（2026-11-28 经 wrangler 直查远程 D1）

`image_provider`（6 行，2026-11-28 下午复核）：

| id | adapter | model | enabled | features | api_key |
|---|---|---|---|---|---|
| cloudflare-workers-ai | workers-ai | @cf/black-forest-labs/flux-1-schnell | **0** | story_chapter, admin_test | EMPTY（env 兜底） |
| qwen-image | dashscope-images | qwen-image-2.1-turbo | **0** | story_chapter, admin_test | EMPTY |
| siliconflow-image | openai-images | Qwen/Qwen-Image | **0** | story_chapter, admin_test | EMPTY |
| colab-sdxl | colab-sdxl | sd_xl_base_1.0 | **0**（0030 迁移后停用，行保留供历史关联） | image_studio, admin_test | EMPTY（环境变量已移除） |
| ark-seedream | ark-images | doubao-seedream-5-5-261028 | 1 | **image_studio**, admin_test | **SET** ✅（`base_url` 直接填了完整 `/api/v3/images/generations`） |
| glm-image | bigmodel-image | glm-image | 1 | **image_studio**, admin_test | **SET** ✅（已绑定智谱密钥） |

`image_setting`（id=global）：`enabled=1`，`story_enabled=0`（站长已在后台关闭互动小说插画），`studio_points=500`，`studio_hd_points=1000`，`standard_points=500`，`hd_points=1000`，`daily_job_limit=100`，`monthly_budget_cents=5000`，`point_value_cents=1`。原 `queue_jump_points=60` 已由迁移 `0031` 删除。

已开放的三个供应商（colab-sdxl / ark-seedream / glm-image）features 均已追加 `story_chapter`（0028 迁移）。2026-11-29 起 colab-sdxl 停用，实际生图在方舟与 GLM 之间按优先级路由。

## 6. 端点地图

- **前台**：`GET/POST /api/ai-image/generate`（GET=配置+模型列表；POST=生图）、`GET /api/ai-image/mine`（我的历史）、`POST /api/gallery/upload`（图库上传）；页面 `/ai-image/`、`/my-images`、`/notifications`
- **后台**（需站长会话）：`GET/PATCH/POST/DELETE /api/admin/image`（settings 与 providers 拆分提交）、`POST /api/admin/image/models`（按 base_url 拉模型列表）、`POST /api/admin/image/cooldown`（清零冷却）；页面 `/admin/`、`/admin/ai-config/`、`/admin/image/`、公告管理页

## 7. 2026-11-29 上线清单（Colab 移除）

1. 部署本批代码（main 推送后自动构建 Pages）。
2. 远程 D1 执行 `migrations/0030_remove_colab.sql`：停用 `colab-sdxl` 供应商行（可重复执行）。
3. 代码部署完成后，执行 `migrations/0031_drop_queue_jump_points.sql`：删除 `image_setting.queue_jump_points`。**顺序不可反**，旧代码仍会 SELECT 该列。
4. Cloudflare Pages 环境变量中删除 `IMAGE_COLAB_URL` / `IMAGE_COLAB_KEY` / `IMAGE_TRANSLATE_API_KEY`（如仍存在）。
5. 如仅服务 Colab 的定时探活 Worker（`yuqing-probe`）不再使用，在 Cloudflare 控制台删除。
6. 验证：
   - 前台 `/ai-image/` 模型下拉只剩方舟 / GLM；
   - 后台首页不再有「Colab 生图服务」卡片；
   - `GET /api/ai-image/generate` 不再返回 `ok` / `queueJumpPoints` / `failures`；
   - 后台生图页保存设置成功（确认 INSERT 已不再引用 `queue_jump_points`）。

**已知小 bug（仍未修）**：后台「模型测试」面板会提交 `providerId`，但 `functions/api/admin/image/test.ts` 没有读取它，永远按优先级路由。与 Colab 无关，需要时单独修。

## 8. 文件地图（全部相对仓库根）

```
src/pages/ai-image.astro          生图页（左右布局工作台，~860 行）
src/pages/my-images.astro         我的生图历史
src/pages/notifications.astro     站内信
src/pages/admin/index.astro       后台首页仪表盘（站点/生图/小说状态 + 最近调用，60s 自动刷新）
src/pages/admin/ai-config.astro   AI 配置面板（绑定/新增/拉模型/监控/测试）
src/pages/admin/image.astro       生图管理（分组：开关 / AI 生图 1K·2K 定价 / 插画定价 / 限额预算）
src/components/AdminNav.astro     后台统一导航
src/lib/image-service.ts          任务编排：扣费/尺寸/落库/退款
src/lib/image-router.ts           features 白名单路由 + 指定模型精确报错 + 下线适配器跳过
src/lib/image-providers.ts        5 个适配器（workers-ai / dashscope / openai-images / ark / bigmodel）
src/lib/image-settings.ts         运营参数默认值与读写（IMAGE_STUDIO_POINTS=40 仅为兜底，实际以 D1 为准）
src/types/worker-env.d.ts         functions 用的全局 Env（无 astro 类型依赖）
functions/api/ai-image/*.ts       generate / mine
functions/api/admin/image/*.ts    index（CRUD）/ models（拉列表）/ cooldown（清零）
functions/tsconfig.json           functions 独立类型检查（ES2022 + workers-types，无 DOM）
migrations/0023-0031*.sql         notification、english_prompt、api_key/base_url/features、ark/GLM 行、story_enabled + story_chapter、studio_hd_points；0030 停用 colab-sdxl，0031 删除 queue_jump_points
public/_headers                   安全响应头（X-Frame-Options 等）
C:\Users\14055\.zcode\workspace\default\generate.py            本地生图客户端（调 /api/ai-image/generate）
```

## 9. 已踩过的坑（改代码前必读）

- **Astro 作用域样式**：JS 动态创建的元素拿不到 `data-astro-cid`，样式必须放 `<style is:global>`；`global.css` 顶部已有 `[hidden] { display:none !important }`（状态行隐藏靠它）。
- **后台脚本选择器**：用 `data-*` 属性 + `querySelector`，别混用 `getElementById`（公告管理页曾因此「正在验证权限…」卡死）。
- **火山方舟**：原生中文 prompt 直传、`response_format:"b64_json"`、`watermark:false`；错误详情读取必须 `(await response.text().catch(()=>"")).slice(0,100)`（括号别丢）。
- **已下线的 Colab 坑**（Monaco 改格子、ngrok 头、SDXL 拟人词）随 2026-11-29 移除，仅需在 git 历史中查阅。
- **前后端字段脱节**：页面新增字段（`init_image`、新比例）必须同步改 `functions/api/ai-image/generate.ts` 的白名单/解析，脚本层 `image-service.ts` 支持不代表 API 层会转发——曾因此让参考图和 6 种比例静默失效。改页面表单时先看 API 的入参白名单。
- **SQL 占位符与列数**：给 `INSERT` 加列时务必同步补 `?`（`015a2b5` 加 `english_prompt` 漏了一个，导致全站生图 500 且无任何日志行）。现象：前端「生图任务创建失败。」、D1 无 job/attempt——先数 VALUES 个数，别怀疑供应商。
- **排障入口**：D1 `image_job`/`image_attempt` 无记录 = 请求没走到路由（常见于入库失败、参数 400、401/403）；有 attempt 无 asset = 供应商侧失败。`console.error` 已加在入库 catch 里。
- **迁移顺序与记录**：新代码若 SELECT 了新列，必须**先应用迁移再部署**（老代码忽略新列，反序会 500）；删除列则相反，**先部署不再引用该列的代码，再执行 DROP**（`0031` 即如此）。另外 `d1_migrations` 里**没有 0027**（GLM 那行当时是手工 SQL 写入的），直接跑 `wrangler d1 migrations apply` 会在 0027 重复 INSERT 处失败；后续迁移用 `wrangler d1 execute --remote --file migrations/00xx.sql` 手工执行并自行登记。
- **云端供应商 base_url**：后台可能填基础地址，也可能填完整 `/images/generations`（方舟行就是完整地址）；适配器统一走 `imagesEndpoint()` 拼接，别再手写 `${base}/images/generations`。

## 10. 常用验证命令

```bash
# 线上生图页是否为新版（应有 ai-layout 标记）
curl -sL https://xhz6.com/ai-image/ | grep -c ai-layout

# Colab 移除迁移（务必先部署代码；0031 必须在 0030 之后）
npx wrangler d1 execute yuqing-auth --remote --file migrations/0030_remove_colab.sql
npx wrangler d1 execute yuqing-auth --remote --file migrations/0031_drop_queue_jump_points.sql

# 本地构建
npm run build

# 查远程 D1 供应商状态（colab-sdxl 应为 enabled=0）
npx wrangler d1 execute yuqing-auth --remote --json --command "SELECT id,adapter,enabled,features FROM image_provider"

# 确认插队积分列已删除（应报 no such column）
npx wrangler d1 execute yuqing-auth --remote --command "SELECT queue_jump_points FROM image_setting LIMIT 1"
```
