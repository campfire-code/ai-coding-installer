import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { commandIds, TOOLS } from './catalog';
import { entryOf, resolveArgs, TABLE } from './exec';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../../src-tauri/capabilities/${f}`, import.meta.url), 'utf8'));

describe('命令白名单', () => {
  for (const [file, platform] of [['shell-unix.json', 'unix'], ['shell-windows.json', 'win']] as const) {
    it(`${file} 与 commands.json 完全一致（运行 node scripts/gen-capabilities.mjs 重新生成）`, () => {
      const cap = read(file);
      const expected = TABLE.filter((c) => c.platform === platform).map((c) => ({ name: c.id, cmd: c.cmd, args: c.args }));
      for (const id of ['shell:allow-execute', 'shell:allow-spawn']) {
        const p = cap.permissions.find((x: { identifier?: string }) => x.identifier === id);
        expect(p.allow).toEqual(expected);
      }
    });
  }

  it('主权限文件里没有任何 shell 命令权限', () => {
    expect(JSON.stringify(read('default.json'))).not.toContain('shell:');
  });

  it('白名单只允许 sh / cmd / powershell / setx，且每条的参数都写死（setx 的取值带正则）', () => {
    for (const c of TABLE) {
      expect(['sh', 'cmd', 'powershell', 'setx']).toContain(c.cmd);
      const dynamic = c.args.filter((a) => typeof a !== 'string');
      expect(dynamic.length).toBe(c.id === 'w.setenv.codex' ? 1 : 0);
    }
  });

  it('目录里引用的每个命令编号都在白名单里，且 id 不重复', () => {
    for (const t of TOOLS) for (const m of t.methods) expect(commandIds.has(m.cmdId), m.cmdId).toBe(true);
    expect(new Set(TABLE.map((c) => c.id)).size).toBe(TABLE.length);
  });

  it('展示给用户的命令原文出现在白名单实际执行的命令里', () => {
    for (const t of TOOLS) for (const m of t.methods) {
      const actual = entryOf(m.cmdId).args.filter((a) => typeof a === 'string').join(' ');
      const shown = m.shown.replace(/^powershell /, '').replace(/^npm install/, 'npm install');
      expect(actual.includes(shown) || actual.includes(shown.replace(/^-ExecutionPolicy ByPass -c "(.*)"$/, '$1')) || shown.includes(actual.split('; ').pop()!), `${m.cmdId}\n${actual}\n${shown}`).toBe(true);
    }
  });

  it('setx 的取值：合法密钥通过，带空格、引号、分号、过短的被拒绝', () => {
    const e = entryOf('w.setenv.codex');
    expect(resolveArgs(e, ['sk-EXAMPLEEXAMPLE1234'])).toEqual(['CAMPFIRE_CODEX_API_KEY', 'sk-EXAMPLEEXAMPLE1234']);
    for (const bad of ['a b c d e f g h', 'abc"def12345', 'abcdefgh;calc', 'short', 'a&b=12345678', '']) expect(() => resolveArgs(e, [bad]), bad).toThrow();
    expect(() => resolveArgs(e, [])).toThrow();
  });

  it('不在白名单里的命令编号直接报错', () => {
    expect(() => entryOf('u.rm.everything')).toThrow(/白名单/);
  });
});
