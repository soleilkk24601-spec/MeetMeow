const USER_COLLECTION = 'users';
const USER_PROFILE_STORAGE_KEY = 'user_profile';
const DEBUG_OPENID_STORAGE_KEY = 'debug_user_override_openid';
const OPENID_STORAGE_KEY = 'user_openid_cache';

// TODO: 将 login 云函数返回结果统一封装到 util 层，避免页面直接依赖函数名

Page({
  data: {
    userInfo: {
      _id: '',
      nickname: '未登录喵友',
      avatar_url: '',
      role: 'user',
      is_lbs_enabled: false,
      verify_status: 'none',
      created_at: ''
    },
    showVerifyModal: false,
    verifyForm: {
      orgName: '',
      contact: '',
      credential: ''
    },
    roleLabels: {
      user: '普通用户',
      ngo: '动保组织',
      admin: '管理员'
    },
    verifyStatusLabels: {
      none: '未认证',
      pending: '审核中',
      verified: '已认证',
      rejected: '需补充资料'
    },
    defaultAvatar: 'https://meetmeow.oss-cn-wuhan-lr.aliyuncs.com/images/1766907188086-5qdagl.jpg',
    currentOpenId: '',
    debugOverrideOpenId: '',
    debugInputOpenId: ''
  },

  onLoad() {
    // 初始化调试 openid，并拉取云端用户档案
    const override = wx.getStorageSync(DEBUG_OPENID_STORAGE_KEY) || '';
    this.setData({
      debugOverrideOpenId: override,
      debugInputOpenId: override
    });
    this.bootstrapUserProfile();
    this.loadVerifyDraft();
  },

  bootstrapUserProfile() {
    // 拉取 openid + 云端用户记录，不存在时自动初始化
    wx.showLoading({ title: '加载资料...', mask: true });
    this.obtainOpenId()
      .then(openId => this.fetchUserFromCloud(openId))
      .catch(err => {
        console.error('获取云端用户资料失败，使用本地缓存：', err);
        const cached = wx.getStorageSync(USER_PROFILE_STORAGE_KEY);
        if (cached && cached._id) {
          this.setData({ userInfo: cached });
        }
        wx.showToast({ title: '未取到云端资料', icon: 'none' });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },

  obtainOpenId() {
    // 仅在调试区域设置覆盖 openid 后才尝试云端读取
    const override = this.data.debugOverrideOpenId || wx.getStorageSync(DEBUG_OPENID_STORAGE_KEY);
    if (override) {
      this.setData({ currentOpenId: override });
      return Promise.resolve(override);
    }

    const cached = wx.getStorageSync(OPENID_STORAGE_KEY);
    if (cached) {
      this.setData({ currentOpenId: cached });
      return Promise.resolve(cached);
    }

    return this.loginAndFetchOpenId();
  },

  loginAndFetchOpenId() {
    return new Promise((resolve, reject) => {
      wx.login({
        timeout: 8000,
        success: (loginRes) => {
          const code = loginRes.code;
          if (!code) {
            reject(new Error('未获取到登录 code'));
            return;
          }

          this.callLoginFunction({ code })
            .then(fnRes => {
              const openId = this.extractOpenId(fnRes);
              if (!openId) {
                reject(new Error('login 云函数未返回 openid'));
                return;
              }
              this.setData({ currentOpenId: openId });
              wx.setStorageSync(OPENID_STORAGE_KEY, openId);
              console.info('获取 openid 成功', openId);
              resolve(openId);
            })
            .catch(err => {
              wx.showToast({ title: '获取 openid 失败，请检查云函数 login', icon: 'none' });
              console.error('callFunction login 失败', err);
              reject(err);
            });
        },
        fail: (err) => {
          console.error('wx.login 失败', err);
          reject(err);
        }
      });
    });
  },

  callLoginFunction(payload = {}) {
    // 兼容仅返回 openid 的 login 云函数，失败时退回无 code 调用
    return wx.cloud.callFunction({ name: 'login', data: payload })
      .catch(firstErr => {
        console.warn('login 云函数携带 code 失败，尝试无参调用', firstErr);
        return wx.cloud.callFunction({ name: 'login' })
          .catch(secondErr => {
            throw secondErr || firstErr;
          });
      });
  },

  extractOpenId(fnRes) {
    return fnRes?.result?.openid || fnRes?.result?.openId || fnRes?.result?.userInfo?.openId || '';
  },

  fetchUserFromCloud(openId) {
    // 根据 openid 获取 users 文档，不存在则走创建流程
    const db = wx.cloud.database();
    return db.collection(USER_COLLECTION).doc(openId).get()
      .then(res => {
        this.setData({ currentOpenId: openId });
        this.persistUserInfo(res.data);
        return res.data;
      })
      .catch(err => {
        console.warn('获取云端用户失败', err);
        this.persistUserInfo({ _id: openId });
        wx.showToast({ title: '请返回首页完成登录', icon: 'none' });
        return { _id: openId };
      });
  },

  createUserRecord(openId) {
    // 云端不存在记录时创建默认档案（头像/昵称由首页登录表单负责采集）
    const db = wx.cloud.database();
    const now = new Date().toISOString();

    const profile = {
      _id: openId,
      nickname: '未登录喵友',
      avatar_url: '',
      role: 'user',
      is_lbs_enabled: false,
      verify_status: 'none',
      created_at: now
    };

    const { _id, ...payload } = profile;

    return db.collection(USER_COLLECTION).doc(openId).set({ data: payload })
      .then(() => {
        this.setData({ currentOpenId: openId });
        this.persistUserInfo(profile);
        return profile;
      });
  },

  loadVerifyDraft() {
    // 读取本地认证草稿，防止二次填写
    const draft = wx.getStorageSync('user_verify_form');
    if (draft) {
      this.setData({ verifyForm: draft });
    }
  },

  persistUserInfo(partial) {
    // 更新页面状态 + 本地缓存
    const merged = { ...this.data.userInfo, ...partial };
    this.setData({ userInfo: merged });
    wx.setStorageSync(USER_PROFILE_STORAGE_KEY, merged);
  },

  updateUserRecord(partial) {
    // 写回云数据库并刷新本地缓存
    const docId = this.data.userInfo._id;
    if (!docId) {
      this.persistUserInfo(partial);
      return Promise.resolve();
    }

    const db = wx.cloud.database();
    const payload = { ...partial, updated_at: new Date().toISOString() };
    return db.collection(USER_COLLECTION).doc(docId).update({ data: payload })
      .then(() => {
        this.persistUserInfo(partial);
      })
      .catch(err => {
        console.error('更新用户资料失败：', err);
        this.persistUserInfo(partial);
      });
  },


  toggleLbs(e) {
    // 控制 LBS 开关，按需申请定位权限
    const enable = e.detail.value;
    if (enable) {
      wx.getSetting({
        success: (settingRes) => {
          if (settingRes.authSetting['scope.userLocation']) {
            this.updateUserRecord({ is_lbs_enabled: true });
          } else {
            wx.authorize({
              scope: 'scope.userLocation',
              success: () => {
                this.updateUserRecord({ is_lbs_enabled: true });
              },
              fail: () => {
                wx.showToast({ title: '需要定位权限', icon: 'none' });
                this.setData({ 'userInfo.is_lbs_enabled': false });
              }
            });
          }
        },
        fail: () => {
          wx.showToast({ title: '权限检查失败', icon: 'none' });
          this.setData({ 'userInfo.is_lbs_enabled': false });
        }
      });
    } else {
      this.updateUserRecord({ is_lbs_enabled: false });
    }
  },

  openVerifyModal() {
    // 打开认证表单弹窗
    this.setData({ showVerifyModal: true });
  },

  closeVerifyModal() {
    // 关闭认证表单弹窗
    this.setData({ showVerifyModal: false });
  },

  stopModalTap() {},

  onVerifyInput(e) {
    // 双向绑定认证表单字段
    const field = e.currentTarget.dataset.field;
    this.setData({ [`verifyForm.${field}`]: e.detail.value });
  },

  submitVerifyApplication() {
    // 校验表单并更新状态为 pending
    const { orgName, contact, credential } = this.data.verifyForm;
    if (!orgName || !contact || !credential) {
      wx.showToast({ title: '请完整填写信息', icon: 'none' });
      return;
    }

    this.updateUserRecord({ verify_status: 'pending' });
    wx.setStorageSync('user_verify_form', this.data.verifyForm);
    this.setData({ showVerifyModal: false });
    wx.showToast({ title: '已提交审核', icon: 'success' });
  },

  onDebugOpenIdInput(e) {
    // 输入调试 openid
    this.setData({ debugInputOpenId: e.detail.value });
  },

  applyDebugOpenId() {
    // 写入调试 openid 并重载资料
    const value = (this.data.debugInputOpenId || '').trim();
    if (!value) {
      wx.showToast({ title: '请输入 openid', icon: 'none' });
      return;
    }
    wx.setStorageSync(DEBUG_OPENID_STORAGE_KEY, value);
    this.setData({ debugOverrideOpenId: value });
    wx.showToast({ title: '已切换账号', icon: 'success' });
    this.bootstrapUserProfile();
  },

  clearDebugOpenId() {
    // 清空调试 openid，恢复真实身份
    wx.removeStorageSync(DEBUG_OPENID_STORAGE_KEY);
    this.setData({ debugOverrideOpenId: '', debugInputOpenId: '' });
    wx.showToast({ title: '已还原真实账号', icon: 'success' });
    this.bootstrapUserProfile();
  }
});
