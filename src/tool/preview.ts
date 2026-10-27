// 截图与预览用的示例状态：两个已装好、一个安装中。全部是示例数据，不会执行任何命令。
import type { Env } from './flow';
import type { ApiConfig } from './configs';

export const PREVIEW_ENV: Env = {
  os: 'mac',
  arch: 'arm64',
  node: '22.11.0',
  git: '2.45.1',
  npm: '10.9.0',
  brew: true,
  winget: false,
  tools: {
    claude: { installed: true, version: '2.1.211' },
    codex: { installed: true, version: '0.1.0' },
    openclaw: { installed: false },
    hermes: { installed: false },
  },
  net: [
    { host: 'claude.ai', label: 'Claude Code 安装脚本', ok: true },
    { host: 'chatgpt.com', label: 'Codex 安装脚本', ok: true },
    { host: 'openclaw.ai', label: 'OpenClaw 安装脚本', ok: true },
    { host: 'hermes-agent.nousresearch.com', label: 'Hermes 安装脚本', ok: false },
    { host: 'registry.npmjs.org', label: 'npm 软件源', ok: true },
  ],
};

export const PREVIEW_LOG = [
  '【示例】以下输出是演示数据，不是真实安装记录',
  '$ curl -fsSL https://openclaw.ai/install.sh | bash',
  '正在检测系统……',
  '正在下载安装包……',
  '正在校验文件……',
  '正在写入安装目录……',
];

export const PREVIEW_CONFIG: ApiConfig = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-EXAMPLEEXAMPLE1234',
  model: 'example-model',
  keyKind: 'token',
};
