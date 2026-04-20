const { TextEncoder, TextDecoder, encodeUTF8, decodeUTF8 } = require('../../utils/text-encoder-polyfill.js');
const { sendChatMessageStream } = require('../../utils/chat.js')

const STORAGE_KEY = 'QA_SESSION_HISTORY'
const USER_PROFILE_STORAGE_KEY = 'user_profile'
const DEFAULT_ASSISTANT_AVATAR = 'https://meetmeow.oss-cn-wuhan-lr.aliyuncs.com/source/agent.png'
const DEFAULT_USER_AVATAR = 'https://img.yzcdn.cn/vant/user-active.png'

Page({
  data: {
    messages: [],
    streamingMessage: '',
    inputValue: '',
    isSending: false,    // 是否正在发送消息
    conversationId: '',  // 当前会话 ID
    scrollIntoView: '',   // 用于滚动到指定消息
    canSend: false,
    assistantAvatar: DEFAULT_ASSISTANT_AVATAR,
    userAvatar: DEFAULT_USER_AVATAR,
    isWaitingResponse: false,
    keyboardHeight: 0
  },

  onLoad() {
    const previous = wx.getStorageSync(STORAGE_KEY) || {}
    const messages = (previous.messages || []).filter(item => item.status !== 'failed')

    this.responseTimer = null
    this.pendingTimeoutQuery = ''
    this.shouldIgnoreChunks = false
    this.hasReceivedFirstChunk = false
    const sys = wx.getSystemInfoSync() || {}
    this.windowHeight = sys.windowHeight || 0

    this.setData({
      messages,
      conversationId: ''
    }, () => {
      this.scrollToBottom()
    })

    this.refreshAvatars()
  },

  onShow() {
    this.refreshAvatars()
  },

  handleHistoryTap() {
    wx.showToast({ title: '历史列表开发中', icon: 'none' })
  },

  handleClearCache() {
    this.clearNoResponseTimer()
    if (!this.data.messages.length && !this.data.streamingMessage) {
      wx.showToast({ title: '暂无缓存', icon: 'none' })
      return
    }
    wx.showModal({
      title: '清除对话',
      content: '确认清除当前会话记录？',
      confirmText: '清除',
      cancelText: '保留',
      success: (res) => {
        if (!res.confirm) {
          return
        }
        wx.removeStorageSync(STORAGE_KEY)
        this.setData({
          messages: [],
          streamingMessage: '',
          conversationId: '',
          scrollIntoView: '',
          isWaitingResponse: false,
          isSending: false
        })
        this.shouldIgnoreChunks = true
        this.pendingTimeoutQuery = ''
        wx.showToast({ title: '已清除', icon: 'success' })
      }
    })
  },
  // 输入框内容变化时更新数据
  handleInput(e) {
    this.setData({ inputValue: e.detail.value, canSend: !!e.detail.value.trim() })
  },

  handleInputFocus(e) {
    const rawHeight = (e.detail && e.detail.height) || 0
    const cap = this.windowHeight ? Math.floor(this.windowHeight * 0.55) : 420
    const keyboardHeight = Math.min(Math.max(rawHeight, 0), cap)
    this.setData({ keyboardHeight })
    this.scrollToBottom('streaming')
  },

  handleInputBlur() {
    this.setData({ keyboardHeight: 0 })
  },

  onUnload() {
    this.clearNoResponseTimer()
    this.shouldIgnoreChunks = true
  },

  // 发送消息
  sendMessage() {
    if (this.data.isSending || !this.data.canSend) {
      return
    }
    this.clearNoResponseTimer()
    // 获取并验证输入内容
    const content = this.data.inputValue.trim()
    if (!content) {
      return
    }

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content
    }

    const filteredMessages = this.data.messages.filter(item => item.status !== 'failed')
    const messages = [...filteredMessages, userMessage]
    this.setData({
      messages,
      inputValue: '',
      canSend: false
    }, () => {
      this.scrollToBottom()
    })
    this.persist(messages)

    this.dispatchToAssistant(content)
  },

  // 调用助手生成消息
  dispatchToAssistant(content) {
    this.setData({ isSending: true, streamingMessage: '', isWaitingResponse: true })
    this.shouldIgnoreChunks = false
    this.hasReceivedFirstChunk = false
    this.startNoResponseTimer(content)
    const conversationId = this.data.conversationId || ''

  
    sendChatMessageStream({
      query: content,
      conversationId,
      onConversationReady: (id) => this.updateConversationId(id),
      onChunk: (token) => {
        if (this.shouldIgnoreChunks) {
          return
        }
        if (!this.hasReceivedFirstChunk) {
          this.hasReceivedFirstChunk = true
          this.clearNoResponseTimer()
        }
        this.setData({ streamingMessage: (this.data.streamingMessage || '') + token })
        this.scrollToBottom('streaming')
      },
      onComplete: (fullText, meta = {}) => {
        if (this.shouldIgnoreChunks) {
          return
        }
        this.clearNoResponseTimer()
        this.hasReceivedFirstChunk = true
        this.updateConversationId(meta.conversationId)
        this.commitAssistantMessage(fullText, null, content)
      },
      onError: (err) => {
        if (this.shouldIgnoreChunks) {
          return
        }
        this.clearNoResponseTimer()
        if (this.data.streamingMessage) {
          this.commitAssistantMessage(this.data.streamingMessage, null, content)
          return
        }
        this.commitAssistantMessage('', err, content)
        wx.showToast({ title: err.message || '生成失败', icon: 'none' })
      }
    }).catch(() => {
      // 错误在 onError 中处理
    })
  },

  // 提交助手消息
  commitAssistantMessage(text, error, originQuery = '') {
    const id = `assistant-${Date.now()}`
    const normalizedText = this.normalizeAssistantText(text)   // 处理助手返回的文本内容
    const newMessage = {
      id,
      role: 'assistant',
      content: normalizedText || (error ? '助手忙碌，请稍后重试' : ''),
      status: error ? 'failed' : 'success',
      retryPayload: error ? originQuery : ''
    }

    const messages = [...this.data.messages, newMessage]
    this.setData({
      messages,
      streamingMessage: '',
      isSending: false,
      isWaitingResponse: false
    }, () => {
      this.scrollToBottom()
    })

    this.clearNoResponseTimer()
    this.shouldIgnoreChunks = true
    this.pendingTimeoutQuery = ''
    this.persist(messages)
  },

  // 发送失败重试消息
  retryMessage(e) {
    if (this.data.isSending) {
      return
    }
    const targetId = e.currentTarget.dataset.id
    const message = this.data.messages.find(item => item.id === targetId)
    if (!message) {
      return
    }
    const payload = message.retryPayload || message.content
    if (!payload) {
      return
    }
    const messages = this.data.messages.filter(item => item.id !== targetId)
    this.setData({ messages }, () => {
      this.scrollToBottom()
    })
    this.persist(messages)
    this.dispatchToAssistant(payload)
  },

  scrollToBottom(anchorId) {
    if (anchorId === 'streaming') {
      this.setData({ scrollIntoView: 'streaming-anchor' })
      return
    }
    const lastId = this.getLastMessageId(this.data.messages)
    if (!lastId) {
      return
    }
    // 延迟保证节点渲染完成
    setTimeout(() => {
      this.setData({ scrollIntoView: lastId })
    }, 16)
  },

  getLastMessageId(list) {
    if (!list || !list.length) {
      return ''
    }
    return list[list.length - 1].id
  },

  updateConversationId(id) {
    if (!id || id === this.data.conversationId) {
      return
    }
    this.setData({ conversationId: id }, () => {
      this.persist(this.data.messages)
    })
  },

  startNoResponseTimer(originQuery) {
    this.clearNoResponseTimer()
    this.pendingTimeoutQuery = originQuery
    this.responseTimer = setTimeout(() => {
      this.responseTimer = null
      this.handleNoResponseTimeout()
    }, 60000)
  },

  clearNoResponseTimer() {
    if (this.responseTimer) {
      clearTimeout(this.responseTimer)
      this.responseTimer = null
    }
    this.pendingTimeoutQuery = ''
  },

  handleNoResponseTimeout() {
    if (this.shouldIgnoreChunks) {
      return
    }
    const payload = this.pendingTimeoutQuery || ''
    this.pendingTimeoutQuery = ''
    this.shouldIgnoreChunks = true
    wx.showToast({ title: '助手忙碌，请稍后重试', icon: 'none' })
    this.commitAssistantMessage('', new Error('助手忙碌，请稍后重试'), payload)
  },

  persist(messages) {
    wx.setStorageSync(STORAGE_KEY, {
      conversationId: this.data.conversationId,
      messages
    })
  },

  refreshAvatars() {
    const profile = wx.getStorageSync(USER_PROFILE_STORAGE_KEY) || {}
    const userAvatar = profile.avatar_url || profile.avatarUrl || DEFAULT_USER_AVATAR
    const assistantAvatar = DEFAULT_ASSISTANT_AVATAR
    this.setData({ userAvatar, assistantAvatar })
  },
   
  //若文本是 JSON 串或对象，就解析后只取 answer 字段；否则保持原样。
  normalizeAssistantText(text) {
    if (!text) {
      return ''
    }
    if (typeof text === 'string') {
      const trimmed = text.trim()
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed)
          if (typeof parsed.answer === 'string') {
            return parsed.answer
          }
        } catch (err) {
          // fall through
        }
      }
      return trimmed
    }
    if (typeof text === 'object' && text !== null) {
      if (typeof text.answer === 'string') {
        return text.answer
      }
      try {
        return JSON.stringify(text)
      } catch (err) {
        return ''
      }
    }
    return String(text)
  }
})
