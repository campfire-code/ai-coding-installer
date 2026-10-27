// check-zh: 整个文件忽略（官方文档的产品名、网址与命令原文，必须照抄官方）
// 可安装的工具清单。命令与系统要求只写在官方文档里核实过的内容；
// 每条都带 source（官方出处）。核实不了的地方直接写「未核实」。
import commands from './commands.json';

export type OsId = 'mac' | 'win' | 'linux';
export type ToolKey = 'claude' | 'codex' | 'openclaw' | 'hermes';

export interface InstallMethod {
  id: string;
  label: string;
  os: OsId[];
  /** commands.json 里的命令编号 */
  cmdId: string;
  /** 界面上展示给用户看的命令原文 */
  shown: string;
  /** 需要先装好的东西 */
  needs?: ('node' | 'npm' | 'brew' | 'winget')[];
  note?: string;
}

export interface ToolInfo {
  key: ToolKey;
  name: string;
  blurb: string;
  bin: string;
  docsUrl: string;
  requirement: string;
  methods: InstallMethod[];
  /** 接口配置方式；none 表示没有核实到官方的配置文件写法 */
  config: 'claude-settings' | 'codex-toml' | 'none';
  configNote: string;
  /** 已核实的官方出处 */
  source: string;
  /** Node 最低主版本（只有 npm 安装方式需要） */
  nodeMajorForNpm?: number;
  /** 仅 Apple 芯片的 macOS */
  macAppleSiliconOnly?: boolean;
}

export const TOOLS: ToolInfo[] = [
  {
    key: 'claude',
    name: 'Claude Code',
    blurb: 'Anthropic 官方的命令行 AI 编程助手，能读代码、改代码、跑测试。',
    bin: 'claude',
    docsUrl: 'https://code.claude.com/docs/en/setup',
    requirement: 'macOS 13 以上、Windows 10 1809 以上；内存 4 GB 以上；需要联网；使用地区须在 Anthropic 支持的国家和地区内。',
    nodeMajorForNpm: 22,
    methods: [
      { id: 'native', label: '官方安装脚本（推荐）', os: ['mac', 'linux'], cmdId: 'u.install.claude.native', shown: 'curl -fsSL https://claude.ai/install.sh | bash' },
      { id: 'native', label: '官方安装脚本（推荐）', os: ['win'], cmdId: 'w.install.claude.native', shown: 'irm https://claude.ai/install.ps1 | iex' },
      { id: 'brew', label: 'Homebrew', os: ['mac', 'linux'], cmdId: 'u.install.claude.brew', shown: 'brew install --cask claude-code', needs: ['brew'], note: 'Homebrew 安装不会自动更新。' },
      { id: 'winget', label: 'WinGet', os: ['win'], cmdId: 'w.install.claude.winget', shown: 'winget install Anthropic.ClaudeCode', needs: ['winget'], note: 'WinGet 安装不会自动更新。' },
      { id: 'npm', label: 'npm', os: ['mac', 'linux'], cmdId: 'u.install.claude.npm', shown: 'npm install -g @anthropic-ai/claude-code', needs: ['npm'], note: '需要 Node.js 22 以上；不要加 sudo。' },
      { id: 'npm', label: 'npm', os: ['win'], cmdId: 'w.install.claude.npm', shown: 'npm install -g @anthropic-ai/claude-code', needs: ['npm'], note: '需要 Node.js 22 以上。' },
    ],
    config: 'claude-settings',
    configNote: '写入用户配置文件 ~/.claude/settings.json 的 env 项（官方文档的写法）。接口必须兼容 Anthropic 的接口格式，只兼容 OpenAI 格式的地址不能用。',
    source: 'code.claude.com/docs/en/setup、settings、env-vars（2026-10-27 核实）',
  },
  {
    key: 'codex',
    name: 'Codex 命令行',
    blurb: 'OpenAI 官方的命令行编程助手，登录 ChatGPT 账号或使用接口密钥。',
    bin: 'codex',
    docsUrl: 'https://github.com/openai/codex',
    requirement: 'macOS 12 以上、Ubuntu 20.04 以上；内存 4 GB 以上（建议 8 GB）。Windows：官方仓库说明页写「Windows 11 通过 WSL2」，同时又提供 PowerShell 安装脚本，原生 Windows 是否完整支持未核实，以官方为准。',
    nodeMajorForNpm: undefined,
    methods: [
      { id: 'native', label: '官方安装脚本（推荐）', os: ['mac', 'linux'], cmdId: 'u.install.codex.native', shown: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh' },
      { id: 'native', label: '官方安装脚本（推荐）', os: ['win'], cmdId: 'w.install.codex.native', shown: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"' },
      { id: 'brew', label: 'Homebrew', os: ['mac', 'linux'], cmdId: 'u.install.codex.brew', shown: 'brew install --cask codex', needs: ['brew'] },
      { id: 'npm', label: 'npm', os: ['mac', 'linux'], cmdId: 'u.install.codex.npm', shown: 'npm install -g @openai/codex', needs: ['npm'], note: '官方没有写 Node.js 版本要求（未核实）。' },
      { id: 'npm', label: 'npm', os: ['win'], cmdId: 'w.install.codex.npm', shown: 'npm install -g @openai/codex', needs: ['npm'], note: '官方没有写 Node.js 版本要求（未核实）。' },
    ],
    config: 'codex-toml',
    configNote: '写入 ~/.codex/config.toml 的自定义服务（model_provider）；密钥放进环境变量，不写进配置文件。接口须支持 Codex 使用的 responses 格式。',
    source: 'github.com/openai/codex 的 README、docs/install.md；配置写法来自 OpenAI 官方 Codex 高级配置文档（2026-10-27 核实）',
  },
  {
    key: 'openclaw',
    name: 'OpenClaw',
    blurb: '开源的个人 AI 助手，装好后用引导命令接入聊天渠道。',
    bin: 'openclaw',
    docsUrl: 'https://docs.openclaw.ai/install',
    requirement: '官方文档写：支持 macOS、Linux、Windows；用 npm 装需要 Node 24.22.1 以上或 26.12.1 以上，官方安装脚本会自己补装 Node。',
    methods: [
      { id: 'native', label: '官方安装脚本（推荐）', os: ['mac', 'linux'], cmdId: 'u.install.openclaw.native', shown: 'curl -fsSL https://openclaw.ai/install.sh | bash' },
      { id: 'native', label: '官方安装脚本（推荐）', os: ['win'], cmdId: 'w.install.openclaw.native', shown: 'iwr -useb https://openclaw.ai/install.ps1 | iex' },
    ],
    config: 'none',
    configNote: '未核实：官方安装页没有写接口配置的文件位置与变量名。装好后在终端运行 openclaw onboard 按引导设置。',
    source: 'docs.openclaw.ai/install（2026-10-27 核实安装命令与系统要求）',
  },
  {
    key: 'hermes',
    name: 'Hermes Agent',
    blurb: 'Nous Research 的开源 AI 智能体，带长期记忆与技能。',
    bin: 'hermes',
    docsUrl: 'https://hermes-agent.nousresearch.com/docs/getting-started/installation',
    requirement: '官方文档写：macOS 只支持 Apple 芯片，Intel 版 Mac 不支持；Linux、WSL2 和原生 Windows 可用；类 Unix 系统需要 Git、curl、tar。',
    macAppleSiliconOnly: true,
    methods: [
      { id: 'native', label: '官方安装脚本', os: ['mac', 'linux'], cmdId: 'u.install.hermes.native', shown: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash' },
      { id: 'native', label: '官方安装脚本', os: ['win'], cmdId: 'w.install.hermes.native', shown: 'iex (irm https://hermes-agent.nousresearch.com/install.ps1)' },
    ],
    config: 'none',
    configNote: '未核实：自定义接口的写法没有核实到。装好后在终端运行 hermes model 选择模型来源并填密钥。',
    source: 'hermes-agent.nousresearch.com/docs/getting-started/installation（2026-10-27 核实）',
  },
];

export const toolOf = (key: ToolKey) => TOOLS.find((t) => t.key === key)!;

export function methodsFor(tool: ToolInfo, os: OsId): InstallMethod[] {
  return tool.methods.filter((m) => m.os.includes(os));
}

export const commandIds = new Set((commands as { id: string }[]).map((c) => c.id));

/** 官方下载地址：系统里缺这些时引导用户去下载 */
export const DOWNLOADS = {
  node: { name: 'Node.js', url: 'https://nodejs.org/en/download' },
  git: { name: 'Git', url: 'https://git-scm.com/downloads' },
  brew: { name: 'Homebrew', url: 'https://brew.sh' },
  winget: { name: 'WinGet（应用安装程序）', url: 'https://learn.microsoft.com/windows/package-manager/winget/' },
} as const;

/** 联网检测的地址：都是上面各工具官方安装脚本所在的域名 */
export const PROBES: { host: string; url: string; label: string }[] = [
  { host: 'claude.ai', url: 'https://claude.ai/install.sh', label: 'Claude Code 安装脚本' },
  { host: 'chatgpt.com', url: 'https://chatgpt.com/codex/install.sh', label: 'Codex 安装脚本' },
  { host: 'openclaw.ai', url: 'https://openclaw.ai/install.sh', label: 'OpenClaw 安装脚本' },
  { host: 'hermes-agent.nousresearch.com', url: 'https://hermes-agent.nousresearch.com/install.sh', label: 'Hermes 安装脚本' },
  { host: 'registry.npmjs.org', url: 'https://registry.npmjs.org/', label: 'npm 软件源' },
];
