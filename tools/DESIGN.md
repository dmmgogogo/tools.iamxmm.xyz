# tools.iamxmm.xyz 界面设计规则

新增或修改任何工具页都按这份规则来。视觉基调：**暖白纸 + 墨色等宽字 + 一抹朱红**，像一份手工整理的工具目录。拿不准时，照抄 `public/base64/` 的结构。

## 1. 颜色：每种颜色只有一种含义

所有颜色都用 `public/home.css` 里的 CSS 变量（已自带深色模式），**禁止在页面里写死色值**。

| 变量 | 含义 | 用在哪 |
|---|---|---|
| `--paper` | 纸面背景 | body、输入框底色 |
| `--ink` | 结构与主文字 | 标题、正文、输入内容、控制条上边框、复制按钮 |
| `--ink-2` | 次要文字 | 标签（MD5、UTC…）、meta 信息、次要文字按钮、说明文字 |
| `--rule` | 细分割线 | 表格行线、输入框边框 |
| `--hover` | 悬停 / 只读底色 | 悬停行、只读输出框背景 |
| `--result` | **结果** | 计算结果、可复制的值、2FA 验证码（加粗） |
| `--accent` | 品牌 + 状态提醒 | 标题斜杠 `/`、聚焦边框、错误和警告提示 |
| `--ok` | 成功 | 「✓ 已复制」、校验通过提示 |

一句话：**黑色是结构，蓝色是结果，红色是品牌或出错，绿色是成功。**

- 结果一律 `--result` + `font-weight: 600`：输出框 `.io[readonly]`、`pre.io`、`.kv td` 的值已经在 `tool.css` 里统一处理，不要再单独设置。
- 朱红不要用在普通按钮和结果上，否则会被误读成报错。
- 不是结果的回显区域（比如正则的高亮区）要恢复成 `--ink`、常规字重。

## 2. 字体

- 等宽 `--mono`：标题字标、标签、按钮、结果、代码类内容。
- 无衬线 `--sans`：说明性的中文句子（lede、提示文案）。
- 不引入任何外部字体（CSP 禁止，也不需要）。

## 3. 页面骨架（每个工具页都一样）

```
kicker   tools / <slug>                       ← 链接回首页
h1       <slug>/                               ← .mark.small，斜杠朱红
lede     一句话说明这个工具干什么
.work
  .bar   模式切换(.seg) · 选项(.opt) · 主按钮(.btn)   ← 上边 2px 墨线
  .panes 左：输入  右：结果（手机上自动变单列）
    .pane-head  标题 · meta · spacer · 次要按钮 · 复制按钮
    .io         textarea / pre
    .status     提示行（.err 红 / .ok 绿）
footer   ← 全部工具 · 全部在浏览器本地处理
```

`<head>` 必须包含 icon、`home.css`、`tool.css`，脚本按 `common.js` → `<slug>/app.js` 顺序引用（抄 `base64/index.html`）。

## 4. 组件（都在 `public/tool.css`）

| 组件 | 类名 | 规则 |
|---|---|---|
| 控制条 | `.bar` | 放模式切换、选项、主按钮，自动换行 |
| 分段选择 | `.seg` + `button.on` | 编码/解码、算法等互斥选项 |
| 复选项 | `.opt` | 勾选框 + 文字 |
| 主按钮 | `.btn` / `.btn.primary` | 墨色边框；primary 墨底白字，悬停变朱红 |
| 复制按钮 | `.tbtn.cbtn` + `data-copy="#目标id"` | 墨色细框小按钮，悬停反白，成功后自动变绿显示「✓ 已复制」。**所有复制都用它** |
| 次要文字按钮 | `.tbtn` | 灰色文字，悬停变墨色 + 下划线：清空、填入现在、下载等 |
| 输入/输出框 | `.io`（输出加 `readonly`） | 输出自动变蓝加粗 |
| 结果表 | `.kv` | th 放标签（灰），td 放值（蓝粗）+ 复制按钮 |
| 提示行 | `.status` / `.err` / `.ok` | 用 `T.status(el, msg, kind)` 设置 |
| 文件拖放 | `.drop` | 虚线框，悬停/拖入时边框变朱红 |

JS 里动态生成复制按钮：`className = 'tbtn cbtn'`，点击调用 `T.copy(text, btn)`，传入按钮才有就地变绿的反馈。

## 5. 交互

- 输入即出结果（`T.debounce` 120–200ms），大输入加长防抖或改为按钮触发。
- 能复制的结果都配复制按钮；复制反馈在按钮上完成，不额外弹提示。
- 动效只用 `transform` / `opacity` / 颜色过渡，缓动用 `--ease`，不要 `transition: all`；尊重 `prefers-reduced-motion`。
- 状态切换不能让布局跳动（按钮用 `min-width`，结果区预留高度）。

## 6. 布局与适配

- 页面容器 `.page.wide`（最宽 1280px），左右留白随屏宽变化。
- 必须在 **375px 宽** 下无横向滚动：网格用 `minmax(0, 1fr)`，长文本 `word-break: break-all` 或省略号。
- 深色模式靠变量自动适配，新增样式只能用变量。

## 7. 硬约束（线上 CSP）

- 禁止内联 `<script>` / `<style>` / `style=""` / `onclick=` 等；JS 里用 `el.style.x = …` 可以。
- 禁止外部 CDN，第三方库下载到 `<slug>/vendor/` 并保留许可证。
- 用户内容一律用 `textContent` / `createTextNode` 插入，禁止 `innerHTML` 拼接、`eval`、`new Function`。
- 所有处理在浏览器本地完成，不发网络请求。
- 可能卡死的计算（如正则）放 Web Worker 并设超时。

## 8. 新增工具清单

1. 建 `public/<slug>/index.html` + `app.js`（需要时加 `style.css`，只用变量），骨架抄 `base64/`。
2. 在 `public/tools.js` 对应分类加一行（slug、name、desc、kw 搜索词含拼音）。
3. 本地 `python3 -m http.server --directory public` 预览：浅色、深色、375px 都看一遍。
4. 业务逻辑改动跑 code review，再 `./deploy.sh` 部署。
