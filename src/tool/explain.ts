// 没见过的报错：交给用户自己配置的大模型翻译成大白话。发送前先打码。
import { maskSecrets } from './mask';
import type { OsId } from './catalog';

export type ChatFn = (messages: { role: 'system' | 'user' | 'assistant'; content: string }[], opts?: { temperature?: number }) => Promise<string>;

export const EXPLAIN_SYSTEM = `你是安装助手，帮不懂技术的用户看懂安装 AI 编程工具时遇到的报错。
要求：
1. 先用一句大白话说清楚出了什么问题；
2. 再给 1 到 3 个具体步骤，每步一句话，写成用户能照着做的操作；
3. 不确定的地方直接说「无法确定」，不要编造命令或网址；
4. 全部用简体中文，不超过 300 字。`;

export function buildExplainMessages(raw: string, ctx: { os: OsId; tool: string; secrets?: string[] }) {
  const clipped = maskSecrets(raw, ctx.secrets).slice(-2000);
  const osName = ctx.os === 'mac' ? 'macOS' : ctx.os === 'win' ? 'Windows' : 'Linux';
  return [
    { role: 'system' as const, content: EXPLAIN_SYSTEM },
    { role: 'user' as const, content: `系统：${osName}\n正在安装：${ctx.tool}\n报错内容：\n${clipped}` },
  ];
}

export async function explainError(chat: ChatFn, raw: string, ctx: { os: OsId; tool: string; secrets?: string[] }): Promise<string> {
  const text = await chat(buildExplainMessages(raw, ctx), { temperature: 0.2 });
  return maskSecrets(text.trim(), ctx.secrets);
}
