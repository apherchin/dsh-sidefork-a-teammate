/**
 * dsh-team-commands —— 让"人"能从页面手动拉起队友（方案 B：一条 Web 路由）。
 *
 * 为什么需要它：
 *   在 DSH 里，创建 teammate 的唯一入口是模型侧工具 `spawn_teammate`
 *   （实现见 dsh-experimental-tool-agent-team/lib/index.js:268-292）。
 *   GUI 里没有按钮，浏览器侧也没有任何 spawn 通路 —— `subagents` 这个 Remote
 *   命名空间只暴露 `prompt` 与 `interruptByParent`
 *   （dsh-subagent/lib/typert.remote-client.js:41-90）。
 *   命令面（dsh-commands）的 handler 能拿到**确切的接收 agent**（先例：
 *   dsh-command-compact/lib/index.js:49-55 的 `invocation.agent`），但 `/` 菜单里
 *   多两个命令是用户要清掉的噪音。于是改为：客户端在会话上下文里发起
 *   `POST /api/team.spawn { sessionId, context, line }`，host 用 `ctx.agents.get(sessionId)`
 *   反查 agent，再调同一个 host 服务：
 *     ctx.agentTeams.spawnTeammate(agent, { name, description, prompt, context, provider, signal })
 *   两条路的服务调用完全一致，所以能 1:1 复刻工具。
 *
 * 契约：
 *   line = `<名字> | <描述> | <初始任务>`，三段全可省略；**名字留空**时从常见英文名池
 *   随机取一个（撞名自动换候选，最多 6 个）。context=fresh 不继承本会话历史，
 *   context=fork 继承本会话已完成的回合。
 *   初始消息：fresh 是一句问候（点明"全新对话、别与主会话混淆"）；
 *             fork 极简 —— 有任务就只发任务，没任务才给一句"并行分支，以你的指令为先"。
 *
 * 约束（由 agent-team 服务强制执行，本插件只做前置提示）：
 *   - 只有 Team Lead 能创建队友（否则 TEAM_LEAD_REQUIRED）；
 *   - 名字必须 lower-kebab-case、≤64 字符、且不能叫 "lead"
 *     （dsh-experimental-agent-team/lib/index.js:342、:704）；
 *   - 同 Team 内名字不可重复（TEAM_MEMBER_NAME_TAKEN）；
 *   - 成员上限由 agent-team 的 config.maxMembers 决定（本 profile 是 8）。
 *
 * provider 名与本 profile 的 `tool-agent-team` 配置保持一致
 * （cordis.patch.yml: freshProvider: spawn / forkProvider: fork；
 *  默认值见 dsh-subagent-spawn-in-process:13、dsh-subagent-fork-in-process:14）。
 * 若你把那两行配置改了，这里也要跟着改。
 *
 * 授权边界（如实记录）：路由走浏览器 cookie 认证（与 session-delete 同档）；
 * `sessionId` 由页面提交，host **无法验证**它就是发起请求的那个会话 ⇒
 * 单操作者模型下可接受，但不构成多用户隔离。
 */

/** 队友名规则，与 agent-team 的 MEMBER_NAME 完全一致。 */
const MEMBER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
/** 名字长度上限（agent-team 的 memberName）。 */
const NAME_MAX = 64;
/** 描述长度上限（agent-team 的 requiredText(request.description, "description", 200)）。 */
const DESC_MAX = 200;

/** 插件行名；与 cordis.patch.yml 里 insert 的 id 一致即可，便于排查。 */
export const name = "team-commands";

/** 依赖的 host 服务：Web 连接层 + agent 注册表 + Team 服务（不再需要 commands）。 */
export const inject = ["connection", "agents", "agentTeams"];

/** 路由路径；客户端半边必须用同一个常量。 */
const TEAM_SPAWN_PATH = "/api/team.spawn";

/** 随机英文名池：全部小写、满足服务端 MEMBER_NAME 正则，且不含 "lead"。 */
const NAME_POOL = [
	"alice", "bob", "carol", "dave", "erin", "frank", "grace", "henry",
	"iris", "jack", "karen", "leo", "maya", "nina", "oscar", "penny",
	"quinn", "rita", "sam", "tina", "victor", "wendy", "yara", "zoe",
];

/** 名字留空时，最多尝试几个候选（服务端回重名就换下一个）。 */
const NAME_ATTEMPTS = 6;

/**
 * 生成自动命名候选：随机起点 + 环形顺延，最多 NAME_ATTEMPTS 个。
 * @returns 候选名数组（长度 ≥ 1）。
 */
function autoNameCandidates() {
	const span = Math.min(NAME_ATTEMPTS, NAME_POOL.length);
	const start = Math.floor(Math.random() * NAME_POOL.length);
	const candidates = [];
	for (let offset = 0; offset < span; offset += 1) candidates.push(NAME_POOL[(start + offset) % NAME_POOL.length]);
	return candidates;
}

/**
 * 与 `spawn_teammate` 工具写入的身份前缀保持一致，让队友无论从哪条路创建，
 * 拿到的团队身份说明都一样（工具侧见 dsh-experimental-tool-agent-team/lib/index.js:276-284）。
 * @param memberName - 队友名。
 * @returns 一段 system-reminder 文本，末尾带一个空行。
 */
function identityPrefix(memberName) {
	return `<system-reminder>
You are teammate "${memberName}".
Your Team Lead is named "lead".
Use list_agents({}) to find your teammates and their names.
To message your Team Lead, use send_message({ target: "lead", message: "..." }).
To message another teammate, use send_message({ target: "<teammate name>", message: "..." }).
</system-reminder>

`;
}

/** fork 的自我介绍：一句话，不复述背景。 */
const FORK_BRIEF = "我是主会话的并行分支（fork），已继承其已完成上下文。以你的指令为先，我不复述背景。";

/**
 * fresh 的初始消息：一句问候，并说清"这是新对话、想法可能与主会话不同"。
 * 用户要求：新对话不要和原来的混淆，所以这里刻意点明。
 * @param memberName - 已确定的队友名。
 * @returns 问候语。
 */
function freshGreeting(memberName) {
	return `你好，我是 ${memberName}。这是一个全新的对话（fresh），我没有继承主会话的任何历史。` +
		"所以我可能会给出和那边不一样的想法 —— 请把两边分清楚，不要混在一起。我在这里等你的指令。";
}

/**
 * 组装新成员的初始消息。
 * fork：有任务就只发任务（以用户指令为先），没任务才给一句自述。
 * fresh：总是先问候；有任务时把任务附在问候之后（D1）。
 * @param context - "fresh" 或 "fork"。
 * @param memberName - 已确定的队友名。
 * @param task - 用户写的任务文本，可为空串。
 * @returns 初始消息正文。
 */
function initialMessage(context, memberName, task) {
	if (context === "fork") return task.length > 0 ? task : FORK_BRIEF;
	return task.length > 0 ? `${freshGreeting(memberName)}\n\n任务：${task}` : freshGreeting(memberName);
}

/**
 * 解析输入行。
 * 语法：`<名字> | <描述> | <初始任务>`，三段全部可省略。
 * **名字留空是合法用法**：调用方改走随机命名（autoName = true）。
 * 第 3 段之后如果还有 `|`，一律并入任务文本（允许任务里写竖线）。
 * @param raw - 页面提交的 line。
 * @returns 解析结果；显式写了非法名时返回带 error 的对象。
 */
function parseInput(raw) {
	const text = typeof raw === "string" ? raw : "";
	const parts = text.split("|");
	const memberName = (parts[0] ?? "").trim();
	const descriptionRaw = (parts[1] ?? "").trim();
	const task = parts.slice(2).join("|").trim();

	// 留空 → 自动随机取名；显式给出时才做本地校验（D2：非法名不自动改写）。
	if (
		memberName.length > 0 &&
		(memberName === "lead" || !MEMBER_NAME.test(memberName) || memberName.length > NAME_MAX)
	)
		return {
			error:
				`名字 "${memberName}" 不合法：必须是小写 kebab-case（只含 a-z0-9 与中间的单个连字符）、` +
				`不超过 ${NAME_MAX} 字符，且不能叫 "lead"。留空则由本命令随机取名。`,
		};

	return { memberName, autoName: memberName.length === 0, descriptionRaw, task };
}

/**
 * 路由 handler：校验 → 取名 → 调 Team 服务；把结果压成 `{ ok, … }` 形状。
 *
 * 候选循环与错误处理沿用原命令实现：只有自动命名才换候选，
 * 显式给的名字重复时原样报错，不偷偷换名。
 * ⚠️ 这个导出同时是**离线验证台的测试缝**（与 client.js 的 `__internals` 同理）：`smoke-test.mjs`
 * 直接驱动它，不起宿主、不注册路由；改签名或返回形状前先看那份测试。
 * @param ctx - Host 上下文（需含 agents 与 agentTeams）。
 * @param body - 请求体 `{ sessionId, context, line }`。
 * @returns `{ ok:true, name, sessionId }` 或 `{ ok:false, code, message }`。
 */
export async function handleTeamSpawn(ctx, body) {
	const sessionId = body?.sessionId;
	if (typeof sessionId !== "string" || sessionId.length === 0)
		return { ok: false, code: "INVALID_SESSION_ID", message: "sessionId 必须是非空字符串" };

	const context = body?.context;
	if (context !== "fresh" && context !== "fork")
		return { ok: false, code: "INVALID_INPUT", message: 'context 必须是 "fresh" 或 "fork"' };

	if (typeof body?.line !== "string") return { ok: false, code: "INVALID_INPUT", message: "line 必须是字符串" };

	const parsed = parseInput(body.line);
	if (parsed.error !== undefined) return { ok: false, code: "INVALID_INPUT", message: parsed.error };

	const agent = ctx.agents.get(sessionId);
	if (agent === undefined || agent === null)
		return { ok: false, code: "AGENT_UNAVAILABLE", message: "该会话当前没有活动 agent，请先打开该会话再试" };

	const provider = context === "fork" ? "fork" : "spawn";
	// 路由侧拿不到命令运行时的 invocation.signal；服务端内部是
	// AbortSignal.any([request.signal, lifecycle.signal])，传 undefined 会抛
	// ERR_INVALID_ARG_TYPE（实测），所以这里给一个真 signal 兜底。
	const signal = new AbortController().signal;
	const candidates = parsed.autoName ? autoNameCandidates() : [parsed.memberName];

	for (const memberName of candidates) {
		const description = (parsed.descriptionRaw.length > 0 ? parsed.descriptionRaw : `teammate ${memberName}`).slice(
			0,
			DESC_MAX,
		);
		try {
			const result = await ctx.agentTeams.spawnTeammate(agent, {
				name: memberName,
				description,
				prompt: [
					{ type: "text", text: identityPrefix(memberName) },
					{ type: "text", text: initialMessage(context, memberName, parsed.task) },
				],
				context,
				provider,
				signal,
			});
			return { ok: true, name: memberName, sessionId: result?.member?.id };
		} catch (error) {
			// 只有自动命名才换候选；显式给的名字重复时原样报错，不偷偷换名。
			if (parsed.autoName && error?.code === "TEAM_MEMBER_NAME_TAKEN") continue;
			// 其它 TeamError 带稳定 code（TEAM_LEAD_REQUIRED / TEAM_MEMBER_LIMIT /
			// TEAM_INVALID_MEMBER_NAME ...），原样透传，方便客户端显示与自查。
			return {
				ok: false,
				code: error?.code ?? "SPAWN_FAILED",
				message: error?.message ?? String(error),
			};
		}
	}

	return {
		ok: false,
		code: "TEAM_MEMBER_NAME_TAKEN",
		message: `自动命名失败：连续 ${candidates.length} 个候选名都被占用（TEAM_MEMBER_NAME_TAKEN）。请在弹窗里显式填写一个名字。`,
	};
}

/**
 * 注册 Web 路由。整块包 try/catch：host 插件在 apply 里抛错会连累宿主装配，
 * 所以缺服务时只记一条警告，绝不上抛。
 * @param ctx - Host 上下文，需含 connection 服务。
 */
export function apply(ctx) {
	try {
		ctx.effect(() => Reflect.get(ctx, "connection").fetch.register({
			path: TEAM_SPAWN_PATH,
			methods: ["POST"],
			requestBody: "buffered",
			fetch: async (request) => {
				// 整个回调主体包在 try 里：`ctx.agents.get(...)` 或 `Response.json(...)` 抛错都会让 handler 的
				// promise reject（宿主侧没有兜底），所以一律转成 500 INTERNAL 的结构化响应。
				try {
					let body;
					try {
						body = await request.json();
					} catch {
						return Response.json({ ok: false, code: "BAD_JSON", message: "body must be JSON" }, { status: 400 });
					}
					const result = await handleTeamSpawn(ctx, body);
					// 状态码映射：少数语义错走白名单；**任何 TEAM_* 一律兜底成 409**（最可能的真实失败
					// TEAM_LEAD_REQUIRED 曾落成 500，监控会当服务端故障）；TEAM_INVALID_MEMBER_NAME 属
					// **输入**错、仍保持 400，所以写在兜底之前；只有真正未知的 code 才落到 500。
					const status = result.ok
						? 200
						: result.code === "BAD_JSON" || result.code === "INVALID_INPUT" || result.code === "INVALID_SESSION_ID"
							? 400
							: result.code === "TEAM_INVALID_MEMBER_NAME"
								? 400
								: result.code === "AGENT_UNAVAILABLE" ||
									  result.code === "TEAM_MEMBER_NAME_TAKEN" ||
									  result.code === "TEAM_MEMBER_LIMIT" ||
									  String(result.code).startsWith("TEAM_")
									? 409
									: 500;
					return Response.json(result, { status });
				} catch (error) {
					return Response.json(
						{ ok: false, code: "INTERNAL", message: String(error?.message ?? error) },
						{ status: 500 },
					);
				}
			},
		}), "team-commands: route");
	} catch (error) {
		try {
			ctx.logger?.warn?.(`team-commands: 路由注册失败（可能缺少 connection 服务）：${error?.message ?? String(error)}`);
		} catch {}
	}
}
