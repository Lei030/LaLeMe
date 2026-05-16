const MAP_KEY = 'YOUR_MAP_KEY_HERE';
const STORAGE_KEY = 'treasure_spots';
const TOILET_CACHE_KEY = 'toilet_cache';
const TOILET_CACHE_TTL = 10 * 60 * 1000; // 缓存10分钟

// 厕所标记
const ICON_TOILET = '/images/toilet.png';
// 宝藏标记
const ICON_STAR = '/images/star.png';

Page({
  data: {
    statusBarHeight: 20,
    latitude: 39.9042,
    longitude: 116.4074,
    scale: 15,
    markers: [],
    polyline: [],
    showNavPanel: false,
    targetName: '',
    navMode: false,
    navInfo: { instruction: '准备出发', distance: 0, duration: 0 },
    markingMode: false,
    showRating: false,
    ratingTarget: '',
    currentRating: 0,
    ratingTargetId: null,
    searchKeyword: '',
    showSuggestions: false,
    searchSuggestions: []
  },

  userPos: null,
  targetPos: null,
  _treasureData: [],
  _toiletMarkers: [],
  _toiletRatings: {},
  _timer: null,
  _lastSearchTime: 0,
  _lastSearchLoc: null,

  onLoad() {
    const win = wx.getWindowInfo();
    this.setData({ statusBarHeight: win.statusBarHeight });

    this._treasureData = wx.getStorageSync(STORAGE_KEY) || [];
    this._toiletRatings = wx.getStorageSync('toilet_ratings') || {};
    this._toiletMarkers = [];
    this.rebuildMarkers();
    this.getUserLocation();
  },

  // ==================== 定位 ====================

  getUserLocation() {
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        this.userPos = { lat: res.latitude, lng: res.longitude };
        this.setData({ latitude: res.latitude, longitude: res.longitude });
        this.searchNearbyToilets(this.userPos);
      },
      fail: () => {
        wx.showToast({ title: '定位失败，请开启定位权限', icon: 'none', duration: 3000 });
      }
    });
  },

  goToCurrentLocation() {
    const mapCtx = wx.createMapContext('map', this);
    mapCtx.moveToLocation({
      success: () => setTimeout(() => this.setData({ scale: 17 }), 300)
    });
  },

  // ==================== 搜索厕所 ====================

  searchNearbyToilets(loc) {
    const location = loc || this.userPos;
    if (!location) return;

    // 检查缓存（相同位置附近500米内用缓存）
    const cache = wx.getStorageSync(TOILET_CACHE_KEY);
    if (cache && cache.data && cache.markers) {
      const d = this.calcDistance(location, { lat: cache.lat, lng: cache.lng });
      if (d < 500 && Date.now() - cache.time < TOILET_CACHE_TTL) {
        this._toiletMarkers = cache.markers;
        this.rebuildMarkers();
        return;
      }
    }

    wx.request({
      url: 'https://apis.map.qq.com/ws/place/v1/search',
      data: {
        keyword: '公共厕所',
        boundary: `nearby(${location.lat},${location.lng},3000)`,
        page_size: 20,
        orderby: '_distance',
        key: MAP_KEY
      },
      success: (res) => {
        if (res.data.status === 0) {
          this._toiletMarkers = (res.data.data || []).map(item => ({
            id: Number(item.id),
            latitude: item.location.lat,
            longitude: item.location.lng,
            title: item.title,
            iconPath: ICON_TOILET,
            width: 44, height: 44,
            callout: {
              content: item.title,
              color: '#333',
              fontSize: 12,
              bgColor: '#FFD100',
              padding: 8,
              borderRadius: 10,
              display: 'BY_CLICK',
              textAlign: 'center'
            }
          }));
          // 写入缓存
          wx.setStorageSync(TOILET_CACHE_KEY, {
            lat: location.lat,
            lng: location.lng,
            time: Date.now(),
            data: res.data.data,
            markers: this._toiletMarkers
          });
          this.rebuildMarkers();
        } else if (res.data.status === 121) {
          // 配额耗尽，尝试用 suggestion API 兜底
          console.log('配额耗尽，使用备选方案');
          this.fallbackSearchToilets(location);
        }
      },
      fail: () => {
        console.log('厕所搜索请求失败');
      }
    });
  },

  // 备用搜索：使用 suggestion API（配额独立）
  fallbackSearchToilets(loc) {
    wx.request({
      url: 'https://apis.map.qq.com/ws/place/v1/suggestion',
      data: {
        keyword: '公共厕所',
        location: `${loc.lat},${loc.lng}`,
        region_fix: 1,
        key: MAP_KEY
      },
      success: (res) => {
        if (res.data.status === 0 && res.data.data) {
          // suggestion 返回全国范围，过滤出附近的
          const nearby = res.data.data.filter(item => {
            if (!item.location) return false;
            const d = this.calcDistance(loc, { lat: item.location.lat, lng: item.location.lng });
            return d < 5000; // 5公里内
          });
          this._toiletMarkers = nearby.map(item => ({
            id: Number(item.id),
            latitude: item.location.lat,
            longitude: item.location.lng,
            title: item.title,
            iconPath: ICON_TOILET,
            width: 44, height: 44,
            callout: {
              content: item.title,
              color: '#333',
              fontSize: 12,
              bgColor: '#FFD100',
              padding: 8,
              borderRadius: 10,
              display: 'BY_CLICK',
              textAlign: 'center'
            }
          }));
          this.rebuildMarkers();
        }
      }
    });
  },

  // 备用地点搜索
  // ==================== 标记管理 ====================

  rebuildMarkers() {
    const markers = [];

    // 宝藏点位
    this._treasureData.forEach(t => {
      const isStar = (t.icon || 'star') === 'star';
      const iconSize = isStar ? 36 : 44;
      markers.push({
        id: t.id,
        latitude: t.lat,
        longitude: t.lng,
        title: t.name,
        iconPath: isStar ? ICON_STAR : ICON_TOILET,
        width: iconSize, height: iconSize,
        callout: {
          content: (isStar ? '⭐ ' : '🚽 ') + t.name,
          color: '#fff',
          fontSize: 12,
          bgColor: isStar ? '#FFA000' : '#FFD100',
          padding: 6,
          borderRadius: 6,
          display: 'BY_CLICK',
          textAlign: 'center'
        }
      });
    });

    // 厕所标记（过滤掉与宝藏点位重叠的）
    this._toiletMarkers.forEach(m => {
      const dup = markers.some(tm => tm.latitude === m.latitude && tm.longitude === m.longitude);
      if (!dup) markers.push(m);
    });

    this.setData({ markers });
  },

  // ==================== 标记宝藏点位 ====================

  toggleMarkingMode() {
    if (this.data.navMode) return;
    this.setData({
      markingMode: !this.data.markingMode,
      showNavPanel: false
    });
  },

  confirmTreasure() {
    const mapCtx = wx.createMapContext('map', this);
    mapCtx.getCenterLocation({
      success: (res) => {
        this.addTreasureMarker(res.latitude, res.longitude, '');
        this.setData({ markingMode: false });
      },
      fail: () => {
        wx.showToast({ title: '获取位置失败', icon: 'none' });
      }
    });
  },

  addTreasureMarker(lat, lng, name) {
    const newSpot = {
      id: Date.now(),
      lat, lng,
      name: name || '宝藏点位 ' + (this._treasureData.length + 1),
      icon: 'star'
    };
    this._treasureData.push(newSpot);
    wx.setStorageSync(STORAGE_KEY, this._treasureData);
    this.rebuildMarkers();
    wx.showToast({ title: '已标记：' + newSpot.name, icon: 'success' });
  },

  deleteTreasureMarker(id) {
    this._treasureData = this._treasureData.filter(t => t.id !== id);
    wx.setStorageSync(STORAGE_KEY, this._treasureData);
    this.rebuildMarkers();
    wx.showToast({ title: '已删除', icon: 'success' });
  },

  renameTreasureMarker(id) {
    const item = this._treasureData.find(t => t.id === id);
    if (!item) return;
    wx.showModal({
      title: '重命名',
      editable: true,
      placeholderText: '输入新名称',
      content: item.name,
      success: (modal) => {
        if (modal.confirm && modal.content && modal.content.trim()) {
          item.name = modal.content.trim();
          wx.setStorageSync(STORAGE_KEY, this._treasureData);
          this.rebuildMarkers();
          wx.showToast({ title: '已重命名', icon: 'success' });
        }
      }
    });
  },

  changeTreasureIcon(id) {
    const item = this._treasureData.find(t => t.id === id);
    if (!item) return;
    item.icon = (item.icon || 'star') === 'star' ? 'toilet' : 'star';
    wx.setStorageSync(STORAGE_KEY, this._treasureData);
    this.rebuildMarkers();
    wx.showToast({ title: '图标已切换为 ' + (item.icon === 'star' ? '⭐' : '🚽'), icon: 'success' });
  },

  saveAsTreasure(marker) {
    this._toiletMarkers = this._toiletMarkers.filter(
      m => m.latitude !== marker.latitude || m.longitude !== marker.longitude
    );
    this.addTreasureMarker(marker.latitude, marker.longitude, '');
    wx.showToast({ title: '已收藏为宝藏点位', icon: 'success' });
  },

  confirmDeleteTreasure(id) {
    wx.showModal({
      title: '确认删除',
      content: '确定删除此宝藏点位吗？',
      success: (res) => { if (res.confirm) this.deleteTreasureMarker(id); }
    });
  },

  clearAllTreasureMarkers() {
    wx.showModal({
      title: '确认清除',
      content: '确定清除所有宝藏点位吗？',
      success: (res) => {
        if (res.confirm) {
          this._treasureData = [];
          wx.setStorageSync(STORAGE_KEY, this._treasureData);
          this.rebuildMarkers();
          wx.showToast({ title: '已清除所有宝藏点位' });
        }
      }
    });
  },

  // ==================== 点击标记 ====================

  onMarkerTap(e) {
    if (this.data.navMode) return;

    const markerId = e.detail.markerId;
    const marker = this.data.markers.find(m => m.id === markerId);
    if (!marker) return;

    const isTreasure = this._treasureData.some(t => t.id === markerId);
    const ratingData = this._toiletRatings[markerId];

    let itemList = ['🚀 开始导航'];
    itemList.push(ratingData ? `⭐ 评价 (${ratingData.rating}分)` : '⭐ 拉完了');
    if (isTreasure) {
      itemList.push('✏️ 重命名', '🔄 更换图标', '🗑️ 删除');
    } else {
      itemList.push('📍 标记一处地点');
    }

    wx.showActionSheet({
      itemList,
      alertText: marker.title,
      success: (res) => {
        const idx = res.tapIndex;
        if (idx === 0) {
          this.prepareNavigation(marker);
        } else if (idx === 1) {
          this.openRating(marker);
        } else if (idx === 2) {
          if (isTreasure) {
            this.renameTreasureMarker(markerId);
          } else {
            this.saveAsTreasure(marker);
          }
        } else if (idx === 3) {
          if (isTreasure) {
            this.changeTreasureIcon(markerId);
          } else {
            this.confirmDeleteTreasure(markerId);
          }
        } else if (idx === 4) {
          this.confirmDeleteTreasure(markerId);
        }
      }
    });
  },

  prepareNavigation(marker) {
    this.targetPos = { lat: marker.latitude, lng: marker.longitude };
    this.setData({
      showNavPanel: true,
      targetName: marker.title,
      markingMode: false
    });
  },

  // ==================== 搜索地点 ====================

  onSearchInput(e) {
    const keyword = e.detail.value;
    this.setData({ searchKeyword: keyword });
    if (!keyword) return this.setData({ showSuggestions: false });

    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      wx.request({
        url: 'https://apis.map.qq.com/ws/place/v1/suggestion',
        data: {
          keyword,
          location: `${this.userPos?.lat || 39.9},${this.userPos?.lng || 116.4}`,
          key: MAP_KEY
        },
        success: (res) => {
          if (res.data.status === 0 && res.data.data) {
            this.setData({
              searchSuggestions: res.data.data.slice(0, 8),
              showSuggestions: true
            });
          }
        }
      });
    }, 300);
  },

  onSelectSuggestion(e) {
    const ds = e.currentTarget.dataset;
    const lat = parseFloat(ds.lat);
    const lng = parseFloat(ds.lng);
    this.setData({
      latitude: lat,
      longitude: lng,
      searchKeyword: ds.title,
      showSuggestions: false,
      scale: 16
    });
    this.searchNearbyToilets({ lat, lng });
  },

  onSearchConfirm(e) {
    const keyword = e.detail.value.trim();
    if (!keyword) return;
    this.setData({ showSuggestions: false });

    wx.request({
      url: 'https://apis.map.qq.com/ws/place/v1/search',
      data: {
        keyword,
        boundary: `nearby(${this.userPos?.lat || 39.9},${this.userPos?.lng || 116.4},5000)`,
        key: MAP_KEY
      },
      success: (res) => {
        if (res.data.status === 0 && res.data.data?.length > 0) {
          const loc = res.data.data[0].location;
          this.setData({
            searchKeyword: res.data.data[0].title,
            latitude: loc.lat,
            longitude: loc.lng,
            scale: 16
          });
          this.searchNearbyToilets({ lat: loc.lat, lng: loc.lng });
          wx.showToast({ title: '已定位', icon: 'none' });
        } else {
          wx.showToast({ title: '没找到该地点', icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络请求失败', icon: 'none' });
      }
    });
  },

  clearSearch() {
    this.setData({ searchKeyword: '', showSuggestions: false });
  },

  onSearchFocus() {
    // 搜索框聚焦时不做额外操作
  },

  closeSuggestions() {
    this.setData({ showSuggestions: false });
  },

  // ==================== 导航 ====================

  onStartNav() {
    if (!this.targetPos) return;
    wx.openLocation({
      latitude: this.targetPos.lat,
      longitude: this.targetPos.lng,
      name: this.data.targetName,
      scale: 18
    });
  },

  enterNavMode(route) {
    const points = this.decodePolyline(route.polyline);
    const steps = route.steps || [];

    this.setData({
      polyline: [{
        points,
        color: '#1a73e8',
        width: 6,
        arrowLine: true
      }],
      navMode: true,
      showNavPanel: false,
      navInfo: {
        instruction: steps[0] ? steps[0].instruction : '前往目的地',
        distance: route.distance,
        duration: Math.ceil(route.duration / 60)
      }
    });

    this.fitRoute(points);
    this.startNavTracking();
  },

  decodePolyline(polyline) {
    if (!polyline || polyline.length < 2) return [];
    const points = [{ latitude: polyline[0], longitude: polyline[1] }];
    let lat = polyline[0], lng = polyline[1];
    for (let i = 2; i < polyline.length - 1; i += 2) {
      lat += polyline[i] / 1000000;
      lng += polyline[i + 1] / 1000000;
      points.push({ latitude: lat, longitude: lng });
    }
    return points;
  },

  fitRoute(points) {
    const mapCtx = wx.createMapContext('map', this);
    mapCtx.includePoints({
      points: [
        { latitude: this.userPos.lat, longitude: this.userPos.lng },
        { latitude: this.targetPos.lat, longitude: this.targetPos.lng }
      ],
      padding: [80, 50, 200, 50]
    });
  },

  startNavTracking() {
    this._onLocationChange = (res) => {
      this.userPos = { lat: res.latitude, lng: res.longitude };
      this.setData({ latitude: res.latitude, longitude: res.longitude });

      if (this.targetPos) {
        const dist = this.calcDistance(this.userPos, this.targetPos);
        this.setData({ 'navInfo.distance': Math.round(dist) });
      }
    };

    wx.startLocationUpdate({
      success: () => { wx.onLocationChange(this._onLocationChange); },
      fail: () => {
        this._pollTimer = setInterval(() => {
          wx.getLocation({
            type: 'gcj02',
            success: (res) => { this._onLocationChange(res); }
          });
        }, 5000);
      }
    });
  },

  calcDistance(p1, p2) {
    const R = 6371000;
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLng = (p2.lng - p1.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180)
            * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  exitNav() {
    if (this._onLocationChange) {
      wx.offLocationChange(this._onLocationChange);
      this._onLocationChange = null;
    }
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    try { wx.stopLocationUpdate(); } catch (e) {}
    this.setData({ navMode: false, polyline: [] });
  },

  closeNav() { this.setData({ showNavPanel: false }); },

  // ==================== 评分 ====================

  openRating(marker) {
    const prev = this._toiletRatings[marker.id];
    this.setData({
      showRating: true,
      ratingTarget: marker.title,
      ratingTargetId: marker.id,
      currentRating: prev ? prev.rating : 0
    });
  },

  setRating(e) {
    this.setData({ currentRating: e.currentTarget.dataset.val });
  },

  confirmRating() {
    if (this.data.currentRating === 0) {
      wx.showToast({ title: '请点击星星打分', icon: 'none' });
      return;
    }
    this._toiletRatings[this.data.ratingTargetId] = {
      rating: this.data.currentRating,
      title: this.data.ratingTarget
    };
    wx.setStorageSync('toilet_ratings', this._toiletRatings);
    this.setData({ showRating: false });
    wx.showToast({ title: '已评价 ' + this.data.currentRating + '⭐', icon: 'success' });
  },

  closeRating() { this.setData({ showRating: false }); },

  stopBubble() {},

  // ==================== 地图事件 ====================

  onRegionChange(e) {
    if (e.type === 'end' && (e.causedBy === 'drag' || e.causedBy === 'scale')) {
      const now = Date.now();
      if (now - this._lastSearchTime < 3000) return; // 3秒内不重复搜索
      this._lastSearchTime = now;

      const mapCtx = wx.createMapContext('map', this);
      mapCtx.getCenterLocation({
        success: (res) => {
          // 如果位置变化很小，不重复搜索
          if (this._lastSearchLoc) {
            const d = this.calcDistance(this._lastSearchLoc, { lat: res.latitude, lng: res.longitude });
            if (d < 200) return;
          }
          this._lastSearchLoc = { lat: res.latitude, lng: res.longitude };
          this.searchNearbyToilets({ lat: res.latitude, lng: res.longitude });
        }
      });
    }
  }
});
