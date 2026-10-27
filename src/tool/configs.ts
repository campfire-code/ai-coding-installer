// 接口配置：生成要写入各工具官方配置位置的内容（纯函数，写文件由界面层负责）。
// Claude Code：~/.claude/settings.json 的 env 项（官方文档：code.claude.com/docs/en/settings、env-vars）
// Codex：~/.codex/config.toml 的 model_provider（官方高级配置文档），密钥放环境变量

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Claude Code：token 写 ANTHROPIC_AUTH_TOKEN（Authorization: Bearer），apikey 写 ANTHROPIC_API_KEY（X-Api-Key） */
  keyKind: 'token' | 'apikey';
}

export const CODEX_ENV_KEY = 'CAMPFIRE_CODEX_API_KEY';
export const CODEX_PROVIDER_ID = 'campfire';

export function validateConfig(c: ApiConfig, needModel: boolean): string | null {
  if (!/^https?:\/\/[^\s]+$/i.test(c.baseUrl.trim())) return '接口地址要以 http:// 或 https:// 开头';
  if (!c.apiKey.trim()) return '请填写密钥';
  if (/\s/.test(c.apiKey.trim())) return '密钥里不能有空格或换行';
  if (needModel && !c.model.trim()) return '请填写模型名';
  return null;
}

/** 合并 Claude Code 的 settings.json：保留原有设置，只改三个 env 变量；原文件不是合法 JSON 时拒绝改动 */
export function mergeClaudeSettings(existing: string | null, c: ApiConfig): string {
  let obj: Record<string, unknown> = {};
  if (existing && existing.trim()) {
    try {
      const parsed = JSON.parse(existing);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
      obj = parsed as Record<string, unknown>;
    } catch {
      throw new Error('现有的 ~/.claude/settings.json 不是合法的 JSON，为避免弄坏它，这次没有改动。请先修好或备份后删除该文件。');
    }
  }
  const env: Record<string, unknown> = { ...((obj.env as Record<string, unknown>) ?? {}) };
  const own = c.keyKind === 'token' ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY';
  const other = c.keyKind === 'token' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN';
  delete env[other];
  env.ANTHROPIC_BASE_URL = c.baseUrl.trim().replace(/\/+$/, '');
  env[own] = c.apiKey.trim();
  if (c.model.trim()) env.ANTHROPIC_MODEL = c.model.trim();
  else delete env.ANTHROPIC_MODEL;
  return JSON.stringify({ ...obj, env }, null, 2) + '\n';
}

const TOP_BEGIN = '# >>> 篝火安装器：顶部设置（可整段删除）';
const TOP_END = '# <<< 篝火安装器';
const TBL_BEGIN = '# >>> 篝火安装器：自定义服务（可整段删除）';

function stripBlock(text: string, begin: string, end: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of text.split('\n')) {
    if (line.startsWith(begin)) { skipping = true; continue; }
    if (skipping) { if (line.startsWith(end)) skipping = false; continue; }
    out.push(line);
  }
  return out.join('\n');
}

const tomlStr = (s: string) => JSON.stringify(s);

/** 合并 Codex 的 config.toml：顶部写 model 与 model_provider，末尾追加自定义服务表；用户原来的同名顶层项会被注释掉，原文件由调用方先备份 */
export function mergeCodexToml(existing: string | null, c: ApiConfig): string {
  let text = (existing ?? '').replace(/\r\n/g, '\n');
  text = stripBlock(text, TOP_BEGIN, TOP_END);
  text = stripBlock(text, TBL_BEGIN, TOP_END);
  // 删掉旧的同名服务表（仅限本工具写的 campfire）
  const lines = text.split('\n');
  const kept: string[] = [];
  let inTable = false;
  let seenFirstTable = false;
  for (const line of lines) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      seenFirstTable = true;
      inTable = header[1].trim().startsWith(`model_providers.${CODEX_PROVIDER_ID}`);
    }
    if (inTable) continue;
    if (!seenFirstTable && /^\s*(model|model_provider)\s*=/.test(line)) {
      kept.push(`# （已被篝火安装器注释）${line}`);
      continue;
    }
    kept.push(line);
  }
  const rest = kept.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
  const top = [
    TOP_BEGIN,
    `model = ${tomlStr(c.model.trim())}`,
    `model_provider = ${tomlStr(CODEX_PROVIDER_ID)}`,
    TOP_END,
  ].join('\n');
  const table = [
    TBL_BEGIN,
    `[model_providers.${CODEX_PROVIDER_ID}]`,
    `name = ${tomlStr('自定义接口')}`,
    `base_url = ${tomlStr(c.baseUrl.trim().replace(/\/+$/, ''))}`,
    `env_key = ${tomlStr(CODEX_ENV_KEY)}`,
    `wire_api = ${tomlStr('responses')}`,
    TOP_END,
  ].join('\n');
  return [top, rest, table].filter(Boolean).join('\n\n') + '\n';
}

const PROFILE_BEGIN = '# >>> 篝火安装器：Codex 密钥（可整段删除）';
const PROFILE_END = '# <<< 篝火安装器';

/** 在 ~/.zshrc 之类的 shell 配置里写入（或替换）密钥环境变量 */
export function mergeShellProfile(existing: string | null, name: string, value: string): string {
  const base = stripBlock((existing ?? '').replace(/\r\n/g, '\n'), PROFILE_BEGIN, PROFILE_END).replace(/\s+$/, '');
  const quoted = `'${value.replace(/'/g, `'\\''`)}'`;
  const block = [PROFILE_BEGIN, `export ${name}=${quoted}`, PROFILE_END].join('\n');
  return (base ? base + '\n\n' : '') + block + '\n';
}

/** 带时间的备份文件名 */
export const backupName = (path: string, now: Date) => `${path}.bak-${now.toISOString().slice(0, 19).replace(/[-:T]/g, '')}`;
