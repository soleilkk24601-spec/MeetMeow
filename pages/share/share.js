const util = require('../../utils/util');

const SHARE_POST_COLLECTION = 'share_posts';
const USER_PROFILE_STORAGE_KEY = 'user_profile';
const DEBUG_OPENID_STORAGE_KEY = 'debug_user_override_openid';

// 兼容不同字段名的经纬度提取，确保机构账号能看到定位按钮
function extractCoords(lbsRaw) {
  if (!lbsRaw || typeof lbsRaw !== 'object') {
    return { lat: null, lng: null };
  }
  const nested = lbsRaw.location || {};
  const lat = lbsRaw.latitude || lbsRaw.lat || nested.latitude || nested.lat;
  const lng = lbsRaw.longitude || lbsRaw.lng || nested.longitude || nested.lng;
  const latNum = lat === undefined ? null : Number(lat);
  const lngNum = lng === undefined ? null : Number(lng);
  return {
    lat: Number.isNaN(latNum) ? null : latNum,
    lng: Number.isNaN(lngNum) ? null : lngNum
  };
}

Page({
  data: {
    posts: [],
    loading: false,
    hasMore: true,
    pageSize: 10,
    page: 0,
    currentUserId: '',
    currentUserRole: 'user',
    refreshing: false
  },

  onLoad() {
    this.bootstrapUserContext();
    this.loadPosts(true);
  },

  onShow() {
    // 返回列表后重新拉取首屏，保证发布后的帖子立即可见
    this.loadPosts(true);
  },

  onPullDownRefresh() {
    this.setData({ refreshing: true });
    this.loadPosts(true).finally(() => {
      wx.stopPullDownRefresh();
      this.setData({ refreshing: false });
    });
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loading) {
      return;
    }
    this.loadPosts(false);
  },

  bootstrapUserContext() {
    // 读取当前用户 ID 与角色，供点赞/删除等权限判断
    const override = wx.getStorageSync(DEBUG_OPENID_STORAGE_KEY);
    const profile = wx.getStorageSync(USER_PROFILE_STORAGE_KEY) || {};
    const userId = override || profile._id || '';
    const role = (profile.role || 'user').toString().trim().toLowerCase();
    this.setData({ currentUserId: userId, currentUserRole: role });
  },

  loadPosts(reset = false) {
    if (this.data.loading) {
      return Promise.resolve();
    }

    this.setData({ loading: true });
    const db = wx.cloud.database();
    const query = db.collection(SHARE_POST_COLLECTION)
      .where({ status: 'active' })
      .orderBy('created_at', 'desc');

    const page = reset ? 0 : this.data.page;

    return query.skip(page * this.data.pageSize)
      .limit(this.data.pageSize)
      .get()
      .then(res => {
        const fetched = (res.data || []).map(item => this.decoratePost(item));
        const merged = reset ? fetched : [...this.data.posts, ...fetched];
        const hasMore = fetched.length === this.data.pageSize;
        const nextPage = reset ? (fetched.length > 0 ? 1 : 0) : page + 1;
        this.setData({
          posts: merged,
          hasMore,
          page: nextPage
        });
      })
      .catch(err => {
        console.error('内容广场加载失败：', err);
        wx.showToast({ title: '内容加载失败', icon: 'none' });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  decoratePost(post) {
    // 派生出相对时间、定位展示及点赞/删除权限
    const profile = wx.getStorageSync(USER_PROFILE_STORAGE_KEY) || {};
    const override = wx.getStorageSync(DEBUG_OPENID_STORAGE_KEY);
    const currentUserId = override || profile._id || '';
    const role = (profile.role || 'user').toString().trim().toLowerCase();

    const likedUserIds = (post.likes && post.likes.user_ids) || [];
    const isLiked = !!currentUserId && likedUserIds.includes(currentUserId);
    const visibility = post.visibility || {};
    const lbs = post.lbs || {};
    const isOrgViewer = ['ngo', 'admin'].includes(role);
    // 机构/管理员：可见显示文案，若缺失则回落格式化坐标
    // 普通用户：仅当 show_lbs_to_public 为 true 时显示已脱敏的 display 文案，不再回落到原始坐标
    const fallbackLbsText = lbs.display || util.formatLocationTag(lbs.raw);
    const displayLbs = isOrgViewer
      ? (fallbackLbsText || '')
      : (visibility.show_lbs_to_public ? (lbs.display || '') : '');
    const { lat, lng } = extractCoords(lbs.raw);
    // 机构/管理员即使缺少原始经纬度，也允许查看“示意地图”
    const fallback = { lat: 30.5931, lng: 114.3054 };
    const hasCoords = lat !== null && lng !== null;
    const canViewPrecise = isOrgViewer && (displayLbs || hasCoords);
    const preciseLat = hasCoords ? lat : fallback.lat;
    const preciseLng = hasCoords ? lng : fallback.lng;

    return {
      ...post,
      relativeTime: util.formatRelativeTime(post.created_at),
      displayLbs,
      canViewPrecise,
      isMine: currentUserId && currentUserId === post.author_id,
      isLiked,
      likeCount: (post.likes && post.likes.count) || likedUserIds.length || 0,
      preciseLat,
      preciseLng
    };
  },

  toggleLike(e) {
    const postId = e.currentTarget.dataset.id;
    if (!postId) {
      return;
    }
    if (!this.data.currentUserId) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    const targetIndex = this.data.posts.findIndex(item => item._id === postId);
    if (targetIndex < 0) {
      return;
    }
    const post = this.data.posts[targetIndex];
    const liked = post.isLiked;

    const db = wx.cloud.database();
    const _ = db.command;
    const updatePayload = liked
      ? {
          'likes.user_ids': _.pull(this.data.currentUserId),
          'likes.count': _.inc(-1)
        }
      : {
          'likes.user_ids': _.addToSet(this.data.currentUserId),
          'likes.count': _.inc(1)
        };

    db.collection(SHARE_POST_COLLECTION).doc(postId).update({ data: updatePayload })
      .then(() => {
        const updated = [...this.data.posts];
        const nextPost = {
          ...post,
          isLiked: !liked,
          likeCount: Math.max(0, (post.likeCount || 0) + (liked ? -1 : 1))
        };
        updated[targetIndex] = nextPost;
        this.setData({ posts: updated });
      })
      .catch(err => {
        console.error('点赞操作失败：', err);
        wx.showToast({ title: '点赞失败', icon: 'none' });
      });
  },

  deletePost(e) {
    const postId = e.currentTarget.dataset.id;
    if (!postId) {
      return;
    }
    wx.showModal({
      title: '删除帖子',
      content: '确认删除这条内容吗？',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        const db = wx.cloud.database();
        db.collection(SHARE_POST_COLLECTION).doc(postId).update({
          data: { status: 'deleted', updated_at: new Date().toISOString() }
        }).then(() => {
          const filtered = this.data.posts.filter(item => item._id !== postId);
          this.setData({ posts: filtered });
          wx.showToast({ title: '已删除', icon: 'success' });
        }).catch(err => {
          console.error('删除帖子失败：', err);
          wx.showToast({ title: '删除失败', icon: 'none' });
        });
      }
    });
  },

  previewImage(e) {
    const { url } = e.currentTarget.dataset;
    if (!url) {
      return;
    }
    wx.previewImage({
      current: url,
      urls: [url]
    });
  },

  openMockMap(e) {
    if (!['ngo', 'admin'].includes(this.data.currentUserRole)) {
      return;
    }
    const { lat, lng } = e.currentTarget.dataset;
    // 缺省时使用武汉市内的固定坐标
    const fallback = { lat: 30.5931, lng: 114.3054 };
    const targetLat = lat ? Number(lat) : fallback.lat;
    const targetLng = lng ? Number(lng) : fallback.lng;
    wx.navigateTo({
      url: `/pages/share/mock-map/mock-map?lat=${targetLat}&lng=${targetLng}`
    });
  }
});