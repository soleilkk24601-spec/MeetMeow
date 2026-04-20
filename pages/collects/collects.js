// pages/collects/collects.js
const util = require('../../utils/util.js')
const { callInteractionWorkflow, callQwenGeneration } = require('../../utils/api.js')
const SHARE_DRAFT_STORAGE_KEY = 'share_draft_payload'

const USER_PROFILE_STORAGE_KEY = 'user_profile'
const DEBUG_OPENID_STORAGE_KEY = 'debug_user_override_openid'

// 后端服务地址配置
const BACKEND_API = {
  // 使用备案域名的 HTTPS 地址以满足小程序合法域名校验
  signPutUrl: 'https://admin.rdzh8.com/api/oss/sign-put'
}


Page({

  /**
   * 页面的初始数据
   */
  data: {
    catList: [],      // 收藏的猫咪列表
    isEmpty: true,    // 是否为空
    showDetailModal: false,
    activeCat: null,
    storyInput: '',
    storyVoicePath: '',
    storyReply: '',
    currentStoryText: '',
    isRecordingVoice: false,
    canSendStory: false,
    isSendingStory: false,
    showRenameModal: false,
    renameInput: '',
    isRenamingCat: false,
    isSummaryExpanded: true,
    isGeneratingNanoAvatar: false,
    generatedAvatarUrl: '',
    deleteCandidateId: '',
    isShowingVirtualImage: false,
    canToggleVirtualImage: false
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad: function (options) {
    this.loadCatRecords()
  },

  /**
   * 生命周期函数--监听页面显示（每次切换到该页面时刷新）
   */
  onShow: function () {
    // 每次回到页面时重置详情弹窗状态
    this.closeDetailModal();
    this.loadCatRecords()
  },

  onHide() {
    // 离开页面时也确保关闭详情弹窗
    this.closeDetailModal();
  },

  /**
   * 加载猫咪记录
   */
  loadCatRecords: function () {
    if (!wx.cloud) {
      wx.showToast({ title: '请升级基础库以使用云开发', icon: 'none' })
      return
    }

    const userId = this.getCurrentUserId()
    if (!userId) {
      this.setData({ catList: [], isEmpty: true })
      wx.showToast({ title: '请先在“我的”页初始化账号', icon: 'none' })
      return
    }

    const db = wx.cloud.database()
    db.collection('cats_data')
      .where({ user_id: userId })
      .orderBy('createdAt', 'desc')
      .get()
      .then(res => {
        const list = res.data || []
        this.setData({
          catList: list,
          isEmpty: list.length === 0
        })
      })
      .catch(err => {
        console.error('云端图鉴读取失败：', err)
        wx.showToast({ title: '图鉴加载失败', icon: 'none' })
      })
      .finally(() => {
        wx.hideLoading()
      })
  },

  /**
   * 查看猫咪详情
   */
  viewDetail: function (e) {
    const id = e.currentTarget.dataset.id
    if (this.data.deleteCandidateId) {
      if (this.data.deleteCandidateId === id) {
        this.setData({ deleteCandidateId: '' })
        return
      }
      this.setData({ deleteCandidateId: '' })
    }
    const cat = this.data.catList.find(c => (c._id || c.id) === id)
    if (cat) {
      this.setData({
        activeCat: cat,
        showDetailModal: true,
        storyReply: '',
        storyInput: '',
        storyVoicePath: '',
        canSendStory: false,
        showRenameModal: false,
        renameInput: '',
        isSummaryExpanded: true,
        generatedAvatarUrl: '',
        deleteCandidateId: '',
        isShowingVirtualImage: false,
        canToggleVirtualImage: !!cat.virtual_image,
        currentStoryText: cat.share_story || ''
      })
    }
  },

  closeDetailModal() {
    this.setData({
      showDetailModal: false,
      activeCat: null,
      showRenameModal: false,
      renameInput: '',
      isGeneratingNanoAvatar: false,
      generatedAvatarUrl: '',
      deleteCandidateId: '',
      isShowingVirtualImage: false,
      canToggleVirtualImage: false
    })
    this.resetStoryComposer()
  },

  stopModalTap() {
    // 占位：阻止蒙层点击事件冒泡
  },

  /**
   * 删除猫咪记录
   */
  deleteCat: function (e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      wx.showToast({ title: '记录不存在', icon: 'none' })
      return
    }
    this.deleteCatById(id)
  },

  confirmDeleteActiveCat() {
    const active = this.data.activeCat
    if (!active) {
      wx.showToast({ title: '暂无选中猫咪', icon: 'none' })
      return
    }
    const id = active._id || active.id
    if (!id) {
      wx.showToast({ title: '记录缺失 ID', icon: 'none' })
      return
    }
    this.deleteCatById(id, true)
  },

  deleteCatById(id, fromModal = false) {
    wx.showModal({
      title: '确认删除',
      content: '确定要从图鉴中删除这只猫咪吗？',
      success: (res) => {
        if (!res.confirm) return

        wx.cloud.database().collection('cats_data').doc(id).remove()
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' })
            const list = this.data.catList.filter(item => (item._id || item.id) !== id)
            this.setData({
              catList: list,
              isEmpty: list.length === 0,
              deleteCandidateId: ''
            })
            if (fromModal) {
              this.closeDetailModal()
            }
          })
          .catch(err => {
            console.error('云端删除失败：', err)
            wx.showToast({ title: '删除失败', icon: 'none' })
          })
      }
    })
  },

  getCurrentUserId() {
    // 与首页/用户中心保持一致：优先调试 openid，再回落本地档案
    const override = wx.getStorageSync(DEBUG_OPENID_STORAGE_KEY)
    if (override) {
      return override
    }
    const profile = wx.getStorageSync(USER_PROFILE_STORAGE_KEY)
    if (profile && profile._id) {
      return profile._id
    }
    return ''
  },

  /**
   * 长按卡片展示删除按钮
   */
  handleCardLongPress(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      return
    }
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ deleteCandidateId: id })
  },

  /**
   * 点击悬浮垃圾桶后删除猫咪
   */
  handleDeleteIconTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      return
    }
    this.setData({ deleteCandidateId: '' })
    this.deleteCatById(id)
  },

  onStoryInput(e) {
    const value = e?.detail?.value || ''
    this.setData({
      storyInput: value
    })
    this.updateStorySendState(value)
  },

  updateStorySendState(latestText) {
    const text = typeof latestText === 'string' ? latestText : this.data.storyInput
    const hasText = text && text.trim().length > 0
    const hasVoice = !!this.data.storyVoicePath
    this.setData({ canSendStory: hasText || hasVoice })
  },

  initRecorderManager() {
    if (this.recorderManager) {
      return
    }
    this.recorderManager = wx.getRecorderManager()
    this.recorderManager.onStop(this.handleStoryRecorderStop.bind(this))
    this.recorderManager.onError(err => {
      console.error('录音失败：', err)
      this.setData({ isRecordingVoice: false })
      wx.showToast({ title: '录音失败', icon: 'none' })
    })
  },

  toggleStoryVoice() {
    if (this.data.isSendingStory) {
      wx.showToast({ title: '发送中，请稍候', icon: 'none' })
      return
    }

    if (this.data.isRecordingVoice) {
      this.stopStoryVoice()
      return
    }

    wx.authorize({
      scope: 'scope.record',
      success: () => {
        this.initRecorderManager()
        if (this.data.isRecordingVoice) {
          return
        }
        this.recorderManager.start({ format: 'mp3', duration: 60000 })
        this.setData({
          isRecordingVoice: true,
          storyVoicePath: ''
        })
        this.updateStorySendState(this.data.storyInput)
        wx.showToast({ title: '录音中，再次点击结束', icon: 'none' })
      },
      fail: () => {
        wx.showToast({ title: '需要录音权限', icon: 'none' })
      }
    })
  },

  stopStoryVoice() {
    if (!this.recorderManager || !this.data.isRecordingVoice) {
      return
    }
    this.recorderManager.stop()
    this.setData({ isRecordingVoice: false })
  },

  handleStoryRecorderStop(res) {
    if (!res || !res.tempFilePath) {
      wx.showToast({ title: '录音数据缺失', icon: 'none' })
      return
    }
    this.setData({ storyVoicePath: res.tempFilePath })
    this.updateStorySendState(this.data.storyInput)
    wx.showToast({ title: '录音结束，可发送', icon: 'success' })
  },

  handleSendStory() {
    if (this.data.isSendingStory || !this.data.canSendStory) {
      return
    }
    const activeCat = this.data.activeCat
    if (!activeCat) {
      wx.showToast({ title: '请先选择猫咪', icon: 'none' })
      return
    }

    const imageUrl = this.getActiveCatImageUrl(activeCat)
    if (!imageUrl) {
      wx.showToast({ title: '该猫咪缺少可用图片', icon: 'none' })
      return
    }

    const textPayload = (this.data.storyInput || '').trim()
    const hasVoice = !!this.data.storyVoicePath

    if (!textPayload && !hasVoice) {
      wx.showToast({ title: '请输入内容', icon: 'none' })
      return
    }

    // 可选：若录了音则上传到 OSS，否则直接走文本
    const voiceUploadTask = hasVoice
      ? this.uploadVoiceToOss(this.data.storyVoicePath)
      : Promise.resolve('')

    this.setData({ isSendingStory: true })
    wx.showLoading({ title: '发送中...' })

    voiceUploadTask
      // Dify 参数
      .then(voiceUrl => {
        const audioParam = hasVoice && voiceUrl ? voiceUrl : undefined
        const textParam = hasVoice ? undefined : (textPayload || undefined)
        return callInteractionWorkflow({
          audio: audioParam,
          text: textParam,
          imageUrl: imageUrl
        })
      })
      .then(result => {
        const errorMsg = (result?.error || '').trim()
        if (errorMsg) {
          wx.showModal({ title: '共创失败', content: errorMsg, showCancel: false })
          return
        }

        const finalStory = (result?.story || '').trim()
        const docId = activeCat._id || activeCat.id || ''

        this.setData({
          storyReply: finalStory,
          storyInput: '',
          storyVoicePath: '',
          canSendStory: false,
          currentStoryText: finalStory
        })
        this.persistShareStory(docId, finalStory)

        if (finalStory) {
          wx.showToast({ title: 'AI 已回复', icon: 'success' })
        } else {
          wx.showToast({ title: 'AI 无返回', icon: 'none' })
        }
      })
      .catch(err => {
        console.error('共创故事失败：', err)
        wx.showToast({ title: err.message || '发送失败', icon: 'none' })
      })
      .finally(() => {
        this.setData({ isSendingStory: false })
        wx.hideLoading()
      })
  },

  handleStoryRegenerate() {
    const activeCat = this.data.activeCat
    const docId = activeCat ? (activeCat._id || activeCat.id || '') : ''

    if (this.data.isRecordingVoice) {
      this.stopStoryVoice()
    }

    this.setData({
      storyInput: '',
      storyVoicePath: '',
      storyReply: '',
      canSendStory: false,
      isSendingStory: false,
      currentStoryText: ''
    })

    if (docId) {
      this.persistShareStory(docId, '')
    }
  },

  getActiveCatImageUrl(cat) {
    // 收藏记录里的 image_url
    const url = cat && cat.image_url
    if (url && /^https?:\/\//.test(url)) {
      return url
    }
    return ''
  },

  uploadVoiceToOss(filePath) {
    // 语音文件上传：先获取签名，再用 PUT 推到 OSS，最后返回公网 URL
    const dir = 'voices/'
    const contentType = 'audio/mpeg'
    const fileName = this.buildObjectKey(dir, filePath)

    return this.requestOssSignature(fileName, contentType)
      .then(config => new Promise((resolve, reject) => {
        const fs = wx.getFileSystemManager()
        fs.readFile({
          filePath,
          success: readRes => {
            wx.request({
              url: config.uploadUrl,
              method: 'PUT',
              data: readRes.data,
              header: config.headers,
              success: res => {
                if (res.statusCode === 200 || res.statusCode === 204) {
                  resolve(config.publicUrl)
                } else {
                  reject(new Error('语音上传失败'))
                }
              },
              fail: err => reject(new Error(err.errMsg || '语音上传失败'))
            })
          },
          fail: err => reject(new Error(err.errMsg || '读取文件失败'))
        })
      }))
      .catch(err => {
        wx.showToast({ title: err.message || '语音上传失败', icon: 'none' })
        throw err
      })
  },

  requestOssSignature(filename, contentType = 'application/octet-stream') {
    // 调后端签名接口，拿到上传地址 + headers，供 uploadVoiceToOss 使用
    return new Promise((resolve, reject) => {
      const encodedFileName = encodeURIComponent(filename)
      const encodedType = encodeURIComponent(contentType)

      wx.request({
        url: `${BACKEND_API.signPutUrl}?filename=${encodedFileName}&contentType=${encodedType}`,
        method: 'GET',
        success(res) {
          if (res.statusCode === 200 && res.data.code === 200 && res.data.data?.uploadUrl) {
            resolve(res.data.data)
          } else {
            reject(new Error(res.data?.message || '获取签名失败'))
          }
        },
        fail(err) {
          reject(new Error(err.errMsg || '获取签名失败'))
        }
      })
    })
  },

  buildObjectKey(dir, filePath) {
    // 确保 OSS 对象名唯一且带扩展名，便于后续访问
    const safeDir = dir.endsWith('/') ? dir : `${dir}/`
    const ext = this.getFileExtension(filePath)
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    return `${safeDir}${unique}.${ext}`
  },

  getFileExtension(filePath) {
    const match = filePath && filePath.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)
    return match ? match[1].toLowerCase() : 'mp3'
  },

  resetStoryComposer() {
    this.setData({
      storyInput: '',
      storyVoicePath: '',
      storyReply: '',
      canSendStory: false,
      isSendingStory: false,
      isRecordingVoice: false,
      currentStoryText: ''
    })
  },

  persistShareStory(docId, story) {
    const finalStory = story || ''
    if (!docId) {
      return
    }

    this.patchLocalShareStory(docId, finalStory)

    if (!wx.cloud) {
      return
    }

    wx.cloud.database().collection('cats_data').doc(docId).update({
      data: {
        share_story: finalStory
      }
    }).catch(err => {
      console.error('故事写入云端失败：', err)
      wx.showToast({ title: '故事保存失败', icon: 'none' })
    })
  },

  patchLocalShareStory(docId, story) {
    const list = (this.data.catList || []).map(item => {
      const currentId = item._id || item.id
      if (currentId === docId) {
        return { ...item, share_story: story }
      }
      return item
    })

    const activeCat = this.data.activeCat
    const updatedActive = activeCat && ((activeCat._id || activeCat.id) === docId)
      ? { ...activeCat, share_story: story }
      : activeCat

    this.setData({
      catList: list,
      activeCat: updatedActive
    })
  },

  openRenameModal() {
    const activeCat = this.data.activeCat
    if (!activeCat) {
      wx.showToast({ title: '暂无选中猫咪', icon: 'none' })
      return
    }
    this.setData({
      showRenameModal: true,
      renameInput: activeCat.catname || ''
    })
  },

  closeRenameModal() {
    if (this.data.isRenamingCat) {
      return
    }
    this.setData({ showRenameModal: false })
  },

  stopRenameTap() {
    // 阻止点击遮罩关闭重命名弹窗
  },

  toggleSummaryPanel() {
    this.setData({ isSummaryExpanded: !this.data.isSummaryExpanded })
  },

  onRenameInput(e) {
    this.setData({ renameInput: e?.detail?.value || '' })
  },

  confirmRename() {
    if (this.data.isRenamingCat) {
      return
    }
    const name = (this.data.renameInput || '').trim()
    if (!name) {
      wx.showToast({ title: '请输入昵称', icon: 'none' })
      return
    }
    const activeCat = this.data.activeCat
    if (!activeCat) {
      wx.showToast({ title: '暂无选中猫咪', icon: 'none' })
      return
    }
    const docId = activeCat._id || activeCat.id
    if (!docId) {
      wx.showToast({ title: '记录缺少 ID', icon: 'none' })
      return
    }

    if (!wx.cloud) {
      wx.showToast({ title: '暂不支持重命名', icon: 'none' })
      return
    }

    this.setData({ isRenamingCat: true })
    wx.cloud.database().collection('cats_data').doc(docId).update({
      data: {
        catname: name
      }
    }).then(() => {
      wx.showToast({ title: '昵称已更新', icon: 'success' })
      this.patchLocalCatName(docId, name)
      this.setData({
        isRenamingCat: false,
        showRenameModal: false,
        renameInput: name
      })
    }).catch(err => {
      console.error('重命名失败：', err)
      wx.showToast({ title: '保存失败', icon: 'none' })
      this.setData({ isRenamingCat: false })
    })
  },

  patchLocalCatName(docId, name) {
    const list = (this.data.catList || []).map(item => {
      const currentId = item._id || item.id
      if (currentId === docId) {
        return { ...item, catname: name }
      }
      return item
    })

    const activeCat = this.data.activeCat
    const updatedActive = activeCat && ((activeCat._id || activeCat.id) === docId)
      ? { ...activeCat, catname: name }
      : activeCat

    this.setData({
      catList: list,
      activeCat: updatedActive
    })
  },

  // 将当前猫咪详情封装成分享草稿
  shareActiveCat() {
    const activeCat = this.data.activeCat
    if (!activeCat) {
      wx.showToast({ title: '请选择猫咪', icon: 'none' })
      return
    }
    if (!activeCat.image_url) {
      wx.showToast({ title: '缺少猫咪图片', icon: 'none' })
      return
    }

    const breed = activeCat.basic_info && activeCat.basic_info.breed ? activeCat.basic_info.breed : ''
    // 留空交由分享编辑页做城市级逆地理解析，避免先渲染成“纬度/经度”
    const locationDisplay = ''
    const payload = {
      scene: 'collects',
      imageUrl: activeCat.image_url,
      catname: activeCat.catname || '',
      breed,
      shareStory: activeCat.share_story || this.data.storyReply || '',
      summary: activeCat.warm_summary || '',
      locationRaw: activeCat.meet_location || '',
      locationDisplay,
      recordId: activeCat._id || activeCat.id || ''
    }

    wx.setStorageSync(SHARE_DRAFT_STORAGE_KEY, payload)
    wx.navigateTo({ url: '/pages/share/editor/editor?scene=collects' })
  },
  

  /**
   * 点击详情卡片下方的「生成虚拟形象」按钮
   * 会调用 Qwen API 生成图片，并直接预览生成结果
   */
  handleGenerateAvatar() {
    if (this.data.isGeneratingNanoAvatar) {
      return
    }

    const activeCat = this.data.activeCat
    if (!activeCat) {
      wx.showToast({ title: '请先选择猫咪', icon: 'none' })
      return
    }

    const imageUrl = this.getActiveCatImageUrl(activeCat)
    if (!imageUrl) {
      wx.showToast({ title: '缺少猫咪图片', icon: 'none' })
      return
    }

    const docId = activeCat._id || activeCat.id
    if (!docId) {
      wx.showToast({ title: '记录缺少 ID', icon: 'none' })
      return
    }

    // 标记进入生成流程，避免重复点击
    this.setData({ isGeneratingNanoAvatar: true })
    wx.showLoading({ title: '生成中...' })

    // 调用工具方法，将图片、提示词与参数一起送往 Qwen
    callQwenGeneration({
      imageUrl,
      prompt,
      model: 'qwen-image-edit-2509'        
    })
      .then(res => {
        const finalUrl = res?.imageUrl
        if (!finalUrl) {
          throw new Error('生成结果为空')
        }
        return this.saveVirtualAvatarToProfile(finalUrl, docId)
      })
      .then(ossUrl => {
        if (!ossUrl) {
          return
        }
        this.setData({
          generatedAvatarUrl: ossUrl,
          canToggleVirtualImage: true
        })
        wx.previewImage({ urls: [ossUrl] })
        wx.showToast({ title: '生成完成', icon: 'success' })
      })
      .catch(err => {
        console.error('Qwen 生成失败：', err)
        wx.showToast({ title: err?.message || '生成失败', icon: 'none' })
      })
      .finally(() => {
        // 关闭 loading 并恢复按钮状态
        this.setData({ isGeneratingNanoAvatar: false })
        wx.hideLoading()
      })
  },

  saveVirtualAvatarToProfile(imageUrl, docId) {
    if (!imageUrl) {
      return Promise.reject(new Error('缺少生成结果'))
    }
    if (!docId) {
      return Promise.reject(new Error('记录缺少 ID'))
    }

    return this.prepareImageFileForUpload(imageUrl)
      .then(fileMeta => this.uploadImageFileToOss(fileMeta))
      .then(ossUrl => this.persistVirtualImage(docId, ossUrl))
  },

  prepareImageFileForUpload(imageUrl) {
    const dataUrlMatch = /^data:image\/([^;]+);base64,(.+)$/i.exec(imageUrl || '')
    if (dataUrlMatch) {
      return this.writeBase64ImageToTempFile(dataUrlMatch[2], dataUrlMatch[1])
    }

    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url: imageUrl,
        success: res => {
          if (res.statusCode !== 200 || !res.tempFilePath) {
            reject(new Error('图片下载失败'))
            return
          }
          const headerType = (res.header && (res.header['Content-Type'] || res.header['content-type'])) || ''
          const extFromUrl = this.getFileExtension(imageUrl)
          const extFromHeader = this.getExtensionFromMime(headerType)
          const extension = (extFromUrl || extFromHeader || 'png').toLowerCase()
          const contentType = this.getMimeTypeFromExtension(extension)
          resolve({
            filePath: res.tempFilePath,
            extension,
            contentType
          })
        },
        fail: err => {
          reject(new Error(err?.errMsg || '图片下载失败'))
        }
      })
    })
  },

  writeBase64ImageToTempFile(base64Payload, mimeSubtype) {
    return new Promise((resolve, reject) => {
      try {
        const extension = this.normalizeImageExtension(mimeSubtype)
        const contentType = this.getMimeTypeFromExtension(extension)
        const arrayBuffer = wx.base64ToArrayBuffer(base64Payload)
        const fs = wx.getFileSystemManager()
        const tempPath = `${wx.env.USER_DATA_PATH}/virtual-avatar-${Date.now()}.${extension}`
        fs.writeFile({
          filePath: tempPath,
          data: arrayBuffer,
          encoding: 'binary',
          success: () => resolve({ filePath: tempPath, extension, contentType }),
          fail: err => reject(new Error(err?.errMsg || '缓存图片失败'))
        })
      } catch (error) {
        reject(new Error('图片数据解析失败'))
      }
    })
  },

  uploadImageFileToOss(fileMeta) {
    const { filePath, extension, contentType } = fileMeta || {}
    if (!filePath) {
      return Promise.reject(new Error('缺少临时文件'))
    }
    const ext = (extension || this.getFileExtension(filePath) || 'png').toLowerCase()
    const mimeType = contentType || this.getMimeTypeFromExtension(ext)
    const objectKey = this.buildObjectKey('animate/', `virtual.${ext}`)

    return this.requestOssSignature(objectKey, mimeType)
      .then(config => new Promise((resolve, reject) => {
        const fs = wx.getFileSystemManager()
        fs.readFile({
          filePath,
          success: readRes => {
            const headers = { ...(config.headers || {}) }
            if (mimeType && !headers['Content-Type'] && !headers['content-type']) {
              headers['Content-Type'] = mimeType
            }

            wx.request({
              url: config.uploadUrl,
              method: 'PUT',
              data: readRes.data,
              header: headers,
              success: res => {
                if (res.statusCode === 200 || res.statusCode === 204) {
                  resolve(config.publicUrl)
                } else {
                  reject(new Error('图片上传失败'))
                }
              },
              fail: err => reject(new Error(err?.errMsg || '图片上传失败'))
            })
          },
          fail: err => reject(new Error(err?.errMsg || '读取图片失败'))
        })
      }))
  },

  persistVirtualImage(docId, imageUrl) {
    if (!docId) {
      return Promise.reject(new Error('记录缺少 ID'))
    }
    if (!imageUrl) {
      return Promise.reject(new Error('缺少虚拟形象地址'))
    }
    if (!wx.cloud) {
      return Promise.reject(new Error('云开发不可用'))
    }

    return wx.cloud.database().collection('cats_data').doc(docId).update({
      data: {
        virtual_image: imageUrl
      }
    }).then(() => {
      this.patchLocalVirtualImage(docId, imageUrl)
      return imageUrl
    }).catch(err => {
      console.error('虚拟形象写入云端失败：', err)
      wx.showToast({ title: '保存虚拟形象失败', icon: 'none' })
      throw err
    })
  },

  patchLocalVirtualImage(docId, imageUrl) {
    const list = (this.data.catList || []).map(item => {
      const currentId = item._id || item.id
      if (currentId === docId) {
        return { ...item, virtual_image: imageUrl }
      }
      return item
    })

    const activeCat = this.data.activeCat
    const updatedActive = activeCat && ((activeCat._id || activeCat.id) === docId)
      ? { ...activeCat, virtual_image: imageUrl }
      : activeCat

    this.setData({
      catList: list,
      activeCat: updatedActive,
      canToggleVirtualImage: !!imageUrl,
      isShowingVirtualImage: this.data.isShowingVirtualImage && !!imageUrl
    })
  },

  toggleRingPhotoMode() {
    if (!this.data.canToggleVirtualImage) {
      return
    }
    const activeCat = this.data.activeCat
    if (!activeCat) {
      return
    }
    if (!this.data.isShowingVirtualImage && !activeCat.virtual_image) {
      wx.showToast({ title: '暂无虚拟形象', icon: 'none' })
      return
    }
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    this.setData({ isShowingVirtualImage: !this.data.isShowingVirtualImage })
  },

  previewRingImage(e) {
    const url = e?.currentTarget?.dataset?.url || ''
    if (!url) {
      return
    }
    wx.previewImage({
      current: url,
      urls: [url]
    })
  },

  normalizeImageExtension(mimeSubtype = '') {
    const lower = mimeSubtype.toLowerCase()
    if (lower.includes('jpeg') || lower.includes('jpg')) {
      return 'jpg'
    }
    if (lower.includes('png')) {
      return 'png'
    }
    if (lower.includes('webp')) {
      return 'webp'
    }
    if (lower.includes('gif')) {
      return 'gif'
    }
    return 'png'
  },

  getMimeTypeFromExtension(ext = '') {
    const lower = ext.toLowerCase()
    if (lower === 'jpg' || lower === 'jpeg') {
      return 'image/jpeg'
    }
    if (lower === 'png') {
      return 'image/png'
    }
    if (lower === 'webp') {
      return 'image/webp'
    }
    if (lower === 'gif') {
      return 'image/gif'
    }
    return 'application/octet-stream'
  },

  getExtensionFromMime(mimeType = '') {
    const lower = mimeType.toLowerCase()
    if (lower.includes('jpeg')) {
      return 'jpg'
    }
    if (lower.includes('png')) {
      return 'png'
    }
    if (lower.includes('webp')) {
      return 'webp'
    }
    if (lower.includes('gif')) {
      return 'gif'
    }
    return ''
  }
})