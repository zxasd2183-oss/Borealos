/**
 * CodeWork 2.0 — 任务分解算法（Task Decomposition Engine）
 *
 * 功能：
 *  - 将复杂任务自动分解为可独立执行的原子子任务
 *  - 基于任务类型、复杂度、关键词自动推导子任务依赖关系
 *  - 支持自定义分解策略（pattern-based / heuristic / template）
 *  - 与 Executor 无缝集成：分解结果可直接 loadFromPlan()
 *  - 提供复杂度评估模型，决定任务是否需要分解
 *
 * 设计原则：
 *  - 松耦合：不直接依赖 Executor，返回标准 plan 数据结构
 *  - 可扩展：分解策略通过注册表模式插件化
 *  - 幂等：同一任务多次分解结果一致（确定性算法）
 */

'use strict';

const { EventEmitter } = require('events');
const { Logger, createLogger } = require('./logger');
const { PlanError, ExecutorError } = require('./errors');

// ─── 接口定义（JSDoc） ────────────────────────────────────────────────────────

/**
 * @typedef {'atomic'|'composite'|'milestone'} TaskComplexity
 *
 * @typedef {Object} DecomposedTask
 * @property {string}   id          子任务 ID（格式: parentId/sub-N）
 * @property {string}   text        子任务描述
 * @property {number}   stageIndex  所属阶段索引
 * @property {number}   taskIndex   阶段内任务索引
 * @property {string}   status      初始状态（默认 'pending'）
 * @property {string[]} dependsOn   依赖的子任务 ID 列表
 * @property {string[]} deliverables 子任务交付物
 * @property {number}   estimatedMinutes 预估耗时（分钟）
 * @property {string}   complexity  子任务复杂度
 *
 * @typedef {Object} DecompositionResult
 * @property {string}   originalId   原始任务 ID
 * @property {string}   originalText 原始任务描述
 * @property {boolean}  decomposed   是否发生了分解
 * @property {DecomposedTask[]} subTasks 分解后的子任务列表
 * @property {string[]} warnings     分解过程中的警告信息
 *
 * @typedef {Object} DecomposerOptions
 * @property {number}   [complexityThreshold=5]  复杂度阈值，超过则触发分解
 * @property {boolean}  [autoEstimate=true]      是否自动预估耗时
 * @property {Logger}   [logger]                 注入外部 Logger
 * @property {boolean}  [preserveOriginal=true]  是否保留原始任务作为 milestone
 */

// ─── 内置分解策略 ─────────────────────────────────────────────────────────────

/**
 * 默认分解策略注册表
 * 键：任务类型标识（通过关键词匹配）
 * 值：分解策略函数 (taskText, context) => DecomposedTask[]
 */
const DEFAULT_STRATEGIES = {
    // 开发类任务分解
    'development': (text, ctx) => {
        const base = ctx.baseId || 'task';
        return [
            {
                id: `${base}/sub-1`, text: `分析需求并设计 ${text} 的接口`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [],
                deliverables: [`${text} 接口设计文档`],
                estimatedMinutes: 30, complexity: 'atomic',
            },
            {
                id: `${base}/sub-2`, text: `实现 ${text} 的核心逻辑`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [`${base}/sub-1`],
                deliverables: [`${text} 核心代码`],
                estimatedMinutes: 60, complexity: 'atomic',
            },
            {
                id: `${base}/sub-3`, text: `为 ${text} 编写单元测试`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [`${base}/sub-2`],
                deliverables: [`${text} 测试文件`],
                estimatedMinutes: 30, complexity: 'atomic',
            },
            {
                id: `${base}/sub-4`, text: `代码审查与重构 ${text}`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [`${base}/sub-3`],
                deliverables: [`${text} 审查报告`],
                estimatedMinutes: 20, complexity: 'atomic',
            },
        ];
    },

    // 配置类任务分解
    'configuration': (text, ctx) => {
        const base = ctx.baseId || 'task';
        return [
            {
                id: `${base}/sub-1`, text: `调研 ${text} 的需求与约束`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [],
                deliverables: [`${text} 需求清单`],
                estimatedMinutes: 15, complexity: 'atomic',
            },
            {
                id: `${base}/sub-2`, text: `编写 ${text} 的配置文件`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [`${base}/sub-1`],
                deliverables: [`${text} 配置文件`],
                estimatedMinutes: 20, complexity: 'atomic',
            },
            {
                id: `${base}/sub-3`, text: `验证 ${text} 配置有效性`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [`${base}/sub-2`],
                deliverables: [`${text} 验证报告`],
                estimatedMinutes: 10, complexity: 'atomic',
            },
        ];
    },

    // 文档类任务分解
    'documentation': (text, ctx) => {
        const base = ctx.baseId || 'task';
        return [
            {
                id: `${base}/sub-1`, text: `梳理 ${text} 的结构大纲`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [],
                deliverables: [`${text} 大纲`],
                estimatedMinutes: 20, complexity: 'atomic',
            },
            {
                id: `${base}/sub-2`, text: `撰写 ${text} 正文内容`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [`${base}/sub-1`],
                deliverables: [`${text} 初稿`],
                estimatedMinutes: 45, complexity: 'atomic',
            },
            {
                id: `${base}/sub-3`, text: `校对与润色 ${text}`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [`${base}/sub-2`],
                deliverables: [`${text} 终稿`],
                estimatedMinutes: 15, complexity: 'atomic',
            },
        ];
    },

    // 测试类任务分解
    'testing': (text, ctx) => {
        const base = ctx.baseId || 'task';
        return [
            {
                id: `${base}/sub-1`, text: `设计 ${text} 的测试用例`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [],
                deliverables: [`${text} 测试用例列表`],
                estimatedMinutes: 25, complexity: 'atomic',
            },
            {
                id: `${base}/sub-2`, text: `搭建 ${text} 的测试环境`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [`${base}/sub-1`],
                deliverables: [`${text} 测试环境配置`],
                estimatedMinutes: 20, complexity: 'atomic',
            },
            {
                id: `${base}/sub-3`, text: `执行 ${text} 并记录结果`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [`${base}/sub-2`],
                deliverables: [`${text} 测试报告`],
                estimatedMinutes: 30, complexity: 'atomic',
            },
        ];
    },

    // 集成/部署类任务分解
    'integration': (text, ctx) => {
        const base = ctx.baseId || 'task';
        return [
            {
                id: `${base}/sub-1`, text: `准备 ${text} 的前置环境`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [],
                deliverables: [`${text} 环境检查清单`],
                estimatedMinutes: 15, complexity: 'atomic',
            },
            {
                id: `${base}/sub-2`, text: `执行 ${text} 的集成步骤`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [`${base}/sub-1`],
                deliverables: [`${text} 集成产物`],
                estimatedMinutes: 40, complexity: 'atomic',
            },
            {
                id: `${base}/sub-3`, text: `验证 ${text} 集成结果`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [`${base}/sub-2`],
                deliverables: [`${text} 验证报告`],
                estimatedMinutes: 20, complexity: 'atomic',
            },
        ];
    },

    // 研究/调研类任务分解
    'research': (text, ctx) => {
        const base = ctx.baseId || 'task';
        return [
            {
                id: `${base}/sub-1`, text: `收集 ${text} 的相关资料`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [],
                deliverables: [`${text} 资料汇总`],
                estimatedMinutes: 30, complexity: 'atomic',
            },
            {
                id: `${base}/sub-2`, text: `分析 ${text} 的可行方案`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [`${base}/sub-1`],
                deliverables: [`${text} 方案对比`],
                estimatedMinutes: 40, complexity: 'atomic',
            },
            {
                id: `${base}/sub-3`, text: `输出 ${text} 的结论与建议`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [`${base}/sub-2`],
                deliverables: [`${text} 调研报告`],
                estimatedMinutes: 20, complexity: 'atomic',
            },
        ];
    },
};

/**
 * 任务类型关键词映射表
 * 用于自动识别任务类型
 */
const TASK_TYPE_KEYWORDS = {
    'development': ['实现', '开发', '编写', '创建', '构建', '重构', '优化', '修复', '代码', '功能', '模块', '接口', 'API', '类', '函数'],
    'configuration': ['配置', '设置', '初始化', '参数', '选项', '调整', '适配', '环境变量', 'config'],
    'documentation': ['文档', '说明', 'README', '注释', '手册', '指南', '教程', '记录', '撰写', '编写.*文档'],
    'testing': ['测试', '验证', '单元测试', '集成测试', '覆盖率', '用例', '断言', 'mock', 'vitest', 'jest'],
    'integration': ['集成', '部署', '发布', 'CI/CD', '流水线', '构建.*部署', '上线', '迁移', '合并', '对接'],
    'research': ['调研', '研究', '分析', '评估', '对比', '选型', '调查', '了解', '学习', '探索', '可行性'],
};

// ─── 复杂度评估模型 ───────────────────────────────────────────────────────────

/**
 * 基于多维度启发式规则评估任务复杂度
 * @param {string} text 任务描述
 * @returns {{ score: number, complexity: TaskComplexity, factors: string[] }}
 */
function assessComplexity(text) {
    const factors = [];
    let score = 1;

    const lower = text.toLowerCase();

    // 维度 1：关键词复杂度权重
    const complexityKeywords = [
        { pattern: /系统|框架|架构|平台|引擎/g, weight: 4, label: '系统级' },
        { pattern: /算法|模型|协议|加密|并发/g, weight: 4, label: '算法级' },
        { pattern: /数据库|缓存|消息队列|存储/g, weight: 3, label: '数据层' },
        { pattern: /安全|认证|授权|审计|权限/g, weight: 3, label: '安全' },
        { pattern: /监控|日志|追踪|指标|告警/g, weight: 2, label: '可观测' },
        { pattern: /兼容|适配|迁移|升级|重构/g, weight: 3, label: '兼容性' },
        { pattern: /优化|性能|内存|CPU|延迟/g, weight: 3, label: '性能' },
        { pattern: /分布式|集群|微服务|容器化/g, weight: 3, label: '分布式' },
    ];

    for (const kw of complexityKeywords) {
        const matches = lower.match(kw.pattern);
        if (matches) {
            score += kw.weight * matches.length;
            factors.push(kw.label);
        }
    }

    // 维度 2：任务长度（描述越长通常越复杂）
    const charCount = text.length;
    if (charCount > 30) {
        score += 1;
        factors.push('长描述');
    }
    if (charCount > 60) {
        score += 2;
        factors.push('超长描述');
    }

    // 维度 3：多动作暗示（包含多个动词通常意味着多步骤）
    const actionPatterns = /(?:实现|开发|编写|创建|配置|测试|部署|集成|优化|重构|分析|设计).+(?:并|且|然后|之后|再|同时).+(?:实现|开发|编写|创建|配置|测试|部署|集成|优化|重构|分析|设计)/;
    if (actionPatterns.test(text)) {
        score += 2;
        factors.push('多动作');
    }
    // 简化的多动作检测：包含两个及以上开发类动词
    const devVerbs = ['实现', '开发', '编写', '创建', '配置', '测试', '部署', '集成', '优化', '重构', '分析', '设计'];
    let verbCount = 0;
    for (const verb of devVerbs) {
        if (text.includes(verb)) verbCount++;
    }
    if (verbCount >= 2) {
        score += 2;
        if (!factors.includes('多动作')) {
            factors.push('多动作');
        }
    }

    // 维度 4：依赖暗示
    if (/依赖|前置|先.*再|等.*完成|基于/g.test(text)) {
        score += 1;
        factors.push('显式依赖');
    }

    // 维度 5：模块/功能数量暗示
    const modulePatterns = /模块|功能|组件|服务|接口/g;
    const moduleMatches = text.match(modulePatterns);
    if (moduleMatches && moduleMatches.length >= 2) {
        score += 1;
        factors.push('多模块');
    }

    // 归一化复杂度等级
    let complexity = 'atomic';
    if (score >= 5) complexity = 'milestone';
    else if (score >= 3) complexity = 'composite';

    return { score, complexity, factors: [...new Set(factors)] };
}

/**
 * 根据任务描述自动识别任务类型
 * @param {string} text
 * @returns {string|null} 返回策略键名或 null
 */
function detectTaskType(text) {
    const lower = text.toLowerCase();
    let bestMatch = null;
    let bestScore = 0;

    for (const [type, keywords] of Object.entries(TASK_TYPE_KEYWORDS)) {
        let score = 0;
        for (const kw of keywords) {
            const regex = new RegExp(kw, 'i');
            if (regex.test(text)) score += 1;
            // 全词匹配加分
            const fullWord = new RegExp(`\\b${kw}\\b`, 'i');
            if (fullWord.test(text)) score += 1;
        }
        if (score > bestScore) {
            bestScore = score;
            bestMatch = type;
        }
    }

    return bestMatch;
}

// ─── TaskDecomposer 类 ───────────────────────────────────────────────────────

class TaskDecomposer extends EventEmitter {
    /**
     * @param {string} projectRoot 项目根目录
     * @param {DecomposerOptions} [options={}] 配置项
     */
    constructor(projectRoot, options = {}) {
        super();
        this.projectRoot = projectRoot || process.cwd();
        this.options = {
            complexityThreshold: options.complexityThreshold ?? 3,
            autoEstimate:        options.autoEstimate        ?? true,
            preserveOriginal:    options.preserveOriginal    ?? true,
        };

        this._log = options.logger instanceof Logger
            ? options.logger.child('Decomposer')
            : createLogger(this.projectRoot, 'Decomposer');

        /** @type {Map<string, Function>} */
        this._strategies = new Map();
        this._registerDefaultStrategies();
    }

    // ─── 策略管理 ──────────────────────────────────────────────────────────────

    /**
     * 注册自定义分解策略
     * @param {string} name 策略名称
     * @param {Function} strategy (taskText, context) => DecomposedTask[]
     */
    registerStrategy(name, strategy) {
        if (typeof strategy !== 'function') {
            throw new ExecutorError(
                '策略必须是函数',
                'ERR_DECOMPOSER_INVALID_STRATEGY',
                { name }
            );
        }
        this._strategies.set(name, strategy);
        this._log.debug('注册分解策略', { name });
    }

    /**
     * 移除已注册策略
     * @param {string} name
     * @returns {boolean}
     */
    unregisterStrategy(name) {
        return this._strategies.delete(name);
    }

    /**
     * 获取所有已注册策略名称
     * @returns {string[]}
     */
    listStrategies() {
        return [...this._strategies.keys()];
    }

    // ─── 核心分解 API ──────────────────────────────────────────────────────────

    /**
     * 分解单个任务
     * @param {{ id?: string, text: string, stageIndex?: number, taskIndex?: number }} task
     * @param {{ force?: boolean, strategy?: string }} [options={}]
     * @returns {DecompositionResult}
     */
    decompose(task, options = {}) {
        if (!task || typeof task.text !== 'string' || !task.text.trim()) {
            throw new PlanError('任务描述不能为空', 'ERR_DECOMPOSER_EMPTY_TASK');
        }

        const text = task.text.trim();
        const baseId = task.id || `s${(task.stageIndex ?? 0) + 1}-t${(task.taskIndex ?? 0) + 1}`;
        const ctx = {
            baseId,
            stageIndex: task.stageIndex ?? 0,
            taskIndex: task.taskIndex ?? 0,
        };

        const assessment = assessComplexity(text);
        const warnings = [];

        this._log.info('评估任务复杂度', {
            taskId: baseId,
            text: text.substring(0, 50),
            score: assessment.score,
            complexity: assessment.complexity,
            factors: assessment.factors,
        });

        // 如果复杂度低于阈值且未强制分解，则返回原任务
        if (!options.force && assessment.score < this.options.complexityThreshold) {
            this.emit('skip', { taskId: baseId, reason: '复杂度低于阈值', assessment });
            return {
                originalId: baseId,
                originalText: text,
                decomposed: false,
                subTasks: [this._wrapAsSubTask(task, assessment)],
                warnings,
            };
        }

        // 选择策略
        let strategyName = options.strategy;
        if (!strategyName) {
            strategyName = detectTaskType(text);
        }

        const strategy = strategyName ? this._strategies.get(strategyName) : null;
        let subTasks;

        if (strategy) {
            subTasks = strategy(text, ctx);
            this._log.info('应用分解策略', { taskId: baseId, strategy: strategyName, subCount: subTasks.length });
        } else {
            // 无匹配策略时使用通用分解
            subTasks = this._genericDecomposition(text, ctx);
            warnings.push(`未识别任务类型，使用通用分解策略（检测到: ${assessment.factors.join(', ') || '无'}）`);
            this._log.warn('使用通用分解策略', { taskId: baseId, factors: assessment.factors });
        }

        // 验证依赖图无循环
        const cycle = this._detectCycle(subTasks);
        if (cycle) {
            throw new ExecutorError(
                `分解结果存在循环依赖: ${cycle.join(' → ')}`,
                'ERR_DECOMPOSER_CYCLE',
                { cycle }
            );
        }

        // 如果需要保留原始任务作为 milestone
        if (this.options.preserveOriginal && subTasks.length > 1) {
            const milestone = {
                id: `${baseId}/milestone`,
                text: `[里程碑] ${text}`,
                stageIndex: ctx.stageIndex,
                taskIndex: ctx.taskIndex,
                status: 'pending',
                dependsOn: subTasks.map(t => t.id),
                deliverables: subTasks.flatMap(t => t.deliverables || []),
                estimatedMinutes: subTasks.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0),
                complexity: 'milestone',
            };
            subTasks.push(milestone);
        }

        this.emit('decomposed', {
            taskId: baseId,
            strategy: strategyName || 'generic',
            subCount: subTasks.length,
        });

        return {
            originalId: baseId,
            originalText: text,
            decomposed: subTasks.length > 1,
            subTasks,
            warnings,
        };
    }

    /**
     * 批量分解计划中的所有任务
     * @param {{ stages: Array<{ tasks: Array<{ text: string, completed?: boolean, dependsOn?: string[] }> }> }} plan
     * @param {{ force?: boolean, stageIndex?: number }} [options={}]
     * @returns {{ plan: Object, decomposed: DecompositionResult[], stats: Object }}
     */
    decomposePlan(plan, options = {}) {
        if (!plan || !Array.isArray(plan.stages)) {
            throw new PlanError('计划数据无效：缺少 stages 数组', 'ERR_DECOMPOSER_INVALID_PLAN');
        }

        const decomposed = [];
        const newStages = [];
        let totalSubTasks = 0;
        let decomposedCount = 0;

        for (let si = 0; si < plan.stages.length; si++) {
            if (options.stageIndex !== undefined && si !== options.stageIndex) {
                newStages.push(plan.stages[si]);
                continue;
            }

            const stage = plan.stages[si];
            const newTasks = [];

            for (let ti = 0; ti < (stage.tasks || []).length; ti++) {
                const task = stage.tasks[ti];
                if (task.completed) {
                    newTasks.push(task);
                    continue;
                }

                const result = this.decompose({
                    id: task.id || `s${si + 1}-t${ti + 1}`,
                    text: task.text,
                    stageIndex: si,
                    taskIndex: ti,
                }, { force: options.force });

                decomposed.push(result);
                if (result.decomposed) {
                    decomposedCount++;
                }
                totalSubTasks += result.subTasks.length;

                // 将子任务加入新任务列表
                for (const sub of result.subTasks) {
                    newTasks.push({
                        text: sub.text,
                        completed: false,
                        dependsOn: sub.dependsOn,
                        deliverables: sub.deliverables,
                        estimatedMinutes: sub.estimatedMinutes,
                        complexity: sub.complexity,
                        parentId: result.originalId,
                    });
                }
            }

            newStages.push({
                ...stage,
                tasks: newTasks,
            });
        }

        const stats = {
            totalTasks: decomposed.length,
            decomposedTasks: decomposedCount,
            totalSubTasks,
            avgSubTasks: decomposed.length > 0 ? Math.round(totalSubTasks / decomposed.length * 10) / 10 : 0,
        };

        this._log.info('计划分解完成', stats);
        this.emit('planDecomposed', { stats });

        return {
            plan: { ...plan, stages: newStages },
            decomposed,
            stats,
        };
    }

    /**
     * 获取任务的拓扑排序执行顺序
     * @param {DecomposedTask[]} subTasks
     * @returns {string[]}
     */
    getExecutionOrder(subTasks) {
        const taskMap = new Map(subTasks.map(t => [t.id, t]));
        const visited = new Set();
        const temp = new Set();
        const order = [];

        const visit = (id) => {
            if (temp.has(id)) {
                throw new ExecutorError(`循环依赖 detected: ${id}`, 'ERR_DECOMPOSER_CYCLE');
            }
            if (visited.has(id)) return;

            temp.add(id);
            const task = taskMap.get(id);
            if (task) {
                for (const depId of task.dependsOn || []) {
                    if (taskMap.has(depId)) {
                        visit(depId);
                    }
                }
            }
            temp.delete(id);
            visited.add(id);
            order.push(id);
        };

        for (const task of subTasks) {
            if (!visited.has(task.id)) {
                visit(task.id);
            }
        }

        return order;
    }

    /**
     * 生成分解报告（Markdown 格式）
     * @param {DecompositionResult[]} results
     * @returns {string}
     */
    generateReport(results) {
        let report = '# 任务分解报告\n\n';
        report += `生成时间: ${new Date().toLocaleString()}\n\n`;

        const decomposed = results.filter(r => r.decomposed);
        report += `## 统计\n\n`;
        report += `- 总任务数: ${results.length}\n`;
        report += `- 已分解: ${decomposed.length}\n`;
        report += `- 保持原子: ${results.length - decomposed.length}\n\n`;

        if (decomposed.length > 0) {
            report += '## 分解详情\n\n';
            for (const result of decomposed) {
                report += `### ${result.originalText}\n\n`;
                report += `**子任务 (${result.subTasks.length} 个):**\n\n`;
                for (const sub of result.subTasks) {
                    const depInfo = sub.dependsOn.length > 0
                        ? `（依赖: ${sub.dependsOn.join(', ')}）`
                        : '';
                    report += `- ${sub.text} ${depInfo}\n`;
                }
                if (result.warnings.length > 0) {
                    report += `\n⚠️ **警告:** ${result.warnings.join('; ')}\n`;
                }
                report += '\n';
            }
        }

        return report;
    }

    // ─── 私有实现 ──────────────────────────────────────────────────────────────

    _registerDefaultStrategies() {
        for (const [name, strategy] of Object.entries(DEFAULT_STRATEGIES)) {
            this._strategies.set(name, strategy);
        }
    }

    _wrapAsSubTask(task, assessment) {
        return {
            id: task.id || `s${(task.stageIndex ?? 0) + 1}-t${(task.taskIndex ?? 0) + 1}`,
            text: task.text,
            stageIndex: task.stageIndex ?? 0,
            taskIndex: task.taskIndex ?? 0,
            status: 'pending',
            dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
            deliverables: [],
            estimatedMinutes: assessment.score * 10,
            complexity: assessment.complexity,
        };
    }

    /**
     * 通用分解策略（当无匹配类型时使用）
     * 基于动作动词将任务拆分为：准备 → 执行 → 验证
     */
    _genericDecomposition(text, ctx) {
        const base = ctx.baseId || 'task';
        return [
            {
                id: `${base}/sub-1`, text: `准备: ${text}`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [],
                deliverables: [`${text} 准备工作完成`],
                estimatedMinutes: 15, complexity: 'atomic',
            },
            {
                id: `${base}/sub-2`, text: `执行: ${text}`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [`${base}/sub-1`],
                deliverables: [`${text} 执行结果`],
                estimatedMinutes: 30, complexity: 'atomic',
            },
            {
                id: `${base}/sub-3`, text: `验证: ${text}`,
                stageIndex: ctx.stageIndex, taskIndex: ctx.taskIndex,
                status: 'pending', dependsOn: [`${base}/sub-2`],
                deliverables: [`${text} 验证报告`],
                estimatedMinutes: 15, complexity: 'atomic',
            },
        ];
    }

    /**
     * 检测子任务列表中的循环依赖
     * @private
     * @param {DecomposedTask[]} subTasks
     * @returns {string[]|null}
     */
    _detectCycle(subTasks) {
        const taskMap = new Map(subTasks.map(t => [t.id, t]));
        const WHITE = 0, GRAY = 1, BLACK = 2;
        const color = new Map();

        for (const task of subTasks) {
            color.set(task.id, WHITE);
        }

        const dfs = (id, path) => {
            color.set(id, GRAY);
            const task = taskMap.get(id);
            if (!task) return null;

            for (const depId of task.dependsOn || []) {
                if (!taskMap.has(depId)) continue;
                const c = color.get(depId);
                if (c === GRAY) {
                    const cycleStart = path.indexOf(depId);
                    return [...path.slice(cycleStart), depId];
                }
                if (c === WHITE) {
                    const result = dfs(depId, [...path, depId]);
                    if (result) return result;
                }
            }
            color.set(id, BLACK);
            return null;
        };

        for (const task of subTasks) {
            if (color.get(task.id) === WHITE) {
                const result = dfs(task.id, [task.id]);
                if (result) return result;
            }
        }
        return null;
    }
}

module.exports = { TaskDecomposer, assessComplexity, detectTaskType, DEFAULT_STRATEGIES };

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0] || 'help';
    const root = process.cwd();

    const decomposer = new TaskDecomposer(root);

    switch (command) {
    case 'decompose': {
        const text = args.slice(1).join(' ');
        if (!text) {
            console.log('用法: node core/decomposer.js decompose "<任务描述>"');
            process.exit(1);
        }
        const result = decomposer.decompose({ text });
        console.log(JSON.stringify(result, null, 2));
        break;
    }

    case 'assess': {
        const text = args.slice(1).join(' ');
        if (!text) {
            console.log('用法: node core/decomposer.js assess "<任务描述>"');
            process.exit(1);
        }
        const assessment = assessComplexity(text);
        console.log(`复杂度评分: ${assessment.score}`);
        console.log(`复杂度等级: ${assessment.complexity}`);
        console.log(`影响因素: ${assessment.factors.join(', ') || '无'}`);
        break;
    }

    case 'plan': {
        const PlanManager = require('./planner');
        const planner = new PlanManager(root);
        const plan = planner.readPlan();
        const result = decomposer.decomposePlan(plan);
        console.log(decomposer.generateReport(result.decomposed));
        break;
    }

    case 'strategies': {
        console.log('已注册分解策略:');
        for (const name of decomposer.listStrategies()) {
            console.log(`  - ${name}`);
        }
        break;
    }

    default:
        console.log('CodeWork 2.0 — 任务分解算法\n');
        console.log('用法:');
        console.log('  node core/decomposer.js decompose "<任务描述>"  分解单个任务');
        console.log('  node core/decomposer.js assess "<任务描述>"     评估复杂度');
        console.log('  node core/decomposer.js plan                     分解当前计划');
        console.log('  node core/decomposer.js strategies               列出所有策略');
    }
}
