import { create } from "zustand"
import type { ChatMessage, Session } from "../../shared/types"

export type { ChatMessage, Session }

interface AppState {
  sessions: Session[]
  currentSessionId: string | null
  messages: ChatMessage[]
  streamingContent: string
  isStreaming: boolean
  error: string | null

  loadSessions: () => Promise<void>
  createSession: () => Promise<string | null>
  switchSession: (id: string) => void
  deleteSession: (id: string) => Promise<void>
  loadSession: (id: string) => Promise<void>
  addMessage: (msg: ChatMessage) => void
  /** Append delta (default) or replace full content when replace=true. */
  appendStreamingContent: (delta: string) => void
  setStreamingContent: (content: string) => void
  setStreaming: (v: boolean) => void
  setError: (err: string | null) => void
}

export const useStore = create<AppState>((set) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  streamingContent: "",
  isStreaming: false,
  error: null,

  loadSessions: async () => {
    try {
      const sessions = await window.dave.session.list()
      set({ sessions })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "加载会话列表失败" })
    }
  },

  createSession: async () => {
    try {
      return await window.dave.session.create()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "创建会话失败" })
      return null
    }
  },

  switchSession: (id: string) => {
    set({
      currentSessionId: id,
      messages: [],
      streamingContent: "",
      error: null,
      isStreaming: false,
    })
  },

  loadSession: async (id: string) => {
    try {
      const data = await window.dave.session.get(id)
      // Keep tool rows so the transcript shows agent tool traces.
      // Drop pure system prompts if any.
      const visible = data.messages.filter((m) => m.role !== "system")
      set({ messages: visible })
    } catch {
      set({ messages: [] })
    }
  },

  deleteSession: async (id: string) => {
    try {
      await window.dave.session.delete(id)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "删除会话失败" })
    }
  },

  addMessage: (msg: ChatMessage) => {
    set((state) => ({ messages: [...state.messages, msg] }))
  },

  appendStreamingContent: (delta: string) => {
    set((state) => ({ streamingContent: state.streamingContent + delta }))
  },

  setStreamingContent: (content: string) => set({ streamingContent: content }),
  setStreaming: (v: boolean) => set({ isStreaming: v }),
  setError: (err: string | null) => set({ error: err }),
}))
