import { describe, expect, it } from 'vitest';
import { methodsFor, TOOLS } from './catalog';
import { applyConfig, checkRequirements, detectEnv, detectOs, installTool, parseArch, parseVersion, type Env, type FileDeps } from './flow';
import type { Exec, ExecOpts, ExecResult } from './exec';
import { explainError } from './explain';

type Script = Record<string, Partial<ExecResult> & { lines?: string[] }>;
/** 假的命令执行函数：按编号返回事先写好的结果，并记录被调用的命令，绝不运行真实命令 */
function fakeExec(script: Script) {
  const calls: { id: string; opts?: ExecOpts }[] = [];
  const exec: Exec = async (id, opts) => {
    calls.push({ id, opts });
    const s = script[id];
    if (!s) return { code: 1, stdout: '', stderr: `${id}: not scripted` };
    s.lines?.forEach((l) => opts?.onLine?.(l, 'out'));
    return { code: s.code ?? 0, stdout: s.stdout ?? '', stderr: s.stderr ?? '' };
  };
  return { exec, calls };
}

const baseEnv = (over: Partial<Env> = {}): Env => ({
  os: 'mac', arch: 'arm64', node: '22.1.0', git: '2.45.0', npm: '10.0.0', brew: true, winget: false,
  tools: { claude: { installed: false }, codex: { installed: false }, openclaw: { installed: false }, hermes: { installed: false } },
  net: [{ host: 'claude.ai', label: 'x', ok: true }], ...over,
});

describe('环境检测', () => {
  it('解析版本、系统、芯片', () => {
    expect(parseVersion('v22.11.0\n')).toBe('22.11.0');
    expect(parseVersion('git version 2.45.1')).toBe('2.45.1');
    expect(parseVersion('2.1.211 (Claude Code)')).toBe('2.1.211');
    expect(parseVersion('not found')).toBeUndefined();
    expect(detectOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('mac');
    expect(detectOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('win');
    expect(detectOs('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
    expect(parseArch('arm64\n')).toBe('arm64');
    expect(parseArch('x86_64')).toBe('x64');
    expect(parseArch('AMD64')).toBe('x64');
    expect(parseArch('?')).toBe('unknown');
  });

  it('macOS：缺什么、已装什么、网络哪些通', async () => {
    const { exec, calls } = fakeExec({
      'u.arch': { stdout: 'arm64\n' }, 'u.has.node': { stdout: 'v22.11.0\n' }, 'u.has.git': { stdout: 'git version 2.45.1' },
      'u.has.claude': { stdout: '/Users/x/.local/bin/claude\n' }, 'u.ver.claude': { stdout: '2.1.211 (Claude Code)' },
    });
    const probe = async (url: string) => url.includes('claude.ai') || url.includes('npmjs');
    const env = await detectEnv(exec, 'mac', probe);
    expect(env).toMatchObject({ os: 'mac', arch: 'arm64', node: '22.11.0', git: '2.45.1', npm: undefined, brew: false });
    expect(env.tools.claude).toEqual({ installed: true, version: '2.1.211' });
    expect(env.tools.codex.installed).toBe(false);
    expect(env.net.filter((n) => n.ok).map((n) => n.host)).toEqual(['claude.ai', 'registry.npmjs.org']);
    expect(calls.every((c) => c.id.startsWith('u.'))).toBe(true);
  });

  it('Windows 用 w. 开头的命令', async () => {
    const { exec, calls } = fakeExec({ 'w.arch': { stdout: 'AMD64\r\n' } });
    const env = await detectEnv(exec, 'win', async () => false);
    expect(env.arch).toBe('x64');
    expect(calls.every((c) => c.id.startsWith('w.'))).toBe(true);
    expect(env.net.every((n) => !n.ok)).toBe(true);
  });

  it('命令执行本身抛错时按未安装处理，不中断', async () => {
    const exec: Exec = async () => { throw new Error('boom'); };
    const env = await detectEnv(exec, 'mac', async () => { throw new Error('offline'); });
    expect(env.node).toBeUndefined();
    expect(env.net.every((n) => !n.ok)).toBe(true);
  });
});

describe('系统要求检查', () => {
  const claude = TOOLS.find((t) => t.key === 'claude')!;
  const hermes = TOOLS.find((t) => t.key === 'hermes')!;
  const m = (t: typeof claude, os: 'mac' | 'win', id: string) => methodsFor(t, os).find((x) => x.id === id)!;

  it('Hermes 在 Intel 版 Mac 上被挡住，Apple 芯片放行', () => {
    expect(checkRequirements(hermes, m(hermes, 'mac', 'native'), baseEnv({ arch: 'x64' })).blockers[0]).toMatch(/Apple 芯片/);
    expect(checkRequirements(hermes, m(hermes, 'mac', 'native'), baseEnv()).blockers).toEqual([]);
  });
  it('Hermes 在类 Unix 上缺 Git 被挡住', () => {
    expect(checkRequirements(hermes, m(hermes, 'mac', 'native'), baseEnv({ git: undefined })).blockers.join()).toMatch(/Git/);
  });
  it('npm 方式：没有 npm 或 Node 太旧都挡住', () => {
    expect(checkRequirements(claude, m(claude, 'mac', 'npm'), baseEnv({ npm: undefined })).blockers.join()).toMatch(/npm/);
    expect(checkRequirements(claude, m(claude, 'mac', 'npm'), baseEnv({ node: '20.1.0' })).blockers.join()).toMatch(/22/);
    expect(checkRequirements(claude, m(claude, 'mac', 'npm'), baseEnv()).blockers).toEqual([]);
  });
  it('Homebrew 方式没有 brew 时挡住；官方脚本方式不挡', () => {
    expect(checkRequirements(claude, m(claude, 'mac', 'brew'), baseEnv({ brew: false })).blockers.join()).toMatch(/Homebrew/);
    expect(checkRequirements(claude, m(claude, 'mac', 'native'), baseEnv({ brew: false, node: undefined, npm: undefined })).blockers).toEqual([]);
  });
  it('Windows 缺 Git 只是提醒', () => {
    const r = checkRequirements(claude, m(claude, 'win', 'native'), baseEnv({ os: 'win', git: undefined }));
    expect(r.blockers).toEqual([]);
    expect(r.warnings.join()).toMatch(/Git/);
  });
});

describe('安装流程（假的命令执行）', () => {
  it('成功：实时输出每一行，装完检测版本', async () => {
    const { exec, calls } = fakeExec({
      'u.install.claude.native': { lines: ['Downloading...', 'Installed'] },
      'u.has.claude': { stdout: '/x/claude' }, 'u.ver.claude': { stdout: '2.1.211 (Claude Code)' },
    });
    const got: string[] = [];
    const r = await installTool(exec, { os: 'mac' }, 'claude', 'native', (l) => got.push(l));
    expect(r).toEqual({ ok: true, version: '2.1.211' });
    expect(got).toEqual(['Downloading...', 'Installed']);
    expect(calls.map((c) => c.id)).toEqual(['u.install.claude.native', 'u.has.claude', 'u.ver.claude']);
  });

  it('失败：识别出已知拦截，输出里的密钥被打码', async () => {
    const { exec } = fakeExec({
      'u.install.codex.native': { code: 6, stderr: 'curl: (6) Could not resolve host: chatgpt.com key=sk-EXAMPLEEXAMPLE1234', lines: ['token=sk-EXAMPLEEXAMPLE1234'] },
    });
    const got: string[] = [];
    const r = await installTool(exec, { os: 'mac' }, 'codex', 'native', (l) => got.push(l), []);
    expect(r.ok).toBe(false);
    expect(r.issue?.code).toBe('NET_RUNTIME');
    expect(got.join()).not.toContain('EXAMPLEEXAMPLE1234');
    expect(r.rawError).not.toContain('EXAMPLEEXAMPLE1234');
  });

  it('失败：没见过的报错返回兜底卡片', async () => {
    const { exec } = fakeExec({ 'u.install.openclaw.native': { code: 1, stderr: 'weird failure xyz' } });
    const r = await installTool(exec, { os: 'mac' }, 'openclaw', 'native', () => {});
    expect(r.issue?.code).toBe('UNKNOWN');
  });

  it('装完找不到命令：给出 PATH 引导', async () => {
    const { exec } = fakeExec({ 'u.install.claude.native': {}, 'u.has.claude': { code: 1 } });
    const r = await installTool(exec, { os: 'mac' }, 'claude', 'native', () => {});
    expect(r.ok).toBe(false);
    expect(r.issue?.code).toBe('PATH_NOT_LOADED');
  });

  it('Windows 走 w. 命令；不存在的安装方式直接失败，不执行任何命令', async () => {
    const { exec, calls } = fakeExec({ 'w.install.claude.native': {}, 'w.has.claude': {}, 'w.ver.claude': { stdout: '2.1.0' } });
    expect((await installTool(exec, { os: 'win' }, 'claude', 'native', () => {})).ok).toBe(true);
    const before = calls.length;
    const r = await installTool(exec, { os: 'mac' }, 'hermes', 'brew', () => {});
    expect(r.ok).toBe(false);
    expect(calls.length).toBe(before);
  });
});

describe('写入配置（假的文件系统）', () => {
  function fakeFiles(init: Record<string, string> = {}) {
    const files = new Map(Object.entries(init));
    const d: FileDeps = {
      home: '/home/u', join: (...p) => p.join('/'),
      exists: async (p) => files.has(p), readText: async (p) => files.get(p)!, writeText: async (p, t) => void files.set(p, t),
      now: () => new Date('2026-10-27T00:00:00Z'),
    };
    return { files, d };
  }
  const cfg = { baseUrl: 'https://gateway.example.com', apiKey: 'sk-EXAMPLEEXAMPLE1234', model: 'example-model', keyKind: 'token' as const };

  it('Claude Code：写 settings.json，原文件先备份', async () => {
    const { files, d } = fakeFiles({ '/home/u/.claude/settings.json': '{"theme":"dark"}' });
    const { exec, calls } = fakeExec({});
    const r = await applyConfig(d, exec, 'mac', 'claude', cfg);
    const o = JSON.parse(files.get('/home/u/.claude/settings.json')!);
    expect(o.theme).toBe('dark');
    expect(o.env.ANTHROPIC_BASE_URL).toBe('https://gateway.example.com');
    expect(r.backups).toHaveLength(1);
    expect(files.get(r.backups[0])).toBe('{"theme":"dark"}');
    expect(calls).toHaveLength(0);
  });

  it('Claude Code：原文件损坏时抛错且不动文件', async () => {
    const { files, d } = fakeFiles({ '/home/u/.claude/settings.json': '{broken' });
    await expect(applyConfig(d, fakeExec({}).exec, 'mac', 'claude', cfg)).rejects.toThrow(/不是合法的 JSON/);
    expect(files.get('/home/u/.claude/settings.json')).toBe('{broken');
  });

  it('Codex（macOS）：配置文件不含密钥，密钥写进 ~/.zshrc', async () => {
    const { files, d } = fakeFiles();
    await applyConfig(d, fakeExec({}).exec, 'mac', 'codex', cfg);
    expect(files.get('/home/u/.codex/config.toml')).toContain('[model_providers.campfire]');
    expect(files.get('/home/u/.codex/config.toml')).not.toContain(cfg.apiKey);
    expect(files.get('/home/u/.zshrc')).toContain(`export CAMPFIRE_CODEX_API_KEY='${cfg.apiKey}'`);
  });

  it('Codex（Windows）：用 setx 白名单命令设置环境变量，不写 shell 配置', async () => {
    const { files, d } = fakeFiles();
    const { exec, calls } = fakeExec({ 'w.setenv.codex': {} });
    await applyConfig(d, exec, 'win', 'codex', cfg);
    expect(calls).toEqual([{ id: 'w.setenv.codex', opts: { extra: [cfg.apiKey] } }]);
    expect(files.has('/home/u/.zshrc')).toBe(false);
  });

  it('OpenClaw、Hermes 没有核实到官方配置方式：拒绝写入并说明未核实', async () => {
    const { files, d } = fakeFiles();
    await expect(applyConfig(d, fakeExec({}).exec, 'mac', 'openclaw', cfg)).rejects.toThrow(/未核实/);
    await expect(applyConfig(d, fakeExec({}).exec, 'mac', 'hermes', cfg)).rejects.toThrow(/未核实/);
    expect(files.size).toBe(0);
  });

  it('输入不合格时不写任何文件', async () => {
    const { files, d } = fakeFiles();
    await expect(applyConfig(d, fakeExec({}).exec, 'mac', 'codex', { ...cfg, model: '' })).rejects.toThrow(/模型/);
    expect(files.size).toBe(0);
  });
});

describe('未知报错翻译成大白话', () => {
  it('发给大模型的内容已打码，回复也打码', async () => {
    let sent = '';
    const chat = async (m: { content: string }[]) => { sent = m.map((x) => x.content).join('\n'); return '请检查 sk-LEAKLEAKLEAK9999 是否正确'; };
    const out = await explainError(chat, 'fatal: auth failed token=sk-EXAMPLEEXAMPLE1234', { os: 'mac', tool: 'Claude Code', secrets: ['EXAMPLEEXAMPLE1234'] });
    expect(sent).not.toContain('EXAMPLEEXAMPLE1234');
    expect(sent).toContain('macOS');
    expect(out).not.toContain('LEAKLEAKLEAK9999');
  });
  it('大模型调用失败时把错误抛给界面', async () => {
    await expect(explainError(async () => { throw new Error('还没有设置大模型'); }, 'x', { os: 'win', tool: 'Codex' })).rejects.toThrow('还没有设置大模型');
  });
});
