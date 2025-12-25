Component({
  data: {
    // selected 记录当前高亮的 tab 索引，便于自定义 tab 栏自行处理选中态
    selected: 0,
    // tabs 列表用于描述每个 tab 的跳转页面与展示文案
    tabs: [
      {
        path: 'pages/index/index', // 首页路径需与 app.json tabBar.list 对应，确保 switchTab 生效
        text: '遇喵',
        icon: 'https://meetmeow.oss-cn-wuhan-lr.aliyuncs.com/source/tabbar/tabbar_encounter_normal.png',
        activeIcon: 'https://meetmeow.oss-cn-wuhan-lr.aliyuncs.com/source/tabbar/tabbar_encounter_normal.png'
      },
      {
        path: 'pages/collects/collects',
        text: '图鉴',
        icon: 'https://meetmeow.oss-cn-wuhan-lr.aliyuncs.com/source/tabbar/tabbar_gallery_normal.png',
        activeIcon: 'https://meetmeow.oss-cn-wuhan-lr.aliyuncs.com/source/tabbar/tabbar_gallery_normal.png'
      },
      {
        path: 'pages/share/share',
        text: '内容广场',
        icon: 'https://meetmeow.oss-cn-wuhan-lr.aliyuncs.com/source/tabbar/tabbar_square_normal.png',
        activeIcon: 'https://meetmeow.oss-cn-wuhan-lr.aliyuncs.com/source/tabbar/tabbar_square_normal.png'
      }
    ]
  },

  methods: {
    // switchTab 用于在用户点击时触发跳转，并同步更新高亮状态
    switchTab(e) {
      const { path, index } = e.currentTarget.dataset || {};
      // 优先更新组件内部的选中态，保证点击后立即响应
      if (typeof index === 'number') {
        this.setData({ selected: index });
      }
      if (!path) {
        return;
      }
      const currentPages = getCurrentPages();
      const currentRoute = currentPages[currentPages.length - 1]?.route || '';
      // 若当前已经在目标页面则无需重复跳转
      if (currentRoute === path) {
        return;
      }
      wx.switchTab({ url: `/${path}` });
    },
  }
});
