import { useCallback, useEffect, useRef, useState } from 'react'
import AgentsPanel from './components/AgentsPanel'
import AuthPanel from './components/AuthPanel'
import type { ConnectionState } from './components/AuthPanel'
import TeamsPanel from './components/TeamsPanel'
import { EmptyState, Icon } from './components/ui'
import { api, ApiError, API_BASE_URL } from './lib/api'
import type { Agent, Team, TeamMember, User } from './lib/api'
import './App.css'

type Notice = { id: number; kind: 'success' | 'error'; message: string }

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [booting, setBooting] = useState(true)
  const [connection, setConnection] = useState<ConnectionState>('checking')
  const [view, setView] = useState<'workspace' | 'guide'>('workspace')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [teamsLoading, setTeamsLoading] = useState(false)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [sessionRevision, setSessionRevision] = useState(0)
  const [teamsRevision, setTeamsRevision] = useState(0)
  const [workspaceRevision, setWorkspaceRevision] = useState(0)
  const userIdRef = useRef<number | null>(null)
  const selectedTeamIdRef = useRef<number | null>(null)
  const sessionGeneration = useRef(0)
  const preferredTeamId = useRef<number | null>(null)
  const authChannel = useRef<BroadcastChannel | null>(null)
  const userId = user?.userId

  const notify = useCallback((message: string, kind: Notice['kind'] = 'success') => {
    setNotice({ id: Date.now(), kind, message })
  }, [])
  const onNotice = useCallback((message: string) => notify(message), [notify])

  const applyUser = useCallback((next: User | null) => {
    const nextId = next?.userId ?? null
    if (userIdRef.current !== nextId) {
      setTeams([])
      setSelectedTeamId(null)
      setMembers([])
      setAgents([])
      setWorkspaceError(null)
      setTeamsLoading(nextId !== null)
      setWorkspaceLoading(false)
      selectedTeamIdRef.current = null
      preferredTeamId.current = null
      setView('workspace')
    }
    userIdRef.current = nextId
    setUser(next)
  }, [])

  const onError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401 && error.code !== 'INVALID_CREDENTIALS') {
      sessionGeneration.current++
      applyUser(null)
      notify('로그인 세션이 만료되었습니다. 다시 로그인해주세요.', 'error')
      return
    }
    if (error instanceof ApiError && error.status === 0) setConnection('offline')
    notify(error instanceof Error ? error.message : '요청을 처리하지 못했습니다.', 'error')
  }, [applyUser, notify])

  useEffect(() => {
    let active = true
    const generation = sessionGeneration.current
    void api.health().then(() => {
      if (active) setConnection('online')
    }).catch(() => {
      if (active) setConnection('offline')
    })
    void api.getMe().then((current) => {
      if (active && generation === sessionGeneration.current) { applyUser(current); setConnection('online') }
    }).catch((error: unknown) => {
      if (!active || generation !== sessionGeneration.current) return
      if (error instanceof ApiError && error.status === 401) applyUser(null)
      else setConnection('offline')
    }).finally(() => {
      if (active) setBooting(false)
    })
    return () => { active = false }
  }, [sessionRevision, applyUser])

  useEffect(() => {
    const recheck = () => setSessionRevision((previous) => previous + 1)
    window.addEventListener('focus', recheck)
    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel('devlink-session')
      authChannel.current = channel
      channel.onmessage = () => {
        sessionGeneration.current++
        applyUser(null)
        recheck()
      }
    }
    return () => {
      window.removeEventListener('focus', recheck)
      authChannel.current?.close()
      authChannel.current = null
    }
  }, [applyUser])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), notice.kind === 'error' ? 8000 : 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (userId === undefined) return
    let active = true
    const isCurrent = () => active && userIdRef.current === userId
    void api.listTeams().then((result) => {
      if (!isCurrent()) return
      setTeams(result)
      const preferred = preferredTeamId.current
      preferredTeamId.current = null
      const previous = selectedTeamIdRef.current
      const next = preferred !== null && result.some((team) => team.teamId === preferred)
        ? preferred
        : result.some((team) => team.teamId === previous) ? previous : result[0]?.teamId ?? null
      if (next !== previous) {
        setMembers([])
        setAgents([])
        setWorkspaceError(null)
        setWorkspaceLoading(next !== null)
      }
      selectedTeamIdRef.current = next
      setSelectedTeamId(next)
      setConnection('online')
    }).catch((error: unknown) => { if (isCurrent()) onError(error) })
      .finally(() => { if (isCurrent()) setTeamsLoading(false) })
    return () => { active = false }
  }, [userId, teamsRevision, onError])

  useEffect(() => {
    if (userId === undefined || selectedTeamId === null) return
    let active = true
    const isCurrent = () => active && userIdRef.current === userId && selectedTeamIdRef.current === selectedTeamId
    void Promise.all([api.getTeam(selectedTeamId), api.getTeamMembers(selectedTeamId), api.listAgents(selectedTeamId)])
      .then(([team, nextMembers, nextAgents]) => {
        if (!isCurrent()) return
        setTeams((previous) => previous.map((existing) => existing.teamId === team.teamId ? team : existing))
        setMembers(nextMembers)
        setAgents(nextAgents)
        setWorkspaceError(null)
        setConnection('online')
      }).catch((error: unknown) => {
        if (!isCurrent()) return
        setWorkspaceError(error instanceof Error ? error.message : '팀 정보를 불러오지 못했습니다.')
        onError(error)
      }).finally(() => { if (isCurrent()) setWorkspaceLoading(false) })
    return () => { active = false }
  }, [userId, selectedTeamId, workspaceRevision, onError])

  function onAuthenticated(current: User) {
    sessionGeneration.current++
    applyUser(current)
    setConnection('online')
    authChannel.current?.postMessage('changed')
    onNotice(`${current.nickname || current.name}님, 반가워요!`)
  }

  async function logout() {
    sessionGeneration.current++
    setLoggingOut(true)
    try {
      await api.logout()
      sessionGeneration.current++
      applyUser(null)
      authChannel.current?.postMessage('changed')
      onNotice('로그아웃했습니다.')
    } catch (error) {
      onError(error)
    } finally {
      setLoggingOut(false)
    }
  }

  function refreshAll() {
    setTeamsLoading(true)
    setWorkspaceLoading(selectedTeamId !== null)
    setWorkspaceError(null)
    setSessionRevision((previous) => previous + 1)
    setTeamsRevision((previous) => previous + 1)
    setWorkspaceRevision((previous) => previous + 1)
  }

  function onTeamsChanged(nextTeamId?: number) {
    setTeamsLoading(true)
    preferredTeamId.current = nextTeamId ?? null
    if (nextTeamId !== undefined && nextTeamId !== selectedTeamId) {
      setSelectedTeamId(null)
      selectedTeamIdRef.current = null
      setMembers([])
      setAgents([])
      setWorkspaceLoading(false)
    }
    setTeamsRevision((previous) => previous + 1)
    setWorkspaceRevision((previous) => previous + 1)
  }

  function selectTeam(teamId: number) {
    if (teamId === selectedTeamId) return
    setMembers([])
    setAgents([])
    setWorkspaceError(null)
    setWorkspaceLoading(true)
    setSelectedTeamId(teamId)
    selectedTeamIdRef.current = teamId
  }

  function refreshWorkspace() {
    setWorkspaceLoading(true)
    setWorkspaceError(null)
    setWorkspaceRevision((previous) => previous + 1)
  }

  const selectedTeam = teams.find((team) => team.teamId === selectedTeamId) ?? null
  const statisticsReady = selectedTeam !== null && !workspaceLoading && !workspaceError
  const toast = notice && <div className={`toast toast-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}><span className="toast-icon"><Icon name={notice.kind === 'success' ? 'check' : 'shield'} size={17} /></span><span>{notice.message}</span><button type="button" className="icon-button" aria-label="알림 닫기" onClick={() => setNotice(null)}><Icon name="close" size={16} /></button></div>

  if (booting) return <div className="boot-screen"><span className="brand-symbol">D<span /></span><h1>DevLink</h1><p className="muted">로그인 상태를 확인하고 있어요.</p><span className="loading-bar" /></div>
  if (!user) return <><AuthPanel onAuthenticated={onAuthenticated} onNotice={onNotice} connectionState={connection} onRetryConnection={() => { setConnection('checking'); setSessionRevision((previous) => previous + 1) }} />{toast}</>

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="DevLink 홈"><span className="brand-symbol">D<span /></span><span>DevLink<span className="brand-dot">.</span></span></a>
      <div className="workspace-label">WORKSPACE <span className="workspace-version">MVP</span></div>
      <nav className="main-nav" aria-label="주 메뉴"><button type="button" className={view === 'workspace' ? 'nav-item active' : 'nav-item'} onClick={() => setView('workspace')} aria-current={view === 'workspace' ? 'page' : undefined}><Icon name="grid" />팀과 Agent</button><button type="button" className={view === 'guide' ? 'nav-item active' : 'nav-item'} onClick={() => setView('guide')} aria-current={view === 'guide' ? 'page' : undefined}><Icon name="book" />사용 가이드</button></nav>
      <div className="sidebar-divider" />
      <div className="sidebar-team-heading"><span>내 팀</span><span>{teamsLoading ? '…' : teams.length}</span></div>
      <div className="sidebar-teams">{teams.map((team) => <button className={selectedTeamId === team.teamId ? 'team-nav-item selected' : 'team-nav-item'} key={team.teamId} type="button" onClick={() => { selectTeam(team.teamId); setView('workspace') }}><span className="team-letter">{team.name.slice(0, 1)}</span><span className="team-nav-name">{team.name}</span>{team.myRole === 'OWNER' && <span className="owner-dot" title="팀 소유자" />}<Icon name="chevron" size={14} /></button>)}{!teamsLoading && teams.length === 0 && <p className="sidebar-empty">팀을 만들거나<br />초대 코드로 참여해보세요.</p>}</div>
      <div className="sidebar-bottom"><div className="sidebar-note"><Icon name="shield" size={18} /><p>내 팀 안에서<br />안전하게 관리하세요.</p></div><div className="sidebar-profile"><span className="avatar">{(user.nickname || user.name).slice(0, 1)}</span><div><strong>{user.nickname || user.name}</strong><span title={user.email}>{user.email}</span></div><button type="button" className="icon-button" onClick={logout} disabled={loggingOut} aria-label={loggingOut ? '로그아웃 처리 중' : '로그아웃'} title="로그아웃"><Icon name="logout" size={19} /></button></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><Icon name="chevron" size={13} /><strong>{view === 'workspace' ? '팀과 Agent' : '사용 가이드'}</strong></div><div className="topbar-actions"><span className={`connection-indicator connection-${connection}`} title={API_BASE_URL || '로컬 개발 프록시'} role="status"><span className="status-dot" />{connection === 'online' ? '서버 연결됨' : connection === 'checking' ? '확인 중' : '연결 확인 필요'}</span><button type="button" className="icon-button" onClick={refreshAll} aria-label="전체 새로고침" title="전체 새로고침" disabled={teamsLoading || workspaceLoading}><Icon name="refresh" size={18} /></button></div></header>
      <main className="workspace-main">
        {view === 'guide' ? <UsageGuide /> : <>
          <div className="page-heading"><div><span className="eyebrow">YOUR DEVELOPMENT SPACE</span><h1>팀과 Agent를 한곳에서<span className="heading-dot">.</span></h1><p>함께할 팀을 선택하고, 프로젝트를 담당할 Agent를 등록하세요.</p></div><span className="page-stamp"><Icon name="team" size={20} />{user.name}님의 워크스페이스</span></div>
          <div className="stats-grid"><StatCard label="참여 중인 팀" value={teamsLoading ? '—' : teams.length} caption="함께 개발하는 공간" icon="team" /><StatCard label="현재 팀의 Agent" value={statisticsReady ? agents.length : '—'} caption={selectedTeam?.name ?? '팀을 먼저 선택해주세요'} icon="agent" /><StatCard label="온라인 Agent" value={statisticsReady ? agents.filter((agent) => agent.status === 'ONLINE').length : '—'} caption="서버에 보고된 접속 상태" icon="shield" online /></div>
          <TeamsPanel key={user.userId} teams={teams} selectedTeam={selectedTeam} members={members} currentUserId={user.userId} loading={teamsLoading || workspaceLoading} onSelectTeam={selectTeam} onTeamsChanged={onTeamsChanged} onRefresh={refreshAll} onError={onError} onNotice={onNotice} />
          {workspaceError && <div className="workspace-error" role="alert"><Icon name="shield" /><p>{workspaceError}</p><button type="button" className="button button-secondary button-small" onClick={refreshAll}>다시 불러오기</button></div>}
          {selectedTeam ? <AgentsPanel key={`${user.userId}-${selectedTeam.teamId}`} team={selectedTeam} agents={agents} members={members} currentUserId={user.userId} loading={workspaceLoading || !!workspaceError} onRefresh={refreshWorkspace} onError={onError} onNotice={onNotice} /> : <section className="panel"><EmptyState title={teamsLoading ? '팀 정보를 불러오고 있어요' : '첫 번째 팀을 준비해보세요'} description="팀을 만들거나 초대 코드로 참여하면, 이곳에서 팀의 Agent를 관리할 수 있어요." icon={<Icon name="team" size={28} />} /></section>}
          <footer className="page-footer"><span>DevLink Workspace</span><span>팀 · 멤버 · Agent 관리</span></footer>
        </>}
      </main>
    </div>
    {toast}
  </div>
}

function StatCard({ label, value, caption, icon, online = false }: { label: string; value: string | number; caption: string; icon: 'team' | 'agent' | 'shield'; online?: boolean }) {
  return <div className="stat-card"><div><span className="stat-label">{label}</span><strong className="stat-value">{value}<span>개</span></strong><p>{caption}</p></div><span className={`stat-icon ${online ? 'stat-icon-green' : ''}`}><Icon name={icon} size={24} /></span></div>
}

function UsageGuide() {
  const steps = [
    ['팀 만들기', '팀 이름을 입력하면 내가 OWNER로 등록되고 첫 초대 코드가 발급됩니다.'],
    ['동료 초대하기', '코드를 복사해 공유하세요. 동료는 자신의 계정으로 로그인한 뒤 코드로 팀에 참여할 수 있습니다.'],
    ['Agent 등록하기', '이름, 도구 종류, 프로젝트명과 역할을 입력하세요. 등록한 Agent는 같은 팀에서 조회할 수 있습니다.'],
    ['연결 토큰 보관하기', '내 Agent에서 토큰을 발급하고 복사하세요. 토큰 원문은 창을 닫으면 사라지고, 재발급하면 기존 토큰이 무효화됩니다.'],
    ['접속 상태 확인하기', 'Agent의 ONLINE/OFFLINE은 별도 연결에서 서버로 보고한 상태입니다. 등록 직후 OFFLINE은 정상이며 새로고침으로 현재 값을 확인할 수 있습니다.'],
  ]
  return <div className="guide-page"><div className="page-heading"><div><span className="eyebrow">GETTING STARTED</span><h1>작은 연결부터 시작하세요<span className="heading-dot">.</span></h1><p>웹에서 팀을 구성하고 Agent를 등록하는 순서입니다.</p></div></div><section className="panel guide-panel">{steps.map(([title, description], index) => <div className="guide-step" key={title}><span>{String(index + 1).padStart(2, '0')}</span><div><h2>{title}</h2><p>{description}</p></div><Icon name={index === 3 ? 'key' : index === 4 ? 'shield' : 'check'} size={21} /></div>)}</section><div className="guide-notes"><div><Icon name="team" /><h3>A/B 계정으로 확인하기</h3><p>일반 창과 시크릿 창, 또는 서로 다른 브라우저를 사용하세요. 같은 브라우저의 일반 탭들은 로그인 쿠키를 공유합니다.</p></div><div><Icon name="shield" /><h3>계정과 토큰 관리</h3><p>로그아웃은 웹 로그인 세션을 종료합니다. Agent 연결 토큰은 별도로 유지되며, 이 화면에서는 발급 결과를 저장하지 않습니다.</p></div></div></div>
}

export default App
