// 主界面：左边选工具并安装，右边看环境、填接口，底部是实时输出和报错引导。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, Copy, Download, ExternalLink, Eye, EyeOff, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { exists } from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';
import type { RunContext } from '../kit/types';
import { httpFetch, openLink, settingsStore } from '../kit/platform';
import { chat, llmReady, useSettings } from '../kit/settings';
import { DOWNLOADS, methodsFor, TOOLS, toolOf, type ToolInfo, type ToolKey } from './catalog';
import type { ApiConfig } from './configs';
import type { Issue, IssueAction } from './diagnose';
import { explainError } from './explain';
import { tauriExec, type Exec } from './exec';
import { applyConfig, checkRequirements, detectEnv, detectOs, installTool, type Env } from './flow';
import { maskKey, maskSecrets } from './mask';
import { PREVIEW_CONFIG, PREVIEW_ENV, PREVIEW_LOG } from './preview';
import './tool.css';

type Ctx = Pick<RunContext, 'readText' | 'writeText' | 'join'>;
type Phase = 'idle' | 'installing' | 'ok' | 'fail';
interface Shown { tool: ToolKey; issue: Issue; raw: string }

const isPreview = typeof location !== 'undefined' && location.pathname.endsWith('preview.html');
const EMPTY_CFG: ApiConfig = { baseUrl: '', apiKey: '', model: '', keyKind: 'token' };
const PROFILE_KEY = 'profiles.a07';

/** 联网检测：能收到任何 HTTP 回应就算通；6 秒没回应算不通 */
async function probe(url: string): Promise<boolean> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 6000);
  try {
    await httpFetch(url, { method: 'GET', signal: ac.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function Installer({ ctx }: { ctx: Ctx }) {
  const settings = useSettings();
  const os = useMemo(() => (isPreview ? PREVIEW_ENV.os : detectOs(navigator.userAgent)), []);
  const [env, setEnv] = useState<Env | null>(isPreview ? PREVIEW_ENV : null);
  const [checking, setChecking] = useState(false);
  const [phase, setPhase] = useState<Record<ToolKey, Phase>>({ claude: 'idle', codex: 'idle', openclaw: isPreview ? 'installing' : 'idle', hermes: 'idle' });
  const [method, setMethod] = useState<Record<ToolKey, string>>({ claude: 'native', codex: 'native', openclaw: 'native', hermes: 'native' });
  const [log, setLog] = useState<string[]>(isPreview ? PREVIEW_LOG : []);
  const [shown, setShown] = useState<Shown | null>(null);
  const [ai, setAi] = useState<{ busy: boolean; text?: string; err?: string }>({ busy: false });
  const [cfgTool, setCfgTool] = useState<'claude' | 'codex'>('claude');
  const [profiles, setProfiles] = useState<Record<string, ApiConfig>>(isPreview ? { claude: PREVIEW_CONFIG, codex: PREVIEW_CONFIG } : {});
  const [showKey, setShowKey] = useState(false);
  const [cfgMsg, setCfgMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const logBox = useRef<HTMLPreElement>(null);
  const exec: Exec = tauriExec;

  const cfg = profiles[cfgTool] ?? EMPTY_CFG;
  const secrets = useMemo(() => Object.values(profiles).map((p) => p.apiKey).filter(Boolean), [profiles]);
  const addLog = useCallback((line: string) => setLog((l) => [...l.slice(-399), maskSecrets(line, secrets)]), [secrets]);

  const refresh = useCallback(async () => {
    if (isPreview) return;
    setChecking(true);
    try { setEnv(await detectEnv(exec, os, probe)); } finally { setChecking(false); }
  }, [os, exec]);

  useEffect(() => {
    if (isPreview) return;
    void refresh();
    settingsStore().then((s) => s.get<Record<string, ApiConfig>>(PROFILE_KEY)).then((p) => p && setProfiles(p)).catch(() => {});
  }, [refresh]);
  useEffect(() => { const el = logBox.current; if (el) el.scrollTop = el.scrollHeight; }, [log]);

  const setCfg = (patch: Partial<ApiConfig>) => {
    const next = { ...profiles, [cfgTool]: { ...cfg, ...patch } };
    setProfiles(next);
    if (!isPreview) settingsStore().then((s) => s.set(PROFILE_KEY, next)).catch(() => {});
  };

  async function install(t: ToolInfo) {
    if (!env || phase[t.key] === 'installing') return;
    const m = methodsFor(t, os).find((x) => x.id === method[t.key]) ?? methodsFor(t, os)[0];
    if (!m) return;
    const req = checkRequirements(t, m, env);
    setShown(null);
    setAi({ busy: false });
    if (req.blockers.length) {
      setPhase((p) => ({ ...p, [t.key]: 'fail' }));
      setLog([`无法安装 ${t.name}：`, ...req.blockers]);
      return;
    }
    setPhase((p) => ({ ...p, [t.key]: 'installing' }));
    setLog([`开始安装 ${t.name}（${m.label}）`, `$ ${m.shown}`, ...req.warnings.map((w) => `提醒：${w}`)]);
    const r = await installTool(exec, { os }, t.key, m.id, (line) => addLog(line), secrets);
    if (r.ok) {
      setPhase((p) => ({ ...p, [t.key]: 'ok' }));
      addLog(`安装完成${r.version ? `，版本 ${r.version}` : ''}。如果终端里找不到命令，请关闭终端重新打开。`);
      void refresh();
    } else {
      setPhase((p) => ({ ...p, [t.key]: 'fail' }));
      addLog(`安装失败：${r.rawError ?? ''}`);
      if (r.issue) setShown({ tool: t.key, issue: r.issue, raw: r.rawError ?? '' });
    }
  }

  async function runAction(a: IssueAction, t: ToolKey) {
    if (a.kind === 'open_url' && a.payload) void openLink(a.payload);
    else if (a.kind === 'copy' && a.payload) void navigator.clipboard?.writeText(a.payload);
    else if (a.kind === 'retry') {
      if (shown?.issue.code === 'NET_RUNTIME') await refresh();
      await install(toolOf(t));
    }
  }

  async function translate() {
    if (!shown) return;
    setAi({ busy: true });
    try {
      const text = await explainError((m, o) => chat(m, o), shown.raw, { os, tool: toolOf(shown.tool).name, secrets });
      setAi({ busy: false, text });
    } catch (e) {
      setAi({ busy: false, err: e instanceof Error ? e.message : String(e) });
    }
  }

  async function save() {
    setCfgMsg(null);
    if (isPreview) return setCfgMsg({ kind: 'ok', text: '【示例】预览模式不会写入任何文件' });
    try {
      const home = await homeDir();
      const r = await applyConfig(
        { home, join: (...p) => ctx.join(...p), exists: (p) => exists(p), readText: (p) => ctx.readText(p), writeText: (p, t) => ctx.writeText(p, t), now: () => new Date() },
        exec, os, cfgTool, cfg,
      );
      setCfgMsg({ kind: 'ok', text: `已写入：${r.written.join('、')}。${r.backups.length ? `原文件已备份为 ${r.backups.join('、')}。` : ''}${r.notes.join('')}` });
    } catch (e) {
      setCfgMsg({ kind: 'err', text: maskSecrets(e instanceof Error ? e.message : String(e), secrets) });
    }
  }

  const missing: { name: string; url: string; why: string }[] = [];
  if (env) {
    if (!env.node) missing.push({ ...DOWNLOADS.node, why: '用 npm 方式安装时需要' });
    if (!env.git) missing.push({ ...DOWNLOADS.git, why: 'Hermes 需要，Windows 上的 Claude Code 推荐' });
    if (os === 'mac' && !env.brew) missing.push({ ...DOWNLOADS.brew, why: '用 Homebrew 方式安装时需要' });
  }
  const tcfg = toolOf(cfgTool);

  return (
    <div className="ai">
      {isPreview && <div className="ai-demo">示例状态：以下为演示数据，没有执行任何命令</div>}
      <div className="ai-cols">
        <section className="ai-tools" aria-label="选择要安装的工具">
          <h3 className="ai-h">选择要安装的工具</h3>
          {TOOLS.map((t) => {
            const st = env?.tools[t.key];
            const ph = phase[t.key];
            const ms = methodsFor(t, os);
            const inst = ph === 'installing';
            return (
              <article key={t.key} className={`ai-tool ${ph}`}>
                <div className="ai-tool-hd">
                  <b>{t.name}</b>
                  {inst ? <span className="k-st run"><Loader2 size={12} className="ai-spin" />安装中</span>
                    : st?.installed ? <span className="k-st ok"><Check size={12} />已安装{st.version ? ` ${st.version}` : ''}</span>
                    : ph === 'fail' ? <span className="k-st err">失败</span>
                    : <span className="k-st wait">未安装</span>}
                </div>
                <p>{t.blurb}</p>
                <div className="ai-tool-ft">
                  {ms.length > 1 ? (
                    <select aria-label={`${t.name} 的安装方式`} className="k-input ai-sel" value={method[t.key]} disabled={inst} onChange={(e) => setMethod((m) => ({ ...m, [t.key]: e.target.value }))}>
                      {[...new Map(ms.map((x) => [x.id, x])).values()].map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                    </select>
                  ) : <span className="ai-one">{ms[0]?.label ?? '当前系统不支持'}</span>}
                  {inst ? (
                    <button className="k-btn" disabled><Loader2 size={14} className="ai-spin" />安装中…</button>
                  ) : (
                    <button className="k-btn primary" disabled={!env || ms.length === 0} onClick={() => install(t)}>
                      <Download size={14} />{st?.installed ? '重新安装' : '安装'}
                    </button>
                  )}
                  <button className="k-btn ghost" title="打开官方文档" aria-label={`打开 ${t.name} 官方文档`} onClick={() => openLink(t.docsUrl)}><ExternalLink size={14} /></button>
                </div>
              </article>
            );
          })}
        </section>

        <div className="ai-side">
          <section className="ai-card" aria-label="环境检测">
            <div className="ai-card-hd">
              <h3 className="ai-h">环境检测</h3>
              <button className="k-btn ghost" onClick={refresh} disabled={checking}><RefreshCw size={14} className={checking ? 'ai-spin' : ''} />重新检测</button>
            </div>
            {!env ? <p className="k-muted">正在检测……</p> : (
              <>
                <ul className="ai-env">
                  <li><span>系统</span><b>{os === 'mac' ? 'macOS' : os === 'win' ? 'Windows' : 'Linux'}{env.arch !== 'unknown' ? (env.arch === 'arm64' ? ' · Apple 芯片 / ARM' : ' · Intel / x64') : ''}</b></li>
                  <li><span>Node.js</span><b className={env.node ? 'ok' : 'no'}>{env.node ?? '未安装'}</b></li>
                  <li><span>Git</span><b className={env.git ? 'ok' : 'no'}>{env.git ?? '未安装'}</b></li>
                  <li><span>npm</span><b className={env.npm ? 'ok' : 'no'}>{env.npm ?? '未安装'}</b></li>
                  {os !== 'win' && <li><span>Homebrew</span><b className={env.brew ? 'ok' : 'no'}>{env.brew ? '已安装' : '未安装'}</b></li>}
                </ul>
                <div className="ai-net">
                  {env.net.map((n) => <span key={n.host} className={`ai-pill ${n.ok ? 'ok' : 'no'}`} title={n.label}>{n.ok ? <Check size={11} /> : <CircleAlert size={11} />}{n.host}</span>)}
                </div>
                {missing.length > 0 && (
                  <ul className="ai-missing">
                    {missing.map((m) => <li key={m.name}><span>缺 {m.name}（{m.why}）</span><button className="k-btn ghost" onClick={() => openLink(m.url)}>官方下载<ExternalLink size={12} /></button></li>)}
                  </ul>
                )}
              </>
            )}
          </section>

          <section className="ai-card" aria-label="接口配置">
            <h3 className="ai-h">接口配置</h3>
            <div className="k-seg" role="tablist" aria-label="选择要配置的工具">
              {(['claude', 'codex'] as const).map((k) => <button key={k} role="tab" aria-selected={cfgTool === k} className={cfgTool === k ? 'on' : ''} onClick={() => { setCfgTool(k); setCfgMsg(null); }}>{toolOf(k).name}</button>)}
            </div>
            <label className="ai-f"><span>接口地址</span><input className="k-input" value={cfg.baseUrl} placeholder="https://你的接口地址" onChange={(e) => setCfg({ baseUrl: e.target.value })} /></label>
            <label className="ai-f"><span>密钥</span>
              <span className="ai-key">
                <input className="k-input" type={showKey ? 'text' : 'password'} value={cfg.apiKey} placeholder="只保存在这台电脑" autoComplete="off" onChange={(e) => setCfg({ apiKey: e.target.value })} />
                <button className="k-btn ghost" aria-label={showKey ? '隐藏密钥' : '显示密钥'} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
              </span>
              {!showKey && cfg.apiKey && <small className="k-muted">已填写：{maskKey(cfg.apiKey)}</small>}
            </label>
            <label className="ai-f"><span>模型名{cfgTool === 'claude' ? '（可不填）' : ''}</span><input className="k-input" value={cfg.model} placeholder="模型名称" onChange={(e) => setCfg({ model: e.target.value })} /></label>
            {cfgTool === 'claude' && (
              <div className="ai-f"><span>密钥发送方式</span>
                <div className="k-seg">
                  <button className={cfg.keyKind === 'token' ? 'on' : ''} onClick={() => setCfg({ keyKind: 'token' })}>令牌（Bearer）</button>
                  <button className={cfg.keyKind === 'apikey' ? 'on' : ''} onClick={() => setCfg({ keyKind: 'apikey' })}>API Key（X-Api-Key）</button>
                </div>
              </div>
            )}
            <p className="ai-note">{tcfg.configNote}</p>
            <div className="ai-row">
              {llmReady(settings.llm) && <button className="k-btn" onClick={() => setCfg({ baseUrl: settings.llm.baseUrl, apiKey: settings.llm.apiKey, model: settings.llm.model })}>填入「设置」里的大模型</button>}
              <button className="k-btn primary" onClick={save}>写入配置</button>
            </div>
            {cfgMsg && <div className={`k-notice ${cfgMsg.kind}`}><span>{cfgMsg.text}</span></div>}
            <p className="ai-note"><b>OpenClaw、Hermes Agent：</b>未核实官方的接口配置文件写法，这里不代写。装好后：OpenClaw 运行 <code>openclaw onboard</code>，Hermes 运行 <code>hermes model</code>。</p>
          </section>
        </div>
      </div>

      <section className="ai-out" aria-label="实时输出">
        <div className="ai-card-hd">
          <h3 className="ai-h">实时输出</h3>
          <button className="k-btn ghost" onClick={() => void navigator.clipboard?.writeText(log.join('\n'))} disabled={!log.length}><Copy size={14} />复制日志</button>
        </div>
        <pre className="ai-log" ref={logBox} aria-live="polite">{log.length ? log.join('\n') : '点「安装」后，命令的输出会实时显示在这里。日志里的密钥会自动打码。'}</pre>
        {shown && (
          <div className={`ai-issue ${shown.issue.severity}`} role="alert">
            <div><b>{shown.issue.title}</b><p>{shown.issue.cause}</p></div>
            <div className="ai-row">
              {shown.issue.actions.map((a) => <button key={a.label} className="k-btn" onClick={() => runAction(a, shown.tool)}>{a.label}</button>)}
              {shown.issue.code === 'UNKNOWN' && (
                <button className="k-btn primary" disabled={ai.busy} onClick={translate}><Sparkles size={14} />{ai.busy ? '正在翻译……' : '用大模型翻译成大白话'}</button>
              )}
            </div>
            {ai.text && <p className="ai-ai">{ai.text}</p>}
            {ai.err && <p className="ai-ai err">{ai.err}</p>}
            {shown.issue.code === 'UNKNOWN' && !llmReady(settings.llm) && <p className="k-muted">要用大模型翻译，请先到「设置」里填写接口地址、密钥和模型名。</p>}
          </div>
        )}
      </section>
    </div>
  );
}
