const runtimeEnv = require('./env')

const DIFY_CHATFLOW_API = {
  url: runtimeEnv.CHATFLOW_API_URL,
  apiKey: runtimeEnv.CHATFLOW_API_KEY
}

const decoder = new TextDecoder('utf-8')
const CHAT_DEBUG = true

function dbg(...args) {
  if (!CHAT_DEBUG) return
  try {
    console.info('[chat-debug]', ...args)
  } catch (err) {
    // ignore
  }
}

function compareVersion(v1 = '', v2 = '') {
  const a = String(v1).split('.').map(n => parseInt(n, 10) || 0)
  const b = String(v2).split('.').map(n => parseInt(n, 10) || 0)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0
    const y = b[i] || 0
    if (x === y) continue
    return x > y ? 1 : -1
  }
  return 0
}

function supportsChunkedRequest() {
  try {
    if (typeof wx === 'undefined') return false
    if (typeof wx.canIUse === 'function' && wx.canIUse('request.enableChunked')) {
      return true
    }
    if (typeof wx.getSystemInfoSync === 'function') {
      const sdkVersion = wx.getSystemInfoSync().SDKVersion || ''
      return compareVersion(sdkVersion, '2.21.2') >= 0
    }
  } catch (err) {
    // ignore
  }
  return false
}

function decodeChunk(payload) {
  if (!payload) {
    return ''
  }
  if (typeof payload === 'string') {
    return payload
  }
  const buffer = payload.data ?? payload

  if (typeof buffer === 'string') {
    return buffer
  }

  const isArrayBuffer =
    buffer instanceof ArrayBuffer ||
    Object.prototype.toString.call(buffer) === '[object ArrayBuffer]'

  if (isArrayBuffer) {
    return decoder.decode(new Uint8Array(buffer))
  }

  if (ArrayBuffer.isView(buffer)) {
    return decoder.decode(new Uint8Array(buffer.buffer))
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

function normalizeNonStreamResponse(payload) {
  if (payload === null || payload === undefined) {
    return ''
  }

  if (typeof payload === 'string') {
    const frames = parseSseFrames(payload)
    const assembled = frames
      .filter(frame => frame.type === 'message' && frame.data)
      .map(frame => normalizeChunkText(frame.data))
      .join('')
    if (assembled) {
      return assembled
    }
    try {
      const parsed = JSON.parse(payload)
      return normalizeChunkText(parsed.answer || parsed.output || parsed.message || parsed)
    } catch (err) {
      return payload
    }
  }

  if (typeof payload === 'object') {
    return normalizeChunkText(payload.answer || payload.output || payload.message || payload)
  }

  return String(payload)
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
  if (!DIFY_CHATFLOW_API.apiKey) {
    const err = new Error('缺少 CHATFLOW_API_KEY')
    onError && onError(err)
    return Promise.reject(err)
  }

  return new Promise((resolve, reject) => {
    let collected = ''
    let finished = false
    let settled = false
    let boundConversationId = conversationId || ''
    const preferChunked = supportsChunkedRequest()
    dbg('preferChunked', preferChunked, 'conversationId', boundConversationId)

    let streamIdleTimer = null
    const bumpIdleTimer = () => {
      if (streamIdleTimer) {
        clearTimeout(streamIdleTimer)
      }
      // 若 5 秒内没有新的 chunk，也把当前累积结果返回，避免真机缺少 done 事件
      streamIdleTimer = setTimeout(() => {
        dbg('idle finalize')
        finalize()
      }, 5000)
    }

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
      response_mode: preferChunked ? 'streaming' : 'blocking',
      user: userId
    }
    if (conversationId) {
      requestData.conversation_id = conversationId
    }

    // 发起请求
    const requestTask = wx.request({
      url: DIFY_CHATFLOW_API.url,
      method: 'POST',
      enableChunked: preferChunked,
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DIFY_CHATFLOW_API.apiKey}`
      },
      data: requestData,
      success: (res) => {
        dbg('request success', res.statusCode, res.errMsg)
        if (res.statusCode !== 200) {
          const message = res.data?.error || res.data?.message || JSON.stringify(res.data || {})
          handleError(new Error(message || 'Chatflow 请求失败'))
          console.log(res.data)
          return
        }
        emitConversationId(res.data?.conversation_id)
        if (!supportStreaming) {
          dbg('blocking response data', res.data)
          const content = normalizeNonStreamResponse(res.data)
          finalize(content)
          return
        }
        // 流式模式下不在此处 finalize，等待 onChunkReceived 的 done 事件
        return
      },
      fail: (err) => {
        dbg('request fail', err)
        handleError(new Error(err.errMsg || 'Chatflow 网络异常'))
      }
    })

    const supportStreaming = requestTask && typeof requestTask.onChunkReceived === 'function'
    dbg('supportStreaming', supportStreaming)

    if (supportStreaming) {
      requestTask.onChunkReceived(chunk => {
        const rawLen = chunk && chunk.byteLength !== undefined ? chunk.byteLength : (chunk && chunk.data && chunk.data.byteLength) || 0
        dbg('chunk meta', typeof chunk, rawLen, chunk && Object.keys(chunk || {}), chunk && chunk.data && chunk.data.constructor && chunk.data.constructor.name)
        const decoded = decodeChunk(chunk)
        dbg('chunk', decoded && decoded.slice ? decoded.slice(0, 200) : decoded)
        const frames = parseSseFrames(decoded)
        dbg('frames', frames)

        if (!frames.length && decoded) {
          // 尝试按 JSON 事件解析（真机可能直接返回 JSON 行）
          let handled = false
          try {
            const parsed = JSON.parse(decoded)
            const list = Array.isArray(parsed) ? parsed : [parsed]
            list.forEach(item => {
              const event = item && item.event
              const ans = item && (
                item.answer ||
                item.output ||
                (item.data && item.data.outputs && (item.data.outputs.answer || item.data.outputs.text))
              )
              if (ans) {
                const text = normalizeChunkText(ans)
                if (text) {
                  collected += text
                  onChunk && onChunk(text)
                  bumpIdleTimer()
                  handled = true
                }
              }
              if (event === 'error' && item && item.error) {
                handled = true
                const errText = normalizeChunkText(item.error)
                handleError(new Error(errText || 'Chatflow 返回异常'))
              }
              if (event === 'end' || event === 'workflow_finished' || event === 'workflow_completed') {
                handled = true
                finalize()
              }
            })
          } catch (err) {
            // 如果不是合法 JSON，则保持原有容错
          }

          if (handled) {
            return
          }
          // 未识别且无答案时直接忽略，避免把日志渲染出来
          return
        }

        frames.forEach(frame => {
          emitConversationId(frame.conversationId)
          if (frame.type === 'message' && frame.data) {
            const chunkText = normalizeChunkText(frame.data)
            if (!chunkText) {
              return
            }
            collected += chunkText
            onChunk && onChunk(chunkText)
            bumpIdleTimer()
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
