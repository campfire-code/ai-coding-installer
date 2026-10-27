// 由 src/tool/commands.json 生成 shell 命令白名单：node scripts/gen-capabilities.mjs
// 测试 src/tool/capabilities.test.ts 会检查生成结果与白名单表一致，应用只能执行表里列出的命令。
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('..', import.meta.url).pathname;
const table = JSON.parse(readFileSync(dir + 'src/tool/commands.json', 'utf8'));

export function buildCapability(platform) {
  const allow = table
    .filter((c) => c.platform === platform)
    .map((c) => ({ name: c.id, cmd: c.cmd, args: c.args }));
  return {
    $schema: '../gen/schemas/desktop-schema.json',
    identifier: platform === 'unix' ? 'shell-unix' : 'shell-windows',
    description: platform === 'unix'
      ? '只允许执行白名单里的安装与检测命令（macOS / Linux），每条命令的参数写死'
      : '只允许执行白名单里的安装与检测命令（Windows），每条命令的参数写死；仅 setx 的取值受正则限制',
    windows: ['main'],
    platforms: platform === 'unix' ? ['macOS', 'linux'] : ['windows'],
    permissions: [
      { identifier: 'shell:allow-execute', allow },
      { identifier: 'shell:allow-spawn', allow },
      'shell:allow-kill',
    ],
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  for (const p of ['unix', 'win']) {
    const c = buildCapability(p);
    writeFileSync(`${dir}src-tauri/capabilities/shell-${p === 'unix' ? 'unix' : 'windows'}.json`, JSON.stringify(c, null, 2) + '\n');
  }
  console.log('已生成 shell-unix.json、shell-windows.json');
}
