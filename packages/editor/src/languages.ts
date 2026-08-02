/**
 * @borealos/editor - 语言检测与语法高亮配置
 *
 * 提供文件扩展名到语言标识符的映射（LANGUAGE_MAP）、文件名语言检测
 * （detectLanguage）以及语言标识符到 Monaco 语言 ID 的映射（getMonacoLanguage）。
 * 覆盖 ts/tsx/js/jsx/json/css/html/md/py/rs/go/java/c/cpp/sh/yaml/vue/svelte 等常见语言。
 */

// ============================================================================
// 扩展名 -> 语言标识符映射表
// ============================================================================

/** 扩展名（小写，不含点）到语言标识符的映射表 */
export const LANGUAGE_MAP: Record<string, string> = {
  // ---- TypeScript / JavaScript ----
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  // ---- Web 标记与样式 ----
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  styl: 'stylus',
  // ---- 数据与配置 ----
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  xml: 'xml',
  svg: 'xml',
  csv: 'plaintext',
  tsv: 'plaintext',
  ini: 'ini',
  conf: 'ini',
  // ---- 标记语言 ----
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  txt: 'plaintext',
  // ---- 编程语言 ----
  py: 'python',
  pyw: 'python',
  rb: 'ruby',
  php: 'php',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  cs: 'csharp',
  scala: 'scala',
  dart: 'dart',
  lua: 'lua',
  r: 'r',
  elm: 'elm',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  clj: 'clojure',
  hs: 'haskell',
  jl: 'julia',
  ml: 'ocaml',
  fs: 'fsharp',
  // ---- Shell 与脚本 ----
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  bat: 'bat',
  cmd: 'bat',
  ps1: 'powershell',
  // ---- 框架与模板 ----
  vue: 'html',
  svelte: 'html',
  astro: 'html',
  hbs: 'handlebars',
  handlebars: 'handlebars',
  ejs: 'html',
  pug: 'pug',
  // ---- 数据库与其它 ----
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'proto',
  dockerfile: 'dockerfile',
  gitignore: 'plaintext',
  env: 'plaintext',
};

// ============================================================================
// Monaco 原生语言 ID 集合
// ============================================================================

/**
 * Monaco 编辑器原生支持的语言 ID 集合。
 * 用于在 getMonacoLanguage 中过滤 Monaco 不支持的标识符，回退为 'plaintext'。
 */
const MONACO_LANGUAGE_IDS = new Set<string>([
  'abap', 'apex', 'azcli', 'bat', 'bicep', 'cameligo', 'clojure',
  'coffeescript', 'c', 'cpp', 'csharp', 'csp', 'css', 'cypher',
  'dart', 'dockerfile', 'ecl', 'elixir', 'flow9', 'fsharp', 'go',
  'graphql', 'handlebars', 'hcl', 'html', 'ini', 'java', 'javascript',
  'json', 'julia', 'kotlin', 'less', 'lexon', 'lua', 'liquid', 'm3',
  'markdown', 'mips', 'msdax', 'mysql', 'nginx', 'objective-c',
  'pascal', 'pascaligo', 'perl', 'pgsql', 'php', 'plaintext',
  'postiats', 'powerquery', 'powershell', 'proto', 'python', 'r',
  'raku', 'razor', 'redis', 'redshift', 'restructuredtext', 'ruby',
  'rust', 'sb', 'scala', 'scheme', 'scm', 'scss', 'shell', 'sol',
  'solidity', 'sophia', 'sparql', 'sql', 'st', 'stylus', 'swift',
  'systemverilog', 'tcl', 'twig', 'typescript', 'typespec', 'vb',
  'verilog', 'vhdl', 'xml', 'yaml', 'pug',
]);

/** 语言标识符别名 -> Monaco 语言 ID 的映射 */
const MONACO_LANGUAGE_ALIAS: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  md: 'markdown',
  golang: 'go',
  'c++': 'cpp',
  'c#': 'csharp',
  'objective-c': 'objective-c',
  shellscript: 'shell',
  text: 'plaintext',
  rs: 'rust',
  rb: 'ruby',
};

// ============================================================================
// 公共函数
// ============================================================================

/**
 * 根据文件名（或路径）检测语言标识符。
 *
 * 优先识别特殊文件名（Dockerfile、Makefile、点号开头的配置文件），
 * 再按扩展名匹配 LANGUAGE_MAP；未识别时返回 'plaintext'。
 *
 * @param filename 文件名或文件路径
 * @returns 语言标识符
 */
export function detectLanguage(filename: string): string {
  if (!filename) return 'plaintext';

  // 取最后一段文件名并转小写
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const lower = base.toLowerCase();

  // 优先处理特殊文件名
  if (lower === 'dockerfile') return 'dockerfile';
  if (lower === 'makefile' || lower === 'gnumakefile') return 'makefile';
  if (
    lower.startsWith('.env') ||
    lower === '.gitignore' ||
    lower === '.npmrc' ||
    lower === '.editorconfig' ||
    lower === '.prettierrc' ||
    lower === '.eslintrc'
  ) {
    return 'plaintext';
  }

  // 按扩展名匹配（取最后一个点之后的部分）
  const dotIndex = lower.lastIndexOf('.');
  const ext = dotIndex >= 0 ? lower.slice(dotIndex + 1) : '';
  if (ext && LANGUAGE_MAP[ext]) {
    return LANGUAGE_MAP[ext];
  }

  return 'plaintext';
}

/**
 * 将语言标识符映射为 Monaco 支持的语言 ID。
 *
 * 若该标识符本身就是 Monaco 原生语言 ID，则直接返回；
 * 否则尝试别名映射；仍无法识别时回退为 'plaintext'。
 *
 * @param language 语言标识符
 * @returns Monaco 语言 ID
 */
export function getMonacoLanguage(language: string): string {
  if (!language) return 'plaintext';
  const lower = language.toLowerCase();

  // 本身即为 Monaco 原生语言 ID
  if (MONACO_LANGUAGE_IDS.has(lower)) {
    return lower;
  }

  // 别名映射
  if (MONACO_LANGUAGE_ALIAS[lower]) {
    return MONACO_LANGUAGE_ALIAS[lower];
  }

  // 回退为纯文本
  return 'plaintext';
}
