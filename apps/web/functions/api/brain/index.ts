// Cloudflare Pages Function: /api/brain
// 记忆大脑（BRAIN.md）管理接口
// 每个项目维护一份 BRAIN.md，包含架构描述、开发进度、开发规范、上下文信息

declare global {
  var __borealosBrainStore: Map<string, any> | undefined;
}

/** 记忆大脑各部分内容 */
interface BrainSections {
  architecture: string; // 架构描述
  progress: string; // 开发进度
  norms: string; // 开发规范
  context: string; // 上下文信息
}

/** 记忆大脑数据结构 */
interface BrainData {
  projectId: string;
  content: string; // 完整 BRAIN.md 内容
  sections: BrainSections;
  updatedAt: number;
  version: number;
  history: Array<{ timestamp: number; action: string; section?: string }>;
}

/** section key 与模板中标题的映射 */
const SECTION_TITLES: Record<keyof BrainSections, string> = {
  architecture: '架构描述',
  progress: '开发进度',
  norms: '开发规范',
  context: '上下文信息',
};

/** 标题到 section key 的反向映射（用于解析完整内容） */
const TITLE_TO_SECTION: Record<string, keyof BrainSections> = {
  '架构描述': 'architecture',
  '开发进度': 'progress',
  '开发规范': 'norms',
  '上下文信息': 'context',
};

/** POST 允许的 section 值 */
const VALID_POST_SECTIONS: string[] = ['architecture', 'progress', 'norms', 'full'];

/** PUT 允许的 section 值（追加到具体部分） */
const VALID_PUT_SECTIONS: string[] = ['architecture', 'progress', 'norms', 'context'];

/** 历史记录最大条数 */
const MAX_HISTORY = 100;

/** 默认占位文本 */
const PLACEHOLDER = '（待填写）';

// ---------------------------------------------------------------------------
// 存储管理
// ---------------------------------------------------------------------------

/** 获取全局记忆大脑存储（同一隔离环境内有效） */
function getBrainStore(): Map<string, BrainData> {
  if (!globalThis.__borealosBrainStore) {
    globalThis.__borealosBrainStore = new Map();
  }
  return globalThis.__borealosBrainStore as Map<string, BrainData>;
}

// ---------------------------------------------------------------------------
// 内容生成与解析
// ---------------------------------------------------------------------------

/** 根据各部分内容生成完整的 BRAIN.md 文本 */
function generateContent(sections: BrainSections): string {
  const lines: string[] = ['# BorealOS 项目记忆大脑', ''];
  (Object.keys(SECTION_TITLES) as (keyof BrainSections)[]).forEach((key) => {
    const title = SECTION_TITLES[key];
    const body = sections[key]?.trim() || PLACEHOLDER;
    lines.push(`## ${title}`, body, '');
  });
  return lines.join('\n').trimEnd() + '\n';
}

/** 从完整 BRAIN.md 文本中解析各部分内容 */
function parseSections(content: string): BrainSections {
  const sections: BrainSections = {
    architecture: '',
    progress: '',
    norms: '',
    context: '',
  };

  // 按 ## 标题拆分
  const parts = content.split(/^## /m);
  for (const part of parts) {
    const newlineIdx = part.indexOf('\n');
    if (newlineIdx === -1) continue;

    const title = part.slice(0, newlineIdx).trim();
    const body = part.slice(newlineIdx + 1).trim();
    const key = TITLE_TO_SECTION[title];
    if (key) {
      sections[key] = body;
    }
  }

  return sections;
}

// ---------------------------------------------------------------------------
// 记忆大脑生命周期
// ---------------------------------------------------------------------------

/** 创建默认记忆大脑（新项目自动生成） */
function createDefaultBrain(projectId: string): BrainData {
  const sections: BrainSections = {
    architecture: PLACEHOLDER,
    progress: PLACEHOLDER,
    norms: PLACEHOLDER,
    context: PLACEHOLDER,
  };
  return {
    projectId,
    content: generateContent(sections),
    sections,
    updatedAt: Date.now(),
    version: 1,
    history: [{ timestamp: Date.now(), action: 'created' }],
  };
}

/** 获取指定项目的记忆大脑，不存在则自动创建默认模板 */
function getOrCreateBrain(projectId: string): BrainData {
  const store = getBrainStore();
  let brain = store.get(projectId);
  if (!brain) {
    brain = createDefaultBrain(projectId);
    store.set(projectId, brain);
  }
  return brain;
}

/** 添加历史记录（超过上限时截断旧记录） */
function addHistory(brain: BrainData, action: string, section?: string): void {
  const entry: { timestamp: number; action: string; section?: string } = {
    timestamp: Date.now(),
    action,
  };
  if (section) {
    entry.section = section;
  }
  brain.history.push(entry);
  if (brain.history.length > MAX_HISTORY) {
    brain.history = brain.history.slice(-MAX_HISTORY);
  }
}

/** 递增版本号并更新时间戳 */
function touch(brain: BrainData): void {
  brain.version += 1;
  brain.updatedAt = Date.now();
}

// ---------------------------------------------------------------------------
// 响应工具
// ---------------------------------------------------------------------------

/** 统一 JSON 响应 */
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// HTTP 方法处理
// ---------------------------------------------------------------------------

/**
 * GET /api/brain?projectId=xxx
 * 获取指定项目的记忆大脑内容（不存在时自动创建默认模板）
 */
export const onRequestGet = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');

  if (!projectId) {
    return json({ success: false, error: '缺少 projectId 参数' }, 400);
  }

  const brain = getOrCreateBrain(projectId);
  return json({ success: true, data: brain });
};

/**
 * POST /api/brain
 * 创建/更新记忆大脑
 * 参数: { projectId, content, section }
 * section 可选值: 'architecture' | 'progress' | 'norms' | 'full'
 * - 'full': 用 content 替换完整 BRAIN.md，并解析各部分
 * - 其他值: 仅更新对应部分，并重新生成完整内容
 */
export const onRequestPost = async ({ request }: { request: Request }) => {
  const body = await request.json().catch(() => ({}));
  const { projectId, content, section } = body as {
    projectId?: string;
    content?: string;
    section?: string;
  };

  if (!projectId) {
    return json({ success: false, error: '缺少 projectId 参数' }, 400);
  }

  if (!section || !VALID_POST_SECTIONS.includes(section)) {
    return json(
      { success: false, error: `section 必须是以下值之一: ${VALID_POST_SECTIONS.join(', ')}` },
      400,
    );
  }

  if (typeof content !== 'string') {
    return json({ success: false, error: '缺少 content 参数或类型不正确' }, 400);
  }

  const brain = getOrCreateBrain(projectId);

  if (section === 'full') {
    // 替换完整内容并解析各部分
    brain.content = content;
    brain.sections = parseSections(content);
    addHistory(brain, 'update-full');
  } else {
    // 仅更新对应部分
    const sectionKey = section as keyof BrainSections;
    brain.sections[sectionKey] = content;
    brain.content = generateContent(brain.sections);
    addHistory(brain, 'update-section', section);
  }

  touch(brain);
  return json({ success: true, data: brain });
};

/**
 * PUT /api/brain
 * 追加内容到指定部分
 * 参数: { projectId, section, content }
 * section 可选值: 'architecture' | 'progress' | 'norms' | 'context'
 * 如果目标部分仍为默认占位文本，则替换为新内容；否则在末尾追加。
 */
export const onRequestPut = async ({ request }: { request: Request }) => {
  const body = await request.json().catch(() => ({}));
  const { projectId, section, content } = body as {
    projectId?: string;
    section?: string;
    content?: string;
  };

  if (!projectId) {
    return json({ success: false, error: '缺少 projectId 参数' }, 400);
  }

  if (!section || !VALID_PUT_SECTIONS.includes(section)) {
    return json(
      { success: false, error: `section 必须是以下值之一: ${VALID_PUT_SECTIONS.join(', ')}` },
      400,
    );
  }

  if (typeof content !== 'string') {
    return json({ success: false, error: '缺少 content 参数或类型不正确' }, 400);
  }

  const brain = getOrCreateBrain(projectId);
  const sectionKey = section as keyof BrainSections;
  const current = brain.sections[sectionKey];

  // 当前为占位文本或空时，直接替换；否则追加
  if (!current || current.trim() === PLACEHOLDER) {
    brain.sections[sectionKey] = content;
  } else {
    brain.sections[sectionKey] = current.trimEnd() + '\n' + content;
  }

  brain.content = generateContent(brain.sections);
  touch(brain);
  addHistory(brain, 'append', section);

  return json({ success: true, data: brain });
};

/**
 * DELETE /api/brain?projectId=xxx
 * 清除指定项目的记忆大脑
 */
export const onRequestDelete = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');

  if (!projectId) {
    return json({ success: false, error: '缺少 projectId 参数' }, 400);
  }

  const store = getBrainStore();

  if (!store.has(projectId)) {
    return json({ success: false, error: '记忆大脑不存在' }, 404);
  }

  store.delete(projectId);
  return json({ success: true, data: { projectId, deleted: true } });
};
