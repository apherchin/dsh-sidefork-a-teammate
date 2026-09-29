window.__ModuleLoader__.load({
	id: "dsh-sidefork-a-teammate",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		// ⛔ **刻意不 require 任何 Harness Client 包。**
		// 官方 `cordis-plugin-development` 的 practices 明文禁止（原文：
		// "Do not `require('@deepseek-ai/dsh-client-ui-primitives')` or load any other
		//  Harness Client package as a module"）。理由不是"拿不到"——那 9 个 specifier 确实
		// 在平台静态种子表里能解析——而是**升级稳定性**：它们会无预告变更、纯 JS 插件没有
		// 类型检查，而**抛错的组件会让整块 slot entry 空白**（Console: `slot entry crashed`）。
		// 所以下面 3 个原语 + 1 个 store 都是**按行为照抄进本插件的自包含实现**：
		// 路径数据、CSS 规则、每一条 `--dsw-alias-*` / `--dsw-*` token 引用都与
		// `dsh-client-ui-primitives/lib/index.js` 与 `lib/{Button,Modal}.module.css` 一致，
		// 类名统一加本插件前缀 `dstc-`（官方建议："Rename copied classes under your plugin's prefix"）。
		// React 与 React DOM 来自浏览器模块表（基座），不是 Harness Client 包，可以正常 require。
		//
		// 与 dsh-session-delete 同构（那边已用 256 条断言钉住这套自包含原语）。
		/** 依赖解析失败时的降级出口：一个合法的 no-op 插件对象（entry 仍 active，整机不受影响）。 */
		const degradeToNoop = () => {
			exports.name = "team-commands-client";
			exports.inject = [];
			exports.apply = () => {};
		};

		// React / React DOM 是浏览器模块表（基座）提供的，不属于 Harness Client 包 ⇒ 正常 require；
		// 但**基座缺失时也必须降级而不是抛错**（抛错 = client entry `failed` = 整机起不来）。
		let react = null;
		let jsxRuntime = null;
		try {
			react = require("react");
			jsxRuntime = require("react/jsx-runtime");
		} catch (error) {
			console.error("[team-commands] react 基座解析失败（插件降级为 no-op，不影响启动）：", error);
			degradeToNoop();
			return module.exports;
		}

		const jsx = jsxRuntime.jsx;
		const jsxs = jsxRuntime.jsxs;
		const Fragment = jsxRuntime.Fragment;

		/**
		 * `react-dom` 的 `createPortal`：**必须 try/catch**。
		 * 弹窗原本经官方 `Modal` 内部 portal 到 `document.body`（保持层叠不被祖先的
		 * transform/overflow 影响）；拿不到就**就地渲染**降级 —— 绝不允许一条 require
		 * 把 factory 打穿（那会变成 client entry `failed` ⇒ 撞 web boot 全有全无门禁 ⇒ 整机起不来）。
		 */
		let createPortal = null;
		try {
			const reactDom = require("react-dom");
			if (reactDom !== null && reactDom !== void 0 && typeof reactDom.createPortal === "function") createPortal = reactDom.createPortal;
		} catch (error) {
			// **静默降级**：拿不到 react-dom 只意味着弹窗就地渲染（外观/行为一致，
			// 只有层叠上下文略有差别），不是异常。这里刻意**不**打日志。
			createPortal = null;
		}
		/** 样式表当前是否已注入（只给离线探针 `__clientDiagnostics()` 用；不影响运行时行为）。 */
		let stylesInjected = false;

		//#region 自包含原语（照抄官方；只共享设计 token）
		/** 本插件的样式表：一次性注入 `document.head`，类名全部带 `dstc-` 前缀。 */
		const CLIENT_STYLE_TEXT = `
.dstc-btn { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 4px; border: none; border-radius: var(--dsw-radius-md); cursor: pointer; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); background: transparent; padding: 0 14px; }
.dstc-btn:disabled { cursor: not-allowed; opacity: 0.4; }
.dstc-btn-md { height: 36px; }
.dstc-btn-sm { height: 28px; font-size: 12px; line-height: 18px; padding: 0 10px; border-radius: var(--dsw-radius-sm); }
.dstc-btn-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
.dstc-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dstc-btn-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dstc-btn-ghost:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }
.dstc-btn-outline { border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; }
.dstc-btn-outline:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dstc-btn-icon { display: inline-flex; width: 16px; height: 16px; align-items: center; justify-content: center; }
.dstc-modal-root { pointer-events: auto; position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: max(24px, var(--dsh-frame-top-clearance, 24px)) 24px; }
.dstc-modal-mask { position: absolute; inset: 0; backdrop-filter: var(--dsw-mask-blur); }
.dstc-modal-mask::after { content: ''; position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-1); animation: dstcModalEnter var(--ds-transition-duration) var(--ds-ease-in-out); }
.dstc-modal-dialog { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 20px; width: min(380px, 100%); padding: 0 0 24px; overflow: hidden; border: 0; border-radius: var(--dsw-radius-panel); background: var(--dsw-alias-bg-layer-2); box-shadow: var(--dsw-elevation-prominent); animation: dstcModalEnter var(--ds-transition-duration) var(--ds-ease-in-out); }
.dstc-modal-dialog:focus { outline: none; }
@keyframes dstcModalEnter { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .dstc-modal-mask::after, .dstc-modal-dialog { animation: none; } }
.dstc-modal-content { display: flex; flex-direction: column; width: 100%; }
.dstc-modal-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 22px 14px 12px 24px; }
.dstc-modal-title { margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dstc-modal-close { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: var(--dsw-radius-sm); background: transparent; cursor: pointer; color: var(--dsw-alias-label-secondary); }
.dstc-modal-close:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dstc-modal-description { margin: 0; padding: 0 24px; font-size: 14px; line-height: 22px; font-weight: 400; color: var(--dsw-alias-label-primary); }
.dstc-modal-body { display: flex; flex-direction: column; min-width: 0; margin-top: 20px; padding: 0 24px; }
.dstc-modal-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 0 24px; }
`;

		/** 官方 `IconCloseOutlineRegular` 的等价实现（两条对角线照抄）。 */
		function IconCloseOutlineRegular({ size = 16 }) {
			return jsxs("svg", {
				width: size, height: size, viewBox: "0 0 16 16", fill: "none",
				xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", strokeWidth: 1,
				children: [
					jsx("path", { d: "M2.5 2.5L13.5 13.5", stroke: "currentColor" }),
					jsx("path", { d: "M13.5 2.5L2.5 13.5", stroke: "currentColor" })
				]
			});
		}

		/** 官方 `IconUsersOutlineRegular` 的等价实现（4 条 path 与 stroke-width 逐字照抄）。 */
		function IconUsersOutlineRegular({ size = 16 }) {
			return jsxs("svg", {
				width: size, height: size, viewBox: "0 0 16 16", fill: "none",
				xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", strokeWidth: 1,
				children: [
					jsx("path", { d: "M6 8.25C7.51878 8.25 8.75 7.01878 8.75 5.5C8.75 3.98122 7.51878 2.75 6 2.75C4.48122 2.75 3.25 3.98122 3.25 5.5C3.25 7.01878 4.48122 8.25 6 8.25Z", stroke: "currentColor" }),
					jsx("path", { d: "M1 14.5C1 11.5 3.5 10.25 6 10.25C8.5 10.25 11 11.5 11 14.5", stroke: "currentColor" }),
					jsx("path", { d: "M10.5 2.9C11.65 3.35 12.45 4.35 12.45 5.5C12.45 6.65 11.65 7.65 10.5 8.1", stroke: "currentColor" }),
					jsx("path", { d: "M12.4 10.6C13.9 11.3 15 12.6 15 14.5", stroke: "currentColor" })
				]
			});
		}

		/** 官方 `Button` 的等价实现（变体/尺寸的类名与 CSS 规则一一对应）。 */
		function Button({ variant = "ghost", size = "md", icon, className, children, style, ...rest }) {
			const classes = ["dstc-btn", `dstc-btn-${variant}`, size === "sm" ? "dstc-btn-sm" : "dstc-btn-md"];
			if (typeof className === "string" && className.length > 0) classes.push(className);
			return jsxs("button", {
				...rest,
				type: rest.type === void 0 ? "button" : rest.type,
				className: classes.join(" "),
				style,
				children: [
					icon !== void 0 && jsx("span", { className: "dstc-btn-icon", children: icon }),
					children
				]
			});
		}

		/**
		 * 官方 `useModalLayer` 的等价行为：Escape 关闭、Tab 在弹窗内循环、
		 * 打开时聚焦 `[data-modal-autofocus]`（找不到就聚焦卡片本身），关闭时把焦点还回去。
		 * 只用 `document` 级 keydown（capture），不依赖任何外部层管理器。
		 */
		function useModalLayer(dialogRef, open, onClose) {
			react.useEffect(() => {
				if (open !== true) return void 0;
				const onKeyDown = (event) => {
					try {
						if (event.key === "Escape") {
							event.stopPropagation();
							onClose();
							return;
						}
						if (event.key !== "Tab") return;
						const node = dialogRef.current;
						if (node === null || node === void 0) return;
						const focusables = Array.from(node.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'));
						if (focusables.length === 0) {
							event.preventDefault();
							try { node.focus(); } catch (error) { /* 聚焦失败不影响键盘关闭 */ }
							return;
						}
						const first = focusables[0];
						const last = focusables[focusables.length - 1];
						const active = document.activeElement;
						const inside = node.contains(active);
						if (event.shiftKey && (active === first || !inside)) {
							event.preventDefault();
							try { last.focus(); } catch (error) { /* 同上 */ }
						} else if (!event.shiftKey && (active === last || !inside)) {
							event.preventDefault();
							try { first.focus(); } catch (error) { /* 同上 */ }
						}
					} catch (error) {
						// 键盘处理绝不允许打穿到 React 渲染层
						console.error("[team-commands] 弹窗键盘处理失败（已忽略）：", error);
					}
				};
				document.addEventListener("keydown", onKeyDown, true);
				let restore = null;
				try {
					restore = document.activeElement;
					const node = dialogRef.current;
					const target = node === null || node === void 0 ? null : node.querySelector("[data-modal-autofocus]");
					if (target !== null && target !== void 0 && typeof target.focus === "function") target.focus();
					else if (node !== null && node !== void 0 && typeof node.focus === "function") node.focus();
				} catch (error) {
					console.warn("[team-commands] 弹窗初始聚焦失败（不影响显示）：", error);
				}
				return () => {
					document.removeEventListener("keydown", onKeyDown, true);
					try {
						if (restore !== null && restore !== void 0 && typeof restore.focus === "function" && document.contains(restore)) restore.focus();
					} catch (error) { /* 还焦点失败无害 */ }
				};
			}, [open, onClose]);
		}

		/**
		 * 官方 `Modal` 的等价实现（同样的 DOM 结构与类名语义、同样的 props 子集）。
		 * 支持本插件用到的 `open / onClose / title / closeLabel / description / footer / children`。
		 */
		function Modal({ open, onClose, title, closeLabel, description, children, footer }) {
			const dialog = react.useRef(null);
			useModalLayer(dialog, open, onClose);
			if (open !== true) return null;
			const tree = jsxs("div", {
				className: "dstc-modal-root",
				role: "presentation",
				children: [
					jsx("div", { className: "dstc-modal-mask", "aria-hidden": "true", onClick: onClose }),
					jsxs("div", {
						ref: dialog,
						tabIndex: -1,
						className: "dstc-modal-dialog",
						role: "dialog",
						"aria-modal": "true",
						"aria-label": title,
						children: [
							jsxs("div", {
								className: "dstc-modal-content",
								children: [
									jsxs("div", {
										className: "dstc-modal-header",
										children: [
											jsx("h2", { className: "dstc-modal-title", children: title }),
											jsx("button", {
												type: "button",
												className: "dstc-modal-close",
												"aria-label": closeLabel,
												onClick: onClose,
												children: jsx(IconCloseOutlineRegular, { size: 14 })
											})
										]
									}),
									description !== void 0 && description !== "" && jsx("p", { className: "dstc-modal-description", children: description }),
									children !== void 0 && jsx("div", { className: "dstc-modal-body", children })
								]
							}),
							footer !== void 0 && jsx("div", { className: "dstc-modal-footer", children: footer })
						]
					})
				]
			});
			// 有 portal 就挂到 body（避免被祖先的 transform/overflow 影响）；
			// 拿不到 react-dom 时就地渲染（外观/行为一致，只有层叠上下文略有差别）。
			if (createPortal !== null) {
				try {
					return createPortal(tree, document.body);
				} catch (error) {
					// **静默降级**为就地渲染（`document` 缺失等环境问题不是异常，不该刷日志）。
					return tree;
				}
			}
			return tree;
		}

		/**
		 * 官方 `createSnapshotStore` 的等价实现（原在 `@deepseek-ai/dsh-client-store`）。
		 * **接口必须逐字一致**：`{ getSnapshot, subscribe, update, set }` ——
		 * 因为 `inject: () => ({ hooks: { teammate: store } })` 里的每个值都会被 renderer
		 * 当作外部 store 包成 `useTeammate` hook（uSES 读 `getSnapshot`、订阅 `subscribe`）。
		 * `subscribe(fn)` 的回调**不带参数**；`getSnapshot()` 在两次变更之间必须是**同一个引用**。
		 */
		function createSnapshotStore(initial) {
			let state = initial;
			const listeners = new Set();
			const emit = () => {
				for (const listener of Array.from(listeners)) {
					try {
						listener();
					} catch (error) {
						// 一个订阅者抛错不许连累其他订阅者与调用方
						console.error("[team-commands] store 订阅回调抛出（已忽略）：", error);
					}
				}
			};
			return {
				getSnapshot: () => state,
				subscribe: (fn) => {
					listeners.add(fn);
					return () => {
						listeners.delete(fn);
					};
				},
				update: (mutator) => {
					const draft = state !== null && typeof state === "object" ? Object.assign({}, state) : state;
					try {
						mutator(draft);
					} catch (error) {
						console.error("[team-commands] store.update 的 mutator 抛出（状态未变）：", error);
						return;
					}
					state = draft;
					emit();
				},
				set: (next) => {
					state = next;
					emit();
				}
			};
		}
		//#endregion

		//#region 契约常量
		/**
		 * 宿主当前**唯一**提供的路由：`POST /api/team.spawn`。
		 * 请求体 `{ sessionId, context: "fresh"|"fork", line: "名字 | 描述 | 任务" }`，
		 * 响应 `{ ok:true, name, sessionId }` 或 `{ ok:false, code, message }`。
		 * ⚠️ 宿主命令 `newteam` / `forkteam` 已被删除 —— 菜单里只剩这一个 `/teammate`。
		 */
		const SPAWN_PATH = "/api/team.spawn";
		/** overlay 槽位：`kind: "list"`, `scope: "root"`（与官方 archiveConfirm 同构）。 */
		const OVERLAY_SLOT = "shell.overlay";
		/** 两种 context 的中文说明（键名与请求体字段一一对应）。 */
		const CONTEXT_DETAIL = {
			fresh: "全新对话，不继承本会话历史",
			fork: "并行分支，继承本会话已完成的回合",
		};
		/** 输入框占位符：三段的顺序（名字 / 描述 / 任务）由宿主解析。 */
		const PLACEHOLDER = "名字(可留空) | 描述 | 任务";
		const ERROR_COLOR = "var(--dsw-alias-state-error-primary)";
		const ERROR_STYLE = {
			margin: "8px 0 0",
			color: ERROR_COLOR,
			fontSize: 13,
			lineHeight: "20px",
			overflowWrap: "anywhere"
		};
		const OK_STYLE = {
			margin: "8px 0 0",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 13,
			lineHeight: "20px",
			overflowWrap: "anywhere"
		};
		const BUSY_STYLE = {
			margin: "8px 0 0",
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: 13,
			lineHeight: "20px"
		};
		const INPUT_STYLE = {
			width: "100%",
			boxSizing: "border-box",
			padding: "6px 8px",
			fontSize: 13,
			lineHeight: "20px",
			color: "var(--dsw-alias-label-primary)",
			background: "transparent",
			border: "1px solid var(--dsw-alias-label-tertiary)",
			borderRadius: 6
		};
		//#endregion

		/** 取 context 的中文说明；未知值一律按 `fresh` 处理（防原型链：用 hasOwn）。 */
		function contextDetail(context) {
			const key = typeof context === "string" && Object.hasOwn(CONTEXT_DETAIL, context) ? context : "fresh";
			return CONTEXT_DETAIL[key];
		}

		/** 造一个带 `.code` 的错误（`.code` 是离线验证台与 UI 都认的判据）。 */
		function spawnError(code, message) {
			const text = typeof message === "string" && message.length > 0 ? message : String(code);
			const error = new Error(text);
			error.code = code;
			return error;
		}

		/** 把任意 rejection 归一成一句可读文案（优先 `.message`，其次 `.code`）。 */
		function messageOf(reason) {
			if (reason instanceof Error) {
				if (typeof reason.message === "string" && reason.message.length > 0) return reason.message;
				if (reason.code !== undefined && reason.code !== null) return String(reason.code);
				return "创建失败，请稍后重试";
			}
			const text = reason === undefined || reason === null ? "" : String(reason);
			return text.length > 0 ? text : "创建失败，请稍后重试";
		}

		/**
		 * 提交一次创建请求（独立函数，便于离线验证台直接调用）。
		 *
		 * 契约：JSON 解析失败按 `HTTP_<status>` 处理；`payload.ok !== true` ⇒ 抛带 `.code`
		 * 的 Error，message 取 `payload.message || payload.code`；成功返回 payload 本身。
		 * 本函数**只**抛错、不改任何状态，UI 侧的 try/catch 负责显示。
		 *
		 * @param {{ sessionId?: unknown, context?: unknown, line?: unknown }} request - 请求体。
		 * @returns {Promise<object>} 成功响应体。
		 */
		async function postTeamSpawn({ sessionId, context, line }) {
			const response = await fetch(SPAWN_PATH, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ sessionId, context, line })
			});
			let payload = null;
			try {
				payload = await response.json();
			} catch (error) {
				// 非 JSON（含 5xx 的 HTML 错误页）⇒ 统一按 HTTP 状态码处理。
				payload = null;
			}
			if (payload === null || typeof payload !== "object") {
				const code = `HTTP_${response.status}`;
				throw spawnError(code, code);
			}
			if (payload.ok !== true) {
				const code = payload.code === undefined || payload.code === null ? `HTTP_${response.status}` : payload.code;
				throw spawnError(code, payload.message || code);
			}
			return payload;
		}

		/** overlay 拿不到弹窗数据源时的兜底：永远"没有弹窗"。 */
		function readNoDialog() {
			return null;
		}

		/**
		 * 一次性注入样式表（类名前缀 `dstc-`）。
		 * **静默**：拿不到 `document` 或注入失败都只返回 false，绝不刷日志、绝不外抛。
		 * @returns {boolean} 样式当前是否可用。
		 */
		function injectStyles() {
			if (stylesInjected) return true;
			try {
				if (typeof document === "undefined" || document === null) return false;
				const styleId = "dsh-plugin-sidefork-a-teammate-styles";
				if (document.getElementById(styleId) !== null) {
					stylesInjected = true;
					return true;
				}
				const host = document.head !== undefined && document.head !== null ? document.head : document.documentElement;
				if (host === undefined || host === null || typeof host.appendChild !== "function") return false;
				const style = document.createElement("style");
				style.id = styleId;
				style.textContent = CLIENT_STYLE_TEXT;
				host.appendChild(style);
				stylesInjected = true;
				return true;
			} catch (error) {
				// 注入失败只意味着"看起来朴素一点"，不是异常路径
				return false;
			}
		}

		/**
		 * `shell.overlay` 的唯一 entry：只负责按 store 状态挂载弹窗，store 为 `null` 时返回 `null`。
		 * ⚠️ `readDialog`（即 owner 给的 `useTeammate`）**必须无条件调用**，返回值判断放在其后，
		 * 否则会违反 hooks 调用次序。
		 */
		function TeammateOverlay(props) {
			const readDialog = typeof props.useTeammate === "function" ? props.useTeammate : readNoDialog;
			const dialog = readDialog((pending) => pending);
			if (dialog === null || dialog === undefined || dialog.open !== true) return null;
			return jsx(TeammateDialog, { dialog, store: props.store });
		}

		/**
		 * 创建 teammate 的弹窗本体：受控输入框 + 错误行 / 成功行 + 「创建」「取消」。
		 *
		 * 收尾方式（二选一，这里取**更简单的**一种）：成功后**不**自动关闭 —— 保留成功行让用户看
		 * 到 `name` 与 `sessionId`（这是唯一能看到新会话 id 的地方），由「关闭」（`Modal` 的 × / Esc /
		 * 遮罩）或 footer 的按钮收尾；成功后按钮文案从「取消」变「关闭」、同时「创建」键禁用。
		 */
		function TeammateDialog(props) {
			const dialog = props.dialog;
			const store = props.store;
			const [text, setText] = react.useState(typeof dialog.line === "string" ? dialog.line : "");
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState(null);
			const [result, setResult] = react.useState(null);
			const done = result !== null;

			// 每次「打开一个新弹窗」（`onSelect` 换掉 store 里的对象）都把本地输入与结果复位。
			react.useEffect(() => {
				setText(typeof dialog.line === "string" ? dialog.line : "");
				setBusy(false);
				setError(null);
				setResult(null);
			}, [dialog]);

			/** 关闭 = 清空 store（overlay entry 随之渲染 `null`，弹窗卸载）。 */
			const close = () => {
				try {
					if (store !== undefined && store !== null && typeof store.set === "function") store.set(null);
				} catch (cause) {
					console.error("[team-commands] 关闭创建 teammate 弹窗失败（不影响其它功能）：", cause);
				}
			};

			/** 提交：成功落成功行，失败落错误行；任何异常都不许打穿渲染。 */
			const submit = async () => {
				if (busy || done) return;
				setBusy(true);
				setError(null);
				try {
					const payload = await postTeamSpawn({
						sessionId: dialog.sessionId,
						context: dialog.context,
						line: text
					});
					setResult({
						name: typeof payload.name === "string" ? payload.name : "",
						sessionId: payload.sessionId === undefined || payload.sessionId === null ? "" : String(payload.sessionId)
					});
				} catch (cause) {
					setError(messageOf(cause));
				} finally {
					setBusy(false);
				}
			};

			const body = [jsx("input", {
				type: "text",
				value: text,
				placeholder: PLACEHOLDER,
				style: INPUT_STYLE,
				onChange: (event) => setText(event.target.value),
				onKeyDown: (event) => {
					if (event.key !== "Enter") return;
					event.preventDefault();
					void submit();
				}
			}, "line")];
			if (error !== null) body.push(jsx("p", {
				role: "alert",
				style: ERROR_STYLE,
				children: `创建失败：${error}`
			}, "error"));
			if (result !== null) body.push(jsx("p", {
				role: "status",
				"aria-live": "polite",
				style: OK_STYLE,
				children: `已创建 teammate "${result.name}"（会话 ${result.sessionId}）`
			}, "result"));
			if (busy) body.push(jsx("p", { style: BUSY_STYLE, children: "正在创建…" }, "busy"));

			return jsxs(Modal, {
				open: true,
				onClose: close,
				closeLabel: "关闭",
				title: "创建 teammate",
				// 副标题 = 当前 context 的中文说明（new / fork）。
				description: contextDetail(dialog.context),
				footer: jsxs(Fragment, { children: [jsx(Button, {
					variant: "outline",
					disabled: busy,
					// 默认焦点：Modal 的 `useModalLayer` 先找 `[data-modal-autofocus]`（React 的 autoFocus 早于该层）。
					"data-modal-autofocus": true,
					onClick: close,
					children: done ? "关闭" : "取消"
				}, "cancel"), jsx(Button, {
					// 两个按钮都用 `outline`：与 dsh-session-delete 里实测可用的写法保持一致。
					variant: "outline",
					style: done ? void 0 : { color: "var(--dsw-alias-label-primary)" },
					disabled: busy || done,
					onClick: () => {
						void submit();
					},
					children: done ? "已创建" : "创建"
				}, "create")] }),
				children: body
			});
		}

		/**
		 * 注册 `/teammate` 的 popupSelect 贡献项。
		 * @param scope - 注入了 commandUi 的作用域。
		 * @param store - 共享的弹窗 store（`null` = 无弹窗）。
		 */
		function registerCommand(scope, store) {
			const command = scope.get("commandUi");
			if (command === undefined) throw new Error("ui-commands 未就绪");
			scope.effect(
				() =>
					command.register({
						name: "teammate",
						// 菜单行的呈现规则（ui-commands）：本地化标题与命令名不同时，把命令名作为别名一并显示
						// ⇒ 用户看到的是「唤醒组员 teammate」。
						label: () => "唤醒组员",
						description: () => "唤醒一个组员：new（全新对话）或 fork（并行分支）",
						icon: IconUsersOutlineRegular,
						available: () => true,
						ui: {
							kind: "popupSelect",
							// ⚠️ **必须 async（即返回 thenable）**：官方 `ui-commands/lib/client.js:435` 的
							// `load()` 是 `binding.spec.options(ctx, signal).then(...)` —— 直接对返回值调
							// `.then`。裸数组没有 `.then` ⇒ load() 同步抛 ⇒ 弹窗永远停在「正在加载选项…」。
							// 官方先例见 ui-model-selection 的 `options: async (session) => optionsOf(...)`。
							options: async () => [
								{ id: "new", label: "new teammate", detail: "全新对话，不继承本会话历史" },
								{ id: "fork", label: "fork teammate", detail: "并行分支，继承本会话已完成的回合" }
							],
							// 选中只是**打开弹窗**：真正的创建请求由 overlay 里的弹窗发起。
							onSelect: (option, session) => {
								try {
									store.set({
										open: true,
										context: option?.id === "fork" ? "fork" : "fresh",
										sessionId: session?.sessionId,
										line: "",
										error: null,
										result: null
									});
								} catch (cause) {
									console.error("[team-commands] 打开创建 teammate 弹窗失败（不影响其它功能）：", cause);
								}
							}
						}
					}),
				"team-commands: /teammate"
			);
		}

		/**
		 * 注册 `shell.overlay` 槽位条目（创建 teammate 弹窗）。
		 * @param scope - 注入了 slots 的作用域。
		 * @param store - 共享的弹窗 store。
		 */
		function registerOverlay(scope, store) {
			scope.slots.inject(OVERLAY_SLOT, function* () {
				try {
					yield scope.slots.register(
						{
							name: OVERLAY_SLOT,
							id: "team-commands-create-teammate",
							inject: () => ({
								// hooks 会被展开成 props.useTeammate（owner 侧的订阅钩子）。
								hooks: { teammate: store },
								store
							})
						},
						TeammateOverlay
					);
				} catch (error) {
					// 宿主重新声明槽位时经 queueMicrotask 抛错（ui-renderer/lib/client.js:1376-1390），
					// apply 的同步 try/catch 抓不到 ⇒ 这里兜底，避免未捕获异步异常。
					console.error(`[team-commands] ${OVERLAY_SLOT} 弹窗槽位注册失败（仅少一个创建弹窗）：`, error);
				}
			});
		}

		/**
		 * 真正的接线主体：服务一律走**嵌套** `ctx.inject`，每处注册各自 try/catch。
		 * @param ctx - 客户端插件上下文。
		 */
		function applyTeamCommandsClient(ctx) {
			// 样式注入（**自包含 CSS**，不再依赖 ui-primitives 的 module.css）：
			// 拿不到 `ctx.effect` 就同步注入一次；两条路都**静默**，失败只意味着外观朴素。
			try {
				if (typeof ctx.effect === "function") ctx.effect(() => { injectStyles(); return () => {}; });
				else injectStyles();
			} catch (error) {
				/* 静默：样式注入失败不影响功能 */
			}

			/** 弹窗状态：`null` = 关闭；`{ open, context, sessionId, line, error, result }` = 打开。 */
			const store = createSnapshotStore(null);

			try {
				ctx.inject(["commandUi"], (scope) => {
					try {
						registerCommand(scope, store);
					} catch (error) {
						console.error("[team-commands] /teammate 注册失败（仅少一个菜单项，不影响启动）：", error);
					}
				});
			} catch (error) {
				console.error("[team-commands] commandUi 注入失败（仅少一个菜单项，不影响启动）：", error);
			}

			try {
				ctx.inject(["slots"], (scope) => {
					try {
						registerOverlay(scope, store);
					} catch (error) {
						console.error("[team-commands] 创建弹窗槽位注册失败（仅少一个弹窗，不影响启动）：", error);
					}
				});
			} catch (error) {
				console.error("[team-commands] slots 注入失败（创建弹窗不出现，不影响启动）：", error);
			}
		}

		exports.name = "team-commands-client";
		// ⛔ **不挂任何硬门禁**（`inject` 留空）。渲染端的 web boot 门禁是**全有全无**的：
		// 对 `pending`（等服务）与 `failed`（apply 抛错）一视同仁 ⇒ 一旦服务未就绪，整个应用起不来。
		// 服务一律走嵌套 `ctx.inject([...], (scope) => …)`：外层 entry 立刻 active，最坏只是"这块 UI 不出现"。
		exports.inject = [];

		/** apply 的**最外层**包装：任何异常都只 `console.error` 后正常返回（漏出去 = 撞启动门禁）。 */
		exports.apply = function apply(ctx) {
			try {
				applyTeamCommandsClient(ctx);
			} catch (error) {
				console.error("[team-commands] apply 抛出异常，已吞掉（避免整个应用启动失败）：", error);
			}
		};

		/** ⚠️ 仅供离线验证台（verify-client.mjs）使用，不属于插件公开 API。 */
		exports.__internals = { postTeamSpawn, createSnapshotStore, contextDetail };

		/** 只读诊断出口：样式是否注入 / portal 是否可用（离线探针正面断言用）。 */
		exports.__clientDiagnostics = () => ({ stylesInjected, portal: createPortal !== null });

		return module.exports;
	}
});
