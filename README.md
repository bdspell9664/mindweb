# 心络 · Inner Synapse Map

**在线版：<https://bdspell9664.github.io/mindweb/>**

把个人情绪日志变成一张会随时间生长的内心神经图谱。每天写一段自由文本，交给你自己配置的
模型抽取成节点与连线，渲染成深蓝底色上的发光网络——看得见痛苦由什么引发、围绕什么主题、
和谁纠缠，以及最重要的一点：随着时间，它们怎么变。

## 跑起来

### Windows：双击 `start.bat`

会检查 Node.js、首次运行时自动装依赖、起服务，并自动打开浏览器。
关掉那个黑色窗口就等于退出心络。

没装 Node.js 的话，先去 https://nodejs.org 装一个 20 或更高版本，再双击。

### 其它方式（或 macOS / Linux）

```bash
npm install
npm run dev      # http://localhost:5173
```

首次打开点「设置」填自己的模型接口（OpenAI 兼容或 Anthropic），key 只写进本机 localStorage。
然后「写日志」录入当天日志，点「解析，长进图谱」。

```bash
npm test         # 34 个单元测试（合并 / 解析 / 视图派生 / LLM 兜底）
npm run build    # tsc --noEmit + vite build
npm run preview  # 预览生产构建（http://localhost:4173）
```

> 心络需要通过 HTTP 打开（`npm run dev` 或 `npm run preview`）。
> 直接双击 `dist/index.html`（`file://`）时，浏览器会禁用 IndexedDB 与 localStorage，
> 应用会正常渲染但存不下任何东西，并在界面上说明原因。

## 放到 GitHub 上

仓库里没有声明任何平台相关的二进制，`npm ci` 在 Linux / macOS / Windows 上都能跑通。

```bash
git init
git add .
git commit -m "心络：把情绪日志变成内心神经图谱"
git remote add origin git@github.com:<你的账号>/mindweb.git
git push -u origin main
```

- `.gitattributes` 把 `*.bat` 标成 `-text`：`start.bat` 是 GBK + CRLF，行尾被 git 转换就会坏掉，**这行别删**
- `.github/workflows/ci.yml`：push / PR 时跑 typecheck + 测试 + 构建
- `.github/workflows/deploy-pages.yml`：手动触发，把 `dist` 发到 GitHub Pages
  （先在 Settings → Pages → Source 里选 "GitHub Actions"）
- `base: './'` 已经配好，部署在 `https://<user>.github.io/<repo>/` 这种子路径下也能正确加载资源

### Windows 上 `npm install` 之后跑不起来？

个别 npm 版本装不全原生二进制（[npm/cli#4828](https://github.com/npm/cli/issues/4828)），
症状是 vite / tsc 报 `Cannot find native binding`：

```bash
npm run fix:native
```

它按当前平台从已经装好的包里找出缺的那几个补进 `node_modules`，不改 package.json。

## 手机上用

界面按手机尺寸调过：顶栏两行（标签那行横向滑动）、详情从底部弹出、时间轴滑块加大到
22px、输入框用 16px 字号（iOS 会在字号更小的输入框聚焦时把整页放大）。

- **触摸**：图谱拖动和双指缩放交给 d3-zoom（`touch-action: none`），不会和页面滚动打架
- **没有 hover**：手指不能悬停，所以移动端不弹节点浮层，点一下直接开详情
- **旋转 / 改窗口大小**：自动重新布局并适配视野；力参数按画布面积缩放，小屏不会把节点推出屏幕

### 在手机上怎么打开

手机上的 `localhost` 指的是手机自己。最省事的是部署到 GitHub Pages（见上），
然后用手机浏览器打开 `https://<user>.github.io/<repo>/`。

要在局域网里调试，可以让 vite 监听所有网卡：

```bash
npm run dev -- --host
```

再用 `http://<电脑的局域网 IP>:5173` 打开。注意 `<IP>:5173` 和 `localhost:5173`
是**两个不同的存储空间**，手机上写的不会出现在电脑上——用「设置 → 备份与迁移」搬。

## 图谱怎么读

**八种节点**，同名合并、计数累加（`event` 不合并，一天一个 `entry` 锚点）：

| 类型 | 含义 | 视觉 |
| --- | --- | --- |
| `emotion` | 你原话里的情绪词，不泛化 | 负向蓝紫冷光 / 正向暖橙光，发光强度 = 强度 |
| `person` | 出现的人物 | 按名字哈希取固定颜色 |
| `event` | 一次性的具体事件，钉在日期上 | 圆角胶囊 |
| `trigger` | 点燃情绪的画面/场景 | 灰蓝小节点 |
| `theme` | 长期主题 | 大而半透明的云团 |
| `wish` | 念想 | 金色光点，标记实现后加光环 + 全图金色涟漪 |
| `risk_node` | 涉及自伤的念头 | 柔和霜花，不用红色 |
| `entry` | 当天的日志锚点 | 小暗点（默认不显示） |

**五种边**：`triggered` 引发、`involves` 涉及、`belongs_to` 归属、`co_occurs` 共现，
以及最关键的 `evolves`——同一主题下不同日期的两个事件之间，一条虚线箭头，方向从旧到新。

`evolves` 不由模型给出：模型只按单篇抽取，跨日期的时间关系由应用端推断（`src/lib/merge.ts`
里的 `deriveEvolvesEdges`）。所以当图上出现一条从「认定这条路是错的」指向「妈妈同意买女装」的
金色虚线时，那就是这几个月里真实发生的松动。

## 数据存在哪、怎么不丢

- 日志原文、解析结果 → IndexedDB（`mindweb-db`），不支持时退回 localStorage
- API key → localStorage（`mindweb.llm`）
- 无账号、无云同步、无遥测
- 只有当天那段日志文本会发给你配置的模型；请求从浏览器直连，不经过任何中间服务

**浏览器按地址隔离存储。** `http://localhost:5173`、`http://localhost:5174`、
`http://127.0.0.1:5173`、以及另一个浏览器，是四个互不相通的数据库。
看起来像「日志丢了」，其实只是换了一个存储空间。所以：

- 端口固定 5173（`strictPort: true`），vite 不会自作主张换端口
- `start.bat` 发现 5173 已经在跑，就直接打开浏览器，不再起第二个服务
- 固定用 `http://localhost:5173` 打开，别用 IP、别用别的端口
- 「设置 → 备份与迁移」可以导出/导入 `.json`：换浏览器、换机器、换地址时用它搬数据
- 「设置 → 抹去一切」会把日志与 API key 一并清掉

## 已实现（MVP）

1. 日志录入（可设日期，一天一篇，同日再写会覆盖）
2. AI 解析：严格 JSON 校验 + 兜底重试 + 手动粘贴 JSON 的后路
3. 图谱主视图：力导向、拖拽缩放、hover 摘要；顶栏类型标签点一下就**高亮聚焦**（其余类型压暗但不消失，保留上下文）；左上角「摊开」重新铺开布局并缩放到刚好填满窗口
4. 列表视图：同一个数据库的另一种读法——按类型分组，或按时间倒序铺平；
   搜索同时匹配节点名和原文摘录，点一行就开详情
5. 节点详情侧栏：含义、出现次数、强度趋势折线、带日期的原文摘录、一跳关联
6. 时间回放：拖动或自动播放，图谱按日期生长，旧连接保留但渐暗

危险念头（`risk_node`）的详情栏底部常驻求助区块：全国心理援助热线 **12356**、
北京心理危机干预中心 **010-82951332**。没有红色弹窗，没有评分，没有排名。

## 还没做（下一轮迭代）

- 路径探询：选中两个节点，高亮最短关联路径
- 念想墙：独立的星空视图（`wish` 的标记已实现与涟漪动画已经能用）
- 周报：情绪均值、新增/消失节点、主题权重变化、值得注意的松动与恶化
  （`src/lib/graph.ts` 的 `weeklyReport` 已经算好了，只差视图）

## 代码结构

```
start.bat               Windows 一键启动（GBK 编码 + CRLF 行尾；改动时请保持，否则中文提示乱码）
src/
  types.ts              数据模型（8 节点 / 5 边 / 日志条目）
  store.ts              全局状态（useSyncExternalStore）、录入与解析编排
  lib/
    merge.ts            同名合并、无向边归一、演变边派生、图谱重建
    parse.ts            内置解析提示词、JSON 提取与严格校验
    llm.ts              OpenAI 兼容 / Anthropic 调用、重试与错误翻译
    graph.ts            颜色/半径/发光、视图派生、时间回放衰减、周报计算
    db.ts               IndexedDB + localStorage 兜底
    settings.ts         模型配置（仅本地）
  components/           GraphView / NodeDetail / Timeline / ComposeView / …
```

图谱完全由日志派生（`buildGraph(entries)`）：改一篇日志就整体重建一次，不留残影。
