import { describe, expect, it } from 'vitest';
import { backupName, mergeClaudeSettings, mergeCodexToml, mergeShellProfile, validateConfig, type ApiConfig } from './configs';

const cfg: ApiConfig = { baseUrl: 'https://gateway.example.com/', apiKey: 'sk-EXAMPLEEXAMPLE1234', model: 'example-model', keyKind: 'token' };

describe('Claude Code 配置', () => {
  it('新建时只写 env 三项', () => {
    const o = JSON.parse(mergeClaudeSettings(null, cfg));
    expect(o.env).toEqual({ ANTHROPIC_BASE_URL: 'https://gateway.example.com', ANTHROPIC_AUTH_TOKEN: cfg.apiKey, ANTHROPIC_MODEL: 'example-model' });
  });
  it('保留原有设置，并清掉另一种密钥变量', () => {
    const old = JSON.stringify({ theme: 'dark', permissions: { allow: ['Bash(ls)'] }, env: { FOO: '1', ANTHROPIC_API_KEY: 'old-old-old' } });
    const o = JSON.parse(mergeClaudeSettings(old, cfg));
    expect(o.theme).toBe('dark');
    expect(o.permissions.allow).toEqual(['Bash(ls)']);
    expect(o.env.FOO).toBe('1');
    expect(o.env.ANTHROPIC_API_KEY).toBeUndefined();
  });
  it('选 API Key 方式时写 ANTHROPIC_API_KEY', () => {
    const o = JSON.parse(mergeClaudeSettings('{"env":{"ANTHROPIC_AUTH_TOKEN":"x"}}', { ...cfg, keyKind: 'apikey' }));
    expect(o.env.ANTHROPIC_API_KEY).toBe(cfg.apiKey);
    expect(o.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });
  it('模型名留空时去掉旧的模型设置', () => {
    const o = JSON.parse(mergeClaudeSettings('{"env":{"ANTHROPIC_MODEL":"old"}}', { ...cfg, model: '' }));
    expect(o.env.ANTHROPIC_MODEL).toBeUndefined();
  });
  it('原文件不是合法 JSON 时拒绝改动', () => {
    expect(() => mergeClaudeSettings('{ "env": // 注释\n}', cfg)).toThrow(/不是合法的 JSON/);
    expect(() => mergeClaudeSettings('[1,2]', cfg)).toThrow();
  });
});

describe('Codex 配置', () => {
  it('新建：顶部 model 与 model_provider，末尾服务表，密钥不写进文件', () => {
    const t = mergeCodexToml(null, cfg);
    expect(t.indexOf('model = "example-model"')).toBeLessThan(t.indexOf('[model_providers.campfire]'));
    expect(t).toContain('model_provider = "campfire"');
    expect(t).toContain('base_url = "https://gateway.example.com"');
    expect(t).toContain('env_key = "CAMPFIRE_CODEX_API_KEY"');
    expect(t).toContain('wire_api = "responses"');
    expect(t).not.toContain(cfg.apiKey);
  });
  it('已有设置：顶层 model 被注释，其他表保留，重复写入不叠加', () => {
    const old = 'model = "gpt-old"\napproval_policy = "never"\n\n[projects."/a"]\ntrust_level = "trusted"\n';
    const once = mergeCodexToml(old, cfg);
    expect(once).toContain('# （已被篝火安装器注释）model = "gpt-old"');
    expect(once).toContain('approval_policy = "never"');
    expect(once).toContain('[projects."/a"]');
    const twice = mergeCodexToml(once, { ...cfg, model: 'm2' });
    expect(twice.match(/\[model_providers\.campfire\]/g)).toHaveLength(1);
    expect(twice.match(/^model = /gm)).toHaveLength(1);
    expect(twice).toContain('model = "m2"');
    expect(twice).toContain('trust_level = "trusted"');
  });
  it('表里的 model 键不被当成顶层键注释', () => {
    const old = '[profiles.a]\nmodel = "keep"\n';
    expect(mergeCodexToml(old, cfg)).toContain('[profiles.a]\nmodel = "keep"');
  });
  it('shell 配置里的密钥块可重复替换，单引号被转义', () => {
    const a = mergeShellProfile('export A=1\n', 'K', "ab'cd");
    expect(a).toContain("export K='ab'\\''cd'");
    const b = mergeShellProfile(a, 'K', 'new-value-1');
    expect(b.match(/export K=/g)).toHaveLength(1);
    expect(b).toContain('export A=1');
    expect(b).not.toContain("ab'");
  });
});

describe('校验', () => {
  it('地址、密钥、模型名', () => {
    expect(validateConfig({ ...cfg, baseUrl: 'gateway.example.com' }, false)).toMatch(/http/);
    expect(validateConfig({ ...cfg, apiKey: ' ' }, false)).toMatch(/密钥/);
    expect(validateConfig({ ...cfg, apiKey: 'a b' }, false)).toMatch(/空格/);
    expect(validateConfig({ ...cfg, model: '' }, true)).toMatch(/模型/);
    expect(validateConfig({ ...cfg, model: '' }, false)).toBeNull();
    expect(validateConfig(cfg, true)).toBeNull();
  });
  it('备份文件名带时间', () => {
    expect(backupName('/h/.codex/config.toml', new Date('2026-10-27T08:09:10Z'))).toBe('/h/.codex/config.toml.bak-20261027080910');
  });
});
