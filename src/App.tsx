import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';

type ChatRole = 'user' | 'assistant';

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};

type InterviewStageId =
  | 'arrival'
  | 'facts'
  | 'perspective'
  | 'pattern'
  | 'tiny_step'
  | 'closing';

type InterviewStage = {
  id: InterviewStageId;
  name: string;
  hint: string;
};

type ReportSection = {
  id: string;
  title: string;
  body?: string;
  items?: string[];
};

type SessionReport = {
  id: string;
  title: string;
  sections: ReportSection[];
  generatedAt: string;
  stageId: InterviewStageId;
};

type TinyAction = {
  id: string;
  text: string;
  createdAt: string;
  completedAt?: string;
  sourceReportId?: string;
};

type SessionProgress = {
  clarityStart: number;
  clarityNow: number;
  favoriteMessageIds: string[];
  tinyAction?: TinyAction;
};

type InterviewSession = {
  id: string;
  title: string;
  stageId: InterviewStageId;
  messages: ChatMessage[];
  report?: SessionReport;
  progress: SessionProgress;
  createdAt: string;
  updatedAt: string;
};

type PersistedState = {
  sessions: InterviewSession[];
  activeSessionId: string;
};

type DataNotice = {
  tone: 'success' | 'error';
  message: string;
};

type ApiHealth = {
  state: 'checking' | 'online' | 'offline';
  model?: string;
  hasApiKey?: boolean;
  checkedAt?: string;
  message?: string;
};

type SessionFilter = 'all' | 'report' | 'favorites' | 'action';
type SessionSort = 'updated' | 'created' | 'messages';
type AppView = 'interview' | 'review';
type ReviewRange = '7d' | '30d' | 'all';

const STORAGE_KEY = 'chat2yourself.sessions.v1';
const BACKUP_FORMAT = 'chat2yourself-backup';
const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

const interviewStages: InterviewStage[] = [
  { id: 'arrival', name: '入场校准', hint: '先落地，找到今天最想看的那一团。' },
  { id: 'facts', name: '事实铺开', hint: '把事情、人物、触发点和场景摊开。' },
  { id: 'perspective', name: '视角切换', hint: '换一个角度看，不急着相信它。' },
  { id: 'pattern', name: '模式命名', hint: '给反复出现的东西起个暂时的名字。' },
  { id: 'tiny_step', name: '下一步轻触', hint: '只找一个很小、可选择的动作。' },
  { id: 'closing', name: '收束保存', hint: '带走一句重点，留给未来的自己。' }
];

const openingMessage: ChatMessage = {
  id: 'opening',
  role: 'assistant',
  content: '我在。把现在脑子里最吵的那一团先丢过来就好，不用整理得很像样。',
  createdAt: new Date(0).toISOString()
};

function App() {
  const [state, setState] = useState<PersistedState>(() => loadPersistedState());
  const [draft, setDraft] = useState('');
  const [sendingSessionId, setSendingSessionId] = useState<string | null>(null);
  const [reportingSessionId, setReportingSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [apiHealth, setApiHealth] = useState<ApiHealth>({ state: 'checking' });
  const [dataNotice, setDataNotice] = useState<DataNotice | null>(null);
  const [sessionQuery, setSessionQuery] = useState('');
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all');
  const [sessionSort, setSessionSort] = useState<SessionSort>('updated');
  const [appView, setAppView] = useState<AppView>('interview');
  const [reviewRange, setReviewRange] = useState<ReviewRange>('30d');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  const activeSession = useMemo(() => {
    return state.sessions.find((session) => session.id === state.activeSessionId) ?? state.sessions[0];
  }, [state.activeSessionId, state.sessions]);

  const visibleSessions = useMemo(() => {
    const query = sessionQuery.trim().toLocaleLowerCase('zh-CN');
    const matchesFilter = (session: InterviewSession) => {
      if (sessionFilter === 'report') return Boolean(session.report);
      if (sessionFilter === 'favorites') return session.progress.favoriteMessageIds.length > 0;
      if (sessionFilter === 'action') {
        return Boolean(session.progress.tinyAction && !session.progress.tinyAction.completedAt);
      }
      return true;
    };
    const matchesQuery = (session: InterviewSession) => {
      if (!query) return true;

      const reportText = session.report?.sections
        .flatMap((section) => [section.title, section.body ?? '', ...(section.items ?? [])])
        .join(' ') ?? '';
      const searchableText = [
        session.title,
        getStage(session.stageId).name,
        session.messages.map((message) => message.content).join(' '),
        session.report?.title ?? '',
        reportText,
        session.progress.tinyAction?.text ?? ''
      ].join(' ').toLocaleLowerCase('zh-CN');
      return searchableText.includes(query);
    };
    const compareSessions = (first: InterviewSession, second: InterviewSession) => {
      if (sessionSort === 'created') return first.createdAt.localeCompare(second.createdAt);
      if (sessionSort === 'messages') {
        return second.messages.length - first.messages.length || second.updatedAt.localeCompare(first.updatedAt);
      }
      return second.updatedAt.localeCompare(first.updatedAt);
    };

    return state.sessions.filter(matchesFilter).filter(matchesQuery).sort(compareSessions);
  }, [sessionFilter, sessionQuery, sessionSort, state.sessions]);

  const displayMessages = useMemo(() => {
    return [openingMessage, ...(activeSession?.messages ?? [])];
  }, [activeSession?.messages]);

  const activeStage = useMemo(() => {
    return interviewStages.find((stage) => stage.id === activeSession?.stageId) ?? interviewStages[0];
  }, [activeSession?.stageId]);

  const activeStageIndex = interviewStages.findIndex((stage) => stage.id === activeStage.id);

  const favoriteMessages = useMemo(() => {
    if (!activeSession) {
      return [];
    }

    return activeSession.messages.filter((message) => activeSession.progress.favoriteMessageIds.includes(message.id));
  }, [activeSession]);

  const themeChips = useMemo(() => {
    return activeSession?.report ? deriveThemeChips(activeSession.report) : [];
  }, [activeSession?.report]);

  const reviewSummary = useMemo(() => {
    const rangeDays = reviewRange === '7d' ? 7 : reviewRange === '30d' ? 30 : null;
    const cutoff = rangeDays === null ? null : Date.now() - rangeDays * 24 * 60 * 60 * 1000;
    const scopedSessions = state.sessions.filter(
      (session) => cutoff === null || Date.parse(session.updatedAt) >= cutoff
    );
    const engagedSessions = scopedSessions.filter((session) => session.messages.length > 0);
    const actions = scopedSessions.flatMap((session) =>
      session.progress.tinyAction ? [{ session, action: session.progress.tinyAction }] : []
    );
    const themeCounts = new Map<string, number>();

    scopedSessions.forEach((session) => {
      if (!session.report) return;
      deriveThemeChips(session.report).forEach((theme) => {
        themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1);
      });
    });

    const clarityDelta = engagedSessions.length > 0
      ? engagedSessions.reduce(
          (total, session) => total + session.progress.clarityNow - session.progress.clarityStart,
          0
        ) / engagedSessions.length
      : 0;

    return {
      engagedCount: engagedSessions.length,
      reportCount: scopedSessions.filter((session) => Boolean(session.report)).length,
      actionCount: actions.length,
      completedActionCount: actions.filter(({ action }) => Boolean(action.completedAt)).length,
      pendingActions: actions
        .filter(({ action }) => !action.completedAt)
        .sort((first, second) => second.action.createdAt.localeCompare(first.action.createdAt)),
      clarityDelta,
      themes: Array.from(themeCounts.entries())
        .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0], 'zh-CN'))
        .slice(0, 8),
      recentSessions: [...engagedSessions]
        .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
        .slice(0, 6)
    };
  }, [reviewRange, state.sessions]);

  const isSending = sendingSessionId !== null;
  const isReporting = reportingSessionId !== null;
  const isBusy = isSending || isReporting;
  const activeIsSending = sendingSessionId === activeSession?.id;
  const activeIsReporting = reportingSessionId === activeSession?.id;

  useEffect(() => {
    persistState(state);
  }, [state]);

  useEffect(() => {
    void checkApiHealth();
  }, []);

  async function checkApiHealth() {
    setApiHealth((current) => ({ ...current, state: 'checking' }));

    try {
      const response = await fetch('/api/health');
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? '后端健康检查没有通过。');
      }

      setApiHealth({
        state: 'online',
        model: typeof payload.model === 'string' ? payload.model : undefined,
        hasApiKey: Boolean(payload.hasApiKey),
        checkedAt: new Date().toISOString()
      });
    } catch (caughtError) {
      setApiHealth({
        state: 'offline',
        checkedAt: new Date().toISOString(),
        message: caughtError instanceof Error ? caughtError.message : '无法连接本地后端。'
      });
    }
  }

  async function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!activeSession) {
      return;
    }

    const content = draft.trim();
    if (!content || isBusy) {
      return;
    }

    const now = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: now
    };

    const sessionId = activeSession.id;
    const nextMessages = [...activeSession.messages, userMessage];

    setState((current) => updateSession(current, sessionId, (session) => ({
      ...session,
      title: shouldAutoTitle(session) ? makeTitle(content) : session.title,
      messages: nextMessages,
      updatedAt: now
    })));
    setDraft('');
    setError(null);
    setReportError(null);
    setSendingSessionId(sessionId);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: activeSession.stageId,
          messages: nextMessages.map(({ role, content }) => ({ role, content }))
        })
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error ?? '这次没有发出去。');
      }

      const assistantContent = payload?.message?.content;
      if (typeof assistantContent !== 'string' || assistantContent.trim().length === 0) {
        throw new Error('模型返回了一段空白。');
      }

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: assistantContent.trim(),
        createdAt: new Date().toISOString()
      };

      setState((current) => updateSession(current, sessionId, (session) => ({
        ...session,
        messages: [...session.messages, assistantMessage],
        updatedAt: assistantMessage.createdAt
      })));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '发生了未知错误。');
      setState((current) => updateSession(current, sessionId, (session) => ({
        ...session,
        messages: session.messages.filter((message) => message.id !== userMessage.id),
        updatedAt: new Date().toISOString()
      })));
      setDraft(content);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      setSendingSessionId(null);
    }
  }

  async function generateReport() {
    if (!activeSession || isBusy || activeSession.messages.length === 0) {
      return;
    }

    const sessionId = activeSession.id;
    setReportError(null);
    setReportingSessionId(sessionId);

    try {
      const response = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: activeSession.stageId,
          messages: activeSession.messages.map(({ role, content }) => ({ role, content }))
        })
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error ?? '这次没有生成报告。');
      }

      const report = normalizeIncomingReport(payload?.report, activeSession.stageId);
      const now = new Date().toISOString();

      setState((current) => updateSession(current, sessionId, (session) => ({
        ...session,
        report,
        progress: {
          ...session.progress,
          tinyAction: makeTinyAction(report, session.progress.tinyAction)
        },
        updatedAt: now
      })));
    } catch (caughtError) {
      setReportError(caughtError instanceof Error ? caughtError.message : '报告生成时发生了未知错误。');
    } finally {
      setReportingSessionId(null);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  function createNewSession() {
    if (isBusy) {
      return;
    }

    const session = createSession();
    setAppView('interview');
    setState((current) => ({
      sessions: [session, ...current.sessions],
      activeSessionId: session.id
    }));
    setDraft('');
    setError(null);
    setReportError(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function renameActiveSession() {
    if (!activeSession || isBusy) {
      return;
    }

    const title = window.prompt('给这次访谈起个名字', activeSession.title)?.trim();
    if (!title) {
      return;
    }

    setState((current) => updateSession(current, activeSession.id, (session) => ({
      ...session,
      title,
      updatedAt: new Date().toISOString()
    })));
  }

  function deleteActiveSession() {
    if (!activeSession || isBusy) {
      return;
    }

    const ok = window.confirm(`删除「${activeSession.title}」？这只会删除本机浏览器里的这次记录。`);
    if (!ok) {
      return;
    }

    setState((current) => {
      const remaining = current.sessions.filter((session) => session.id !== activeSession.id);
      if (remaining.length === 0) {
        const session = createSession();
        return { sessions: [session], activeSessionId: session.id };
      }

      return {
        sessions: remaining,
        activeSessionId: remaining[0].id
      };
    });
    setDraft('');
    setError(null);
    setReportError(null);
  }

  function clearLocalData() {
    if (isBusy) {
      return;
    }

    const ok = window.confirm('清空所有本地访谈记录？这个动作不会影响任何云端数据，因为现在没有云端数据。');
    if (!ok) {
      return;
    }

    const session = createSession();
    localStorage.removeItem(STORAGE_KEY);
    setState({ sessions: [session], activeSessionId: session.id });
    setDraft('');
    setError(null);
    setReportError(null);
    setDataNotice(null);
  }

  function selectSession(sessionId: string) {
    if (isBusy) {
      return;
    }

    setAppView('interview');
    if (sessionId === activeSession?.id) return;

    setState((current) => ({ ...current, activeSessionId: sessionId }));
    setDraft('');
    setError(null);
    setReportError(null);
  }

  function setActiveStage(stageId: InterviewStageId) {
    if (!activeSession || isBusy || stageId === activeSession.stageId) {
      return;
    }

    setState((current) => updateSession(current, activeSession.id, (session) => ({
      ...session,
      stageId,
      updatedAt: new Date().toISOString()
    })));
  }

  function updateClarity(kind: 'clarityStart' | 'clarityNow', value: number) {
    if (!activeSession || isBusy) {
      return;
    }

    const normalized = clamp(value, 1, 5);
    setState((current) => updateSession(current, activeSession.id, (session) => ({
      ...session,
      progress: {
        ...session.progress,
        [kind]: normalized
      },
      updatedAt: new Date().toISOString()
    })));
  }

  function toggleFavoriteMessage(messageId: string) {
    if (!activeSession || isBusy) {
      return;
    }

    setState((current) => updateSession(current, activeSession.id, (session) => {
      const exists = session.progress.favoriteMessageIds.includes(messageId);
      return {
        ...session,
        progress: {
          ...session.progress,
          favoriteMessageIds: exists
            ? session.progress.favoriteMessageIds.filter((id) => id !== messageId)
            : [...session.progress.favoriteMessageIds, messageId]
        },
        updatedAt: new Date().toISOString()
      };
    }));
  }

  function toggleTinyAction() {
    if (!activeSession || isBusy || !activeSession.progress.tinyAction) {
      return;
    }

    setState((current) => updateSession(current, activeSession.id, (session) => {
      if (!session.progress.tinyAction) {
        return session;
      }

      return {
        ...session,
        progress: {
          ...session.progress,
          tinyAction: {
            ...session.progress.tinyAction,
            completedAt: session.progress.tinyAction.completedAt ? undefined : new Date().toISOString()
          }
        },
        updatedAt: new Date().toISOString()
      };
    }));
  }

  function toggleSessionAction(sessionId: string) {
    if (isBusy) return;

    setState((current) => updateSession(current, sessionId, (session) => {
      if (!session.progress.tinyAction) return session;
      return {
        ...session,
        progress: {
          ...session.progress,
          tinyAction: {
            ...session.progress.tinyAction,
            completedAt: session.progress.tinyAction.completedAt ? undefined : new Date().toISOString()
          }
        },
        updatedAt: new Date().toISOString()
      };
    }));
  }

  function moveStage(direction: -1 | 1) {
    const nextIndex = activeStageIndex + direction;
    const nextStage = interviewStages[nextIndex];

    if (nextStage) {
      setActiveStage(nextStage.id);
    }
  }

  function exportActiveSession(format: 'markdown' | 'json') {
    if (!activeSession) {
      return;
    }

    const baseName = sanitizeFileName(activeSession.title);

    if (format === 'json') {
      downloadText(
        `${baseName}.json`,
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            stage: getStage(activeSession.stageId),
            session: activeSession
          },
          null,
          2
        ),
        'application/json'
      );
      return;
    }

    downloadText(`${baseName}.md`, toMarkdown(activeSession), 'text/markdown');
  }

  function exportReview() {
    const period = getReviewRangeLabel(reviewRange);
    const lines = [
      '# Chat2Yourself 周期回顾',
      '',
      `- 范围：${period}`,
      `- 导出时间：${formatFullDate(new Date().toISOString())}`,
      `- 有效访谈：${reviewSummary.engagedCount} 次`,
      `- 阶段画像：${reviewSummary.reportCount} 份`,
      `- 平均清晰度变化：${formatAverageDelta(reviewSummary.clarityDelta)}`,
      `- 极小行动：${reviewSummary.completedActionCount}/${reviewSummary.actionCount} 已完成`,
      '',
      '## 反复出现的主题',
      ''
    ];

    if (reviewSummary.themes.length > 0) {
      reviewSummary.themes.forEach(([theme, count]) => lines.push(`- ${theme}（${count} 次）`));
    } else {
      lines.push('- 当前范围内还没有可汇总的主题。');
    }

    lines.push('', '## 待完成的极小行动', '');
    if (reviewSummary.pendingActions.length > 0) {
      reviewSummary.pendingActions.forEach(({ session, action }) => {
        lines.push(`- [ ] ${action.text}（来自：${session.title}）`);
      });
    } else {
      lines.push('- 当前范围内没有待完成行动。');
    }

    lines.push('', '## 最近访谈', '');
    if (reviewSummary.recentSessions.length > 0) {
      reviewSummary.recentSessions.forEach((session) => {
        lines.push(
          `- ${session.title} · ${getStage(session.stageId).name} · ${session.messages.length} 条 · ${formatFullDate(session.updatedAt)}`
        );
      });
    } else {
      lines.push('- 当前范围内还没有正式访谈。');
    }

    downloadText(
      `chat2yourself-review-${reviewRange}-${toFileDate(new Date().toISOString())}.md`,
      `${lines.join('\n')}\n`,
      'text/markdown'
    );
  }

  function exportBackup() {
    const exportedAt = new Date().toISOString();
    downloadText(
      `chat2yourself-backup-${toFileDate(exportedAt)}.json`,
      JSON.stringify(
        {
          format: BACKUP_FORMAT,
          version: BACKUP_VERSION,
          exportedAt,
          state
        },
        null,
        2
      ),
      'application/json'
    );
    setDataNotice({
      tone: 'success',
      message: `已备份 ${state.sessions.length} 次访谈。`
    });
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';

    if (!file || isBusy) {
      return;
    }

    if (file.size > MAX_BACKUP_BYTES) {
      setDataNotice({ tone: 'error', message: '备份文件超过 5 MB，未读取。' });
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const restored = normalizeBackupFile(parsed);
      const ok = window.confirm(
        `恢复「${file.name}」里的 ${restored.sessions.length} 次访谈？当前本地记录会被这份备份替换。`
      );

      if (!ok) {
        return;
      }

      setState(restored);
      setDraft('');
      setError(null);
      setReportError(null);
      setDataNotice({
        tone: 'success',
        message: `已恢复 ${restored.sessions.length} 次访谈。`
      });
    } catch (caughtError) {
      setDataNotice({
        tone: 'error',
        message: caughtError instanceof Error ? caughtError.message : '无法读取这份备份。'
      });
    }
  }

  if (!activeSession) {
    return null;
  }

  return (
    <main className="shell">
      <section className="workspace" aria-label="自我访谈工作区">
        <aside className="sidebar" aria-label="本地会话列表">
          <div className="sidebarHeader">
            <div>
              <p className="eyebrow">Chat2Yourself · V5.5</p>
              <h1>本地访谈</h1>
            </div>
            <button className="iconButton" type="button" onClick={createNewSession} disabled={isBusy} title="新建访谈">
              +
            </button>
          </div>

          <p className="localNotice">记录只保存在这台电脑的当前浏览器里。</p>

          <div className="viewSwitch" aria-label="工作区视图">
            <button
              aria-pressed={appView === 'interview'}
              className={appView === 'interview' ? 'active' : ''}
              onClick={() => setAppView('interview')}
              type="button"
            >
              访谈
            </button>
            <button
              aria-pressed={appView === 'review'}
              className={appView === 'review' ? 'active' : ''}
              onClick={() => setAppView('review')}
              type="button"
            >
              回顾
            </button>
          </div>

          <section className={`statusPanel ${apiHealth.state}`} aria-label="本地连接状态">
            <div className="statusHeader">
              <div>
                <p className="eyebrow">本地连接</p>
                <strong>{formatHealthTitle(apiHealth)}</strong>
              </div>
              <button className="miniButton" type="button" onClick={() => void checkApiHealth()}>
                重查
              </button>
            </div>
            <dl className="statusList">
              <div>
                <dt>模型</dt>
                <dd>{apiHealth.model ?? '未连接'}</dd>
              </div>
              <div>
                <dt>Key</dt>
                <dd>{apiHealth.hasApiKey ? '已配置' : apiHealth.state === 'online' ? '未配置' : '未知'}</dd>
              </div>
              <div>
                <dt>检查</dt>
                <dd>{apiHealth.checkedAt ? formatDate(apiHealth.checkedAt) : '进行中'}</dd>
              </div>
            </dl>
            {apiHealth.state === 'offline' || apiHealth.hasApiKey === false ? (
              <p className="statusHint">
                {apiHealth.state === 'offline'
                  ? apiHealth.message ?? '请确认 npm run dev 正在运行。'
                  : '请在本地 .env 配置 DEEPSEEK_API_KEY 后重启服务。'}
              </p>
            ) : null}
          </section>

          <section className="dataPanel" aria-label="本地数据备份与恢复">
            <div>
              <p className="eyebrow">本地数据</p>
              <strong>{state.sessions.length} 次访谈</strong>
            </div>
            <div className="dataActions">
              <button className="miniButton" type="button" onClick={exportBackup} disabled={isBusy}>
                备份全部
              </button>
              <button
                className="miniButton"
                type="button"
                onClick={() => backupInputRef.current?.click()}
                disabled={isBusy}
              >
                恢复备份
              </button>
              <input
                className="fileInput"
                ref={backupInputRef}
                type="file"
                accept="application/json,.json"
                onChange={(event) => void restoreBackup(event)}
                tabIndex={-1}
              />
            </div>
            {dataNotice ? (
              <p className={`dataNotice ${dataNotice.tone}`} role={dataNotice.tone === 'error' ? 'alert' : 'status'}>
                {dataNotice.message}
              </p>
            ) : null}
          </section>

          <section className="libraryTools" aria-label="查找访谈">
            <div className="searchField">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="搜索访谈标题和内容"
                onChange={(event) => setSessionQuery(event.target.value)}
                placeholder="搜索标题或对话"
                type="search"
                value={sessionQuery}
              />
            </div>
            <div className="filterRow" aria-label="访谈筛选">
              {([
                ['all', '全部'],
                ['report', '有画像'],
                ['favorites', '有收藏'],
                ['action', '待行动']
              ] as const).map(([value, label]) => (
                <button
                  aria-pressed={sessionFilter === value}
                  className={sessionFilter === value ? 'active' : ''}
                  key={value}
                  onClick={() => setSessionFilter(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="librarySummary">
              <span>{visibleSessions.length === state.sessions.length ? `${state.sessions.length} 次访谈` : `${visibleSessions.length} / ${state.sessions.length} 次`}</span>
              <select
                aria-label="访谈排序"
                onChange={(event) => setSessionSort(event.target.value as SessionSort)}
                value={sessionSort}
              >
                <option value="updated">最近更新</option>
                <option value="created">最早创建</option>
                <option value="messages">对话最多</option>
              </select>
            </div>
          </section>

          <div className="sessionList">
            {visibleSessions.map((session) => (
              <button
                className={`sessionItem ${session.id === activeSession.id ? 'active' : ''}`}
                disabled={isBusy}
                key={session.id}
                onClick={() => selectSession(session.id)}
                type="button"
              >
                <span className="sessionTitle">{session.title}</span>
                <span className="sessionMeta">
                  {session.messages.length === 0 ? '还没开始' : `${session.messages.length} 条`}
                  {' · '}
                  {getStage(session.stageId).name}
                  {session.report ? ' · 有画像' : ''}
                  {session.progress.tinyAction && !session.progress.tinyAction.completedAt ? ' · 待行动' : ''}
                  {session.progress.tinyAction?.completedAt ? ' · 小动作已完成' : ''}
                  {' · '}
                  {formatDate(session.updatedAt)}
                </span>
              </button>
            ))}
            {visibleSessions.length === 0 ? (
              <div className="emptySessions">
                <strong>没有找到对应访谈</strong>
                <button
                  className="miniButton"
                  onClick={() => {
                    setSessionQuery('');
                    setSessionFilter('all');
                  }}
                  type="button"
                >
                  清除条件
                </button>
              </div>
            ) : null}
          </div>

          <button className="ghostButton danger" type="button" onClick={clearLocalData} disabled={isBusy}>
            清空本地数据
          </button>
        </aside>

        {appView === 'review' ? (
          <section className="reviewView" aria-label="本地访谈回顾中心">
            <header className="reviewHeader">
              <div>
                <p className="eyebrow">本地趋势</p>
                <h2>回顾中心</h2>
                <p>{getReviewRangeLabel(reviewRange)} · 从已经发生的访谈里，看见一点连续性。</p>
              </div>
              <div className="reviewControls">
                <div className="rangeSwitch" aria-label="回顾时间范围">
                  {([['7d', '7 天'], ['30d', '30 天'], ['all', '全部']] as const).map(([value, label]) => (
                    <button
                      aria-pressed={reviewRange === value}
                      className={reviewRange === value ? 'active' : ''}
                      key={value}
                      onClick={() => setReviewRange(value)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button className="ghostButton" onClick={exportReview} type="button">
                  导出回顾
                </button>
                <button className="primaryButton" onClick={createNewSession} type="button">
                  开始新访谈
                </button>
              </div>
            </header>

            <div className="metricStrip" aria-label="访谈统计">
              <div><strong>{reviewSummary.engagedCount}</strong><span>次有效访谈</span></div>
              <div><strong>{reviewSummary.reportCount}</strong><span>份阶段画像</span></div>
              <div>
                <strong>{formatAverageDelta(reviewSummary.clarityDelta)}</strong>
                <span>平均清晰度变化</span>
              </div>
              <div>
                <strong>{reviewSummary.completedActionCount}/{reviewSummary.actionCount}</strong>
                <span>极小行动完成</span>
              </div>
            </div>

            <div className="reviewBody">
              <section className="reviewSection clarityReview" aria-labelledby="review-clarity-title">
                <div className="reviewSectionHeader">
                  <div>
                    <p className="eyebrow">最近变化</p>
                    <h3 id="review-clarity-title">清晰度轨迹</h3>
                  </div>
                  <span>开始 → 现在</span>
                </div>
                {reviewSummary.recentSessions.length > 0 ? (
                  <div className="clarityHistory">
                    {reviewSummary.recentSessions.map((session) => {
                      const delta = session.progress.clarityNow - session.progress.clarityStart;
                      return (
                        <button key={session.id} onClick={() => selectSession(session.id)} type="button">
                          <span className="historyTitle">{session.title}</span>
                          <span className="historyTrack" aria-hidden="true">
                            <i style={{ width: `${session.progress.clarityNow * 20}%` }} />
                          </span>
                          <strong className={delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}>
                            {session.progress.clarityStart} → {session.progress.clarityNow}
                          </strong>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="reviewEmpty">完成一次对话后，这里会出现清晰度轨迹。</p>
                )}
              </section>

              <section className="reviewSection themeReview" aria-labelledby="review-theme-title">
                <div className="reviewSectionHeader">
                  <div>
                    <p className="eyebrow">跨访谈观察</p>
                    <h3 id="review-theme-title">反复出现的主题</h3>
                  </div>
                </div>
                {reviewSummary.themes.length > 0 ? (
                  <div className="themeRanking">
                    {reviewSummary.themes.map(([theme, count]) => (
                      <span key={theme}>{theme}<strong>{count}</strong></span>
                    ))}
                  </div>
                ) : (
                  <p className="reviewEmpty">生成几份阶段画像后，重复主题会在这里浮现。</p>
                )}
              </section>

              <section className="reviewSection actionReview" aria-labelledby="review-action-title">
                <div className="reviewSectionHeader">
                  <div>
                    <p className="eyebrow">仍可轻轻推进</p>
                    <h3 id="review-action-title">待完成的极小行动</h3>
                  </div>
                  <span>{reviewSummary.pendingActions.length} 项待完成</span>
                </div>
                {reviewSummary.pendingActions.length > 0 ? (
                  <div className="reviewActionList">
                    {reviewSummary.pendingActions.map(({ session, action }) => (
                      <label key={action.id}>
                        <input
                          checked={false}
                          onChange={() => toggleSessionAction(session.id)}
                          type="checkbox"
                        />
                        <span><strong>{action.text}</strong><small>来自：{session.title}</small></span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="reviewEmpty">当前范围内没有待完成行动。</p>
                )}
              </section>

              <section className="reviewSection recentReview" aria-labelledby="review-recent-title">
                <div className="reviewSectionHeader">
                  <div>
                    <p className="eyebrow">继续往下看</p>
                    <h3 id="review-recent-title">最近的访谈</h3>
                  </div>
                </div>
                {reviewSummary.recentSessions.length > 0 ? (
                  <div className="recentReviewList">
                    {reviewSummary.recentSessions.map((session) => (
                      <button key={session.id} onClick={() => selectSession(session.id)} type="button">
                        <span><strong>{session.title}</strong><small>{getStage(session.stageId).name} · {session.messages.length} 条</small></span>
                        <time dateTime={session.updatedAt}>{formatDate(session.updatedAt)}</time>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="reviewEmpty">第一段记录会从这里开始。</p>
                )}
              </section>
            </div>
          </section>
        ) : (
        <section className="conversation" aria-label="自我访谈聊天区">
          <header className="appHeader">
            <div>
              <p className="eyebrow">当前访谈 · {activeStage.name}</p>
              <h2>{activeSession.title}</h2>
            </div>
            <div className="headerActions">
              <button className="ghostButton" type="button" onClick={renameActiveSession} disabled={isBusy}>
                重命名
              </button>
              <button className="ghostButton" type="button" onClick={() => exportActiveSession('markdown')}>
                导出 MD
              </button>
              <button className="ghostButton" type="button" onClick={() => exportActiveSession('json')}>
                导出 JSON
              </button>
              <button
                className="ghostButton accent"
                type="button"
                onClick={() => void generateReport()}
                disabled={isBusy || activeSession.messages.length === 0}
              >
                {activeIsReporting ? '生成中...' : activeSession.report ? '更新画像' : '生成画像'}
              </button>
              <button className="ghostButton danger" type="button" onClick={deleteActiveSession} disabled={isBusy}>
                删除
              </button>
            </div>
          </header>

          <section className="stagePanel" aria-label="访谈阶段">
            <div className="stageTopline">
              <div>
                <p className="stageLabel">
                  第 {activeStageIndex + 1} 步 / {interviewStages.length}
                </p>
                <p className="stageHint">{activeStage.hint}</p>
              </div>
              <div className="stageNav">
                <button
                  className="ghostButton"
                  disabled={isBusy || activeStageIndex === 0}
                  onClick={() => moveStage(-1)}
                  type="button"
                >
                  上一步
                </button>
                <button
                  className="ghostButton"
                  disabled={isBusy || activeStageIndex === interviewStages.length - 1}
                  onClick={() => moveStage(1)}
                  type="button"
                >
                  下一步
                </button>
              </div>
            </div>

            <div className="stageTrack" role="list">
              {interviewStages.map((stage, index) => (
                <button
                  className={`stagePill ${stage.id === activeStage.id ? 'active' : ''} ${
                    index < activeStageIndex ? 'visited' : ''
                  }`}
                  disabled={isBusy}
                  key={stage.id}
                  onClick={() => setActiveStage(stage.id)}
                  role="listitem"
                  type="button"
                >
                  <span>{index + 1}</span>
                  {stage.name}
                </button>
              ))}
            </div>
          </section>

          <section className="progressPanel" aria-label="进步感与小任务">
            <div className="progressColumn clarityBox">
              <p className="eyebrow">清晰度</p>
              <div className="clarityRows">
                <label>
                  <span>开始时</span>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    value={activeSession.progress.clarityStart}
                    disabled={isBusy}
                    onChange={(event) => updateClarity('clarityStart', Number(event.target.value))}
                  />
                  <strong>{activeSession.progress.clarityStart}</strong>
                </label>
                <label>
                  <span>现在</span>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    value={activeSession.progress.clarityNow}
                    disabled={isBusy}
                    onChange={(event) => updateClarity('clarityNow', Number(event.target.value))}
                  />
                  <strong>{activeSession.progress.clarityNow}</strong>
                </label>
              </div>
              <p className="clarityDelta">{formatClarityDelta(activeSession.progress)}</p>
            </div>

            <div className="progressColumn actionBox">
              <p className="eyebrow">极小行动</p>
              {activeSession.progress.tinyAction ? (
                <label className={`tinyAction ${activeSession.progress.tinyAction.completedAt ? 'completed' : ''}`}>
                  <input
                    type="checkbox"
                    checked={Boolean(activeSession.progress.tinyAction.completedAt)}
                    disabled={isBusy}
                    onChange={toggleTinyAction}
                  />
                  <span>{activeSession.progress.tinyAction.text}</span>
                </label>
              ) : (
                <p className="mutedText">生成画像后，这里会出现一个低压力的小动作。</p>
              )}
            </div>

            <div className="progressColumn themeBox">
              <p className="eyebrow">重复主题</p>
              {themeChips.length > 0 ? (
                <div className="themeChips">
                  {themeChips.map((theme) => (
                    <span key={theme}>{theme}</span>
                  ))}
                </div>
              ) : (
                <p className="mutedText">有画像后会从主题、模式和反复句子里提取。</p>
              )}
            </div>

            <div className="progressColumn favoritesBox">
              <p className="eyebrow">收藏关键句</p>
              {favoriteMessages.length > 0 ? (
                <ul>
                  {favoriteMessages.slice(0, 3).map((message) => (
                    <li key={message.id}>{shorten(message.content, 52)}</li>
                  ))}
                </ul>
              ) : (
                <p className="mutedText">在对话气泡右上角点“收藏”。</p>
              )}
            </div>
          </section>

          <div className="messageList">
            {displayMessages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="messageTopline">
                  <span className="speaker">{message.role === 'assistant' ? '访谈伙伴' : '你'}</span>
                  {message.id !== openingMessage.id ? (
                    <button
                      className={`favoriteButton ${
                        activeSession.progress.favoriteMessageIds.includes(message.id) ? 'active' : ''
                      }`}
                      disabled={isBusy}
                      onClick={() => toggleFavoriteMessage(message.id)}
                      type="button"
                    >
                      {activeSession.progress.favoriteMessageIds.includes(message.id) ? '已收藏' : '收藏'}
                    </button>
                  ) : null}
                </div>
                <p>{message.content}</p>
              </article>
            ))}

            {activeIsSending ? (
              <article className="message assistant pending" aria-live="polite">
                <span className="speaker">访谈伙伴</span>
                <p>我在听，稍微想一下怎么接住这团线。</p>
              </article>
            ) : null}
          </div>

          <section className="reportPanel" aria-label="阶段性自我画像">
            <div className="reportHeader">
              <div>
                <p className="eyebrow">阶段性自我画像</p>
                <h3>{activeSession.report?.title ?? '还没有生成画像'}</h3>
              </div>
              {activeSession.report ? (
                <span className="reportMeta">
                  {getStage(activeSession.report.stageId).name} · {formatDate(activeSession.report.generatedAt)}
                </span>
              ) : null}
            </div>

            {reportError ? (
              <p className="error" role="alert">
                {reportError}
              </p>
            ) : null}

            {activeSession.report ? (
              <div className="reportGrid">
                {activeSession.report.sections.map((section) => (
                  <article className="reportSection" key={section.id}>
                    <h4>{section.title}</h4>
                    {section.body ? <p>{section.body}</p> : null}
                    {section.items && section.items.length > 0 ? (
                      <ul>
                        {section.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="emptyReport">
                聊过几轮后，可以生成一份阶段性整理。它只根据当前会话内容出现栏目，不会强行套模板。
              </p>
            )}
          </section>

          <form className="composer" onSubmit={(event) => void handleSubmit(event)}>
            <label htmlFor="message">现在最想说的是</label>
            <textarea
              id="message"
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="比如：我有点烦，但也说不清是在烦工作、关系，还是自己又卡住了。"
              rows={4}
              disabled={isBusy}
            />

            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="composerFooter">
              <span>
                {activeSession.messages.length === 0
                  ? '先说一点点就够。'
                  : `${activeSession.messages.length} 条对话 · 已自动保存`}
              </span>
              <button className="primaryButton" type="submit" disabled={draft.trim().length === 0 || isBusy}>
                {activeIsSending ? '发送中...' : '发送'}
              </button>
            </div>
          </form>
        </section>
        )}
      </section>
    </main>
  );
}

function createSession(): InterviewSession {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: '新的访谈',
    stageId: 'arrival',
    messages: [],
    progress: createDefaultProgress(),
    createdAt: now,
    updatedAt: now
  };
}

function loadPersistedState(): PersistedState {
  const fallback = createSession();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { sessions: [fallback], activeSessionId: fallback.id };
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isPersistedState(parsed)) {
      return { sessions: [fallback], activeSessionId: fallback.id };
    }

    const sessions = parsed.sessions.map(hydrateSession);
    const activeExists = sessions.some((session) => session.id === parsed.activeSessionId);
    return {
      sessions,
      activeSessionId: activeExists ? parsed.activeSessionId : sessions[0].id
    };
  } catch {
    return { sessions: [fallback], activeSessionId: fallback.id };
  }
}

function persistState(state: PersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The app still works for the current visit if storage is unavailable.
  }
}

function isPersistedState(value: unknown): value is PersistedState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { sessions?: unknown; activeSessionId?: unknown };
  return (
    typeof candidate.activeSessionId === 'string' &&
    Array.isArray(candidate.sessions) &&
    candidate.sessions.length > 0 &&
    candidate.sessions.every(isInterviewSession)
  );
}

function isInterviewSession(value: unknown): value is InterviewSession {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<InterviewSession>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    (candidate.stageId === undefined || isStageId(candidate.stageId)) &&
    Array.isArray(candidate.messages) &&
    candidate.messages.every(isChatMessage) &&
    (candidate.report === undefined || isSessionReport(candidate.report)) &&
    (candidate.progress === undefined || isSessionProgress(candidate.progress)) &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
}

function hydrateSession(session: InterviewSession): InterviewSession {
  const progress = isSessionProgress(session.progress) ? session.progress : createDefaultProgress();
  const messageIds = new Set(session.messages.map((message) => message.id));

  return {
    ...session,
    stageId: isStageId(session.stageId) ? session.stageId : 'arrival',
    report: session.report && isSessionReport(session.report) ? session.report : undefined,
    progress: {
      ...progress,
      clarityStart: clamp(progress.clarityStart, 1, 5),
      clarityNow: clamp(progress.clarityNow, 1, 5),
      favoriteMessageIds: Array.from(new Set(progress.favoriteMessageIds)).filter((id) => messageIds.has(id))
    }
  };
}

function normalizeBackupFile(value: unknown): PersistedState {
  let candidate: unknown = value;

  if (value && typeof value === 'object') {
    const envelope = value as { format?: unknown; version?: unknown; state?: unknown; session?: unknown };

    if (envelope.format === BACKUP_FORMAT) {
      if (envelope.version !== BACKUP_VERSION) {
        throw new Error('这份备份来自不受支持的版本。');
      }
      candidate = envelope.state;
    } else if (isInterviewSession(envelope.session)) {
      candidate = {
        sessions: [envelope.session],
        activeSessionId: envelope.session.id
      };
    }
  }

  if (!isPersistedState(candidate)) {
    throw new Error('文件不是有效的 Chat2Yourself 备份。');
  }

  const sessions = candidate.sessions.map(hydrateSession);
  const sessionIds = new Set(sessions.map((session) => session.id));

  if (sessionIds.size !== sessions.length) {
    throw new Error('备份里存在重复的访谈编号，未执行恢复。');
  }

  return {
    sessions,
    activeSessionId: sessionIds.has(candidate.activeSessionId) ? candidate.activeSessionId : sessions[0].id
  };
}

function createDefaultProgress(): SessionProgress {
  return {
    clarityStart: 3,
    clarityNow: 3,
    favoriteMessageIds: []
  };
}

function normalizeIncomingReport(value: unknown, stageId: InterviewStageId): SessionReport {
  if (!value || typeof value !== 'object') {
    throw new Error('报告返回格式不正确。');
  }

  const candidate = value as { title?: unknown; sections?: unknown };
  const title = typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title.trim() : '阶段性自我画像';
  const sections = Array.isArray(candidate.sections)
    ? candidate.sections.map(normalizeReportSection).filter((section): section is ReportSection => section !== null)
    : [];

  if (sections.length === 0) {
    throw new Error('报告里没有可展示的栏目。');
  }

  return {
    id: crypto.randomUUID(),
    title,
    sections,
    generatedAt: new Date().toISOString(),
    stageId
  };
}

function normalizeReportSection(value: unknown): ReportSection | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as { id?: unknown; title?: unknown; body?: unknown; items?: unknown };
  const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';

  if (!title) {
    return null;
  }

  const body = typeof candidate.body === 'string' && candidate.body.trim() ? candidate.body.trim() : undefined;
  const items = Array.isArray(candidate.items)
    ? candidate.items.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : undefined;

  return {
    id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : title,
    title,
    ...(body ? { body } : {}),
    ...(items && items.length > 0 ? { items } : {})
  };
}

function isSessionReport(value: unknown): value is SessionReport {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<SessionReport>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.sections) &&
    candidate.sections.every(isReportSection) &&
    typeof candidate.generatedAt === 'string' &&
    isStageId(candidate.stageId)
  );
}

function isReportSection(value: unknown): value is ReportSection {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ReportSection>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    (candidate.body === undefined || typeof candidate.body === 'string') &&
    (candidate.items === undefined || (Array.isArray(candidate.items) && candidate.items.every((item) => typeof item === 'string')))
  );
}

function isSessionProgress(value: unknown): value is SessionProgress {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<SessionProgress>;
  return (
    typeof candidate.clarityStart === 'number' &&
    typeof candidate.clarityNow === 'number' &&
    Array.isArray(candidate.favoriteMessageIds) &&
    candidate.favoriteMessageIds.every((id) => typeof id === 'string') &&
    (candidate.tinyAction === undefined || isTinyAction(candidate.tinyAction))
  );
}

function isTinyAction(value: unknown): value is TinyAction {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<TinyAction>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.text === 'string' &&
    typeof candidate.createdAt === 'string' &&
    (candidate.completedAt === undefined || typeof candidate.completedAt === 'string') &&
    (candidate.sourceReportId === undefined || typeof candidate.sourceReportId === 'string')
  );
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ChatMessage>;
  return (
    typeof candidate.id === 'string' &&
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string' &&
    typeof candidate.createdAt === 'string'
  );
}

function updateSession(
  state: PersistedState,
  sessionId: string,
  updater: (session: InterviewSession) => InterviewSession
): PersistedState {
  return {
    ...state,
    sessions: state.sessions.map((session) => (session.id === sessionId ? updater(session) : session))
  };
}

function shouldAutoTitle(session: InterviewSession) {
  return session.title === '新的访谈' && session.messages.length === 0;
}

function makeTitle(content: string) {
  const singleLine = content.replace(/\s+/g, ' ').trim();
  return singleLine.length > 18 ? `${singleLine.slice(0, 18)}...` : singleLine;
}

function makeTinyAction(report: SessionReport, currentAction?: TinyAction): TinyAction {
  if (currentAction && !currentAction.completedAt && currentAction.sourceReportId === report.id) {
    return currentAction;
  }

  const text = extractTinyActionText(report);

  return {
    id: crypto.randomUUID(),
    text,
    createdAt: new Date().toISOString(),
    sourceReportId: report.id
  };
}

function extractTinyActionText(report: SessionReport) {
  const actionSection = report.sections.find((section) => {
    const haystack = `${section.id} ${section.title}`.toLocaleLowerCase();
    return (
      haystack.includes('action') ||
      haystack.includes('small') ||
      haystack.includes('tiny') ||
      haystack.includes('动作') ||
      haystack.includes('行动') ||
      haystack.includes('下一步')
    );
  });

  const candidate = actionSection?.items?.[0] ?? actionSection?.body;
  return candidate ? shorten(candidate, 80) : '明天找一个安静的 5 分钟，重新读一遍这次画像里最有感觉的一句。';
}

function deriveThemeChips(report: SessionReport) {
  const preferredSections = report.sections.filter((section) => {
    const haystack = `${section.id} ${section.title}`;
    return /主题|重点|模式|反复|悬着|theme|pattern|recurring|question/i.test(haystack);
  });

  const source = (preferredSections.length > 0 ? preferredSections : report.sections)
    .flatMap((section) => [section.title, section.body, ...(section.items ?? [])])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  const chips = source
    .map((value) => value.replace(/[。！？!?，,：:；;]/g, ' ').trim())
    .flatMap((value) => value.split(/\s+/))
    .map((value) => value.replace(/^["“”'「」]+|["“”'「」]+$/g, ''))
    .filter((value) => value.length >= 2 && value.length <= 12)
    .filter((value) => !['今天的主题', '我听见的重点', '可能的模式', '仍然悬着的问题'].includes(value));

  return Array.from(new Set(chips)).slice(0, 6);
}

function formatClarityDelta(progress: SessionProgress) {
  const delta = progress.clarityNow - progress.clarityStart;

  if (delta > 0) {
    return `比开始时清楚了 ${delta} 格。`;
  }

  if (delta < 0) {
    return `现在比开始时更混沌 ${Math.abs(delta)} 格，也算被看见了。`;
  }

  return '清晰度暂时持平。';
}

function formatAverageDelta(value: number) {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}

function getReviewRangeLabel(range: ReviewRange) {
  if (range === '7d') return '近 7 天';
  if (range === '30d') return '近 30 天';
  return '全部时间';
}

function formatHealthTitle(health: ApiHealth) {
  if (health.state === 'checking') {
    return '检查中';
  }

  if (health.state === 'offline') {
    return '后端未连接';
  }

  return health.hasApiKey ? '可聊天' : '缺少 API key';
}

function shorten(value: string, maxLength: number) {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength)}...` : singleLine;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function toMarkdown(session: InterviewSession) {
  const lines = [
    `# ${session.title}`,
    '',
    `- 当前阶段：${getStage(session.stageId).name}`,
    `- 创建时间：${formatFullDate(session.createdAt)}`,
    `- 更新时间：${formatFullDate(session.updatedAt)}`,
    `- 消息数量：${session.messages.length}`,
    ''
  ];

  lines.push('## 进步感');
  lines.push('');
  lines.push(`- 开始清晰度：${session.progress.clarityStart}/5`);
  lines.push(`- 现在清晰度：${session.progress.clarityNow}/5`);
  lines.push(`- 清晰度变化：${formatClarityDelta(session.progress)}`);

  if (session.progress.tinyAction) {
    lines.push(
      `- 极小行动：${session.progress.tinyAction.completedAt ? '[x]' : '[ ]'} ${session.progress.tinyAction.text}`
    );
  }

  const favorites = session.messages.filter((message) => session.progress.favoriteMessageIds.includes(message.id));
  if (favorites.length > 0) {
    lines.push('');
    lines.push('### 收藏关键句');
    lines.push('');
    favorites.forEach((message) => {
      lines.push(`- ${message.role === 'user' ? '我' : '访谈伙伴'}：${message.content}`);
    });
  }

  lines.push('');

  if (session.report) {
    lines.push('## 阶段性自我画像');
    lines.push('');
    lines.push(`生成时间：${formatFullDate(session.report.generatedAt)}`);
    lines.push('');
    lines.push(`### ${session.report.title}`);
    lines.push('');

    session.report.sections.forEach((section) => {
      lines.push(`#### ${section.title}`);
      lines.push('');

      if (section.body) {
        lines.push(section.body);
        lines.push('');
      }

      if (section.items && section.items.length > 0) {
        section.items.forEach((item) => lines.push(`- ${item}`));
        lines.push('');
      }
    });
  }

  lines.push('## 对话记录');
  lines.push('');

  if (session.messages.length === 0) {
    lines.push('这次访谈还没有正式开始。');
  } else {
    session.messages.forEach((message) => {
      lines.push(`### ${message.role === 'user' ? '我' : '访谈伙伴'} · ${formatFullDate(message.createdAt)}`);
      lines.push('');
      lines.push(message.content);
      lines.push('');
    });
  }

  return `${lines.join('\n')}\n`;
}

function formatFullDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value));
}

function sanitizeFileName(value: string) {
  const safe = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return safe.length > 0 ? safe : 'chat2yourself-session';
}

function toFileDate(value: string) {
  return value.slice(0, 10);
}

function getStage(stageId: InterviewStageId) {
  return interviewStages.find((stage) => stage.id === stageId) ?? interviewStages[0];
}

function isStageId(value: unknown): value is InterviewStageId {
  return interviewStages.some((stage) => stage.id === value);
}

function downloadText(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default App;
