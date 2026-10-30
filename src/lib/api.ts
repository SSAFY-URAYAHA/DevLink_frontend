export type TeamRole = 'OWNER' | 'MEMBER'
export type ToolType = 'CODEX' | 'CLAUDE_CODE'

export interface User {
  userId: number
  email: string
  name: string
  nickname: string | null
  createdAt: string
}

export interface Team {
  teamId: number
  name: string
  myRole: TeamRole
  createdAt: string
}

export interface TeamMember {
  userId: number
  name: string
  nickname: string | null
  role: TeamRole
  joinedAt: string
}

export interface Agent {
  agentId: number
  teamId: number
  ownerUserId: number
  name: string
  roleDescription: string | null
  toolType: ToolType
  projectName: string
  status: 'ONLINE' | 'OFFLINE'
  lastSeenAt: string | null
  createdAt: string
}

export interface SignupInput {
  email: string
  password: string
  name: string
  nickname?: string
}

export interface LoginInput {
  email: string
  password: string
}

export interface CreateAgentInput {
  name: string
  roleDescription?: string | null
  toolType: ToolType
  projectName: string
}

export interface CreateTeamResult extends Team {
  inviteCode: string
}

export interface JoinTeamResult {
  teamId: number
  name: string
  myRole: TeamRole
  joinedAt: string
  replayed: boolean
}

export interface TeamInviteResult {
  teamId: number
  inviteCode: string
}

export interface AgentTokenResult {
  agentId: number
  token: string
}

interface CsrfToken {
  headerName: string
  token: string
}

interface ApiEnvelope {
  success: boolean
  data: unknown
  code?: unknown
  message?: unknown
}

const configuredBaseUrl: unknown = import.meta.env.VITE_API_BASE_URL
export const API_BASE_URL = typeof configuredBaseUrl === 'string'
  ? configuredBaseUrl.trim().replace(/\/+$/, '')
  : ''

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code = 'REQUEST_FAILED') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

function isEnvelope(value: unknown): value is ApiEnvelope {
  return typeof value === 'object' && value !== null
    && 'success' in value && typeof value.success === 'boolean' && 'data' in value
}

function statusMessage(status: number): string {
  if (status === 401) return '로그인이 필요하거나 세션이 만료되었습니다. 다시 로그인해주세요.'
  if (status === 403) return '요청 권한이 없습니다. 로그인 상태와 팀 권한을 확인해주세요.'
  if (status === 404) return '요청한 정보를 찾을 수 없습니다. 목록을 새로고침해주세요.'
  if (status === 409) return '이미 처리되었거나 중복된 요청입니다. 현재 상태를 확인해주세요.'
  if (status >= 500) return '서버에서 요청을 처리하지 못했습니다. 잠시 후 다시 확인해주세요.'
  return '요청을 처리하지 못했습니다. 입력한 내용을 확인해주세요.'
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20_000)
  const mutation = options.method !== undefined && options.method !== 'GET'
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1${path}`, {
      ...options,
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
      headers,
    })
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new ApiError(
        'API 응답을 읽을 수 없습니다. 프론트의 API 주소와 백엔드 실행 상태를 확인해주세요.',
        response.status,
        'INVALID_API_RESPONSE',
      )
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new ApiError('서버 응답 형식이 올바르지 않습니다.', response.status, 'INVALID_API_RESPONSE')
    }
    if (!isEnvelope(data)) {
      throw new ApiError('서버 응답 형식이 올바르지 않습니다.', response.status, 'INVALID_API_RESPONSE')
    }
    if (!response.ok || !data.success) {
      const message = typeof data.message === 'string' && data.message.trim()
        ? data.message
        : statusMessage(response.status)
      throw new ApiError(message, response.status, typeof data.code === 'string' ? data.code : 'REQUEST_FAILED')
    }
    return data.data as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    const timeoutMessage = controller.signal.aborted
      ? '서버 응답 시간이 초과되었습니다.'
      : '서버에 연결하지 못했습니다.'
    throw new ApiError(
      mutation
        ? `${timeoutMessage} 요청 결과가 저장되었을 수 있으니 새로고침으로 확인한 뒤 다시 시도해주세요.`
        : `${timeoutMessage} 백엔드 주소와 실행 상태를 확인해주세요.`,
      0,
      controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
    )
  } finally {
    window.clearTimeout(timeout)
  }
}

// 세션 교체와 상태 변경 요청의 순서를 유지하며 자동 재전송 방지
let mutationQueue: Promise<void> = Promise.resolve()

function mutate<T>(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const send = async () => {
    // 로그인·로그아웃 후 바뀐 세션에 맞춰 매 요청마다 CSRF 토큰 조회
    const csrf = await request<CsrfToken>('/auth/csrf')
    if (!csrf || !['X-CSRF-TOKEN', 'X-XSRF-TOKEN'].includes(csrf.headerName)
      || typeof csrf.token !== 'string' || !csrf.token) {
      throw new ApiError('요청 인증 정보를 확인하지 못했습니다. 페이지를 새로고침해주세요.', 0, 'INVALID_CSRF_RESPONSE')
    }
    return request<T>(path, {
      method,
      headers: {
        [csrf.headerName]: csrf.token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  const outcome = mutationQueue.then(send, send)
  mutationQueue = outcome.then(() => undefined, () => undefined)
  return outcome
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return mutate<T>('POST', path, body)
}

export const api = {
  health: () => request<string>('/health'),
  getMe: () => request<User>('/auth/users/me'),
  signup: (input: SignupInput) => post<User>('/auth/signup', {
    email: input.email.trim(),
    password: input.password,
    name: input.name.trim(),
    ...(input.nickname?.trim() ? { nickname: input.nickname.trim() } : {}),
  }),
  login: (input: LoginInput) => post<User>('/auth/login', {
    email: input.email.trim(), password: input.password,
  }),
  logout: () => post<null>('/auth/logout'),
  listTeams: () => request<Team[]>('/teams'),
  getTeam: (teamId: number) => request<Team>(`/teams/${teamId}`),
  createTeam: (name: string) => post<CreateTeamResult>('/teams', { name: name.trim() }),
  joinTeam: (inviteCode: string) => post<JoinTeamResult>('/teams/join', { inviteCode: inviteCode.trim() }),
  getTeamMembers: (teamId: number) => request<TeamMember[]>(`/teams/${teamId}/members`),
  regenerateInvite: (teamId: number) => post<TeamInviteResult>(`/teams/${teamId}/invites`),
  listAgents: (teamId: number) => request<Agent[]>(`/agents/teams/${teamId}`),
  getAgent: (agentId: number) => request<Agent>(`/agents/${agentId}`),
  deleteAgent: (agentId: number) => mutate<null>('DELETE', `/agents/${agentId}`),
  registerAgent: (teamId: number, input: CreateAgentInput) => post<Agent>(`/agents/teams/${teamId}`, {
    name: input.name.trim(),
    roleDescription: input.roleDescription?.trim() || null,
    toolType: input.toolType,
    projectName: input.projectName.trim(),
  }),
  issueAgentToken: (agentId: number) => post<AgentTokenResult>(`/agents/${agentId}/token`),
}
