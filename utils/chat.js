const DIFY_CHATFLOW_API = {
  url: 'https://api.dify.ai/v1/chat-messages',
  apiKey: 'app-4kOuOsvkSZEoiUUplZ4Wewit'
}

const decoder = new TextDecoder('utf-8')

function decodeChunk(payload) {
  if (!payload) {
    return ''
  }
  if (typeof payload === 'string') {
    return payload
  }
  const buffer = payload.data || payload
  if (buffer instanceof ArrayBuffer) {
    return decoder.decode(buffer)
  }
  if (Array.isArray(buffer)) {
    return decoder.decode(new Uint8Array(buffer))
  }
  return ''
}
// 解析 SSE 帧
function parseSseFrames(raw) {
  const frames = []
  if (!raw) {
    return frames
  }
  raw.split('\n\n').forEach(block => {
    const trimmed = block.trim()
    if (!trimmed) {
      return
    }
    const dataLine = trimmed.split('\n').find(line => line.startsWith('data:'))
    if (!dataLine) {
      return
    }
    const payload = dataLine.replace(/^data:\s*/, '')
    if (!payload || payload === '[DONE]') {
      frames.push({ type: 'done' })
      return
    }
    try {
      const parsed = JSON.parse(payload)
      const conversationId = parsed.conversation_id || ''
      if (parsed.event === 'message') {
        frames.push({ type: 'message', data: parsed.answer || '', conversationId })
        return
      }
      if (parsed.event === 'error') {
        frames.push({ type: 'error', data: parsed.error || '', conversationId })
        return
      }
      // 忽略 node_finished 等其他事件
      if (parsed.event === 'end' || parsed.event === 'workflow_finished' || parsed.event === 'workflow_completed') {
        frames.push({ type: 'done', conversationId })
      }
    } catch (err) {
      console.warn('Failed to parse SSE payload', payload)
    }
  })
  return frames
}

function normalizeChunkText(input) {
  if (input === null || input === undefined) {
    return ''
  }
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return normalizeChunkText(JSON.parse(trimmed))
      } catch (err) {
        return trimmed
      }
    }
    return input
  }
  if (Array.isArray(input)) {
    return input.map(segment => normalizeChunkText(segment)).join('')
  }
  if (typeof input === 'object') {
    if (typeof input.answer === 'string') {
      return normalizeChunkText(input.answer)
    }
    if (typeof input.text === 'string') {
      return normalizeChunkText(input.text)
    }
    if (typeof input.message === 'string') {
      return normalizeChunkText(input.message)
    }
    return ''
  }
  return String(input)
}

// 发送聊天消息请求，支持流式响应
function sendChatMessageStream(options = {}) {
  const {
    query,
    conversationId,
    userId = 'global_assistant_user',
    onChunk,
    onComplete,
    onError,
    onConversationReady
  } = options

  const trimmed = (query || '').trim()
  if (!trimmed) {
    const err = new Error('请输入问题')
    onError && onError(err)
    return Promise.reject(err)
  }

  return new Promise((resolve, reject) => {
    let collected = ''
    let finished = false
    let settled = false
    let boundConversationId = conversationId || ''

    const emitConversationId = (incoming) => {
      if (!incoming || boundConversationId === incoming) {
        return
      }
      boundConversationId = incoming
      typeof onConversationReady === 'function' && onConversationReady(incoming)
    }

    const settleSuccess = (text) => {
      if (settled) {
        return
      }
      settled = true
      resolve(text)
    }

    const settleFailure = (error) => {
      if (settled) {
        return
      }
      settled = true
      reject(error)
    }

    const finalize = (text) => {
      if (finished) {
        return
      }
      finished = true
      if (text !== undefined) {
        collected = normalizeChunkText(text)
      }
      const output = collected
      onComplete && onComplete(output, { conversationId: boundConversationId })
      settleSuccess(output)
    }

    const handleError = (error) => {
      if (finished) {
        return
      }
      finished = true
      onError && onError(error)
      settleFailure(error)
    }

    const requestData = {
      inputs: {},
      query: trimmed,
      response_mode: 'streaming',  //流式输出
      user: userId
    }
    if (conversationId) {
      requestData.conversation_id = conversationId
    }

    // 发起请求
    const requestTask = wx.request({
      url: DIFY_CHATFLOW_API.url,
      method: 'POST',
      enableChunked: true,
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DIFY_CHATFLOW_API.apiKey}`
      },
      data: requestData,
      success: (res) => {
        if (res.statusCode !== 200) {
          const message = res.data?.error || res.data?.message || JSON.stringify(res.data || {})
          handleError(new Error(message || 'Chatflow 请求失败'))
          console.log(res.data)
          return
        }
        emitConversationId(res.data?.conversation_id)
        if (!supportStreaming) {
          const content = normalizeChunkText(res.data?.answer || res.data?.output || '')
          finalize(content)
          return
        }
        if (!finished) {
          finalize()
        }
      },
      fail: (err) => {
        handleError(new Error(err.errMsg || 'Chatflow 网络异常'))
      }
    })

    const supportStreaming = requestTask && typeof requestTask.onChunkReceived === 'function'

    if (supportStreaming) {
      requestTask.onChunkReceived(chunk => {
        const decoded = decodeChunk(chunk)
        const frames = parseSseFrames(decoded)
        frames.forEach(frame => {
          emitConversationId(frame.conversationId)
          if (frame.type === 'message' && frame.data) {
            const chunkText = normalizeChunkText(frame.data)
            if (!chunkText) {
              return
            }
            collected += chunkText
            onChunk && onChunk(chunkText)
          }
          if (frame.type === 'error') {
            const errorText = normalizeChunkText(frame.data) || 'Chatflow 返回异常'
            handleError(new Error(errorText))
          }
          if (frame.type === 'done') {
            finalize()
          }
        })
      })
    }
  })
}

module.exports = {
  DIFY_CHATFLOW_API,
  sendChatMessageStream
}
