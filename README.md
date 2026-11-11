# dsh-peak-valley

在输入框下面那一行挂一枚小倒计时，告诉你现在是不是峰时、离下一次切换还有多久。它和上下文用量环相邻，安静地贴在最右侧那组里。

```
… 缓存命中 99.6%   ● 谷时 · 距峰时 00:19:52   ◔ 37%
                              ↑ 这里          ↑ 上下文用量环
```

- 每秒刷新，`tabular-nums` 等宽数字，数字跳动时不抖
- **峰时红灯、谷时绿灯**，都是呼吸灯：亮度在 2.6 秒里缓慢起伏，外面一圈同色光晕跟着扩散
- 灯用状态色**原色**（`#ec1313` / `#22c55e`，深色主题下自动换成对应的 400 档），文字则压深一档保证可读——灯要艳，字要清
- 光晕用径向渐变而不是 `box-shadow`：iOS 上「小尺寸 + 圆角 + 动画 box-shadow」会被光栅化成方框（真机踩过）
- 系统开了「减少动态效果」时自动退化成一颗常亮的灯
- 跨天、跨假期会显示天数：`谷时 · 距峰时 3天 04:12:33`
- 鼠标悬停出规则说明，并告诉你**今天**是工作日、周末还是哪个节假日

## 截图

![输入框下方的峰谷倒计时](docs/dock.png)

*输入框下方那一行：`● 谷时 · 距峰时 00:19:52`，右邻是上下文用量环（`◔ 37%`）。*

## 规则

全部按**北京时间（UTC+8，无夏令时）**，与浏览器所在时区无关：

| 时段 | 判定 |
| --- | --- |
| 峰时 | 周一至周五 **09:00–12:00**、**14:00–18:00** |
| 谷时 | 其余全部时间：午休、夜间、周末、中国法定节假日全天 |

两个边界细节，按需求原文取的字面含义：

- **调休上班的周末仍然算谷时**。比如 2026-01-04 是周日补班日，插件按「周末」判为谷时，而不是按「上班」判为峰时。
- **法定节假日按放假安排整天算谷时**，包括连休里那些本来要上班的调休日（如 2026-02-16 周一）。

## 节假日表

写死在 `client.js` 的 `HOLIDAY_RANGES` 里，一段一行，改起来就是加一行：

```js
// 2026 · 国办发明电〔2025〕7 号
['2026-10-01', '2026-10-07', '国庆'],
// 2027 · 2026-11 公布；劳动节为预估，正式通知后改这一行
['2027-04-30', '2027-05-04', '劳动节'],
```

- 已含 **2026 全年**（官方通知）与 **2027 全年**（2026-11 公布；其中劳动节当时只有预估的 4/30–5/4，正式通知出来改一行即可）
- 每年国务院办公厅发新一年安排后，加一组就行；表里没有的年份自动按「周一到周五」判断，不会报错
- 想知道表里到底收了哪些天：`node scripts/validate.mjs` 会提示缺失的国庆段

来源：[国务院办公厅关于2026年部分节假日安排的通知](https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm)、[2027 年放假安排](https://finance.sina.com.cn/wm/2026-11-02/doc-inixicih3062259.shtml)。

## 安装

```sh
# 从 GitHub
dsh plugin --profile web add github:wangjiaxi/dsh-peak-valley

# 从本地目录（开发时用，link 方式，改文件即时生效）
dsh plugin --profile web add /path/to/dsh-peak-valley

# 从 npm（发布之后）
dsh plugin --profile web add dsh-peak-valley@latest
```

装完刷新页面，输入框下方那一行最右边就会出现倒计时。

## 它挂在哪

`conversation.composer.dock` —— 输入框卡片下方那一行「环境信息」槽位。这一行原本是：

```
[活动状态气泡] [本轮用量气泡] [上下文指示器]
```

现在是 `… [本轮用量气泡] [峰谷倒计时] [上下文指示器]`（倒计时用槽位 `order: 999` 排在自己这一组的最后）。

## 窄屏

- 输入框下方那一行是宿主的 flex 车道，本身不换行；条目一多、屏一窄就会顶出卡片。插件只加了一条 `[data-composer-dock]{flex-wrap:wrap}`——一行放得下时它不产生任何变化。
- ≤767px 时**只留一颗 8px 的灯**：文字和悬停气泡都不渲染——那一行本来就挤，倒计时数字会被屏幕边切掉，触屏上的气泡还会「粘」着不走。峰/谷靠灯色表达，读屏用户读 `aria-label`。

## 实现要点

- **纯客户端**：宿主半边是空的 `apply()`，不注册工具、不发请求、不写任何存储
- 时间换算不做时区库：北京时间固定 +8h，把时间整体平移后用 `Date.UTC` 系列取值就是北京墙上时间；切点只有 00:00 / 09:00 / 12:00 / 14:00 / 18:00 五个整点，所以找「下一次切换」是枚举候选点而不是逐分钟扫
- 每秒一次 `setInterval` 只驱动一个 `useState`，组件是叶子节点，不碰会话数据

## 开发与自测

```sh
node --check client.js
node scripts/validate.mjs   # 等同于 npm run validate
```

逻辑本身用真实时刻表跑过一遍（工作日、午休、周末、国庆、春节、元旦、周日补班日）：

```
2026-11-06T18:00 (周五收盘) → 谷时，下一次 2026-11-09T09:00（周一开盘）
2026-10-01T10:00 (国庆)     → 谷时，下一次 2026-10-08T09:00
2026-01-04T10:00 (周日补班) → 谷时，下一次 2026-01-05T09:00
```

## License

MIT

---

## English

A live peak / off-peak countdown pinned to the right end of the composer dock, next to the context meter.

- **Peak** — 09:00–12:00 and 14:00–18:00 Beijing time (UTC+8, no DST) on Monday to Friday
- **Off-peak** — everything else: lunch break, nights, weekends, and Chinese public holidays

Two literal readings worth knowing: a weekend that the government designates as a make-up workday still counts as **off-peak**, and every day inside a holiday block counts as **off-peak** even if it would otherwise be a workday.

The holiday table is a plain array in `client.js` (`HOLIDAY_RANGES`) covering 2026 and 2027; add a line when the State Council publishes the next year. Unknown years fall back to "Monday–Friday", so it never throws.

```sh
dsh plugin --profile web add github:wangjiaxi/dsh-peak-valley
```
