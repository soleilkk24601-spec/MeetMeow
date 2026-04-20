const util = require('../../utils/util.js');
const { callInteractionWorkflow, callImageWorkflow } = require('../../utils/api.js');

// 用户体系缓存 key（在用户中心/图鉴/首页之间共享）
const USER_PROFILE_STORAGE_KEY = 'user_profile';
const DEBUG_OPENID_STORAGE_KEY = 'debug_user_override_openid';
const USER_COLLECTION = 'users';
const SHARE_DRAFT_STORAGE_KEY = 'share_draft_payload';

// 后端服务地址配置
const BACKEND_API = {
  signPutUrl: 'https://admin.rdzh8.com/api/oss/sign-put'    // 这是部署后的服务器地址(+域名
};

Page({

  /**
* 页面的初始数据
   */
  data: {
    currentImg: "",         // 当前预览图片路径
    isLoading: false,       // AI分析中状态
    userInfo: {             // 用户信息
      avatar_url: '',
      nickName: '未登录喵友',
      _id: ''
    },
    showResultCard: false,  // 是否显示结果卡片浮层
    catResult: null,        // 当前展示的猫咪分析结果（对象或占位）
    analysisRawText: '',    // Dify 返回的原始文本
    uploadedImgUrl: '',      // 最近一次上传后的公网链接
    userPrompt: '',          // 用户输入的文字描述
    voiceTempPath: '',       // 语音临时文件路径
    voiceRemoteUrl: '',      // 语音上传后的公网链接
    meetLocation: null,      // 最近一次拍摄点的地理位置
    interactionReply: '',    // 互动工作流展示的故事内容
    isSendingInteraction: false, // 是否正在调用互动工作流
    canSendInteraction: false,   // 发送按钮可用状态
    isRecordingVoice: false, // 当前是否正在录音
    catNameInput: '',        // 结果卡片内的猫咪命名输入
    isUploading: false,      // 上传到 OSS 的状态
    shareStory: '',           // 最新共创故事文本
    currentStoryText: '',     // 结果卡片底部展示的故事
    catNameLocked: false,     // 猫咪昵称是否已锁定
    hasSavedToCatalog: false, // 是否已加入图鉴
    showLoginModal: false,    // 首次登录采集头像昵称弹窗
    loginAvatar: '',          // 采集到的真实头像
    loginNickname: '',        // 用户手填昵称
    loginSubmitting: false    // 登录创建中
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar && typeof tabBar.setSelected === 'function') {
      tabBar.setSelected(0);
    }
    this.bootstrapUserInfo();
  },

  /**
   * 按钮1：拍照
   */
  takePhoto() {
    const that = this; 

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera'],
      camera: 'back',
      
      success(res) {
        console.log('拍照成功，返回的数据：', res);
        const tempPath = res.tempFiles[0].tempFilePath;
        that.setData({
          currentImg: tempPath,
          showResultCard: false,
          catResult: null,
          interactionReply: '',
          shareStory: '',
          currentStoryText: '',
          catNameInput: '',
          catNameLocked: false,
          hasSavedToCatalog: false
        });
        that.captureMeetLocation();
        that.uploadToOss(tempPath);
      },
      fail(err) {
        console.log('用户取消或拍照失败：', err);
      }
    })
  },

  /**
   * 按钮2：从相册选择
   */
  chooseFromAlbum() {
    const that = this;

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      
      success(res) {
        console.log('选图成功，返回的数据：', res);    
        const tempPath = res.tempFiles[0].tempFilePath;
        that.setData({
          currentImg: tempPath,
          showResultCard: false,
          catResult: null,
          interactionReply: '',
          shareStory: '',
          currentStoryText: '',
          catNameInput: '',
          catNameLocked: false,
          hasSavedToCatalog: false
        });
        that.captureMeetLocation();
        that.uploadToOss(tempPath);
      }
    })
  },

  // 捕获拍摄位置，若用户拒绝则保持为空
  captureMeetLocation() {
    if (!wx.getLocation) {
      this.setData({ meetLocation: null });
      return;
    }

    wx.getLocation({
      type: 'wgs84',
      success: (res) => {
        this.setData({
          meetLocation: {
            latitude: Number(res.latitude.toFixed(6)),
            longitude: Number(res.longitude.toFixed(6))
          }
        });
      },
      fail: () => {
        this.setData({ meetLocation: null });
      }
    });
  },

  /**
   * 上传图片到 OSS
   */
  uploadToOss(filePath, options = {}) {
    const dir = options.dir || 'images/';
    const contentType = options.contentType || this.getContentType(filePath);
    const triggerDify = options.skipDify ? false : (options.triggerDify ?? dir.startsWith('images/'));
    const showLoading = options.showLoading !== false;
    const preserveResultCard = options.preserveResultCard === true; // true 时保留结果卡片，供语音上传等场景使用

    if (!filePath) {
      return Promise.reject(new Error('缺少上传文件路径'));
    }

    if (!preserveResultCard) {
      this.setData({ showResultCard: false });
    }

    if (showLoading) {
      this.setData({ isUploading: true });
    }

    const fileName = this.buildObjectKey(dir, filePath);

    return this.requestOssSignature(fileName, contentType)
      .then(config => new Promise((resolve, reject) => {
        const headers = { ...(config.headers || {}) };
        const fs = wx.getFileSystemManager();

        fs.readFile({
          filePath,
          success: (readRes) => {
            wx.request({
              url: config.uploadUrl,
              method: 'PUT',
              data: readRes.data,
              header: headers,
              success: (res) => {
                if (res.statusCode === 200 || res.statusCode === 204) {
                  const fileUrl = config.publicUrl;   // 上传后的公网访问 URL
                  console.log('文件上传成功，公网访问 URL：', fileUrl);
                  if (triggerDify) {
                    this.setData({ uploadedImgUrl: fileUrl });
                    this.callDifyImageApi(fileUrl);
                  }
                  resolve(fileUrl);
                } else {
                  reject(new Error(`上传失败：${res.statusCode}`));
                }
              },
              fail: (err) => {
                reject(new Error(err.errMsg || '上传请求失败'));
              }
            });
          },
          fail: (err) => {
            reject(new Error(err.errMsg || '读取文件失败'));
          }
        });
      }))
      .catch(err => {
        console.error('获取或上传 OSS 失败：', err);
        wx.showToast({ title: err.message || '上传失败', icon: 'none' });
        throw err;
      })
      .finally(() => {
        if (showLoading) {
          wx.hideLoading();
          this.setData({ isUploading: false });
        }
      });
  },

  goToUserPage() {
    wx.navigateTo({ url: '/pages/user/user' });
  },

  goMallPage() {
    wx.navigateTo({ url: '/pages/mall/mall' });
  },

  goRescueNotice() {
    wx.navigateTo({ url: '/pages/alerts/alerts' });
  },

  bootstrapUserInfo() {
    const cached = wx.getStorageSync(USER_PROFILE_STORAGE_KEY);
    if (cached && cached._id) {
      this.applyUserProfile(cached);
    }

    const userId = this.getCurrentUserId();
    if (!wx.cloud) {
      if (!userId) {
        this.setData({ showLoginModal: true });
      }
      return;
    }

    if (!userId) {
      this.setData({ showLoginModal: true });
      return;
    }

    wx.cloud.database().collection(USER_COLLECTION).doc(userId).get()
      .then(res => {
        if (res && res.data) {
          this.applyUserProfile(res.data);
        } else {
          this.setData({ showLoginModal: true });
        }
      })
      .catch(err => {
        console.warn('加载用户资料失败', err);
        this.setData({ showLoginModal: true });
      });
  },

  applyUserProfile(profile = {}) {
    const avatarUrl = profile.avatar_url || profile.avatarUrl || this.data.userInfo.avatarUrl || 'https://meetmeow.oss-cn-wuhan-lr.aliyuncs.com/images/1766907188086-5qdagl.jpg';
    const nickName = profile.nickname || profile.nickName || this.data.userInfo.nickName || '用户';

    this.setData({
      userInfo: {
        ...this.data.userInfo,
        avatarUrl,
        nickName,
        _id: profile._id || this.data.userInfo._id || ''
      },
      showLoginModal: false
    });

    if (profile && profile._id) {
      const cachedProfile = {
        ...profile,
        avatar_url: avatarUrl,
        nickname: nickName
      };
      wx.setStorageSync(USER_PROFILE_STORAGE_KEY, cachedProfile);
    }
  },

  ensureOpenId() {
    const override = wx.getStorageSync(DEBUG_OPENID_STORAGE_KEY);
    if (override) {
      return Promise.resolve(override);
    }
    const cached = wx.getStorageSync(USER_PROFILE_STORAGE_KEY);
    if (cached && cached._id) {
      return Promise.resolve(cached._id);
    }
    if (!wx.cloud) {
      return Promise.reject(new Error('云开发不可用'));
    }
    return wx.cloud.callFunction({ name: 'login' }).then(res => {
      const openId = res?.result?.openid || res?.result?.openId || res?.result?.userInfo?.openId || '';
      if (!openId) {
        throw new Error('未获取到 openid');
      }
      return openId;
    });
  },

  //首次登录弹窗相关
  handleChooseAvatar(e) {
    const avatarUrl = e?.detail?.avatarUrl || '';
    if (avatarUrl) {
      this.setData({ loginAvatar: avatarUrl });
    }
  },

  onLoginNicknameInput(e) {
    this.setData({ loginNickname: e?.detail?.value || '' });
  },


  handleLoginSubmit() {
    if (this.data.loginSubmitting) {
      return;
    }

    const nickname = (this.data.loginNickname || '').trim();
    const avatarUrl = (this.data.loginAvatar || '').trim();

    if (!avatarUrl) {
      wx.showToast({ title: '请选择头像', icon: 'none' });
      return;
    }
    if (!nickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }

    this.setData({ loginSubmitting: true });
    wx.showLoading({ title: '创建中...', mask: true });

    this.ensureOpenId()
      .then(openId => {
        if (!wx.cloud) {
          throw new Error('云开发不可用');
        }
        const db = wx.cloud.database();
        const profile = {
          _id: openId,
          avatar_url: avatarUrl,
          nickname,
          role: 'user',
          is_lbs_enabled: false,
          verify_status: 'none',
          created_at: new Date().toISOString()
        };
        const { _id, ...payload } = profile;
        return db.collection(USER_COLLECTION).doc(openId).set({ data: payload })
          .then(() => {
            wx.setStorageSync(USER_PROFILE_STORAGE_KEY, profile);
            this.applyUserProfile(profile);
            this.setData({ showLoginModal: false });
            wx.showToast({ title: '登录成功', icon: 'success' });
          });
      })
      .catch(err => {
        console.error('创建用户失败：', err);
        wx.showToast({ title: err?.message || '创建失败', icon: 'none' });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ loginSubmitting: false });
      });
  },
  // 请求 OSS 上传签名
  requestOssSignature(filename, contentType = 'application/octet-stream') {
    return new Promise((resolve, reject) => {
      const encodedFileName = encodeURIComponent(filename);
      const encodedType = encodeURIComponent(contentType);

      wx.request({
        url: `${BACKEND_API.signPutUrl}?filename=${encodedFileName}&contentType=${encodedType}`,
        method: 'GET',
        success(res) {
          console.log('获取签名成功：', res.data);
          if (res.statusCode === 200 && res.data.code === 200 && res.data.data?.uploadUrl) {
            resolve(res.data.data);
          } else {
            reject(new Error(`获取签名失败：${res.data.message || '响应格式错误'}`));
          }
        },
        fail(err) {
          reject(new Error(`网络请求失败：${err.errMsg}`));
        }
      });
    });
  },
  // 构建 OSS 对象键
  buildObjectKey(dir, filePath) {
    const safeDir = dir.endsWith('/') ? dir : `${dir}/`;
    const ext = this.getFileExtension(filePath);
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return `${safeDir}${unique}.${ext}`;
  },
  // 根据文件路径获取 Content-Type
  getContentType(filePath) {
    if (!filePath) {
      return 'application/octet-stream';
    }
    const match = filePath.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    const ext = match ? match[1].toLowerCase() : 'jpg';
    const map = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      heic: 'image/heic'
    };
    return map[ext] || 'application/octet-stream';
  },
  // 获取文件扩展名
  getFileExtension(filePath) {
    const match = filePath && filePath.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    return match ? match[1].toLowerCase() : 'jpg';
  },

  /**
   * 调用 Dify 图片理解工作流 API
   */
  callDifyImageApi(imgUrl) {
    const finalImgUrl = imgUrl || this.data.uploadedImgUrl;

    if (!finalImgUrl) {
      console.warn('缺少 Dify 所需的图片 URL');
      wx.showToast({ title: '请先上传图片', icon: 'none' });
      return;
    }

    // 显示 Loading 状态
    this.setData({ isLoading: true });
    const userPrompt = this.data.userPrompt || '';
    const userId = this.getCurrentUserId() || 'cat_tester';

    callImageWorkflow({ imageUrl: finalImgUrl,  userId })
      .then(rawText => {
        const structuredRecord = this.prepareAnalysisRecord(rawText) || { raw_text: rawText };
        const resolvedName = (structuredRecord && structuredRecord.catname) || '';
        this.setData({
          catResult: {
            ...structuredRecord,
            catname: resolvedName
          },
          analysisRawText: rawText,
          showResultCard: true,
          catNameInput: resolvedName,
          catNameLocked: false,
          currentStoryText: '',
          hasSavedToCatalog: false
        });
      })
      .catch(err => {
        console.error('Dify 图片工作流失败：', err);
        wx.showToast({ title: err.message || 'AI 分析失败', icon: 'none' });
      })
      .finally(() => {
        this.setData({ isLoading: false });
      });
  },

  // 解析 rawText 并生成结构化记录
  prepareAnalysisRecord(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      console.warn('rawText 为空，无法解析');
      return null;
    }

    let payload = null;
    try {
      payload = JSON.parse(rawText);
    } catch (err) {
      console.error('rawText JSON 解析失败：', err, rawText);
      wx.showToast({ title: 'AI 文本格式错误', icon: 'none' });
      return null;
    }

    const normalized = this.normalizeCatResult(payload);
    if (!normalized) {
      wx.showToast({ title: 'AI 数据缺失', icon: 'none' });
      return null;
    }

    const record = {
      ...normalized,
      raw_text: rawText,
      image_url: this.data.uploadedImgUrl || this.data.currentImg || '',
      meet_time: new Date().toISOString(),
      meet_location: this.data.meetLocation || ''
    };

    return record;
  },
  // 结构化猫咪分析结果
  normalizeCatResult(payload = {}) {
    if (typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }

    const basic = payload.basic_info || {};
    const health = payload.health_analysis || {};
    const emotion = payload.emotion_analysis || {};

    return {
      basic_info: {
        breed: basic.breed || '',
        color_pattern: basic.color_pattern || '',
        distinctive_features: Array.isArray(basic.distinctive_features) ? basic.distinctive_features : []
      },
      health_analysis: {
        status: health.status || '',
        neutered_status: health.neutered_status || '',
        body_score: health.body_score || '',
        coat_condition: health.coat_condition || '',
        eye_condition: health.eye_condition || '',
        limb_condition: health.limb_condition || '',
        visual_symptoms: Array.isArray(health.visual_symptoms) ? health.visual_symptoms : []
      },
      emotion_analysis: {
        intent_tag: emotion.intent_tag || '',
        mood: emotion.mood || '',
        body_language_evidence: emotion.body_language_evidence || ''
      },
      environment: payload.environment || '',
      warm_summary: payload.warm_summary || ''
    };
  },



  /**
   * 语音输入部分
   */
  
  initRecorderManager() {
    if (this.recorderManager) {
      return;
    }
    this.recorderManager = wx.getRecorderManager();
    this.recorderManager.onStop(this.handleRecorderStop.bind(this));
    this.recorderManager.onError((err) => {
      console.error('录音错误：', err);
      this.setData({ isRecordingVoice: false });
      wx.showToast({ title: '录音失败', icon: 'none' });
    });
  },

  toggleVoiceInput() {
    if (this.data.isRecordingVoice) {
      this.stopVoiceInput();
      return;
    }
    this.startVoiceInput();
  },
  
  startVoiceInput() {
    if (this.data.isSendingInteraction) {
      wx.showToast({ title: '发送中，请稍候', icon: 'none' });
      return;
    }
    wx.authorize({
      scope: 'scope.record',
      success: () => {
        this.initRecorderManager();
        if (this.data.isRecordingVoice) {
          return;
        }
        this.recorderManager.start({ format: 'mp3', duration: 60000 });
        this.setData({ isRecordingVoice: true });
        wx.showToast({ title: '录音中，松开结束', icon: 'none' });
      },
      fail: () => {
        wx.showToast({ title: '需要录音权限', icon: 'none' });
      }
    });
  },

  stopVoiceInput() {
    if (!this.recorderManager || !this.data.isRecordingVoice) {
      return;
    }
    this.recorderManager.stop();
    this.setData({ isRecordingVoice: false });
  },

  handleRecorderStop(res) {
    if (!res || !res.tempFilePath) {
      wx.showToast({ title: '录音数据缺失', icon: 'none' });
      return;
    }
    const tempPath = res.tempFilePath;
    this.setData({ voiceTempPath: tempPath, voiceRemoteUrl: '' });
    this.updateInteractionSendState();
    wx.showToast({ title: '录音完成，可发送', icon: 'success' });
  },

  onPromptInput(e) {
    const value = e?.detail?.value ?? '';
    const hasText = value.trim().length > 0;
    const hasVoice = !!this.data.voiceTempPath;
    this.setData({
      userPrompt: value,
      canSendInteraction: hasText || hasVoice
    });
  },

  // 记录猫咪命名输入，当前仅作占位展示
  onCatNameInput(e) {
    if (this.data.catNameLocked) {
      return;
    }
    const value = e?.detail?.value || '';
    const updates = { catNameInput: value };
    if (this.data.catResult) {
      updates['catResult.catname'] = value;
    }
    this.setData(updates);
  },

  updateInteractionSendState() {
    const text = (this.data.userPrompt || '').trim();
    const hasVoice = !!this.data.voiceTempPath;
    this.setData({ canSendInteraction: !!text || hasVoice });
  },

  clearInteractionInputs() {
    this.setData({
      userPrompt: '',
      voiceTempPath: '',
      voiceRemoteUrl: '',
      canSendInteraction: false
    });
  },

  handleUserInteraction() {
    if (this.data.isSendingInteraction || !this.data.canSendInteraction) {
      return;
    }
    
    const imageUrl = this.getInteractionImageUrl();
    if (!imageUrl) {
      wx.showToast({ title: '请先使用最新的猫咪图片', icon: 'none' });
      return;
    }

    const textPayload = (this.data.userPrompt || '').trim();
    const hasVoice = !!this.data.voiceTempPath;

    if (!textPayload && !hasVoice) {
      wx.showToast({ title: '请输入内容', icon: 'none' });
      return;
    }

    // 上传语音（如果有的话）
    const voiceUploadTask = hasVoice
      ? this.uploadToOss(this.data.voiceTempPath, {
          dir: 'voices/',
          contentType: 'audio/mpeg',
          skipDify: true,
          triggerDify: false,
          showLoading: false,
          preserveResultCard: true // 语音上传不关闭结果卡片
        })
          .then(url => {
            this.setData({ voiceRemoteUrl: url });
            return url;
          })
          .catch(err => {
            console.error('语音上传失败：', err);
            wx.showToast({ title: '语音上传失败', icon: 'none' });
            throw err;
          })
      : Promise.resolve('');

    this.setData({ isSendingInteraction: true });
    wx.showLoading({ title: '发送中...' });

    // 录音文件URL入参
    voiceUploadTask
      .then(voiceUrl => {
        const audioParam = hasVoice && voiceUrl ? voiceUrl : undefined;
        const textParam = hasVoice ? undefined : (textPayload || undefined);
        return callInteractionWorkflow({
          audio: audioParam,
          text: textParam,
          imageUrl
        });
      })
      .then(result => {
        const errorMsg = (result?.error || '').trim();
        if (errorMsg) {
          wx.showModal({ title: '共创失败', content: errorMsg, showCancel: false });
          this.setData({ interactionReply: '' });
          return;
        }

        const finalStory = (result?.story || '').trim();
        this.setData({
          interactionReply: finalStory,
          shareStory: finalStory,
          currentStoryText: finalStory
        });
        this.clearInteractionInputs();
        if (finalStory) {
          wx.showToast({ title: 'AI 已回复', icon: 'success' });
        } else {
          wx.showToast({ title: 'AI 无返回', icon: 'none' });
        }
      })
      .catch(err => {
        console.error('共创故事工作流失败：', err);
        wx.showToast({ title: err.message || '发送失败', icon: 'none' });
      })
      .finally(() => {
        this.setData({ isSendingInteraction: false });
        wx.hideLoading();
      });
  },

  handleStoryRegenerate() {
    if (this.data.isRecordingVoice) {
      this.stopVoiceInput();
    }

    this.setData({
      userPrompt: '',
      voiceTempPath: '',
      voiceRemoteUrl: '',
      canSendInteraction: false,
      interactionReply: '',
      shareStory: '',
      currentStoryText: ''
    });
  },

  // 获取用于共创故事工作流的图片 URL
  getInteractionImageUrl() {
    const { uploadedImgUrl } = this.data;
    if (uploadedImgUrl && /^https?:\/\//.test(uploadedImgUrl)) {
      return uploadedImgUrl;
    }
    return '';
  },

  // 图片URL入参
  


   /**
   * 猫咪信息存入云端数据库
   */
  addToCloudCatalog() {
    if (this.data.hasSavedToCatalog) {
      wx.showToast({ title: '已加入图鉴', icon: 'none' });
      return;
    }

    if (!wx.cloud) {
      wx.showToast({ title: '基础库过低，无法使用云开发', icon: 'none' });
      return;
    }
    // 获取当前结果和图片 URL
    const { catResult, uploadedImgUrl, currentImg, meetLocation } = this.data;
    if (!catResult) {
      wx.showToast({ title: '暂无可加入的结果', icon: 'none' });
      return;
    }

    const imageUrl = uploadedImgUrl || catResult.image_url || currentImg;
    // 绑定当前用户 openid，供图鉴页按 user_id 过滤
    const userId = this.getCurrentUserId() || 'anonymous';
    const record = {
      ...catResult,
      raw_text: catResult.raw_text || this.data.analysisRawText || '',
      image_url: imageUrl,
      user_id: userId,
      meet_location: meetLocation || catResult.meet_location || '',
      meet_time: catResult.meet_time || new Date().toISOString(),
      createdAt: new Date().toISOString(),
      source: 'dify',
      share_story: this.data.shareStory || '',
      catname: (this.data.catNameInput || '').trim()
    };

    util.saveCatRecord(record);

    wx.showLoading({ title: '同步中...' });
    wx.cloud.database().collection('cats_data').add({ data: record })
      .then(() => {
        wx.showToast({ title: '已加入图鉴', icon: 'success' });
        this.setData({
          catNameLocked: true,
          'catResult.catname': record.catname,
          hasSavedToCatalog: true
        });
      })
      .catch(err => {
        console.error('云端写入失败：', err);
        wx.showToast({ title: '云端写入失败', icon: 'none' });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },

  getCurrentUserId() {
    // 调试 openid 优先，其次读取“我的”页缓存
    const override = wx.getStorageSync(DEBUG_OPENID_STORAGE_KEY);
    if (override) {
      return override;
    }
    const profile = wx.getStorageSync(USER_PROFILE_STORAGE_KEY);
    if (profile && profile._id) {
      return profile._id;
    }
    return '';
  },

  /**
   * 分享当前猫咪图片
   */
  shareCat() {
    const options = ['分享到微信', '发布到内容广场'];
    wx.showActionSheet({
      itemList: options,
      success: (res) => {
        if (res.tapIndex === 0) {
          this.shareCatToWechat();
        } else if (res.tapIndex === 1) {
          this.shareCatToPlaza();
        }
      }
    });
  },

  shareCatToWechat() {
    const imagePath = this.data.currentImg || (this.data.catResult && this.data.catResult.image_url);
    if (!imagePath) {
      wx.showToast({ title: '请先拍摄或加载图片', icon: 'none' });
      return;
    }
    if (wx.canIUse && wx.canIUse('showShareImageMenu')) {
      wx.showShareImageMenu({
        path: imagePath,
        fail() {
          wx.showToast({ title: '请使用右上角分享', icon: 'none' });
        }
      });
    } else {
      wx.showToast({ title: '请使用右上角分享', icon: 'none' });
    }
  },

  // 构建内容广场草稿，并跳转至分享编辑页
  shareCatToPlaza() {
    const catResult = this.data.catResult || {};
    const remoteImage = this.data.uploadedImgUrl || catResult.image_url || this.data.currentImg || '';

    if (!remoteImage) {
      wx.showToast({ title: '缺少分享图片，请先分析猫咪', icon: 'none' });
    }

    const storyText = (this.data.shareStory || this.data.interactionReply || catResult.warm_summary || '').trim();
    const locationRaw = this.data.meetLocation || catResult.meet_location || '';
    const locationDisplay = util.formatLocationTag(locationRaw);

    const payload = {
      scene: 'analysis',
      imageUrl: remoteImage,
      catname: this.data.catNameInput || catResult.catname || '',
      breed: (catResult.basic_info && catResult.basic_info.breed) || '',
      shareStory: storyText,
      summary: catResult.warm_summary || '',
      locationRaw,
      locationDisplay
    };

    wx.setStorageSync(SHARE_DRAFT_STORAGE_KEY, payload);
    wx.navigateTo({ url: '/pages/share/editor/editor?scene=analysis' });
  },

  /**
   * 自定义分享文案
   */
  onShareAppMessage() {
    const { catResult } = this.data;
    const breed = catResult && catResult.basic_info ? catResult.basic_info.breed : '';

    return {
      title: breed ? `我遇到了一只 ${breed}` : '转角遇见咪：记录每一次偶遇的猫咪',
      path: '/pages/index/index'
    };
  },

  /**
   * 关闭结果卡片浮层
   */
  closeResultCard() {
    this.setData({ showResultCard: false });
  },

  stopResultCardTap() {
    // 占位函数用于阻止事件冒泡关闭卡片
  },

  stopModalTap() {},

  /**
   * 生命周期函数--监听页面加载
   */


  onLoad: function () {
    this.bootstrapUserInfo();
  }
})