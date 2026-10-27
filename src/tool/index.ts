// 工具声明：AI 编程工具一键安装器（自定义界面：工具卡片 + 环境检测 + 接口配置 + 实时输出）
import { Rocket } from 'lucide-react';
import { createElement } from 'react';
import type { CustomTool } from '../kit/types';
import { Installer } from './Main';

const tool: CustomTool = {
  id: 'a07',
  name: 'AI 编程工具一键安装器',
  tagline: '双击装好 Claude Code、Codex 等 AI 编程工具，自填接口自动配好，安装报错有引导',
  icon: Rocket,
  category: 'AI 助手',
  type: 'text',
  mode: 'custom',
  mainLabel: '安装',
  needsLLM: false,
  params: [],
  Main: ({ ctx }) => createElement(Installer, { ctx }),
};

export default tool;
