/* =========================================================================
   Performance Test Utilities — 性能测试辅助函数
   用于生成测试数据、执行压测场景
   ========================================================================= */

import type { ChatMessage } from "../../shared/types"

/** 生成指定数量的模拟消息（user/assistant 交替） */
export function generateTestMessages(count: number): ChatMessage[] {
  const messages: ChatMessage[] = []

  for (let i = 0; i < count; i++) {
    const isUser = i % 2 === 0

    messages.push({
      role: isUser ? "user" : "assistant",
      content: isUser ? generateUserMessage(i) : generateAssistantMessage(i),
    })
  }

  return messages
}

/** 生成用户消息内容 */
function generateUserMessage(index: number): string {
  const templates = [
    `Test user message ${index}`,
    `Please help me with task ${index}`,
    `How do I implement feature ${index}?`,
    `What's the best approach for problem ${index}?`,
    `Can you explain concept ${index} in detail?`,
  ]
  return templates[index % templates.length]
}

/** 生成助手消息内容（包含 Markdown） */
function generateAssistantMessage(index: number): string {
  const templates = [
    // 简单文本
    `Test assistant response ${index}. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,

    // 带代码块
    `Here's a solution for task ${index}:

\`\`\`typescript
function solution${index}() {
  const result = ${index} * 2
  return result
}
\`\`\`

This implementation uses a simple multiplication approach.`,

    // 带列表
    `To solve problem ${index}, follow these steps:

1. First, analyze the requirements
2. Then, design the solution
3. Implement the core logic
4. Test thoroughly
5. Refactor if needed

This approach ensures quality and maintainability.`,

    // 带表格
    `Here's a comparison for option ${index}:

| Feature | Option A | Option B |
|---------|----------|----------|
| Performance | High | Medium |
| Cost | Low | High |
| Complexity | Simple | Complex |

Choose based on your specific requirements.`,

    // 带多个代码块和文本
    `Let me explain approach ${index} in detail.

First, set up the initial state:

\`\`\`typescript
const initialState = {
  count: ${index},
  active: true
}
\`\`\`

Then, implement the update logic:

\`\`\`typescript
function update(state: State) {
  return { ...state, count: state.count + 1 }
}
\`\`\`

This pattern ensures immutability and predictable updates.`,
  ]

  return templates[index % templates.length]
}

/** 生成复杂 Markdown 消息（代码块 + 表格 + 列表） */
export function generateComplexMarkdownMessage(index: number): string {
  return `# Complex Test Message ${index}

## Overview
This is a complex message containing multiple Markdown elements.

## Code Example

\`\`\`typescript
interface Example${index} {
  id: number
  name: string
  timestamp: Date
}

class Service${index} {
  private data: Example${index}[] = []

  add(item: Example${index}): void {
    this.data.push(item)
  }

  findById(id: number): Example${index} | undefined {
    return this.data.find(item => item.id === id)
  }
}
\`\`\`

## Comparison Table

| Metric | Value A | Value B | Value C |
|--------|---------|---------|---------|
| Speed  | Fast    | Medium  | Slow    |
| Memory | Low     | Medium  | High    |
| CPU    | 10%     | 25%     | 50%     |

## Key Points

- **Point 1**: Implementation uses TypeScript for type safety
- **Point 2**: Service class encapsulates data operations
- **Point 3**: Methods follow single responsibility principle

### Nested List

1. First level item ${index}
   - Second level item A
   - Second level item B
     - Third level item X
     - Third level item Y
2. Another first level item
   - With nested content

## Inline Code

Use \`findById()\` to retrieve items, or \`add()\` to insert new ones.

## Conclusion

This example demonstrates ${index} different aspects of the implementation.
`
}

/** 生成测试消息集合（指定类型比例） */
export function generateMixedTestMessages(
  count: number,
  options: {
    simpleRatio?: number // 简单文本比例（0-1）
    complexRatio?: number // 复杂 Markdown 比例（0-1）
  } = {},
): ChatMessage[] {
  const { simpleRatio = 0.7, complexRatio: _complexRatio = 0.3 } = options
  const messages: ChatMessage[] = []

  for (let i = 0; i < count; i++) {
    const isUser = i % 2 === 0
    const rand = Math.random()

    let content: string
    if (isUser) {
      content = generateUserMessage(i)
    } else {
      // 按比例生成简单或复杂消息
      content = rand < simpleRatio ? generateAssistantMessage(i) : generateComplexMarkdownMessage(i)
    }

    messages.push({ role: isUser ? "user" : "assistant", content })
  }

  return messages
}
