/**
 * BorealOS 记忆系统 - 向量嵌入工具
 *
 * 提供文本向量化、余弦相似度计算和 Token 估算功能。
 *
 * 嵌入算法基于字符频率的哈希嵌入，不依赖外部 API，适用于开发环境。
 * 生产环境可将 generateSimpleEmbedding 替换为真实嵌入模型
 * （如 OpenAI text-embedding-3），接口保持一致。
 */

// ============================================================================
// 哈希函数
// ============================================================================

/**
 * 字符串哈希函数（DJB2 变体）
 *
 * 将任意字符串映射为 32 位无符号整数，分布均匀、冲突率低、计算高效。
 * 用于将字符/词映射到嵌入向量的维度索引。
 *
 * @param str 输入字符串
 * @returns 32 位无符号整数哈希值
 */
export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // hash * 33 + charCode
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    // 强制截断为 32 位有符号整数后再转为无符号
    hash = hash & 0xffffffff;
  }
  return hash >>> 0;
}

// ============================================================================
// 文本向量化
// ============================================================================

/**
 * 生成简单的文本嵌入向量
 *
 * 基于字符频率的哈希嵌入算法：
 * 1. 遍历文本中的每个字符，通过哈希映射到向量的某个维度；
 * 2. 由哈希值高位决定该维度的增减方向（正/负），避免所有维度同向；
 * 3. 叠加双字符（bigram）特征，提升对局部语义的捕获能力；
 * 4. 最后进行 L2 归一化，使向量长度为 1，便于余弦相似度计算。
 *
 * 该方法不依赖外部 API，仅适用于开发环境与原型验证。
 * 相同文本始终生成相同向量，语义相近的文本由于共享字符/bigram
 * 而具有非零相似度。
 *
 * @param text 输入文本
 * @param dimension 嵌入向量维度
 * @returns 归一化的浮点数组，长度为 dimension；空文本返回零向量
 */
export function generateSimpleEmbedding(
  text: string,
  dimension: number,
): number[] {
  const vector = new Array<number>(dimension).fill(0);

  // 空文本返回零向量
  if (text.length === 0) {
    return vector;
  }

  // 单字符特征：按字符累加到对应维度
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const hash = hashString(char);
    // 哈希值映射到维度索引
    const index = hash % dimension;
    // 使用哈希值的高位作为方向符号
    const sign = ((hash >>> 16) & 1) === 0 ? 1 : -1;
    vector[index] += sign;
  }

  // 双字符（bigram）特征：增强局部语义捕获，权重减半
  for (let i = 0; i < text.length - 1; i++) {
    const bigram = text.slice(i, i + 2);
    const hash = hashString(bigram);
    const index = hash % dimension;
    const sign = ((hash >>> 16) & 1) === 0 ? 1 : -1;
    vector[index] += sign * 0.5;
  }

  // L2 归一化：使向量长度为 1
  let norm = 0;
  for (let i = 0; i < dimension; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);

  if (norm > 0) {
    for (let i = 0; i < dimension; i++) {
      vector[i] = vector[i] / norm;
    }
  }

  return vector;
}

// ============================================================================
// 相似度计算
// ============================================================================

/**
 * 计算两个向量的余弦相似度
 *
 * 公式：cosine = (A · B) / (||A|| × ||B||)
 * 取值范围 [-1, 1]，值越大表示方向越接近、越相似。
 *
 * 边界处理：
 * - 任一向量为空或长度不一致时返回 0；
 * - 任一向量为零向量（模长为 0）时返回 0，避免除零。
 *
 * @param a 向量 A
 * @param b 向量 B
 * @returns 余弦相似度，范围 [-1, 1]
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

// ============================================================================
// Token 估算
// ============================================================================

/**
 * 估算文本的 Token 数
 *
 * 采用启发式规则（近似 OpenAI 分词器的统计规律）：
 * - 中文字符（CJK 统一表意文字）约 1.5 字符 / token；
 * - 其他字符（英文、数字、符号、空白）约 4 字符 / token；
 * - 两者之和向上取整，最少为 1。
 *
 * 该估算用于记忆上下文的 Token 预算控制，非精确值。
 *
 * @param text 输入文本
 * @returns 估算的 Token 数
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  let cjkCount = 0;
  let otherCount = 0;

  // 使用 for...of 正确处理代理对（CJK 扩展 B-F 等补充平面字符）
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code !== undefined && isCjk(code)) {
      cjkCount++;
    } else {
      otherCount++;
    }
  }

  // 中文约 1.5 字/token，英文约 4 字/token
  const tokens = cjkCount / 1.5 + otherCount / 4;
  return Math.max(1, Math.ceil(tokens));
}

/**
 * 判断字符是否为 CJK 统一表意文字
 *
 * 覆盖常见中日韩文字范围：
 * - CJK 统一表意文字基本区：U+4E00 - U+9FFF
 * - CJK 扩展 A：U+3400 - U+4DBF
 * - CJK 兼容表意文字：U+F900 - U+FAFF
 * - CJK 扩展 B-F：U+20000 - U+2FFFF
 * - CJK 扩展 G+：U+30000 - U+3FFFF
 *
 * @param code 字符的 Unicode 码点
 * @returns 是否为 CJK 字符
 */
function isCjk(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 基本区
    (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
    (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容表意
    (code >= 0x20000 && code <= 0x2ffff) || // CJK 扩展 B-F
    (code >= 0x30000 && code <= 0x3ffff) // CJK 扩展 G+
  );
}
