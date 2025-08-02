import { Context, Schema, h, Logger, Time, Bot, sleep } from 'koishi'
import Puppeteer from 'koishi-plugin-puppeteer'

export const name = 'twitter-fetcher'
export const inject = {
  required: ['puppeteer', 'database'],
}

const logger = new Logger(name)

declare module 'koishi' {
  interface Tables {
    twitter_subscriptions: {
      id: string
      last_tweet_url: string
    }
  }
}

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
  parse_enableTranslation: boolean;
  parse_targetLang: string;
  sub_enableTranslation: boolean;
  sub_targetLang: string;
  logDetails: boolean;
}

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
    excludeRetweets?: boolean;
  }[];
};

export type Config = BaseConfig & SubscriptionConfig;

const langSelectSchema = Schema.union([
  Schema.const('zh-CN').description('简体中文'),
  Schema.const('zh-TW').description('繁體中文'),
  Schema.const('en').description('English'),
  Schema.const('ja').description('日本語'),
  Schema.const('ko').description('한국어'),
  Schema.const('ru').description('Русский'),
  Schema.const('fr').description('Français'),
  Schema.const('de').description('Deutsch'),
]).description('翻译的目标语言。');


export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    showScreenshot: Schema.boolean().description('是否发送推文截图。').default(true),
    sendText: Schema.boolean().description('是否发送提取的推文文本。').default(true),
    sendMedia: Schema.boolean().description('是否发送推文中的图片和视频。').default(true),
    cookie: Schema.string().role('textarea').description('Twitter/X 登录 Cookie(auth_token).'),
    useForward: Schema.boolean().description('是否使用合并转发的形式发送(仅 QQ 平台效果最佳).').default(false),
  }).description('解析设置 - 当手动发送链接时生效'),

  Schema.object({
    sub_showLink: Schema.boolean().description('推送时, 是否在消息顶部附带原始推文链接。').default(true),
    sub_showScreenshot: Schema.boolean().description('推送时, 是否发送推文截图。').default(true),
    sub_sendText: Schema.boolean().description('推送时, 是否发送提取的推文文本。').default(true),
    sub_sendMedia: Schema.boolean().description('推送时, 是否发送推文中的图片和视频。').default(true),
    sub_useForward: Schema.boolean().description('推送时, 是否使用合并转发。').default(false),
  }).description('订阅推送内容设置 - 当自动推送订阅时生效'),

  Schema.object({
    parse_enableTranslation: Schema.boolean().description('**【手动解析】** 是否开启翻译。当手动发送链接时生效。').default(false),
    parse_targetLang: langSelectSchema.default('zh-CN'),
    sub_enableTranslation: Schema.boolean().description('**【订阅推送】** 是否开启翻译。当自动推送订阅时生效。').default(false),
    sub_targetLang: langSelectSchema.default('zh-CN'),
  }).description('翻译设置'),
  
  Schema.object({
    enableSubscription: Schema.boolean().description('**【总开关】是否启用订阅功能。** 开启后会显示详细设置。').default(false),
  }).description('订阅设置'),

  Schema.union([
    Schema.object({
      enableSubscription: Schema.const(false),
    }),
    Schema.object({
      enableSubscription: Schema.const(true),
      platform: Schema.string().description('用于执行推送的机器人平台 (例如: onebot)。').required(),
      selfId: Schema.string().description('用于执行推送的机器人账号/ID (例如: 12345678)。').required(),
      updateInterval: Schema.number().min(1).description('每隔多少分钟检查一次更新。').default(30),
      subscriptions: Schema.array(Schema.object({
          username: Schema.string().description('推特用户名'),
          groupIds: Schema.array(String).role('table').description('需要推送的群号列表'),
          excludeRetweets: Schema.boolean().description('是否排除转推(Repost)？').default(true),
      })).role('table').description('订阅列表'),
    }),
  ]),

  Schema.object({
    logDetails: Schema.boolean().description('是否在控制台输出详细的调试日志。').default(false),
  }).description('调试设置'),
]) as Schema<Config>;



const TWEET_URL_REGEX = /https?:\/\/(twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/g

async function translateText(ctx: Context, text: string, targetLang: string, log?: (message: string) => void): Promise<string | null> {
  if (!text) return null;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
  try {
    log?.(`调用谷歌翻译 API...`);
    const response = await ctx.http.get<any[]>(url);
    if (response && response[0]) {
      const translatedText = response[0].map(item => item[0]).join('');
      log?.(`翻译成功, 目标语言: ${targetLang}.`);
      return translatedText;
    }
    return null;
  } catch (error) {
    logger.warn(`[翻译] 调用谷歌翻译 API 失败:`, error);
    return null;
  }
}

async function getLatestTweetUrlByPuppeteer(puppeteer: Puppeteer, username: string, cookie: string | undefined, excludeRetweets: boolean, log?: (message: string) => void): Promise<string | null> {
  log?.(`正在访问用户主页: https://x.com/${username}`);
  const page = await puppeteer.page();
  try {
    if (cookie) await page.setCookie({ name: 'auth_token', value: cookie, domain: '.x.com', path: '/', httpOnly: true, secure: true });
    await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 20000 });
    
    const latestTweetUrl = await page.evaluate((excludeRetweets) => {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      for (const article of articles) {
        const socialContextEl = article.querySelector('[data-testid="socialContext"]');
        if (socialContextEl) {
          const contextText = socialContextEl.textContent || '';
          if (contextText.includes('Pinned')) continue;
          if (excludeRetweets && (contextText.includes('Retweeted') || contextText.includes('reposted') || contextText.includes('转推'))) {
            continue;
          }
        }
        const link = article.querySelector('a[href*="/status/"]');
        if (link) return (link as HTMLAnchorElement).href;
      }
      return null;
    }, excludeRetweets);

    if (latestTweetUrl) {
      log?.(`成功获取到最新推文链接(已应用转推排除规则): ${latestTweetUrl}`);
      return latestTweetUrl;
    }
    logger.warn(`[Puppeteer] 在 ${username} 的主页上未能找到任何符合条件的推文链接.`);
    return null;
  } finally {
    await page.close();
  }
}

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

  const createLogStepper = (prefix: string) => {
    let step = 1;
    return (message: string, isWarning = false) => {
      if (config.logDetails) {
        const logMessage = `[${prefix}] [步骤 ${step++}] ${message}`;
        if (isWarning) logger.warn(logMessage);
        else logger.info(logMessage);
      }
    };
  };


  async function processTweet(
    tweetUrl: string, 
    options: { 
      showLink?: boolean; 
      showScreenshot: boolean; 
      sendText: boolean; 
      sendMedia: boolean; 
      useForward: boolean; 
      platform?: string;
      enableTranslation?: boolean;
      targetLang?: string;
    }
  ) {
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

            screenshotElement = h.image(screenshotBuffer, 'image/png');
            log('截图成功并准备好 h.image 元素 (Buffer 模式).');
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
      
      let originalTweetText = '';
      if (apiResponse.text) {
        originalTweetText = apiResponse.text;
      }

      if (options.sendText && originalTweetText) {
        textParts.push(`推文内容: ${originalTweetText}`);

        if (options.enableTranslation && options.targetLang) {
          log('检测到翻译已开启.');
          const translatedText = await translateText(ctx, originalTweetText, options.targetLang, log);
          if (translatedText) {
            textParts.push(`\n【谷歌翻译 (${options.targetLang})】:\n${translatedText}`);
          } else {
            log('翻译失败或返回空内容.', true);
          }
        }
      }
      
      if (screenshotElement) mediaParts.push(screenshotElement);

      if (options.sendMedia && apiResponse.media_extended) {
        log(`发现 ${apiResponse.media_extended.length} 个媒体文件, 准备下载.`);
        for (const [index, media] of apiResponse.media_extended.entries()) {
          try {
            log(`正在下载媒体文件 ${index + 1}/${apiResponse.media_extended.length} (${media.type}) from ${media.url}`);
            const file = await http.file(media.url);
            
            if (media.type === 'image') {
              mediaParts.push(h.image(file.data, file.mime));
            } else if (media.type === 'video' || media.type === 'gif') {
              mediaParts.push(h.video(file.data, file.mime));
            }
            log(`媒体文件 ${index + 1}/${apiResponse.media_extended.length} 下载成功 (Buffer 模式).`);
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
      enableTranslation: config.parse_enableTranslation,
      targetLang: config.parse_targetLang,
    })
    
    await session.send(messageToSend);
    await session.bot.deleteMessage(session.channelId, statusMessage[0]);
  })
  
  async function checkAndPushUpdates(isManualTrigger = false) {
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
        const excludeRetweets = sub.excludeRetweets ?? true;
        log(`转推排除设置为: ${excludeRetweets}`);
        const latestTweetUrl = await getLatestTweetUrlByPuppeteer(ctx.puppeteer, sub.username, config.cookie, excludeRetweets, log);
        
        if (!latestTweetUrl) {
            log('未能获取到最新推文链接, 跳过.', true);

        } else {
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
                enableTranslation: config.sub_enableTranslation,
                targetLang: config.sub_targetLang,
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
        }
      } catch (error) {
        logger.warn(`[订阅] 检查 [${sub.username}] 时发生错误:`, error);
      }


      if (config.logDetails) logger.info(`[订阅] 处理完 [${sub.username}], 等待 3 秒后继续...`);
      await sleep(3 * Time.second);
    }
    
    if (config.logDetails) logger.info(`[订阅] 本轮更新检查结束, 共发现 ${updatesFound} 个更新.`);
    if (isManualTrigger) {
      return `手动检查完成, 共为 ${updatesFound} 个订阅执行了推送任务.`;
    }
  }

  if (config.enableSubscription) {
    ctx.setInterval(() => checkAndPushUpdates(false), config.updateInterval * Time.minute);

    ctx.command('测试推特用户推送 <username:string>', '测试指定用户的最新推文能否被正确获取和推送')
      .action(async ({ session }, username) => {
        if (!username) return '请输入要测试的用户名.';
        await session.send(`正在为 [${username}] 获取最新推文并模拟推送到当前会话...`);
        const log = createLogStepper(`测试:${username}`);
        try {
          const latestTweetUrl = await getLatestTweetUrlByPuppeteer(ctx.puppeteer, username, config.cookie, true, log);
          if (!latestTweetUrl) return '无法找到该用户的最新推文链接(已排除转推).';
          
          await session.send(`成功获取到最新推文链接: ${latestTweetUrl}\n正在生成内容...`);
          
          const messageToSend = await processTweet(latestTweetUrl, {
            showLink: config.sub_showLink,
            showScreenshot: config.sub_showScreenshot,
            sendText: config.sub_sendText,
            sendMedia: config.sub_sendMedia,
            useForward: config.sub_useForward,
            platform: session.platform,
            enableTranslation: config.sub_enableTranslation,
            targetLang: config.sub_targetLang,
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