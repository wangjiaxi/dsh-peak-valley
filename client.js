/**
 * dsh-peak-valley — 客户端（峰时 / 谷时倒计时）。
 *
 * 规则（全部按北京时间 Asia/Shanghai，UTC+8，无夏令时）：
 *   峰时 = 周一至周五（不含中国法定节假日）09:00–12:00、14:00–18:00
 *   谷时 = 其余全部时间，包含周末与法定节假日全天
 *
 * 挂在 `conversation.composer.dock`（输入框下方那一行），`order: 999` 让它排在
 * 上下文指示器等条目之后，也就是那一行最右边。每秒重算一次，显示「距下一次切换
 * 还有多久」；跨天/跨假期会显示天数。
 *
 * 纯前端：不注册任何宿主能力，也不发网络请求，唯一的常量是下面的节假日表。
 *
 * @module dsh-peak-valley/client
 */
window.__ModuleLoader__.load({
	id: "dsh-peak-valley",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const React = require('react');
		const h = React.createElement;

		/** 本地化命名空间。 */
		const NS = 'dsh-peak-valley';
		/** 北京时间的固定偏移：UTC+8，没有夏令时。 */
		const OFFSET = 8 * 60 * 60 * 1000;
		/** 一天里可能发生「峰→谷 / 谷→峰」的整分点（北京时间，单位：分钟）。 */
		const BOUNDARY_MINUTES = [0, 9 * 60, 12 * 60, 14 * 60, 18 * 60];
		/** 往前找多少天还没有切换就放弃（法定节假日最长 9 天，20 天足够）。 */
		const SEARCH_DAYS = 20;

		// #region i18n
		const zh = {
			peak: '峰时',
			off: '谷时',
			toOff: '距谷时',
			toPeak: '距峰时',
			day: '天',
			rule: '北京时间 周一至周五 09:00–12:00、14:00–18:00 为峰时',
			todayWorkday: '今天：工作日',
			todayWeekend: '今天：周末',
			todayHoliday: '今天：{name}',
			idle: '—'
		};
		const en = {
			peak: 'Peak',
			off: 'Off-peak',
			toOff: 'ends in',
			toPeak: 'starts in',
			day: 'd',
			rule: 'Peak hours: Mon–Fri 09:00–12:00 and 14:00–18:00 (UTC+8)',
			todayWorkday: 'Today: workday',
			todayWeekend: 'Today: weekend',
			todayHoliday: 'Today: {name}',
			idle: '—'
		};

		/** `ctx.locale.bind(NS)` 的结果；拿不到就退回内置词典。 */
		let bound = null;
		/** 从浏览器语言猜的兜底语言。 */
		let fallbackLang = (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '')) ? 'zh' : 'en';

		/**
		 * 取一条文案。
		 *
		 * @param {string} key - 文案键。
		 * @param {Record<string, unknown>} [params] - `{name}` 占位符。
		 * @returns {string} 文案。
		 */
		function t(key, params) {
			let text;
			if (typeof bound === 'function') {
				try {
					const value = bound(key, params);
					if (typeof value === 'string' && value !== '' && value !== key) text = value;
				} catch {
					text = undefined;
				}
			}
			if (text === undefined) {
				const dict = fallbackLang === 'zh' ? zh : en;
				text = typeof dict[key] === 'string' ? dict[key] : (typeof en[key] === 'string' ? en[key] : key);
			}
			if (params !== undefined && params !== null) {
				for (const name of Object.keys(params)) {
					text = text.split('{' + name + '}').join(String(params[name]));
				}
			}
			return text;
		}
		// #endregion

		// #region 节假日
		/**
		 * 中国法定节假日（按放假安排，含调休连休的周末）。
		 *
		 * 只影响「这一天算不算工作日」；调休上班的周末按需求仍然算周末（谷时）。
		 * 每年国务院办公厅会发新一年的安排，届时加一组就行。
		 */
		const HOLIDAY_RANGES = [
			// 2026 · 国办发明电〔2025〕7 号
			['2026-01-01', '2026-01-03', '元旦'],
			['2026-02-15', '2026-02-23', '春节'],
			['2026-04-04', '2026-04-06', '清明'],
			['2026-05-01', '2026-05-05', '劳动节'],
			['2026-06-19', '2026-06-21', '端午'],
			['2026-09-25', '2026-09-27', '中秋'],
			['2026-10-01', '2026-10-07', '国庆'],
			// 2027 · 2026-11 公布；劳动节为预估（4/30 起连休 5 天），正式通知后改这一行
			['2027-01-01', '2027-01-03', '元旦'],
			['2027-02-05', '2027-02-13', '春节'],
			['2027-04-03', '2027-04-05', '清明'],
			['2027-04-30', '2027-05-04', '劳动节'],
			['2027-06-09', '2027-06-09', '端午'],
			['2027-09-15', '2027-09-15', '中秋'],
			['2027-10-01', '2027-10-07', '国庆']
		];

		/** `YYYY-MM-DD` → 节假日名。 */
		const HOLIDAYS = (() => {
			const map = new Map();
			for (const [from, to, name] of HOLIDAY_RANGES) {
				let cursor = Date.parse(from + 'T00:00:00Z');
				const end = Date.parse(to + 'T00:00:00Z');
				while (cursor <= end) {
					map.set(new Date(cursor).toISOString().slice(0, 10), name);
					cursor += 24 * 60 * 60 * 1000;
				}
			}
			return map;
		})();
		// #endregion

		// #region 时间计算
		/** 两位补零。 */
		function pad2(value) {
			return String(value).padStart(2, '0');
		}

		/**
		 * 把绝对时间换算成北京时间的日历年月日与当日分钟数。
		 *
		 * 北京时间没有夏令时，所以整体平移 +8h 之后读 UTC 字段就是准确的北京墙上时间。
		 *
		 * @param {number} ms - epoch 毫秒。
		 * @returns {{ y: number, m: number, day: number, dow: number, minutes: number }} 北京时间的字段。
		 */
		function beijingParts(ms) {
			const shifted = new Date(ms + OFFSET);
			return {
				y: shifted.getUTCFullYear(),
				m: shifted.getUTCMonth(),
				day: shifted.getUTCDate(),
				dow: shifted.getUTCDay(),
				minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
			};
		}

		/**
		 * 北京时间的某天某分 → 绝对时间。
		 *
		 * @param {number} y - 年。
		 * @param {number} m - 月（0 起）。
		 * @param {number} day - 日；可以越界，Date.UTC 会自动进位。
		 * @param {number} minutes - 当日第几分钟。
		 * @returns {number} epoch 毫秒。
		 */
		function beijingInstant(y, m, day, minutes) {
			return Date.UTC(y, m, day, 0, 0, 0) + minutes * 60 * 1000 - OFFSET;
		}

		/**
		 * 这一刻属于峰时还是谷时，以及原因（用于提示气泡）。
		 *
		 * @param {number} ms - epoch 毫秒。
		 * @returns {{ kind: 'peak' | 'off', reason: 'peak' | 'weekday-off' | 'weekend' | 'holiday', name?: string }} 判定结果。
		 */
		function periodAt(ms) {
			const parts = beijingParts(ms);
			if (parts.dow === 0 || parts.dow === 6) return { kind: 'off', reason: 'weekend' };
			const key = parts.y + '-' + pad2(parts.m + 1) + '-' + pad2(parts.day);
			const holiday = HOLIDAYS.get(key);
			if (holiday !== undefined) return { kind: 'off', reason: 'holiday', name: holiday };
			const peak = (parts.minutes >= 9 * 60 && parts.minutes < 12 * 60)
				|| (parts.minutes >= 14 * 60 && parts.minutes < 18 * 60);
			return peak ? { kind: 'peak', reason: 'peak' } : { kind: 'off', reason: 'weekday-off' };
		}

		/**
		 * 下一次「峰↔谷」切换的绝对时间。
		 *
		 * 状态只可能在 00:00 / 09:00 / 12:00 / 14:00 / 18:00（北京时间）这几个整点变，
		 * 所以只枚举候选点，不逐分钟扫。
		 *
		 * @param {number} nowMs - 现在。
		 * @param {'peak' | 'off'} currentKind - 当前状态。
		 * @returns {number | null} 下一次切换的时间；找不到时 null。
		 */
		function nextSwitch(nowMs, currentKind) {
			const parts = beijingParts(nowMs);
			for (let offset = 0; offset <= SEARCH_DAYS; offset += 1) {
				for (let i = 0; i < BOUNDARY_MINUTES.length; i += 1) {
					const at = beijingInstant(parts.y, parts.m, parts.day + offset, BOUNDARY_MINUTES[i]);
					if (at > nowMs && periodAt(at).kind !== currentKind) return at;
				}
			}
			return null;
		}

		/**
		 * 剩余时长 → `01:23:45`，超过一天时前缀天数。
		 *
		 * @param {number} ms - 剩余毫秒。
		 * @returns {string} 倒计时文本。
		 */
		function formatDuration(ms) {
			const total = Math.max(0, Math.floor(ms / 1000));
			const days = Math.floor(total / 86400);
			const hours = Math.floor((total % 86400) / 3600);
			const minutes = Math.floor((total % 3600) / 60);
			const seconds = total % 60;
			const clock = pad2(hours) + ':' + pad2(minutes) + ':' + pad2(seconds);
			return days > 0 ? days + t('day') + ' ' + clock : clock;
		}
		// #endregion

		// #region styles
		const CSS = [
			'.pv-chip{position:relative;display:inline-flex;align-items:center;gap:6px;padding:1px 8px;border-radius:var(--dsw-radius-sm);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;font-variant-numeric:tabular-nums;flex:none;cursor:default}',
			// 灯的取色走 --pv-lamp：用状态色原色（红 #ec1313 / 绿 #22c55e），不掺灰，够艳。
			'.pv-chip{--pv-lamp:var(--dsw-alias-state-success-primary,#22c55e)}',
			// 文字另算：状态色压深一档，浅色背景上 13px 才读得清（灯不必管可读性）。
			'.pv-chip.pv-peak{--pv-lamp:var(--dsw-alias-state-error-primary,#ec1313);color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ec1313) 80%,var(--dsw-alias-label-primary,#1f2328))}',
			'.pv-chip.pv-off{--pv-lamp:var(--dsw-alias-state-success-primary,#22c55e);color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 70%,var(--dsw-alias-label-primary,#1f2328))}',
			// 灯体：7px 圆点 + 外面一圈同色的光晕，两段动画错开节奏做「呼吸」。
			'.pv-dot{position:relative;flex:none;width:7px;height:7px;border-radius:50%;background:var(--pv-lamp,#22c55e);box-shadow:0 0 6px 1px var(--pv-lamp,#22c55e);animation:pv-breathe 2.6s ease-in-out infinite}',
			'.pv-dot:after{content:"";position:absolute;inset:-2px;border-radius:50%;background:var(--pv-lamp,#22c55e);animation:pv-halo 2.6s ease-in-out infinite}',
			'@keyframes pv-breathe{0%,100%{opacity:.55;box-shadow:0 0 3px 0 var(--pv-lamp,#22c55e)}50%{opacity:1;box-shadow:0 0 12px 2px var(--pv-lamp,#22c55e)}}',
			'@keyframes pv-halo{0%,100%{transform:scale(.55);opacity:0}45%{transform:scale(1.45);opacity:.45}70%{transform:scale(1.95);opacity:0}}',
			// 关了动效就退化成一颗常亮的灯，不留黑洞。
			'@media (prefers-reduced-motion:reduce){.pv-dot{animation:none;opacity:1;box-shadow:0 0 8px 1px var(--pv-lamp,#22c55e)}.pv-dot:after{display:none}}',
			'.pv-period{font-weight:500}',
			'.pv-gap{color:var(--dsw-alias-label-tertiary,#9aa0a6)}',
			'.pv-text{color:var(--dsw-alias-label-secondary,#5f6673)}',
			'.pv-tip{position:absolute;bottom:calc(100% + 8px);left:50%;z-index:30;display:flex;flex-direction:column;gap:2px;width:max-content;max-width:min(420px,calc(100vw - 32px));padding:6px 9px;border-radius:8px;background:var(--dsw-alias-tooltip-bg,rgba(24,28,36,.94));color:var(--dsw-alias-toast-label,#fff);box-shadow:var(--dsw-shadow-lv3,0 4px 12px rgba(0,0,0,.18));font-size:12px;line-height:1.5;text-align:left;opacity:0;pointer-events:none;transform:translate(-50%,2px);transition:opacity .12s ease,transform .12s ease}',
			'.pv-chip:hover .pv-tip{opacity:1;transform:translate(-50%,0)}',
			// 输入框下方那一行是宿主的 flex 车道（不换行、居中），条目一多、屏一窄就会
			// 顶出卡片外。这里只允许它换行——一行放得下时换行不产生任何变化。
			'[data-composer-dock]{flex-wrap:wrap;row-gap:2px}',
			// 窄屏：字号收一档，提示气泡改成右对齐（否则靠近右边缘时会被切掉）。
			'@media (max-width:767px){.pv-chip{font-size:12px;padding:0 6px;gap:4px}.pv-tip{left:auto;right:0;transform:translate(0,2px);max-width:calc(100vw - 24px)}.pv-chip:hover .pv-tip{transform:translate(0,0)}}'
		].join('\n');
		// #endregion

		/**
		 * 是否是窄屏（和 dsh-web-mobile 用同一个断点）。
		 *
		 * 只影响文字长短：窄屏把「峰时 · 」这段省掉，只留「距峰时 00:45:12」。
		 *
		 * @returns {boolean} 窄屏为 true。
		 */
		function useNarrow() {
			const query = '(max-width: 767px)';
			const [narrow, setNarrow] = React.useState(() => (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
				? window.matchMedia(query).matches
				: false);
			React.useEffect(() => {
				if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
				const media = window.matchMedia(query);
				const onChange = () => setNarrow(media.matches);
				onChange();
				media.addEventListener('change', onChange);
				return () => media.removeEventListener('change', onChange);
			}, []);
			return narrow;
		}

		// #region 组件
		/**
		 * 一行小字：`● 峰时 · 距谷时 01:23:45`，悬停出规则说明。
		 *
		 * @returns {any} React 元素。
		 */
		function Chip() {
			const [now, setNow] = React.useState(() => Date.now());

			React.useEffect(() => {
				const timer = setInterval(() => setNow(Date.now()), 1000);
				return () => clearInterval(timer);
			}, []);

			const narrow = useNarrow();
			const current = periodAt(now);
			const peak = current.kind === 'peak';
			const target = nextSwitch(now, current.kind);
			const remaining = target === null ? null : formatDuration(target - now);

			let todayKey = 'todayWorkday';
			let todayParams;
			if (current.reason === 'weekend') todayKey = 'todayWeekend';
			else if (current.reason === 'holiday') {
				todayKey = 'todayHoliday';
				todayParams = { name: current.name };
			}

			return h('div', {
				className: 'pv-chip ' + (peak ? 'pv-peak' : 'pv-off'),
				role: 'status',
				'aria-live': 'off',
				'aria-label': (peak ? t('peak') : t('off')) + ' ' + t(peak ? 'toOff' : 'toPeak') + ' ' + (remaining === null ? t('idle') : remaining)
			},
				h('span', { className: 'pv-dot' }),
				narrow ? null : h('span', { className: 'pv-period' }, peak ? t('peak') : t('off')),
				narrow ? null : h('span', { className: 'pv-gap' }, '·'),
				h('span', { className: 'pv-text' },
					(peak ? t('toOff') : t('toPeak')) + ' ' + (remaining === null ? t('idle') : remaining)
				),
				h('span', { className: 'pv-tip', role: 'tooltip' },
					h('span', null, t('rule')),
					h('span', null, t(todayKey, todayParams))
				)
			);
		}
		// #endregion

		const inject = ['slots', 'locale'];

		/**
		 * 挂载客户端。
		 *
		 * @param {any} ctx - 客户端上下文。
		 */
		function apply(ctx) {
			ctx.effect(() => {
				if (typeof document === 'undefined') return undefined;
				document.querySelectorAll('style[data-plugin="' + NS + '"]').forEach((node) => node.remove());
				const style = document.createElement('style');
				style.dataset.plugin = NS;
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => { style.remove(); };
			}, 'dsh-peak-valley: styles');

			if (ctx.locale !== undefined && ctx.locale !== null) {
				try {
					const active = typeof ctx.locale.getLocale === 'function' ? ctx.locale.getLocale() : undefined;
					const id = active !== null && active !== undefined && typeof active.id === 'string' ? active.id : '';
					if (/^zh/i.test(id)) fallbackLang = 'zh';
					else if (/^en/i.test(id)) fallbackLang = 'en';
				} catch {
					/* 用 navigator 猜的 */
				}

				ctx.effect(() => {
					let offZh;
					let offEn;
					try {
						offZh = ctx.locale.register(NS, 'zh', zh);
						offEn = ctx.locale.register(NS, 'en', en);
					} catch (error) {
						console.error('[dsh-peak-valley] locale register failed', error);
						return undefined;
					}
					try {
						bound = ctx.locale.bind(NS);
					} catch {
						bound = null;
					}
					return () => {
						if (typeof offZh === 'function') offZh();
						if (typeof offEn === 'function') offEn();
					};
				}, 'dsh-peak-valley: dictionaries');
			}

			if (ctx.slots === undefined || ctx.slots === null) {
				console.error('[dsh-peak-valley] no slots service; the dock chip is not registered');
				return;
			}

			ctx.effect(() => {
				try {
					return ctx.slots.inject('conversation.composer.dock', function* () {
						yield ctx.slots.register({
							name: 'conversation.composer.dock',
							id: 'dsh-peak-valley',
							order: 999,
							locale: NS
						}, function () {
							return h(Chip, {});
						});
					});
				} catch (error) {
					console.error('[dsh-peak-valley] dock chip registration failed', error);
					return () => {};
				}
			}, 'dsh-peak-valley: dock chip');
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
