const util = require('../../../utils/util');
const QQMapWX = require('../../../libs/qqmap-wx-jssdk');

const SHARE_POST_COLLECTION = 'share_posts';
const SHARE_DRAFT_STORAGE_KEY = 'share_draft_payload';
const USER_PROFILE_STORAGE_KEY = 'user_profile';
const DEBUG_OPENID_STORAGE_KEY = 'debug_user_override_openid';
const QQMAP_KEY = 'EQYBZ-G7UKQ-JUS5L-BMKRF-Z75HJ-QGBIO';

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
    const defaultContent = '';
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

    // 若有原始坐标，尝试在进入编辑页时先解析城市名，用于页面展示
    if (allowLbs && payload.locationRaw) {
      this.resolveCityFromLocation(payload.locationRaw).then(city => {
        if (city) {
          this.setData({ locationDisplay: city });
        }
      });
    }
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

    this.setData({ submitting: true });

    Promise.resolve()
      .then(() => this.resolveCityFromLocation(this.draftPayload?.locationRaw))
      .then((cityText) => {
        const resolvedDisplay = cityText || this.draftPayload?.locationDisplay || util.formatLocationTag(this.draftPayload?.locationRaw);

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
            display: this.data.shareLocation ? (resolvedDisplay || '') : ''
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

        return db.collection(SHARE_POST_COLLECTION).add({ data: postDoc });
      })
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
  },

  fillStory() {
    const story = this.draftPayload?.shareStory || '';
    if (!story) {
      wx.showToast({ title: '还没有共创故事哦~', icon: 'none' });
      return;
    }
    this.setData({ content: story });
  },

  clearContent() {
    this.setData({ content: '' });
  },

  resolveCityFromLocation(raw) {
    const { lat, lng } = this.extractCoords(raw);
    if (!lat || !lng) {
      return Promise.resolve('');
    }
    const mapKey = (QQMAP_KEY || '').trim();
    if (!mapKey) {
      console.warn('缺少腾讯位置服务 key，无法反解析城市');
      return Promise.resolve('');
    }
    if (!this.qqmapsdk) {
      this.qqmapsdk = new QQMapWX({ key: mapKey });
    }
    return new Promise((resolve) => {
      console.info('reverseGeocoder request', { lat, lng });
      this.qqmapsdk.reverseGeocoder({
        location: { latitude: lat, longitude: lng },
        success: (res) => {
          const city = res?.result?.address_component?.city || res?.result?.ad_info?.city || '';
          console.info('reverseGeocoder success', res);
          resolve(city ? city.replace(/市?$/, '市') : '');
        },
        fail: (err) => {
          console.warn('反向地理解析失败', err);
          resolve('');
        }
      });
    });
  },

  extractCoords(raw) {
    let payload = raw;
    if (!raw) {
      return { lat: null, lng: null };
    }
    if (typeof raw === 'string') {
      try {
        payload = JSON.parse(raw);
      } catch (e) {
        console.warn('locationRaw 解析失败，原始值:', raw);
        return { lat: null, lng: null };
      }
    }
    if (typeof payload !== 'object') {
      return { lat: null, lng: null };
    }
    const nested = payload.location || {};
    const lat = payload.latitude || payload.lat || nested.latitude || nested.lat;
    const lng = payload.longitude || payload.lng || nested.longitude || nested.lng;
    const latNum = lat === undefined ? null : Number(lat);
    const lngNum = lng === undefined ? null : Number(lng);
    return {
      lat: Number.isNaN(latNum) ? null : latNum,
      lng: Number.isNaN(lngNum) ? null : lngNum
    };
  }
});
