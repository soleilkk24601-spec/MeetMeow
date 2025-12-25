const util = require('../../../utils/util');

const SHARE_POST_COLLECTION = 'share_posts';
const SHARE_DRAFT_STORAGE_KEY = 'share_draft_payload';
const USER_PROFILE_STORAGE_KEY = 'user_profile';
const DEBUG_OPENID_STORAGE_KEY = 'debug_user_override_openid';

Page({
  data: {
    mediaUrl: '',
    content: '',
    defaultContent: '',
    catLabel: '',
    scene: '',
    shareLocation: false,
    canToggleLocation: false,
    locationDisplay: '',
    submitting: false
  },

  onLoad() {
    this.bootstrapDraft();
  },

  bootstrapDraft() {
    // 从本地缓存读取分享草稿，不存在则提示返回
    const payload = wx.getStorageSync(SHARE_DRAFT_STORAGE_KEY);
    if (!payload) {
      wx.showToast({ title: '暂无可分享内容', icon: 'none' });
      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 1200);
      return;
    }
    this.draftPayload = payload;

    const profile = wx.getStorageSync(USER_PROFILE_STORAGE_KEY) || {};
    const allowLbs = !!profile.is_lbs_enabled && !!payload.locationRaw;
    const defaultContent = payload.shareStory || payload.summary || '';
    const locationDisplay = payload.locationDisplay || util.formatLocationTag(payload.locationRaw);

    this.setData({
      mediaUrl: payload.imageUrl || '',
      content: defaultContent,
      defaultContent,
      catLabel: payload.catname || payload.breed || '我的猫咪分享',
      scene: payload.scene || 'analysis',
      shareLocation: allowLbs,
      canToggleLocation: !!payload.locationRaw,
      locationDisplay,
    });
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value });
  },

  toggleLocation(e) {
    this.setData({ shareLocation: e.detail.value });
  },

  submitShare() {
    if (this.data.submitting) {
      return;
    }

    const userProfile = wx.getStorageSync(USER_PROFILE_STORAGE_KEY) || {};
    const override = wx.getStorageSync(DEBUG_OPENID_STORAGE_KEY);
    const userId = override || userProfile._id;

    if (!userId) {
      wx.showToast({ title: '请先在“我的”页初始化账号', icon: 'none' });
      return;
    }

    if (!this.data.mediaUrl) {
      wx.showToast({ title: '缺少分享图片', icon: 'none' });
      return;
    }

    const db = wx.cloud.database();
    const now = new Date().toISOString();
    // 写入 share_posts 集合的结构化数据
    const postDoc = {
      author_id: userId,
      author_profile: {
        nickname: userProfile.nickname || '喵友',
        avatar_url: userProfile.avatar_url || '',
        role: userProfile.role || 'user'
      },
      cat_ref_id: this.draftPayload?.recordId || '',
      media_url: this.data.mediaUrl,
      content: (this.data.content || '').trim(),
      share_story: this.draftPayload?.shareStory || '',
      warm_summary: this.draftPayload?.summary || '',
      lbs: {
        raw: this.data.shareLocation ? (this.draftPayload?.locationRaw || null) : null,
        display: this.data.shareLocation ? (this.draftPayload?.locationDisplay || util.formatLocationTag(this.draftPayload?.locationRaw)) : ''
      },
      visibility: {
        show_lbs_to_public: this.data.shareLocation
      },
      likes: {
        count: 0,
        user_ids: []
      },
      source_scene: this.data.scene,
      created_at: now,
      updated_at: now,
      status: 'active'
    };

    this.setData({ submitting: true });
    db.collection(SHARE_POST_COLLECTION).add({ data: postDoc })
      .then(() => {
        wx.removeStorageSync(SHARE_DRAFT_STORAGE_KEY);
        wx.showToast({ title: '发布成功', icon: 'success' });
        setTimeout(() => {
          wx.switchTab({ url: '/pages/share/share' });
        }, 600);
      })
      .catch(err => {
        console.error('发布内容失败：', err);
        wx.showToast({ title: '发布失败', icon: 'none' });
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  }
});
