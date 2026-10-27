import { describe, expect, it } from 'vitest';
import { diagnose, fallbackIssue, ISSUE_CODES, type DiagnoseContext } from './diagnose';

const mac: DiagnoseContext = { os: 'mac' };
const win: DiagnoseContext = { os: 'win' };

// 每类各一条真实形态的报错文字 → 期望识别出的编号
const CASES: [string, string, DiagnoseContext][] = [
  ['MAC_GATEKEEPER', '"claude" cannot be opened because the developer cannot be verified.', mac],
  ['MAC_GATEKEEPER', '无法验证开发者', mac],
  ['MAC_DAMAGED', '"codex" is damaged and can\'t be opened', mac],
  ['WIN_SMARTSCREEN', 'Windows SmartScreen prevented an unrecognized app from starting', win],
  ['WIN_AV_BLOCKED', 'Access is denied: C:\\Users\\a\\.local\\bin\\claude.exe', { os: 'win', writeFailed: true }],
  ['PORT_IN_USE', 'Error: listen EADDRINUSE: address already in use :::18789', mac],
  ['PORT_IN_USE', 'port 8080 is already in use', mac],
  ['DISK_FULL', 'tar: write error: No space left on device', mac],
  ['WIN_PATH_NON_ASCII', '安装失败', { os: 'win', installPath: 'C:\\用户\\小明\\tools' }],
  ['WIN_PATH_NON_ASCII', '安装失败', { os: 'win', installPath: 'C:\\Program Files\\tools' }],
  ['EXISTING_INSTALL', '', { os: 'mac', targetExists: true }],
  ['PATH_NOT_LOADED', 'zsh: command not found: claude', mac],
  ['PATH_NOT_LOADED', "'claude' is not recognized as an internal or external command", win],
  ['NET_RUNTIME', 'curl: (6) Could not resolve host: claude.ai', mac],
  ['NET_RUNTIME', 'npm ERR! code ETIMEDOUT', mac],
  ['NODE_RUNTIME_OLD', 'npm WARN EBADENGINE Unsupported engine', mac],
  ['WIN_NODE_MODULES_LOCKED', 'npm ERR! code EPERM operation not permitted, rmdir node_modules\\foo', win],
  ['NPM_EACCES', 'npm ERR! code EACCES\nnpm ERR! syscall mkdir /usr/local/lib/node_modules', mac],
  ['INSTALL_SCRIPT_BLOCKED', "bash: line 1: syntax error near unexpected token `<'", mac],
  ['INSTALL_SCRIPT_BLOCKED', 'curl: (22) The requested URL returned error: 403', mac],
  ['PS_EXECUTION_POLICY', 'File cannot be loaded because running scripts is disabled on this system.', win],
];

describe('安装被拦的识别规则', () => {
  it.each(CASES)('%s：%s', (code, text, ctx) => {
    expect(diagnose(text, ctx)?.code).toBe(code);
  });

  it('15 类规则每一类至少有一条用例', () => {
    const covered = new Set(CASES.map((c) => c[0]));
    for (const code of ISSUE_CODES) expect(covered.has(code), code).toBe(true);
    expect(ISSUE_CODES).toHaveLength(15);
  });

  it('系统不对的规则不会误触发', () => {
    expect(diagnose('cannot be opened', win)).toBeNull();
    expect(diagnose('smartscreen', mac)).toBeNull();
    expect(diagnose('running scripts is disabled', mac)).toBeNull();
  });

  it('已经确认覆盖时不再提示已存在', () => {
    expect(diagnose('', { os: 'mac', targetExists: true, overwriteConfirmed: true })).toBeNull();
  });

  it('没见过的报错返回空，兜底卡片截断并带复制按钮', () => {
    expect(diagnose('something weird happened', mac)).toBeNull();
    const f = fallbackIssue('x'.repeat(1000));
    expect(f.code).toBe('UNKNOWN');
    expect(f.cause.length).toBeLessThan(700);
    expect(f.actions[0].kind).toBe('copy');
    expect(fallbackIssue('').cause).toBe('没有收到错误信息。');
  });

  it('每张卡片都有标题、原因和至少一个动作（不含客服、激活等内容）', () => {
    for (const [, text, ctx] of CASES) {
      const i = diagnose(text, ctx)!;
      expect(i.title && i.cause && i.actions.length > 0).toBeTruthy();
      expect(JSON.stringify(i)).not.toMatch(/客服|微信|激活|充值/);
    }
  });
});
