import { Context, Schema, h, Logger, Time, sleep } from 'koishi'
import Puppeteer from 'koishi-plugin-puppeteer'
import { promises as fs } from 'fs'
import { resolve, join, extname } from 'path'
import { randomUUID } from 'crypto'
import type {} from '@koishijs/plugin-console'

export const name = 'twitter-fetcher'
export const inject = {
  required: ['puppeteer', 'database'],
  optional: ['console', 'ffmpeg'],
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
  showScreenshot: boolean
  sendText: boolean
  sendMedia: boolean
  downloadOriginalImage: boolean
  cookie: string
  useForward: boolean
  silentParsing: boolean
  separateMediaSend: boolean
  tweetFetchMode: FetchMode
  mediaFetchMode: FetchMode
  gifMode: GifMode
  tempPath: string
  imageTransferMode: FileTransferMode
  videoTransferMode: FileTransferMode
  sub_showLink: boolean
  sub_showScreenshot: boolean
  sub_sendText: boolean
  sub_sendMedia: boolean
  sub_downloadOriginalImage: boolean
  sub_useForward: boolean
  parse_enableTranslation: boolean
  parse_targetLang: string
  sub_enableTranslation: boolean
  sub_targetLang: string
  logDetails: boolean
}

type FetchMode = 'api' | 'browser'
type FileTransferMode = 'buffer' | 'url' | 'base64' | 'file'
type GifMode = 'video' | 'realGif'
type TweetFilterMode = 'all' | 'mediaOnly' | 'textOnly'
type MediaType = 'image' | 'video' | 'gif'

type FFmpegService = {
  builder(): {
    input(path: string | Buffer): any
    outputOption(...option: string[]): any
    run(type: 'file', path: string): Promise<void>
  }
}

type TweetMedia = {
  url: string
  type: MediaType
  mime?: string
}

type TweetData = {
  userScreenName?: string
  author?: string
  text?: string
  media: TweetMedia[]
}

type ProcessedTweet = {
  main?: string | h
  media: h[]
}

type SubscriptionConfig = {
  enableSubscription: false
} | {
  enableSubscription: true
  platform: string
  selfId: string
  updateInterval: number
  subscriptions: {
    username: string
    groupIds: string[]
    excludeRetweets?: boolean
    tweetFilterMode?: TweetFilterMode
  }[]
}

export type Config = BaseConfig & SubscriptionConfig

const fetchModeSchema = Schema.union([
  Schema.const('api').description('API'),
  Schema.const('browser').description('浏览器'),
]).role('radio')

const fileTransferSchema = Schema.union([
  Schema.const('buffer').description('buffer'),
  Schema.const('url').description('url'),
  Schema.const('base64').description('base64'),
  Schema.const('file').description('file'),
]).role('radio')

const langSelectSchema = Schema.union([
  Schema.const('zh-CN').description('简体中文'),
  Schema.const('zh-TW').description('繁體中文'),
  Schema.const('en').description('English'),
  Schema.const('ja').description('日本語'),
  Schema.const('ko').description('한국어'),
  Schema.const('ru').description('Русский'),
  Schema.const('fr').description('Français'),
  Schema.const('de').description('Deutsch'),
]).description('翻译的目标语言。')

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    showScreenshot: Schema.boolean().description('是否发送推文截图。').default(true),
    sendText: Schema.boolean().description('是否发送提取的推文文本。').default(true),
    sendMedia: Schema.boolean().description('是否发送推文中的图片和视频。').default(true),
    downloadOriginalImage: Schema.boolean().description('是否下载原图（最高画质）。API 与浏览器媒体获取都会尽量使用 Twitter 原图参数。').default(false),
    cookie: Schema.string().role('textarea').description('Twitter/X 登录 Cookie(auth_token).'),
    useForward: Schema.boolean().description('是否使用合并转发的形式发送(仅 QQ 平台效果最佳).').default(false),
    silentParsing: Schema.boolean().description('是否关闭解析时的加载提示。').default(false),
  }).description('解析设置 - 当手动发送链接时生效'),

  Schema.object({
    sub_showLink: Schema.boolean().description('推送时, 是否在消息顶部附带原始推文链接。').default(true),
    sub_showScreenshot: Schema.boolean().description('推送时, 是否发送推文截图。').default(true),
    sub_sendText: Schema.boolean().description('推送时, 是否发送提取的推文文本。').default(true),
    sub_sendMedia: Schema.boolean().description('推送时, 是否发送推文中的图片和视频。').default(true),
    sub_downloadOriginalImage: Schema.boolean().description('推送时, 是否下载原图（最高画质）。').default(false),
    sub_useForward: Schema.boolean().description('推送时, 是否使用合并转发。').default(false),
  }).description('订阅推送内容设置 - 当自动推送订阅时生效'),

  Schema.object({
    parse_enableTranslation: Schema.boolean().description('**【手动解析】** 是否开启翻译。当手动发送链接时生效。').default(false),
    parse_targetLang: langSelectSchema.default('zh-CN'),
    sub_enableTranslation: Schema.boolean().description('**【订阅推送】** 是否开启翻译。当自动推送订阅时生效。').default(false),
    sub_targetLang: langSelectSchema.default('zh-CN'),
  }).description('翻译设置'),

  Schema.object({
    tweetFetchMode: fetchModeSchema.description('推文文本获取方式。API 使用 vxtwitter；浏览器读取 X 页面上可见文本。').default('api'),
    mediaFetchMode: fetchModeSchema.description('媒体获取方式。API 使用 vxtwitter；浏览器从 X 页面与网络响应中提取媒体资源。').default('api'),
  }).description('获取方式设置'),

  Schema.object({
    separateMediaSend: Schema.boolean().description('是否将推文媒体独立发送。开启后文本和截图先发送，图片、GIF 和视频会作为后续消息发送。').default(false),
    imageTransferMode: fileTransferSchema.description('图片传递方式。buffer 由 Koishi 下载后发送；url 直接发送远程地址；base64 内联发送；file 下载为本地文件后发送。').default('buffer'),
    videoTransferMode: fileTransferSchema.description('视频传递方式。buffer 由 Koishi 下载后发送；url 直接发送远程地址；base64 内联发送；file 下载为本地文件后发送。').default('buffer'),
    gifMode: Schema.union([
      Schema.const('video').description('作为视频发送'),
      Schema.const('realGif').description('转为真 GIF'),
    ]).role('radio').description('Twitter 动图处理方式。realGif 需要启用 koishi-plugin-ffmpeg 服务，体积和耗时都会增加。').default('video'),
    tempPath: Schema.string().description('临时文件目录。相对于 Koishi 工作目录。file 模式和 realGif 转换会使用此目录。').default('data/temp/twitter-fetcher'),
  }).description('文件发送设置'),

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
        tweetFilterMode: Schema.union([
          Schema.const('all').description('全部'),
          Schema.const('mediaOnly').description('仅含媒体'),
          Schema.const('textOnly').description('仅纯文字'),
        ]).role('radio').description('最新推文筛选模式').default('all'),
      })).role('table').description('订阅列表'),
    }),
  ]),

  Schema.object({
    logDetails: Schema.boolean().description('是否在控制台输出详细的调试日志。').default(false),
  }).description('调试设置'),
]) as Schema<Config>

const TWEET_URL_REGEX = /https?:\/\/(twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/g

function extractTweetId(tweetUrl: string) {
  return tweetUrl.match(/\/status\/(\d+)/)?.[1]
}

function normalizeTwitterImageUrl(url: string, useOriginal: boolean) {
  if (!useOriginal) return url
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.endsWith('pbs.twimg.com')) return url
    if (!parsed.pathname.includes('/media/')) return url
    parsed.searchParams.set('name', 'orig')
    return parsed.toString()
  } catch {
    return url
  }
}

function inferMediaType(url: string, fallback: MediaType = 'image'): MediaType {
  const lower = url.toLowerCase()
  if (lower.includes('tweet_video') || lower.includes('animated_gif')) return 'gif'
  if (lower.includes('video.twimg.com') || lower.includes('.mp4') || lower.includes('.m3u8')) return 'video'
  if (lower.includes('.gif')) return 'gif'
  return fallback
}

function getMediaKey(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.endsWith('pbs.twimg.com') && parsed.pathname.includes('/media/')) {
      const path = parsed.pathname.replace(/\.(jpg|jpeg|png|webp|gif)$/i, '')
      return (parsed.origin + path).toLowerCase()
    }
    if (parsed.hostname.endsWith('video.twimg.com')) return (parsed.origin + parsed.pathname).toLowerCase()
    return (parsed.origin + parsed.pathname + parsed.search).toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

function sanitizeMediaUrl(url: string) {
  return url.trim()
    .replace(/&amp;/g, '&')
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/')
    .replace(/[),.;\]]+$/g, '')
}

function hasPotentialMediaGate(text: string) {
  return /(age-restricted|adult content|sensitive content|potentially sensitive|sign in to confirm|年龄|成人内容|敏感内容|可能包含敏感)/i.test(text)
}

function mimeToExtension(mime = '') {
  if (mime.includes('png')) return '.png'
  if (mime.includes('webp')) return '.webp'
  if (mime.includes('gif')) return '.gif'
  if (mime.includes('mp4')) return '.mp4'
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg'
  return ''
}

function toBuffer(data: any) {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  if (typeof data === 'string') return Buffer.from(data)
  return Buffer.from([])
}

function fileUrl(path: string) {
  return `file:///${path.replace(/\\/g, '/')}`
}

async function ensureDir(path: string) {
  await fs.mkdir(path, { recursive: true })
}

async function translateText(ctx: Context, text: string, targetLang: string, log?: (message: string) => void): Promise<string | null> {
  if (!text) return null
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`
  try {
    log?.(`调用谷歌翻译 API...`)
    const response = await ctx.http.get<any[]>(url)
    if (response && response[0]) {
      const translatedText = response[0].map(item => item[0]).join('')
      log?.(`翻译成功, 目标语言: ${targetLang}.`)
      return translatedText
    }
    return null
  } catch (error) {
    logger.warn(`[翻译] 调用谷歌翻译 API 失败:`, error)
    return null
  }
}

async function getLatestTweetUrlByPuppeteer(
  puppeteer: Puppeteer,
  username: string,
  cookie: string | undefined,
  excludeRetweets: boolean,
  filterMode: TweetFilterMode,
  log?: (message: string) => void
): Promise<string | null> {
  log?.(`正在访问用户主页: https://x.com/${username}`)
  const page = await puppeteer.page()
  try {
    if (cookie) await page.setCookie({ name: 'auth_token', value: cookie, domain: '.x.com', path: '/', httpOnly: true, secure: true })
    await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2', timeout: 30000 })
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 20000 })

    const latestTweetUrl = await page.evaluate((excludeRetweets, filterMode) => {
      const articles = document.querySelectorAll('article[data-testid="tweet"]')
      for (const article of articles) {
        const socialContextEl = article.querySelector('[data-testid="socialContext"]')
        if (socialContextEl) {
          const contextText = socialContextEl.textContent || ''
          if (/(pinned|已置顶|置顶|固定|置頂)/i.test(contextText)) continue
          if (excludeRetweets && /(retweeted|reposted|retweet|repost|转推|轉推|转发|已转帖)/i.test(contextText)) continue
        }
        if (filterMode !== 'all') {
          const hasImage = !!article.querySelector('[data-testid="tweetPhoto"], img[alt="Image"]')
          const hasVideo = !!article.querySelector('video, [data-testid="videoPlayer"]')
          const hasGif = !!article.querySelector('[data-testid="gifPlayable"]')
          const hasMedia = hasImage || hasVideo || hasGif
          if (filterMode === 'mediaOnly' && !hasMedia) continue
          if (filterMode === 'textOnly' && hasMedia) continue
        }
        const link = article.querySelector('a[href*="/status/"]')
        if (link) return (link as HTMLAnchorElement).href
      }
      return null
    }, excludeRetweets, filterMode)

    if (latestTweetUrl) {
      log?.(`成功获取到最新推文链接(筛选模式: ${filterMode}, 排除转推: ${excludeRetweets}).`)
      return latestTweetUrl
    }
    logger.warn(`[Puppeteer] 在 ${username} 的主页上未能找到任何符合条件的推文链接.`)
    return null
  } finally {
    await page.close()
  }
}

async function getTweetScreenshot(puppeteer: Puppeteer, url: string, cookie?: string, log?: (message: string) => void): Promise<Buffer> {
  const page = await puppeteer.page()
  try {
    log?.(`准备截图页面: ${url}`)
    if (cookie) await page.setCookie({ name: 'auth_token', value: cookie, domain: '.x.com', path: '/', httpOnly: true, secure: true })
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 })
    const tweetElement = await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 })
    if (!tweetElement) throw new Error('无法在页面上定位到推文元素.')
    log?.('定位到推文元素, 正在生成截图...')
    return await tweetElement.screenshot()
  } finally {
    await page.close()
  }
}

async function getTweetDataByApi(ctx: Context, tweetUrl: string, useOriginal: boolean, log?: (message: string) => void): Promise<TweetData> {
  const apiUrl = tweetUrl.replace(/(twitter\.com|x\.com)/, 'api.vxtwitter.com')
  log?.(`使用 vxtwitter API 进行解析: ${apiUrl}`)
  const http = ctx.http.extend({ headers: { 'User-Agent': 'Koishi-Twitter-Fetcher' } })
  const apiResponse = await http.get(apiUrl)
  log?.('成功接收到 vxtwitter API 的响应.')

  const media: TweetMedia[] = []
  for (const item of apiResponse.media_extended || []) {
    let mediaUrl = item.url
    if (item.type === 'image' && useOriginal) {
      mediaUrl = mediaUrl.replace(/(\.\w+)$/, '$1:orig')
      mediaUrl = normalizeTwitterImageUrl(mediaUrl, true)
    }
    media.push({ url: mediaUrl, type: item.type === 'image' ? 'image' : inferMediaType(mediaUrl, item.type) })
  }

  return {
    userScreenName: apiResponse.user_screen_name,
    text: apiResponse.text || '',
    media,
  }
}

async function getTweetDataByBrowser(puppeteer: Puppeteer, tweetUrl: string, cookie: string | undefined, useOriginal: boolean, log?: (message: string) => void): Promise<TweetData> {
  const page = await puppeteer.page()
  const captured = new Map<string, TweetMedia>()
  const addMedia = (url: string, type?: MediaType) => {
    url = sanitizeMediaUrl(url)
    if (!url || url.startsWith('blob:') || url.startsWith('data:')) return
    if (!/pbs\.twimg\.com|video\.twimg\.com/i.test(url)) return
    const mediaType = type || inferMediaType(url)
    const normalized = mediaType === 'image' ? normalizeTwitterImageUrl(url, useOriginal) : url
    const key = getMediaKey(normalized)
    if (!captured.has(key)) captured.set(key, { url: normalized, type: mediaType })
  }

  page.on('response', response => {
    try {
      const url = response.url()
      if (!/pbs\.twimg\.com|video\.twimg\.com/i.test(url)) return
      addMedia(url, inferMediaType(url))
    } catch {}
  })

  try {
    if (cookie) await page.setCookie({ name: 'auth_token', value: cookie, domain: '.x.com', path: '/', httpOnly: true, secure: true })
    await page.goto(tweetUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 20000 })
    const tweetId = extractTweetId(tweetUrl)

    const data = await page.evaluate((targetTweetId) => {
      const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'))
      let article: Element | null = null
      for (const item of articles) {
        const text = item.textContent || ''
        if (/(promoted|推广|广告)/i.test(text)) continue
        if (!targetTweetId || item.querySelector(`a[href*="/status/${targetTweetId}"]`)) {
          article = item
          break
        }
      }
      if (!article) return null

      const urls: string[] = []
      article.querySelectorAll('[data-testid="tweetPhoto"] img').forEach((img: any) => {
        if (img.src) urls.push(img.src)
        const rawSrc = img.getAttribute('src')
        if (rawSrc) urls.push(rawSrc)
        const srcset = img.getAttribute('srcset')
        if (srcset) urls.push(...srcset.split(',').map(item => item.trim().split(/\s+/)[0]).filter(Boolean))
      })
      article.querySelectorAll('video, [data-testid="videoPlayer"] video, [data-testid="gifPlayable"] video, source').forEach((node: any) => {
        if (node.src) urls.push(node.src)
        const rawSrc = node.getAttribute('src')
        if (rawSrc) urls.push(rawSrc)
      })
      const html = (article as HTMLElement).innerHTML.replace(/\\u002F/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&')
      for (const item of html.match(/https:\/\/pbs\.twimg\.com\/media\/[^"'< >]+/g) || []) urls.push(item)
      for (const item of html.match(/https:\/\/video\.twimg\.com\/[^"'< >]+/g) || []) urls.push(item)

      const textEl = article.querySelector('[data-testid="tweetText"]')
      const authorNameEl = article.querySelector('[data-testid="User-Name"] span')
      const authorIdHref = Array.from(article.querySelectorAll('a[href]')).map((item: any) => item.getAttribute('href') || '').find((href: string) => /^\/[^/]+$/.test(href))
      return {
        text: textEl?.textContent?.trim() || '',
        author: authorNameEl?.textContent?.trim() || '',
        userScreenName: authorIdHref ? authorIdHref.slice(1) : '',
        urls,
        gateText: `${article.textContent || ''}\n${document.body.textContent || ''}`,
      }
    }, tweetId)

    const domKeys = new Set<string>()
    for (const rawUrl of data?.urls || []) {
      const candidates = rawUrl.includes(',') ? rawUrl.split(',').map(item => item.trim().split(/\s+/)[0]).filter(Boolean) : [rawUrl]
      for (const candidate of candidates) {
        const url = sanitizeMediaUrl(candidate)
        const mediaType = inferMediaType(url)
        const normalized = mediaType === 'image' ? normalizeTwitterImageUrl(url, useOriginal) : url
        domKeys.add(getMediaKey(normalized))
        addMedia(url, mediaType)
      }
    }
    if (!domKeys.size && captured.size) {
      const gateHint = data?.gateText && hasPotentialMediaGate(data.gateText) ? '检测到页面可能存在年龄墙或敏感内容遮挡。' : ''
      log?.(`${gateHint}目标推文 DOM 未确认任何媒体，已拒绝发送 ${captured.size} 个浏览器捕获资源，避免误发头像或页面图标。`, true)
    }
    const media = Array.from(captured.entries()).filter(([key]) => domKeys.has(key)).map(([, value]) => value)
    log?.(`浏览器解析完成: text=${data?.text ? 'yes' : 'no'}, domMedia=${domKeys.size}, capturedMedia=${captured.size}, media=${media.length}`)
    return {
      text: data?.text || '',
      author: data?.author || '',
      userScreenName: data?.userScreenName || '',
      media,
    }
  } finally {
    await page.close()
  }
}

async function convertVideoToGif(ffmpeg: FFmpegService, inputPath: string, outputPath: string) {
  await ffmpeg.builder()
    .input(inputPath)
    .outputOption(
      '-vf',
      'fps=15,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
      '-y'
    )
    .run('file', outputPath)
}

export function apply(ctx: Context, config: Config) {
  logger.info('Twitter Fetcher 插件已启动.')

  ctx.model.extend('twitter_subscriptions', { id: 'string', last_tweet_url: 'string' }, { primary: 'id' })

  ctx.inject(['console'], (ctx) => {
    const baseDir = __dirname
    ctx.console.addEntry({
      dev: resolve(baseDir, '../client/index.ts'),
      prod: resolve(baseDir, '../dist'),
    })
  })

  const createLogStepper = (prefix: string) => {
    let step = 1
    return (message: string, isWarning = false) => {
      if (config.logDetails) {
        const logMessage = `[${prefix}] [步骤 ${step++}] ${message}`
        if (isWarning) logger.warn(logMessage)
        else logger.info(logMessage)
      }
    }
  }

  async function getTempDir() {
    const dir = resolve(ctx.baseDir, config.tempPath || 'data/temp/twitter-fetcher')
    await ensureDir(dir)
    return dir
  }

  function cleanupTempFile(path: string, delay = 0) {
    if (delay > 0) {
      const timer = setTimeout(() => fs.unlink(path).catch(() => {}), delay)
      if (typeof (timer as any).unref === 'function') (timer as any).unref()
      return
    }
    return fs.unlink(path).catch(() => {})
  }

  async function downloadToTemp(url: string, mimeHint?: string) {
    const http = ctx.http.extend({ headers: { 'User-Agent': 'Koishi-Twitter-Fetcher', 'Referer': 'https://x.com/' } })
    const file = await http.file(url)
    const mime = file.mime || mimeHint || 'application/octet-stream'
    const ext = mimeToExtension(mime) || extname(new URL(url).pathname) || '.bin'
    const path = join(await getTempDir(), `${Date.now()}-${randomUUID()}${ext}`)
    await fs.writeFile(path, toBuffer(file.data))
    return { path, data: toBuffer(file.data), mime }
  }

  async function createMediaElement(media: TweetMedia, log?: (message: string, isWarning?: boolean) => void): Promise<h | null> {
    const type = media.type === 'image' ? 'image' : 'video'
    const configuredMode = type === 'image' ? config.imageTransferMode : config.videoTransferMode
    let mode = configuredMode
    let sourceUrl = media.url
    let tempInput: string | null = null
    let tempOutput: string | null = null
    let data: Buffer | null = null
    let mime = media.mime || (type === 'image' ? 'image/jpeg' : 'video/mp4')

    try {
      if (media.type === 'gif' && config.gifMode === 'realGif') {
        const ffmpeg = ctx.get('ffmpeg') as FFmpegService | undefined
        if (!ffmpeg) {
          log?.('realGif 需要启用 koishi-plugin-ffmpeg 服务，当前未加载，回退为视频发送。', true)
        } else {
          log?.('检测到 Twitter 动图，准备通过 koishi-plugin-ffmpeg 服务转为真 GIF。')
          const input = await downloadToTemp(sourceUrl, 'video/mp4')
          tempInput = input.path
          tempOutput = join(await getTempDir(), `${Date.now()}-${randomUUID()}.gif`)
          await convertVideoToGif(ffmpeg, tempInput, tempOutput)
          data = await fs.readFile(tempOutput)
          mime = 'image/gif'
          mode = config.imageTransferMode === 'url' ? 'buffer' : config.imageTransferMode
          sourceUrl = fileUrl(tempOutput)
        }
      }

      if (mode === 'url') {
        return type === 'image' || mime === 'image/gif' ? h.image(sourceUrl) : h.video(sourceUrl)
      }

      if (mode === 'file') {
        if (tempOutput) {
          const output = tempOutput
          cleanupTempFile(output, 10 * Time.minute)
          tempOutput = null
          return h.image(fileUrl(output))
        }
        const file = await downloadToTemp(sourceUrl, mime)
        cleanupTempFile(file.path, 10 * Time.minute)
        return type === 'image' ? h.image(fileUrl(file.path)) : h.video(fileUrl(file.path))
      }

      if (!data) {
        const file = await downloadToTemp(sourceUrl, mime)
        data = file.data
        mime = file.mime
        await cleanupTempFile(file.path)
      }

      if (mode === 'base64') {
        const dataUrl = `data:${mime};base64,${data.toString('base64')}`
        return type === 'image' || mime === 'image/gif' ? h.image(dataUrl) : h.video(dataUrl)
      }

      return type === 'image' || mime === 'image/gif' ? h.image(data, mime) : h.video(data, mime)
    } catch (error) {
      log?.(`媒体发送元素生成失败: ${sourceUrl}, 错误: ${error.message}`, true)
      return null
    } finally {
      if (tempInput) await cleanupTempFile(tempInput)
      if (tempOutput && mode !== 'file') await cleanupTempFile(tempOutput)
    }
  }

  async function loadTweetData(tweetUrl: string, useOriginal: boolean, log?: (message: string, isWarning?: boolean) => void): Promise<TweetData> {
    const needApi = config.tweetFetchMode === 'api' || config.mediaFetchMode === 'api'
    const needBrowser = config.tweetFetchMode === 'browser' || config.mediaFetchMode === 'browser'
    const apiData = needApi ? await getTweetDataByApi(ctx, tweetUrl, useOriginal, log) : null
    const browserData = needBrowser ? await getTweetDataByBrowser(ctx.puppeteer, tweetUrl, config.cookie, useOriginal, log) : null
    const textSource = config.tweetFetchMode === 'browser' ? browserData : apiData
    const mediaSource = config.mediaFetchMode === 'browser' ? browserData : apiData

    return {
      userScreenName: textSource?.userScreenName || apiData?.userScreenName || browserData?.userScreenName,
      author: textSource?.author || browserData?.author,
      text: textSource?.text || '',
      media: mediaSource?.media || [],
    }
  }

  async function processTweet(
    tweetUrl: string,
    options: {
      showLink?: boolean
      showScreenshot: boolean
      sendText: boolean
      sendMedia: boolean
      downloadOriginalImage?: boolean
      useForward: boolean
      platform?: string
      enableTranslation?: boolean
      targetLang?: string
    }
  ): Promise<ProcessedTweet> {
    const log = createLogStepper(tweetUrl)
    log(`开始处理推文`)

    const textParts: string[] = []
    const mediaParts: h[] = []

    if (options.showLink) {
      log('配置了推送时附带链接, 在消息头部加入推文URL.')
      textParts.push(tweetUrl)
    }

    let screenshotElement: h | null = null
    if (options.showScreenshot) {
      log('开始获取推文截图.')
      try {
        const screenshotBuffer = await getTweetScreenshot(ctx.puppeteer, tweetUrl, config.cookie, log)
        if (screenshotBuffer) {
          screenshotElement = h.image(screenshotBuffer, 'image/png')
          log('截图成功并准备好 h.image 元素 (Buffer 模式).')
        }
      } catch (error) {
        log(`截图失败: ${error.message}`, true)
      }
    }

    try {
      const tweetData = await loadTweetData(tweetUrl, !!options.downloadOriginalImage, log)

      if (tweetData.userScreenName) textParts.push(`用户ID: ${tweetData.userScreenName}`)
      if (options.sendText && tweetData.text) {
        textParts.push(`推文内容: ${tweetData.text}`)
        if (options.enableTranslation && options.targetLang) {
          log('检测到翻译已开启.')
          const translatedText = await translateText(ctx, tweetData.text, options.targetLang, log)
          if (translatedText) textParts.push(`\n【谷歌翻译 (${options.targetLang})】:\n${translatedText}`)
          else log('翻译失败或返回空内容.', true)
        }
      }

      if (screenshotElement) mediaParts.push(screenshotElement)

      if (options.sendMedia && tweetData.media.length > 0) {
        log(`发现 ${tweetData.media.length} 个媒体文件, 准备处理.`)
        for (const [index, media] of tweetData.media.entries()) {
          log(`正在处理媒体文件 ${index + 1}/${tweetData.media.length} (${media.type}) from ${media.url}`)
          const element = await createMediaElement(media, log)
          if (element) mediaParts.push(element)
        }
      }

      const hasText = textParts.length > 0
      const hasMedia = mediaParts.length > 0
      if (!hasText && !hasMedia) {
        log('处理完成, 但未能获取到任何文本或媒体内容.', true)
        return { main: '未能获取到任何内容.', media: [] }
      }

      log('内容组装完毕, 准备发送.')
      if (config.separateMediaSend) {
        const mainParts: (string | h)[] = [textParts.join('\n'), screenshotElement].filter(Boolean)
        const main = options.useForward && options.platform === 'onebot' && mainParts.length
          ? h('figure', {}, mainParts)
          : mainParts.join('\n\n') || undefined
        return {
          main,
          media: mediaParts.filter(part => part !== screenshotElement),
        }
      }

      if (options.useForward && options.platform === 'onebot') {
        const forwardElements: (h | string)[] = [textParts.join('\n'), ...mediaParts].filter(Boolean)
        return { main: h('figure', {}, forwardElements), media: [] }
      }
      const finalParts: (string | h)[] = [textParts.join('\n'), ...mediaParts].filter(Boolean)
      return { main: finalParts.join('\n\n'), media: [] }
    } catch (error) {
      logger.warn(`[!] 推文处理失败:`, error)
      return { main: `获取推文内容失败: ${error.message}`, media: [] }
    }
  }

  async function sendProcessedTweet(send: (message: string | h) => Promise<any>, result: ProcessedTweet) {
    if (result.main) await send(result.main)
    for (const media of result.media) await send(media)
  }

  ctx.middleware(async (session, next) => {
    TWEET_URL_REGEX.lastIndex = 0
    const match = TWEET_URL_REGEX.exec(session.content)
    if (!match) return next()

    let statusMessage: string[] | undefined
    if (!config.silentParsing) {
      statusMessage = await session.send(h('quote', { id: session.messageId }) + '正在解析推文链接, 请稍候...')
    }

    const messageToSend = await processTweet(match[0], {
      showLink: false,
      showScreenshot: config.showScreenshot,
      sendText: config.sendText,
      sendMedia: config.sendMedia,
      downloadOriginalImage: config.downloadOriginalImage,
      useForward: config.useForward,
      platform: session.platform,
      enableTranslation: config.parse_enableTranslation,
      targetLang: config.parse_targetLang,
    })

    await sendProcessedTweet(message => session.send(message), messageToSend)
    if (statusMessage) await session.bot.deleteMessage(session.channelId, statusMessage[0])
  })

  async function checkAndPushUpdates(isManualTrigger = false) {
    if (!config.enableSubscription) return

    if (config.logDetails) logger.info('[订阅] 开始新一轮更新检查...')
    const botKey = `${config.platform}:${config.selfId}`
    const bot = ctx.bots[botKey]

    if (!bot || !bot.online) {
      logger.warn(`[订阅] 配置中指定的机器人 [${botKey}] 不存在或不在线, 跳过本轮检查.`)
      return isManualTrigger ? `配置中指定的机器人 [${botKey}] 不存在或不在线.` : undefined
    }

    let updatesFound = 0
    for (const sub of config.subscriptions) {
      if (!sub.username || !sub.groupIds || sub.groupIds.length === 0) continue

      const log = createLogStepper(`订阅:${sub.username}`)
      log('开始处理此用户的订阅.')

      try {
        const excludeRetweets = sub.excludeRetweets ?? true
        const tweetFilterMode: TweetFilterMode = sub.tweetFilterMode ?? 'all'
        const latestTweetUrl = await getLatestTweetUrlByPuppeteer(ctx.puppeteer, sub.username, config.cookie, excludeRetweets, tweetFilterMode, log)

        if (!latestTweetUrl) {
          log('未能获取到最新推文链接, 跳过.', true)
        } else {
          const record = await ctx.database.get('twitter_subscriptions', { id: sub.username })
          const lastUrl = record[0]?.last_tweet_url
          const isNew = !lastUrl || lastUrl !== latestTweetUrl
          const shouldPush = isNew || (isManualTrigger && latestTweetUrl)

          if (shouldPush) {
            updatesFound++
            logger.info(`[订阅] ★★★ 发现 [${sub.username}] 的新推文! ★★★`)
            const messageToSend = await processTweet(latestTweetUrl, {
              showLink: config.sub_showLink,
              showScreenshot: config.sub_showScreenshot,
              sendText: config.sub_sendText,
              sendMedia: config.sub_sendMedia,
              downloadOriginalImage: config.sub_downloadOriginalImage,
              useForward: config.sub_useForward,
              platform: bot.platform,
              enableTranslation: config.sub_enableTranslation,
              targetLang: config.sub_targetLang,
            })

            for (const groupId of sub.groupIds) await sendProcessedTweet(message => bot.sendMessage(groupId, message), messageToSend)
            if (isNew) await ctx.database.upsert('twitter_subscriptions', [{ id: sub.username, last_tweet_url: latestTweetUrl }])
          } else {
            log('链接无变化, 无需推送.')
          }
        }
      } catch (error) {
        logger.warn(`[订阅] 检查 [${sub.username}] 时发生错误:`, error)
      }

      if (config.logDetails) logger.info(`[订阅] 处理完 [${sub.username}], 等待 3 秒后继续...`)
      await sleep(3 * Time.second)
    }

    if (config.logDetails) logger.info(`[订阅] 本轮更新检查结束, 共发现 ${updatesFound} 个更新.`)
    if (isManualTrigger) return `手动检查完成, 共为 ${updatesFound} 个订阅执行了推送任务.`
  }

  if (config.enableSubscription) {
    ctx.setInterval(() => checkAndPushUpdates(false), config.updateInterval * Time.minute)

    ctx.command('测试推特用户推送 <username:string>', '测试指定用户的最新推文能否被正确获取和推送')
      .action(async ({ session }, username) => {
        if (!username) return '请输入要测试的用户名.'
        await session.send(`正在为 [${username}] 获取最新推文并模拟推送到当前会话...`)
        const log = createLogStepper(`测试:${username}`)
        try {
          const latestTweetUrl = await getLatestTweetUrlByPuppeteer(ctx.puppeteer, username, config.cookie, true, 'all', log)
          if (!latestTweetUrl) return '无法找到该用户的最新推文链接(已排除转推).'
          await session.send(`成功获取到最新推文链接: ${latestTweetUrl}\n正在生成内容...`)
          const messageToSend = await processTweet(latestTweetUrl, {
            showLink: config.sub_showLink,
            showScreenshot: config.sub_showScreenshot,
            sendText: config.sub_sendText,
            sendMedia: config.sub_sendMedia,
            downloadOriginalImage: config.sub_downloadOriginalImage,
            useForward: config.sub_useForward,
            platform: session.platform,
            enableTranslation: config.sub_enableTranslation,
            targetLang: config.sub_targetLang,
          })
          await sendProcessedTweet(message => session.send(message), messageToSend)
        } catch (error) {
          logger.warn(`[测试] 测试 [${username}] 时出错:`, error)
          return `测试失败: ${error.message}`
        }
      })

    ctx.command('测试群组推送', '立即获取所有订阅的最新推文并强制推送, 用于测试')
      .action(async ({ session }) => {
        session.send('正在手动触发所有订阅的强制推送任务...')
        const result = await checkAndPushUpdates(true)
        return result
      })
  }
}




