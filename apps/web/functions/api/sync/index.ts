// Cloudflare Pages Function: /api/sync
// 多设备同步接口 — 基于 globalThis 内存存储的 Last-Write-Wins 同步服务
// 按 userId 组织数据，每个用户下按 deviceId 维护各设备的同步快照

// ===================== 类型定义 =====================

/** 单个设备的同步数据 */
interface DeviceSync {
  deviceId: string;
  deviceName: string;
  platform: string;
  lastSyncAt: number;
  data: {
    projects?: any[];
    editorState?: { openTabs: string[]; activeTab: string | null; cursorPositions: any };
    chatHistory?: any[];
    brainData?: any;
    settings?: any;
  };
  /** 每个字段的最后更新时间戳，用于跨设备 Last-Write-Wins 合并 */
  fieldTimestamps?: Record<string, number>;
}

/** 用户的同步数据（按 userId 组织） */
interface SyncData {
  userId: string;
  devices: Map<string, DeviceSync>; // deviceId -> device info
  lastUpdatedAt: number;
}

/** 可同步的数据字段 */
const SYNC_FIELDS = ['projects', 'editorState', 'chatHistory', 'brainData', 'settings'] as const;
type SyncField = (typeof SYNC_FIELDS)[number];

/** POST 上传类型 */
type UploadType = SyncField | 'all';

const VALID_UPLOAD_TYPES: UploadType[] = [
  'projects',
  'editorState',
  'chatHistory',
  'brainData',
  'settings',
  'all',
];

// ===================== 全局存储 =====================

declare global {
  // eslint-disable-next-line no-var
  var __borealosSyncStore: Map<string, SyncData> | undefined;
}

/** 获取全局同步存储（按 userId 索引） */
function getSyncStore(): Map<string, SyncData> {
  if (!globalThis.__borealosSyncStore) {
    globalThis.__borealosSyncStore = new Map();
  }
  return globalThis.__borealosSyncStore!;
}

/** 获取或创建指定用户的同步数据 */
function getOrCreateUserSync(userId: string): SyncData {
  const store = getSyncStore();
  let syncData = store.get(userId);
  if (!syncData) {
    syncData = {
      userId,
      devices: new Map<string, DeviceSync>(),
      lastUpdatedAt: Date.now(),
    };
    store.set(userId, syncData);
  }
  return syncData;
}

/** 获取或创建指定设备记录 */
function getOrCreateDevice(
  syncData: SyncData,
  deviceId: string,
  deviceName?: string,
  platform?: string,
): DeviceSync {
  let device = syncData.devices.get(deviceId);
  if (!device) {
    device = {
      deviceId,
      deviceName: deviceName || 'Unknown Device',
      platform: platform || 'unknown',
      lastSyncAt: Date.now(),
      data: {},
      fieldTimestamps: {},
    };
    syncData.devices.set(deviceId, device);
  }
  return device;
}

// ===================== 路径工具（用于 PUT 增量同步） =====================

/** 将路径字符串或数组解析为键数组，支持点号与方括号记法 */
function toPath(path: string | number | (string | number)[]): string[] {
  if (Array.isArray(path)) return path.map((k) => String(k));
  if (typeof path === 'number') return [String(path)];
  if (typeof path !== 'string' || path.length === 0) return [];
  const result: string[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) result.push(m[1]);
    else if (m[2] !== undefined) result.push(m[2]);
  }
  return result;
}

/** 判断键是否应作为数组索引 */
function isArrayIndex(key: string): boolean {
  return /^\d+$/.test(key);
}

/** 按路径设置值（自动创建中间对象/数组） */
function setValueByPath(obj: any, path: string[], value: any): void {
  if (path.length === 0) return;
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const nextKey = path[i + 1];
    if (cur[key] == null || typeof cur[key] !== 'object') {
      cur[key] = isArrayIndex(nextKey) ? [] : {};
    }
    cur = cur[key];
  }
  cur[path[path.length - 1]] = value;
}

/** 按路径删除值（数组元素使用 splice，对象使用 delete） */
function deleteValueByPath(obj: any, path: string[]): boolean {
  if (path.length === 0) return false;
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (cur == null || typeof cur !== 'object' || !(key in cur)) return false;
    cur = cur[key];
  }
  const lastKey = path[path.length - 1];
  if (cur == null || typeof cur !== 'object' || !(lastKey in cur)) return false;
  if (Array.isArray(cur) && isArrayIndex(lastKey)) {
    cur.splice(Number(lastKey), 1);
  } else {
    delete cur[lastKey];
  }
  return true;
}

// ===================== 合并工具 =====================

/** 跨设备 Last-Write-Wins 合并：返回各字段最新数据 */
function mergeDeviceData(syncData: SyncData): Record<string, any> {
  const merged: Record<string, any> = {};
  for (const field of SYNC_FIELDS) {
    let bestDevice: DeviceSync | null = null;
    let bestTs = -1;
    for (const device of syncData.devices.values()) {
      if (device.data[field] === undefined) continue;
      const ts = device.fieldTimestamps?.[field] ?? device.lastSyncAt ?? 0;
      if (ts > bestTs) {
        bestTs = ts;
        bestDevice = device;
      }
    }
    if (bestDevice) {
      merged[field] = bestDevice.data[field];
    }
  }
  return merged;
}

/** 设备信息摘要（不含完整 data） */
function deviceSummary(device: DeviceSync) {
  return {
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    platform: device.platform,
    lastSyncAt: device.lastSyncAt,
    fieldTimestamps: device.fieldTimestamps ?? {},
  };
}

// ===================== 响应工具 =====================

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function ok(data: any): Response {
  return json({ success: true, data });
}

function fail(error: string, status = 400): Response {
  return json({ success: false, error }, status);
}

// ===================== GET: 获取同步数据 =====================
// ?userId=xxx&deviceId=xxx
// 返回该用户所有设备合并后的最新同步数据（projects/editorState/chatHistory/brainData/settings）
export const onRequestGet = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  const deviceId = url.searchParams.get('deviceId');

  if (!userId) {
    return fail('缺少 userId 参数', 400);
  }

  const store = getSyncStore();
  const syncData = store.get(userId);

  if (!syncData || syncData.devices.size === 0) {
    return ok({
      userId,
      devices: [],
      lastUpdatedAt: syncData?.lastUpdatedAt ?? null,
    });
  }

  // 跨设备 Last-Write-Wins 合并
  const merged = mergeDeviceData(syncData);

  const result: any = {
    userId,
    devices: Array.from(syncData.devices.values()).map(deviceSummary),
    ...merged,
    lastUpdatedAt: syncData.lastUpdatedAt,
  };

  // 指定 deviceId 时附带该设备的完整数据快照
  if (deviceId) {
    const device = syncData.devices.get(deviceId);
    result.device = device ? { ...deviceSummary(device), data: device.data } : null;
  }

  return ok(result);
};

// ===================== POST: 上传同步数据 =====================
// { userId, deviceId, type, data, deviceName?, platform? }
// type: 'projects' | 'editorState' | 'chatHistory' | 'brainData' | 'settings' | 'all'
// 合并策略：后上传的覆盖先上传的（Last-Write-Wins）
export const onRequestPost = async ({ request }: { request: Request }) => {
  const body = await request.json().catch(() => ({}));
  const { userId, deviceId, type, data } = body ?? {};

  if (!userId || !deviceId) {
    return fail('缺少 userId 或 deviceId', 400);
  }

  if (!type || !VALID_UPLOAD_TYPES.includes(type)) {
    return fail(
      "type 必须为 'projects' | 'editorState' | 'chatHistory' | 'brainData' | 'settings' | 'all'",
      400,
    );
  }

  if (data === undefined || data === null) {
    return fail('缺少 data', 400);
  }

  const syncData = getOrCreateUserSync(userId);
  const device = getOrCreateDevice(syncData, deviceId, body.deviceName, body.platform);

  // 更新设备元信息
  if (body.deviceName) device.deviceName = body.deviceName;
  if (body.platform) device.platform = body.platform;

  const now = Date.now();
  device.fieldTimestamps = device.fieldTimestamps ?? {};

  // Last-Write-Wins：直接覆盖对应字段
  if (type === 'all') {
    // data 为包含各字段的对象
    for (const field of SYNC_FIELDS) {
      if (data[field] !== undefined) {
        device.data[field] = data[field];
        device.fieldTimestamps[field] = now;
      }
    }
  } else {
    device.data[type as SyncField] = data;
    device.fieldTimestamps[type as SyncField] = now;
  }

  device.lastSyncAt = now;
  syncData.lastUpdatedAt = now;

  return ok({
    userId,
    deviceId,
    type,
    lastSyncAt: now,
    lastUpdatedAt: syncData.lastUpdatedAt,
    device: deviceSummary(device),
  });
};

// ===================== PUT: 增量同步 =====================
// { userId, deviceId, patches, deviceName?, platform? }
// patches: Array<{ path, op: 'set' | 'delete', value }>
// 按路径应用增量更新
export const onRequestPut = async ({ request }: { request: Request }) => {
  const body = await request.json().catch(() => ({}));
  const { userId, deviceId, patches } = body ?? {};

  if (!userId || !deviceId) {
    return fail('缺少 userId 或 deviceId', 400);
  }

  if (!Array.isArray(patches) || patches.length === 0) {
    return fail('patches 必须为非空数组', 400);
  }

  const syncData = getOrCreateUserSync(userId);
  const device = getOrCreateDevice(syncData, deviceId, body.deviceName, body.platform);

  if (body.deviceName) device.deviceName = body.deviceName;
  if (body.platform) device.platform = body.platform;

  const now = Date.now();
  device.fieldTimestamps = device.fieldTimestamps ?? {};

  const applied: Array<{ path: any; op: string; success: boolean }> = [];
  const touchedFields = new Set<string>();

  for (const patch of patches) {
    const { path, op, value } = patch ?? {};

    // 校验 patch
    if (path === undefined || path === null || path === '') {
      applied.push({ path, op, success: false });
      continue;
    }
    if (op !== 'set' && op !== 'delete') {
      applied.push({ path, op, success: false });
      continue;
    }

    const pathArr = toPath(path);
    if (pathArr.length === 0) {
      applied.push({ path, op, success: false });
      continue;
    }

    let success = false;
    if (op === 'set') {
      setValueByPath(device.data, pathArr, value);
      success = true;
    } else {
      // op === 'delete'
      success = deleteValueByPath(device.data, pathArr);
    }

    // 记录被影响的顶层字段，用于更新字段时间戳
    touchedFields.add(pathArr[0]);
    applied.push({ path, op, success });
  }

  // 更新受影响字段的 LWW 时间戳
  for (const field of touchedFields) {
    if ((SYNC_FIELDS as readonly string[]).includes(field)) {
      device.fieldTimestamps[field] = now;
    }
  }

  device.lastSyncAt = now;
  syncData.lastUpdatedAt = now;

  return ok({
    userId,
    deviceId,
    appliedCount: applied.length,
    applied,
    lastSyncAt: now,
    lastUpdatedAt: syncData.lastUpdatedAt,
  });
};

// ===================== DELETE: 删除同步数据 =====================
// ?userId=xxx&deviceId=xxx
// 指定 deviceId 则删除该设备；否则删除该用户全部同步数据
export const onRequestDelete = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  const deviceId = url.searchParams.get('deviceId');

  if (!userId) {
    return fail('缺少 userId 参数', 400);
  }

  const store = getSyncStore();
  const syncData = store.get(userId);

  if (!syncData) {
    return fail('用户同步数据不存在', 404);
  }

  // 指定 deviceId：仅删除该设备
  if (deviceId) {
    if (!syncData.devices.has(deviceId)) {
      return fail('设备同步数据不存在', 404);
    }
    syncData.devices.delete(deviceId);
    syncData.lastUpdatedAt = Date.now();

    // 设备全部清空则移除整个用户记录
    if (syncData.devices.size === 0) {
      store.delete(userId);
      return ok({ userId, deviceId, deleted: true, userCleared: true });
    }

    return ok({
      userId,
      deviceId,
      deleted: true,
      remainingDevices: syncData.devices.size,
      lastUpdatedAt: syncData.lastUpdatedAt,
    });
  }

  // 未指定 deviceId：删除该用户全部同步数据
  store.delete(userId);
  return ok({ userId, deleted: true, userCleared: true });
};
