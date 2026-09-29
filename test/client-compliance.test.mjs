/**
 * dsh-sidefork-a-teammate —— 客户端半边的**合规 + 行为**验证台（离线，无浏览器）。
 *
 * 它守两条不变量：
 *  ① **合规**：源码里除 `react` / `react/jsx-runtime` / `react-dom` 外**不得 require 任何包**，
 *     尤其不得 require 任何 Harness Client 包（官方 practices 明文禁止；理由见 client.js 头注）。
 *     ⇒ 页面里那份 `ui-primitives` / `client-store` 是**照抄进插件的自包含实现**。
 *  ② **行为**：自包含原语（Modal / Button / store）与插件契约（命令注册、overlay 注册、
 *     两档 context 文案、`postTeamSpawn` 的错误归一）在离线环境里逐条可验。
 *
 * 逐文件跑（本机沙箱禁止命名管道，`node --test` 会 spawn EPERM 并给出误导性的 `# fail 1`）：
 *   node test/client-compliance.test.mjs
 */
import { readFileSync } from "node:fs";

const SRC_URL = new URL("../client.js", import.meta.url);
const PKG_URL = new URL("../package.json", import.meta.url);
const source = readFileSync(SRC_URL, "utf8");
const pkg = JSON.parse(readFileSync(PKG_URL, "utf8"));

let pass = 0;
const failures = [];
function check(label, cond, detail) {
	if (cond === true) {
		pass += 1;
		console.log(`  ok   ${label}`);
	} else {
		failures.push(label);
		console.log(`  FAIL ${label}${detail === undefined ? "" : ` — 实际: ${JSON.stringify(detail)}`}`);
	}
}
const eq = (label, actual, expected) => check(label, actual === expected, actual);

// ── 源码级检查（去注释后再看 require）────────────────────────────────
/** 去掉块注释与行注释（够用即可：本项目源码里没有字符串里带 `//` 的极端情况）。 */
function stripComments(text) {
	const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, "");
	return noBlock
		.split("\n")
		.map((line) => {
			const at = line.indexOf("//");
			return at === -1 ? line : line.slice(0, at);
		})
		.join("\n");
}
const code = stripComments(source);
const requires = [...code.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
const unique = [...new Set(requires)].sort();

console.log("── ① 合规：依赖白名单 ──");
eq("ModuleLoader id === package.json 的 name（官方要求：浏览器工件 factory id 必须等于包名）",
	/window\.__ModuleLoader__\.load\(\{\s*\n\s*id:\s*"([^"]+)"/.exec(source)?.[1], pkg.name);
check("代码里只 require 白名单三项（react / react/jsx-runtime / react-dom）",
	unique.length === 3 && ["react", "react-dom", "react/jsx-runtime"].every((s, i) => unique[i] === s), unique);
eq("require('@deepseek-ai/*') 的代码调用数 = 0（官方 practices 禁止）",
	[...code.matchAll(/require\(\s*["']@deepseek-ai\//g)].length, 0);
eq("代码里没有 dsh-client-ui-primitives 的引用（只允许出现在注释里）",
	[...code.matchAll(/dsh-client-ui-primitives/g)].length, 0);
eq("代码里没有 dsh-client-store 的引用（只允许出现在注释里）",
	[...code.matchAll(/dsh-client-store/g)].length, 0);
for (const name of ["IconUsersOutlineRegular", "IconCloseOutlineRegular", "Button", "useModalLayer", "Modal", "createSnapshotStore"]) {
	eq(`自包含原语 ${name} 有且仅有一处定义`, [...code.matchAll(new RegExp(`function ${name}\\b`, "g"))].length, 1);
}
check("样式类名前缀统一 dstc-（不残留任何 dsd-）", code.includes("dstc-modal-dialog") && !code.includes("dsd-"), null);

// ── 装载工具（假 window / document / react / jsx-runtime）────────────
const jsx = (type, props, key) => ({ type, props: props ?? {}, key: key ?? null });
const jsxs = jsx;
const Fragment = Symbol("Fragment");

function makeReact() {
	const hooks = [];
	let index = 0;
	return {
		useState(initial) {
			const at = index++;
			if (!(at in hooks)) hooks[at] = typeof initial === "function" ? initial() : initial;
			return [
				hooks[at],
				(next) => {
					hooks[at] = typeof next === "function" ? next(hooks[at]) : next;
				}
			];
		},
		useEffect() {
			index += 1;
		},
		useRef(initial) {
			index += 1;
			return { current: initial === undefined ? null : initial };
		},
		__reset() {
			index = 0;
		}
	};
}

function makeDocument() {
	const appended = [];
	const target = {
		appendChild(node) {
			appended.push(node);
			return node;
		}
	};
	const doc = {
		head: target,
		documentElement: target,
		body: { tag: "body" },
		activeElement: null,
		getElementById: (id) => appended.find((n) => n.id === id) ?? null,
		createElement: (tag) => ({ tag, id: "", textContent: "", setAttribute() {} }),
		addEventListener() {},
		removeEventListener() {},
		contains: () => false
	};
	return { doc, appended };
}

/**
 * 装载 client.js 并执行 factory。
 * @param {{ failReact?: boolean, failReactDom?: boolean }} options - 模拟基座缺失。
 */
function loadClient(options = {}) {
	const { doc, appended } = makeDocument();
	let definition = null;
	const fakeWindow = { __ModuleLoader__: { load: (def) => { definition = def; } } };
	const react = makeReact();
	const requireStub = (spec) => {
		if (spec === "react") {
			if (options.failReact === true) throw new Error("simulated: react 不可用");
			return react;
		}
		if (spec === "react/jsx-runtime") return { jsx, jsxs, Fragment };
		if (spec === "react-dom") {
			if (options.failReactDom === true) throw new Error("simulated: react-dom 不可用");
			return { createPortal: (node) => ({ __portal: node }) };
		}
		throw new Error(`未预期的 require：${spec}`);
	};
	const savedWindow = globalThis.window;
	const savedDocument = globalThis.document;
	globalThis.window = fakeWindow;
	globalThis.document = doc;
	try {
		// client.js 是脚本（顶层直接调 window.__ModuleLoader__.load）
		new Function("window", source)(fakeWindow);
		const exportsObject = definition.factory(requireStub);
		return { exportsObject, definition, doc, appended, react, requireStub };
	} finally {
		globalThis.window = savedWindow;
		globalThis.document = savedDocument;
	}
}

/** 展开 React 元素树（本验证台的 jsx 是纯对象，没有真渲染）。 */
function walk(node, out = []) {
	if (node === null || node === undefined || typeof node !== "object") return out;
	if (Array.isArray(node)) {
		for (const child of node) walk(child, out);
		return out;
	}
	if (node.__portal !== undefined) return walk(node.__portal, out);
	if (node.type !== undefined) out.push(node);
	walk(node.props?.children, out);
	return out;
}

/**
 * 在"假 document 生效"的窗口里执行 `fn`。
 * ⚠️ 必需：`loadClient` 只在自己的 try 里装假 `document`（factory 期间），
 * 而 `apply()` 是**之后**才调用的 —— 样式注入发生在 `apply` 里，
 * 不这么做的话 `document` 已被还原成真实值（Node 下是 undefined），注入必然"降级失败"。
 */
function runWithDocument(doc, fn) {
	const saved = globalThis.document;
	globalThis.document = doc;
	try {
		return fn();
	} finally {
		globalThis.document = saved;
	}
}

// ── ② 装载、导出形状与降级 ────────────────────────────────────────
console.log("\n── ② 装载与降级 ──");
const main = loadClient();
const client = main.exportsObject;
eq("factory 返回对象的 name", client.name, "team-commands-client");
check("inject 是空数组（不挂硬门禁：渲染端 web boot 门禁是全有全无的）", Array.isArray(client.inject) && client.inject.length === 0, client.inject);
eq("apply 是函数", typeof client.apply, "function");
check("__internals 暴露 postTeamSpawn / createSnapshotStore / contextDetail",
	typeof client.__internals?.postTeamSpawn === "function"
	&& typeof client.__internals?.createSnapshotStore === "function"
	&& typeof client.__internals?.contextDetail === "function", Object.keys(client.__internals ?? {}));
eq("__clientDiagnostics 初始 stylesInjected = false", client.__clientDiagnostics().stylesInjected, false);
check("__clientDiagnostics 报告 portal 可用（本次注入了 react-dom）", client.__clientDiagnostics().portal === true, client.__clientDiagnostics());

const noReact = loadClient({ failReact: true });
check("react 基座缺失时 factory 不抛，且返回合法的 no-op 插件对象",
	noReact.exportsObject !== null && typeof noReact.exportsObject.apply === "function"
	&& Array.isArray(noReact.exportsObject.inject) && noReact.exportsObject.inject.length === 0, noReact.exportsObject?.name);
const noPortal = loadClient({ failReactDom: true });
eq("react-dom 缺失时 portal 降级为 false（静默）", noPortal.exportsObject.__clientDiagnostics().portal, false);
check("react-dom 缺失时 apply 仍可用（就地渲染）", typeof noPortal.exportsObject.apply === "function", null);

// ── ③ store 语义（自包含 createSnapshotStore 必须与官方接口逐字一致）──
console.log("\n── ③ 自包含 store 语义 ──");
const { createSnapshotStore, contextDetail, postTeamSpawn } = client.__internals;
const store = createSnapshotStore(null);
eq("初始快照 = null", store.getSnapshot(), null);
check("引用稳定：两次 getSnapshot 是同一个引用", store.getSnapshot() === store.getSnapshot(), null);
let notified = 0;
let notifiedArgCount = -1;
const unsubscribe = store.subscribe(function onStoreChange() {
	notified += 1;
	notifiedArgCount = arguments.length;
});
store.set({ open: true });
eq("set 后快照更新", store.getSnapshot().open, true);
eq("set 通知了订阅者一次", notified, 1);
eq("订阅回调**不带参数**（官方 uSES 的订阅约定）", notifiedArgCount, 0);
store.update((draft) => {
	draft.context = "fork";
});
eq("update 的 mutator 改到的是草稿", store.getSnapshot().context, "fork");
eq("update 也通知订阅者", notified, 2);
unsubscribe();
store.set({ open: false });
eq("取消订阅后不再通知", notified, 2);
const before = store.getSnapshot();
store.update(() => {
	throw new Error("simulated mutator 抛错");
});
check("mutator 抛错时快照引用不变（且不把异常抛给调用方）", store.getSnapshot() === before, null);

// ── ④ 两档 context 文案（截图里的原文）────────────────────────────
console.log("\n── ④ new / fork 的文案 ──");
eq("contextDetail('fresh')", contextDetail("fresh"), "全新对话，不继承本会话历史");
eq("contextDetail('fork')", contextDetail("fork"), "并行分支，继承本会话已完成的回合");
eq("未知值回退 fresh", contextDetail("junk"), "全新对话，不继承本会话历史");
eq("原型链键（__proto__）也回退 fresh", contextDetail("__proto__"), "全新对话，不继承本会话历史");
eq("非字符串回退 fresh", contextDetail(42), "全新对话，不继承本会话历史");

// ── ⑤ postTeamSpawn 的错误归一 ──────────────────────────────────
console.log("\n── ⑤ postTeamSpawn 契约 ──");
const savedFetch = globalThis.fetch;
let lastRequest = null;
const respond = (body, status = 200, jsonOk = true) => {
	globalThis.fetch = async (url, init) => {
		lastRequest = { url, init };
		return {
			status,
			json: async () => {
				if (jsonOk) return body;
				throw new Error("not json");
			}
		};
	};
};
respond({ ok: true, name: "alice", sessionId: "session-1" });
const okPayload = await postTeamSpawn({ sessionId: "session-1", context: "fresh", line: "alice | d | t" });
eq("成功时原样返回 payload", okPayload.name, "alice");
eq("请求打到宿主唯一路由", lastRequest.url, "/api/team.spawn");
eq("请求头 content-type", lastRequest.init.headers["content-type"], "application/json");
eq("请求体字段", JSON.parse(lastRequest.init.body).context, "fresh");

respond({ ok: false, code: "TEAM_MEMBER_NAME_TAKEN", message: "名字被占用" });
await postTeamSpawn({ sessionId: "s", context: "fresh", line: "" }).then(
	() => check("ok:false 必须抛错", false, "没有抛"),
	(error) => {
		eq("ok:false 时 .code 透传", error.code, "TEAM_MEMBER_NAME_TAKEN");
		eq("ok:false 时 message 取 payload.message", error.message, "名字被占用");
	}
);
respond({ ok: false }, 409);
await postTeamSpawn({ sessionId: "s", context: "fresh", line: "" }).then(
	() => check("ok:false 无 code 也要抛", false, "没有抛"),
	(error) => eq("ok:false 无 code 时退化成 HTTP_<status>", error.code, "HTTP_409")
);
respond(null, 500, false);
await postTeamSpawn({ sessionId: "s", context: "fresh", line: "" }).then(
	() => check("非 JSON 响应也要抛", false, "没有抛"),
	(error) => eq("非 JSON（如 5xx HTML）归一成 HTTP_<status>", error.code, "HTTP_500")
);
globalThis.fetch = savedFetch;

// ── ⑥ 装配：样式注入 + 命令注册 + overlay 注册 ─────────────────────
console.log("\n── ⑥ 装配行为 ──");
function makeCtx({ withCommandUi = true, withSlots = true, throwOnInject = false } = {}) {
	const registered = { command: [], overlay: [] };
	const ctx = {
		effect(factory) {
			return factory();
		},
		inject(names, callback) {
			if (throwOnInject) throw new Error("simulated inject 抛错");
			const scope = {
				get: (name) => (name === "commandUi" && withCommandUi
					? {
						register: (spec) => {
							registered.command.push(spec);
							return () => {};
						}
					}
					: undefined),
				effect: (factory) => factory(),
				slots: {
					inject: (name, generator) => {
						for (const disposer of generator()) void disposer;
					},
					register: (spec, component) => {
						registered.overlay.push({ spec, component });
						return () => {};
					}
				}
			};
			callback(scope);
		}
	};
	return { ctx, registered };
}

const fresh = loadClient();
const { ctx, registered } = makeCtx();
runWithDocument(fresh.doc, () => fresh.exportsObject.apply(ctx));
check("apply 后样式已注入 document.head", fresh.appended.some((n) => n.id === "dsh-plugin-sidefork-a-teammate-styles"), fresh.appended.map((n) => n.id));
eq("__clientDiagnostics().stylesInjected 变 true", fresh.exportsObject.__clientDiagnostics().stylesInjected, true);
const styleNode = fresh.appended.find((n) => n.id === "dsh-plugin-sidefork-a-teammate-styles");
check("注入的 CSS 含模态框规则", typeof styleNode?.textContent === "string" && styleNode.textContent.includes(".dstc-modal-dialog"), null);

eq("注册了 1 个命令", registered.command.length, 1);
const spec = registered.command[0] ?? {};
eq("命令名 = teammate（菜单里显示为「唤醒组员 teammate」）", spec.name, "teammate");
eq("命令中文标题 = 唤醒组员", spec.label?.(), "唤醒组员");
const optionsPromise = spec.ui?.options?.();
check("options() 返回 thenable（官方 load() 直接对它调 .then）", optionsPromise !== null && typeof optionsPromise?.then === "function", typeof optionsPromise);
const options = await optionsPromise;
eq("两个选项", options.length, 2);
eq("选项 1 id", options[0].id, "new");
eq("选项 1 文案（与截图一致）", options[0].detail, "全新对话，不继承本会话历史");
eq("选项 2 id", options[1].id, "fork");
eq("选项 2 文案（与截图一致）", options[1].detail, "并行分支，继承本会话已完成的回合");
eq("选项 1 label", options[0].label, "new teammate");
eq("选项 2 label", options[1].label, "fork teammate");

const storeForUi = { value: null, set(v) { this.value = v; } };
// 真实 store 路径：重新装配，并从 overlay 注册的 inject() 里把 store 抓出来
const third = loadClient();
const thirdCtx = makeCtx();
runWithDocument(third.doc, () => third.exportsObject.apply(thirdCtx.ctx));
eq("overlay 注册了 1 个 entry", thirdCtx.registered.overlay.length, 1);
const overlaySpec = thirdCtx.registered.overlay[0]?.spec ?? {};
eq("overlay name = shell.overlay", overlaySpec.name, "shell.overlay");
eq("overlay id = team-commands-create-teammate", overlaySpec.id, "team-commands-create-teammate");
const injected = overlaySpec.inject();
check("overlay inject() 暴露 store 与 hooks.teammate（同一个引用）",
	injected.store !== undefined && injected.hooks?.teammate === injected.store, Object.keys(injected));
const realOptions = await thirdCtx.registered.command[0].ui.options();
thirdCtx.registered.command[0].ui.onSelect(realOptions[1], { sessionId: "session-9" });
eq("选 fork 后 store.context = fork", injected.store.getSnapshot().context, "fork");
eq("选 fork 后 store.sessionId 来自 session 参数", injected.store.getSnapshot().sessionId, "session-9");
eq("选 fork 后 store.open = true", injected.store.getSnapshot().open, true);
thirdCtx.registered.command[0].ui.onSelect(realOptions[0], { sessionId: "session-8" });
eq("选 new 后 store.context = fresh", injected.store.getSnapshot().context, "fresh");

const noServices = loadClient();
runWithDocument(noServices.doc, () => {
	noServices.exportsObject.apply(makeCtx({ withCommandUi: false, withSlots: false }).ctx);
	noServices.exportsObject.apply(makeCtx({ throwOnInject: true }).ctx);
});
check("服务缺失 / inject 抛错时 apply 都不抛（最坏只是 UI 不出现）", true, null);
const noEffect = loadClient();
runWithDocument(noEffect.doc, () => noEffect.exportsObject.apply({ inject: () => {} }));
check("ctx.effect 缺失时仍能同步注入样式", noEffect.appended.some((n) => n.id === "dsh-plugin-sidefork-a-teammate-styles"), noEffect.appended.map((n) => n.id));

// ── ⑦ 自包含 Modal 的结构 ────────────────────────────────────────
console.log("\n── ⑦ 自包含 Modal 结构 ──");
const { Modal } = { Modal: null }; // Modal 未导出；用渲染路径间接验证
const dialogSource = source;
check("Modal 用 role=dialog + aria-modal", dialogSource.includes('role: "dialog"') && dialogSource.includes('"aria-modal": "true"'), null);
check("Modal 的关闭键带 aria-label（closeLabel）", dialogSource.includes('"aria-label": closeLabel'), null);
check("Modal 遮罩点击关闭", dialogSource.includes('className: "dstc-modal-mask"') && dialogSource.includes("onClick: onClose"), null);
check("Modal 支持 [data-modal-autofocus] 初始聚焦", dialogSource.includes("[data-modal-autofocus]"), null);
check("Modal 支持 Tab 焦点循环与 Escape 关闭", dialogSource.includes('event.key !== "Tab"') && dialogSource.includes('event.key === "Escape"'), null);
eq("Modal 未打开时返回 null（open !== true）", /if \(open !== true\) return null;/.test(source), true);

// ── 汇总 ────────────────────────────────────────────────────────
console.log(`\n${pass}/${pass + failures.length} 通过`);
if (failures.length > 0) {
	console.log(`失败 ${failures.length} 条：`);
	for (const label of failures) console.log(`  - ${label}`);
	process.exitCode = 1;
}
