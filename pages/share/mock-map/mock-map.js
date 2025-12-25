Page({
  data: {
    lat: 30.5931,
    lng: 114.3054
  },

  onLoad(options) {
    const lat = Number(options.lat);
    const lng = Number(options.lng);
    const safeLat = Number.isFinite(lat) ? lat : this.data.lat;
    const safeLng = Number.isFinite(lng) ? lng : this.data.lng;
    this.setData({ lat: safeLat, lng: safeLng });
  },

  mockNavigate() {
    wx.showToast({ title: '已为你规划示意路线', icon: 'success' });
  }
});
