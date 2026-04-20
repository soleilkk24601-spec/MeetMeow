const QQMapWX = require('../../../libs/qqmap-wx-jssdk');
const QQMAP_KEY = 'EQYBZ-G7UKQ-JUS5L-BMKRF-Z75HJ-QGBIO';

Page({
  data: {
    title: '武汉市 徐家棚地铁站',
    address: '湖北省武汉市武昌区轨道交通7号线,轨道交通5号线,轨道交通8号线',
    distance: '788米',
    duration: '1分钟',
    lat: 30.44428174451423,
    lng: 114.29640483059114,
    markers: [],
    assets: {
      paw: 'https://meetmeow.oss-cn-wuhan-lr.aliyuncs.com/source/map/paw.png',
      location: 'https://meetmeow.oss-cn-wuhan-lr.aliyuncs.com/source/map/location.png',
      car: 'https://meetmeow.oss-cn-wuhan-lr.aliyuncs.com/source/map/car.png',
      nav: 'https://meetmeow.oss-cn-wuhan-lr.aliyuncs.com/source/map/toto.png',
    }
  },

  onLoad(options) {
    const { title, address, distance, duration } = options || {};
    const { assets } = this.data;
    const nextData = {};

    if (title) nextData.title = title;
    if (address) nextData.address = address;
    if (distance) nextData.distance = distance;
    if (duration) nextData.duration = duration;

    const inputLat = Number(options?.lat);
    const inputLng = Number(options?.lng);
    const lat = Number.isFinite(inputLat) ? inputLat : this.data.lat;
    const lng = Number.isFinite(inputLng) ? inputLng : this.data.lng;

    nextData.lat = lat;
    nextData.lng = lng;
    nextData.markers = [
      {
        id: 1,
        latitude: lat,
        longitude: lng,
        width: 48,
        height: 64,
        iconPath: assets.marker
      }
    ];

    this.setData(nextData, () => {
      this.reverseGeocode(lat, lng);
      this.getUserLocationAndRoute(lat, lng);
    });
  },

  getUserLocationAndRoute(destLat, destLng) {
    const key = (QQMAP_KEY || '').trim();
    if (!key || !destLat || !destLng) {
      return;
    }
    // 先检查/申请定位权限
    wx.getSetting({
      success: (setting) => {
        const hasAuth = setting.authSetting && setting.authSetting['scope.userLocation'];
        if (hasAuth) {
          this.requestLocationAndRoute(destLat, destLng, key);
        } else {
          wx.authorize({
            scope: 'scope.userLocation',
            success: () => this.requestLocationAndRoute(destLat, destLng, key),
            fail: () => {
              wx.showModal({
                title: '需要定位权限',
                content: '开启定位后可计算距离和时长',
                confirmText: '去开启',
                success: (res) => {
                  if (res.confirm) {
                    wx.openSetting({});
                  }
                }
              });
            }
          });
        }
      },
      fail: (err) => {
        console.warn('mock-map 获取权限状态失败', err);
      }
    });
  },

  requestLocationAndRoute(destLat, destLng, key) {
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        const { latitude, longitude } = res;
        this.fetchRoute(latitude, longitude, destLat, destLng, key);
      },
      fail: (err) => {
        console.warn('mock-map 获取当前位置失败，使用默认距离/时长', err);
      }
    });
  },

  fetchRoute(fromLat, fromLng, toLat, toLng, key) {
    const url = 'https://apis.map.qq.com/ws/direction/v1/driving';
    const from = `${fromLat},${fromLng}`;
    const to = `${toLat},${toLng}`;

    wx.request({
      url,
      method: 'GET',
      data: {
        from,
        to,
        key
      },
      success: (res) => {
        if (res.statusCode !== 200 || res.data?.status !== 0) {
          console.warn('mock-map 路线规划失败', res.data || res);
          return;
        }
        const route = res.data.result?.routes?.[0];
        if (!route) {
          return;
        }
        const distance = this.formatDistance(route.distance);
        const duration = this.formatDuration(route.duration);
        this.setData({ distance, duration });
      },
      fail: (err) => {
        console.warn('mock-map 路线规划接口异常', err);
      }
    });
  },

  formatDistance(meters) {
    if (!Number.isFinite(meters)) return this.data.distance;
    if (meters < 1000) return `${Math.max(1, Math.round(meters))}米`;
    return `${(meters / 1000).toFixed(1)}公里`;
  },

  formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return this.data.duration;
    const minutes = Math.max(1, Math.round(seconds / 60));
    return `${minutes}分钟`;
  },

  reverseGeocode(lat, lng) {
    const key = (QQMAP_KEY || '').trim();
    if (!key || !lat || !lng) {
      return;
    }

    if (!this.qqmapsdk) {
      this.qqmapsdk = new QQMapWX({ key });
    }

    this.qqmapsdk.reverseGeocoder({
      location: { latitude: lat, longitude: lng },
      success: (res) => {
        const comp = res?.result?.address_component || {};
        const city = comp.city || '';
        const district = comp.district || '';
        const street = comp.street || '';
        const title = [city, district || street].filter(Boolean).join(' ');
        const address = res?.result?.address || '';
        const duration = this.data.duration;
        const distance = this.data.distance;

        this.setData({
          title: title || this.data.title,
          address: address || this.data.address,
          distance,
          duration
        });
      },
      fail: (err) => {
        console.warn('mock-map reverseGeocoder failed', err);
      }
    });
  },

  mockNavigate() {
    wx.showToast({ title: '已为你规划示意路线', icon: 'success' });
  }
});
