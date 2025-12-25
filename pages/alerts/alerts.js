Page({
  data: {
    alerts: [
      { title: '武昌·徐家棚', desc: '有幼猫疑似受寒，建议携带保暖垫与食物' },
      { title: '汉口·后湖', desc: '夜间发现瘦弱流浪猫，求投喂与观察' },
      { title: '光谷·软件园', desc: '小橘猫尾部受伤，需要简单清理与保护' }
    ]
  },

  goMockMap() {
    wx.navigateTo({ url: '/pages/share/mock-map/mock-map' });
  },

  ack() {
    wx.showToast({ title: '已查看提示', icon: 'none' });
  }
});
