// 安装被拦时的识别规则：把报错文字对上已知的 15 类情况，给出大白话原因和下一步。
// 纯函数，不执行任何命令。
import type { OsId } from './catalog';

export interface IssueAction {
  label: string;
  kind: 'open_url' | 'copy' | 'retry';
  payload?: string;
}

export interface Issue {
  code: string;
  title: string;
  cause: string;
  actions: IssueAction[];
  severity: 'warn' | 'error' | 'blocker';
}

export interface DiagnoseContext {
  os: OsId;
  /** 安装路径（Windows 上含中文或空格会出问题） */
  installPath?: string;
  /** 写文件失败 */
  writeFailed?: boolean;
  /** 目标已存在旧版本 */
  targetExists?: boolean;
  overwriteConfirmed?: boolean;
}

const URL_MAC_SECURITY = 'https://support.apple.com/zh-cn/guide/mac-help/mh40616/mac';
const URL_SMARTSCREEN = 'https://learn.microsoft.com/zh-cn/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/';
const URL_CLAUDE_TROUBLE = 'https://code.claude.com/docs/en/troubleshoot-install';

export function diagnose(raw: string, ctx: DiagnoseContext): Issue | null {
  const txt = (raw || '').toLowerCase();
  const mac = ctx.os === 'mac';
  const win = ctx.os === 'win';

  // 1 macOS 不让打开
  if (mac && (txt.includes('verified developer') || txt.includes('无法验证') || txt.includes('cannot be opened'))) {
    return {
      code: 'MAC_GATEKEEPER', severity: 'blocker',
      title: 'macOS 拦截了这个程序',
      cause: '苹果默认拦截没有开发者签名的程序。第一次需要你手动放行。',
      actions: [
        { label: '查看放行方法', kind: 'open_url', payload: URL_MAC_SECURITY },
        { label: '复制解除隔离命令', kind: 'copy', payload: 'xattr -cr ~/.local/bin/claude' },
      ],
    };
  }
  // 2 提示应用已损坏
  if (mac && txt.includes('damaged')) {
    return {
      code: 'MAC_DAMAGED', severity: 'error',
      title: '提示「应用已损坏」',
      cause: '下载过程中被系统打上了隔离标记，程序本身没有坏。',
      actions: [
        { label: '复制解除隔离命令', kind: 'copy', payload: 'xattr -cr ~/.local/bin/claude' },
        { label: '查看详细教程', kind: 'open_url', payload: URL_MAC_SECURITY },
      ],
    };
  }
  // 3 Windows SmartScreen
  if (win && txt.includes('smartscreen')) {
    return {
      code: 'WIN_SMARTSCREEN', severity: 'blocker',
      title: 'Windows 提示「已保护你的电脑」',
      cause: 'SmartScreen 拦截了未知发布者的程序。点「更多信息」再点「仍要运行」。',
      actions: [{ label: '查看官方说明', kind: 'open_url', payload: URL_SMARTSCREEN }],
    };
  }
  // 4 杀毒软件拦截
  if (win && ctx.writeFailed && (txt.includes('operation not permitted') || txt.includes('access is denied') || txt.includes('permission denied') || txt.includes('拒绝访问'))) {
    return {
      code: 'WIN_AV_BLOCKED', severity: 'error',
      title: '文件被杀毒软件拦截',
      cause: '安全软件可能把下载的程序当成可疑文件。把安装目录加入白名单后重试。',
      actions: [
        { label: '重试安装', kind: 'retry' },
        { label: '查看 Defender 白名单方法', kind: 'open_url', payload: 'https://support.microsoft.com/zh-cn/topic/4028485' },
      ],
    };
  }
  // 5 端口被占用
  const portMatch = /port\s+(\d+)[^\n]*in use|address already in use[^\n]*?:(\d+)|eaddrinuse[^\n]*?:(\d+)/.exec(txt);
  if (portMatch) {
    const port = portMatch.slice(1).find(Boolean) ?? '';
    return {
      code: 'PORT_IN_USE', severity: 'warn',
      title: `端口 ${port} 被占用`,
      cause: '另一个程序正在占用这个端口，可能是上次没有完全退出。',
      actions: [{ label: '复制查占用命令', kind: 'copy', payload: win ? `netstat -ano | findstr :${port}` : `lsof -i :${port}` }],
    };
  }
  // 6 磁盘空间不足
  if (txt.includes('no space left') || txt.includes('disk full') || txt.includes('磁盘已满') || txt.includes('enospc')) {
    return {
      code: 'DISK_FULL', severity: 'error',
      title: '磁盘空间不足',
      cause: '安装位置所在的磁盘已满。清理一些空间后重试。',
      actions: [{ label: '重试安装', kind: 'retry' }],
    };
  }
  // 7 路径含中文或空格
  if (win && ctx.installPath && (/[^\u0020-\u007e]/.test(ctx.installPath) || ctx.installPath.includes(' '))) {
    return {
      code: 'WIN_PATH_NON_ASCII', severity: 'warn',
      title: '安装路径含中文或空格',
      cause: `npm 等工具在含中文或空格的路径下常出错。当前路径：${ctx.installPath}`,
      actions: [{ label: '复制建议路径', kind: 'copy', payload: 'D:\\tools' }],
    };
  }
  // 8 已存在旧版本
  if (ctx.targetExists && !ctx.overwriteConfirmed) {
    return {
      code: 'EXISTING_INSTALL', severity: 'warn',
      title: '已经装过旧版本',
      cause: '这台电脑上已有同名命令。重新安装会覆盖它。',
      actions: [{ label: '覆盖安装', kind: 'retry' }],
    };
  }
  // 9 命令找不到（PATH 没生效）
  if (txt.includes('command not found') || txt.includes('is not recognized as') || txt.includes('不是内部或外部命令') || txt.includes('enoent')) {
    return {
      code: 'PATH_NOT_LOADED', severity: 'warn',
      title: '命令找不到（PATH 没生效）',
      cause: '新装的命令需要新开一个终端窗口才读得到；也可能是安装目录还没加进 PATH。',
      actions: [
        { label: '查看官方排查方法', kind: 'open_url', payload: `${URL_CLAUDE_TROUBLE}#command-not-found-claude-after-installation` },
        { label: '复制查看 PATH 的命令', kind: 'copy', payload: win ? 'echo %PATH%' : 'echo $PATH' },
      ],
    };
  }
  // 10 网络不通
  if (txt.includes('connection refused') || txt.includes('could not resolve') || txt.includes('timed out') || txt.includes('etimedout') || txt.includes('econnreset') || txt.includes('enotfound')) {
    return {
      code: 'NET_RUNTIME', severity: 'error',
      title: '网络异常，连不上下载地址',
      cause: '网络断开、被限制或域名解析出错。先在「环境检测」里看哪些地址连不上。',
      actions: [{ label: '重新检测网络', kind: 'retry' }],
    };
  }
  // 11 Node 版本太旧
  if (txt.includes('unsupported engine') || txt.includes('ebadengine') || txt.includes('需要 node >=') || /requires node(\.js)?\s*(version)?\s*[>=]/.test(txt)) {
    return {
      code: 'NODE_RUNTIME_OLD', severity: 'error',
      title: 'Node.js 版本太旧',
      cause: '这个工具要求更高版本的 Node.js。升级 Node.js 后再装，或改用官方安装脚本方式（不依赖 Node.js）。',
      actions: [{ label: '打开 Node.js 官方下载页', kind: 'open_url', payload: 'https://nodejs.org/en/download' }],
    };
  }
  // 12 Windows 旧目录被占用
  if (win && (txt.includes('eperm') || txt.includes('operation not permitted')) && txt.includes('node_modules')) {
    return {
      code: 'WIN_NODE_MODULES_LOCKED', severity: 'error',
      title: '旧安装目录被占用',
      cause: 'Windows 正在占用旧的 node_modules 目录。关闭正在运行的终端和编辑器后重试。',
      actions: [{ label: '重试安装', kind: 'retry' }],
    };
  }
  // 13 npm 全局目录没有写权限
  if (txt.includes('eacces') || (txt.includes('permission denied') && txt.includes('npm'))) {
    return {
      code: 'NPM_EACCES', severity: 'error',
      title: 'npm 全局目录没有写权限',
      cause: '不要用 sudo 重装，会留下权限隐患。官方建议改用安装脚本方式，或把 npm 全局目录改到自己的用户目录。',
      actions: [{ label: '查看官方排查方法', kind: 'open_url', payload: `${URL_CLAUDE_TROUBLE}#permission-errors-during-installation` }],
    };
  }
  // 14 安装脚本地址返回了网页而不是脚本
  if (txt.includes("syntax error near unexpected token `<'") || txt.includes('syntax error near unexpected token "<"') || /\b403\b/.test(txt) || txt.includes('forbidden')) {
    return {
      code: 'INSTALL_SCRIPT_BLOCKED', severity: 'error',
      title: '安装脚本没有下载下来',
      cause: '脚本地址返回了错误网页（地区限制、网络代理或被拦截），不是真正的脚本。换网络或关闭代理后重试，或改用其他安装方式。',
      actions: [
        { label: '查看官方排查方法', kind: 'open_url', payload: URL_CLAUDE_TROUBLE },
        { label: '重试安装', kind: 'retry' },
      ],
    };
  }
  // 15 PowerShell 不允许运行脚本
  if (win && (txt.includes('running scripts is disabled') || txt.includes('执行策略') || txt.includes('about_execution_policies'))) {
    return {
      code: 'PS_EXECUTION_POLICY', severity: 'blocker',
      title: 'PowerShell 不允许运行脚本',
      cause: '系统的脚本执行策略太严格。可以在 PowerShell 里先放宽当前用户的策略，再重试。',
      actions: [
        { label: '复制放宽命令', kind: 'copy', payload: 'Set-ExecutionPolicy -Scope CurrentUser RemoteSigned' },
        { label: '重试安装', kind: 'retry' },
      ],
    };
  }
  return null;
}

/** 没有匹配上任何规则时的兜底卡片 */
export function fallbackIssue(raw: string): Issue {
  const detail = (raw || '').trim();
  const shown = detail.length > 600 ? `${detail.slice(0, 600)}…（已截断）` : detail;
  return {
    code: 'UNKNOWN', severity: 'warn',
    title: '没见过的报错',
    cause: shown || '没有收到错误信息。',
    actions: [{ label: '复制完整报错', kind: 'copy', payload: detail }],
  };
}

export const ISSUE_CODES = [
  'MAC_GATEKEEPER', 'MAC_DAMAGED', 'WIN_SMARTSCREEN', 'WIN_AV_BLOCKED', 'PORT_IN_USE', 'DISK_FULL', 'WIN_PATH_NON_ASCII', 'EXISTING_INSTALL',
  'PATH_NOT_LOADED', 'NET_RUNTIME', 'NODE_RUNTIME_OLD', 'WIN_NODE_MODULES_LOCKED', 'NPM_EACCES', 'INSTALL_SCRIPT_BLOCKED', 'PS_EXECUTION_POLICY',
] as const;
