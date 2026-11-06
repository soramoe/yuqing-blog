---
name: "渔情LiveBot"
title: "渔情LiveBot下载 · B站直播弹幕与点歌助手"
description: "渔情LiveBot 是本地运行的 B 站直播助手，集中处理弹幕答谢、SC、舰长、点歌、OBS 挂件和下播战报。"
summary: "B站直播助手机器人：弹幕、礼物、SC、舰长、点歌、战报，一个窗口全接住。"
eyebrow: "WINDOWS LIVE TOOL"
version: "1.0.6"
releasedAt: 2026-11-06
updatedAt: 2026-11-06
status: "available"
platforms:
  - "Windows 10 / 11 x64"
packageName: "渔情LiveBot-1.0.6.zip"
sizeBytes: 34615211
packageCount: 221
sha256: "8FEA509E98AAC7DE583A7A21AA25BBDEFE2CF88C8E61DBA8B8BECA60418DB621"
downloadUrl: "https://github.com/soramoe/yq-bot/releases/download/v1.0.6/yuqing-bot-1.0.6.zip"
releaseUrl: "https://github.com/soramoe/yq-bot/releases/tag/v1.0.6"
manualUrl: "https://xhz6.com/blog/yuqing-livebot-manual-1-0-5/"
repoUrl: "https://github.com/soramoe/yq-bot"
licenseUrl: "https://github.com/soramoe/yq-bot/blob/main/docs/licensing.md"
feedbackGroup: "1092065806"
features:
  - icon: "chat"
    title: "弹幕答谢"
    description: "欢迎、礼物、舰长、SC 自动答谢，文案和间隔都能改。"
  - icon: "music"
    title: "点歌队列"
    description: "观众发「点歌 歌名」进队列，同曲去重，上限 100 首。"
  - icon: "support"
    title: "SC 与舰长"
    description: "SC 待读、舰长续费提醒，不漏掉付费观众。"
  - icon: "report"
    title: "下播战报"
    description: "场次、时长、弹幕、涨粉、礼物和总收入，一键复制或出海报。"
  - icon: "obs"
    title: "OBS 挂件"
    description: "透明只读挂件，拖进 OBS 就能显示弹幕、观众、礼物目标。"
  - icon: "pk"
    title: "PK 情报"
    description: "对面公开数据对比、开场播报，不读对面弹幕。"
steps:
  - title: "下载并解压"
    description: "解压到一个固定目录，不要放在会自动同步的网盘目录。"
  - title: "运行安装脚本"
    description: "双击 scripts\\install.bat，看到 [DONE] Environment is ready. 就表示环境准备完成。"
  - title: "启动并扫码登录"
    description: "双击 启动渔情.bat，浏览器打开 http://127.0.0.1:8900，再扫码登录 B站。"
requirements:
  - "Windows 10 / 11，64 位"
  - "约 200 MB 磁盘空间（含内置 Node）"
  - "需要能访问 B站"
  - "不需要单独安装 Node、npm 或其他运行库"
  - "首次使用需要扫码登录 B站"
faqs:
  - question: "需要先装 Node 吗？"
    answer: "不用。安装包已经内置 Windows 便携 Node 22.21.1。"
  - question: "手机能直接打开吗？"
    answer: "默认只监听本机 127.0.0.1，手机不能直接访问。需要自己做好端口转发并设置访问口令。"
  - question: "数据会上传吗？"
    answer: "不会。日志和配置都在本机 data/ 目录，B站登录凭证也只保存在本机。"
  - question: "换电脑怎么办？"
    answer: "授权绑定本机与 B站 uid，换机或换号需要在购买、签发渠道重新绑定。"
  - question: "更新会丢配置吗？"
    answer: "不会。更新只替换程序文件，data/ 目录不会被覆盖。"
trialDays: 7
priceNote: "主播个人与有爱DD永久免费使用，工作室、公会禁止使用。"
licenseNotes:
  - "授权绑定本机与 B站 uid。"
  - "换机或换号需要重新签发。"
  - "公益项目，请勿倒卖或二次收费。"
footerNote: "渔情LiveBot · 本地运行 · 数据留在自己电脑"
coverImage: "/tools/livebot-og.png"
screenshots: []
draft: false
order: 10
---
