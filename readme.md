# Koishi 插件：Twitter Fetcher

[![npm](https://img.shields.io/npm/v/koishi-plugin-twitter-fetcher.svg)](https://www.npmjs.com/package/koishi-plugin-twitter-fetcher)
[![npm](https://img.shields.io/npm/dm/koishi-plugin-twitter-fetcher.svg)](https://www.npmjs.com/package/koishi-plugin-twitter-fetcher)

一个 推特/Twitter/X 的链接解析插件。当你或群友在聊天中发送一条推特链接时，本插件会自动抓取该链接的全部信息，包含：

*   用户 ID 和推文内容
*   推文截图
*   推文中包含的所有图片和视频

---

## ✨ 功能特性

*   **自动触发**: 无需任何指令，发送链接即可自动解析。
*   **内容全面**: 同时获取推文的文本、截图、图片、视频。
*   **高度可配置**: 可自由开关截图、文本、媒体、合并转发等功能。
*   **智能回退**: 在非 QQ 平台或关闭合并转发时，会自动切换为图文拼接的发送模式。

---

## 📦 安装

1.  **从 Koishi 插件市场搜索并安装 `twitter-fetcher`。**

2.  **安装前置依赖 `puppeteer`**：本插件的截图功能依赖于 `puppeteer` 服务，请确保你已经正确安装并配置了它。
    ```bash
    # 如果你尚未安装 puppeteer
    npm install koishi-plugin-puppeteer
    ```

---

## ⚙️ 配置项

你可以在插件配置页面中调整以下选项：

*   **`showScreenshot`**: 是否发送推文截图。(默认: `true`)
*   **`sendText`**: 是否发送提取的推文文本。(默认: `true`)
*   **`sendMedia`**: 是否发送推文中的图片和视频。(默认: `true`)
*   **`cookie`**: (可选) 你的 Twitter/X 登录 Cookie。
*   **`useForward`**: (推荐) 是否使用合并转发的形式发送。在非 `onebot` 平台会自动禁用。(默认: `true`)
*   **`logDetails`**: 是否在控制台输出详细的调试日志。日常使用建议关闭。(默认: `false`)

---

## 📝 使用方法

安装并启用插件后，无需任何额外操作。

你只需要在任意群聊或私聊中，发送一条包含 Twitter/X 链接的消息即可。

**例如:**
> 快看这个！https://x.com/elonmusk/status/1585841233215102976

机器人将会自动解析并回复聚合了全部内容的消息。

---

## 🖼️ 效果演示

![效果图](https://i.postimg.cc/dtc61yqd/1.png)

---

## ⚠️ 注意事项

*   本插件的数据来源于 `vxtwitter.com` API，解析的成功与否依赖于该服务的稳定性。
*   截图功能依赖 Puppeteer 访问 Twitter 官网，可能会因网络波动或 Twitter 前端代码更新而偶尔失败。

---

## ⚖️ 免责声明

1.  **工具属性**: 本插件是一个基于 Koishi 框架的技术工具，旨在通过聚合公开的互联网信息，为用户提供便利的浏览体验。

2.  **内容来源**: 本插件展示的所有文本、图片、视频及截图内容，均来源于第三方 API (`vxtwitter.com`) 及 Twitter/X 平台本身。插件开发者不拥有、不生产、不存储、也不对这些内容的合法性、准确性或完整性做任何保证。

3.  **用户责任**: 使用本插件的用户，必须在遵守当地法律法规及 Koishi 和 Twitter/X 平台用户协议的前提下进行。用户通过本插件获取和传播的所有信息，其责任由用户本人承担。**严禁使用本插件从事任何非法活动或传播不当内容。**

4.  **免责条款**: 开发者不对因使用、不当使用或无法使用本插件而导致的任何直接、间接、偶然、特殊或后果性的损害承担任何责任。

**您在下载、安装或使用本插件时，即表示您已阅读、理解并同意以上所有条款。**

---

## 💖 致谢

*   **Koishi**: 提供了一切的基础。
*   **`vxtwitter.com`**: 提供了稳定、好用的推文解析 API。
*   **shangxue 的 `bilibili-videolink-analysis` 插件**: 本插件的文件处理方案深受其启发，特此感谢。