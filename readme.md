# Koishi 插件：Twitter Fetcher

[![npm](https://img.shields.io/npm/v/koishi-plugin-twitter-fetcher.svg)](https://www.npmjs.com/package/koishi-plugin-twitter-fetcher)
[![npm](https://img.shields.io/npm/dm/koishi-plugin-twitter-fetcher.svg)](https://www.npmjs.com/package/koishi-plugin-twitter-fetcher)

一个 Twitter/X 内容获取与订阅插件。支持链接实时解析、用户订阅推送、截图、文本、图片、视频。

## 功能特性

*   **双模工作**: 同时支持链接实时解析和用户后台订阅。
*   **双来源获取**: 推文文本和媒体都可分别选择 API 或浏览器获取。
*   **浏览器可见文本**: 浏览器模式会读取 X 页面上的可见推文文本，适合需要页面翻译结果的场景。
*   **原图策略**: 浏览器媒体模式下，启用原图后会把 `pbs.twimg.com/media` 图片地址改为 `name=orig`。
*   **真 GIF 可选**: 可将 Twitter 动图从 MP4 转为真正的 GIF，需启用 `koishi-plugin-ffmpeg` 服务。
*   **文件发送策略**: 图片和视频可分别选择 buffer、url、base64 或 file 传递方式。
*   **用户与话题订阅**: 后台定时检查指定用户或 `#hashtag` 的新推文，并推送到多个群组。
*   **右侧悬浮侧边栏**: 安装 Koishi 控制台插件后，配置页会显示可拖动的导航控件。
*   **可选 ChatLuna 翻译**: 除 Google 翻译外，也可选择 ChatLuna 已加载的大语言模型翻译推文。

## 安装

1.  从 Koishi 插件市场搜索并安装 `twitter-fetcher`。
2.  安装并启用 `puppeteer` 和 `database` 服务。
3.  若要使用真 GIF 模式，请安装并启用 `koishi-plugin-ffmpeg`。
4.  若要使用 ChatLuna 模型翻译，请安装并启用 `koishi-plugin-chatluna` 以及至少一个模型适配器，并确保 ChatLuna 中已有可用模型。

## 使用
直接在安装有插件的 koishi bot 群组或者私聊发送 x 链接即可，插件会自动解析并发送推文。


## 配置项

### 1. 解析设置

这些选项仅在手动发送链接进行解析时生效。

*   **`showScreenshot`**: 是否发送推文截图。默认 `true`。
*   **`sendText`**: 是否发送提取的推文文本。默认 `true`。
*   **`sendMedia`**: 是否发送推文中的图片和视频。默认 `true`。
*   **`downloadOriginalImage`**: 是否下载原图。API 模式会继续使用原来的原图规则；浏览器媒体模式会把 `pbs.twimg.com/media` 图片地址改为 `name=orig`。默认 `false`。
*   **`cookie`**: Twitter/X 登录 Cookie，也就是 `auth_token`。
*   **`useForward`**: 是否使用合并转发形式发送。默认 `false`。
*   **`silentParsing`**: 是否关闭解析时的加载提示。默认 `false`。

### 2. 订阅推送内容设置

这些选项仅在后台自动推送订阅推文时生效。

*   **`sub_showLink`**: 推送时是否附带原始推文链接。默认 `true`。
*   **`sub_showScreenshot`**: 推送时是否发送截图。默认 `true`。
*   **`sub_sendText`**: 推送时是否发送文本。默认 `true`。
*   **`sub_sendMedia`**: 推送时是否发送媒体文件。默认 `true`。
*   **`sub_downloadOriginalImage`**: 推送时是否下载原图。默认 `false`。
*   **`sub_useForward`**: 推送时是否使用合并转发。默认 `false`。

### 3. 翻译设置

*   **`translationProvider`**: 翻译服务。默认 `google`。
    *   **`google`**: 调用 Google 翻译接口（现在几乎已经失效了，不推荐使用）。
    *   **`chatluna`**: 调用 ChatLuna 中选择的大语言模型。需要安装并启用 `koishi-plugin-chatluna` 以及对应的模型适配器。
*   **`chatlunaModel`**: 用于翻译的 ChatLuna 模型。使用 ChatLuna 提供的原生模型下拉选项；选择“无”时使用 ChatLuna 的默认模型。仅在 `translationProvider` 为 `chatluna` 时生效。
*   **`parse_enableTranslation`**: 手动解析时是否开启翻译。默认 `false`。
*   **`parse_targetLang`**: 手动解析翻译目标语言。默认 `zh-CN`。
*   **`sub_enableTranslation`**: 订阅推送时是否开启翻译。默认 `false`。
*   **`sub_targetLang`**: 订阅推送翻译目标语言。默认 `zh-CN`。

### 4. 获取方式设置

*   **`apiProvider`**: API 来源。默认 `vxtwitter`。
    *   **`vxtwitter`**: 兼容性较好，返回结构简单，旧版本默认来源。部分 X 长文/Note Tweet 可能只返回短文本片段。
    *   **`fxtwitter`**: 对长文/Note Tweet 的正文支持通常更完整，也会返回替换后的外链文本。返回结构与 vxtwitter 不同，插件会做兼容转换。
*   **`tweetFetchMode`**: 推文文本获取方式。默认 `api`。
    *   **`api`**: 使用上方选择的 API 来源，速度快，不依赖浏览器访问 X 页面。
    *   **`browser`**: 使用 Puppeteer 访问 X 页面并读取页面可见文本。若 X 页面已显示 Grok 翻译，通常能读取到翻译后的文本。
*   **`mediaFetchMode`**: 媒体获取方式。默认 `api`。
    *   **`api`**: 使用上方选择的 API 来源返回的媒体地址。
    *   **`browser`**: 从 X 页面 DOM 和网络响应中提取 `pbs.twimg.com` 与 `video.twimg.com` 媒体地址。

### 5. 文件发送设置

*   **`separateMediaSend`**: 是否将推文媒体独立发送。默认 `false`。开启后，文本和截图先作为主消息发送，推文图片、GIF 和视频会作为后续消息逐条发送。
*   **`imageTransferMode`**: 图片传递方式。默认 `buffer`。
*   **`videoTransferMode`**: 视频传递方式。默认 `buffer`。

四种传递方式的区别：

*   **`buffer`**: Koishi 先下载媒体，再用二进制 Buffer 发送。优点是只有 Koishi 需要能访问 Twitter/X。
*   **`url`**: 直接把远程媒体 URL 交给适配器或 OneBot。优点是不占 Koishi 到 OneBot 的消息体；缺点是 OneBot 或平台端也必须能访问该 URL，如果只有 Koishi 配了代理可能失败。
*   **`base64`**: Koishi 下载媒体后转成 data URL/base64 发送。兼容性直观，但体积会比原文件更大，大文件容易失败。
*   **`file`**: Koishi 下载到本地临时文件后用 `file://` 发送。适合同机部署；如果 Koishi 和 OneBot/NapCat 不在同一容器或同一文件系统中，很容易失败。

*   **`gifMode`**: Twitter 动图处理方式。默认 `video`。
    *   **`video`**: 保持 Twitter 动图的 MP4 视频形态发送，速度快，体积小。
    *   **`realGif`**: 调用 `koishi-plugin-ffmpeg` 提供的 Koishi 服务将 MP4 转成真正的 GIF，再按图片传递方式发送。此模式更耗 CPU，GIF 文件通常也更大。未启用该服务时会回退为视频发送。
*   **`tempPath`**: 临时文件目录，相对于 Koishi 工作目录。`file` 模式和 `realGif` 转换会使用此目录。默认 `data/temp/twitter-fetcher`。

### 6. 订阅设置

*   **`enableSubscription`**: 是否启用订阅功能。默认 `false`。
*   **`platform`**: 用于执行推送的机器人平台，例如 `onebot`。
*   **`selfId`**: 用于执行推送的机器人账号 ID。
*   **`updateInterval`**: 每隔多少分钟检查一次更新。默认 `30`。
*   **`subscriptions`**: 订阅列表。
    *   **`username`**: 要订阅的 Twitter/X 用户名。
    *   **`groupIds`**: 需要推送的群号列表。
    *   **`excludeRetweets`**: 是否排除转推。默认 `true`。
    *   **`tweetFilterMode`**: 最新推文筛选模式。默认 `all`。
*   **`hashtagSubscriptions`**: 话题标签订阅列表。相同标签每轮只搜索一次，再分别向各群推送。
    *   **`hashtag`**: 要订阅的话题标签，可填写 `#AI` 或 `AI`。
    *   **`groupIds`**: 需要推送的群号列表。
    *   **`excludeRetweets`**: 是否排除转推。默认 `true`。
    *   **`excludeReplies`**: 是否排除回复。默认 `true`。
    *   **`tweetFilterMode`**: 可选全部、仅含媒体或仅纯文字。默认 `all`。
    *   **`maxPostsPerCheck`**: 每轮最多扫描的搜索结果数，可设置 10 至 200，默认 `50`。高流量标签应增大此值或缩短检查间隔。

话题订阅首次启用时只记录当前最新推文，不会补发历史内容。删除话题配置后，对应状态会自动清理。

控制台中的用户订阅和话题标签订阅使用紧凑表格显示。点击“推送群”单元格后可在弹窗中逐个添加、修改或删除群号。旧版本配置无需迁移。

### 7. 调试设置

*   **`logDetails`**: 是否在控制台输出详细分步日志。默认 `false`。

## 命令

以下命令只有启用订阅功能后才可用。

*   `测试推特用户推送 <username:string>`: 测试获取指定用户的最新推文，并发送到当前会话。
*   `测试话题标签推送 <hashtag:string>`: 搜索指定话题的最新推文并发送到当前会话，不修改任何订阅水位。
*   `测试群组推送`: 立即获取所有订阅的最新推文并强制推送。

## Twitter/X auth_token 获取

1.  在浏览器打开 https://x.com 并登录。
2.  按 F12 打开开发者工具。
3.  打开 Application 或 应用 面板。
4.  在 Cookie 中选择 `https://x.com`。
5.  找到 `auth_token`，复制它的值到插件配置中的 `cookie`。

## 注意事项

*   API 模式依赖所选 API 来源的可用性。`vxtwitter` 通常兼容性较好；`fxtwitter` 对长文/Note Tweet 正文通常更完整。
*   浏览器模式依赖 X 前端页面结构，X 页面更新可能导致提取失败。
*   浏览器媒体模式只会发送目标推文 DOM 中确认过的媒体。遇到年龄墙、敏感内容遮挡或登录墙导致目标媒体不可见时，会返回空媒体，避免误发头像、图标或页面资源。
*   浏览器媒体模式对图片较稳，对视频只能尽量提取目标推文页面和网络响应中可确认属于该推文的候选地址。
*   真 GIF 模式需要启用 `koishi-plugin-ffmpeg`，转换会增加 CPU 和发送时间。插件只调用 Koishi 上下文中的 `ffmpeg` 服务。
*   非 `file` 模式下，下载和 GIF 转换产生的临时输入、输出文件会在发送元素生成后删除。`file` 模式需要给适配器读取本地文件的时间，因此会延迟清理。
*   `buffer` 和 `base64` 对大视频不友好，OneBot WebSocket 可能因消息体过大断开。
*   `file` 模式要求 Koishi 与适配器能访问同一份本地文件路径。
*   ChatLuna 是可选依赖。未安装 ChatLuna 时，默认的 Google 翻译和其他插件功能不受影响。
*   话题标签搜索使用 `@the-convocation/twitter-scraper` 访问 X 内部搜索接口。该依赖支持 Node.js 16 及以上，不会提高插件当前的 Node.js 18 兼容门槛，并会随插件自动安装。
*   话题标签搜索必须使用有效的 `auth_token`。插件会先通过 Puppeteer 打开 `x.com`，在内存中取得搜索所需的 `ct0`，不会把完整 Cookie 写入日志或数据库。
*   话题搜索请求复用 Koishi 的 HTTP 服务，因此会继承 Koishi 的代理设置。X 的内部接口和限流规则可能变化，搜索失败只会影响话题订阅，不会影响链接解析和原有用户订阅。
*   如果高流量话题在扫描上限内仍无法追上某个群的水位，插件会停止推进该群并记录警告，避免跳过尚未发送的推文。此时请增大 `maxPostsPerCheck` 或缩短 `updateInterval`。

##  致谢

*   **Koishi**: 提供了一切的基础。
*   **`vxtwitter.com`**: 提供了稳定、好用的推文解析 API。
*   **`fxtwitter.com`**: 提供了对长文/Note Tweet 更完整的推文解析 API。
*   **`@the-convocation/twitter-scraper`**: 提供 Twitter/X 话题搜索能力。
*   **shangxue 的 `bilibili-videolink-analysis` 插件**: 本插件的文件处理方案深受其启发，特此感谢。
*   特别鸣谢：Google Gemini 2.5 Pro。

## 更新日志

*   **v2.1.0**: 新增话题标签订阅。新增 ChatLuna 翻译服务，可从 ChatLuna 当前加载的模型中选择翻译模型；修复 Google 翻译长文本请求；修复订阅推文因 URL 参数变化重复推送，并隔离不同群的发送失败。
*   **v2.0.4**: 新增 API 来源选择，支持 `vxtwitter` 与 `fxtwitter`。`fxtwitter` 对长文/Note Tweet 正文支持更完整，并已兼容其返回结构。
*   **v2.0.3**: 增强浏览器获取模式的正文提取逻辑。当 X 页面未提供标准 tweetText 节点但目标推文 DOM 已加载时，会尝试从目标推文可见文本中提取正文。
*   **v2.0.2**: 修复 v2.0.1 中浏览器媒体安全日志类型不匹配导致的 TypeScript 编译错误。
*   **v2.0.1**: 修复浏览器媒体模式在年龄墙、敏感内容遮挡或登录墙下可能误发头像、图标等页面资源的问题。现在只会发送目标推文 DOM 中确认过的媒体。
*   **v2.0.0**: 新增右侧悬浮侧边栏、推文/媒体获取方式选择、浏览器媒体原图策略、GIF 转换、图片/视频文件发送方式设置、媒体独立发送开关。
*   **v1.1.6**: 新增原图下载功能，支持在解析和推送时分别配置是否下载最高画质原图。
*   **v1.1.5**: 新增静默解析选项，可关闭解析链接时的加载提示。
*   **v1.1.3**: 修复置顶和转推的关键词识别问题。
*   **v1.1.2**: 所有 `h.image()` 和 `h.video()` 的调用不再使用 Base64 字符串，改用 buffer 发送媒体文件。
