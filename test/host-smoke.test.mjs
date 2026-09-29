/**
 * dsh-team-commands 的离线冒烟测试（方案 B：host 侧只剩一条路由）。
 *
 * 做法：导入插件模块，用假的 ctx 调 apply()，把注册的 Web 路由抓出来；
 * 再直接驱动 `handleTeamSpawn(ctx, body)`，检查 (a) 输入校验、(b) 传给 Team 服务的
 * 请求形状、(c) 文案、(d) 错误码与 HTTP 状态码映射。不需要 DSH 运行时。
 *
 * 运行：node smoke-test.mjs
 */

import { readFileSync } from "node:fs";

const MODULE_URL = new URL("../index.mjs", import.meta.url);

let failures = 0;
let checks = 0;

/**
 * 断言。
 * @param label - 用例名。
 * @param condition - 必须为真。
 * @param detail - 失败时附带的实际值。
 */
function ok(label, condition, detail) {
	checks += 1;
	if (condition) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label}${detail === undefined ? "" : ` — 实际: ${JSON.stringify(detail)}`}`);
}

/**
 * 断言相等。
 * @param label - 用例名。
 * @param actual - 实际值。
 * @param expected - 期望值。
 */
function eq(label, actual, expected) {
	ok(label, actual === expected, actual);
}

const mod = await import(MODULE_URL.href);
const pluginSource = readFileSync(MODULE_URL, "utf8");

/** 已注册的路由规格（由假 connection 捕获）。 */
let captured;
/** 每次 spawnTeammate 的调用记录。 */
const calls = [];
/** 下一次调用要抛的错误（抛完即清空）。 */
let nextError = null;
/** true 时 `ctx.agents.get` 直接抛错（模拟服务内部故障 → 路由须兜底成 500 INTERNAL）。 */
let agentsGetThrows = false;
/** 还要连续抛几次 TEAM_MEMBER_NAME_TAKEN（模拟自动命名撞名）。 */
let takenRemaining = 0;

/** 服务端重名错误。 */
const takenError = () =>
	Object.assign(new Error("teammate name was already used in this Team"), { code: "TEAM_MEMBER_NAME_TAKEN" });

/** 假 ctx：agents 只要 session-live 活着；agentTeams 记录调用；connection 捕获路由。 */
const ctx = {
	effect: (fn) => {
		const disposable = fn();
		return typeof disposable === "function" ? disposable : () => {};
	},
	agents: {
		get: (id) => {
			if (agentsGetThrows) throw new Error("agents 服务内部故障（模拟）");
			return id === "session-live" ? { id } : undefined;
		},
	},
	agentTeams: {
		async spawnTeammate(agent, request) {
			calls.push({ agent, request });
			if (nextError !== null) {
				const error = nextError;
				nextError = null;
				throw error;
			}
			if (takenRemaining > 0) {
				takenRemaining -= 1;
				throw takenError();
			}
			return { member: { id: "session-child" } };
		},
	},
	connection: {
		fetch: {
			register: (spec) => {
				captured = spec;
				return () => {};
			},
		},
	},
};

/** 清空调用记录与注入的错误。 */
function reset() {
	calls.length = 0;
	nextError = null;
	takenRemaining = 0;
agentsGetThrows = false;
}

/** 造一个只实现 json() 的假 Request。 */
const fakeRequest = (value) => ({
	json: async () => {
		if (value instanceof Error) throw value;
		return value;
	},
});

console.log("apply() 注册情况");
mod.apply(ctx);
ok("apply() 触发了连接层注册（captured 已捕获）", captured !== undefined);
eq("路由路径", captured?.path, "/api/team.spawn");
ok("methods 含 POST", Array.isArray(captured?.methods) && captured.methods.includes("POST"), captured?.methods);
eq("requestBody 是 buffered", captured?.requestBody, "buffered");
ok("fetch 是函数", typeof captured?.fetch === "function", typeof captured?.fetch);
eq("插件行名", mod.name, "team-commands");
eq(
	"inject 是 connection/agents/agentTeams",
	Array.isArray(mod.inject) ? mod.inject.join(",") : String(mod.inject),
	"connection,agents,agentTeams",
);
ok("不再有命令注册（源码里没有 ctx.commands.register）", !pluginSource.includes("ctx.commands.register"));
ok("导出了 handleTeamSpawn", typeof mod.handleTeamSpawn === "function", typeof mod.handleTeamSpawn);

console.log("\n输入校验");
reset();
let result = await mod.handleTeamSpawn(ctx, { context: "fresh", line: "alpha" });
eq("缺 sessionId → ok=false", result.ok, false);
eq("缺 sessionId → INVALID_SESSION_ID", result.code, "INVALID_SESSION_ID");
result = await mod.handleTeamSpawn(ctx, { sessionId: 42, context: "fresh", line: "alpha" });
eq("sessionId 非字符串 → INVALID_SESSION_ID", result.code, "INVALID_SESSION_ID");
result = await mod.handleTeamSpawn(ctx, { sessionId: "", context: "fresh", line: "alpha" });
eq("sessionId 空串 → INVALID_SESSION_ID", result.code, "INVALID_SESSION_ID");
result = await mod.handleTeamSpawn(ctx, { sessionId: "session-live", context: "live", line: "alpha" });
eq("context 不是 fresh|fork → INVALID_INPUT", result.code, "INVALID_INPUT");
result = await mod.handleTeamSpawn(ctx, { sessionId: "session-live", context: "fresh", line: 42 });
eq("line 非字符串 → INVALID_INPUT", result.code, "INVALID_INPUT");
result = await mod.handleTeamSpawn(ctx, { sessionId: "session-live", context: "fresh" });
eq("缺 line → INVALID_INPUT", result.code, "INVALID_INPUT");
eq("坏输入一律未调用 spawnTeammate", calls.length, 0);
ok("失败响应带可读 message", typeof result.message === "string" && result.message.length > 0, result);

console.log("\n显式非法名：本地拒绝且不调用服务");
reset();
result = await mod.handleTeamSpawn(ctx, { sessionId: "session-live", context: "fresh", line: "验证器 | x | y" });
eq("中文名 → ok=false", result.ok, false);
eq("中文名 → INVALID_INPUT", result.code, "INVALID_INPUT");
eq("非法名时未调用 spawnTeammate", calls.length, 0);
ok("非法名的 message 说明规则", String(result.message).includes("kebab-case"), result.message);
for (const [label, line] of [
	["保留名 lead", "lead | x | y"],
	["下划线", "Bad_Name | x | y"],
	["超长名", `${"a".repeat(65)} | x | y`],
]) {
	reset();
	result = await mod.handleTeamSpawn(ctx, { sessionId: "session-live", context: "fresh", line });
	eq(`${label} → INVALID_INPUT`, result.code, "INVALID_INPUT");
	eq(`${label} → 未调用 spawnTeammate`, calls.length, 0);
}

console.log("\nagent 取不到：拒绝且不调用服务");
reset();
result = await mod.handleTeamSpawn(ctx, { sessionId: "session-dead", context: "fresh", line: "alpha" });
eq("agent 取不到 → ok=false", result.ok, false);
eq("agent 取不到 → AGENT_UNAVAILABLE", result.code, "AGENT_UNAVAILABLE");
eq("agent 取不到时未调用 spawnTeammate", calls.length, 0);
ok("AGENT_UNAVAILABLE 有可读提示", String(result.message).includes("活动 agent"), result.message);

console.log("\n名字留空 → 池内小写英文名");
reset();
result = await mod.handleTeamSpawn(ctx, { sessionId: "session-live", context: "fresh", line: "" });
eq("空 line 放行（自动取名）", result.ok, true);
const autoName = result.name;
ok("生成名是小写英文", typeof autoName === "string" && /^[a-z]+$/u.test(autoName), autoName);
ok("生成名来自池子（源码可查）", typeof autoName === "string" && pluginSource.includes(`"${autoName}"`), autoName);
ok("生成名不是 lead", autoName !== "lead", autoName);
eq("返回的 name 就是发给服务的名字", calls[0]?.request.name, autoName);
eq("描述默认值跟随最终名字", calls[0]?.request.description, `teammate ${autoName}`);
eq("自动命名只调用一次服务", calls.length, 1);

console.log("\nfresh 无任务：只有问候语");
reset();
result = await mod.handleTeamSpawn(ctx, { sessionId: "session-live", context: "fresh", line: "beta" });
eq("只有名字也成功", result.ok, true);
const betaGreeting = calls[0]?.request.prompt[1]?.text ?? "";
ok("问候语含「全新的对话」", betaGreeting.includes("全新的对话"), betaGreeting);
ok("问候语含「不要混在一起」", betaGreeting.includes("不要混在一起"), betaGreeting);
ok("无任务时没有任务行", !betaGreeting.includes("任务："), betaGreeting);

console.log("\n三段语法（任务把后续竖线并入）");
reset();
result = await mod.handleTeamSpawn(ctx, {
	sessionId: "session-live",
	context: "fresh",
	line: "beta | 只读调研 | 先看 A 再看 B | 再 C",
});
eq("三段解析成功", result.ok, true);
eq("返回 name", result.name, "beta");
eq("返回 sessionId=子会话 id", result.sessionId, "session-child");
eq("描述被采用", calls[0]?.request.description, "只读调研");
eq("context 透传 fresh", calls[0]?.request.context, "fresh");
eq("fresh provider 是 spawn", calls[0]?.request.provider, "spawn");
eq("agent 是 agents.get 拿到的那个", calls[0]?.agent?.id, "session-live");
eq("prompt 有两段", calls[0]?.request.prompt.length, 2);
ok("第一段是身份前缀", String(calls[0]?.request.prompt[0]?.text).includes('You are teammate "beta".'));
ok(
	"signal 是真的 AbortSignal",
	calls[0]?.request.signal instanceof AbortSignal,
	typeof calls[0]?.request.signal,
);
const freshWithTask = calls[0]?.request.prompt[1]?.text ?? "";
ok("任务把后续竖线并入", freshWithTask.endsWith("任务：先看 A 再看 B | 再 C"), freshWithTask);
ok("fresh 有任务时 = 问候语 + 空行 + 任务行", freshWithTask === `${betaGreeting}\n\n任务：先看 A 再看 B | 再 C`);

console.log("\nfork：极简自述 / 有任务只发任务");
reset();
result = await mod.handleTeamSpawn(ctx, { sessionId: "session-live", context: "fork", line: "gamma" });
eq("fork 成功", result.ok, true);
eq("fork provider 是 fork", calls[0]?.request.provider, "fork");
eq("fork context 透传", calls[0]?.request.context, "fork");
const forkPlain = calls[0]?.request.prompt[1]?.text ?? "";
ok("fork 无任务含「并行分支」", forkPlain.includes("并行分支"), forkPlain);
ok("fork 无任务含「以你的指令为先」", forkPlain.includes("以你的指令为先"), forkPlain);
ok("fork 无任务含「不复述背景」", forkPlain.includes("不复述背景"), forkPlain);
reset();
result = await mod.handleTeamSpawn(ctx, { sessionId: "session-live", context: "fork", line: "gamma | 讲解 | 解释上一步" });
eq("fork 有任务仍成功", result.ok, true);
eq("fork 有任务时第二段就是任务本身", calls[0]?.request.prompt[1]?.text, "解释上一步");

console.log("\n自动命名撞名 → 换候选重试");
reset();
takenRemaining = 1;
result = await mod.handleTeamSpawn(ctx, { sessionId: "session-live", context: "fresh", line: "" });
eq("撞名后重试成功", result.ok, true);
eq("恰好调用两次", calls.length, 2);
ok("两次候选名不同", calls[0]?.request.name !== calls[1]?.request.name, [calls[0]?.request.name, calls[1]?.request.name]);
eq("返回的是第二次成功的名字", result.name, calls[1]?.request.name);

console.log("\n自动命名候选耗尽");
reset();
takenRemaining = 99;
result = await mod.handleTeamSpawn(ctx, { sessionId: "session-live", context: "fresh", line: "" });
eq("候选耗尽 → ok=false", result.ok, false);
eq("候选耗尽 → TEAM_MEMBER_NAME_TAKEN", result.code, "TEAM_MEMBER_NAME_TAKEN");
eq("尝试了 6 个候选", calls.length, 6);
ok("候选耗尽的 message 可读", String(result.message).length > 0, result.message);

console.log("\n显式名重复 → 不偷偷换名");
reset();
takenRemaining = 1;
result = await mod.handleTeamSpawn(ctx, { sessionId: "session-live", context: "fresh", line: "zeta | 描述 | 任务" });
eq("显式名重复 → ok=false", result.ok, false);
eq("显式名重复 → TEAM_MEMBER_NAME_TAKEN", result.code, "TEAM_MEMBER_NAME_TAKEN");
eq("显式名重复只调用一次", calls.length, 1);

console.log("\nTeamError 原样透传");
reset();
nextError = Object.assign(new Error("only the Team Lead can create teammates"), { code: "TEAM_LEAD_REQUIRED" });
result = await mod.handleTeamSpawn(ctx, { sessionId: "session-live", context: "fresh", line: "delta | x | y" });
eq("TeamError → ok=false", result.ok, false);
eq("TeamError code 透传", result.code, "TEAM_LEAD_REQUIRED");
ok("TeamError message 透传", String(result.message).includes("only the Team Lead"), result.message);

console.log("\n路由 fetch：坏 JSON 与成功");
reset();
let response = await captured.fetch(fakeRequest(new Error("bad json")));
eq("坏 JSON → status 400", response.status, 400);
let payload = await response.json();
eq("坏 JSON → code BAD_JSON", payload.code, "BAD_JSON");
eq("坏 JSON → ok=false", payload.ok, false);
response = await captured.fetch(fakeRequest({ sessionId: "session-live", context: "fresh", line: "alpha" }));
eq("成功 → status 200", response.status, 200);
payload = await response.json();
eq("成功 → ok=true", payload.ok, true);
eq("成功 → 带 name", payload.name, "alpha");
eq("成功 → 带 sessionId", payload.sessionId, "session-child");

console.log("\n路由 fetch：状态码映射逐条");
reset();
response = await captured.fetch(fakeRequest({ sessionId: "session-live", context: "fresh", line: 42 }));
eq("INVALID_INPUT → 400", response.status, 400);
response = await captured.fetch(fakeRequest({ context: "fresh", line: "alpha" }));
eq("INVALID_SESSION_ID → 400", response.status, 400);
response = await captured.fetch(fakeRequest({ sessionId: "session-dead", context: "fresh", line: "alpha" }));
eq("AGENT_UNAVAILABLE → 409", response.status, 409);
reset();
takenRemaining = 1;
response = await captured.fetch(fakeRequest({ sessionId: "session-live", context: "fresh", line: "zeta | x | y" }));
eq("TEAM_MEMBER_NAME_TAKEN → 409", response.status, 409);
payload = await response.json();
eq("409 响应体带原 code", payload.code, "TEAM_MEMBER_NAME_TAKEN");
reset();
nextError = Object.assign(new Error("team is full"), { code: "TEAM_MEMBER_LIMIT" });
response = await captured.fetch(fakeRequest({ sessionId: "session-live", context: "fresh", line: "eta | x | y" }));
eq("TEAM_MEMBER_LIMIT → 409", response.status, 409);
nextError = Object.assign(new Error("bad member name"), { code: "TEAM_INVALID_MEMBER_NAME" });
response = await captured.fetch(fakeRequest({ sessionId: "session-live", context: "fresh", line: "theta | x | y" }));
eq("TEAM_INVALID_MEMBER_NAME → 400", response.status, 400);
nextError = Object.assign(new Error("boom"), { code: "SOMETHING_ELSE" });
response = await captured.fetch(fakeRequest({ sessionId: "session-live", context: "fresh", line: "iota | x | y" }));
eq("未知 code → 500", response.status, 500);

// TEAM_* 兜底：TEAM_LEAD_REQUIRED（会话不是 Team Lead / 不是 Team 成员）是最可能的真实失败，
// 语义错 ⇒ 409，绝不能落成 500（监控会当服务端故障）。
reset();
nextError = Object.assign(new Error("only the Team Lead can create teammates"), { code: "TEAM_LEAD_REQUIRED" });
response = await captured.fetch(fakeRequest({ sessionId: "session-live", context: "fresh", line: "kappa | x | y" }));
eq("TEAM_LEAD_REQUIRED → 409", response.status, 409);
payload = await response.json();
eq("TEAM_LEAD_REQUIRED 响应体仍带原 code", payload.code, "TEAM_LEAD_REQUIRED");

// 回调整体兜底：`ctx.agents.get` 抛错不能让 handler 的 promise reject ⇒ 500 + code INTERNAL。
reset();
agentsGetThrows = true;
response = await captured.fetch(fakeRequest({ sessionId: "session-live", context: "fresh", line: "lambda | x | y" }));
eq("ctx.agents.get 抛错 → 500", response.status, 500);
payload = await response.json();
eq("ctx.agents.get 抛错 → code INTERNAL", payload.code, "INTERNAL");
eq("ctx.agents.get 抛错 → ok=false", payload.ok, false);
ok("INTERNAL message 非空", typeof payload.message === "string" && payload.message.length > 0, payload);
reset();

console.log("\n缺少 connection 服务时 apply() 不抛");
const bareCtx = {
	effect: (fn) => {
		fn();
		return () => {};
	},
	agents: { get: () => undefined },
	agentTeams: {
		async spawnTeammate() {
			throw new Error("不应被调用");
		},
	},
};
let applyThrew = false;
try {
	mod.apply(bareCtx);
} catch {
	applyThrew = true;
}
ok("apply() 不抛（host 插件铁律）", applyThrew === false);

console.log(`\n${checks - failures}/${checks} 通过`);
if (failures > 0) {
	console.log(`有 ${failures} 个失败`);
	process.exitCode = 1;
}
