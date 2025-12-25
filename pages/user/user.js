const USER_COLLECTION = 'users';
const USER_PROFILE_STORAGE_KEY = 'user_profile';
const DEBUG_OPENID_STORAGE_KEY = 'debug_user_override_openid';

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
    defaultAvatar: 'https://img.yzcdn.cn/vant/cat-avatar.png',
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

    wx.showToast({ title: '请在下方输入要调试的 openid', icon: 'none' });
    return Promise.reject(new Error('未配置调试 openid，已跳过云端加载'));
  },

  fetchUserFromCloud(openId) {
    // 根据 openid 获取 users 文档，不存在则走创建流程
    const db = wx.cloud.database();
    return db.collection(USER_COLLECTION).doc(openId).get()
      .then(res => {
        this.persistUserInfo(res.data);
        return res.data;
      })
      .catch(err => {
        if (err?.errMsg?.includes('document.get:fail')) {
          return this.createUserRecord(openId);
        }
        throw err;
      });
  },

  createUserRecord(openId) {
    // 云端不存在记录时创建默认档案
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

    return db.collection(USER_COLLECTION).doc(openId).set({ data: profile })
      .then(() => {
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

  handleGetProfile() {
    // 调用微信授权接口同步头像昵称
    if (!wx.getUserProfile) {
      wx.showToast({ title: '当前基础库过低', icon: 'none' });
      return;
    }

    wx.getUserProfile({
      desc: '用于完善用户资料',
      success: (res) => {
        const { nickName, avatarUrl } = res.userInfo;
        this.updateUserRecord({
          nickname: nickName,
          avatar_url: avatarUrl
        }).then(() => {
          wx.showToast({ title: '已同步资料', icon: 'success' });
        });
      },
      fail: () => {
        wx.showToast({ title: '未授权', icon: 'none' });
      }
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
