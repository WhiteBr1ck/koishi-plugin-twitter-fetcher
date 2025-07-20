import { Context, Schema, h, Logger, Time, Bot } from 'koishi'
import Puppeteer from 'koishi-plugin-puppeteer'

export const name = 'twitter-fetcher'
export const inject = {
  required: ['puppeteer', 'database'],
}

// 在顶级作用域创建 Logger 实例
const logger = new Logger(name)

// 在 Koishi 的 Table 模块中声明 twitter_subscriptions 表的结构
declare module 'koishi' {
  interface Tables {
    twitter_subscriptions: {
      id: string // 用户名作为主键
      last_tweet_url: string // 上次记录的最新推文 URL
    }
  }
}

// 定义所有通用的、无条件的配置项
interface BaseConfig {
  showScreenshot: boolean;
  sendText: boolean;
  sendMedia: boolean;
  cookie: string;
  useForward: boolean;
  sub_showLink: boolean;
  sub_showScreenshot: boolean;
  sub_sendText: boolean;
  sub_sendMedia: boolean;
  sub_useForward: boolean;
  logDetails: boolean;
}

// 定义两种订阅状态：关闭时和开启时，形成“可辨识联合类型”
type SubscriptionConfig = {
  enableSubscription: false;
} | {
  enableSubscription: true;
  platform: string;
  selfId: string;
  updateInterval: number;
  subscriptions: {
    username: string;
    groupIds: string[];
  }[];
};

export type Config = BaseConfig & SubscriptionConfig;


export const Config: Schema<Config> = Schema.intersect([
  // 第 1 块: 解析设置
  Schema.object({
    showScreenshot: Schema.boolean().description('是否发送推文截图。').default(true),
    sendText: Schema.boolean().description('是否发送提取的推文文本。').default(true),
    sendMedia: Schema.boolean().description('是否发送推文中的图片和视频。').default(true),
    cookie: Schema.string().role('textarea').description('Twitter/X 登录 Cookie(auth_token).'),
    useForward: Schema.boolean().description('是否使用合并转发的形式发送(仅 QQ 平台效果最佳).').default(false),
  }).description('解析设置 - 当手动发送链接时生效'),

  // 第 2 块: 订阅推送内容设置
  Schema.object({
    sub_showLink: Schema.boolean().description('推送时, 是否在消息顶部附带原始推文链接。').default(true),
    sub_showScreenshot: Schema.boolean().description('推送时, 是否发送推文截图。').default(true),
    sub_sendText: Schema.boolean().description('推送时, 是否发送提取的推文文本。').default(true),
    sub_sendMedia: Schema.boolean().description('推送时, 是否发送推文中的图片和视频。').default(true),
    sub_useForward: Schema.boolean().description('推送时, 是否使用合并转发。').default(false),
  }).description('订阅推送内容设置 - 当自动推送订阅时生效'),

  // 第 3 块: 订阅总开关及详细设置 (使用你原来的结构，这是正确的！)
  Schema.intersect([
    Schema.object({
      // 这个 enableSubscription 同时作为总开关和 UI 上的一个可见项
      enableSubscription: Schema.boolean().description('**【总开关】是否启用订阅功能。** 开启后会显示详细设置。').default(false),
    }).description('订阅设置'), // 这是分组的标题
    // union 部分负责根据开关状态显示或隐藏其他字段
    Schema.union([
      Schema.object({
        enableSubscription: Schema.const(false), // 关闭时，没有额外字段
      }),
      Schema.object({
        enableSubscription: Schema.const(true), // 开启时，加载所有必填字段
        platform: Schema.string().description('用于执行推送的机器人平台 (例如: onebot)。').required(),
        selfId: Schema.string().description('用于执行推送的机器人账号/ID (例如: 12345678)。').required(),
        updateInterval: Schema.number().min(1).description('每隔多少分钟检查一次更新。').default(5),
        subscriptions: Schema.array(Schema.object({
            username: Schema.string().description('推特用户名'),
            groupIds: Schema.array(String).role('table').description('需要推送的群号列表'),
        })).role('table').description('订阅列表'),
      }),
    ]),
  ]),

  // 第 4 块: 调试设置
  Schema.object({
    logDetails: Schema.boolean().description('是否在控制台输出详细的调试日志。').default(false),
  }).description('调试设置'),
]) as Schema<Config>; // 使用类型断言告诉编译器，我们确信这个结构是符合 Config 类型的


// 正则表达式, 用于从消息中匹配推文链接
const TWEET_URL_REGEX = /https?:\/\/(twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/g

// 使用 Puppeteer 获取指定用户的最新推文链接
async function getLatestTweetUrlByPuppeteer(puppeteer: Puppeteer, username: string, cookie?: string, log?: (message: string) => void): Promise<string | null> {
  log?.(`正在访问用户主页: https://x.com/${username}`);
  const page = await puppeteer.page();
  try {
    if (cookie) await page.setCookie({ name: 'auth_token', value: cookie, domain: '.x.com', path: '/', httpOnly: true, secure: true });
    await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 20000 });
    const latestTweetUrl = await page.evaluate(() => {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      for (const article of articles) {
        if (article.querySelector('[data-testid="socialContext"]')?.textContent.includes('Pinned')) continue;
        const link = article.querySelector('a[href*="/status/"]');
        if (link) return (link as HTMLAnchorElement).href;
      }
      return null;
    });
    if (latestTweetUrl) {
      log?.(`成功获取到最新推文链接: ${latestTweetUrl}`);
      return latestTweetUrl;
    }
    logger.warn(`[Puppeteer] 在 ${username} 的主页上未能找到任何推文链接.`);
    return null;
  } finally {
    await page.close();
  }
}

// 使用 Puppeteer 获取指定推文的截图
async function getTweetScreenshot(puppeteer: Puppeteer, url: string, cookie?: string, log?: (message: string) => void): Promise<Buffer> {
    const page = await puppeteer.page()
    try {
        log?.(`准备截图页面: ${url}`);
        if (cookie) await page.setCookie({ name: 'auth_token', value: cookie, domain: '.x.com', path: '/', httpOnly: true, secure: true });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
        const tweetElement = await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 });
        if (!tweetElement) throw new Error('无法在页面上定位到推文元素.');
        log?.('定位到推文元素, 正在生成截图...');
        return await tweetElement.screenshot();
    } finally {
        await page.close();
    }
}

export function apply(ctx: Context, config: Config) {
  logger.info('Twitter Fetcher 插件已启动.');

  ctx.model.extend('twitter_subscriptions', { id: 'string', last_tweet_url: 'string' }, { primary: 'id' });

  // 日志系统: 步骤化日志记录器
  const createLogStepper = (prefix: string) => {
    let step = 1;
    return (message: string, isWarning = false) => {
      if (config.logDetails) {
        const logMessage = `[${prefix}] [步骤 ${step++}] ${message}`;
        if (isWarning) {
          logger.warn(logMessage);
        } else {
          logger.info(logMessage);
        }
      }
    };
  };

  // 核心功能: 处理单个推文链接
  async function processTweet(tweetUrl: string, options: { showLink?: boolean; showScreenshot: boolean; sendText: boolean; sendMedia: boolean; useForward: boolean; platform?: string }) {
    const log = createLogStepper(tweetUrl);
    log(`开始处理推文`);

    const textParts: string[] = [];
    const mediaParts: h[] = [];

    if (options.showLink) {
      log('配置了推送时附带链接, 在消息头部加入推文URL.');
      textParts.push(tweetUrl);
    }

    let screenshotElement: h | null = null;
    if (options.showScreenshot) {
      log('开始获取推文截图.');
      try {
        const screenshotBuffer = await getTweetScreenshot(ctx.puppeteer, tweetUrl, config.cookie, log);
        if (screenshotBuffer) {
            screenshotElement = h.image(`data:image/png;base64,${screenshotBuffer.toString('base64')}`);
            log('截图成功并转换为 h.image 元素.');
        }
      } catch (error) {
        log(`截图失败: ${error.message}`, true);
      }
    }

    try {
      const apiUrl = tweetUrl.replace(/(twitter\.com|x\.com)/, 'api.vxtwitter.com');
      log(`使用 vxtwitter API 进行解析: ${apiUrl}`);
      const http = ctx.http.extend({ headers: { 'User-Agent': 'Koishi-Twitter-Fetcher' }});
      const apiResponse = await http.get(apiUrl);
      log('成功接收到 vxtwitter API 的响应.');

      if (apiResponse.user_screen_name) textParts.push(`用户ID: ${apiResponse.user_screen_name}`);
      if (apiResponse.text && options.sendText) textParts.push(`推文内容: ${apiResponse.text}`);
      
      if (screenshotElement) mediaParts.push(screenshotElement);

      if (options.sendMedia && apiResponse.media_extended) {
        log(`发现 ${apiResponse.media_extended.length} 个媒体文件, 准备下载.`);
        for (const [index, media] of apiResponse.media_extended.entries()) {
          try {
            const file = await http.file(media.url);
            const dataUri = `data:${file.mime};base64,${Buffer.from(file.data).toString('base64')}`;
            if (media.type === 'image') mediaParts.push(h.image(dataUri));
            else if (media.type === 'video') mediaParts.push(h.video(dataUri));
            log(`媒体文件 ${index + 1}/${apiResponse.media_extended.length} (${media.type}) 下载并转换成功.`);
          } catch (error) {
            log(`下载媒体文件失败: ${media.url}, 错误: ${error.message}`, true);
          }
        }
      }

      const hasText = textParts.length > 0;
      const hasMedia = mediaParts.length > 0;
      if (!hasText && !hasMedia) {
        log('处理完成, 但未能获取到任何文本或媒体内容.', true);
        return '未能获取到任何内容.';
      }

      log('内容组装完毕, 准备发送.');
      if (options.useForward && options.platform === 'onebot') {
        const forwardElements: (h | string)[] = [textParts.join('\n'), ...mediaParts].filter(Boolean);
        return h('figure', {}, forwardElements);
      } else {
        const finalParts: (string | h)[] = [textParts.join('\n'), ...mediaParts].filter(Boolean);
        return finalParts.join('\n\n');
      }
    } catch (error) {
      logger.warn(`[!] API 处理失败:`, error);
      return `获取推文内容失败: ${error.message}`;
    }
  }

  // 中间件: 监听消息中的推文链接
  ctx.middleware(async (session, next) => {
    TWEET_URL_REGEX.lastIndex = 0;
    const match = TWEET_URL_REGEX.exec(session.content)
    if (!match) return next()
    
    const statusMessage = await session.send(h('quote', { id: session.messageId }) + '正在解析推文链接, 请稍候...')
    
    const messageToSend = await processTweet(match[0], {
      showLink: false,
      showScreenshot: config.showScreenshot,
      sendText: config.sendText,
      sendMedia: config.sendMedia,
      useForward: config.useForward,
      platform: session.platform,
    })
    
    await session.send(messageToSend);
    await session.bot.deleteMessage(session.channelId, statusMessage[0]);
  })
  
  // 订阅功能核心: 检查并推送更新
  async function checkAndPushUpdates(isManualTrigger = false) {
    // 关键修正 3: 添加类型守卫, 确保在订阅关闭时函数直接退出
    if (!config.enableSubscription) return;

    if (config.logDetails) logger.info('[订阅] 开始新一轮更新检查...');
    const botKey = `${config.platform}:${config.selfId}`;
    const bot = ctx.bots[botKey];

    if (!bot || !bot.online) {
      logger.warn(`[订阅] 配置中指定的机器人 [${botKey}] 不存在或不在线, 跳过本轮检查.`);
      return isManualTrigger ? `配置中指定的机器人 [${botKey}] 不存在或不在线.` : undefined;
    }
    
    let updatesFound = 0;
    for (const sub of config.subscriptions) {
      if (!sub.username || !sub.groupIds || sub.groupIds.length === 0) continue;
      
      const log = createLogStepper(`订阅:${sub.username}`);
      log('开始处理此用户的订阅.');

      try {
        const latestTweetUrl = await getLatestTweetUrlByPuppeteer(ctx.puppeteer, sub.username, config.cookie, log);
        if (!latestTweetUrl) {
            log('未能获取到最新推文链接, 跳过.', true);
            continue;
        }

        const record = await ctx.database.get('twitter_subscriptions', { id: sub.username });
        const lastUrl = record[0]?.last_tweet_url;
        log(`数据库中记录的上次链接: ${lastUrl || '无'}`);

        const isNew = !lastUrl || lastUrl !== latestTweetUrl;
        const shouldPush = isNew || (isManualTrigger && latestTweetUrl);

        if (shouldPush) {
          updatesFound++;
          logger.info(`[订阅] ★★★ 发现 [${sub.username}] 的新推文! ★★★`);
          log(`准备推送新内容: ${latestTweetUrl}`);

          const messageToSend = await processTweet(latestTweetUrl, {
            showLink: config.sub_showLink,
            showScreenshot: config.sub_showScreenshot,
            sendText: config.sub_sendText,
            sendMedia: config.sub_sendMedia,
            useForward: config.sub_useForward,
            platform: bot.platform,
          });
          
          for (const groupId of sub.groupIds) {
            await bot.sendMessage(groupId, messageToSend);
          }
          log(`已向 ${sub.groupIds.length} 个群组完成推送.`);
          
          if (isNew) {
              await ctx.database.upsert('twitter_subscriptions', [{ id: sub.username, last_tweet_url: latestTweetUrl }]);
              log('数据库已更新为最新推文链接.');
          }
        } else {
            log('链接无变化, 无需推送.');
        }
      } catch (error) {
        logger.warn(`[订阅] 检查 [${sub.username}] 时发生错误:`, error);
      }
    }
    if (config.logDetails) logger.info(`[订阅] 本轮更新检查结束, 共发现 ${updatesFound} 个更新.`);
    if (isManualTrigger) {
      return `手动检查完成, 共为 ${updatesFound} 个订阅执行了推送任务.`;
    }
  }

  // 如果启用了订阅, 则设置定时器和指令
  if (config.enableSubscription) {
    ctx.setInterval(() => checkAndPushUpdates(false), config.updateInterval * Time.minute);

    ctx.command('测试推特用户推送 <username:string>', '测试指定用户的最新推文能否被正确获取和推送')
      .action(async ({ session }, username) => {
        if (!username) return '请输入要测试的用户名.';
        await session.send(`正在为 [${username}] 获取最新推文并模拟推送到当前会话...`);
        const log = createLogStepper(`测试:${username}`);
        try {
          const latestTweetUrl = await getLatestTweetUrlByPuppeteer(ctx.puppeteer, username, config.cookie, log);
          if (!latestTweetUrl) return '无法找到该用户的最新推文链接.';
          
          await session.send(`成功获取到最新推文链接: ${latestTweetUrl}\n正在生成内容...`);

          const messageToSend = await processTweet(latestTweetUrl, {
            showLink: config.sub_showLink,
            showScreenshot: config.sub_showScreenshot,
            sendText: config.sub_sendText,
            sendMedia: config.sub_sendMedia,
            useForward: config.sub_useForward,
            platform: session.platform,
          });
          await session.send(messageToSend);
        } catch (error) {
          logger.warn(`[测试] 测试 [${username}] 时出错:`, error);
          return `测试失败: ${error.message}`;
        }
      });

    ctx.command('测试群组推送', '立即获取所有订阅的最新推文并强制推送, 用于测试')
      .action(async ({ session }) => {
        session.send('正在手动触发所有订阅的强制推送任务...');
        const result = await checkAndPushUpdates(true);
        return result;
      });
  }
}