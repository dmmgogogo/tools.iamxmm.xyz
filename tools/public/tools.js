// 工具注册表：首页目录与搜索都从这里渲染。新增工具只需在对应分类里加一行。
// kw 是额外的搜索关键词（拼音缩写、英文别名等），不显示。
window.TOOLS = [
  {
    cat: '格式化 · 数据',
    items: [
      { slug: 'json', name: 'JSON 格式化', desc: '格式化、压缩、校验、转义', kw: 'json geshihua yasuo jiaoyan format minify' },
      { slug: 'timestamp', name: '时间戳转换', desc: 'Unix 秒/毫秒 ↔ 日期时间', kw: 'timestamp unix time shijianchuo date' },
      { slug: 'regex', name: '正则测试', desc: '实时匹配高亮、分组、替换', kw: 'regex regexp zhengze match replace' },
      { slug: 'diff', name: '文本对比', desc: '逐行差异对比，高亮增删', kw: 'diff compare duibi chayi' },
    ],
  },
  {
    cat: '编码 · 转义',
    items: [
      { slug: 'base64', name: 'Base64 编解码', desc: '文本 / 文件 / 图片 ↔ Base64，支持 URL 安全', kw: 'base64 b64 bianma jiema image' },
      { slug: 'url', name: 'URL 编解码', desc: 'encodeURIComponent / 解码，解析查询参数', kw: 'url urlencode encode decode bianma query' },
      { slug: 'escape', name: '字符串转义', desc: 'HTML 实体、Unicode \\u、JS 字符串转义', kw: 'escape html unicode zhuanyi entity' },
    ],
  },
  {
    cat: '安全 · 身份',
    items: [
      { slug: '2fa', name: '2FA 动态密码', desc: '谷歌身份验证器 TOTP，点击复制，导入导出', kw: '2fa totp google authenticator otp dongtai mima' },
      { slug: 'hash', name: '哈希计算', desc: 'MD5 / SHA-1 / SHA-256 / SHA-512 / HMAC，支持文件', kw: 'hash md5 sha sha1 sha256 hmac haxi jiami' },
      { slug: 'jwt', name: 'JWT 解析', desc: '解码 Header / Payload，显示过期时间', kw: 'jwt token jiexi decode' },
      { slug: 'password', name: '密码 / UUID 生成', desc: '随机密码、UUID v4，批量生成', kw: 'password uuid guid random mima suiji' },
    ],
  },
  {
    cat: '生成 · 设计',
    items: [
      { slug: 'qrcode', name: '二维码生成', desc: '文本/链接生成二维码，下载 PNG / SVG', kw: 'qrcode qr erweima' },
      { slug: 'color', name: '颜色转换', desc: 'HEX / RGB / HSL / OKLCH 互转，取色', kw: 'color hex rgb hsl yanse picker' },
    ],
  },
];
