/**
 * CodeWork 2.0 - 自定义错误类层次
 *
 * 错误层次：
 *   CodeWorkError             ← 所有错误的基类
 *   ├── ConfigError           ← 配置加载 / 验证失败
 *   ├── PlanError             ← PLAN.md 解析 / 状态错误
 *   ├── ExecutorError         ← 任务执行引擎错误
 *   │   ├── TaskError         ← 单个任务失败
 *   │   └── QueueError        ← 队列操作错误
 *   ├── TrackerError          ← 会话追踪错误
 *   └── DeliverError          ← 交付物管理错误
 *       └── VerificationError ← 文件完整性验证失败
 *
 * 设计原则：
 *  - 每个错误携带 `code`（字符串常量）方便程序判断，不依赖 message 字符串匹配
 *  - 携带 `context` 对象，附加与错误相关的运行时信息
 *  - 所有类可单独 require，彼此无循环依赖
 */

'use strict';

// ─── 基类 ─────────────────────────────────────────────────────────────────────

/**
 * CodeWork 所有自定义错误的基类
 */
class CodeWorkError extends Error {
    /**
     * @param {string} message   人类可读的错误描述
     * @param {string} code      机器可读的错误代码，例如 'ERR_CONFIG_MISSING'
     * @param {Object} [context={}]  运行时附加信息（路径、参数、状态等）
     */
    constructor(message, code = 'ERR_CODEWORK', context = {}) {
        super(message);
        this.name    = 'CodeWorkError';
        this.code    = code;
        this.context = context;

        // 确保 instanceof 在 ES5 polyfill 环境中可靠工作
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, new.target);
        }
    }

    /**
     * 序列化为可记录的纯对象
     * @returns {{ name: string, code: string, message: string, context: Object }}
     */
    toJSON() {
        return {
            name:    this.name,
            code:    this.code,
            message: this.message,
            context: this.context,
        };
    }

    /**
     * 友好的字符串表示（方便 console.log）
     * @returns {string}
     */
    toString() {
        const ctx = Object.keys(this.context).length
            ? ` | context: ${JSON.stringify(this.context)}`
            : '';
        return `[${this.name}:${this.code}] ${this.message}${ctx}`;
    }
}

// ─── 配置错误 ─────────────────────────────────────────────────────────────────

/**
 * 配置加载或验证失败
 */
class ConfigError extends CodeWorkError {
    /**
     * @param {string} message
     * @param {'ERR_CONFIG_MISSING'|'ERR_CONFIG_INVALID'|'ERR_CONFIG_PARSE'} [code]
     * @param {Object} [context]
     */
    constructor(message, code = 'ERR_CONFIG_INVALID', context = {}) {
        super(message, code, context);
        this.name = 'ConfigError';
    }

    /** 工厂：配置文件不存在 */
    static notFound(filePath) {
        return new ConfigError(
            `配置文件不存在: ${filePath}`,
            'ERR_CONFIG_MISSING',
            { filePath }
        );
    }

    /** 工厂：JSON 解析失败 */
    static parseError(filePath, originalError) {
        return new ConfigError(
            `配置文件解析失败: ${filePath}`,
            'ERR_CONFIG_PARSE',
            { filePath, originalMessage: originalError?.message }
        );
    }

    /** 工厂：必填字段缺失 */
    static missingFields(fields) {
        return new ConfigError(
            `配置缺少必填字段: ${fields.join(', ')}`,
            'ERR_CONFIG_INVALID',
            { missingFields: fields }
        );
    }
}

// ─── 计划错误 ─────────────────────────────────────────────────────────────────

/**
 * PLAN.md 解析或状态操作错误
 */
class PlanError extends CodeWorkError {
    constructor(message, code = 'ERR_PLAN', context = {}) {
        super(message, code, context);
        this.name = 'PlanError';
    }

    static notFound(planPath) {
        return new PlanError(
            `PLAN.md 不存在: ${planPath}`,
            'ERR_PLAN_NOT_FOUND',
            { planPath }
        );
    }

    static invalidStage(stageIndex, total) {
        return new PlanError(
            `无效的阶段索引 ${stageIndex}（共 ${total} 个阶段）`,
            'ERR_PLAN_INVALID_STAGE',
            { stageIndex, total }
        );
    }
}

// ─── 执行器错误 ───────────────────────────────────────────────────────────────

/**
 * 任务执行引擎级别的错误
 */
class ExecutorError extends CodeWorkError {
    constructor(message, code = 'ERR_EXECUTOR', context = {}) {
        super(message, code, context);
        this.name = 'ExecutorError';
    }

    /** 工厂：执行器已在运行 */
    static alreadyRunning() {
        return new ExecutorError(
            '执行器已在运行，不可重复启动',
            'ERR_EXECUTOR_RUNNING'
        );
    }
}

/**
 * 单个任务执行失败
 */
class TaskError extends ExecutorError {
    /**
     * @param {string} taskId
     * @param {string} message
     * @param {Error}  [originalError]
     */
    constructor(taskId, message, originalError = null) {
        super(
            `任务 ${taskId} 失败: ${message}`,
            'ERR_TASK_FAILED',
            {
                taskId,
                originalMessage: originalError?.message,
                originalStack:   originalError?.stack,
            }
        );
        this.name = 'TaskError';
        this.taskId = taskId;
        this.original = originalError;
    }

    /** 工厂：超过最大重试次数 */
    static maxRetriesExceeded(taskId, maxRetries, lastError) {
        const err = new TaskError(
            taskId,
            `超过最大重试次数 (${maxRetries})`,
            lastError
        );
        err.code = 'ERR_TASK_MAX_RETRIES';
        err.context.maxRetries = maxRetries;
        return err;
    }
}

/**
 * 队列操作错误
 */
class QueueError extends ExecutorError {
    constructor(message, context = {}) {
        super(message, 'ERR_QUEUE', context);
        this.name = 'QueueError';
    }
}

// ─── 追踪器错误 ───────────────────────────────────────────────────────────────

/**
 * 会话追踪错误
 */
class TrackerError extends CodeWorkError {
    constructor(message, code = 'ERR_TRACKER', context = {}) {
        super(message, code, context);
        this.name = 'TrackerError';
    }

    /** 工厂：未开启会话就记录任务 */
    static noActiveSession() {
        return new TrackerError(
            '没有活动中的追踪会话，请先调用 startSession()',
            'ERR_TRACKER_NO_SESSION'
        );
    }

    /** 工厂：历史文件读写失败 */
    static ioError(filePath, originalError) {
        return new TrackerError(
            `追踪历史 I/O 错误: ${filePath}`,
            'ERR_TRACKER_IO',
            { filePath, originalMessage: originalError?.message }
        );
    }
}

// ─── 交付物错误 ───────────────────────────────────────────────────────────────

/**
 * 交付物管理错误
 */
class DeliverError extends CodeWorkError {
    constructor(message, code = 'ERR_DELIVER', context = {}) {
        super(message, code, context);
        this.name = 'DeliverError';
    }

    /** 工厂：源文件不存在 */
    static sourceNotFound(srcPath) {
        return new DeliverError(
            `交付物源文件不存在: ${srcPath}`,
            'ERR_DELIVER_SRC_MISSING',
            { srcPath }
        );
    }

    /** 工厂：输出目录创建失败 */
    static outputDirError(outputDir, originalError) {
        return new DeliverError(
            `无法创建输出目录: ${outputDir}`,
            'ERR_DELIVER_OUTPUT_DIR',
            { outputDir, originalMessage: originalError?.message }
        );
    }
}

/**
 * 文件完整性验证失败
 */
class VerificationError extends DeliverError {
    /**
     * @param {string} filePath
     * @param {string} expected  期望的 checksum
     * @param {string} actual    实际的 checksum
     */
    constructor(filePath, expected, actual) {
        super(
            `文件校验和不匹配: ${filePath}`,
            'ERR_VERIFY_CHECKSUM',
            { filePath, expected, actual }
        );
        this.name = 'VerificationError';
    }

    /** 工厂：空文件 */
    static emptyFile(filePath) {
        const err = new VerificationError(filePath, '>0 bytes', '0 bytes');
        err.code = 'ERR_VERIFY_EMPTY';
        return err;
    }
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 判断是否为 CodeWork 错误（跨模块 instanceof 的替代）
 * @param {*} err
 * @returns {boolean}
 */
function isCodeWorkError(err) {
    return err instanceof CodeWorkError;
}

/**
 * 将普通 Error 包装为 CodeWorkError（如果尚未是）
 * @param {Error|*} err
 * @param {string}  [code]
 * @returns {CodeWorkError}
 */
function wrapError(err, code = 'ERR_CODEWORK_WRAPPED') {
    if (err instanceof CodeWorkError) return err;
    const wrapped = new CodeWorkError(
        err?.message || String(err),
        code,
        { originalStack: err?.stack }
    );
    return wrapped;
}

class NotificationError extends CodeWorkError {
    constructor(message, code = 'ERR_NOTIFICATION', context = {}) {
        super(message, code, context);
        this.name = 'NotificationError';
    }
}

// ─── 导出 ─────────────────────────────────────────────────────────────────────

module.exports = {
    CodeWorkError,
    ConfigError,
    PlanError,
    ExecutorError,
    TaskError,
    QueueError,
    TrackerError,
    DeliverError,
    VerificationError,
    NotificationError,
    isCodeWorkError,
    wrapError,
};
