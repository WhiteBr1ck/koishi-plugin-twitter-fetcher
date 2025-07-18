import { Context, Schema, h, Logger } from 'koishi'
import Puppeteer from 'koishi-plugin-puppeteer'

export const name = 'twitter-fetcher'
export const inject = ['puppeteer']

const logger = new Logger(name)

export interface Config {
  showScreenshot: boolean
  sendText: boolean
  sendMedia: boolean
  cookie: string
  useForward: boolean
  logDetails: boolean
}

export const Config: Schema<Config> = Schema.object({
  showScreenshot: Schema.boolean().description('是否发送推文截图。').default(true),
  sendText: Schema.boolean().description('是否发送提取的推文文本。').default(true),
  sendMedia: Schema.boolean().description('是否发送推文中的图片和视频。').default(true),
  cookie: Schema.string().role('textarea').description('可选的 Twitter/X 登录 Cookie'),
  useForward: Schema.boolean().description('是否使用合并转发的形式发送（仅 QQ 平台效果最佳）。').default(true),
  logDetails: Schema.boolean().description('是否在控制台输出详细的调试日志。').default(false),
})

const TWEET_URL_REGEX = /https?:\/\/(twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/g

export function apply(ctx: Context, config: Config) {
  logger.info('Twitter Fetcher 插件已启动。');

  ctx.middleware(async (session, next) => {
    TWEET_URL_REGEX.lastIndex = 0;
    const match = TWEET_URL_REGEX.exec(session.content)
    if (!match) return next()

    const originalUrl = match[0]
    if (config.logDetails) logger.info(`[1/5] 检测到推文链接: ${originalUrl}`)
    
    const quote = h('quote', { id: session.messageId })
    const statusMessage = await session.send(`${quote}正在解析推文链接，请稍候...`)

    try {
      const textParts: string[] = [];
      const mediaParts: h[] = [];

      // 数据获取逻辑
      let screenshotElement: h | null = null;
      if (config.showScreenshot) {
        try {
          const screenshotBuffer = await getTweetScreenshot(ctx.puppeteer, originalUrl, config.cookie);
          if (!screenshotBuffer) throw new Error('截图结果为空');
          const dataUri = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;
          screenshotElement = h.image(dataUri);
        } catch (error) {
          if (config.logDetails) logger.warn(`[!] 截图失败: ${error.message}`);
        }
      }
      
      try {
        const apiUrl = originalUrl.replace(/(twitter\.com|x\.com)/, 'api.vxtwitter.com');
        const apiResponse = await ctx.http.get(apiUrl);
        if (config.logDetails) logger.info(`[2/5] 收到 vxtwitter API 响应...`);

        if (apiResponse.user_screen_name) textParts.push(`用户ID：${apiResponse.user_screen_name}`);
        if (apiResponse.text && config.sendText) textParts.push(`推文内容：${apiResponse.text}`);
        if (config.logDetails) logger.info(`[3/5] 文本部分构造完毕。`);

        if (screenshotElement) mediaParts.push(screenshotElement);
        if (config.sendMedia && apiResponse.media_extended) {
          for (const media of apiResponse.media_extended) {
            try {
              const file = await ctx.http.file(media.url);
              const buffer = Buffer.from(file.data);
              const mimeType = file.mime || (media.type === 'video' ? 'video/mp4' : 'image/jpeg');
              const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`;
              if (media.type === 'image') mediaParts.push(h.image(dataUri));
              else if (media.type === 'video') mediaParts.push(h.video(dataUri));
            } catch (error) {
              if (config.logDetails) logger.warn(`下载媒体文件失败: ${media.url}`, error);
            }
          }
        }
      } catch (error) {
        logger.warn(`[!] 通过 API 获取内容失败:`, error);
      }
      
      // --- 发送逻辑 ---
      const hasText = textParts.length > 0;
      const hasMedia = mediaParts.length > 0;

      if (!hasText && !hasMedia) {
        await session.send('未能获取到该推文的任何内容。');
      } else {
        if (config.useForward && session.platform === 'onebot') {
          // --- 构造一个包含所有内容的数组 ---
          const forwardElements: (h | string)[] = [];
          if (hasText) forwardElements.push(textParts.join('\n'));
          if (hasMedia) forwardElements.push(...mediaParts);
          
          if (config.logDetails) logger.info(`[4/5] 正在构造合并转发消息...`);
          // --- 用 <figure> 标签包裹所有内容 ---
          await session.send(h('figure', {}, forwardElements));
          if (config.logDetails) logger.info(`[5/5] 合并转发消息已发送。`);

        } else {
          // 退回到原始的拼接发送方式
          const finalParts: (string | h)[] = [];
          if (hasText) finalParts.push(textParts.join('\n'));
          if (hasMedia) finalParts.push(...mediaParts);

          const messageToSend = finalParts.join('\n\n');
          if (config.logDetails) logger.info(`[4/5] 最终拼接的待发消息字符串:\n---\n${messageToSend}\n---`);
          await session.send(messageToSend);
          if (config.logDetails) logger.info(`[5/5] 消息已发送。`);
        }
      }

    } catch (error) {
      logger.error('处理推文链接时发生未知错误:', error);
    } finally {
      await session.bot.deleteMessage(session.channelId, statusMessage[0]);
    }
  })
}

// getTweetScreenshot 函数保持不变
async function getTweetScreenshot(puppeteer: Puppeteer, url: string, cookie?: string): Promise<Buffer> {
    const page = await puppeteer.page()
    try {
        if (cookie) {
            const cookieObj = { name: 'auth_token', value: cookie, domain: '.twitter.com', path: '/', httpOnly: true, secure: true };
            const xCookie = { ...cookieObj, domain: '.x.com' };
            await page.setCookie(cookieObj, xCookie);
        }
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
        const tweetSelector = 'article[data-testid="tweet"]';
        await page.waitForSelector(tweetSelector, { timeout: 15000 });
        const tweetElement = await page.$(tweetSelector);
        if (!tweetElement) throw new Error('无法在页面上定位到推文元素。');
        return await tweetElement.screenshot();
    } finally {
        await page.close();
    }
}