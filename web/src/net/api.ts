export interface ApiResult<T = unknown> {
  ok: boolean
  status: number
  data: T
  retryAfterSeconds?: number
}

export async function api<T = unknown>(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    const data = (text ? JSON.parse(text) : null) as T
    const ra = res.headers.get("retry-after")
    return { ok: res.ok, status: res.status, data, retryAfterSeconds: ra ? Number(ra) : undefined }
  } catch {
    return { ok: false, status: 0, data: null as T }
  }
}

export interface Me {
  isHost: boolean
  gameId: string | null
}
