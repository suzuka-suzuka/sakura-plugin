# Sakura Plugin

Sakura Plugin 是 Sakura Bot 的综合功能插件，提供 AI 对话、图片生成、Pixiv、搜图、表情包、关键词回复、经济系统、钓鱼玩法、群管理、提醒、睡眠记录、自动推送等功能。

插件配置由 `configSchema.js` 定义，运行时配置保存在：

```text
config/sakura-plugin/*.yaml
```

推荐通过 Sakura 的 Web 配置面板编辑配置。

## 环境要求

在框架环境之外，本插件还需要以下能力：

- Node.js 20 或更高版本。
- pnpm 9 或更高版本。
- Redis，经济、上下文、定时任务、订阅等功能需要使用。
- Chrome / Chromium，菜单、签到、画像、表情包列表等截图渲染依赖 Puppeteer。
- 可选：Python，用于部分 MCP 扩展。
- 可选：AI、Pixiv、Grok、NovelAI、VoxCPM 等外部服务账号或 API Key。

## 安装

如果插件已经随 Sakura 仓库一起存在，只需要在 Sakura 根目录安装依赖：

```bash
cd Sakura
pnpm install
```

如果单独安装插件：

```bash
cd Sakura
git clone --depth=1 -b sakura https://github.com/suzuka-suzuka/sakura-plugin.git plugins/sakura-plugin
pnpm install
```

也可以进入插件目录单独安装依赖：

```bash
cd plugins/sakura-plugin
pnpm install
```

## 启动

插件由 Sakura 框架自动加载。启动框架即可：

```bash
cd Sakura
pnpm dev
```

生产环境：

```bash
pnpm start
pnpm log
```

启动后访问配置面板：

```text
http://localhost:3457
```

登录密码由根目录 `config/config.yaml` 的 `web.password` 决定。

## 配置方式

插件配置目录：

```text
config/sakura-plugin/
```

常用配置文件：

- `bot.yaml`：机器人名称等基础信息。
- `Channels.yaml`：AI 文本/多模态渠道，包括 Gemini、OpenAI、Grok。
- `ImageChannels.yaml`：生图渠道，包括 Gemini 图片和 OpenAI 图片。
- `AI.yaml`：AI 对话、工具组、上下文、Markdown 处理等设置。
- `roles.yaml`：AI 角色和人设。
- `EditImage.yaml`：图片编辑触发词和生图渠道选择。
- `economy.yaml`：经济系统、启用群、指令消耗价格。
- `pixiv.yaml`：Pixiv cookie、refresh token、订阅推送。
- `nai.yaml`：NovelAI 绘图 token、模型和负面提示词。
- `VoxCPMVoice.yaml`：语音角色和默认语音角色。
- `mimic.yaml`：伪人拟态回复。
- `SearchImage.yaml`：搜图渠道和返回数量。
- `poke.yaml`、`repeat.yaml`、`recall.yaml`：戳一戳、复读、防撤回。
- `60sNews.yaml`、`teatime.yaml`、`cool.yaml`：定时和自动推送。

配置文件会由 Web 面板按 `configSchema.js` 自动生成和校验，不建议手写大段 YAML。

## 必填配置建议

### AI 对话

1. 在 `Channels` 中配置至少一个 Gemini、OpenAI 或 Grok 渠道。
2. 在 `roles` 中配置角色。
3. 在 `AI.profiles` 中配置角色触发前缀、角色名和渠道。
4. 群内发送角色前缀加内容即可触发对话。

### 图片生成和图片编辑

1. 在 `ImageChannels` 中配置生图渠道。
2. 在 `EditImage.imageChannel` 中选择一个生图渠道。
3. 使用 `#i 提示词` 生图，或引用图片后使用 `#i 提示词` 改图。
4. 可在 `EditImage.tasks` 中配置自定义图片编辑触发词。

### 经济系统

1. 在 `economy.enable` 开启经济系统。
2. 在 `economy.Groups` 中选择需要启用指令扣费的群。
3. 在 `economy.gamegroups` 中选择启用经济游戏的群。
4. 在 `economy.commandCosts` 中配置各指令的樱花币消耗。

注意：经济游戏如钓鱼、商店、背包等有自己的物品和装备消耗逻辑，不完全依赖指令扣费群。

### Pixiv

1. 在 `pixiv.cookie` 和 `pixiv.refresh_token` 中配置 Pixiv 登录信息。
2. 配置 `r18` 控制 R18 功能可用群。
3. 使用 `#pid`、`#来张插画`、`#日榜` 等指令。

### Grok

`Channels.grok` 支持：

- `sso`
- `supersso`
- `cf_clearance`
- `x_statsig_id`
- `temporary`
- `dynamic_statsig`

Grok 图片和视频功能会读取这些配置。

### NovelAI

1. 在 `nai.token` 中填写 NovelAI token。
2. 根据需要调整 `nai.model` 和 `nai.negative`。
3. 使用 `#绘图 提示词`。

### VoxCPM 语音

1. 在 `VoxCPMVoice.roles` 中配置角色名、声音描述和参考音频路径。
2. `defaultRole` 用于普通 `说 内容`。
3. `aiDefaultRole` 用于 AI 工具调用语音。
4. 可用 `#添加语音角色`、`#语音角色列表`、`#删除语音角色` 管理角色。

## 功能与指令

菜单指令：

- `#菜单`：查看分类总览。
- `#AI菜单`、`#创作菜单`、`#图片菜单`、`#表情菜单`、`#经济菜单`、`#钓鱼菜单`、`#群管菜单`、`#工具菜单`、`#自动菜单`：查看二级分类菜单。
- `#主人菜单` / `#维护菜单`：查看主人维护指令。
- `#全部菜单`：按分类合并转发完整菜单，一类一张图。

AI 对话与记忆：

- 角色前缀 + 内容：AI 聊天。
- `#停止` / `#强制停止`：停止当前生成。
- `#清空对话 <角色>`、`#撤销对话 <角色>`、`#篡改对话 <内容>`、`#列出对话 <角色>`。
- `#添加记忆`、`#删除记忆`、`#导出记忆`。
- `#人设增加`、`#人设删除`、`#列出人设`、`#列出渠道`。

AI 创作：

- `#i <提示词>`：生图或改图。
- `#绘图 <提示词>`：NovelAI 绘图。
- `#gi <提示词>`：Grok 图片。
- `#gv <提示词>`：Grok 视频。
- `说 <内容>` / `<角色名>说 <内容>`：语音生成。

图片与 Pixiv：

- `#来张涩图`、`#来张萝莉图`。
- `#pid <作品ID>`、`#来张插画 <关键词>`。
- `#日榜`、`#周榜`、`#月榜`、`#日榜#1`。
- `#订阅标签`、`#取消订阅标签`、`#订阅画师`、`#取消订阅画师`、`#订阅列表`。
- `#搜图`、`#ascii搜图`、`#saucenao搜图`。
- `切割 <行> <列>`、`#传相册`、`#刷新群相册`。

表情与娱乐：

- `#添加 <关键词>`、`#删除 <关键词>`、`#词条列表`。
- `#随机表情包`、`#表情包列表`、`#表情包搜索`、`#表情包帮助`。
- `#存表情`、`#发表情`、`#删表情`、`#清空表情库`。
- `#创建飞行棋`、`#加入飞行棋`、`#开始飞行棋`、`#结束飞行棋`。
- `#好感度`、`#谁在意我`、`#我在意谁`。

经济与钓鱼：

- `#签到`、`#我的信息`、`#金币排行`、`#等级排行`。
- `#商店`、`#购买`、`#背包`、`#升级背包`、`#出售`、`#使用`。
- `#转账`、`#打劫`、`#反击`、`#领取复活币`。
- `#钓鱼`、`#装备鱼竿`、`#装备鱼饵`、`#装备鱼线`。
- `#钓鱼状态`、`#钓鱼记录`、`#投放鱼雷`、`#鱼雷状态`、`#钓鱼排行`。
- `#职业列表`、`#选择职业`、`#进阶职业`。

群管理：

- `#清理未发言`、`#清理不活跃`、`#清理等级 <等级>`。
- `#禁言 @用户 10分钟`、`#踢 @用户`。
- `#设精华`、`#全员禁言`、`#解除全员禁言`。
- `#群公告 <内容>`、`#群待办`。
- `#同意`、`#拒绝`：处理入群申请。

工具与自动功能：

- `#画像`。
- `#提醒列表`、`#删除提醒`、`#开启提醒`、`#关闭提醒`。
- `晚安`、`早安`、`睡眠信息`、`睡眠分析`。
- B站链接解析、消息转发、入退群通知、冷群发图、表情包学习、主动聊天、Pixiv 订阅推送、60 秒新闻、自动清理。

## 指令扣费

可扣费指令由 `configSchema.js` 的 `commandNames` 定义，默认价格由 `defaultCommandCosts` 定义。当前默认包含：

- 来张涩图、来张萝莉图、来张插画、pid、Pixiv 排行榜和详情。
- AI聊天、AI图片编辑、绘图、Grok 图片、Grok 视频、语音生成、伪人。
- 添加词条、删除词条、表情包制作、随机表情包、搜图。

扣费只在 `economy.enable` 开启且当前群在 `economy.Groups` 中时生效。主人不扣费。部分指令支持失败退款。

## 可选 MCP 依赖

部分 AI 工具可使用 MCP 扩展。

Fetch Server：

```bash
pip install mcp-server-fetch
```

GitHub MCP Server：

1. 到 `https://github.com/github/github-mcp-server/releases/latest` 下载对应平台二进制。
2. Windows 放到：

```text
plugins/sakura-plugin/github-mcp-server/github-mcp-server.exe
```

3. Linux 放到：

```text
plugins/sakura-plugin/github-mcp-server/github-mcp-server
```

并赋予执行权限：

```bash
chmod +x plugins/sakura-plugin/github-mcp-server/github-mcp-server
```

## 数据与资源

- `data/`：插件运行数据，如语音角色音频、数据库等。
- `resources/`：图片模板、菜单模板、钓鱼资源、商店配置、飞行棋资源等。
- `resources/economy/shop.yaml`：商店物品。
- `resources/economy/bag.yaml`：背包配置。
- `resources/economy/profession.yaml`：钓鱼职业。
- `resources/fish/fish.json`：鱼类和事件配置。
- `lib/menu.js`：菜单内容定义。
- `resources/menu/menu.html`：菜单图片模板。

## 常见问题

### 菜单图片不清晰或过长

菜单使用 Puppeteer 渲染 PNG。`#全部菜单` 会按分类合并转发，一类一张图，避免超长图被 QQ 客户端截断或重复显示。

### 指令没有扣费

检查：

1. `economy.enable` 是否开启。
2. 当前群是否在 `economy.Groups` 中。
3. `economy.commandCosts` 中是否存在该指令名称且价格大于 0。
4. 当前用户是否是主人，主人默认不扣费。

### Pixiv 功能不可用

检查 `pixiv.cookie` 和 `pixiv.refresh_token` 是否有效，R18 功能还需要检查 `r18` 配置。

### Grok 功能不可用

检查 `Channels.grok` 是否配置 `sso` 或 `supersso`，并确认 `cf_clearance`、`x_statsig_id` 等网页访问参数仍有效。

### 生图提示未配置渠道

检查 `ImageChannels` 是否有可用渠道，并在 `EditImage.imageChannel` 中选择对应名称。

## 更新

如果插件是 git clone 安装：

```bash
cd plugins/sakura-plugin
git pull
cd ../..
pnpm install
```

也可以使用主人指令：

```text
#更新
```
