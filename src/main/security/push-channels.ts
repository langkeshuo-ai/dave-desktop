/**
 * 流式聊天推送通道注册。
 * 集中定义所有 7 个推送通道的 schema、限流与时序校验映射（mapEvent/sessionIdOf），
 * 并在启动时注册到 ipc-guard。
 *
 * 使用方式：在应用启动时调用 registerChatStreamPushChannels()。
 */
import { z } from "zod"
import { registerPushChannel } from "./ipc-guard"
import type { ChatStreamChunk, ChatStreamDone, ChatStreamStart } from "../../shared/types"

/**
 * 注册所有流式聊天推送通道。
 * 必须在 pushWithGuard 使用前调用，通常在应用启动时执行。
 *
 * 时序守卫（mapEvent/sessionIdOf）说明：
 * - 守卫状态机只在配置了 mapEvent 的通道推送时推进。
 * - chunk/done 是内容级事件，受守卫保护（需 start 先行、done 终态后拒绝一切）。
 * - error/tools/approval/patch 是会发生在多种合法业务状态的事件
 *   （如多轮 agent 工具循环、审批前/后的内容流），免除守卫以免误拦截，
 *   但保留 schema 校验与限流；它们推送时不会推进守卫状态机，
 *   因此后续 chunk 仍按 streaming 合法转移。
 * - chat-stream-start 由 chat-loop 在每条流开始前推送，为会话播种状态机。
 */
export function registerChatStreamPushChannels(): void {
  // chat-stream-start: 流式开始（播种守卫状态机）
  registerPushChannel(
    "chat-stream-start",
    z.object({
      sessionId: z.string().min(1),
    }),
    {
      rateLimit: { max: 20, windowMs: 1000 },
      sessionIdOf: (payload: any) => payload.sessionId,
      mapEvent: (payload: any): import("../../shared/chat-stream-state").StreamEvent => ({
        type: "start",
        sessionId: (payload as ChatStreamStart).sessionId,
      }),
    },
  )

  // chat-stream-chunk: 流式文本块
  registerPushChannel(
    "chat-stream-chunk",
    z.object({
      content: z.string(),
      sessionId: z.string().min(1),
      replace: z.boolean().optional(),
    }),
    {
      // 真实流式 chunk 可能较密集，阈值需宽裕
      rateLimit: { max: 300, windowMs: 1000 },
      sessionIdOf: (payload: any) => payload.sessionId,
      mapEvent: (payload: any): import("../../shared/chat-stream-state").StreamEvent => ({
        type: "chunk",
        content: (payload as ChatStreamChunk).content,
        sessionId: (payload as ChatStreamChunk).sessionId,
        replace: (payload as ChatStreamChunk).replace,
      }),
    },
  )

  // chat-stream-done: 流式结束
  registerPushChannel(
    "chat-stream-done",
    z.object({
      sessionId: z.string().min(1),
      aborted: z.boolean().optional(),
    }),
    {
      rateLimit: { max: 20, windowMs: 1000 },
      sessionIdOf: (payload: any) => payload.sessionId,
      mapEvent: (payload: any): import("../../shared/chat-stream-state").StreamEvent => ({
        type: "done",
        sessionId: (payload as ChatStreamDone).sessionId,
        aborted: (payload as ChatStreamDone).aborted,
      }),
    },
  )

  // chat-stream-error: 流式错误（终态提示，随时可到达，免除时序守卫）
  registerPushChannel(
    "chat-stream-error",
    z.object({
      error: z.string(),
      sessionId: z.string().min(1),
    }),
    {
      rateLimit: { max: 20, windowMs: 1000 },
    },
  )

  // chat-stream-tools: 工具调用通知（多轮 agent 工具循环中连续出现，免除时序守卫）
  registerPushChannel(
    "chat-stream-tools",
    z.object({
      sessionId: z.string().min(1),
      tools: z.array(z.string()),
    }),
    {
      rateLimit: { max: 20, windowMs: 1000 },
    },
  )

  // chat-stream-approval: 审批请求（审批可穿插于多轮工具循环，免除时序守卫）
  registerPushChannel(
    "chat-stream-approval",
    z.object({
      sessionId: z.string().min(1),
      tool: z.string().min(1),
      arguments: z.record(z.string(), z.unknown()),
      mutates: z.boolean(),
      isShell: z.boolean(),
    }),
    {
      rateLimit: { max: 20, windowMs: 1000 },
    },
  )

  // chat-stream-patch: 文件补丁预览（紧随工具执行，可能处于多轮循环中间，免除时序守卫）
  registerPushChannel(
    "chat-stream-patch",
    z.object({
      sessionId: z.string().min(1),
      patch: z.string(),
      paths: z.array(z.string()).optional(),
    }),
    {
      rateLimit: { max: 50, windowMs: 1000 },
    },
  )
}