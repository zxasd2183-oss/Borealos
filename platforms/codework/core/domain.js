/**
 * CodeWork 2.0 — 核心领域模型与状态管理
 *
 * 负责：
 *  - 定义计划 / 阶段 / 任务等核心实体
 *  - 维护实体关系映射与索引
 *  - 提供序列化 / 反序列化能力
 *  - 提供基础数据验证
 *  - 提供可持久化的领域状态仓库
 */

'use strict';

const fs = require('fs');
const path = require('path');

const TASK_STATUSES = ['pending', 'in_progress', 'running', 'completed', 'blocked', 'skipped', 'failed', 'cancelled'];
const STAGE_STATUSES = ['pending', 'in_progress', 'completed', 'blocked'];
const ENTITY_KINDS = ['plan', 'stage', 'task'];
const DEFAULT_STATE_FILE = path.join('.codework', 'domain-state.json');

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

class ValidationError extends Error {
    constructor(message, details = []) {
        super(message);
        this.name = 'ValidationError';
        this.details = details;
    }
}

class BaseEntity {
    constructor(kind, data = {}) {
        if (!ENTITY_KINDS.includes(kind)) {
            throw new ValidationError(`不支持的实体类型: ${kind}`);
        }

        this.kind = kind;
        this.id = data.id || null;
        this.createdAt = data.createdAt || null;
        this.updatedAt = data.updatedAt || null;
        this.meta = { ...(data.meta || {}) };
    }

    touch() {
        this.updatedAt = new Date().toISOString();
        if (!this.createdAt) {
            this.createdAt = this.updatedAt;
        }
    }

    toJSON() {
        return {
            kind: this.kind,
            id: this.id,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            meta: deepClone(this.meta),
        };
    }
}

class TaskEntity extends BaseEntity {
    constructor(data = {}) {
        super('task', data);
        this.stageId = data.stageId || null;
        this.planId = data.planId || null;
        this.text = data.text || '';
        this.status = data.status || 'pending';
        this.dependencies = Array.isArray(data.dependencies) ? [...data.dependencies] : [];
        this.deliverables = Array.isArray(data.deliverables) ? [...data.deliverables] : [];
        this.validation = { ...(data.validation || {}) };
    }

    isTerminal() {
        return ['completed', 'blocked', 'skipped', 'failed'].includes(this.status);
    }

    toJSON() {
        return {
            ...super.toJSON(),
            stageId: this.stageId,
            planId: this.planId,
            text: this.text,
            status: this.status,
            dependencies: [...this.dependencies],
            deliverables: [...this.deliverables],
            validation: deepClone(this.validation),
        };
    }

    static fromJSON(data) {
        return new TaskEntity(data);
    }
}

class StageEntity extends BaseEntity {
    constructor(data = {}) {
        super('stage', data);
        this.planId = data.planId || null;
        this.name = data.name || '';
        this.status = data.status || 'pending';
        this.index = Number.isInteger(data.index) ? data.index : 0;
        this.taskIds = Array.isArray(data.taskIds) ? [...data.taskIds] : [];
        this.deliverables = Array.isArray(data.deliverables) ? [...data.deliverables] : [];
        this.acceptance = Array.isArray(data.acceptance) ? [...data.acceptance] : [];
    }

    toJSON() {
        return {
            ...super.toJSON(),
            planId: this.planId,
            name: this.name,
            status: this.status,
            index: this.index,
            taskIds: [...this.taskIds],
            deliverables: [...this.deliverables],
            acceptance: [...this.acceptance],
        };
    }

    static fromJSON(data) {
        return new StageEntity(data);
    }
}

class PlanEntity extends BaseEntity {
    constructor(data = {}) {
        super('plan', data);
        this.name = data.name || 'CodeWork Plan';
        this.source = data.source || 'PLAN.md';
        this.version = data.version || '2.0.0';
        this.stageIds = Array.isArray(data.stageIds) ? [...data.stageIds] : [];
        this.summary = data.summary || '';
    }

    toJSON() {
        return {
            ...super.toJSON(),
            name: this.name,
            source: this.source,
            version: this.version,
            stageIds: [...this.stageIds],
            summary: this.summary,
        };
    }

    static fromJSON(data) {
        return new PlanEntity(data);
    }
}

class DomainRegistry {
    constructor() {
        this.entities = new Map();
        this.relationships = {
            planToStages: new Map(),
            stageToTasks: new Map(),
            taskDependencies: new Map(),
        };
    }

    add(entity) {
        const normalized = DomainFactory.fromJSON(entity && entity.toJSON ? entity.toJSON() : entity);
        const validation = DomainValidator.validateEntity(normalized.toJSON());
        if (!validation.valid) {
            throw new ValidationError('实体校验失败', validation.errors);
        }

        this._assertEntityIntegrity(normalized);

        const existing = this.entities.get(normalized.id);
        if (existing) {
            this._removeRelationships(existing);
        }

        this.entities.set(normalized.id, normalized);
        this._syncRelationships(normalized);
        return normalized;
    }

    /**
     * 在全部实体添加完成后，验证整体完整性
     */
    validateIntegrity() {
        const errors = [];
        for (const entity of this.entities.values()) {
            try {
                this._assertEntityIntegrity(entity);
            } catch (err) {
                if (err instanceof ValidationError) {
                    errors.push(...err.details);
                } else {
                    errors.push(err.message);
                }
            }
        }
        return { valid: errors.length === 0, errors };
    }

    get(id) {
        return this.entities.get(id) || null;
    }

    getAll(kind) {
        return [...this.entities.values()].filter(entity => !kind || entity.kind === kind);
    }

    remove(id) {
        const entity = this.entities.get(id);
        if (!entity) {
            return false;
        }
        this.entities.delete(id);
        this._removeRelationships(entity);
        return true;
    }

    getPlanTree(planId) {
        const plan = this.get(planId);
        if (!plan || plan.kind !== 'plan') {
            return null;
        }

        // 先验证引用完整性
        const integrity = this.validateIntegrity();
        if (!integrity.valid) {
            throw new ValidationError(`计划 ${planId} 存在无效引用`, integrity.errors);
        }

        const stageIds = this.relationships.planToStages.get(planId) || [];
        return {
            plan: plan.toJSON(),
            stages: stageIds.map(stageId => {
                const stage = this.get(stageId);
                if (!stage) {
                    throw new ValidationError(`阶段不存在: ${stageId}`);
                }
                const taskIds = this.relationships.stageToTasks.get(stageId) || [];
                return {
                    ...stage.toJSON(),
                    tasks: taskIds.map(taskId => {
                        const task = this.get(taskId);
                        if (!task) {
                            throw new ValidationError(`任务不存在: ${taskId}`);
                        }
                        return task.toJSON();
                    }),
                };
            }),
        };
    }

    serialize() {
        return {
            entities: this.getAll().map(entity => entity.toJSON()),
            relationships: {
                planToStages: mapToObject(this.relationships.planToStages),
                stageToTasks: mapToObject(this.relationships.stageToTasks),
                taskDependencies: mapToObject(this.relationships.taskDependencies),
            },
        };
    }

    static deserialize(payload = {}) {
        const registry = new DomainRegistry();
        const entities = Array.isArray(payload.entities) ? payload.entities : [];
        entities.forEach(entity => registry.add(DomainFactory.fromJSON(entity)));
        return registry;
    }

    validateReferences() {
        return DomainValidator.validateRegistry(this);
    }

    _assertEntityIntegrity(entity) {
        if (entity.kind === 'plan') {
            return;
        }

        if (entity.kind === 'stage') {
            this._assertParentPlanExists(entity);
            this._assertStageTaskReferences(entity);
            return;
        }

        if (entity.kind === 'task') {
            this._assertParentPlanExists(entity);
            this._assertParentStageExists(entity);
            this._assertTaskFitsStagePlan(entity);
            this._assertTaskDependencyReferences(entity);
        }
    }

    _assertParentPlanExists(entity) {
        const parentPlan = this.get(entity.planId);
        if (!parentPlan) {
            throw new ValidationError(`关联计划不存在: ${entity.planId}`);
        }
        if (parentPlan.kind !== 'plan') {
            throw new ValidationError(`关联实体不是计划: ${entity.planId}`);
        }
    }

    _assertParentStageExists(entity) {
        const parentStage = this.get(entity.stageId);
        if (!parentStage) {
            throw new ValidationError(`关联阶段不存在: ${entity.stageId}`);
        }
        if (parentStage.kind !== 'stage') {
            throw new ValidationError(`关联实体不是阶段: ${entity.stageId}`);
        }
    }

    _assertStageTaskReferences(stage) {
        stage.taskIds.forEach(taskId => {
            const task = this.get(taskId);
            if (!task) {
                return;
            }
            if (task.kind !== 'task') {
                throw new ValidationError(`阶段 ${stage.id} 引用了非任务实体: ${taskId}`);
            }
            if (task.stageId !== stage.id) {
                throw new ValidationError(`阶段 ${stage.id} 与任务 ${taskId} 的 stageId 不一致`);
            }
            if (task.planId !== stage.planId) {
                throw new ValidationError(`阶段 ${stage.id} 与任务 ${taskId} 的 planId 不一致`);
            }
        });
    }

    _assertTaskFitsStagePlan(task) {
        const parentStage = this.get(task.stageId);
        if (parentStage.planId !== task.planId) {
            throw new ValidationError(`任务 ${task.id} 的 planId 与所属阶段不一致`);
        }
    }

    _assertTaskDependencyReferences(task) {
        task.dependencies.forEach(depId => {
            const dependency = this.get(depId);
            if (!dependency) {
                throw new ValidationError(`任务 ${task.id} 依赖不存在: ${depId}`);
            }
            if (dependency.kind !== 'task') {
                throw new ValidationError(`任务 ${task.id} 依赖了非任务实体: ${depId}`);
            }
            if (dependency.planId !== task.planId) {
                throw new ValidationError(`任务 ${task.id} 依赖了不同计划的任务: ${depId}`);
            }
        });
    }

    _syncRelationships(entity) {
        if (entity.kind === 'plan') {
            this.relationships.planToStages.set(entity.id, [...entity.stageIds]);
        }

        if (entity.kind === 'stage') {
            const stageIds = this.relationships.planToStages.get(entity.planId) || [];
            if (!stageIds.includes(entity.id)) {
                stageIds.push(entity.id);
            }
            stageIds.sort((a, b) => {
                const left = this.get(a);
                const right = this.get(b);
                return (left ? left.index : Number.MAX_SAFE_INTEGER) - (right ? right.index : Number.MAX_SAFE_INTEGER);
            });
            this.relationships.planToStages.set(entity.planId, stageIds);
            this.relationships.stageToTasks.set(entity.id, [...entity.taskIds]);
        }

        if (entity.kind === 'task') {
            const taskIds = this.relationships.stageToTasks.get(entity.stageId) || [];
            if (!taskIds.includes(entity.id)) {
                taskIds.push(entity.id);
                this.relationships.stageToTasks.set(entity.stageId, taskIds);
            }
            this.relationships.taskDependencies.set(entity.id, [...entity.dependencies]);
        }
    }

    _removeRelationships(entity) {
        if (entity.kind === 'plan') {
            this.relationships.planToStages.delete(entity.id);
        }
        if (entity.kind === 'stage') {
            this.relationships.stageToTasks.delete(entity.id);
            const stageIds = this.relationships.planToStages.get(entity.planId) || [];
            this.relationships.planToStages.set(entity.planId, stageIds.filter(id => id !== entity.id));
        }
        if (entity.kind === 'task') {
            this.relationships.taskDependencies.delete(entity.id);
            const taskIds = this.relationships.stageToTasks.get(entity.stageId) || [];
            this.relationships.stageToTasks.set(entity.stageId, taskIds.filter(id => id !== entity.id));
        }
    }
}

class DomainState {
    constructor(projectRoot, options = {}) {
        this.projectRoot = projectRoot || process.cwd();
        this.statePath = path.join(this.projectRoot, options.stateFile || DEFAULT_STATE_FILE);
        this.registry = new DomainRegistry();
    }

    load() {
        if (!fs.existsSync(this.statePath)) {
            return this.registry;
        }

        const raw = JSON.parse(fs.readFileSync(this.statePath, 'utf-8'));
        this.registry = DomainRegistry.deserialize(raw);
        return this.registry;
    }

    save() {
        ensureDirectory(path.dirname(this.statePath));
        fs.writeFileSync(this.statePath, JSON.stringify(this.registry.serialize(), null, 2), 'utf-8');
        return this.statePath;
    }

    replace(registry) {
        this.registry = registry;
        return this;
    }

    importPlan(planData, options = {}) {
        const normalized = DomainNormalizer.fromPlan(planData, options);
        this.registry = normalized;
        return this.registry;
    }

    updateTaskStatus(taskId, status) {
        const task = this.registry.get(taskId);
        if (!task || task.kind !== 'task') {
            throw new ValidationError(`任务不存在: ${taskId}`);
        }
        if (!TASK_STATUSES.includes(status)) {
            throw new ValidationError(`无效的任务状态: ${status}`);
        }

        task.status = status;
        task.touch();
        this.registry.add(task);

        const stage = this.registry.get(task.stageId);
        if (stage) {
            stage.status = deriveStageStatus(stage, this.registry);
            stage.touch();
            this.registry.add(stage);
        }

        return task;
    }

    snapshot() {
        return this.registry.serialize();
    }
}

class DomainFactory {
    static fromJSON(data = {}) {
        switch (data.kind) {
        case 'plan':
            return PlanEntity.fromJSON(data);
        case 'stage':
            return StageEntity.fromJSON(data);
        case 'task':
            return TaskEntity.fromJSON(data);
        default:
            throw new ValidationError(`未知实体 kind: ${data.kind}`);
        }
    }
}

class DomainNormalizer {
    static fromPlan(planData, options = {}) {
        const validation = DomainValidator.validatePlan(planData);
        if (!validation.valid) {
            throw new ValidationError('计划数据校验失败', validation.errors);
        }

        const registry = new DomainRegistry();
        const planId = options.planId || 'plan-main';
        const plan = new PlanEntity({
            id: planId,
            name: options.name || 'CodeWork 2.0 Plan',
            source: options.source || 'PLAN.md',
            version: options.version || '2.0.0',
            summary: options.summary || '',
            stageIds: [],
        });
        plan.touch();
        registry.add(plan);

        const stageIds = [];
        planData.stages.forEach((stageData, stageIndex) => {
            const stageId = `stage-${String(stageIndex + 1).padStart(2, '0')}`;
            const taskIds = [];
            const stage = new StageEntity({
                id: stageId,
                planId,
                name: stageData.name,
                status: 'pending',
                index: stageIndex,
                taskIds,
                deliverables: [...(stageData.deliverables || [])],
                acceptance: [...(stageData.acceptance || [])],
            });
            stage.touch();
            registry.add(stage);

            stageData.tasks.forEach((taskData, taskIndex) => {
                const taskId = `${stageId}-task-${String(taskIndex + 1).padStart(2, '0')}`;
                const task = new TaskEntity({
                    id: taskId,
                    stageId,
                    planId,
                    text: taskData.text,
                    status: taskData.status || 'pending',
                    dependencies: normalizeDependencies(taskData.dependencies, taskIds),
                    deliverables: [...(taskData.deliverables || [])],
                    validation: {
                        requiredText: true,
                    },
                });
                task.touch();
                taskIds.push(taskId);
                registry.add(task);
            });

            stage.taskIds = [...taskIds];
            stage.status = deriveStageStatus(stage, registry);
            registry.add(stage);
            stage.status = deriveStageStatus(stage, registry);
            registry.add(stage);
            stageIds.push(stageId);
        });

        plan.stageIds = stageIds;
        registry.add(plan);

        // 全部实体添加完成后，验证整体完整性
        const integrity = registry.validateIntegrity();
        if (!integrity.valid) {
            throw new ValidationError('领域状态完整性校验失败', integrity.errors);
        }

        return registry;
    }
}

class DomainValidator {
    static validateEntity(entity) {
        const errors = [];
        if (!entity || typeof entity !== 'object') {
            return { valid: false, errors: ['实体必须是对象'] };
        }
        if (!ENTITY_KINDS.includes(entity.kind)) {
            errors.push(`实体类型无效: ${entity.kind}`);
        }
        if (!isNonEmptyString(entity.id)) {
            errors.push('实体 id 不能为空');
        }

        if (entity.kind === 'plan') {
            if (!isNonEmptyString(entity.name)) {
                errors.push('计划名称不能为空');
            }
            if (!Array.isArray(entity.stageIds)) {
                errors.push('计划 stageIds 必须为数组');
            }
        }

        if (entity.kind === 'stage') {
            if (!isNonEmptyString(entity.planId)) {
                errors.push('阶段必须关联 planId');
            }
            if (!isNonEmptyString(entity.name)) {
                errors.push('阶段名称不能为空');
            }
            if (!STAGE_STATUSES.includes(entity.status)) {
                errors.push(`阶段状态无效: ${entity.status}`);
            }
            if (!Array.isArray(entity.taskIds)) {
                errors.push('阶段 taskIds 必须为数组');
            }
        }

        if (entity.kind === 'task') {
            if (!isNonEmptyString(entity.planId)) {
                errors.push('任务必须关联 planId');
            }
            if (!isNonEmptyString(entity.stageId)) {
                errors.push('任务必须关联 stageId');
            }
            if (!isNonEmptyString(entity.text)) {
                errors.push('任务文本不能为空');
            }
            if (!TASK_STATUSES.includes(entity.status)) {
                errors.push(`任务状态无效: ${entity.status}`);
            }
            if (!Array.isArray(entity.dependencies)) {
                errors.push('任务 dependencies 必须为数组');
            }
        }

        return { valid: errors.length === 0, errors };
    }

    static validatePlan(planData) {
        const errors = [];
        if (!planData || typeof planData !== 'object') {
            return { valid: false, errors: ['计划数据必须是对象'] };
        }
        if (!Array.isArray(planData.stages) || planData.stages.length === 0) {
            errors.push('计划必须至少包含一个阶段');
        }

        (planData.stages || []).forEach((stage, stageIndex) => {
            if (!isNonEmptyString(stage.name)) {
                errors.push(`阶段 ${stageIndex + 1} 缺少名称`);
            }
            if (!Array.isArray(stage.tasks)) {
                errors.push(`阶段 ${stageIndex + 1} 的 tasks 必须为数组`);
                return;
            }
            stage.tasks.forEach((task, taskIndex) => {
                if (!isNonEmptyString(task.text)) {
                    errors.push(`阶段 ${stageIndex + 1} 任务 ${taskIndex + 1} 文本不能为空`);
                }
                if (task.status && !TASK_STATUSES.includes(task.status)) {
                    errors.push(`阶段 ${stageIndex + 1} 任务 ${taskIndex + 1} 状态无效: ${task.status}`);
                }
            });
        });

        return { valid: errors.length === 0, errors };
    }

    static validateRegistry(registry) {
        const errors = [];
        registry.getAll().forEach(entity => {
            const result = DomainValidator.validateEntity(entity.toJSON ? entity.toJSON() : entity);
            if (!result.valid) {
                errors.push(...result.errors.map(error => `${entity.id}: ${error}`));
            }
        });

        registry.getAll('plan').forEach(plan => {
            const relatedStageIds = new Set([
                ...(plan.stageIds || []),
                ...(registry.relationships.planToStages.get(plan.id) || []),
            ]);
            relatedStageIds.forEach(stageId => {
                const stage = registry.get(stageId);
                if (!stage) {
                    errors.push(`${plan.id}: 阶段不存在 ${stageId}`);
                    return;
                }
                if (stage.kind !== 'stage') {
                    errors.push(`${plan.id}: 引用了非阶段实体 ${stageId}`);
                    return;
                }
                if (stage.planId !== plan.id) {
                    errors.push(`${plan.id}: 阶段 ${stageId} 关联到其他计划 ${stage.planId}`);
                }
            });
        });

        registry.getAll('stage').forEach(stage => {
            stage.taskIds.forEach(taskId => {
                const task = registry.get(taskId);
                if (!task) {
                    errors.push(`${stage.id}: 任务不存在 ${taskId}`);
                    return;
                }
                if (task.kind !== 'task') {
                    errors.push(`${stage.id}: 引用了非任务实体 ${taskId}`);
                    return;
                }
                if (task.stageId !== stage.id) {
                    errors.push(`${stage.id}: 任务 ${taskId} 关联到其他阶段 ${task.stageId}`);
                }
                if (task.planId !== stage.planId) {
                    errors.push(`${stage.id}: 任务 ${taskId} 关联到其他计划 ${task.planId}`);
                }
            });
        });

        registry.getAll('task').forEach(task => {
            task.dependencies.forEach(depId => {
                const dependency = registry.get(depId);
                if (!dependency) {
                    errors.push(`${task.id}: 依赖任务不存在 ${depId}`);
                    return;
                }
                if (dependency.kind !== 'task') {
                    errors.push(`${task.id}: 依赖实体不是任务 ${depId}`);
                    return;
                }
                if (dependency.planId !== task.planId) {
                    errors.push(`${task.id}: 依赖任务属于其他计划 ${depId}`);
                }
            });
        });

        return { valid: errors.length === 0, errors };
    }
}

/**
 * 根据子任务状态推导阶段状态
 * @param {{ taskIds?: string[], tasks?: Array<{status?:string}> }} stageLike
 * @param {DomainRegistry|null} registry  存在时通过 taskIds 查询；为 null 时用 tasks 数组
 * @returns {'pending'|'in_progress'|'completed'|'blocked'}
 */
function deriveStageStatus(stageLike, registry) {
    const taskStatuses = registry
        ? (stageLike.taskIds || []).map(taskId => registry.get(taskId)).filter(Boolean).map(task => task.status)
        : (stageLike.tasks || []).map(task => task.status || 'pending');

    if (taskStatuses.length === 0) {
        return 'pending';
    }
    if (taskStatuses.every(status => status === 'completed' || status === 'skipped')) {
        return 'completed';
    }
    if (taskStatuses.some(status => status === 'blocked' || status === 'failed' || status === 'cancelled')) {
        return 'blocked';
    }
    if (taskStatuses.some(status => status === 'in_progress' || status === 'running' || status === 'completed')) {
        return 'in_progress';
    }
    return 'pending';
}

/**
 * 将依赖列表规化为任务 ID 字符串数组
 * @param {Array<string|number>|*} rawDependencies  原始依赖列表（元素可为任务 ID 字符串或引用索引数字）
 * @param {string[]} previousTaskIds  当前阶段已注册的任务 ID，数字引用用于索引这个数组
 * @returns {string[]}
 */
function normalizeDependencies(rawDependencies, previousTaskIds) {
    if (!Array.isArray(rawDependencies)) {
        return [];
    }

    return rawDependencies.map(dependency => {
        if (typeof dependency === 'number') {
            return previousTaskIds[dependency] || null;
        }
        return dependency;
    }).filter(Boolean);
}

/**
 * 确保目录存在，不存在则递归创建
 * @param {string} dirPath
 * @returns {void}
 */
function ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * 将 Map<string, string[]> 转换为普通对象（用于 JSON 序列化）
 * @param {Map<string, string[]>} map
 * @returns {Record<string, string[]>}
 */
function mapToObject(map) {
    return Object.fromEntries([...map.entries()].map(([key, value]) => [key, [...value]]));
}

module.exports = {
    TASK_STATUSES,
    STAGE_STATUSES,
    ValidationError,
    BaseEntity,
    TaskEntity,
    StageEntity,
    PlanEntity,
    DomainFactory,
    DomainRegistry,
    DomainNormalizer,
    DomainState,
    DomainValidator,
    deriveStageStatus,
};
