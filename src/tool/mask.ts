// 日志打码：密钥、令牌不出现在界面、日志和发给大模型的文字里。
const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{16,}/g,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
  /((?:api[_-]?key|auth[_-]?token|access[_-]?token|secret|password|authorization)["']?\s*[:=]\s*["']?)[^\s"',;]{4,}/gi,
  /(https?:\/\/[^\s/:@]+:)[^\s/@]+(@)/g,
];

/** 把文字里的密钥打码；secrets 是已知的密钥原文（比如用户刚填的），整段替换 */
export function maskSecrets(text: string, secrets: string[] = []): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join('***');
  }
  out = out.replace(PATTERNS[0], 'sk-***');
  out = out.replace(PATTERNS[1], '***');
  out = out.replace(PATTERNS[2], '$1***');
  out = out.replace(PATTERNS[3], '$1***');
  out = out.replace(PATTERNS[4], '$1***$2');
  return out;
}

/** 界面上显示密钥时只留前 3 位和后 2 位 */
export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '***';
  return `${key.slice(0, 3)}***${key.slice(-2)}`;
}
