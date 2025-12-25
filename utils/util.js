/**
 * 工具函数库
 */

// 格式化时间
const formatTime = date => {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = date.getHours()
  const minute = date.getMinutes()
  const second = date.getSeconds()

  return `${[year, month, day].map(formatNumber).join('/')} ${[hour, minute, second].map(formatNumber).join(':')}`
}

const formatNumber = n => {
  n = n.toString()
  return n[1] ? n : `0${n}`
}

// 格式化日期（简短版）
const formatDate = date => {
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${month}月${day}日`
}

// 将 ISO 时间转换为近似的“几分钟前/几小时前”
const formatRelativeTime = (isoString = '') => {
  if (!isoString) {
    return ''
  }
  const target = new Date(isoString).getTime()
  if (Number.isNaN(target)) {
    return ''
  }
  const diff = Date.now() - target
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) {
    return '刚刚'
  }
  if (diff < hour) {
    return `${Math.floor(diff / minute)} 分钟前`
  }
  if (diff < day) {
    return `${Math.floor(diff / hour)} 小时前`
  }
  return `${Math.floor(diff / day)} 天前`
}

// 统一处理定位文本，兼容字符串/对象
const formatLocationTag = (location) => {
  if (!location) {
    return ''
  }
  if (typeof location === 'string') {
    return location
  }
  if (typeof location === 'object') {
    const { city, district, latitude, longitude } = location
    if (city || district) {
      return [city, district].filter(Boolean).join('·')
    }
    if (latitude && longitude) {
      return `纬度${Number(latitude).toFixed(3)}, 经度${Number(longitude).toFixed(3)}`
    }
  }
  return ''
}

// 生成唯一ID
const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

// 本地存储封装 - 保存猫咪记录
const saveCatRecord = (record) => {
  try {
    let records = wx.getStorageSync('cat_records') || []
    record.id = generateId()
    record.created_at = new Date().toISOString()
    records.unshift(record) // 新记录放在前面
    wx.setStorageSync('cat_records', records)
    return record
  } catch (e) {
    console.error('保存猫咪记录失败：', e)
    return null
  }
}

// 本地存储封装 - 获取所有猫咪记录
const getCatRecords = () => {
  try {
    return wx.getStorageSync('cat_records') || []
  } catch (e) {
    console.error('获取猫咪记录失败：', e)
    return []
  }
}

// 本地存储封装 - 删除猫咪记录
const deleteCatRecord = (id) => {
  try {
    let records = wx.getStorageSync('cat_records') || []
    records = records.filter(r => r.id !== id)
    wx.setStorageSync('cat_records', records)
    return true
  } catch (e) {
    console.error('删除猫咪记录失败：', e)
    return false
  }
}

module.exports = {
  formatTime,
  formatDate,
  formatRelativeTime,
  formatLocationTag,
  generateId,
  saveCatRecord,
  getCatRecords,
  deleteCatRecord
}
