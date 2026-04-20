Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  properties: {
    visible: {
      type: Boolean,
      value: true
    },
    icon: {
      type: String,
      value: 'https://meetmeow.oss-cn-wuhan-lr.aliyuncs.com/source/agent.png'
    }
  },
  data: {
    navigating: false
  },
  methods: {
    handleTap() {
      if (this.data.navigating) {
        return
      }
      this.setData({ navigating: true })
      wx.navigateTo({
        url: '/pages/chat/chat',
        fail: () => {
          wx.showToast({ title: '无法打开助手', icon: 'none' })
        },
        complete: () => {
          this.setData({ navigating: false })
        }
      })
    }
  }
})
