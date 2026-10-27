// 流程：环境检测、安装、写配置。所有外部能力（执行命令、联网、读写文件）都从参数传入，测试里用假的。
import { methodsFor, PROBES, toolOf, TOOLS, type InstallMethod, type OsId, type ToolInfo, type ToolKey } from './catalog';
import { backupName, CODEX_ENV_KEY, mergeClaudeSettings, mergeCodexToml, mergeShellProfile, validateConfig, type ApiConfig } from './configs';
import { diagnose, fallbackIssue, type Issue } from './diagnose';
import type { Exec } from './exec';
import { maskSecrets } from './mask';

export type Arch = 'arm64' | 'x64' | 'unknown';

export interface Env {
  os: OsId;
  arch: Arch;
  node?: string;
  git?: string;
  npm?: string;
  brew: boolean;
  winget: boolean;
  tools: Record<ToolKey, { installed: boolean; version?: string }>;
  net: { host: string; label: string; ok: boolean }[];
}

export function detectOs(userAgent: string): OsId {
  const ua = userAgent.toLowerCase();
  if (ua.includes('windows')) return 'win';
  if (ua.includes('mac')) return 'mac';
  return 'linux';
}

export const parseArch = (raw: string): Arch => {
  const s = raw.trim().toLowerCase();
  if (s === 'arm64' || s === 'aarch64') return 'arm64';
  if (s === 'x86_64' || s === 'amd64' || s === 'x64') return 'x64';
  return 'unknown';
};

/** 从 `node --version` 之类的输出里取版本号 */
export function parseVersion(out: string): string | undefined {
  const m = /v?(\d+\.\d+(?:\.\d+)?)/.exec(out);
  return m ? m[1] : undefined;
}

export const majorOf = (v?: string) => (v ? Number(v.split('.')[0]) : NaN);

export type Probe = (url: string) => Promise<boolean>;

export async function detectEnv(exec: Exec, os: OsId, probe: Probe): Promise<Env> {
  const p = os === 'win' ? 'w' : 'u';
  const run = async (id: string) => {
    try { return await exec(id); } catch { return { code: 1, stdout: '', stderr: '' }; }
  };
  const ver = async (key: string) => {
    const r = await run(`${p}.has.${key}`);
    return r.code === 0 ? parseVersion(r.stdout) ?? '已安装' : undefined;
  };
  const arch = parseArch((await run(`${p}.arch`)).stdout);
  const node = await ver('node');
  const git = await ver('git');
  const npm = await ver('npm');
  const brew = os === 'win' ? false : (await run('u.has.brew')).code === 0;
  const tools = {} as Env['tools'];
  for (const t of TOOLS) {
    const found = (await run(`${p}.has.${t.key}`)).code === 0;
    let version: string | undefined;
    if (found) version = parseVersion((await run(`${p}.ver.${t.key}`)).stdout);
    tools[t.key] = { installed: found, version };
  }
  const net = await Promise.all(PROBES.map(async (x) => ({ host: x.host, label: x.label, ok: await probe(x.url).catch(() => false) })));
  // winget 不在白名单检测里（版本信息无法核实），Windows 上交给安装结果判断
  return { os, arch, node, git, npm, brew, winget: os === 'win', tools, net };
}

/** 系统要求检查：返回会挡住安装的问题 */
export function checkRequirements(tool: ToolInfo, method: InstallMethod, env: Env): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (tool.macAppleSiliconOnly && env.os === 'mac' && env.arch === 'x64') blockers.push(`${tool.name} 官方只支持 Apple 芯片的 Mac，这台电脑是 Intel 芯片。`);
  if (env.os === 'linux' && tool.key !== 'hermes') warnings.push('本工具主要面向 macOS 与 Windows，Linux 上命令可用但未做专门测试。');
  for (const n of method.needs ?? []) {
    if (n === 'npm' && !env.npm) blockers.push('这种安装方式需要 npm（随 Node.js 一起安装），请先安装 Node.js。');
    if (n === 'brew' && !env.brew) blockers.push('这种安装方式需要 Homebrew，请先安装 Homebrew，或换用官方安装脚本。');
  }
  if (method.needs?.includes('npm') && tool.nodeMajorForNpm && env.node && majorOf(env.node) < tool.nodeMajorForNpm) {
    blockers.push(`${tool.name} 用 npm 安装要求 Node.js ${tool.nodeMajorForNpm} 以上，当前是 ${env.node}。`);
  }
  if (tool.key === 'claude' && env.os === 'win' && !env.git) warnings.push('Windows 上建议安装 Git（官方推荐，没有也能用，只是少了 Bash 工具）。');
  if (tool.key === 'hermes' && env.os !== 'win' && !env.git) blockers.push('Hermes 的安装脚本需要 Git，请先安装 Git。');
  const bad = env.net.filter((n) => !n.ok);
  if (bad.length === env.net.length && env.net.length > 0) warnings.push('所有测试地址都连不上，请先检查网络。');
  return { blockers, warnings };
}

export interface InstallResult {
  ok: boolean;
  /** 装好后检测到的版本 */
  version?: string;
  issue?: Issue;
  /** 失败时的原始报错（已打码） */
  rawError?: string;
}

export async function installTool(
  exec: Exec,
  env: Pick<Env, 'os'>,
  key: ToolKey,
  methodId: string,
  onLine: (line: string, stream: 'out' | 'err') => void,
  secrets: string[] = [],
): Promise<InstallResult> {
  const tool = toolOf(key);
  const method = methodsFor(tool, env.os).find((m) => m.id === methodId);
  if (!method) return { ok: false, rawError: '当前系统没有这种安装方式' };
  const lines: string[] = [];
  const push = (l: string, s: 'out' | 'err') => {
    const masked = maskSecrets(l, secrets);
    lines.push(masked);
    onLine(masked, s);
  };
  let res;
  try {
    res = await exec(method.cmdId, { onLine: push });
  } catch (e) {
    const msg = maskSecrets(e instanceof Error ? e.message : String(e), secrets);
    return { ok: false, rawError: msg, issue: diagnose(msg, { os: env.os }) ?? fallbackIssue(msg) };
  }
  if (res.code !== 0) {
    const tail = maskSecrets((res.stderr || res.stdout || lines.join('\n')).slice(-2000), secrets);
    return { ok: false, rawError: tail, issue: diagnose(tail, { os: env.os, writeFailed: true }) ?? fallbackIssue(tail) };
  }
  // 装完再检测一次：命令找不到时多半是 PATH 还没刷新
  const p = env.os === 'win' ? 'w' : 'u';
  const found = await exec(`${p}.has.${key}`).catch(() => ({ code: 1, stdout: '', stderr: '' }));
  if (found.code !== 0) {
    const msg = `${tool.bin}: command not found`;
    return { ok: false, rawError: '安装命令已结束，但还找不到命令。', issue: diagnose(msg, { os: env.os }) ?? fallbackIssue(msg) };
  }
  const v = await exec(`${p}.ver.${key}`).catch(() => ({ code: 1, stdout: '', stderr: '' }));
  return { ok: true, version: parseVersion(v.stdout) };
}

export interface FileDeps {
  home: string;
  join: (...p: string[]) => Promise<string> | string;
  exists: (path: string) => Promise<boolean>;
  readText: (path: string) => Promise<string>;
  writeText: (path: string, text: string) => Promise<void>;
  now: () => Date;
}

export interface ConfigResult {
  written: string[];
  backups: string[];
  notes: string[];
}

async function writeWithBackup(d: FileDeps, path: string, next: string, res: ConfigResult) {
  if (await d.exists(path)) {
    const old = await d.readText(path);
    const bak = backupName(path, d.now());
    await d.writeText(bak, old);
    res.backups.push(bak);
  }
  await d.writeText(path, next);
  res.written.push(path);
}

/** 把接口配置写到对应工具的官方配置位置。Codex 的密钥另写环境变量：macOS / Linux 写 ~/.zshrc，Windows 用 setx。 */
export async function applyConfig(d: FileDeps, exec: Exec, os: OsId, key: ToolKey, cfg: ApiConfig): Promise<ConfigResult> {
  const tool = toolOf(key);
  if (tool.config === 'none') throw new Error(`${tool.name}：${tool.configNote}`);
  const err = validateConfig(cfg, tool.config === 'codex-toml');
  if (err) throw new Error(err);
  const res: ConfigResult = { written: [], backups: [], notes: [] };
  if (tool.config === 'claude-settings') {
    const path = await d.join(d.home, '.claude', 'settings.json');
    const old = (await d.exists(path)) ? await d.readText(path) : null;
    await writeWithBackup(d, path, mergeClaudeSettings(old, cfg), res);
    res.notes.push('已写入 env 项。重新打开终端运行 claude 即可生效。');
    return res;
  }
  const path = await d.join(d.home, '.codex', 'config.toml');
  const old = (await d.exists(path)) ? await d.readText(path) : null;
  await writeWithBackup(d, path, mergeCodexToml(old, cfg), res);
  if (os === 'win') {
    const r = await exec('w.setenv.codex', { extra: [cfg.apiKey.trim()] });
    if (r.code !== 0) throw new Error('配置文件已写好，但设置环境变量失败，请手动设置 CAMPFIRE_CODEX_API_KEY。');
    res.notes.push(`已用 setx 设置用户环境变量 ${CODEX_ENV_KEY}，新开终端后生效。`);
  } else {
    const rc = await d.join(d.home, '.zshrc');
    const oldRc = (await d.exists(rc)) ? await d.readText(rc) : null;
    await writeWithBackup(d, rc, mergeShellProfile(oldRc, CODEX_ENV_KEY, cfg.apiKey.trim()), res);
    res.notes.push(`密钥已写入 ~/.zshrc 的环境变量 ${CODEX_ENV_KEY}，新开终端后生效；使用 bash 的用户请自行把同一行加到 ~/.bashrc。`);
  }
  return res;
}
