import { describe, expect, it } from 'vitest';
import { maskKey, maskSecrets } from './mask';

describe('打码', () => {
  it('已知密钥整段替换', () => {
    expect(maskSecrets('token=abcdef123456 done', ['abcdef123456'])).not.toContain('abcdef123456');
  });
  it('sk- 开头的密钥', () => {
    expect(maskSecrets('key sk-EXAMPLEEXAMPLE1234 end')).toBe('key sk-*** end');
  });
  it('Bearer 令牌与键值对', () => {
    expect(maskSecrets('Authorization: Bearer abcdefghijkl')).not.toContain('abcdefghijkl');
    expect(maskSecrets('ANTHROPIC_AUTH_TOKEN=zzzzzzzz9999')).toBe('ANTHROPIC_AUTH_TOKEN=***');
    expect(maskSecrets('"api_key": "qqqqqqqq1111"')).not.toContain('qqqqqqqq1111');
  });
  it('网址里的账号密码', () => {
    expect(maskSecrets('https://user:hunter2pass@example.com/x')).toBe('https://user:***@example.com/x');
  });
  it('普通文字不变', () => {
    expect(maskSecrets('npm install -g @openai/codex')).toBe('npm install -g @openai/codex');
  });
  it('界面显示密钥只留头尾', () => {
    expect(maskKey('sk-EXAMPLEEXAMPLE1234')).toBe('sk-***34');
    expect(maskKey('short')).toBe('***');
    expect(maskKey('')).toBe('');
  });
});
