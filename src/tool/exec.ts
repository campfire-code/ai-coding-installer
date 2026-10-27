// 命令执行：只能执行 commands.json 白名单里的命令（与 src-tauri/capabilities/shell-*.json 一致）。
// 测试和预览时换成假的执行函数，不会真的运行任何命令。
import commands from './commands.json';

export interface CmdEntry {
  id: string;
  platform: 'unix' | 'win';
  cmd: string;
  args: (string | { validator: string })[];
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ExecOpts {
  /** 带正则限制的参数取值（目前只有 setx 的密钥） */
  extra?: string[];
  onLine?: (line: string, stream: 'out' | 'err') => void;
  signal?: AbortSignal;
}

export type Exec = (id: string, opts?: ExecOpts) => Promise<ExecResult>;

export const TABLE = commands as CmdEntry[];

export function entryOf(id: string): CmdEntry {
  const e = TABLE.find((c) => c.id === id);
  if (!e) throw new Error(`命令 ${id} 不在白名单里`);
  return e;
}

/** 按白名单展开参数：固定参数原样，带正则的参数用 extra 依次填入并检查 */
export function resolveArgs(e: CmdEntry, extra: string[] = []): string[] {
  let i = 0;
  return e.args.map((a) => {
    if (typeof a === 'string') return a;
    const v = extra[i++];
    if (v === undefined || !new RegExp(a.validator).test(v)) throw new Error('参数不符合白名单要求（密钥含有不支持的字符或长度不对）');
    return v;
  });
}

/** 真实执行：经 Tauri shell 插件，按名字调用白名单命令 */
export async function tauriExec(id: string, opts: ExecOpts = {}): Promise<ExecResult> {
  const { Command } = await import('@tauri-apps/plugin-shell');
  const e = entryOf(id);
  const cmd = Command.create(id, resolveArgs(e, opts.extra));
  let stdout = '';
  let stderr = '';
  const feed = (buf: string, chunk: string, stream: 'out' | 'err') => {
    chunk.split(/\r?\n/).forEach((l) => l.trim() && opts.onLine?.(l, stream));
    return buf + chunk + '\n';
  };
  cmd.stdout.on('data', (c: string) => (stdout = feed(stdout, c, 'out')));
  cmd.stderr.on('data', (c: string) => (stderr = feed(stderr, c, 'err')));
  const child = await cmd.spawn();
  const onAbort = () => void child.kill();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const code = await new Promise<number | null>((resolve, reject) => {
    cmd.on('close', (ev) => resolve(ev.code));
    cmd.on('error', (err) => reject(new Error(String(err))));
  });
  opts.signal?.removeEventListener('abort', onAbort);
  if (opts.signal?.aborted) throw new Error('已取消');
  return { code, stdout, stderr };
}
