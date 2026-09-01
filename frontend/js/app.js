(function () {
    'use strict';

    var API = 'http://localhost:8080';

    // 用户名，登录后设置，用于隔离 localStorage
    var currentUser = localStorage.getItem('chat_user') || '';

    // 带用户名前缀的 key，避免串号
    function userKey(key) {
        return currentUser ? currentUser + '_' + key : key;
    }

    var state = {
        token: localStorage.getItem('chat_token'),
        page: 1,
        pageSize: 20,
        keyword: '',
        type: '',
        category: '',
        totalPages: 1,
        categories: [],
        currentView: 'home',
        viewMode: localStorage.getItem(userKey('viewMode')) || 'grid',
        galleryMode: localStorage.getItem(userKey('galleryMode')) || 'grid', // grid, masonry, wall3d, gallery
        currentVideoId: null,
        feedDefaultMuted: localStorage.getItem(userKey('feedMuted')) !== 'false'
    };

    // 每个页面独立的过滤状态和页码（首页和点赞页互不干扰，同页面内所有展示模式共享）
    var filterState = {
        'home': { type: '', category: '', keyword: '', page: 1 },
        'likes': { type: '', category: '', keyword: '', page: 1 }
    };

    // === API ===
    var isRefreshing = false;

    function api(method, path, body) {
        var headers = { 'Content-Type': 'application/json' };
        if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
        return fetch(API + path, {
            method: method,
            headers: headers,
            body: body ? JSON.stringify(body) : undefined
        }).then(function (r) {
            if (r.status === 401) {
                // 只有在非刷新状态下才自动登出
                if (!isRefreshing) {
                    toast('登录已过期，请重新登录');
                    doLogout();
                }
                throw new Error('unauthorized');
            }
            return r.json();
        }).catch(function (err) {
            if (err.message === 'unauthorized') throw err;
            // 网络错误不自动登出
            if (err.message === 'Failed to fetch' || err.message === 'NetworkError') {
                toast('网络连接失败，请检查服务器');
                throw err;
            }
            throw err;
        });
    }

    // === Toast ===
    function toast(text) {
        var t = document.createElement('div');
        t.className = 'toast';
        t.textContent = text;
        document.body.appendChild(t);
        setTimeout(function () { t.classList.add('show'); }, 10);
        setTimeout(function () {
            t.classList.remove('show');
            setTimeout(function () { t.remove(); }, 300);
        }, 2500);
    }

    // === Auth ===
    function doLogin() {
        var u = document.getElementById('loginUser').value;
        var p = document.getElementById('loginPass').value;
        var err = document.getElementById('loginError');
        api('POST', '/api/login', { username: u, password: p }).then(function (r) {
            if (r.code === 200) {
                state.token = r.data.token;
                currentUser = r.data.user ? r.data.user.username : u;
                localStorage.setItem('chat_token', state.token);
                localStorage.setItem('chat_user', currentUser);
                showMain();
            } else {
                err.textContent = r.msg;
                err.style.display = 'block';
            }
        }).catch(function () {
            err.textContent = '网络错误';
            err.style.display = 'block';
        });
    }

    function doLogout() {
        state.token = null;
        currentUser = '';
        localStorage.removeItem('chat_token');
        localStorage.removeItem('chat_user');
        document.getElementById('loginPage').style.display = '';
        document.getElementById('mainPage').style.display = 'none';
    }

    function showMain() {
        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('mainPage').style.display = '';
        // 恢复上次的页面状态
        var savedView = localStorage.getItem(userKey('currentView')) || 'home';
        state.currentView = savedView;
        // 恢复过滤状态
        if (savedView === 'home' || savedView === 'likes') {
            var savedFilter = filterState[savedView];
            if (savedFilter) {
                state.type = savedFilter.type || '';
                state.category = savedFilter.category || '';
                state.keyword = savedFilter.keyword || '';
                state.page = savedFilter.page || 1;
            }
        }
        // 恢复轮播模式的页码
        if (state.viewMode === 'carousel') {
            var savedCarouselPage = parseInt(localStorage.getItem(userKey('carouselPage')));
            if (savedCarouselPage > 1) {
                state.page = savedCarouselPage;
            }
        }
        // 恢复视图显示/隐藏（如果正在恢复详情页则不覆盖）
        var restoringDetail = !!localStorage.getItem(userKey('detailVideoId'));
        if (!restoringDetail) {
            var allViews = ['listView', 'pendingView', 'detailView', 'tagMgrView', 'hotTagsView', 'folderView'];
            allViews.forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.style.setProperty('display', 'none', 'important');
            });
            var viewMap = { pending: 'pendingView', tagMgr: 'tagMgrView', hotTags: 'hotTagsView', folders: 'folderView' };
            var targetId = viewMap[savedView] || 'listView';
            var targetEl = document.getElementById(targetId);
            if (targetEl) targetEl.style.removeProperty('display');
        }
        updateNav();
        updateViewMode();

        // 从后端加载用户设置（弹幕状态等）
        loadUserSettings();

        // 验证token有效性
        isRefreshing = true;
        api('GET', '/api/categories').then(function (r) {
            if (r.code === 200) {
                state.categories = r.data || [];
                renderCategoryFilter();
            }
            isRefreshing = false;
            // 根据保存的页面加载对应数据
            if (savedView === 'likes') {
                loadLikedVideos();
            } else if (savedView === 'pending') {
                loadPendingTags();
            } else if (savedView === 'hotTags') {
                loadHotTags();
            } else if (savedView === 'tagMgr') {
                loadTagManagerList();
            } else if (savedView === 'folders') {
                loadFolders();
            } else {
                loadVideos();
            }
            loadFolders();
            loadPendingTags();
        }).catch(function () {
            isRefreshing = false;
        });
    }

    // === Navigation ===
    var previousView = 'home';

    function switchView(view) {
        var isSameTab = (view === previousView);

        // 保存当前页面的过滤状态和页码
        if (previousView === 'home' || previousView === 'likes') {
            filterState[previousView] = { type: state.type, category: state.category, keyword: state.keyword, page: state.page };
        }

        previousView = view;
        state.currentView = view;
        localStorage.setItem(userKey('currentView'), view);

        // 恢复目标页面的过滤状态和页码
        if (view === 'home' || view === 'likes') {
            var saved = filterState[view];
            state.type = saved.type;
            state.category = saved.category;
            state.keyword = saved.keyword;
            state.page = saved.page || 1;
            document.getElementById('searchInput').value = state.keyword;
            var rightInput = document.getElementById('searchInputRight');
            if (rightInput) rightInput.value = state.keyword;
            renderCategoryFilter();
        } else {
            state.page = 1;
        }

        updateNav();
        closeMenu();
        var scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;

        // 先停止详情页视频和弹幕
        var detailVid = document.getElementById('detailVideo');
        if (detailVid && !document.pictureInPictureElement) {
            detailVid.pause();
            detailVid.src = '';
        }
        stopDanmakuLoop('danmakuLayerDetail');
        state.currentVideoId = null;
        localStorage.removeItem(userKey('detailVideoId'));

        // 显示/隐藏主视图区域（全部隐藏后再显示目标）
        var allViews = ['listView', 'pendingView', 'detailView', 'tagMgrView', 'hotTagsView', 'folderView'];
        allViews.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.style.setProperty('display', 'none', 'important');
        });
        var viewMap = { pending: 'pendingView', tagMgr: 'tagMgrView', hotTags: 'hotTagsView', folders: 'folderView' };
        var targetId = viewMap[view] || 'listView';
        var targetEl = document.getElementById(targetId);
        if (targetEl) targetEl.style.removeProperty('display');

        if (isSameTab) {
            // 点击当前选项卡：滚动到顶部并刷新
            if (scrollTop > 50) {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        }

        if (view === 'home') {
            loadVideos();
        } else if (view === 'likes') {
            loadLikedVideos();
        } else if (view === 'unclassified') {
            loadUnclassifiedVideos();
        } else if (view === 'pending') {
            loadPendingTags();
        } else if (view === 'tagMgr') {
            loadTagManagerList();
        } else if (view === 'hotTags') {
            loadHotTags();
        } else if (view === 'folders') {
            loadFolders();
        }
    }

    function updateNav() {
        document.querySelectorAll('.nav-btn').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.view === state.currentView);
        });
        document.querySelectorAll('.sidebar-item').forEach(function (item) {
            item.classList.toggle('active', item.dataset.view === state.currentView);
        });
        var isHome = state.currentView === 'home';
        var isLikes = state.currentView === 'likes';
        var isSubPage = state.currentView === 'pending' || state.currentView === 'tagMgr' || state.currentView === 'hotTags' || state.currentView === 'folders';
        var detailView = document.getElementById('detailView');
        var isDetailOpen = detailView && detailView.style.display !== 'none';
        var galleryDropdown = document.querySelector('.gallery-mode-dropdown');
        if (galleryDropdown) galleryDropdown.style.display = (isSubPage || isDetailOpen) ? 'none' : '';

        // 声音开关: 只在列表模式的首页/点赞页且非详情页时显示
        var isFeedMode2 = state.viewMode === 'feed';
        var showMuteBtn = isFeedMode2 && (isHome || isLikes) && !isDetailOpen;
        var feedMuteBtn = document.getElementById('feedMuteToggle');
        if (feedMuteBtn) feedMuteBtn.style.display = showMuteBtn ? '' : 'none';

        // 搜索框: 首页/点赞页/文件夹页显示, 其他页面隐藏
        var searchBar = document.getElementById('searchBar');
        var showSearchBar = !isDetailOpen && !isSubPage;
        if (searchBar) searchBar.style.display = showSearchBar ? 'flex' : 'none';
        var searchPlaceholder = '搜索名字或#标签';
        var searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.placeholder = searchPlaceholder;
        var searchInputRight = document.getElementById('searchInputRight');
        if (searchInputRight) searchInputRight.placeholder = searchPlaceholder;
        var detailSearchInput = document.getElementById('detailSearchInput');
        if (detailSearchInput) detailSearchInput.placeholder = searchPlaceholder;
        // 分类筛选: 只在图标模式的首页和点赞页且非详情页时显示
        var isFeedMode = state.viewMode === 'feed';
        var categoryFilter = document.getElementById('categoryFilter');
        if (categoryFilter) {
            if ((isHome || isLikes) && !isDetailOpen && !isFeedMode) categoryFilter.classList.add('show-filter');
            else categoryFilter.classList.remove('show-filter');
        }
        // 右侧栏分类筛选: 只在列表模式的首页和点赞页且非详情页时显示
        var categoryFilterRight = document.getElementById('categoryFilterRight');
        if (categoryFilterRight) {
            if ((isHome || isLikes) && !isDetailOpen && isFeedMode) categoryFilterRight.style.display = '';
            else categoryFilterRight.style.display = 'none';
        }

        // 右侧栏: 子页面隐藏, 但列表模式详情页要显示(用于放相关标签)
        var rightSidebar = document.getElementById('rightSidebar');
        if (rightSidebar) {
            if (isSubPage && !isDetailOpen) {
                rightSidebar.style.display = 'none';
            } else {
                rightSidebar.style.display = '';
                // 详情页: 隐藏分类筛选, 显示标签; 非详情页: 反之
                var rightContent = document.querySelector('.right-sidebar-content');
                if (rightContent) rightContent.style.display = isDetailOpen ? 'none' : '';
                var rightTags = document.getElementById('rightSidebarTags');
                if (rightTags && !isDetailOpen) rightTags.style.display = 'none';
            }
        }
    }

    // === Menu ===
    function toggleMenu() {}

    function closeMenu() {}


    // === View Mode ===
    var _galleryOutsideHandler = null;
    function toggleGalleryModeMenu() {
        var menu = document.getElementById('galleryModeMenu');
        if (menu.classList.contains('show')) {
            menu.classList.remove('show');
            _removeGalleryOutside();
        } else {
            menu.classList.add('show');
            _galleryOutsideHandler = function (e) {
                if (!e.target.closest('.gallery-mode-dropdown')) {
                    menu.classList.remove('show');
                    _removeGalleryOutside();
                }
            };
            setTimeout(function () { document.addEventListener('click', _galleryOutsideHandler); }, 0);
        }
    }
    function _removeGalleryOutside() {
        if (_galleryOutsideHandler) {
            document.removeEventListener('click', _galleryOutsideHandler);
            _galleryOutsideHandler = null;
        }
    }

    function switchMode(mode) {
        state.viewMode = mode;
        localStorage.setItem(userKey('viewMode'), mode);
        // 更新下拉菜单状态
        var menu = document.getElementById('galleryModeMenu');
        if (menu) { menu.classList.remove('show'); _removeGalleryOutside(); }
        var btn = document.getElementById('galleryModeBtn');
        if (btn) {
            var activeItem = menu.querySelector('[data-mode="' + mode + '"]');
            if (activeItem) {
                btn.innerHTML = activeItem.querySelector('svg').outerHTML;
            }
        }
        menu.querySelectorAll('.gallery-mode-item').forEach(function (item) {
            item.classList.toggle('active', item.dataset.mode === mode);
        });
        updateViewMode();
        if (state.currentView === 'likes') loadLikedVideos();
        else loadVideos();
    }

    function updateViewMode() {
        var grid = document.getElementById('videoGrid');
        var grid = document.getElementById('videoGrid');
        grid.classList.toggle('feed-mode', state.viewMode === 'feed');

        // 设置布局模式
        var appLayout = document.querySelector('.app-layout');
        if (appLayout) appLayout.setAttribute('data-mode', state.viewMode);

        // 更新静音开关状态
        updateMuteToggleUI();

        // 重新渲染分类筛选到正确位置
        renderCategoryFilter();

        // 更新导航状态(包括分类筛选显示/隐藏)
        updateNav();

        // 初始化滚动自动播放
        if (state.viewMode === 'feed') {
            initFeedScrollObserver();
        } else {
            destroyFeedScrollObserver();
            destroyFeedImageObserver();
        }
    }

    // === Feed Scroll Auto-play ===
    var feedScrollObserver = null;
    var currentFeedPlaying = null;
    var userPaused = new Set();

    function initFeedScrollObserver() {
        if (feedScrollObserver) return;
        feedScrollObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                var card = entry.target;
                var wrap = card.querySelector('.feed-video-wrap');
                if (!wrap) return;
                var video = wrap.querySelector('video');
                if (!video) return;
                var videoId = card.dataset.videoId;

                if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
                    if (userPaused.has(videoId)) return;
                    playFeedVideo(video, wrap, card, videoId);
                } else {
                    if (video === currentFeedPlaying) {
                        var isInFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
                        var isInPiP = document.pictureInPictureElement === video;
                        if (!isInFullscreen && !isInPiP) {
                            video.pause();
                            updatePlayBtnState(video, false);
                            currentFeedPlaying = null;
                        }
                    }
                }
            });
        }, { threshold: [0, 0.5, 1] });
    }

    function playFeedVideo(video, wrap, card, videoId) {
        if (!video.src && video.dataset.src) {
            video.src = video.dataset.src;
        }
        video.muted = state.feedDefaultMuted;
        video.play().catch(function () {});

        if (currentFeedPlaying && currentFeedPlaying !== video) {
            var isCurrentInPiP = document.pictureInPictureElement === currentFeedPlaying;
            if (!isCurrentInPiP) {
                currentFeedPlaying.pause();
                updatePlayBtnState(currentFeedPlaying, false);
            }
        }

        currentFeedPlaying = video;
        updatePlayBtnState(video, true);
        trackViewCount(video, videoId);
        trackFeedTime(video, wrap);
    }

    function destroyFeedScrollObserver() {
        if (feedScrollObserver) {
            feedScrollObserver.disconnect();
            feedScrollObserver = null;
        }
        if (currentFeedPlaying) {
            currentFeedPlaying.pause();
            currentFeedPlaying = null;
        }
        userPaused.clear();
    }

    function observeFeedCards() {
        if (!feedScrollObserver) return;
        document.querySelectorAll('.feed-card').forEach(function (card) {
            feedScrollObserver.observe(card);
            initFeedCardHover(card);
        });
        // 注意：playVisibleFeedVideo 和 renderGrid 统一调用
    }

    // 检查并播放当前可见的视频
    function playVisibleFeedVideo() {
        var cards = document.querySelectorAll('.feed-card');
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var rect = card.getBoundingClientRect();
            var windowHeight = window.innerHeight;

            // 检查卡片是否在视口中
            if (rect.top < windowHeight && rect.bottom > 0) {
                var videoId = card.dataset.videoId;
                if (userPaused.has(videoId)) continue;

                var wrap = card.querySelector('.feed-video-wrap');
                if (!wrap) continue;
                var video = wrap.querySelector('video');
                if (!video) continue;

                var src = video.dataset.src || video.src;
                if (!src) continue;

                // 设置源并播放
                if (!video.src || video.src !== src) {
                    video.src = src;
                }
                video.muted = state.feedDefaultMuted;

                // 直接尝试播放
                var playPromise = video.play();
                if (playPromise) {
                    playPromise.catch(function () {
                        // 如果播放失败，等待 canplay 事件
                        video.addEventListener('canplay', function handler() {
                            video.play().catch(function () {});
                            video.removeEventListener('canplay', handler);
                        }, { once: true });
                    });
                }

                if (currentFeedPlaying && currentFeedPlaying !== video) {
                    var isCurrentInPiP = document.pictureInPictureElement === currentFeedPlaying;
                    if (!isCurrentInPiP) {
                        currentFeedPlaying.pause();
                        updatePlayBtnState(currentFeedPlaying, false);
                    }
                }

                currentFeedPlaying = video;
                updatePlayBtnState(video, true);
                trackViewCount(video, videoId);
                trackFeedTime(video, wrap);
                return true; // 成功触发播放
            }
        }
        return false; // 没有找到可见的视频
    }

    // 列表卡片中间按钮悬停逻辑
    function initFeedCardHover(card) {
        var wrap = card.querySelector('.feed-video-wrap');
        if (!wrap) return;
        var centerBtn = wrap.querySelector('.feed-center-play');
        if (!centerBtn) return;
        var hideTimer = null;

        wrap.addEventListener('mousemove', function (e) {
            var rect = wrap.getBoundingClientRect();
            var centerX = rect.left + rect.width / 2;
            var centerY = rect.top + rect.height / 2;
            var dist = Math.sqrt(Math.pow(e.clientX - centerX, 2) + Math.pow(e.clientY - centerY, 2));
            if (dist < 150) {
                centerBtn.classList.add('visible');
            } else {
                centerBtn.classList.remove('visible');
            }
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(function () { centerBtn.classList.remove('visible'); }, 2000);
        });

        wrap.addEventListener('mouseleave', function () {
            centerBtn.classList.remove('visible');
            if (hideTimer) clearTimeout(hideTimer);
        });
    }

    // 更新播放/暂停按钮状态（同步所有按钮）
    function updatePlayBtnState(video, playing) {
        var wrap = video.closest('.feed-video-wrap');
        if (!wrap) return;
        // 更新所有播放/暂停图标（中间大按钮 + 底部小按钮）
        wrap.querySelectorAll('.feed-icon-play').forEach(function (el) {
            el.style.display = playing ? 'none' : '';
        });
        wrap.querySelectorAll('.feed-icon-pause').forEach(function (el) {
            el.style.display = playing ? '' : 'none';
        });
    }

    // 手动切换播放/暂停
    function feedTogglePlay(btn) {
        var wrap = btn.closest('.feed-video-wrap');
        var video = wrap.querySelector('video');
        if (!video) return;
        var videoId = wrap.closest('.feed-card').dataset.videoId;

        if (video.paused) {
            // 手动播放
            if (!video.src) video.src = video.dataset.src;
            video.muted = state.feedDefaultMuted;
            video.play().catch(function () {});
            userPaused.delete(videoId);
            if (currentFeedPlaying && currentFeedPlaying !== video) {
                currentFeedPlaying.pause();
                updatePlayBtnState(currentFeedPlaying, false);
            }
            currentFeedPlaying = video;
            updatePlayBtnState(video, true);
            trackViewCount(video, videoId);
            trackFeedTime(video, wrap);
        } else {
            // 手动暂停
            video.pause();
            userPaused.add(videoId);
            updatePlayBtnState(video, false);
        }
    }

    // === Feed Default Mute Toggle ===
    function toggleFeedDefaultMute() {
        state.feedDefaultMuted = !state.feedDefaultMuted;
        localStorage.setItem(userKey('feedMuted'), state.feedDefaultMuted ? 'true' : 'false');
        updateMuteToggleUI();
        // 更新所有列表卡片的静音图标
        syncFeedCardMuteIcons();
        // 更新当前播放的视频
        if (currentFeedPlaying) {
            currentFeedPlaying.muted = state.feedDefaultMuted;
        }
    }

    function syncFeedCardMuteIcons() {
        document.querySelectorAll('.feed-video-wrap').forEach(function (wrap) {
            var video = wrap.querySelector('video');
            if (video) video.muted = state.feedDefaultMuted;
            var unmuteIcon = wrap.querySelector('.feed-icon-unmute');
            var muteIcon = wrap.querySelector('.feed-icon-mute');
            if (unmuteIcon) unmuteIcon.style.display = state.feedDefaultMuted ? 'none' : '';
            if (muteIcon) muteIcon.style.display = state.feedDefaultMuted ? '' : 'none';
        });
    }

    function updateMuteToggleUI() {
        var toggle = document.getElementById('feedMuteToggle');
        if (!toggle) return;
        var iconOn = toggle.querySelector('.feed-mute-icon-on');
        var iconOff = toggle.querySelector('.feed-mute-icon-off');
        if (iconOn) iconOn.style.display = state.feedDefaultMuted ? 'none' : '';
        if (iconOff) iconOff.style.display = state.feedDefaultMuted ? '' : 'none';
    }

    // === Categories ===
    function loadCategories() {
        api('GET', '/api/categories').then(function (r) {
            if (r.code === 200) {
                state.categories = r.data || [];
                renderCategoryFilter();
            }
        });
    }

    function renderCategoryFilter() {
        var html = '<button class="filter-btn' + (!state.type && !state.category ? ' active' : '') + '" onclick="window._filter(\'\',\'\')">全部</button>';
        html += '<button class="filter-btn' + (state.type === 'video' ? ' active' : '') + '" onclick="window._filter(\'video\',\'\')">视频</button>';
        html += '<button class="filter-btn' + (state.type === 'image' ? ' active' : '') + '" onclick="window._filter(\'image\',\'\')">图片</button>';
        state.categories.forEach(function (cat) {
            html += '<button class="filter-btn' + (state.category === cat ? ' active' : '') + '" onclick="window._filter(\'\',\'' + esc(cat) + '\')">' + esc(cat) + '</button>';
        });
        var container = document.getElementById('categoryFilter');
        if (container) container.innerHTML = html;
        var containerRight = document.getElementById('categoryFilterRight');
        if (containerRight) containerRight.innerHTML = html;
    }

    function filter(type, category) {
        state.type = type;
        state.category = category;
        state.page = 1;
        // 保存当前页面的过滤状态
        if (state.currentView === 'home' || state.currentView === 'likes') {
            filterState[state.currentView] = { type: state.type, category: state.category, keyword: state.keyword, page: state.page };
        }
        renderCategoryFilter();
        if (state.currentView === 'likes') loadLikedVideos();
        else loadVideos();
    }

    // === Videos ===
    function loadVideos() {
        var pageSize = state.viewMode === 'feed' ? 14 : (state.viewMode === 'gallery' ? 21 : state.pageSize);
        var params = new URLSearchParams({ page: state.page, pageSize: pageSize });
        if (state.keyword) params.set('keyword', state.keyword);
        if (state.type) params.set('type', state.type);
        if (state.category) params.set('category', state.category);

        api('GET', '/api/videos?' + params).then(function (r) {
            if (r.code !== 200) return;
            var d = r.data;
            state.totalPages = d.totalPages || 1;
            state.page = d.page;
            renderGrid(d.list);
            renderPageInfo(d);
        });
    }

    function loadLikedVideos() {
        var pageSize = state.viewMode === 'gallery' ? 21 : state.pageSize;
        var params = new URLSearchParams({ page: state.page, pageSize: pageSize });
        if (state.keyword) params.set('keyword', state.keyword);
        if (state.type) params.set('type', state.type);
        if (state.category) params.set('category', state.category);

        api('GET', '/api/likes?' + params).then(function (r) {
            if (r.code !== 200) return;
            var d = r.data;
            state.totalPages = d.totalPages || 1;
            state.page = d.page;
            renderGrid(d.list);
            renderPageInfo(d);
        });
    }

    // === Pending Tags Management ===
    var _pendingItems = [];
    var _pendingPage = 1;
    var _pendingPageSize = 15;
    var _pendingFilter = '';

    function loadPendingTags() {
        api('GET', '/api/pending-tags').then(function (r) {
            if (r.code !== 200) return;
            var badge = document.getElementById('pendingBadge');
            _pendingItems = (r.data || []).sort(function (a, b) { return b.count - a.count; });
            _pendingPage = 1;
            _pendingFilter = '';
            var searchInput = document.getElementById('pendingSearch');
            if (searchInput) searchInput.value = '';

            if (_pendingItems.length === 0) {
                document.getElementById('pendingTagList').innerHTML = '<div class="pending-empty">暂无待处理标签</div>';
                document.getElementById('pendingStats').innerHTML = '';
                document.getElementById('pendingPagination').innerHTML = '<div class="pending-pagination-inner"></div>';
                badge.style.display = 'none';
                return;
            }

            var totalVideos = 0, totalImages = 0;
            _pendingItems.forEach(function (item) { totalVideos += item.videoCount || 0; totalImages += item.imageCount || 0; });
            document.getElementById('pendingStats').innerHTML =
                '<span>' + _pendingItems.length + ' 个标签</span>' +
                '<span>' + totalVideos + ' 个视频</span>' +
                '<span>' + totalImages + ' 张图片</span>';
            badge.textContent = _pendingItems.length;
            badge.style.display = '';
            renderPendingTags();
        });
    }

    function filterPendingTags() {
        _pendingFilter = (document.getElementById('pendingSearch').value || '').toLowerCase();
        _pendingPage = 1;
        renderPendingTags();
    }

    function renderPendingTags() {
        var list = document.getElementById('pendingTagList');
        var filtered = _pendingItems.filter(function (item) {
            return !_pendingFilter || item.name.toLowerCase().indexOf(_pendingFilter) >= 0;
        });

        if (filtered.length === 0) {
            list.innerHTML = '<div class="pending-empty">无匹配标签</div>';
            document.getElementById('pendingPagination').innerHTML = '<div class="pending-pagination-inner"></div>';
            return;
        }

        var totalPages = Math.ceil(filtered.length / _pendingPageSize);
        if (_pendingPage > totalPages) _pendingPage = totalPages;
        var start = (_pendingPage - 1) * _pendingPageSize;
        var pageItems = filtered.slice(start, start + _pendingPageSize);

        var html = '<div class="pending-top-actions">' +
            '<span class="pending-top-hint">显示 ' + (start + 1) + '-' + Math.min(start + _pendingPageSize, filtered.length) + ' / 共 ' + filtered.length + ' 个标签</span>' +
            '<span class="pending-top-hint">第 ' + _pendingPage + '/' + totalPages + ' 页</span>' +
        '</div>';

        html += pageItems.map(function (item) {
            var safeName = esc(item.name);
            var safeId = item.name.replace(/[^a-zA-Z0-9]/g, '_');
            var counts = [];
            if (item.folderCount > 0) counts.push(item.folderCount + '个文件夹');
            if (item.videoCount > 0) counts.push(item.videoCount + '个视频');
            if (item.imageCount > 0) counts.push(item.imageCount + '张图片');
            var existsBadge = item.existsInSystem ? '<span class="pending-tag-exists" title="该标签已存在于系统中，确认后将直接加入已有标签">已存在</span>' : '';
            return '<div class="pending-tag-card" id="tagGroup-' + safeId + '">' +
                '<div class="pending-tag-header" onclick="toggleTagExpand(this)">' +
                    '<div class="pending-tag-left">' +
                        '<span class="pending-tag-name" data-tag="' + safeName + '">' + safeName + '</span>' +
                        existsBadge +
                        '<span class="pending-tag-summary" id="summary-' + safeId + '">' + counts.join(' / ') + '</span>' +
                    '</div>' +
                    '<div class="pending-tag-right">' +
                        '<button class="btn btn-xs" onclick="event.stopPropagation();startRenameTag(\'' + safeName + '\')" title="重命名">✎</button>' +
                        '<button class="btn btn-xs btn-green" onclick="event.stopPropagation();confirmAllTag(\'' + safeName + '\',' + (item.existsInSystem ? 'true' : 'false') + ')" title="确认">✓</button>' +
                        '<button class="btn btn-xs btn-red" onclick="event.stopPropagation();rejectAllTag(\'' + safeName + '\')" title="拒绝">✕</button>' +
                        '<svg class="pending-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>' +
                    '</div>' +
                '</div>' +
                '<div class="pending-tag-videos" data-tag="' + safeName + '"></div>' +
            '</div>';
        }).join('');

        list.innerHTML = html;

        // 分页（与首页风格一致）
        var pagHtml = '';
        if (totalPages > 1) {
            pagHtml += '<button onclick="goPendingPage(1)"' + (_pendingPage <= 1 ? ' disabled' : '') + '>首页</button>';
            pagHtml += '<button onclick="goPendingPage(' + (_pendingPage - 1) + ')"' + (_pendingPage <= 1 ? ' disabled' : '') + '>上一页</button>';
            pagHtml += '<span class="info">第' + _pendingPage + ' / ' + totalPages + ' 页 (共' + filtered.length + ' 条)</span>';
            pagHtml += '<button onclick="goPendingPage(' + (_pendingPage + 1) + ')"' + (_pendingPage >= totalPages ? ' disabled' : '') + '>下一页</button>';
            pagHtml += '<button onclick="goPendingPage(' + totalPages + ')"' + (_pendingPage >= totalPages ? ' disabled' : '') + '>末页</button>';
            pagHtml += '<div class="jump"><label>跳转</label>';
            pagHtml += '<input type="number" min="1" max="' + totalPages + '" placeholder="/' + totalPages + '" onkeydown="if(event.key===\'Enter\')goPendingPage(parseInt(this.value))"/>';
            pagHtml += '<button onclick="goPendingPage(parseInt(this.previousElementSibling.value))">GO</button></div>';
        }
        document.getElementById('pendingPagination').innerHTML = '<div class="pending-pagination-inner">' + pagHtml + '</div>';
    }

    function goPendingPage(page) {
        _pendingPage = page;
        renderPendingTags();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    var _pendingTagData = {};       // tag -> { folders: [...], vt, it }
    var _pendingFolderPage = {};    // tag_folderKey -> 当前页码
    var _PENDING_PAGE_SIZE = 18;    // 每个文件夹内每页显示数量

    function toggleTagExpand(header) {
        var group = header.parentElement;
        var videosDiv = group.querySelector('.pending-tag-videos');
        var arrow = header.querySelector('.pending-arrow');
        var tag = videosDiv.dataset.tag;

        if (group.classList.contains('expanded')) {
            group.classList.remove('expanded');
            arrow.style.transform = '';
        } else {
            document.querySelectorAll('.pending-tag-card.expanded').forEach(function (card) {
                if (card !== group) {
                    card.classList.remove('expanded');
                    var otherArrow = card.querySelector('.pending-arrow');
                    if (otherArrow) otherArrow.style.transform = '';
                }
            });

            group.classList.add('expanded');
            arrow.style.transform = 'rotate(180deg)';

            setTimeout(function () {
                group.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);

            if (!videosDiv.dataset.loaded) {
                loadPendingTagVideos(tag, videosDiv);
            }
        }
    }

    function loadPendingTagVideos(tag, container) {
        container.dataset.loaded = 'loading';
        container.innerHTML = '<div class="pending-loading"><div class="pending-spinner"></div>加载中...</div>';
        api('GET', '/api/pending-tags/' + encodeURIComponent(tag) + '/videos').then(function (r) {
            if (r.code !== 200) { container.innerHTML = '<div class="pending-empty">加载失败</div>'; return; }
            var d = r.data || {};
            var vt = d.videoTotal || 0;
            var it = d.imageTotal || 0;
            if (vt === 0 && it === 0) { container.innerHTML = '<div class="pending-empty">无文件</div>'; container.dataset.loaded = '1'; return; }

            // 合并同一文件夹的视频和图片
            var folderMap = {};
            (d.videoGroups || []).forEach(function (g) {
                if (!folderMap[g.folder]) folderMap[g.folder] = { folder: g.folder, videos: [], images: [] };
                folderMap[g.folder].videos = folderMap[g.folder].videos.concat(g.videos || []);
            });
            (d.imageGroups || []).forEach(function (g) {
                if (!folderMap[g.folder]) folderMap[g.folder] = { folder: g.folder, videos: [], images: [] };
                folderMap[g.folder].images = folderMap[g.folder].images.concat(g.videos || []);
            });
            var folders = [];
            Object.keys(folderMap).forEach(function (k) { folders.push(folderMap[k]); });

            _pendingTagData[tag] = { folders: folders, total: folders.length, vt: vt, it: it };
            container.dataset.loaded = '1';

            // 更新 header 里的 summary
            var safeId = tag.replace(/[^a-zA-Z0-9]/g, '_');
            var summaryEl = document.getElementById('summary-' + safeId);
            if (summaryEl) {
                var parts = [];
                parts.push(folders.length + '个文件夹');
                if (vt > 0) parts.push(vt + '个视频');
                if (it > 0) parts.push(it + '张图片');
                summaryEl.textContent = parts.join(' / ');
            }

            renderPendingFolders(tag, container);
        }).catch(function () {
            container.innerHTML = '<div class="pending-empty">加载失败</div>';
            container.dataset.loaded = '';
        });
    }

    function renderPendingFolders(tag, container) {
        var data = _pendingTagData[tag];
        if (!data) return;

        var html = '';
        data.folders.forEach(function (f, idx) {
            html += renderPendingFolderGroup(f, tag, idx);
        });

        container.innerHTML = html;
        container.querySelectorAll('[data-src]').forEach(function (el) { observeLazy(el); });
    }

    function renderPendingFolderGroup(f, tag, folderIdx) {
        var html = '<div class="pending-folder-group">';
        html += '<div class="pending-folder-header">';
        html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
        html += '<span class="pending-folder-name" title="' + esc(f.folder) + '">' + esc(f.folder) + '</span>';
        var total = f.videos.length + f.images.length;
        html += '<span class="pending-folder-count">' + total + ' 项</span>';
        html += '</div>';

        if (f.videos.length > 0) {
            html += renderFolderSection(f.videos, false, tag, folderIdx);
        }
        if (f.images.length > 0) {
            html += renderFolderSection(f.images, true, tag, folderIdx);
        }

        html += '</div>';
        return html;
    }

    function renderFolderSection(items, isImage, tag, folderIdx) {
        var sectionKey = tag + '||' + folderIdx + '||' + (isImage ? 'img' : 'vid');
        var page = _pendingFolderPage[sectionKey] || 1;
        var totalPages = Math.ceil(items.length / _PENDING_PAGE_SIZE);
        if (page > totalPages) page = totalPages;
        _pendingFolderPage[sectionKey] = page;

        var start = (page - 1) * _PENDING_PAGE_SIZE;
        var end = Math.min(start + _PENDING_PAGE_SIZE, items.length);
        var pageItems = items.slice(start, end);

        var sectionTitle = isImage ? '图片' : '视频';
        var sectionIcon = isImage
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>';

        var html = '<div class="pending-folder-section">';
        html += '<div class="pending-folder-section-title">' + sectionIcon + ' ' + sectionTitle + ' (' + items.length + ')</div>';
        html += '<div class="pending-video-grid">';
        pageItems.forEach(function (v) { html += renderPendingCard(v, isImage, tag); });
        html += '</div>';

        // 分页控件（与首页风格一致）
        if (totalPages > 1) {
            html += '<div class="pending-page-nav">';
            html += '<div class="pending-page-btns">';
            html += '<button onclick="goFolderPage(\'' + esc(sectionKey) + '\',1)"' + (page <= 1 ? ' disabled' : '') + '>首页</button>';
            html += '<button onclick="goFolderPage(\'' + esc(sectionKey) + '\',' + (page - 1) + ')"' + (page <= 1 ? ' disabled' : '') + '>上一页</button>';
            html += '<span class="pending-page-info">第' + page + ' / ' + totalPages + ' 页 (共' + items.length + ' 条)</span>';
            html += '<button onclick="goFolderPage(\'' + esc(sectionKey) + '\',' + (page + 1) + ')"' + (page >= totalPages ? ' disabled' : '') + '>下一页</button>';
            html += '<button onclick="goFolderPage(\'' + esc(sectionKey) + '\',' + totalPages + ')"' + (page >= totalPages ? ' disabled' : '') + '>末页</button>';
            html += '<div class="pending-page-jump">';
            html += '<label>跳转</label>';
            html += '<input type="number" min="1" max="' + totalPages + '" placeholder="/' + totalPages + '" onkeydown="if(event.key===\'Enter\')goFolderPage(\'' + esc(sectionKey) + '\',parseInt(this.value))"/>';
            html += '<button onclick="goFolderPage(\'' + esc(sectionKey) + '\',parseInt(this.previousElementSibling.value))">GO</button>';
            html += '</div>';
            html += '</div></div>';
        }

        html += '</div>';
        return html;
    }

    function goFolderPage(sectionKey, page) {
        _pendingFolderPage[sectionKey] = page;
        // sectionKey 格式: tag||folderIdx||type
        var parts = sectionKey.split('||');
        var tag = parts[0];
        var container = document.querySelector('.pending-tag-videos[data-tag="' + tag + '"]');
        if (container && _pendingTagData[tag]) {
            renderPendingFolders(tag, container);
        }
    }

    function renderPendingCard(v, isImage, tag) {
        var thumb = '';
        if (isImage) {
            thumb = v.thumbUrl
                ? '<img class="pending-video-thumb" data-src="' + API + v.thumbUrl + '" onerror="this.outerHTML=\'<div class=pending-video-thumb>?</div>\'"/>'
                : '<div class="pending-video-thumb">?</div>';
        } else {
            if (v.thumbUrl) {
                thumb = '<img class="pending-video-thumb" data-src="' + API + v.thumbUrl + '" onerror="this.outerHTML=\'<div class=pending-video-thumb>?</div>\'"/>';
            } else if (v.url) {
                thumb = '<video class="pending-video-thumb" muted preload="none" data-src="' + API + v.url + '"></video>';
            } else {
                thumb = '<div class="pending-video-thumb">?</div>';
            }
        }
        var preview = (!isImage && v.url) ? '<video class="pending-video-preview" muted preload="none" data-src="' + API + v.url + '"></video>' : '';
        var title = esc(v.fileName || v.title || '');
        var click = ' onclick="openPendingVideoPopup(' + v.id + ',\'' + title.replace(/'/g, "\\'") + '\')"';
        var hover = isImage ? '' : ' onmouseenter="previewPendingVideo(this)" onmouseleave="stopPendingVideo(this)"';
        var badge = isImage ? '<span class="card-badge card-badge-img pending-card-badge">图片</span>' : '';
        return '<div class="pending-video-card" data-type="' + (isImage ? 'image' : 'video') + '" title="' + title + '"' + hover + click + '>' +
            thumb + preview + badge +
            '<div class="pending-video-info">' +
            '<span class="pending-video-title" onclick="event.stopPropagation();window._openDetail(' + v.id + ')" style="cursor:pointer">' + title + '</span>' +
            '<button class="pending-video-remove" onclick="event.stopPropagation();rejectVideoTag(' + v.id + ',\'' + esc(tag) + '\',this)" title="移除此标签">\u00d7</button>' +
            '</div></div>';
    }

    function previewPendingVideo(card) {
        var video = card.querySelector('.pending-video-preview');
        if (!video) return;
        if (!video.src && video.dataset.src) video.src = video.dataset.src;
        if (video.readyState >= 2) {
            video.play().catch(function () {});
        } else {
            video.addEventListener('loadeddata', function playOnce() { video.play().catch(function () {}); video.removeEventListener('loadeddata', playOnce); });
        }
    }

    function stopPendingVideo(card) {
        var video = card.querySelector('.pending-video-preview');
        if (!video) return;
        video.pause();
        video.currentTime = 0;
    }

    // 预分标签视频弹窗播放（简化版，无评论等按钮）
    var pendingPopupEl = null;
    function openPendingVideoPopup(videoId, title) {
        // 先获取内容类型，决定用图片弹窗还是视频弹窗
        api('GET', '/api/videos/' + videoId).then(function (r) {
            if (r.code === 200 && r.data && r.data.type === 'image') {
                showImage(videoId);
            } else {
                playVideo(videoId);
            }
        });
    }
    function closePendingVideoPopup() {
        closeModal();
    }

    // 开始重命名标签
    function startRenameTag(oldTag) {
        var overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = '<div class="confirm-dialog">' +
            '<div class="confirm-title">重命名标签</div>' +
            '<div class="rename-tag-input-wrap">' +
                '<span class="rename-tag-prefix">#</span>' +
                '<input class="rename-tag-input" type="text" value="' + esc(oldTag.replace(/^#/, '')) + '"/>' +
            '</div>' +
            '<div class="confirm-actions">' +
                '<button class="btn btn-outline rename-cancel">取消</button>' +
                '<button class="btn rename-ok">确认</button>' +
            '</div>' +
        '</div>';

        var input = overlay.querySelector('.rename-tag-input');

        overlay.querySelector('.rename-cancel').onclick = function () { overlay.remove(); };
        overlay.querySelector('.rename-ok').onclick = function () {
            var newName = input.value.trim();
            if (!newName) { toast('标签名不能为空'); return; }
            if (newName === oldTag.replace(/^#/, '')) { overlay.remove(); return; }
            overlay.remove();
            renamePendingTag(oldTag, newName.startsWith('#') ? newName : '#' + newName);
        };
        overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { overlay.querySelector('.rename-ok').click(); }
            if (e.key === 'Escape') { overlay.remove(); }
        });

        document.body.appendChild(overlay);
        input.focus();
        input.select();
    }

    // 调用API重命名标签
    function renamePendingTag(oldTag, newTag) {
        api('POST', '/api/pending-tags/' + encodeURIComponent(oldTag) + '/rename', { newTag: newTag }).then(function (r) {
            if (r.code === 200) {
                toast('标签已重命名');
                loadPendingTags();
            } else {
                toast(r.msg || '重命名失败');
            }
        });
    }

    function confirmAllTag(tag, existsInSystem) {
        if (existsInSystem) {
            showConfirmDialog(
                '确认添加到已有标签',
                '标签「' + tag + '」已存在于系统中，确认后将直接把视频添加到该已有标签中。',
                function () {
                    doConfirmAllTag(tag);
                }
            );
        } else {
            doConfirmAllTag(tag);
        }
    }

    function doConfirmAllTag(tag) {
        api('POST', '/api/pending-tags/' + encodeURIComponent(tag) + '/confirm-all').then(function (r) {
            if (r.code === 200) {
                toast(r.data);
                loadPendingTags();
                loadCategories();
                loadVideos();
            }
        });
    }

    function rejectAllTag(tag) {
        showConfirmDialog(
            '确认拒绝',
            '确认拒绝标签「' + tag + '」下的所有视频？此操作不可撤销。',
            function () {
                api('POST', '/api/pending-tags/' + encodeURIComponent(tag) + '/reject-all').then(function (r) {
                    if (r.code === 200) {
                        toast(r.data);
                        loadPendingTags();
                    }
                });
            }
        );
    }

    function rejectAllTags() {
        showConfirmDialog(
            '全部拒绝',
            '确认清空所有待处理的预分标签标签？此操作不可撤销。',
            function () {
                api('POST', '/api/pending-tags/clear-all').then(function (r) {
                    if (r.code === 200) {
                        toast(r.data);
                        loadPendingTags();
                    } else {
                        toast(r.msg || '操作失败');
                    }
                });
            }
        );
    }

    function skipTag(tag) {
        var group = document.getElementById('tagGroup-' + tag.replace(/[^a-zA-Z0-9]/g, '_'));
        if (group) {
            var parent = group.parentElement;
            parent.appendChild(group);
            group.style.opacity = '0.5';
            setTimeout(function () { group.style.opacity = ''; }, 1000);
            toast('已移到末尾');
        }
    }

    function rejectVideoTag(videoId, tag, btn) {
        api('POST', '/api/videos/' + videoId + '/reject-tag', { tag: tag }).then(function (r) {
            if (r.code === 200) {
                var card = btn.closest('.pending-video-card');
                var isImage = card && card.dataset.type === 'image';
                if (card) card.remove();
                // 更新统计数据
                _pendingItems.forEach(function (item) {
                    if (item.name === tag) {
                        item.count = Math.max(0, (item.count || 1) - 1);
                        if (isImage) {
                            item.imageCount = Math.max(0, (item.imageCount || 1) - 1);
                        } else {
                            item.videoCount = Math.max(0, (item.videoCount || 1) - 1);
                        }
                    }
                });
                // 更新汇总统计
                var safeId = tag.replace(/[^a-zA-Z0-9]/g, '_');
                var summaryEl = document.getElementById('summary-' + safeId);
                if (summaryEl) {
                    var item = _pendingItems.find(function (i) { return i.name === tag; });
                    if (item) {
                        var parts = [];
                        if (item.folderCount > 0) parts.push(item.folderCount + '个文件夹');
                        if (item.videoCount > 0) parts.push(item.videoCount + '个视频');
                        if (item.imageCount > 0) parts.push(item.imageCount + '张图片');
                        summaryEl.textContent = parts.join(' / ');
                    }
                }
                // 更新顶部统计
                var totalVideos = 0, totalImages = 0;
                _pendingItems.forEach(function (i) { totalVideos += i.videoCount || 0; totalImages += i.imageCount || 0; });
                document.getElementById('pendingStats').innerHTML =
                    '<span>' + _pendingItems.length + ' 个标签</span>' +
                    '<span>' + totalVideos + ' 个视频</span>' +
                    '<span>' + totalImages + ' 张图片</span>';
                toast('已移除');
            }
        });
    }

    // 显示确认弹窗
    function showConfirmDialog(title, message, onConfirm) {
        var overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = '<div class="confirm-dialog">' +
            '<div class="confirm-title">' + esc(title) + '</div>' +
            '<div class="confirm-message">' + esc(message) + '</div>' +
            '<div class="confirm-actions">' +
                '<button class="btn btn-outline confirm-cancel">取消</button>' +
                '<button class="btn btn-red confirm-ok">确认</button>' +
            '</div>' +
        '</div>';

        overlay.querySelector('.confirm-cancel').onclick = function () { overlay.remove(); };
        overlay.querySelector('.confirm-ok').onclick = function () { overlay.remove(); onConfirm(); };
        overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };

        document.body.appendChild(overlay);
    }

    function showPendingTags() {
        switchView('pending');
    }

    // 懒加载观察器
    var lazyObserver = null;
    function initLazyObserver() {
        if (lazyObserver) return;
        lazyObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    var el = entry.target;
                    var src = el.dataset.src;
                    if (!src) return;
                    if (el.tagName === 'VIDEO') {
                        el.preload = 'metadata';
                        el.src = src;
                        el.addEventListener('loadedmetadata', function handler() {
                            if (el.duration > 1) el.currentTime = 1;
                            el.removeEventListener('loadedmetadata', handler);
                        });
                    } else if (el.tagName === 'IMG') {
                        el.src = src;
                    }
                    lazyObserver.unobserve(el);
                }
            });
        }, { rootMargin: '200px' });
    }

    function observeLazy(el) {
        initLazyObserver();
        lazyObserver.observe(el);
    }

    // Feed模式图片原图加载观察器（滚动到屏幕中间才加载原图）
    var feedImageObserver = null;
    function initFeedImageObserver() {
        if (feedImageObserver) return;
        feedImageObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    var img = entry.target;
                    var origSrc = img.dataset.orig;
                    if (origSrc && img.src !== origSrc) {
                        img.src = origSrc;
                    }
                    feedImageObserver.unobserve(img);
                }
            });
        }, { rootMargin: '0px', threshold: 0.5 });
    }

    function observeFeedImage(img) {
        initFeedImageObserver();
        feedImageObserver.observe(img);
    }

    function destroyFeedImageObserver() {
        if (feedImageObserver) {
            feedImageObserver.disconnect();
            feedImageObserver = null;
        }
    }

    function renderGrid(items) {
        var grid = document.getElementById('videoGrid');
        if (!items || items.length === 0) {
            var hasFilter = state.keyword || state.type || state.category;
            var emptyMsg;
            if (hasFilter) {
                emptyMsg = '没有搜索到相关内容';
            } else if (state.currentView === 'likes') {
                emptyMsg = '还没有点赞的视频';
            } else {
                emptyMsg = '暂无数据，请先导入';
            }
            grid.innerHTML = '<div class="empty">' + emptyMsg + '</div>';
            grid.className = 'grid';
            return;
        }

        var mode = state.viewMode;
        var listView = document.getElementById('listView');

        // 轮播模式特殊处理：需要外层wrapper结构
        if (mode === 'carousel') {
            listView.classList.add('carousel-active');
            var savedCarouselPage = parseInt(localStorage.getItem(userKey('carouselPage'))) || 1;
            var savedCarouselIndex = parseInt(localStorage.getItem(userKey('carouselIndex'))) || 0;
            _carouselPageItems = items.slice(0, 20);
            _carouselAllItems = _carouselPageItems.slice();

            if (_carouselLoopMode === 'page') {
                // 全部循环模式：加载到保存的页码
                renderCarouselMode(grid, _carouselPageItems, 0);
                if (savedCarouselPage > 1) {
                    loadAllCarouselPages(2, savedCarouselPage, function () {
                        var track = document.getElementById('carouselTrack');
                        if (!track) return;
                        var existingCount = track.querySelectorAll('.carousel-card').length;
                        for (var i = existingCount; i < _carouselAllItems.length; i++) {
                            appendCardToDOMSimple(_carouselAllItems[i], i);
                        }
                        // 恢复位置
                        _carouselGlobalIndex = Math.min(savedCarouselIndex, _carouselAllItems.length - 1);
                        var card = track.querySelector('.carousel-card[data-idx="' + _carouselGlobalIndex + '"]');
                        if (card) {
                            card.classList.add('active');
                            var viewport = document.getElementById('carouselViewport');
                            if (viewport) viewport.scrollLeft = card.offsetLeft - viewport.offsetWidth / 2 + card.offsetWidth / 2;
                        }
                        var timeEl = document.getElementById('carouselTime');
                        var fill = document.getElementById('carouselFill');
                        var pageInfoEl = document.getElementById('carouselPageInfo');
                        if (timeEl) timeEl.textContent = (_carouselGlobalIndex + 1) + ' / ' + _carouselAllItems.length;
                        if (fill) {
                            var pct = _carouselAllItems.length > 1 ? (_carouselGlobalIndex / (_carouselAllItems.length - 1)) * 100 : 0;
                            fill.style.width = Math.min(100, pct) + '%';
                        }
                        if (pageInfoEl) {
                            var pg = Math.floor(_carouselGlobalIndex / 20) + 1;
                            pageInfoEl.textContent = '第' + pg + ' / ' + state.totalPages + ' 页 (共' + _carouselAllItems.length + ' 条)';
                        }
                    });
                }
            } else {
                // 单页循环模式：索引是页内索引，限制在0-19
                var savedPage = parseInt(localStorage.getItem(userKey('carouselPage'))) || 1;
                var savedIdx = parseInt(localStorage.getItem(userKey('carouselIndex'))) || 0;
                // 如果保存的是全局索引，转换为页内索引
                var pageIdx = savedIdx;
                if (savedIdx >= 20) {
                    // 可能是全局索引，取模得到页内索引
                    pageIdx = savedIdx % 20;
                }
                pageIdx = Math.min(pageIdx, 19);
                if (pageIdx < 0) pageIdx = 0;
                renderCarouselMode(grid, _carouselPageItems, pageIdx);
            }
            return;
        }

        // 非轮播模式：恢复
        listView.classList.remove('carousel-active');
        var pagination = grid.parentElement.querySelector('.pagination');
        if (pagination) pagination.style.display = '';

        // 设置网格类名
        grid.className = 'grid ' + mode + '-mode';

        // 根据模式渲染卡片
        var renderers = {
            feed: function (v) { return v.type === 'image' ? renderFeedImageCard(v) : renderFeedCard(v); },
            gallery: renderGalleryCard
        };

        var renderer = renderers[mode] || renderGridCard;
        grid.innerHTML = items.map(function (v) {
            var isRemoved = v.title && v.title.indexOf('[已下架]') === 0;
            if (isRemoved && mode !== 'grid' && mode !== 'feed') return '';
            return renderer(v);
        }).join('');

        // 懒加载
        grid.querySelectorAll('[data-src]').forEach(function (el) {
            observeLazy(el);
        });

        // Feed模式：观察卡片用于滚动自动播放
        if (mode === 'feed') {
            observeFeedCards();
            grid.querySelectorAll('.feed-image[data-orig]').forEach(function (img) {
                observeFeedImage(img);
            });
        }

        // 各模式初始化
        if (mode === 'gallery') initGallerySwipe();
    }

    // 网格模式卡片
    function renderGridCard(v) {
        var isImage = v.type === 'image';
        var isRemoved = v.title && v.title.indexOf('[已下架]') === 0;
        var thumb = '';
        var preview = '';

        if (isRemoved) {
            thumb = '<div class="card-thumb-removed">已下架</div>';
        } else if (isImage && v.thumbUrl) {
            thumb = '<img class="card-thumb" data-src="' + API + v.thumbUrl + '" onerror="this.outerHTML=\'<div class=card-thumb-empty>🖼</div>\'"/>';
        } else if (isImage) {
            thumb = '<img class="card-thumb" data-src="' + API + v.url + '" onerror="this.outerHTML=\'<div class=card-thumb-empty>🖼</div>\'"/>';
        } else if (v.thumbUrl) {
            thumb = '<img class="card-thumb" data-src="' + API + v.thumbUrl + '" onerror="this.outerHTML=\'<div class=card-thumb-empty>🎬</div>\'"/>';
            preview = '<video class="card-preview" muted preload="none" data-src="' + API + v.url + '"></video>';
        } else {
            thumb = '<video class="card-thumb card-thumb-video" muted playsinline preload="metadata" data-src="' + API + v.url + '"></video>';
            preview = '<video class="card-preview" muted preload="none" data-src="' + API + v.url + '"></video>';
        }

        var tags = renderTags(v);
        var badge = renderBadge(v, isImage, isRemoved);
        var likedCls = v.liked ? ' liked' : '';
        var thumbClick = isRemoved ? '' : (isImage ? ' onclick="window._showImage(' + v.id + ')"' : ' onclick="event.stopPropagation();window._play(' + v.id + ')"');
        var titleClick = isRemoved ? '' : ' onclick="event.stopPropagation();window._openDetail(' + v.id + ')"';
        var hoverAttr = isRemoved ? '' : ' onmouseenter="window._hoverPlay(this)" onmouseleave="window._hoverStop(this)"';
        var title = esc(v.title || '').replace('[已下架] ', '');
        var removedTag = isRemoved ? '<span class="removed-tag">已下架</span>' : '';


        return '<div class="card' + (isRemoved ? ' card-removed' : '') + '"' + hoverAttr + '>' +
            '<div class="card-thumb-wrap"' + thumbClick + '>' + thumb + preview + badge + '</div>' +
            '<div class="card-body">' +
                '<div class="card-title"' + titleClick + '>' + removedTag + title + '</div>' +
                tags +
                '<div class="card-meta">' +
                    '<span>' + fmtSize(v.fileSize) + '</span>' +
                    '<div class="card-stats">' +
                        '<span class="stat-item" title="浏览"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' + (v.viewCount || 0) + '</span>' +
                        '<button class="card-comment-btn" onclick="event.stopPropagation();window._openDetail(' + v.id + ')" title="评论">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
                            '<span>' + (v.commentCount || 0) + '</span>' +
                        '</button>' +
                        '<button class="card-like' + likedCls + '" onclick="event.stopPropagation();window._like(' + v.id + ',this)">' +
                            '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
                            '<span>' + (v.likeCount || 0) + '</span>' +
                        '</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    // 推特模式卡片
    function renderFeedCard(v) {
        var tags = renderTags(v);
        var likedCls = v.liked ? ' liked' : '';
        var title = esc(v.title || '');
        var defaultMuted = state.feedDefaultMuted ? ' muted' : '';


        return '<div class="card feed-card' + '" data-video-id="' + v.id + '">' +
            '<div class="card-body">' +
                '<div class="card-title">' + title + '</div>' +
                tags +
            '</div>' +
            '<div class="feed-video-wrap">' +

                
                '<div class="danmaku-layer feed-danmaku-layer" id="danmakuLayerFeed' + v.id + '"></div>' +
                '<video class="feed-video"' + defaultMuted + ' loop preload="none" data-src="' + API + v.url + '"></video>' +
                '<button class="feed-center-play feed-play-btn" onclick="event.stopPropagation();window._feedTogglePlay(this)">' +
                    '<svg class="feed-icon-play" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
                    '<svg class="feed-icon-pause" viewBox="0 0 24 24" fill="currentColor" style="display:none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>' +
                '</button>' +
                '<div class="feed-video-controls">' +
                    '<div class="feed-progress-wrap"><div class="feed-progress-bar"><div class="feed-progress-fill"><div class="feed-progress-thumb"></div></div></div></div>' +
                    '<div class="feed-video-bottom">' +
                        '<div class="feed-video-left">' +
                            '<button class="feed-video-btn feed-play-btn" onclick="event.stopPropagation();window._feedTogglePlay(this)" title="播放/暂停">' +
                                '<svg class="feed-icon-play" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
                                '<svg class="feed-icon-pause" viewBox="0 0 24 24" fill="currentColor" style="display:none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>' +
                            '</button>' +
                            '<span class="feed-video-time"><span class="feed-time-current">0:00</span> / <span class="feed-time-total">0:00</span></span>' +
                        '</div>' +
                        '<div class="feed-video-center">' +
                            '<button class="feed-video-btn feed-danmaku-toggle' + (_danmakuVisible ? ' active' : '') + '" onclick="event.stopPropagation();window._toggleFeedDanmaku(this,' + v.id + ')" title="弹幕">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="14" rx="3"/><line x1="6" y1="9" x2="14" y2="9"/><line x1="6" y1="13" x2="18" y2="13"/><line x1="9" y1="21" x2="5" y2="18"/></svg>' +
                            '</button>' +
                            '<input class="danmaku-input" placeholder="' + (_danmakuVisible ? '发弹幕，回车发送' : '弹幕已关闭') + '"' + (_danmakuVisible ? '' : ' disabled') + ' onkeydown="if(event.key===\'Enter\')window._sendFeedDanmaku(this,' + v.id + ')"/>' +
                        '</div>' +
                        '<div class="feed-video-right">' +
                            '<button class="feed-video-btn" onclick="event.stopPropagation();window._feedToggleMute(this)" title="静音">' +
                                '<svg class="feed-icon-unmute" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' + (state.feedDefaultMuted ? ' style="display:none"' : '') + '><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>' +
                                '<svg class="feed-icon-mute" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' + (!state.feedDefaultMuted ? ' style="display:none"' : '') + '><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>' +
                            '</button>' +
                            '<button class="feed-video-btn feed-rate-btn" onclick="event.stopPropagation();window._feedCycleRate(this)" title="播放倍率">' +
                                '<span class="feed-rate-text">1x</span>' +
                            '</button>' +
                            '<button class="feed-video-btn" onclick="event.stopPropagation();window._feedPip(this)" title="画中画">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><rect x="11" y="9" width="10" height="7" rx="1" fill="currentColor" opacity=".3"/></svg>' +
                            '</button>' +
                            '<button class="feed-video-btn" onclick="event.stopPropagation();window._feedFullscreen(this)" title="全屏">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>' +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="feed-actions">' +
                '<button class="feed-action-btn" onclick="event.stopPropagation();window._openDetail(' + v.id + ')">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
                    '<span>' + (v.commentCount || 0) + '</span>' +
                '</button>' +
                '<button class="feed-action-btn' + likedCls + '" onclick="event.stopPropagation();window._like(' + v.id + ',this)">' +
                    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
                    '<span>' + (v.likeCount || 0) + '</span>' +
                '</button>' +
                '<span class="feed-action-views" title="浏览">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
                    '<span>' + (v.viewCount || 0) + '</span>' +
                '</span>' +
                '<button class="feed-action-btn feed-tag-btn" onclick="event.stopPropagation();window._toggleTagDropdown(' + v.id + ',this)" title="添加标签">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>' +
                '</button>' +
            '</div>' +
        '</div>';
    }

    // 列表模式图片卡片
    function renderFeedImageCard(v) {
        var tags = renderTags(v);
        var likedCls = v.liked ? ' liked' : '';
        var title = esc(v.title || '');
        var thumbSrc = v.thumbUrl ? API + v.thumbUrl : '';
        var origSrc = API + v.url;


        return '<div class="card feed-card feed-image-card' + '" data-video-id="' + v.id + '">' +
            '<div class="card-body">' +
                '<div class="card-title">' + title + '</div>' +
                tags +
            '</div>' +
            '<div class="feed-video-wrap feed-image-wrap">' +
                '<img class="feed-image" data-src="' + thumbSrc + '" data-orig="' + origSrc + '" onclick="window._showImage(' + v.id + ')" onerror="this.outerHTML=\'<div class=feed-image-error>🖼</div>\'"/>' +
                '<span class="card-badge card-badge-img">图片</span>' +

            '</div>' +
            '<div class="feed-actions">' +
                '<button class="feed-action-btn" onclick="event.stopPropagation();window._openDetail(' + v.id + ')">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
                    '<span>' + (v.commentCount || 0) + '</span>' +
                '</button>' +
                '<button class="feed-action-btn' + likedCls + '" onclick="event.stopPropagation();window._like(' + v.id + ',this)">' +
                    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
                    '<span>' + (v.likeCount || 0) + '</span>' +
                '</button>' +
                '<span class="feed-action-views" title="浏览">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
                    '<span>' + (v.viewCount || 0) + '</span>' +
                '</span>' +
                '<button class="feed-action-btn feed-tag-btn" onclick="event.stopPropagation();window._toggleTagDropdown(' + v.id + ',this)" title="添加标签">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>' +
                '</button>' +
            '</div>' +
        '</div>';
    }

    // 瀑布流模式卡片
    // 3D卡片墙模式卡片
    function renderWall3DCard(v) {
        var isImage = v.type === 'image';
        var thumbSrc = '';
        if (isImage) {
            thumbSrc = v.thumbUrl ? API + v.thumbUrl : API + v.url;
        } else {
            thumbSrc = v.thumbUrl ? API + v.thumbUrl : '';
        }
        var title = esc(v.title || '');
        var likedCls = v.liked ? ' liked' : '';
        var badge = isImage ? '<span class="card-badge card-badge-img">图片</span>' : (v.duration ? '<span class="card-badge">' + esc(v.duration) + '</span>' : '');
        var click = isImage ? ' onclick="window._showImage(' + v.id + ')"' : ' onclick="event.stopPropagation();window._play(' + v.id + ')"';


        return '<div class="wall3d-card' + '" data-id="' + v.id + '" data-type="' + (isImage ? 'image' : 'video') + '">' +
            '<div class="wall3d-inner"' + click + '>' +
                '<div class="wall3d-front">' +
                    (thumbSrc ? '<img class="wall3d-thumb" data-src="' + thumbSrc + '" onerror="this.parentElement.innerHTML=\'<div class=wall3d-thumb-empty>?</div>\'"/>' : '<div class="wall3d-thumb-empty">?</div>') +
                    badge +
    
                '</div>' +
                '<div class="wall3d-back">' +
                    '<div class="wall3d-back-info">' +
                        '<div class="wall3d-back-title">' + title + '</div>' +
                        '<div class="wall3d-back-meta">' + fmtSize(v.fileSize) + '</div>' +
                        '<div class="wall3d-back-stats">' +
                            '<span>' + (v.viewCount || 0) + ' 浏览</span>' +
                            '<span>' + (v.likeCount || 0) + ' 点赞</span>' +
                        '</div>' +
                        '<div class="wall3d-back-actions">' +
                            '<button class="wall3d-action-btn' + likedCls + '" onclick="event.stopPropagation();window._like(' + v.id + ',this)">❤</button>' +
                            '<button class="wall3d-action-btn" onclick="event.stopPropagation();window._openDetail(' + v.id + ')">详情</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    // 沉浸式画廊模式卡片
    function renderGalleryCard(v) {
        var isImage = v.type === 'image';
        var thumbSrc = isImage ? (v.thumbUrl ? API + v.thumbUrl : API + v.url) : (v.thumbUrl ? API + v.thumbUrl : '');
        var title = esc(v.title || '');
        var likedCls = v.liked ? ' liked' : '';
        var click = isImage ? ' onclick="window._openGalleryViewer(' + v.id + ')"' : ' onclick="event.stopPropagation();window._play(' + v.id + ')"';

        return '<div class="gallery-card' + '" data-id="' + v.id + '" data-type="' + (isImage ? 'image' : 'video') + '"' + click + '>' +
            (thumbSrc ? '<img class="gallery-thumb" data-src="' + thumbSrc + '" onerror="this.outerHTML=\'<div class=gallery-thumb-empty>?</div>\'"/>' : '<div class="gallery-thumb-empty">?</div>') +
            '<button class="gallery-float-like' + likedCls + '" onclick="event.stopPropagation();window._like(' + v.id + ',this)" title="点赞">' +
                '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
            '</button>' +
            '<div class="gallery-overlay">' +
                '<div class="gallery-title" onclick="event.stopPropagation();window._openDetail(' + v.id + ')">' + title + '</div>' +
            '</div></div>';
    }

    // 轮播焦点模式
    var _carouselDuration = parseInt(localStorage.getItem('carouselDuration')) || 3;
    var _carouselLoopMode = localStorage.getItem('carouselLoopMode') || 'single';
    var _carouselAutoPlay = localStorage.getItem('carouselAutoPlay') !== 'false';
    var _carouselAllItems = []; // 所有已加载的项目（跨页累积）
    var _carouselPageItems = []; // 当前页的项目
    var _carouselGlobalIndex = 0; // 全局索引
    var _carouselTimer = null;
    var _carouselLoading = false;
    var _carouselDragState = { dragging: false, startX: 0, scrollLeft: 0 };

    // 简单追加卡片到DOM
    function appendCardToDOMSimple(v, idx) {
        var isImage = v.type === 'image';
        var thumbSrc = isImage ? (v.thumbUrl ? API + v.thumbUrl : API + v.url) : (v.thumbUrl ? API + v.thumbUrl : '');
        var title = esc(v.title || '');
        var likedCls = v.liked ? ' liked' : '';
        var badge = isImage ? '<span class="card-badge card-badge-img carousel-badge">图片</span>' : (v.duration ? '<span class="card-badge carousel-badge">' + esc(v.duration) + '</span>' : '');

        var cardHtml = '<div class="carousel-card' + '" data-id="' + v.id + '" data-idx="' + idx + '" data-type="' + (isImage ? 'image' : 'video') + '">' +
            '<div class="carousel-thumb-wrap"><img class="carousel-thumb" src="' + thumbSrc + '" data-idx="' + idx + '" onerror="this.outerHTML=\'<div class=carousel-thumb-empty>?</div>\'"/>' + badge +
            '<div class="carousel-info">' +
                '<div class="carousel-title" onclick="event.stopPropagation();window._openDetail(' + v.id + ')" style="cursor:pointer">' + title + '</div>' +
                '<div class="carousel-meta"><span>' + fmtSize(v.fileSize) + '</span>' +
                '<button class="carousel-like-btn' + likedCls + '" onclick="event.stopPropagation();window._like(' + v.id + ',this)">' +
                    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
                    '<span>' + (v.likeCount || 0) + '</span></button></div>' +
            '</div></div></div>';
        var track = document.getElementById('carouselTrack');
        if (track) track.insertAdjacentHTML('beforeend', cardHtml);
    }

    // 串行加载多页，完成后回调
    function loadAllCarouselPages(fromPage, toPage, callback) {
        if (fromPage > toPage) { callback(); return; }
        var params = new URLSearchParams({ page: fromPage, pageSize: 20 });
        if (state.keyword) params.set('keyword', state.keyword);
        if (state.type) params.set('type', state.type);
        if (state.category) params.set('category', state.category);
        var url = state.currentView === 'likes' ? '/api/likes' : '/api/videos';
        api('GET', url + '?' + params).then(function (r) {
            if (r.code === 200 && r.data) {
                state.totalPages = r.data.totalPages;
                var newItems = r.data.list || [];
                var existingIds = new Set(_carouselAllItems.map(function(v) { return v.id; }));
                newItems.forEach(function (v) {
                    if (!existingIds.has(v.id)) _carouselAllItems.push(v);
                });
                state.page = fromPage;
            }
            if (fromPage < toPage) {
                loadAllCarouselPages(fromPage + 1, toPage, callback);
            } else {
                callback();
            }
        }).catch(function () { callback(); });
    }

    function renderCarouselMode(grid, items, restoreIndex) {
        var pagination = grid.parentElement.querySelector('.pagination');
        if (pagination) pagination.style.display = 'none';

        _carouselPageItems = items.slice(0, 20);
        // 单页模式只用当前页，跨页模式累积
        if (_carouselLoopMode === 'single') {
            _carouselAllItems = items.slice();
        } else {
            var existingIds = new Set(_carouselAllItems.map(function(v) { return v.id; }));
            items.forEach(function (v) {
                if (!existingIds.has(v.id)) _carouselAllItems.push(v);
            });
        }

        var displayItems = _carouselLoopMode === 'single' ? _carouselPageItems : _carouselAllItems;
        var hasMore = false; // 单页循环不显示加载更多按钮

        var cardsHtml = displayItems.map(function (v, i) {
            var isImage = v.type === 'image';
            var thumbSrc = isImage ? (v.thumbUrl ? API + v.thumbUrl : API + v.url) : (v.thumbUrl ? API + v.thumbUrl : '');
            var title = esc(v.title || '');
            var likedCls = v.liked ? ' liked' : '';
            var badge = isImage ? '<span class="card-badge card-badge-img carousel-badge">图片</span>' : (v.duration ? '<span class="card-badge carousel-badge">' + esc(v.duration) + '</span>' : '');
            var mediaHtml = '<img class="carousel-thumb" src="' + thumbSrc + '" data-idx="' + i + '" onerror="this.outerHTML=\'<div class=carousel-thumb-empty>?</div>\'"/>';
            return '<div class="carousel-card" data-id="' + v.id + '" data-idx="' + i + '" data-type="' + (isImage ? 'image' : 'video') + '">' +
                '<div class="carousel-thumb-wrap">' + mediaHtml + badge +
                '<div class="carousel-info">' +
                    '<div class="carousel-title" onclick="event.stopPropagation();window._openDetail(' + v.id + ')" style="cursor:pointer">' + title + '</div>' +
                    '<div class="carousel-meta">' +
                        '<span>' + fmtSize(v.fileSize) + '</span>' +
                        '<button class="carousel-like-btn' + likedCls + '" onclick="event.stopPropagation();window._like(' + v.id + ',this)">' +
                            '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
                            '<span>' + (v.likeCount || 0) + '</span>' +
                        '</button>' +
                    '</div>' +
                '</div>' +
                '</div></div>';
        }).join('');

        var loadMoreHtml = hasMore ? '<div class="carousel-load-more" id="carouselLoadMore"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/><path d="M15 18l6-6-6-6" opacity="0.5"/></svg><span>加载下一页</span></div>' : '';

        var currentPage = state.page || 1;
        var currentDisplayItems = _carouselLoopMode === 'single' ? _carouselPageItems : _carouselAllItems;
        var totalItems = currentDisplayItems.length;
        var initialIndex = (restoreIndex !== undefined && restoreIndex >= 0 && restoreIndex < totalItems) ? restoreIndex : 0;

        grid.className = 'carousel-wrapper';
        grid.innerHTML =
            '<div class="carousel-viewport" id="carouselViewport"><div class="carousel-track" id="carouselTrack">' + cardsHtml + loadMoreHtml + '</div></div>' +
            '<div class="carousel-controls">' +
                '<button class="carousel-btn" id="carouselFirst" title="第一个"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 19l-7-7 7-7M18 19l-7-7 7-7"/></svg></button>' +
                '<button class="carousel-btn" id="carouselPrev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button>' +
                '<div class="carousel-progress" id="carouselProgress"><div class="carousel-progress-fill" id="carouselFill"></div></div>' +
                '<div class="carousel-info-group">' +
                    '<div class="carousel-time" id="carouselTime" onclick="window._carouselPagePopup(event)" title="点击选择位置">' + (initialIndex + 1) + ' / ' + totalItems + '</div>' +
                    '<div class="carousel-page-nav">' +
                        '<button class="carousel-page-btn' + (currentPage <= 1 ? ' disabled' : '') + '" id="carouselPrevPage" title="上一页"' + (currentPage <= 1 ? ' disabled' : '') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button>' +
                        '<div class="carousel-page-info" id="carouselPageInfo" onclick="window._carouselPageSelect(event)" style="cursor:pointer" title="点击选择页码">第' + currentPage + ' / ' + state.totalPages + ' 页 (共' + totalItems + ' 条)</div>' +
                        '<button class="carousel-page-btn' + (currentPage >= state.totalPages ? ' disabled' : '') + '" id="carouselNextPage" title="下一页"' + (currentPage >= state.totalPages ? ' disabled' : '') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></button>' +
                    '</div>' +
                '</div>' +
                '<select class="carousel-select" id="carouselDuration" title="切换间隔">' +
                    '<option value="2">2秒</option>' +
                    '<option value="3"' + (_carouselDuration === 3 ? ' selected' : '') + '>3秒</option>' +
                    '<option value="5"' + (_carouselDuration === 5 ? ' selected' : '') + '>5秒</option>' +
                    '<option value="8"' + (_carouselDuration === 8 ? ' selected' : '') + '>8秒</option>' +
                    '<option value="10"' + (_carouselDuration === 10 ? ' selected' : '') + '>10秒</option>' +
                    '<option value="15"' + (_carouselDuration === 15 ? ' selected' : '') + '>15秒</option>' +
                    '<option value="30"' + (_carouselDuration === 30 ? ' selected' : '') + '>30秒</option>' +
                '</select>' +
                '<button class="carousel-loop-btn' + (_carouselLoopMode === 'page' ? ' active' : '') + '" id="carouselLoopBtn" title="切换循环模式">' + (_carouselLoopMode === 'single' ? '单页循环' : '全部循环') + '</button>' +
                '<button class="carousel-auto-btn' + (_carouselAutoPlay ? ' active' : '') + '" id="carouselAutoBtn" title="自动播放">AUTO</button>' +
                '<button class="carousel-btn" id="carouselNext"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></button>' +
                '<button class="carousel-btn" id="carouselLast" title="最后一个"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 5l7 7-7 7M6 5l7 7-7 7"/></svg></button>' +
            '</div>';

        initCarouselLogic(grid, restoreIndex);
    }

    function initCarouselLogic(wrapper, restoreIndex) {
        var track = wrapper.querySelector('#carouselTrack');
        var viewport = wrapper.querySelector('#carouselViewport');
        var progress = wrapper.querySelector('#carouselProgress');
        var fill = wrapper.querySelector('#carouselFill');
        var timeEl = wrapper.querySelector('#carouselTime');
        var prevBtn = wrapper.querySelector('#carouselPrev');
        var nextBtn = wrapper.querySelector('#carouselNext');
        var autoBtn = wrapper.querySelector('#carouselAutoBtn');
        var durationSelect = wrapper.querySelector('#carouselDuration');
        var loopBtn = wrapper.querySelector('#carouselLoopBtn');
        var loadMoreBtn = wrapper.querySelector('#carouselLoadMore');

        var displayItems = _carouselLoopMode === 'single' ? _carouselPageItems : _carouselAllItems;
        var cards = Array.from(track.querySelectorAll('.carousel-card'));

        // 恢复保存的位置（单页模式下索引不能超过当前页数量）
        var currentDisplayItems = _carouselLoopMode === 'single' ? _carouselPageItems : _carouselAllItems;
        var maxIndex = currentDisplayItems.length - 1;
        if (restoreIndex !== undefined && restoreIndex >= 0 && restoreIndex <= maxIndex) {
            _carouselGlobalIndex = restoreIndex;
        } else {
            var savedIndex = parseInt(localStorage.getItem(userKey('carouselIndex')));
            if (!isNaN(savedIndex) && savedIndex >= 0 && savedIndex <= maxIndex) {
                _carouselGlobalIndex = savedIndex;
            } else {
                _carouselGlobalIndex = Math.min(_carouselGlobalIndex, maxIndex);
            }
        }
        if (_carouselGlobalIndex < 0) _carouselGlobalIndex = 0;

        // 激活卡片并加载视频
        function activateCard(idx, instant) {
            // 确保索引在有效范围内
            var currentItems = _carouselLoopMode === 'single' ? _carouselPageItems : _carouselAllItems;
            idx = Math.max(0, Math.min(idx, currentItems.length - 1));
            var oldIdx = _carouselGlobalIndex;
            _carouselGlobalIndex = idx;

            // 暂停旧视频
            var oldCard = track.querySelector('.carousel-card[data-idx="' + oldIdx + '"]');
            if (oldCard) {
                oldCard.classList.remove('active');
                var oldVid = oldCard.querySelector('video');
                if (oldVid && !oldVid.paused) oldVid.pause();
            }

            // 激活新卡片
            var newCard = track.querySelector('.carousel-card[data-idx="' + idx + '"]');
            if (!newCard) return;
            newCard.classList.add('active');

            // 如果是视频，替换缩略图为video元素并播放
            if (newCard.dataset.type === 'video') {
                var existingVid = newCard.querySelector('video');
                if (!existingVid) {
                    var currentItems = _carouselLoopMode === 'single' ? _carouselPageItems : _carouselAllItems;
                    var item = currentItems[idx];
                    if (item) {
                        var thumbWrap = newCard.querySelector('.carousel-thumb-wrap');
                        var oldThumb = thumbWrap.querySelector('.carousel-thumb');
                        if (oldThumb) {
                            var vid = document.createElement('video');
                            vid.className = 'carousel-thumb';
                            vid.muted = true;
                            vid.loop = true;
                            vid.src = API + item.url;
                            oldThumb.replaceWith(vid);
                        }
                    }
                }
                var vid2 = newCard.querySelector('video');
                if (vid2) vid2.play().catch(function(){});
            }

            // 居中
            var cardLeft = newCard.offsetLeft;
            var cardW = newCard.offsetWidth;
            var viewW = viewport.offsetWidth;
            viewport.scrollTo({ left: cardLeft - viewW / 2 + cardW / 2, behavior: instant ? 'instant' : 'smooth' });

            // 更新进度条
            var displayItems2 = _carouselLoopMode === 'single' ? _carouselPageItems : _carouselAllItems;
            var pct = displayItems2.length > 1 ? (idx / (displayItems2.length - 1)) * 100 : 0;
            fill.style.width = Math.min(100, pct) + '%';
            timeEl.textContent = (idx + 1) + ' / ' + displayItems2.length;

            // 更新页码信息
            var pageInfoEl = wrapper.querySelector('#carouselPageInfo');
            if (pageInfoEl) {
                if (_carouselLoopMode === 'page') {
                    // 全部循环模式：根据索引计算当前页码
                    var currentPg = Math.floor(idx / 20) + 1;
                    pageInfoEl.textContent = '第' + currentPg + ' / ' + state.totalPages + ' 页 (共' + displayItems2.length + ' 条)';
                    // 更新上一页/下一页按钮状态
                    var prevPageBtn2 = wrapper.querySelector('#carouselPrevPage');
                    var nextPageBtn2 = wrapper.querySelector('#carouselNextPage');
                    if (prevPageBtn2) {
                        prevPageBtn2.disabled = currentPg <= 1;
                        prevPageBtn2.classList.toggle('disabled', currentPg <= 1);
                    }
                    if (nextPageBtn2) {
                        nextPageBtn2.disabled = currentPg >= state.totalPages;
                        nextPageBtn2.classList.toggle('disabled', currentPg >= state.totalPages);
                    }
                } else {
                    // 单页循环模式：显示state.page
                    var currentPg2 = state.page || 1;
                    pageInfoEl.textContent = '第' + currentPg2 + ' / ' + state.totalPages + ' 页 (共' + displayItems2.length + ' 条)';
                    // 更新上一页/下一页按钮状态
                    var prevPageBtn3 = wrapper.querySelector('#carouselPrevPage');
                    var nextPageBtn3 = wrapper.querySelector('#carouselNextPage');
                    if (prevPageBtn3) {
                        prevPageBtn3.disabled = currentPg2 <= 1;
                        prevPageBtn3.classList.toggle('disabled', currentPg2 <= 1);
                    }
                    if (nextPageBtn3) {
                        nextPageBtn3.disabled = currentPg2 >= state.totalPages;
                        nextPageBtn3.classList.toggle('disabled', currentPg2 >= state.totalPages);
                    }
                }
            }

            // 检查预加载
            checkPreload();

            // 保存位置（保存全局索引和页码）
            if (_carouselLoopMode === 'page') {
                // 全部循环：idx就是全局索引
                localStorage.setItem(userKey('carouselIndex'), idx);
                localStorage.setItem(userKey('carouselPage'), Math.floor(idx / 20) + 1);
            } else {
                // 单页循环：idx是页内索引，转换为全局索引保存
                var globalIdx = (state.page - 1) * 20 + idx;
                localStorage.setItem(userKey('carouselIndex'), globalIdx);
                localStorage.setItem(userKey('carouselPage'), state.page);
            }
        }

        // 点击卡片
        track.addEventListener('click', function (e) {
            if (_carouselDragState.dragged) return;
            if (e.target.closest('.carousel-title') || e.target.closest('.carousel-like-btn') || e.target.closest('.carousel-load-more')) return;
            var card = e.target.closest('.carousel-card');
            if (card) {
                activateCard(parseInt(card.dataset.idx));
                resetAuto();
            }
        });

        // 悬停播放视频
        track.addEventListener('mouseenter', function (e) {
            var card = e.target.closest('.carousel-card');
            if (card && card.dataset.type === 'video' && !card.classList.contains('active')) {
                var vid = card.querySelector('video');
                if (!vid) {
                    var idx = parseInt(card.dataset.idx);
                    var item = displayItems[idx];
                    if (item) {
                        var thumbWrap = card.querySelector('.carousel-thumb-wrap');
                        var oldThumb = thumbWrap.querySelector('.carousel-thumb');
                        if (oldThumb && oldThumb.tagName !== 'VIDEO') {
                            vid = document.createElement('video');
                            vid.className = 'carousel-thumb';
                            vid.muted = true;
                            vid.loop = true;
                            vid.src = API + item.url;
                            oldThumb.replaceWith(vid);
                        }
                    }
                }
                if (vid) { vid.muted = true; vid.play().catch(function(){}); }
            }
        }, true);
        track.addEventListener('mouseleave', function (e) {
            var card = e.target.closest('.carousel-card');
            if (card && !card.classList.contains('active')) {
                var vid = card.querySelector('video');
                if (vid && !vid.paused) vid.pause();
            }
        }, true);

        // 拖拽滚动
        viewport.addEventListener('mousedown', function (e) {
            _carouselDragState.dragging = true;
            _carouselDragState.dragged = false;
            _carouselDragState.startX = e.pageX - viewport.offsetLeft;
            _carouselDragState.scrollLeft = viewport.scrollLeft;
            viewport.classList.add('dragging');
        });
        viewport.addEventListener('mousemove', function (e) {
            if (!_carouselDragState.dragging) return;
            e.preventDefault();
            var x = e.pageX - viewport.offsetLeft;
            var walk = (x - _carouselDragState.startX) * 1.5;
            if (Math.abs(walk) > 5) _carouselDragState.dragged = true;
            viewport.scrollLeft = _carouselDragState.scrollLeft - walk;
        });
        var stopDrag = function () {
            if (_carouselDragState.dragging) {
                _carouselDragState.dragging = false;
                viewport.classList.remove('dragging');
                // 找到最接近中心的卡片并激活
                if (_carouselDragState.dragged) {
                    var center = viewport.scrollLeft + viewport.offsetWidth / 2;
                    var closest = 0, minDist = Infinity;
                    cards.forEach(function (c) {
                        var cCenter = c.offsetLeft + c.offsetWidth / 2;
                        var dist = Math.abs(cCenter - center);
                        if (dist < minDist) { minDist = dist; closest = parseInt(c.dataset.idx); }
                    });
                    activateCard(closest);
                    resetAuto();
                }
            }
        };
        viewport.addEventListener('mouseup', stopDrag);
        viewport.addEventListener('mouseleave', stopDrag);

        // 按钮
        var firstBtn = wrapper.querySelector('#carouselFirst');
        var lastBtn = wrapper.querySelector('#carouselLast');
        if (firstBtn) {
            firstBtn.addEventListener('click', function () { activateCard(0); resetAuto(); });
        }
        if (lastBtn) {
            lastBtn.addEventListener('click', function () {
                var items = _carouselLoopMode === 'single' ? _carouselPageItems : _carouselAllItems;
                activateCard(items.length - 1);
                resetAuto();
            });
        }
        prevBtn.addEventListener('click', function () { activateCard(Math.max(0, _carouselGlobalIndex - 1)); resetAuto(); });
        nextBtn.addEventListener('click', function () {
            var items = _carouselLoopMode === 'single' ? _carouselPageItems : _carouselAllItems;
            activateCard(Math.min(items.length - 1, _carouselGlobalIndex + 1));
            resetAuto();
        });
        autoBtn.addEventListener('click', function () {
            _carouselAutoPlay = !_carouselAutoPlay;
            localStorage.setItem('carouselAutoPlay', _carouselAutoPlay);
            autoBtn.classList.toggle('active', _carouselAutoPlay);
            if (_carouselAutoPlay) startAuto(); else stopAuto();
        });

        // 上一页/下一页按钮
        var prevPageBtn = wrapper.querySelector('#carouselPrevPage');
        var nextPageBtn = wrapper.querySelector('#carouselNextPage');
        if (prevPageBtn) {
            prevPageBtn.addEventListener('click', function () {
                var currentPage = state.page || 1;
                if (currentPage > 1) {
                    window._carouselGoPage(currentPage - 1);
                    // 全部循环模式下重置定时器（单页模式会重新渲染，自动重置）
                    if (_carouselAutoPlay && _carouselLoopMode === 'page') resetAuto();
                }
            });
        }
        if (nextPageBtn) {
            nextPageBtn.addEventListener('click', function () {
                var currentPage = state.page || 1;
                if (currentPage < state.totalPages) {
                    window._carouselGoPage(currentPage + 1);
                    // 全部循环模式下重置定时器（单页模式会重新渲染，自动重置）
                    if (_carouselAutoPlay && _carouselLoopMode === 'page') resetAuto();
                }
            });
        }

        durationSelect.addEventListener('change', function () { _carouselDuration = parseInt(this.value); localStorage.setItem('carouselDuration', _carouselDuration); resetAuto(); });

        loopBtn.addEventListener('click', function () {
            var oldMode = _carouselLoopMode;
            _carouselLoopMode = _carouselLoopMode === 'single' ? 'page' : 'single';
            localStorage.setItem('carouselLoopMode', _carouselLoopMode);
            loopBtn.textContent = _carouselLoopMode === 'single' ? '单页循环' : '全部循环';
            loopBtn.classList.toggle('active', _carouselLoopMode === 'page');

            // 记住当前卡片和视口位置
            var currentCard = track.querySelector('.carousel-card.active');
            var currentId = currentCard ? parseInt(currentCard.dataset.id) : null;
            var viewport = document.getElementById('carouselViewport');
            var savedScrollLeft = viewport ? viewport.scrollLeft : 0;

            // 计算当前在全局中的真实索引
            var savedGlobalIdx = _carouselGlobalIndex;
            if (oldMode === 'single') {
                var pg = state.page || 1;
                savedGlobalIdx = (pg - 1) * 20 + _carouselGlobalIndex;
            }

            if (_carouselLoopMode === 'page') {
                // 切换到全部循环：加载所有页
                _carouselAllItems = [];
                loadAllCarouselPages(1, state.totalPages, function () {
                    // 清空track重新渲染所有卡片
                    var trackEl = document.getElementById('carouselTrack');
                    if (trackEl) {
                        trackEl.innerHTML = '';
                        for (var i = 0; i < _carouselAllItems.length; i++) {
                            appendCardToDOMSimple(_carouselAllItems[i], i);
                        }
                    }
                    // 恢复位置
                    _carouselGlobalIndex = Math.min(savedGlobalIdx, _carouselAllItems.length - 1);
                    if (_carouselGlobalIndex < 0) _carouselGlobalIndex = 0;
                    // 激活卡片并滚动
                    var card = trackEl.querySelector('.carousel-card[data-idx="' + _carouselGlobalIndex + '"]');
                    if (card) {
                        card.classList.add('active');
                        if (viewport) viewport.scrollLeft = card.offsetLeft - viewport.offsetWidth / 2 + card.offsetWidth / 2;
                    }
                    // 更新显示
                    timeEl.textContent = (_carouselGlobalIndex + 1) + ' / ' + _carouselAllItems.length;
                    var pg2 = Math.floor(_carouselGlobalIndex / 20) + 1;
                    var pageInfoEl = wrapper.querySelector('#carouselPageInfo');
                    if (pageInfoEl) pageInfoEl.textContent = '第' + pg2 + ' / ' + state.totalPages + ' 页 (共' + _carouselAllItems.length + ' 条)';
                    var pct = _carouselAllItems.length > 1 ? (_carouselGlobalIndex / (_carouselAllItems.length - 1)) * 100 : 0;
                    fill.style.width = Math.min(100, pct) + '%';
                });
            } else {
                // 切换到单页循环
                var page = Math.floor(savedGlobalIdx / 20) + 1;
                state.page = page;
                var pageStart = (page - 1) * 20;
                var pageEnd = Math.min(pageStart + 20, _carouselAllItems.length);
                _carouselPageItems = _carouselAllItems.slice(pageStart, pageEnd);
                // 页内索引
                _carouselGlobalIndex = savedGlobalIdx - pageStart;
                if (_carouselGlobalIndex < 0) _carouselGlobalIndex = 0;
                if (_carouselGlobalIndex >= _carouselPageItems.length) _carouselGlobalIndex = _carouselPageItems.length - 1;
                // 清空track重新渲染当前页卡片
                var trackEl2 = document.getElementById('carouselTrack');
                if (trackEl2) {
                    trackEl2.innerHTML = '';
                    for (var j = 0; j < _carouselPageItems.length; j++) {
                        appendCardToDOMSimple(_carouselPageItems[j], j);
                    }
                    // 激活卡片并滚动
                    var card2 = trackEl2.querySelector('.carousel-card[data-idx="' + _carouselGlobalIndex + '"]');
                    if (card2) {
                        card2.classList.add('active');
                        if (viewport) viewport.scrollLeft = card2.offsetLeft - viewport.offsetWidth / 2 + card2.offsetWidth / 2;
                    }
                }
                // 更新显示
                timeEl.textContent = (_carouselGlobalIndex + 1) + ' / ' + _carouselPageItems.length;
                var pageInfoEl2 = wrapper.querySelector('#carouselPageInfo');
                if (pageInfoEl2) pageInfoEl2.textContent = '第' + page + ' / ' + state.totalPages + ' 页 (共' + _carouselPageItems.length + ' 条)';
                var pct2 = _carouselPageItems.length > 1 ? (_carouselGlobalIndex / (_carouselPageItems.length - 1)) * 100 : 0;
                fill.style.width = Math.min(100, pct2) + '%';
            }
        });

        // 点击页码选择页
        timeEl.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            var displayItems2 = _carouselLoopMode === 'single' ? _carouselPageItems : _carouselAllItems;
            var totalPages = Math.ceil(displayItems2.length / 20);
            if (totalPages <= 1) return;

            // 关闭已有的弹窗
            var existingPopup = document.getElementById('carouselPagePopup');
            if (existingPopup) { existingPopup.remove(); return; }

            var popup = document.createElement('div');
            popup.className = 'carousel-page-popup';
            popup.id = 'carouselPagePopup';
            popup.onclick = function(ev) { ev.stopPropagation(); };
            var html = '<div class="carousel-page-title">跳转到</div><div class="carousel-page-list">';
            for (var p = 1; p <= totalPages; p++) {
                var start = (p - 1) * 20 + 1;
                var end = Math.min(p * 20, displayItems2.length);
                var isCurrent = _carouselGlobalIndex >= (p - 1) * 20 && _carouselGlobalIndex < p * 20;
                html += '<div class="carousel-page-item' + (isCurrent ? ' active' : '') + '" data-page="' + p + '">' + start + '-' + end + '</div>';
            }
            html += '</div>';
            popup.innerHTML = html;

            var rect = timeEl.getBoundingClientRect();
            popup.style.position = 'fixed';
            popup.style.top = Math.max(10, rect.top - totalPages * 32 - 16) + 'px';
            popup.style.left = rect.left + 'px';
            document.body.appendChild(popup);

            popup.querySelectorAll('.carousel-page-item').forEach(function (item) {
                item.addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    var page = parseInt(item.dataset.page);
                    var idx = (page - 1) * 20;
                    activateCard(idx);
                    resetAuto();
                    popup.remove();
                });
            });

            function closePopup(ev) {
                if (!popup.contains(ev.target) && ev.target !== timeEl) {
                    popup.remove();
                    document.removeEventListener('click', closePopup);
                }
            }
            setTimeout(function () { document.addEventListener('click', closePopup); }, 100);
        });

        // 进度条点击
        progress.addEventListener('click', function (e) {
            var rect = progress.getBoundingClientRect();
            var pct = (e.clientX - rect.left) / rect.width;
            var idx = Math.round(pct * (state.pageSize - 1));
            activateCard(idx);
            resetAuto();
        });

        // 滚轮
        viewport.addEventListener('wheel', function (e) {
            e.preventDefault();
            activateCard(_carouselGlobalIndex + (e.deltaY > 0 ? 1 : -1));
            resetAuto();
        }, { passive: false });

        // 追加卡片到DOM
        function appendCardToDOM(v) {
            var isImage = v.type === 'image';
            var thumbSrc = isImage ? (v.thumbUrl ? API + v.thumbUrl : API + v.url) : (v.thumbUrl ? API + v.thumbUrl : '');
            var title = esc(v.title || '');
            var likedCls = v.liked ? ' liked' : '';
            var badge = isImage ? '<span class="card-badge card-badge-img carousel-badge">图片</span>' : (v.duration ? '<span class="card-badge carousel-badge">' + esc(v.duration) + '</span>' : '');
            var idx = _carouselAllItems.length - 1;
            var cardHtml = '<div class="carousel-card" data-id="' + v.id + '" data-idx="' + idx + '" data-type="' + (isImage ? 'image' : 'video') + '">' +
                '<div class="carousel-thumb-wrap"><img class="carousel-thumb" src="' + thumbSrc + '" data-idx="' + idx + '" onerror="this.outerHTML=\'<div class=carousel-thumb-empty>?</div>\'"/>' + badge +
                '<div class="carousel-info">' +
                    '<div class="carousel-title" onclick="event.stopPropagation();window._openDetail(' + v.id + ')" style="cursor:pointer">' + title + '</div>' +
                    '<div class="carousel-meta"><span>' + fmtSize(v.fileSize) + '</span>' +
                    '<button class="carousel-like-btn' + likedCls + '" onclick="event.stopPropagation();window._like(' + v.id + ',this)">' +
                        '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
                        '<span>' + (v.likeCount || 0) + '</span></button></div>' +
                '</div></div></div>';
            var loadMoreEl = track.querySelector('.carousel-load-more');
            if (loadMoreEl) {
                loadMoreEl.insertAdjacentHTML('beforebegin', cardHtml);
            } else {
                track.insertAdjacentHTML('beforeend', cardHtml);
            }
        }

        // 加载下一页（不重新渲染，只追加卡片）
        var _carouselPreloaded = false;
        function loadNextPage(callback) {
            if (_carouselLoading || state.page >= state.totalPages) { if (callback) callback(); return; }
            _carouselLoading = true;
            state.page++;
            var params = new URLSearchParams({ page: state.page, pageSize: 20 });
            if (state.keyword) params.set('keyword', state.keyword);
            if (state.type) params.set('type', state.type);
            if (state.category) params.set('category', state.category);
            var url = state.currentView === 'likes' ? '/api/likes' : '/api/videos';
            api('GET', url + '?' + params).then(function (r) {
                _carouselLoading = false;
                _carouselPreloaded = false;
                if (r.code === 200 && r.data) {
                    state.totalPages = r.data.totalPages;
                    var newItems = r.data.list || [];
                    var existingIds = new Set(_carouselAllItems.map(function(v) { return v.id; }));
                    newItems.forEach(function (v) {
                        if (!existingIds.has(v.id)) {
                            _carouselAllItems.push(v);
                            appendCardToDOM(v);
                        }
                    });
                    var displayItems3 = _carouselLoopMode === 'single' ? _carouselPageItems : _carouselAllItems;
                    timeEl.textContent = (_carouselGlobalIndex + 1) + ' / ' + displayItems3.length;
                    // 更新页码信息
                    var pageInfoEl = wrapper.querySelector('#carouselPageInfo');
                    if (pageInfoEl) {
                        pageInfoEl.textContent = '第' + state.page + ' / ' + state.totalPages + ' 页 (共' + displayItems3.length + ' 条)';
                    }
                }
                if (callback) callback();
            });
        }

        // 预加载检查：距离末尾5个时提前加载
        function checkPreload() {
            if (_carouselLoopMode !== 'page') return;
            if (_carouselLoading || _carouselPreloaded) return;
            if (state.page >= state.totalPages) return;
            var displayItems2 = _carouselAllItems;
            var remaining = displayItems2.length - _carouselGlobalIndex - 1;
            if (remaining <= 5) {
                _carouselPreloaded = true;
                loadNextPage();
            }
        }

        // 使用事件委托处理加载更多按钮
        track.addEventListener('click', function (e) {
            var btn = e.target.closest('.carousel-load-more');
            if (btn) {
                e.stopPropagation();
                loadNextPage();
            }
        });

        // 自动播放
        function nextSlide() {
            var displayItems2 = _carouselLoopMode === 'single' ? _carouselPageItems : _carouselAllItems;
            var nextIdx = _carouselGlobalIndex + 1;
            if (nextIdx >= displayItems2.length) {
                if (_carouselLoopMode === 'page') {
                    if (state.page < state.totalPages) {
                        // 等加载完再继续
                        if (_carouselLoading) return;
                        loadNextPage(function () {
                            activateCard(_carouselGlobalIndex + 1);
                        });
                        return;
                    }
                    nextIdx = 0;
                } else {
                    nextIdx = 0;
                }
            }
            activateCard(nextIdx);
            checkPreload();
        }

        function startAuto() { stopAuto(); _carouselTimer = setInterval(nextSlide, _carouselDuration * 1000); }
        function stopAuto() { if (_carouselTimer) { clearInterval(_carouselTimer); _carouselTimer = null; } }
        function resetAuto() { if (_carouselAutoPlay) { stopAuto(); startAuto(); } }

        viewport.addEventListener('mouseenter', function () { if (!_carouselDragState.dragging) stopAuto(); });
        viewport.addEventListener('mouseleave', function () { if (_carouselAutoPlay && !_carouselDragState.dragging) startAuto(); });

        // 初始化（瞬时定位，不播放动画）
        activateCard(_carouselGlobalIndex, true);
        if (_carouselAutoPlay) startAuto();
    }

    // === 各模式初始化函数 ===

    // 轮播焦点模式初始化
    var carouselAutoTimer = null;
    var carouselCurrentIndex = 0;
    var carouselVideoTimer = null;

    function initCarouselMode() {
        var grid = document.getElementById('videoGrid');
        var cards = Array.from(grid.querySelectorAll('.carousel-card'));
        if (cards.length === 0) return;

        carouselCurrentIndex = Math.floor(cards.length / 2);

        // 添加统一进度条
        var existingBar = grid.parentElement.querySelector('.carousel-progress-bar');
        if (existingBar) existingBar.remove();
        var barWrap = document.createElement('div');
        barWrap.className = 'carousel-progress-bar';
        barWrap.innerHTML = '<div class="carousel-progress-track"><div class="carousel-progress-fill"></div><div class="carousel-progress-thumb"></div></div><div class="carousel-progress-time"><span class="carousel-time-current"></span><span class="carousel-time-info"></span></div>';
        grid.parentElement.appendChild(barWrap);

        var track = barWrap.querySelector('.carousel-progress-track');
        var fill = barWrap.querySelector('.carousel-progress-fill');
        var thumb = barWrap.querySelector('.carousel-progress-thumb');
        var timeCurrent = barWrap.querySelector('.carousel-time-current');
        var timeInfo = barWrap.querySelector('.carousel-time-info');

        // 居中滚动到指定卡片
        function scrollToCard(index) {
            var card = cards[index];
            if (!card) return;
            var container = grid;
            var cardCenter = card.offsetLeft + card.offsetWidth / 2;
            var containerCenter = container.offsetWidth / 2;
            container.scrollTo({ left: cardCenter - containerCenter, behavior: 'smooth' });
        }

        // 更新进度条（视频进度或轮播位置）
        function updateProgress() {
            var activeCard = cards[carouselCurrentIndex];
            if (!activeCard) return;

            if (activeCard.dataset.type === 'video') {
                var vid = activeCard.querySelector('video');
                if (vid && vid.duration && !isNaN(vid.duration)) {
                    var pct = (vid.currentTime / vid.duration) * 100;
                    fill.style.width = pct + '%';
                    thumb.style.left = pct + '%';
                    timeCurrent.textContent = formatDuration(vid.currentTime) + ' / ' + formatDuration(vid.duration);
                    timeInfo.textContent = (carouselCurrentIndex + 1) + ' / ' + cards.length;
                    return;
                }
            }
            // 图片或视频无时长：显示轮播位置
            var posPct = cards.length > 1 ? (carouselCurrentIndex / (cards.length - 1)) * 100 : 0;
            fill.style.width = posPct + '%';
            thumb.style.left = posPct + '%';
            timeCurrent.textContent = '';
            timeInfo.textContent = (carouselCurrentIndex + 1) + ' / ' + cards.length;
        }

        // 更新轮播状态
        function updateCarousel(index, noScroll) {
            carouselCurrentIndex = Math.max(0, Math.min(cards.length - 1, index));

            // 停止旧视频进度更新
            if (carouselVideoTimer) { clearInterval(carouselVideoTimer); carouselVideoTimer = null; }

            cards.forEach(function (c, i) {
                c.classList.toggle('active', i === carouselCurrentIndex);
                if (i !== carouselCurrentIndex) {
                    var vid = c.querySelector('video');
                    if (vid && !vid.paused) vid.pause();
                }
            });

            var activeCard = cards[carouselCurrentIndex];
            if (activeCard && activeCard.dataset.type === 'video') {
                var vid = activeCard.querySelector('video');
                if (vid) {
                    if (!vid.src && vid.dataset.src) vid.src = vid.dataset.src;
                    vid.play().catch(function(){});
                    // 视频进度实时更新
                    carouselVideoTimer = setInterval(updateProgress, 200);
                }
            }

            if (!noScroll) scrollToCard(carouselCurrentIndex);
            updateProgress();
        }

        // 点击卡片切换
        cards.forEach(function (card, i) {
            card.addEventListener('click', function () {
                updateCarousel(i);
                resetCarouselAuto();
            });
            // 悬停播放视频
            card.addEventListener('mouseenter', function () {
                if (card.dataset.type === 'video') {
                    var vid = card.querySelector('video');
                    if (vid) {
                        if (!vid.src && vid.dataset.src) vid.src = vid.dataset.src;
                        vid.play().catch(function(){});
                    }
                }
            });
            card.addEventListener('mouseleave', function () {
                if (card.dataset.type === 'video' && !card.classList.contains('active')) {
                    var vid = card.querySelector('video');
                    if (vid && !vid.paused) vid.pause();
                }
            });
        });

        // 进度条拖拽
        var dragging = false;
        function seekFromX(e) {
            var rect = track.getBoundingClientRect();
            var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            var activeCard = cards[carouselCurrentIndex];

            // 如果当前是视频且有进度，拖拽控制视频
            if (activeCard && activeCard.dataset.type === 'video') {
                var vid = activeCard.querySelector('video');
                if (vid && vid.duration && !isNaN(vid.duration)) {
                    vid.currentTime = pct * vid.duration;
                    updateProgress();
                    return;
                }
            }
            // 否则控制轮播位置
            var idx = Math.round(pct * (cards.length - 1));
            updateCarousel(idx);
        }

        track.addEventListener('mousedown', function (e) {
            dragging = true;
            seekFromX(e);
            stopCarouselAuto();
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        function onMove(e) { if (dragging) seekFromX(e); }
        function onUp() {
            dragging = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            startCarouselAuto();
        }

        // 鼠标滚轮切换
        grid.parentElement.addEventListener('wheel', function (e) {
            e.preventDefault();
            var delta = e.deltaY > 0 ? 1 : -1;
            updateCarousel(carouselCurrentIndex + delta);
            resetCarouselAuto();
        }, { passive: false });

        // 自动滚动
        function startCarouselAuto() {
            stopCarouselAuto();
            carouselAutoTimer = setInterval(function () {
                updateCarousel(carouselCurrentIndex + 1 >= cards.length ? 0 : carouselCurrentIndex + 1);
            }, 3000);
        }
        function stopCarouselAuto() {
            if (carouselAutoTimer) { clearInterval(carouselAutoTimer); carouselAutoTimer = null; }
        }
        function resetCarouselAuto() {
            stopCarouselAuto();
            startCarouselAuto();
        }

        // 鼠标悬停暂停自动滚动
        grid.parentElement.addEventListener('mouseenter', stopCarouselAuto);
        grid.parentElement.addEventListener('mouseleave', startCarouselAuto);

        // 初始化
        grid.style.overflowX = 'auto';
        grid.style.scrollSnapType = 'none';
        updateCarousel(carouselCurrentIndex);
        startCarouselAuto();
    }

    // 蜂巢模式初始化
    // 3D卡片墙动画初始化
    function initWall3DAnimations() {
        var grid = document.getElementById('videoGrid');
        var cards = grid.querySelectorAll('.wall3d-card');
        cards.forEach(function (card, index) {
            card.style.animationDelay = (index * 0.08) + 's';
            card.classList.add('wall3d-card-animate');
        });
    }

    // 沉浸式画廊滑动初始化
    function initGallerySwipe() {
        var grid = document.getElementById('videoGrid');
        grid.classList.add('gallery-grid');
    }

    // 画廊查看器
    var galleryViewerItems = [];
    var galleryViewerIndex = 0;
    var galleryViewerLoading = false;
    var galleryViewerPage = 1;
    var gallerySlideshowTimer = null;
    var gallerySlideshowInterval = parseInt(localStorage.getItem('gallerySlideshowInterval')) || 3;
    var gallerySlideshowTransition = localStorage.getItem('gallerySlideshowTransition') || 'fade';
    var galleryTotalImageCount = 0;

    function openGalleryViewer(id) {
        // 收集当前列表中的所有图片
        galleryViewerItems = [];
        galleryViewerPage = 1;
        var grid = document.getElementById('videoGrid');
        var cards = grid.querySelectorAll('.gallery-card[data-type="image"]');
        cards.forEach(function (card, index) {
            galleryViewerItems.push(parseInt(card.dataset.id));
            if (parseInt(card.dataset.id) === id) {
                galleryViewerIndex = index;
            }
        });

        if (galleryViewerItems.length === 0) {
            showImage(id);
            return;
        }

        // 获取全部图片数量
        galleryTotalImageCount = state.totalPages * (state.viewMode === 'gallery' ? 21 : state.pageSize);
        // 异步获取真实数量
        api('GET', '/api/videos?pageSize=1&type=image' + (state.keyword ? '&keyword=' + encodeURIComponent(state.keyword) : '') + (state.category ? '&category=' + encodeURIComponent(state.category) : '')).then(function(r) {
            if (r.code === 200 && r.data) {
                galleryTotalImageCount = r.data.total || galleryViewerItems.length;
                var counter = document.getElementById('galleryViewerCounter');
                if (counter) counter.textContent = (galleryViewerIndex + 1) + ' / ' + galleryTotalImageCount;
            }
        });

        // 创建全屏查看器
        var viewer = document.createElement('div');
        viewer.className = 'gallery-viewer';
        viewer.id = 'galleryViewer';
        viewer.innerHTML =
            '<div class="gallery-viewer-bg"></div>' +
            '<button class="gallery-viewer-close" onclick="window._closeGalleryViewer()">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>' +
            '<button class="gallery-viewer-prev" onclick="window._galleryViewerPrev()">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>' +
            '</button>' +
            '<button class="gallery-viewer-next" onclick="window._galleryViewerNext()">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' +
            '</button>' +
            '<div class="gallery-viewer-content">' +
                '<img id="galleryViewerImage" class="gallery-viewer-image gallery-transition-' + gallerySlideshowTransition + '" src="' + API + '/api/stream/video/' + id + '"/>' +
            '</div>' +
            '<div class="gallery-viewer-actions">' +
                '<button class="gallery-viewer-action-btn" id="galleryViewerLikeBtn" onclick="event.stopPropagation();window._galleryViewerLike()" title="点赞">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
                '</button>' +
                '<button class="gallery-viewer-action-btn" onclick="event.stopPropagation();window._galleryViewerDetail()" title="详情">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>' +
                '</button>' +
                '<button class="gallery-viewer-action-btn" id="galleryViewerLocateBtn" onclick="event.stopPropagation();window._galleryViewerLocate()" title="定位到页面">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
                '</button>' +
                '<div class="slideshow-wrapper" onmouseenter="window._showSlideshowSettings()" onmouseleave="window._hideSlideshowSettings()">' +
                    '<button class="gallery-viewer-action-btn" id="galleryViewerSlideshowBtn" onclick="event.stopPropagation();window._galleryViewerToggleSlideshow()" title="幻灯片播放">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
                    '</button>' +
                    '<div class="gallery-viewer-slideshow-settings" id="gallerySlideshowSettings">' +
                        '<div class="slideshow-setting">' +
                            '<select id="gallerySlideshowIntervalSelect" onchange="window._galleryViewerSetInterval(this.value)">' +
                                '<option value="0">间隔</option>' +
                                '<option value="2">2秒</option>' +
                                '<option value="3"' + (gallerySlideshowInterval === 3 ? ' selected' : '') + '>3秒</option>' +
                                '<option value="5">5秒</option>' +
                                '<option value="8">8秒</option>' +
                                '<option value="10">10秒</option>' +
                            '</select>' +
                        '</div>' +
                        '<div class="slideshow-setting">' +
                            '<select id="gallerySlideshowTransitionSelect" onchange="window._galleryViewerSetTransition(this.value)">' +
                                '<option value="">动画</option>' +
                                '<option value="fade"' + (gallerySlideshowTransition === 'fade' ? ' selected' : '') + '>淡入淡出</option>' +
                                '<option value="slide">左右滑动</option>' +
                                '<option value="zoom">缩放</option>' +
                            '</select>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="gallery-viewer-counter"><span id="galleryViewerCounter">' + (galleryViewerIndex + 1) + ' / ' + galleryTotalImageCount + '</span></div>';

        document.body.appendChild(viewer);
        setTimeout(function () { viewer.classList.add('active'); }, 10);

        // 鼠标在图片上移动时显示操作栏，静止后自动隐藏
        var viewerHideTimer = null;
        function showViewerControls() {
            viewer.classList.add('controls-visible');
            if (viewerHideTimer) clearTimeout(viewerHideTimer);
            viewerHideTimer = setTimeout(function () { viewer.classList.remove('controls-visible'); }, 2000);
        }
        var viewerImg = document.getElementById('galleryViewerImage');
        if (viewerImg) {
            viewerImg.addEventListener('mousemove', showViewerControls);
            viewerImg.addEventListener('mouseleave', function () {
                if (viewerHideTimer) clearTimeout(viewerHideTimer);
                viewerHideTimer = setTimeout(function () { viewer.classList.remove('controls-visible'); }, 300);
            });
        }
        // 操作栏自身也保持显示
        var viewerActions = viewer.querySelector('.gallery-viewer-actions');
        if (viewerActions) {
            viewerActions.addEventListener('mouseenter', function () {
                if (viewerHideTimer) clearTimeout(viewerHideTimer);
                viewer.classList.add('controls-visible');
            });
            viewerActions.addEventListener('mouseleave', showViewerControls);
        }
        // 打开时自动显示2秒
        showViewerControls();

        // 记录浏览
        api('POST', '/api/videos/' + id + '/view');

        // 键盘事件
        document.addEventListener('keydown', galleryViewerKeyHandler);
    }

    function closeGalleryViewer() {
        var viewer = document.getElementById('galleryViewer');
        if (viewer) {
            viewer.classList.remove('active');
            setTimeout(function () { viewer.remove(); }, 300);
        }
        document.removeEventListener('keydown', galleryViewerKeyHandler);
        galleryViewerLoading = false;
        stopGallerySlideshow();
    }

    function galleryViewerPrev() {
        if (galleryViewerItems.length === 0) return;
        galleryViewerIndex = (galleryViewerIndex - 1 + galleryViewerItems.length) % galleryViewerItems.length;
        updateGalleryViewerImage();
        cleanupGalleryViewerCache();
    }

    // 幻灯片播放控制
    function startGallerySlideshow() {
        stopGallerySlideshow();
        var btn = document.getElementById('galleryViewerSlideshowBtn');
        if (btn) btn.classList.add('active');
        gallerySlideshowTimer = setInterval(function () {
            galleryViewerNext();
        }, gallerySlideshowInterval * 1000);
    }

    function stopGallerySlideshow() {
        if (gallerySlideshowTimer) {
            clearInterval(gallerySlideshowTimer);
            gallerySlideshowTimer = null;
        }
        var btn = document.getElementById('galleryViewerSlideshowBtn');
        if (btn) btn.classList.remove('active');
    }

    function galleryViewerToggleSlideshow() {
        if (gallerySlideshowTimer) {
            stopGallerySlideshow();
        } else {
            startGallerySlideshow();
        }
    }

    function showSlideshowSettings() {
        var settings = document.getElementById('gallerySlideshowSettings');
        if (settings) settings.classList.add('show');
    }

    function hideSlideshowSettings() {
        var settings = document.getElementById('gallerySlideshowSettings');
        if (settings) settings.classList.remove('show');
    }

    function galleryViewerSetInterval(val) {
        gallerySlideshowInterval = parseInt(val);
        localStorage.setItem('gallerySlideshowInterval', gallerySlideshowInterval);
        if (gallerySlideshowTimer) startGallerySlideshow();
        // 选择后收起菜单
        var settings = document.getElementById('gallerySlideshowSettings');
        if (settings) settings.classList.remove('show');
    }

    function galleryViewerSetTransition(val) {
        gallerySlideshowTransition = val;
        localStorage.setItem('gallerySlideshowTransition', val);
        var img = document.getElementById('galleryViewerImage');
        if (img) {
            img.className = 'gallery-viewer-image gallery-transition-' + val;
        }
        // 选择后收起菜单
        var settings = document.getElementById('gallerySlideshowSettings');
        if (settings) settings.classList.remove('show');
    }

    function galleryViewerNext() {
        if (galleryViewerItems.length === 0) return;
        // 如果到达最后一页且还有下一页，自动加载
        if (galleryViewerIndex >= galleryViewerItems.length - 1 && state.page < state.totalPages && !galleryViewerLoading) {
            galleryViewerLoadNextPage(function() {
                galleryViewerIndex++;
                updateGalleryViewerImage();
                cleanupGalleryViewerCache();
            });
            return;
        }
        galleryViewerIndex = (galleryViewerIndex + 1) % galleryViewerItems.length;
        updateGalleryViewerImage();
        cleanupGalleryViewerCache();
    }

    function updateGalleryViewerImage() {
        var id = galleryViewerItems[galleryViewerIndex];
        var img = document.getElementById('galleryViewerImage');
        var counter = document.getElementById('galleryViewerCounter');
        if (img) {
            img.classList.add('gallery-viewer-transition');
            setTimeout(function () {
                img.src = API + '/api/stream/video/' + id;
                img.classList.remove('gallery-viewer-transition');
            }, 300);
        }
        var displayTotal = galleryTotalImageCount > galleryViewerItems.length ? galleryTotalImageCount : galleryViewerItems.length;
        if (counter) counter.textContent = (galleryViewerIndex + 1) + ' / ' + displayTotal;
        api('POST', '/api/videos/' + id + '/view');
        // 更新点赞按钮状态
        updateGalleryViewerLikeBtn(id);
    }

    function updateGalleryViewerLikeBtn(id) {
        api('GET', '/api/videos/' + id).then(function (r) {
            if (r.code === 200 && r.data) {
                var btn = document.getElementById('galleryViewerLikeBtn');
                if (btn) {
                    btn.classList.toggle('liked', !!r.data.liked);
                    var svg = btn.querySelector('svg');
                    if (svg) svg.setAttribute('fill', r.data.liked ? 'currentColor' : 'none');
                }
            }
        });
    }

    function galleryViewerLike() {
        var id = galleryViewerItems[galleryViewerIndex];
        if (!id) return;
        api('POST', '/api/videos/' + id + '/like').then(function (r) {
            if (r.code === 200) {
                toast(r.data);
                var isLiked = r.data === '已点赞';
                var btn = document.getElementById('galleryViewerLikeBtn');
                if (btn) {
                    btn.classList.toggle('liked', isLiked);
                    var svg = btn.querySelector('svg');
                    if (svg) svg.setAttribute('fill', isLiked ? 'currentColor' : 'none');
                }
                // 更新卡片上的点赞状态
                var card = document.querySelector('.gallery-card[data-id="' + id + '"]');
                if (card) {
                    var cardLikeBtn = card.querySelector('.gallery-float-like');
                    if (cardLikeBtn) {
                        cardLikeBtn.classList.toggle('liked', isLiked);
                        var cardSvg = cardLikeBtn.querySelector('svg');
                        if (cardSvg) cardSvg.setAttribute('fill', isLiked ? 'currentColor' : 'none');
                    }
                }
            }
        });
    }

    function galleryViewerDetail() {
        var id = galleryViewerItems[galleryViewerIndex];
        if (!id) return;
        closeGalleryViewer();
        openDetail(id);
    }

    function galleryViewerLocate() {
        var id = galleryViewerItems[galleryViewerIndex];
        if (!id) return;
        // 计算当前图片在第几页
        var pageSize = state.viewMode === 'gallery' ? 21 : state.pageSize;
        var itemIndex = galleryViewerItems.indexOf(id);
        var pageNum = Math.floor(itemIndex / pageSize) + 1;
        // 关闭查看器
        closeGalleryViewer();
        // 跳转到对应页
        if (pageNum !== state.page) {
            state.page = pageNum;
            if (state.currentView === 'likes') loadLikedVideos();
            else loadVideos();
        }
        // 滚动到对应卡片位置
        setTimeout(function () {
            var card = document.querySelector('.gallery-card[data-id="' + id + '"]');
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.style.outline = '2px solid var(--accent)';
                card.style.outlineOffset = '2px';
                setTimeout(function () {
                    card.style.outline = '';
                    card.style.outlineOffset = '';
                }, 2000);
            }
        }, 300);
        toast('已定位到第' + pageNum + '页');
    }

    // 加载下一页数据
    function galleryViewerLoadNextPage(callback) {
        if (galleryViewerLoading) return;
        if (state.page >= state.totalPages) return;
        galleryViewerLoading = true;
        galleryViewerPage = state.page + 1;

        var pageSize = state.viewMode === 'gallery' ? 21 : state.pageSize;
        var params = new URLSearchParams({ page: galleryViewerPage, pageSize: pageSize });
        if (state.keyword) params.set('keyword', state.keyword);
        if (state.type) params.set('type', state.type);
        if (state.category) params.set('category', state.category);

        var url = state.currentView === 'likes' ? '/api/likes' : '/api/videos';
        api('GET', url + '?' + params).then(function (r) {
            if (r.code === 200 && r.data) {
                state.page = r.data.page;
                state.totalPages = r.data.totalPages;
                var newItems = (r.data.list || []).filter(function (v) { return v.type === 'image'; });
                var existingIds = new Set(galleryViewerItems);
                newItems.forEach(function (v) {
                    if (!existingIds.has(v.id)) {
                        galleryViewerItems.push(v.id);
                        existingIds.add(v.id);
                    }
                });
                // 更新计数器
                var counter = document.getElementById('galleryViewerCounter');
                if (counter) counter.textContent = (galleryViewerIndex + 1) + ' / ' + galleryViewerItems.length;
                if (callback) callback();
            }
            galleryViewerLoading = false;
        }).catch(function () {
            galleryViewerLoading = false;
        });
    }

    // 清理远处图片缓存
    function cleanupGalleryViewerCache() {
        var cacheDistance = 10;
        var img = document.getElementById('galleryViewerImage');
        if (!img) return;
        // 预加载前后各2张
        preloadGalleryImages();
    }

    // 预加载附近图片
    function preloadGalleryImages() {
        var preloadRange = 2;
        for (var i = -preloadRange; i <= preloadRange; i++) {
            var idx = galleryViewerIndex + i;
            if (idx >= 0 && idx < galleryViewerItems.length && idx !== galleryViewerIndex) {
                var preloadImg = new Image();
                preloadImg.src = API + '/api/stream/video/' + galleryViewerItems[idx];
            }
        }
    }

    function galleryViewerKeyHandler(e) {
        switch (e.key) {
            case 'Escape': closeGalleryViewer(); break;
            case 'ArrowLeft': e.preventDefault(); e.stopPropagation(); galleryViewerPrev(); break;
            case 'ArrowRight': e.preventDefault(); e.stopPropagation(); galleryViewerNext(); break;
            case 'F11':
                e.preventDefault();
                var viewer = document.getElementById('galleryViewer');
                if (viewer) {
                    if (document.fullscreenElement) {
                        document.exitFullscreen();
                    } else {
                        viewer.requestFullscreen();
                    }
                }
                break;
        }
    }

    function renderTags(v) {
        var tags = '';
        if (v.category) tags += '<span class="tag-category" onclick="event.stopPropagation();window._filter(\'\',\'' + esc(v.category) + '\')">' + esc(v.category) + '</span>';
        if (v.hashtag) {
            tags += v.hashtag.split(',').map(function (t) {
                return '<span onclick="event.stopPropagation();window._searchTag(this.textContent)">' + esc(t) + '</span>';
            }).join('');
        }
        return tags ? '<div class="card-tags">' + tags + '</div>' : '';
    }

    function renderBadge(v, isImage, isRemoved) {
        if (isRemoved) return '';
        var badges = '';
        if (isImage) badges += '<span class="card-badge card-badge-img">图片</span>';
        else if (v.duration) badges += '<span class="card-badge">' + esc(v.duration) + '</span>';
        return badges;
    }

    // Feed模式视频控制
    var currentFeedVideo = null;

    function toggleFeedPlay(wrap, videoId) {
        var video = wrap.querySelector('video');
        if (!video) return;

        if (currentFeedVideo && currentFeedVideo !== video) {
            currentFeedVideo.pause();
            currentFeedVideo.muted = true;
            currentFeedVideo.currentTime = 0;
        }

        if (video.paused) {
            if (!video.src) video.src = video.dataset.src;
            video.muted = false;
            video.play().catch(function () {});
            currentFeedVideo = video;
            trackFeedTime(video, wrap);
            trackViewCount(video, videoId);
        } else {
            video.pause();
        }
    }

    function feedHover(video) {
        if (video.paused) {
            if (!video.src) video.src = video.dataset.src;
            video.muted = true;
            video.play().catch(function () {});
        }
    }

    function feedLeave(video) {
        if (currentFeedVideo !== video) {
            video.pause();
            video.currentTime = 0;
        }
    }

    function setFeedVolume(range) {
        var wrap = range.closest('.feed-video-wrap');
        var video = wrap.querySelector('video');
        if (video) {
            video.volume = parseFloat(range.value);
            video.muted = parseFloat(range.value) === 0;
        }
    }

    // 画中画状态追踪
    var pipVideo = null;
    var pipCard = null;
    var pipVideoId = null; // 记录画中画视频ID

    function feedPip(btn) {
        var wrap = btn.closest('.feed-video-wrap');
        var video = wrap.querySelector('video');
        var card = wrap.closest('.feed-card');
        if (!video) return;

        if (document.pictureInPictureElement) {
            // 退出画中画
            document.exitPictureInPicture().catch(function () {});
        } else if (video.requestPictureInPicture) {
            // 确保视频在播放状态
            if (video.paused) {
                video.play().catch(function () {});
            }
            video.muted = false; // 画中画默认有声音

            // 移除旧的事件监听器
            if (pipVideo) {
                pipVideo.removeEventListener('enterpictureinpicture', onEnterPip);
                pipVideo.removeEventListener('leavepictureinpicture', onLeavePip);
            }

            pipVideo = video;
            pipCard = card;
            pipVideoId = card ? card.dataset.videoId : null;

            // 绑定事件
            video.addEventListener('enterpictureinpicture', onEnterPip);
            video.addEventListener('leavepictureinpicture', onLeavePip);

            video.requestPictureInPicture().catch(function () {});
        }
    }

    function onEnterPip() {
        // 画中画进入成功
        console.log('PiP entered');
    }

    function onLeavePip() {
        // 返回标签页 - 滚动到视频位置并继续播放
        if (pipVideo) {
            pipVideo.style.pointerEvents = '';

            // 暂停所有其他视频
            document.querySelectorAll('video').forEach(function (v) {
                if (v !== pipVideo && !v.paused) {
                    v.pause();
                }
            });

            // 检查是否在详情页，如果是则关闭详情页
            var detailView = document.getElementById('detailView');
            if (detailView && detailView.style.display !== 'none') {
                detailView.style.display = 'none';
                document.getElementById('listView').style.display = '';
                state.currentVideoId = null;
                localStorage.removeItem(userKey('detailVideoId'));
            }

            // 尝试找到视频卡片（pipCard可能已失效，用videoId重新查找）
            var targetCard = pipCard;
            if (!targetCard || !document.contains(targetCard)) {
                // 重新查找卡片
                if (pipVideoId) {
                    targetCard = document.querySelector('.feed-card[data-video-id="' + pipVideoId + '"]');
                }
            }

            // 滚动到视频卡片位置
            if (targetCard) {
                targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            // 确保视频继续播放
            if (pipVideo.paused) {
                pipVideo.play().catch(function () {});
            }
            updatePlayBtnState(pipVideo, true);

            // 更新当前播放的视频引用
            currentFeedPlaying = pipVideo;

            pipVideo = null;
            pipCard = null;
            pipVideoId = null;
        }
    }

    function feedFullscreen(btn) {
        var wrap = btn.closest('.feed-video-wrap');
        var video = wrap.querySelector('video');
        if (!video) return;

        // 如果已在全屏，点击则退出
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            document.exitFullscreen().catch(function () {});
            return;
        }

        // 确保视频已加载
        if (!video.src) video.src = video.dataset.src;

        // 进入全屏时自动播放并开启声音
        video.muted = false;

        var startPlay = function () {
            video.play().catch(function () {});
            updatePlayBtnState(video, true);
            video.removeEventListener('loadeddata', startPlay);
        };

        if (video.readyState >= 2) {
            video.play().catch(function () {});
            updatePlayBtnState(video, true);
        } else {
            video.addEventListener('loadeddata', startPlay);
        }

        // 禁用视频点击，只允许按钮操作
        video.style.pointerEvents = 'none';

        // 让 wrap 元素全屏
        if (wrap.requestFullscreen) wrap.requestFullscreen().catch(function () {});
        else if (wrap.webkitRequestFullscreen) wrap.webkitRequestFullscreen();
        else if (wrap.msRequestFullscreen) wrap.msRequestFullscreen();

        // 加载弹幕数据并启动弹幕循环
        var card = wrap.closest('.feed-card');
        var fsVideoId = card ? parseInt(card.dataset.videoId) : null;
        var fsDanmakuLayerId = fsVideoId ? ('danmakuLayerFeed' + fsVideoId) : null;
        if (fsVideoId) {
            api('GET', '/api/videos/' + fsVideoId + '/danmaku').then(function (r) {
                if (r.code === 200 && r.data) {
                    _feedDanmakuData[fsVideoId] = r.data;
                    if (fsDanmakuLayerId) {
                        startDanmakuLoop(fsVideoId, fsDanmakuLayerId, video);
                        _danmakuVideoId = fsVideoId;
                        _danmakuData = r.data;
                    }
                }
            });
        }

        // 键盘控制（使用捕获阶段，优先于其他处理器）
        var onKeydown = function (e) {
            if (!document.fullscreenElement && !document.webkitFullscreenElement) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            e.preventDefault();
            e.stopPropagation();
            switch (e.key) {
                case ' ':
                    if (video.paused) { video.play().catch(function () {}); updatePlayBtnState(video, true); }
                    else { video.pause(); updatePlayBtnState(video, false); }
                    showCenterIconFs(wrap, video);
                    break;
                case 'ArrowLeft':
                    video.currentTime = Math.max(0, video.currentTime - 5);
                    break;
                case 'ArrowRight':
                    video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
                    break;
                case 'ArrowUp':
                    feedChangeRate(video, wrap, 0.25);
                    break;
                case 'ArrowDown':
                    feedChangeRate(video, wrap, -0.25);
                    break;
            }
        };
        document.addEventListener('keydown', onKeydown, true);

        // 退出全屏时恢复
        var onFsChange = function () {
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                video.muted = state.feedDefaultMuted;
                video.style.pointerEvents = '';
                video.playbackRate = 1;
                updatePlayBtnState(video, !video.paused);
                if (fsDanmakuLayerId) stopDanmakuLoop(fsDanmakuLayerId);
                document.removeEventListener('fullscreenchange', onFsChange);
                document.removeEventListener('webkitfullscreenchange', onFsChange);
                document.removeEventListener('keydown', onKeydown, true);
            }
        };
        document.addEventListener('fullscreenchange', onFsChange);
        document.addEventListener('webkitfullscreenchange', onFsChange);
    }

    // 全屏中间图标闪烁
    function showCenterIconFs(wrap, video) {
        var icon = document.createElement('div');
        icon.className = 'center-icon-flash';
        icon.innerHTML = video.paused ?
            '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>' :
            '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
        wrap.appendChild(icon);
        setTimeout(function () {
            icon.classList.add('fade-out');
            setTimeout(function () { if (icon.parentNode) icon.parentNode.removeChild(icon); }, 300);
        }, 400);
    }

    // 全屏倍率调整
    function feedChangeRate(video, wrap, delta) {
        var rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];
        var current = video.playbackRate;
        var idx = rates.indexOf(current);
        if (idx === -1) idx = rates.indexOf(1);
        var newIdx = Math.max(0, Math.min(rates.length - 1, idx + (delta > 0 ? 1 : -1)));
        video.playbackRate = rates[newIdx];
        showFeedRateIndicator(wrap, rates[newIdx]);
        var rateText = wrap.querySelector('.feed-rate-text');
        if (rateText) rateText.textContent = rates[newIdx] === 1 ? '1x' : rates[newIdx] + 'x';
    }

    function feedToggleMute(btn) {
        var wrap = btn.closest('.feed-video-wrap');
        var video = wrap.querySelector('video');
        if (!video) return;
        video.muted = !video.muted;
        var unmuteIcon = btn.querySelector('.feed-icon-unmute');
        var muteIcon = btn.querySelector('.feed-icon-mute');
        if (unmuteIcon) unmuteIcon.style.display = video.muted ? 'none' : '';
        if (muteIcon) muteIcon.style.display = video.muted ? '' : 'none';
    }

    // 列表模式倍率切换
    var feedRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];

    function feedCycleRate(btn) {
        var wrap = btn.closest('.feed-video-wrap');
        var video = wrap.querySelector('video');
        if (!video) return;
        var current = video.playbackRate;
        var idx = feedRates.indexOf(current);
        var nextIdx = (idx + 1) % feedRates.length;
        video.playbackRate = feedRates[nextIdx];
        var rateText = btn.querySelector('.feed-rate-text');
        if (rateText) rateText.textContent = feedRates[nextIdx] === 1 ? '1x' : feedRates[nextIdx] + 'x';
        showFeedRateIndicator(wrap, feedRates[nextIdx]);
    }

    function showFeedRateIndicator(wrap, rate) {
        var indicator = wrap.querySelector('.feed-rate-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'feed-rate-indicator';
            wrap.appendChild(indicator);
        }
        indicator.textContent = rate === 1 ? '1x' : rate + 'x';
        indicator.classList.add('visible');
        setTimeout(function () { indicator.classList.remove('visible'); }, 3000);
    }

    function trackFeedTime(video, wrap) {
        var timeUpdate = function () {
            var current = wrap.querySelector('.feed-time-current');
            var total = wrap.querySelector('.feed-time-total');
            var progressFill = wrap.querySelector('.feed-progress-fill');
            if (current) current.textContent = formatDuration(video.currentTime);
            if (total) total.textContent = formatDuration(video.duration);
            if (progressFill && video.duration) {
                progressFill.style.width = (video.currentTime / video.duration * 100) + '%';
            }
        };
        video.addEventListener('timeupdate', timeUpdate);
        video.addEventListener('loadedmetadata', timeUpdate);

        // 点击进度条跳转
        var progressBar = wrap.querySelector('.feed-progress-bar');
        if (progressBar) {
            progressBar.addEventListener('click', function (e) {
                var rect = progressBar.getBoundingClientRect();
                var percent = (e.clientX - rect.left) / rect.width;
                video.currentTime = percent * video.duration;
            });
        }
    }

    function formatDuration(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        var m = Math.floor(seconds / 60);
        var s = Math.floor(seconds % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function formatTime(ts) {
        if (!ts) return '';
        var d = new Date(ts), now = new Date(), diff = now - d;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
        if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
        return d.toLocaleDateString();
    }

    // === View Count ===
    var viewTimers = {};

    function trackViewCount(video, videoId) {
        if (viewTimers[videoId]) return;

        var counted = false;
        var checkTime = function () {
            if (counted) return;
            var duration = video.duration;
            if (duration <= 5) {
                counted = true;
                api('POST', '/api/videos/' + videoId + '/view');
                video.removeEventListener('timeupdate', checkTime);
            } else if (video.currentTime >= 5) {
                counted = true;
                api('POST', '/api/videos/' + videoId + '/view');
                video.removeEventListener('timeupdate', checkTime);
            }
        };
        video.addEventListener('timeupdate', checkTime);
        viewTimers[videoId] = setTimeout(function () {
            if (!counted) {
                counted = true;
                api('POST', '/api/videos/' + videoId + '/view');
            }
            delete viewTimers[videoId];
        }, 6000);
    }

    // === Detail Page ===
    var savedScrollPosition = 0;
    var savedCarouselScroll = 0;
    var savedCarouselIndex = 0;
    var detailSourceView = 'home'; // 详情页来源页面

    function openDetail(videoId) {
        detailSourceView = state.currentView; // 记录来源页面
        state.currentVideoId = videoId;
        localStorage.setItem(userKey('detailVideoId'), videoId);
        // 保存当前滚动位置
        savedScrollPosition = window.scrollY || document.documentElement.scrollTop;
        // 轮播模式：保存视口滚动位置和当前索引
        if (state.viewMode === 'carousel') {
            var viewport = document.getElementById('carouselViewport');
            if (viewport) savedCarouselScroll = viewport.scrollLeft;
            savedCarouselIndex = _carouselGlobalIndex;
        }
        // 隐藏所有其他视图
        document.getElementById('listView').style.display = 'none';
        document.getElementById('pendingView').style.display = 'none';
        document.getElementById('tagMgrView').style.display = 'none';
        var hotTagsView = document.getElementById('hotTagsView');
        if (hotTagsView) hotTagsView.style.display = 'none';
        document.getElementById('detailView').style.display = '';
        updateNav(); // 更新右侧栏可见性

        var vid = document.getElementById('detailVideo');
        var isInPiP = document.pictureInPictureElement === vid;

        // 如果当前视频正在画中画模式，不替换源
        if (isInPiP) {
            // 画中画继续播放，详情页显示新视频信息但不播放
            // 加载视频详情
            api('GET', '/api/videos/' + videoId).then(function (r) {
                if (r.code === 200) {
                    renderDetailInfo(r.data);
                    loadDetailTagCollections(r.data);
                }
            });
            // 加载评论
            loadDetailComments(videoId);
            return;
        }

        // 先获取内容类型，决定用 video 还是 img 展示
        var detailImg = document.getElementById('detailImage');
        var detailControls = document.querySelector('.detail-controls');
        var centerPlayBtn = document.querySelector('.detail-center-play');

        api('GET', '/api/videos/' + videoId).then(function (r) {
            var isImage = r.code === 200 && r.data && r.data.type === 'image';

            if (isImage) {
                // 图片/GIF：用 img 展示
                vid.pause();
                vid.style.display = 'none';
                if (detailControls) detailControls.style.display = 'none';
                if (centerPlayBtn) centerPlayBtn.style.display = 'none';
                detailImg.style.display = '';
                detailImg.src = API + '/api/stream/video/' + videoId;
                stopDanmakuLoop('danmakuLayerDetail');
                trackViewCount(vid, videoId);
            } else {
                // 视频：用 video 展示
                detailImg.style.display = 'none';
                vid.style.display = '';
                if (detailControls) detailControls.style.display = '';
                if (centerPlayBtn) centerPlayBtn.style.display = '';
                vid.src = API + '/api/stream/video/' + videoId;
                vid.play().catch(function () {});
                trackViewCount(vid, videoId);
                initDetailControls(vid);
                loadDanmaku(videoId);
                startDanmakuLoop(videoId, 'danmakuLayerDetail', vid);
                syncDanmakuUI();
            }

            if (r.code === 200) {
                renderDetailInfo(r.data);
                loadDetailTagCollections(r.data);
            }
        });

        // 加载评论
        loadDetailComments(videoId);
    }

    // === 详情页右侧相关标签 ===
    function loadDetailTagCollections(video) {
        var isFeed = state.viewMode === 'feed';
        var sidebar = isFeed
            ? document.getElementById('rightSidebarTags')
            : document.getElementById('detailSidebarTags');
        if (!sidebar) return;
        if (isFeed) sidebar.style.display = '';

        if (!video.hashtag) {
            var noTagHtml = '<div class="detail-sidebar-title">相关标签</div><div class="detail-sidebar-empty">暂无标签</div>';
            sidebar.innerHTML = isFeed ? noTagHtml : '<div class="detail-sidebar-inner">' + noTagHtml + '</div>';
            return;
        }

        var tags = video.hashtag.split(',').map(function (t) { return t.trim(); }).filter(function (t) { return t; }).slice(0, 8);
        if (tags.length === 0) {
            var noTagHtml2 = '<div class="detail-sidebar-title">相关标签</div><div class="detail-sidebar-empty">暂无标签</div>';
            sidebar.innerHTML = isFeed ? noTagHtml2 : '<div class="detail-sidebar-inner">' + noTagHtml2 + '</div>';
            return;
        }

        // 先拼接完整HTML
        var html = '<div class="detail-sidebar-title">相关标签</div>';
        tags.forEach(function (tag) {
            var safeId = tag.replace(/[^a-zA-Z0-9]/g, '_');
            html += '<div class="detail-tag-card" id="detailTag-' + safeId + '" data-tag="' + esc(tag) + '">' +
                '<div class="detail-tag-cover"><div class="detail-tag-cover-empty">#</div></div>' +
                '<div class="detail-tag-info"><div class="detail-tag-name">' + esc(tag) + '</div><div class="detail-tag-count">加载中...</div></div>' +
            '</div>';
        });

        // 图标模式加外层容器
        sidebar.innerHTML = isFeed ? html : '<div class="detail-sidebar-inner">' + html + '</div>';

        // 异步加载封面和数量
        tags.forEach(function (tag) {
            var safeId = tag.replace(/[^a-zA-Z0-9]/g, '_');
            var cardId = 'detailTag-' + safeId;
            Promise.all([
                api('GET', '/api/tags/' + encodeURIComponent(tag) + '/meta'),
                api('GET', '/api/tags/' + encodeURIComponent(tag) + '/videos?pageSize=1')
            ]).then(function (results) {
                var meta = (results[0].code === 200) ? results[0].data : {};
                var total = (results[1].code === 200 && results[1].data) ? (results[1].data.total || 0) : 0;
                var el = document.getElementById(cardId);
                if (!el) return;
                var coverHtml = meta.coverUrl
                    ? '<img src="' + API + meta.coverUrl + '" onerror="this.parentElement.innerHTML=\'<div class=detail-tag-cover-empty>#</div>\'"/>'
                    : '<div class="detail-tag-cover-empty">#</div>';
                el.querySelector('.detail-tag-cover').innerHTML = coverHtml;
                el.querySelector('.detail-tag-count').textContent = total + ' 个内容';
            });
            var card = document.getElementById(cardId);
            if (card) {
                card.onclick = function () {
                    closeDetail(false);
                    switchView('home');
                    setTimeout(function () {
                        document.getElementById('searchInput').value = tag;
                        var rightInput = document.getElementById('searchInputRight');
                        if (rightInput) rightInput.value = tag;
                        doSearch();
                    }, 100);
                };
            }
        });
    }
    var detailDragging = false;

    function initDetailControls(vid) {
        var wrap = document.querySelector('.detail-video-wrap');
        var progressWrap = wrap.querySelector('.detail-progress-wrap');
        var progressBar = wrap.querySelector('.detail-progress-bar');
        var progressFill = wrap.querySelector('.detail-progress-fill');
        var progressThumb = wrap.querySelector('.detail-progress-thumb');
        var timeCurrent = document.getElementById('detailTimeCurrent');
        var timeTotal = document.getElementById('detailTimeTotal');
        var centerBtn = wrap.querySelector('.detail-center-play');

        // 时间更新
        vid.addEventListener('timeupdate', function () {
            if (detailDragging) return;
            var pct = vid.duration ? (vid.currentTime / vid.duration * 100) : 0;
            progressFill.style.width = pct + '%';
            timeCurrent.textContent = formatDuration(vid.currentTime);
            timeTotal.textContent = formatDuration(vid.duration);
        });

        // 点击进度条跳转
        progressWrap.addEventListener('mousedown', function (e) {
            detailDragging = true;
            seekFromEvent(e, vid, progressWrap, progressFill);
            updateDetailPlayBtn(vid);

            var onMove = function (e) {
                seekFromEvent(e, vid, progressWrap, progressFill);
            };
            var onUp = function () {
                detailDragging = false;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // 更新播放按钮状态
        vid.addEventListener('play', function () { updateDetailPlayBtn(vid); });
        vid.addEventListener('pause', function () { updateDetailPlayBtn(vid); });

        // 中间播放按钮：鼠标靠近中心显示，2秒后隐藏
        if (centerBtn) {
            var hideTimer = null;

            wrap.addEventListener('mousemove', function (e) {
                var rect = wrap.getBoundingClientRect();
                var centerX = rect.left + rect.width / 2;
                var centerY = rect.top + rect.height / 2;
                var dist = Math.sqrt(Math.pow(e.clientX - centerX, 2) + Math.pow(e.clientY - centerY, 2));

                // 距离中心200px内显示按钮
                if (dist < 200) {
                    centerBtn.classList.add('visible');
                } else {
                    centerBtn.classList.remove('visible');
                }

                // 重置隐藏计时器
                if (hideTimer) clearTimeout(hideTimer);
                hideTimer = setTimeout(function () {
                    centerBtn.classList.remove('visible');
                }, 2000);
            });

            wrap.addEventListener('mouseleave', function () {
                centerBtn.classList.remove('visible');
                if (hideTimer) clearTimeout(hideTimer);
            });
        }
    }

    function seekFromEvent(e, vid, container, fill) {
        var rect = container.getBoundingClientRect();
        var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (vid.duration) {
            vid.currentTime = pct * vid.duration;
            fill.style.width = (pct * 100) + '%';
        }
    }

    function updateDetailPlayBtn(vid) {
        var playIcons = document.querySelectorAll('.detail-icon-play');
        var pauseIcons = document.querySelectorAll('.detail-icon-pause');
        var playing = !vid.paused;
        playIcons.forEach(function (el) { el.style.display = playing ? 'none' : ''; });
        pauseIcons.forEach(function (el) { el.style.display = playing ? '' : 'none'; });
    }

    function toggleDetailPlay() {
        var vid = document.getElementById('detailVideo');
        if (vid.paused) {
            vid.play().catch(function () {});
        } else {
            vid.pause();
        }
    }

    function toggleDetailMute() {
        var vid = document.getElementById('detailVideo');
        vid.muted = !vid.muted;
        var unmute = document.querySelector('.detail-icon-unmute');
        var muted = document.querySelector('.detail-icon-muted');
        if (unmute) unmute.style.display = vid.muted ? 'none' : '';
        if (muted) muted.style.display = vid.muted ? '' : 'none';
    }

    // 画中画
    function toggleDetailPip() {
        var vid = document.getElementById('detailVideo');
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(function () {});
        } else if (vid.requestPictureInPicture) {
            if (vid.paused) {
                vid.play().catch(function () {});
            }
            vid.muted = false;

            // 移除旧的事件监听器
            if (pipVideo) {
                pipVideo.removeEventListener('leavepictureinpicture', onDetailLeavePip);
            }

            pipVideo = vid;
            pipVideoId = state.currentVideoId;

            // 绑定详情页专用事件
            vid.addEventListener('leavepictureinpicture', onDetailLeavePip);

            vid.requestPictureInPicture().catch(function () {});
        }
    }

    function onDetailLeavePip() {
        // 返回标签页 - 关闭详情页，回到列表，继续播放
        if (pipVideo) {
            if (pipVideo.paused) {
                pipVideo.play().catch(function () {});
            }

            // 关闭详情页，回到列表
            document.getElementById('detailView').style.display = 'none';
            document.getElementById('listView').style.display = '';
            state.currentVideoId = null;
            localStorage.removeItem(userKey('detailVideoId'));

            // 滚动到视频卡片位置
            var targetCard = null;
            if (pipVideoId) {
                targetCard = document.querySelector('.feed-card[data-video-id="' + pipVideoId + '"]');
            }
            if (targetCard) {
                targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            // 更新播放状态
            updatePlayBtnState(pipVideo, true);
            currentFeedPlaying = pipVideo;

            pipVideo = null;
            pipVideoId = null;
        }
    }

    // 播放倍率循环切换
    var detailRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];

    function cyclePlaybackRate() {
        var vid = document.getElementById('detailVideo');
        var current = vid.playbackRate;
        var idx = detailRates.indexOf(current);
        var nextIdx = (idx + 1) % detailRates.length;
        vid.playbackRate = detailRates[nextIdx];
        updateRateDisplay(detailRates[nextIdx]);
        showRateIndicator(detailRates[nextIdx]);
    }

    function updateRateDisplay(rate) {
        var text = document.getElementById('detailRateText');
        if (text) text.textContent = rate === 1 ? '1x' : rate + 'x';
    }

    function renderDetailInfo(v) {
        var info = document.getElementById('detailInfo');
        var likedCls = v.liked ? ' liked' : '';
        var tags = '';
        if (v.category) tags += '<span class="tag-category">' + esc(v.category) + '</span>';
        if (v.hashtag) {
            tags += v.hashtag.split(',').map(function (t) {
                t = t.trim();
                return '<span class="tag-item">' + esc(t) +
                    '<button class="tag-remove" onclick="window._removeTag(' + v.id + ',\'' + esc(t) + '\')">&times;</button></span>';
            }).join('');
        }


        info.innerHTML =
            '<div class="detail-info-title" id="detailTitle">' + esc(v.title) + '</div>' +
            '<div class="detail-info-meta">' +
                '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ' + (v.viewCount || 0) + ' 次浏览</span>' +
                '<button class="detail-like-btn' + likedCls + '" onclick="window._like(' + v.id + ',this)">' +
                    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
                    '<span>' + (v.likeCount || 0) + '</span>' +
                '</button>' +
                '<button class="detail-like-btn" onclick="window._toggleDetailTagDropdown(' + v.id + ',this)" title="标签">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>' +
                '</button>' +
                '<button class="detail-like-btn" onclick="window._showRenameDialog(' + v.id + ',\'' + esc(v.title).replace(/'/g, "\\'") + '\')" title="重命名">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
                '</button>' +
                (v.type !== 'image' ? '<button class="detail-like-btn" onclick="window._showRefreshThumbDialog(' + v.id + ')" title="刷新封面">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' +
                '</button>' : '') +
                '<button class="detail-like-btn detail-delete-btn" onclick="window._showDeleteDialog(' + v.id + ',\'' + esc(v.title).replace(/'/g, "\\'") + '\')" title="删除">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
                '</button>' +
                '<span>' + fmtSize(v.fileSize) + '</span>' +
            '</div>' +
            (tags ? '<div class="detail-info-tags">' + tags + '</div>' : '');
    }

    // 详情页标签下拉框（与列表模式一致）
    var detailTagDropdownEl = null;

    function toggleDetailTagDropdown(videoId, btn) {
        // 关闭已有的下拉框
        if (detailTagDropdownEl) {
            detailTagDropdownEl.remove();
            detailTagDropdownEl = null;
            return;
        }

        detailTagDropdownEl = document.createElement('div');
        detailTagDropdownEl.className = 'tag-dropdown';
        detailTagDropdownEl.onclick = function (e) { e.stopPropagation(); };

        // 获取视频当前标签
        api('GET', '/api/videos/' + videoId).then(function (r) {
            if (r.code !== 200) return;
            var video = r.data;
            window._currentVideoTags = video.hashtag ? video.hashtag.split(',').map(function (t) { return t.trim(); }) : [];

            var html = '<div class="tag-dropdown-header">标签管理</div>';

            // 输入框
            html += '<div class="tag-input-wrap">' +
                '<input class="tag-input" placeholder="输入标签..." oninput="window._searchDetailTags(this.value)" onkeydown="if(event.key===\'Enter\')window._addDetailTagFromInput(' + videoId + ',this)"/>' +
                '<button class="tag-confirm" onclick="window._addDetailTagFromInput(' + videoId + ',this.previousElementSibling)">&#10003;</button>' +
                '</div>';

            // 热门标签
            html += '<div class="tag-suggestions" id="detailTagSuggestions"></div>';

            detailTagDropdownEl.innerHTML = html;

            // 定位下拉框 (fixed定位追加到body)
            var rect = btn.getBoundingClientRect();
            detailTagDropdownEl.style.position = 'fixed';
            detailTagDropdownEl.style.bottom = 'auto';
            detailTagDropdownEl.style.left = rect.left + rect.width / 2 + 'px';
            detailTagDropdownEl.style.top = (rect.top - 8) + 'px';
            detailTagDropdownEl.style.transform = 'translate(-50%,-100%)';
            detailTagDropdownEl.style.marginBottom = '0';
            document.body.appendChild(detailTagDropdownEl);

            // 点击外部关闭
            setTimeout(function () {
                document.addEventListener('click', function handler(e) {
                    if (!detailTagDropdownEl.contains(e.target) && e.target !== btn) {
                        closeDetailTagDropdown();
                        document.removeEventListener('click', handler);
                    }
                });
            }, 0);

            // 加载热门标签
            loadDetailTagSuggestions('');
        });
    }

    function searchDetailTags(query) {
        loadDetailTagSuggestions(query);
    }

    function addDetailTagFromInput(videoId, input) {
        var tag = input.value.trim();
        if (!tag) return;

        api('POST', '/api/videos/' + videoId + '/tags', { tag: tag }).then(function (r) {
            if (r.code === 200) {
                toast('标签已添加');
                input.value = '';
                closeDetailTagDropdown();
                // 只刷新详情和相关标签，不跳转
                api('GET', '/api/videos/' + videoId).then(function (r2) {
                    if (r2.code === 200) {
                        renderDetailInfo(r2.data);
                        loadDetailTagCollections(r2.data);
                    }
                });
            } else {
                toast(r.msg || '添加失败');
            }
        });
    }

    function closeDetailTagDropdown() {
        if (detailTagDropdownEl) {
            detailTagDropdownEl.remove();
            detailTagDropdownEl = null;
        }
    }

    function toggleDetailTagInput(videoId) {
        var area = document.getElementById('detailTagInputArea');
        if (area) {
            area.style.display = area.style.display === 'none' ? '' : 'none';
            if (area.style.display !== 'none') {
                document.getElementById('detailTagInput').focus();
                loadDetailTagSuggestions('');
            }
        }
    }

    function loadDetailTagSuggestions(query) {
        var url = query ? '/api/tags/search?q=' + encodeURIComponent(query) : '/api/tags';
        api('GET', url).then(function (r) {
            if (r.code !== 200) return;
            var container = document.getElementById('detailTagSuggestions');
            if (!container) return;

            var tags = r.data || [];
            // 过滤掉已存在的标签
            var currentTags = window._currentVideoTags || [];
            tags = tags.filter(function (t) { return currentTags.indexOf(t.name) === -1; });
            if (tags.length === 0) {
                container.innerHTML = '<div class="tag-no-result">无匹配标签</div>';
                return;
            }

            container.innerHTML = tags.slice(0, 10).map(function (t) {
                return '<div class="tag-suggestion" data-tag="' + esc(t.name) + '">' +
                    '<div class="tag-suggestion-thumb" id="tagThumb-' + esc(t.name).replace(/[^a-zA-Z0-9]/g, '_') + '"><div class="tag-suggestion-thumb-empty">#</div></div>' +
                    '<span class="tag-suggestion-name">' + esc(t.name) + '</span>' +
                    '<span class="tag-count">' + t.count + '</span>' +
                    '</div>';
            }).join('');

            container.querySelectorAll('.tag-suggestion').forEach(function (el) {
                el.addEventListener('click', function () {
                    var inp = document.querySelector('.tag-dropdown .tag-input');
                    if (inp) inp.value = el.dataset.tag;
                });
            });

            tags.slice(0, 10).forEach(function (t) {
                loadTagThumb(t.name);
            });
        });
    }

    function addDetailTag(videoId) {
        var input = document.getElementById('detailTagInput');
        var tag = input.value.trim();
        if (!tag) return;

        api('POST', '/api/videos/' + videoId + '/tags', { tag: tag }).then(function (r) {
            if (r.code === 200) {
                toast('标签已添加');
                input.value = '';
                // 刷新详情和相关标签
                api('GET', '/api/videos/' + videoId).then(function (r2) {
                    if (r2.code === 200) {
                        renderDetailInfo(r2.data);
                        loadDetailTagCollections(r2.data);
                    }
                });
                loadVideos();
            } else {
                toast(r.msg || '添加失败');
            }
        });
    }

    function loadDetailComments(videoId) {
        api('GET', '/api/videos/' + videoId + '/comments?pageSize=50').then(function (r) {
            if (r.code !== 200) return;
            var list = document.getElementById('detailCommentList');
            var countEl = document.getElementById('detailCommentCount');
            countEl.textContent = r.data.total || 0;

            if (!r.data.list || r.data.list.length === 0) {
                list.innerHTML = '<div class="comment-empty">暂无评论</div>';
                return;
            }
            list.innerHTML = r.data.list.map(function (c) {
                return '<div class="comment-item">' +
                    '<div class="comment-header">' +
                        '<span class="comment-user">' + esc(c.nickname || '匿名') + '</span>' +
                        '<span class="comment-time">' + formatTime(c.createdAt) + '</span>' +
                    '</div>' +
                    '<div class="comment-content">' + esc(c.content) + '</div>' +
                '</div>';
            }).join('');
        });
    }

    function submitDetailComment() {
        var input = document.getElementById('detailCommentInput');
        var content = input.value.trim();
        if (!content || !state.currentVideoId) return;
        api('POST', '/api/videos/' + state.currentVideoId + '/comments', { content: content }).then(function (r) {
            if (r.code === 200) {
                input.value = '';
                loadDetailComments(state.currentVideoId);
            } else {
                toast(r.msg || '评论失败');
            }
        });
    }

    function closeDetail(restoreScroll) {
        document.getElementById('detailView').style.display = 'none';
        // 恢复到来源页面
        var source = detailSourceView || 'home';
        if (source === 'pending') {
            document.getElementById('pendingView').style.display = '';
        } else if (source === 'tagMgr') {
            document.getElementById('tagMgrView').style.display = '';
        } else if (source === 'hotTags') {
            var hotTagsView = document.getElementById('hotTagsView');
            if (hotTagsView) hotTagsView.style.display = '';
        } else {
            document.getElementById('listView').style.display = '';
        }
        updateNav(); // 更新右侧栏可见性
        var vid = document.getElementById('detailVideo');
        // 如果视频在画中画模式，不暂停
        if (document.pictureInPictureElement !== vid) {
            vid.pause();
            vid.src = '';
        }
        // 清理图片
        var detailImg = document.getElementById('detailImage');
        if (detailImg) {
            detailImg.style.display = 'none';
            detailImg.src = '';
        }
        state.currentVideoId = null;
        localStorage.removeItem(userKey('detailVideoId'));
        stopDanmakuLoop('danmakuLayerDetail');
        // 恢复滚动位置（只有从详情页返回时才恢复）
        if (restoreScroll !== false) {
            if (state.viewMode === 'carousel') {
                // 轮播模式：恢复视口滚动位置
                var viewport = document.getElementById('carouselViewport');
                if (viewport) {
                    viewport.scrollLeft = savedCarouselScroll;
                }
                // 恢复激活状态
                _carouselGlobalIndex = savedCarouselIndex;
                var track = document.getElementById('carouselTrack');
                if (track) {
                    var activeCard = track.querySelector('.carousel-card.active');
                    if (activeCard) activeCard.classList.remove('active');
                    var card = track.querySelector('.carousel-card[data-idx="' + savedCarouselIndex + '"]');
                    if (card) card.classList.add('active');
                }
            } else {
                window.scrollTo(0, savedScrollPosition);
            }
        }
    }

    // === Hover Preview (Grid Mode) ===
    function hoverPlay(card) {
        var thumbVideo = card.querySelector('.card-thumb-video');
        if (thumbVideo) thumbVideo.style.opacity = '0';
        var video = card.querySelector('.card-preview');
        if (!video) return;
        if (!video.src) video.src = video.dataset.src;
        video.play().catch(function () {});
    }

    function hoverStop(card) {
        var video = card.querySelector('.card-preview');
        if (video) { video.pause(); video.currentTime = 0; }
        var thumbVideo = card.querySelector('.card-thumb-video');
        if (thumbVideo) thumbVideo.style.opacity = '1';
    }

    // === Modal (Grid Mode) ===
    var viewTimer = null;
    var viewCounted = false;

    // === Unified Video Player ===
    var _vpDragging = false;
    var _vpKeyHandler = null;

    var _modalCurrentId = null;
    var _modalVideoList = [];
    var _modalVideoIndex = -1;

    function playVideo(id) {
        var modal = document.getElementById('videoModal');
        var vid = document.getElementById('modalVideo');
        var wrap = document.getElementById('videoPlayerWrap');
        _modalCurrentId = id;
        viewCounted = false;
        if (viewTimer) { clearTimeout(viewTimer); viewTimer = null; }
        vid.src = API + '/api/stream/video/' + id;
        vid.playbackRate = 1;
        vid.muted = false;
        modal.classList.add('active');
        vid.play().catch(function () {});
        trackViewCount(vid, id);
        initVideoPlayerControls(vid, wrap);
        // 加载弹幕（该视频未设置过则用全局默认值）
        loadDanmaku(id);
        startDanmakuLoop(id, 'danmakuLayerModal', vid);
        syncDanmakuUI();
        // 更新点赞按钮状态
        updateModalLikeBtn(id, 'vpLikeBtn');
        // 画廊模式：显示上一个/下一个和定位按钮
        updateGalleryModalButtons();
    }

    function updateGalleryModalButtons() {
        var isGallery = state.viewMode === 'gallery';
        var navBtns = document.querySelectorAll('.vp-gallery-nav');
        var locateBtn = document.querySelector('.vp-gallery-locate');
        if (isGallery) {
            // 收集当前视频列表
            _modalVideoList = [];
            _modalVideoIndex = -1;
            var grid = document.getElementById('videoGrid');
            var cards = grid.querySelectorAll('.gallery-card[data-type="video"]');
            cards.forEach(function (card, index) {
                var cardId = parseInt(card.dataset.id);
                _modalVideoList.push(cardId);
                if (cardId === _modalCurrentId) {
                    _modalVideoIndex = index;
                }
            });
            navBtns.forEach(function (btn) { btn.style.display = 'flex'; });
            if (locateBtn) locateBtn.style.display = 'flex';
        } else {
            navBtns.forEach(function (btn) { btn.style.display = 'none'; });
            if (locateBtn) locateBtn.style.display = 'none';
        }
    }

    function closeModal() {
        document.getElementById('videoModal').classList.remove('active');
        var vid = document.getElementById('modalVideo');
        vid.pause(); vid.src = '';
        vid.playbackRate = 1;
        if (viewTimer) { clearTimeout(viewTimer); viewTimer = null; }
        cleanupVideoPlayer();
        stopDanmakuLoop('danmakuLayerModal');
        _modalCurrentId = null;
    }

    function modalPrevVideo() {
        if (_modalVideoList.length === 0 || _modalVideoIndex <= 0) return;
        _modalVideoIndex--;
        var id = _modalVideoList[_modalVideoIndex];
        playVideo(id);
    }

    function modalNextVideo() {
        if (_modalVideoList.length === 0 || _modalVideoIndex >= _modalVideoList.length - 1) return;
        _modalVideoIndex++;
        var id = _modalVideoList[_modalVideoIndex];
        playVideo(id);
    }

    function modalLocateVideo() {
        if (!_modalCurrentId) return;
        var pageSize = state.viewMode === 'gallery' ? 21 : state.pageSize;
        var itemIndex = _modalVideoList.indexOf(_modalCurrentId);
        if (itemIndex === -1) return;
        // 计算视频在第几页（需要加上前面图片的偏移）
        var pageNum = Math.floor(itemIndex / pageSize) + 1;
        closeModal();
        if (pageNum !== state.page) {
            state.page = pageNum;
            if (state.currentView === 'likes') loadLikedVideos();
            else loadVideos();
        }
        setTimeout(function () {
            var card = document.querySelector('.gallery-card[data-id="' + _modalCurrentId + '"]');
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.style.outline = '2px solid var(--accent)';
                card.style.outlineOffset = '2px';
                setTimeout(function () {
                    card.style.outline = '';
                    card.style.outlineOffset = '';
                }, 2000);
            }
        }, 300);
        toast('已定位到第' + pageNum + '页');
    }

    function initVideoPlayerControls(vid, wrap) {
        var centerBtn = document.getElementById('videoCenterBtn');
        var playBtn = document.getElementById('vpPlayBtn');
        var muteBtn = document.getElementById('vpMuteBtn');
        var rateBtn = document.getElementById('vpRateBtn');
        var fsBtn = document.getElementById('vpFsBtn');
        var closeBtn = document.getElementById('vpCloseBtn');
        var progressWrap = document.getElementById('vpProgressWrap');
        var progressFill = document.getElementById('vpProgressFill');
        var timeCurrent = document.getElementById('vpTimeCurrent');
        var timeTotal = document.getElementById('vpTimeTotal');
        var rateText = document.getElementById('vpRateText');

        var onTimeUpdate = function () {
            if (_vpDragging) return;
            var pct = vid.duration ? (vid.currentTime / vid.duration * 100) : 0;
            progressFill.style.width = pct + '%';
            timeCurrent.textContent = formatDuration(vid.currentTime);
            timeTotal.textContent = formatDuration(vid.duration);
        };
        vid.addEventListener('timeupdate', onTimeUpdate);
        vid.addEventListener('loadedmetadata', onTimeUpdate);

        var updateVpPlayState = function () {
            var playing = !vid.paused;
            wrap.querySelectorAll('.vp-icon-play').forEach(function (el) { el.style.display = playing ? 'none' : ''; });
            wrap.querySelectorAll('.vp-icon-pause').forEach(function (el) { el.style.display = playing ? '' : 'none'; });
        };
        vid.addEventListener('play', updateVpPlayState);
        vid.addEventListener('pause', updateVpPlayState);

        // 中间按钮悬停
        var hideTimer = null;
        wrap.addEventListener('mousemove', function (e) {
            var rect = wrap.getBoundingClientRect();
            var cx = rect.left + rect.width / 2;
            var cy = rect.top + rect.height / 2;
            var dist = Math.sqrt(Math.pow(e.clientX - cx, 2) + Math.pow(e.clientY - cy, 2));
            if (dist < 150) { centerBtn.classList.add('visible'); }
            else { centerBtn.classList.remove('visible'); }
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(function () { centerBtn.classList.remove('visible'); }, 2000);
        });
        wrap.addEventListener('mouseleave', function () { centerBtn.classList.remove('visible'); if (hideTimer) clearTimeout(hideTimer); });

        centerBtn.onclick = function (e) { e.stopPropagation(); if (vid.paused) vid.play().catch(function(){}); else vid.pause(); };
        playBtn.onclick = function (e) { e.stopPropagation(); if (vid.paused) vid.play().catch(function(){}); else vid.pause(); };

        muteBtn.onclick = function (e) {
            e.stopPropagation();
            vid.muted = !vid.muted;
            muteBtn.querySelector('.vp-icon-unmute').style.display = vid.muted ? 'none' : '';
            muteBtn.querySelector('.vp-icon-muted').style.display = vid.muted ? '' : 'none';
        };

        var rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];
        rateBtn.onclick = function (e) {
            e.stopPropagation();
            var idx = rates.indexOf(vid.playbackRate);
            var next = rates[(idx + 1) % rates.length];
            vid.playbackRate = next;
            rateText.textContent = next === 1 ? '1x' : next + 'x';
            showVpRateIndicator(wrap, next);
        };

        fsBtn.onclick = function (e) {
            e.stopPropagation();
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                document.exitFullscreen().catch(function () {});
            } else {
                vid.muted = false;
                muteBtn.querySelector('.vp-icon-unmute').style.display = '';
                muteBtn.querySelector('.vp-icon-muted').style.display = 'none';
                if (wrap.requestFullscreen) wrap.requestFullscreen().catch(function () {});
                else if (wrap.webkitRequestFullscreen) wrap.webkitRequestFullscreen();
            }
        };

        closeBtn.onclick = function (e) { e.stopPropagation(); closeModal(); };

        progressWrap.addEventListener('mousedown', function (e) {
            _vpDragging = true;
            seekVp(e, vid, progressWrap, progressFill);
            var onMove = function (ev) { seekVp(ev, vid, progressWrap, progressFill); };
            var onUp = function () { _vpDragging = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        _vpKeyHandler = function (e) {
            if (!document.getElementById('videoModal').classList.contains('active')) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            e.preventDefault();
            switch (e.key) {
                case ' ': if (vid.paused) vid.play().catch(function(){}); else vid.pause(); break;
                case 'ArrowLeft': vid.currentTime = Math.max(0, vid.currentTime - 5); break;
                case 'ArrowRight': vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 5); break;
                case 'ArrowUp': changeVpRate(vid, wrap, rateText, 0.25); break;
                case 'ArrowDown': changeVpRate(vid, wrap, rateText, -0.25); break;
                case 'Escape': closeModal(); break;
            }
        };
        document.addEventListener('keydown', _vpKeyHandler);
    }

    function seekVp(e, vid, container, fill) {
        var rect = container.getBoundingClientRect();
        var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (vid.duration) { vid.currentTime = pct * vid.duration; fill.style.width = (pct * 100) + '%'; }
    }

    function changeVpRate(vid, wrap, rateTextEl, delta) {
        var rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];
        var idx = rates.indexOf(vid.playbackRate);
        if (idx === -1) idx = rates.indexOf(1);
        var newIdx = Math.max(0, Math.min(rates.length - 1, idx + (delta > 0 ? 1 : -1)));
        vid.playbackRate = rates[newIdx];
        rateTextEl.textContent = rates[newIdx] === 1 ? '1x' : rates[newIdx] + 'x';
        showVpRateIndicator(wrap, rates[newIdx]);
    }

    function showVpRateIndicator(wrap, rate) {
        var indicator = wrap.querySelector('.vp-rate-indicator');
        if (!indicator) { indicator = document.createElement('div'); indicator.className = 'vp-rate-indicator'; wrap.appendChild(indicator); }
        indicator.textContent = rate === 1 ? '1x' : rate + 'x';
        indicator.classList.add('visible');
        setTimeout(function () { indicator.classList.remove('visible'); }, 2000);
    }

    function cleanupVideoPlayer() {
        if (_vpKeyHandler) { document.removeEventListener('keydown', _vpKeyHandler); _vpKeyHandler = null; }
        _vpDragging = false;
        if (document.fullscreenElement || document.webkitFullscreenElement) { document.exitFullscreen().catch(function () {}); }
    }

    // === Image Modal ===
    function showImage(id) {
        var modal = document.getElementById('imageModal');
        _modalCurrentId = id;
        document.getElementById('modalImage').src = API + '/api/stream/video/' + id;
        modal.classList.add('active');
        api('POST', '/api/videos/' + id + '/view');
        // 更新点赞按钮状态
        updateModalLikeBtn(id, 'modalImageLikeBtn');
    }

    function closeImageModal() {
        document.getElementById('imageModal').classList.remove('active');
        _modalCurrentId = null;
    }

    function togglePip() {
        var vid = document.getElementById('modalVideo');
        if (document.pictureInPictureElement) document.exitPictureInPicture().catch(function () {});
        else if (vid.requestPictureInPicture) vid.requestPictureInPicture().then(function () { closeModal(); }).catch(function () {});
    }

    function toggleFs() {
        // 检测当前是详情页还是弹窗模式
        var detailView = document.getElementById('detailView');
        var isDetail = detailView && detailView.style.display !== 'none';

        if (document.fullscreenElement || document.webkitFullscreenElement) {
            document.exitFullscreen().catch(function () {});
        } else if (isDetail) {
            // 详情页全屏
            var wrap = document.querySelector('.detail-video-wrap');
            var vid = document.getElementById('detailVideo');
            vid.muted = false;
            if (vid.paused) vid.play().catch(function () {});

            // 禁用视频点击
            vid.style.pointerEvents = 'none';

            if (wrap.requestFullscreen) wrap.requestFullscreen().catch(function () {});
            else if (wrap.webkitRequestFullscreen) wrap.webkitRequestFullscreen();

            var onFsChange = function () {
                if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                    vid.style.pointerEvents = '';
                    document.removeEventListener('fullscreenchange', onFsChange);
                    document.removeEventListener('webkitfullscreenchange', onFsChange);
                }
            };
            document.addEventListener('fullscreenchange', onFsChange);
            document.addEventListener('webkitfullscreenchange', onFsChange);
        } else {
            // 弹窗模式全屏
            var modalVid = document.getElementById('modalVideo');
            var content = document.querySelector('.modal-content');

            modalVid.muted = false;
            modalVid.style.pointerEvents = 'none';
            if (modalVid.readyState >= 2) {
                modalVid.play().catch(function () {});
            } else {
                modalVid.addEventListener('loadeddata', function handler() {
                    modalVid.play().catch(function () {});
                    modalVid.removeEventListener('loadeddata', handler);
                });
            }

            if (content.requestFullscreen) content.requestFullscreen().catch(function () {});
            else if (content.webkitRequestFullscreen) content.webkitRequestFullscreen();

            var onModalFsChange = function () {
                if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                    modalVid.style.pointerEvents = '';
                    document.removeEventListener('fullscreenchange', onModalFsChange);
                    document.removeEventListener('webkitfullscreenchange', onModalFsChange);
                }
            };
            document.addEventListener('fullscreenchange', onModalFsChange);
            document.addEventListener('webkitfullscreenchange', onModalFsChange);
        }
    }

    // === Helpers ===
    function renderPageInfo(d) {
        document.getElementById('pageInfo').textContent = '第' + d.page + ' / ' + d.totalPages + ' 页 (共' + d.total + ' 条)';
        document.getElementById('jumpInput').max = d.totalPages;
        document.getElementById('jumpInput').placeholder = '/' + d.totalPages;
    }

    function fmtSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
        return (bytes / 1073741824).toFixed(2) + ' GB';
    }

    function fmtCount(n) {
        if (!n) return '0';
        if (n >= 10000) return (n / 10000).toFixed(1) + '万';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
        return '' + n;
    }

    function esc(s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // === Folders ===
    function loadFolders() {
        api('GET', '/api/folders').then(function (r) { if (r.code === 200) renderFolders(r.data); });
    }

    // 每个文件夹独立的扫描选项
    var folderScanOptions = JSON.parse(localStorage.getItem('folderScanOptions') || '{}');

    function getFolderScanOpt(id) {
        if (!folderScanOptions[id]) folderScanOptions[id] = { video: true, image: true, pendingClassify: false };
        return folderScanOptions[id];
    }

    function saveFolderScanOptions() {
        localStorage.setItem('folderScanOptions', JSON.stringify(folderScanOptions));
    }

    function toggleFolderScanOption(id, type) {
        var opt = getFolderScanOpt(id);
        opt[type] = !opt[type];
        saveFolderScanOptions();
        // 只更新对应复选框状态，不重渲染整个列表
        var el = document.getElementById('folderItem-' + id);
        if (el) {
            var videoEl = el.querySelector('.fso-video');
            var imageEl = el.querySelector('.fso-image');
            var pendingEl = el.querySelector('.fso-pending');
            if (videoEl) videoEl.checked = opt.video;
            if (imageEl) imageEl.checked = opt.image;
            if (pendingEl) pendingEl.checked = opt.pendingClassify;
        }
    }

    var lastFolders = [];

    function renderFolders(folders) {
        lastFolders = folders || [];
        var list = document.getElementById('folderList');
        if (!folders || folders.length === 0) { list.innerHTML = '<div class="folder-empty">暂无文件夹，请添加</div>'; return; }
        list.innerHTML = '<div class="folder-list">' + folders.map(function (f) {
            var opt = getFolderScanOpt(f.id);
            return '<div class="folder-item" id="folderItem-' + f.id + '">' +
                '<div class="folder-info">' +
                    '<span class="folder-name">' + esc(f.name) + '</span>' +
                    '<span class="folder-path">' + esc(f.path) + '</span>' +
                '</div>' +
                '<div class="folder-actions">' +
                    '<label class="folder-scan-check"><input type="checkbox" class="fso-video" ' + (opt.video ? 'checked' : '') + ' onchange="window._toggleFolderScanOption(' + f.id + ',\'video\')"/> 视频</label>' +
                    '<label class="folder-scan-check"><input type="checkbox" class="fso-image" ' + (opt.image ? 'checked' : '') + ' onchange="window._toggleFolderScanOption(' + f.id + ',\'image\')"/> 图片</label>' +
                    '<button class="btn btn-sm" onclick="window._scanFolder(' + f.id + ')">扫描</button>' +
                    '<button class="btn btn-sm btn-red" onclick="window._deleteFolder(' + f.id + ')">删除</button>' +
                '</div>' +
            '</div>';
        }).join('') + '</div>';
    }

    var pickedFolderPath = '';
    var currentBrowsePath = '';

    function openDirBrowser() {
        document.getElementById('dirBrowser').style.display = '';
        browseTo('');
    }

    function closeDirBrowser() {
        document.getElementById('dirBrowser').style.display = 'none';
    }

    function browseTo(path) {
        api('GET', '/api/browse?path=' + encodeURIComponent(path)).then(function (r) {
            if (r.code !== 200) {
                toast(r.msg || '加载失败');
                return;
            }
            var data = r.data;
            currentBrowsePath = data.current;
            document.getElementById('dirCurrent').textContent = data.current || '/';

            var list = document.getElementById('dirList');
            var items = data.items || [];

            if (items.length === 0) {
                list.innerHTML = '<div class="dir-empty">此目录下没有子文件夹</div>';
                return;
            }

            // 清理旧的路径缓存
            window._dirItems = {};

            list.innerHTML = items.map(function (item, index) {
                // 存储路径到对象，用索引引用
                window._dirItems[index] = item.path;
                return '<div class="dir-item" onclick="browseTo(window._dirItems[' + index + '])">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' +
                    '<span>' + esc(item.name) + '</span>' +
                    '<button class="btn btn-sm dir-select-btn" onclick="event.stopPropagation();selectDir(window._dirItems[' + index + '])">选择</button>' +
                '</div>';
            }).join('');
        });
    }

    function browseParent() {
        if (!currentBrowsePath) return; // 已经是根目录
        api('GET', '/api/browse?path=' + encodeURIComponent(currentBrowsePath)).then(function (r) {
            if (r.code === 200) {
                var parent = r.data.parent;
                if (parent) {
                    browseTo(parent);
                } else {
                    browseTo(''); // 回到根目录
                }
            }
        });
    }

    function selectDir(path) {
        pickedFolderPath = path;
        document.getElementById('pickedFolderPath').textContent = path;
        closeDirBrowser();
    }

    function addFolder() {
        if (!pickedFolderPath) {
            toast('请先选择文件夹');
            return;
        }
        var msg = document.getElementById('folderMsg');
        msg.textContent = '添加中...'; msg.style.color = '';
        api('POST', '/api/folders', { path: pickedFolderPath }).then(function (r) {
            if (r.code === 200) {
                msg.textContent = '添加成功'; msg.style.color = 'var(--green)';
                var newFolder = r.data;
                pickedFolderPath = '';
                document.getElementById('pickedFolderPath').textContent = '';
                // 先加载文件夹列表，再弹出扫描弹窗
                loadFolders();
                setTimeout(function() {
                    if (newFolder && newFolder.id) {
                        scanFolder(newFolder.id);
                    }
                }, 800);
            } else { msg.textContent = r.msg || '添加失败'; msg.style.color = 'var(--red)'; }
            setTimeout(function () { msg.textContent = ''; }, 3000);
        });
    }

    function scanFolder(id) {
        var opt = getFolderScanOpt(id);
        if (!opt.video && !opt.image) {
            toast('请至少选择一种文件类型');
            return;
        }
        var folderName = '';
        for (var i = 0; i < lastFolders.length; i++) {
            if (lastFolders[i].id === id) { folderName = lastFolders[i].name; break; }
        }
        showScanDialog('扫描「' + (folderName || '该文件夹') + '」', false, function (pendingClassify) {
            toast('扫描中...');
            var params = '?video=' + opt.video + '&image=' + opt.image + '&pendingClassify=' + pendingClassify;
            api('POST', '/api/folders/' + id + '/scan' + params).then(function (r) {
                if (r.code === 200) {
                    toast(r.data);
                    loadVideos();
                    loadPendingTags();

                }
                else toast(r.msg || '扫描失败');
            });
        });
    }

    function scanAllFolders() {
        showScanDialog('全部扫描', true, function (pendingClassify) {
            var folderConfigs = lastFolders.map(function (f) {
                var opt = getFolderScanOpt(f.id);
                return { id: f.id, video: opt.video, image: opt.image };
            });
            toast('扫描所有文件夹...');
            api('POST', '/api/folders/scan-all', { folders: folderConfigs, pendingClassify: pendingClassify }).then(function (r) {
                if (r.code === 200) {
                    toast(r.data);
                    loadVideos();
                    loadPendingTags();

                }
                else toast(r.msg || '扫描失败');
            });
        });
    }

    function showScanDialog(title, isScanAll, onConfirm) {
        var overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = '<div class="confirm-dialog">' +
            '<div class="confirm-title">' + esc(title) + '</div>' +
            '<div class="confirm-body">' +
                '<label class="confirm-checkbox">' +
                    '<input type="checkbox" id="scanPendingCheck"/>' +
                    '<span>预分标签</span>' +
                '</label>' +
                '<div class="confirm-hint">' +
                    (isScanAll ? '扫描时自动生成预分标签' : '勾选后会对已有文件重新生成预分标签，不勾选仅对新增文件生成') +
                '</div>' +
            '</div>' +
            '<div class="confirm-actions">' +
                '<button class="btn btn-outline confirm-cancel">取消</button>' +
                '<button class="btn confirm-ok">开始扫描</button>' +
            '</div>' +
        '</div>';

        overlay.querySelector('.confirm-cancel').onclick = function () { overlay.remove(); };
        overlay.querySelector('.confirm-ok').onclick = function () {
            var pendingClassify = overlay.querySelector('#scanPendingCheck').checked;
            overlay.remove();
            onConfirm(pendingClassify);
        };
        overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
        document.body.appendChild(overlay);
    }

    function deleteFolder(id) {
        var folderName = '';
        for (var i = 0; i < lastFolders.length; i++) {
            if (lastFolders[i].id === id) { folderName = lastFolders[i].name; break; }
        }
        showDeleteFolderDialog(id, folderName);
    }

    function showDeleteFolderDialog(id, folderName) {
        var overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = '<div class="confirm-dialog">' +
            '<div class="confirm-title">删除文件夹</div>' +
            '<div class="confirm-message">确定删除「' + esc(folderName || '该文件夹') + '」？</div>' +
            '<div class="confirm-option">' +
                '<label class="folder-scan-check"><input type="checkbox" id="deleteDataCheck"/> 同时删除视频相关数据（点赞、评论、浏览量、分类等）</label>' +
            '</div>' +
            '<div class="confirm-hint">不勾选则仅移除文件夹记录，视频数据保留</div>' +
            '<div class="confirm-actions">' +
                '<button class="btn btn-outline confirm-cancel">取消</button>' +
                '<button class="btn btn-red confirm-ok">删除</button>' +
            '</div>' +
        '</div>';

        overlay.querySelector('.confirm-cancel').onclick = function () { overlay.remove(); };
        overlay.querySelector('.confirm-ok').onclick = function () {
            var deleteData = overlay.querySelector('#deleteDataCheck').checked;
            overlay.remove();
            var params = deleteData ? '?deleteData=true' : '';
            api('DELETE', '/api/folders/' + id + params).then(function (r) {
                if (r.code === 200) { toast(r.data); loadFolders(); loadCategories(); loadVideos(); }
                else toast(r.msg || '删除失败');
            });
        };
        overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
        document.body.appendChild(overlay);
    }

    // === Tag Manager ===
    var _tagMgrItems = [];
    var _tagMgrPage = 1;
    var _tagMgrPageSize = 15;
    var _tagMgrFilter = '';
    var _tagMgrData = {};       // tag -> { items: [...], total }
    var _tagMgrVideoPage = {};  // tag -> 页码
    var _tagMgrMeta = {};       // tag -> { coverVideoId, coverImagePath, description, coverUrl }
    var _TAG_MGR_VIDEO_SIZE = 20;

    function showTagManager() {
        closeMenu();
        state.currentView = 'tagMgr';
        updateNav();
        closeDetail(false);
        document.getElementById('pendingView').style.display = 'none';
        document.getElementById('listView').style.display = 'none';
        document.getElementById('detailView').style.display = 'none';
        document.getElementById('tagMgrView').style.display = '';
        loadTagManagerList();
    }

    function closeTagManager() {
        switchView('home');
    }

    function loadTagManagerList() {
        api('GET', '/api/tags/manage').then(function (r) {
            if (r.code !== 200) return;
            _tagMgrItems = (r.data || []).sort(function (a, b) { return b.count - a.count; });
            _tagMgrPage = 1;
            _tagMgrFilter = '';
            var searchInput = document.getElementById('tagMgrSearch');
            if (searchInput) searchInput.value = '';

            if (_tagMgrItems.length === 0) {
                document.getElementById('tagManagerList').innerHTML = '<div class="pending-empty">暂无标签</div>';
                document.getElementById('tagMgrStats').innerHTML = '';
                document.getElementById('tagMgrPagination').innerHTML = '<div class="pending-pagination-inner"></div>';
                return;
            }

            var totalVideos = 0, totalImages = 0;
            _tagMgrItems.forEach(function (t) { totalVideos += t.videoCount || 0; totalImages += t.imageCount || 0; });
            document.getElementById('tagMgrStats').innerHTML =
                '<span>' + _tagMgrItems.length + ' 个标签</span>' +
                '<span>' + totalVideos + ' 个视频</span>' +
                '<span>' + totalImages + ' 张图片</span>';

            // 批量加载标签元数据
            var loadAll = _tagMgrItems.map(function (t) {
                return api('GET', '/api/tags/' + encodeURIComponent(t.name) + '/meta').then(function (r2) {
                    if (r2.code === 200) _tagMgrMeta[t.name] = r2.data;
                });
            });
            Promise.all(loadAll).then(function () { renderTagMgrList(); });
        });
    }

    function filterTagMgr() {
        _tagMgrFilter = (document.getElementById('tagMgrSearch').value || '').toLowerCase();
        _tagMgrPage = 1;
        renderTagMgrList();
    }

    function renderTagMgrList() {
        var list = document.getElementById('tagManagerList');
        var filtered = _tagMgrItems.filter(function (item) {
            return !_tagMgrFilter || item.name.toLowerCase().indexOf(_tagMgrFilter) >= 0;
        });

        if (filtered.length === 0) {
            list.innerHTML = '<div class="pending-empty">无匹配标签</div>';
            document.getElementById('tagMgrPagination').innerHTML = '<div class="pending-pagination-inner"></div>';
            return;
        }

        var totalPages = Math.ceil(filtered.length / _tagMgrPageSize);
        if (_tagMgrPage > totalPages) _tagMgrPage = totalPages;
        var start = (_tagMgrPage - 1) * _tagMgrPageSize;
        var pageItems = filtered.slice(start, start + _tagMgrPageSize);

        var html = '';
        pageItems.forEach(function (tag) {
            var safeName = esc(tag.name);
            var safeId = tag.name.replace(/[^a-zA-Z0-9]/g, '_');
            var meta = _tagMgrMeta[tag.name] || {};
            var coverUrl = meta.coverUrl ? (API + meta.coverUrl) : '';
            var desc = meta.description || '';

            html += '<div class="pending-tag-card" id="tagMgr-' + safeId + '">' +
                '<div class="pending-tag-header" onclick="toggleTagMgrExpand(this)">' +
                    '<div class="tag-mgr-cover" onclick="event.stopPropagation();openCoverPicker(\'' + safeName + '\')" title="设置封面">' +
                        (coverUrl
                            ? '<img src="' + coverUrl + '" onerror="this.parentElement.innerHTML=\'<span class=tag-mgr-cover-add>+</span>\'"/>'
                            : '<span class="tag-mgr-cover-add">+</span>') +
                    '</div>' +
                    '<div class="pending-tag-left">' +
                        '<span class="pending-tag-name">' + safeName + '</span>' +
                        '<span class="pending-tag-summary">' + (tag.videoCount || 0) + ' 个视频 / ' + (tag.imageCount || 0) + ' 张图片</span>' +
                        (desc
                            ? '<span class="tag-mgr-desc" onclick="event.stopPropagation();editTagDescription(\'' + safeName + '\')" title="点击编辑简介">' + esc(desc) + '</span>'
                            : '<span class="tag-mgr-desc tag-mgr-desc-empty" onclick="event.stopPropagation();editTagDescription(\'' + safeName + '\')">添加简介...</span>') +
                    '</div>' +
                    '<div class="pending-tag-right">' +
                        '<button class="btn btn-xs" onclick="event.stopPropagation();startMgrRenameTag(\'' + safeName + '\')" title="重命名">✎</button>' +
                        '<button class="btn btn-xs" onclick="event.stopPropagation();mergeTag(\'' + safeName + '\')" title="合并标签"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg></button>' +
                        '<button class="btn btn-xs btn-red" onclick="event.stopPropagation();deleteTag(\'' + safeName + '\')" title="删除">✕</button>' +
                        '<svg class="pending-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>' +
                    '</div>' +
                '</div>' +
                '<div class="pending-tag-videos" data-tag="' + safeName + '"></div>' +
            '</div>';
        });
        list.innerHTML = html;

        // 分页
        var pagHtml = '';
        if (totalPages > 1) {
            pagHtml += '<button onclick="goTagMgrPage(1)"' + (_tagMgrPage <= 1 ? ' disabled' : '') + '>首页</button>';
            pagHtml += '<button onclick="goTagMgrPage(' + (_tagMgrPage - 1) + ')"' + (_tagMgrPage <= 1 ? ' disabled' : '') + '>上一页</button>';
            pagHtml += '<span class="info">第' + _tagMgrPage + ' / ' + totalPages + ' 页 (共' + filtered.length + ' 条)</span>';
            pagHtml += '<button onclick="goTagMgrPage(' + (_tagMgrPage + 1) + ')"' + (_tagMgrPage >= totalPages ? ' disabled' : '') + '>下一页</button>';
            pagHtml += '<button onclick="goTagMgrPage(' + totalPages + ')"' + (_tagMgrPage >= totalPages ? ' disabled' : '') + '>末页</button>';
            pagHtml += '<div class="jump"><label>跳转</label>';
            pagHtml += '<input type="number" min="1" max="' + totalPages + '" placeholder="/' + totalPages + '" onkeydown="if(event.key===\'Enter\')goTagMgrPage(parseInt(this.value))"/>';
            pagHtml += '<button onclick="goTagMgrPage(parseInt(this.previousElementSibling.value))">GO</button></div>';
        }
        document.getElementById('tagMgrPagination').innerHTML = '<div class="pending-pagination-inner">' + pagHtml + '</div>';
    }

    function goTagMgrPage(page) {
        _tagMgrPage = page;
        renderTagMgrList();
    }

    function toggleTagMgrExpand(header) {
        var group = header.parentElement;
        var videosDiv = group.querySelector('.pending-tag-videos');
        var arrow = header.querySelector('.pending-arrow');
        var tag = videosDiv.dataset.tag;

        if (group.classList.contains('expanded')) {
            group.classList.remove('expanded');
            arrow.style.transform = '';
        } else {
            document.querySelectorAll('#tagManagerList .pending-tag-card.expanded').forEach(function (card) {
                if (card !== group) {
                    card.classList.remove('expanded');
                    var otherArrow = card.querySelector('.pending-arrow');
                    if (otherArrow) otherArrow.style.transform = '';
                }
            });

            group.classList.add('expanded');
            arrow.style.transform = 'rotate(180deg)';
            if (!videosDiv.dataset.loaded) {
                loadTagMgrVideos(tag, videosDiv);
            }
        }
    }

    function loadTagMgrVideos(tag, container) {
        container.dataset.loaded = 'loading';
        container.innerHTML = '<div class="pending-loading"><div class="pending-spinner"></div>加载中...</div>';
        api('GET', '/api/tags/' + encodeURIComponent(tag) + '/videos?pageSize=1000').then(function (r) {
            if (r.code !== 200) { container.innerHTML = '<div class="pending-empty">加载失败</div>'; return; }
            var videos = r.data.list || [];
            _tagMgrData[tag] = { items: videos, total: videos.length };
            _tagMgrVideoPage[tag] = 1;
            container.dataset.loaded = '1';
            renderTagMgrVideos(tag, container);
        }).catch(function () {
            container.innerHTML = '<div class="pending-empty">加载失败</div>';
            container.dataset.loaded = '';
        });
    }

    function renderTagMgrVideos(tag, container) {
        var data = _tagMgrData[tag];
        if (!data) return;

        var page = _tagMgrVideoPage[tag] || 1;
        var totalPages = Math.ceil(data.total / _TAG_MGR_VIDEO_SIZE);
        if (page > totalPages) page = totalPages;
        _tagMgrVideoPage[tag] = page;

        var start = (page - 1) * _TAG_MGR_VIDEO_SIZE;
        var end = Math.min(start + _TAG_MGR_VIDEO_SIZE, data.total);
        var pageItems = data.items.slice(start, end);

        // 添加视频按钮
        var html = '<div class="tag-mgr-add-bar">' +
            '<button class="btn btn-sm" onclick="openAddVideoToTag(\'' + esc(tag) + '\')">+ 添加视频</button>' +
        '</div>';

        // 视频卡片网格（带悬停预览和点击播放）
        html += '<div class="pending-video-grid">';
        pageItems.forEach(function (v) {
            var isImage = v.type === 'image';
            var thumb = '';
            if (isImage) {
                thumb = v.thumbUrl
                    ? '<img class="pending-video-thumb" data-src="' + API + v.thumbUrl + '" onerror="this.outerHTML=\'<div class=pending-video-thumb>?</div>\'"/>'
                    : '<div class="pending-video-thumb">?</div>';
            } else {
                if (v.thumbUrl) {
                    thumb = '<img class="pending-video-thumb" data-src="' + API + v.thumbUrl + '" onerror="this.outerHTML=\'<div class=pending-video-thumb>?</div>\'"/>';
                } else if (v.url) {
                    thumb = '<video class="pending-video-thumb" muted preload="none" data-src="' + API + v.url + '"></video>';
                } else {
                    thumb = '<div class="pending-video-thumb">?</div>';
                }
            }
            var preview = (!isImage && v.url) ? '<video class="pending-video-preview" muted preload="none" data-src="' + API + v.url + '"></video>' : '';
            var title = esc(v.fileName || v.title || '');
            var click = ' onclick="openPendingVideoPopup(' + v.id + ',\'' + title.replace(/'/g, "\\'") + '\')"';
            var hover = isImage ? '' : ' onmouseenter="previewPendingVideo(this)" onmouseleave="stopPendingVideo(this)"';
            var badge = isImage ? '<span class="card-badge card-badge-img pending-card-badge">图片</span>' : '';
            html += '<div class="pending-video-card" title="' + title + '"' + hover + click + '>' +
                thumb + preview + badge +
                '<div class="pending-video-info">' +
                    '<span class="pending-video-title" onclick="event.stopPropagation();window._openDetail(' + v.id + ')" style="cursor:pointer">' + title + '</span>' +
                    '<button class="pending-video-remove" onclick="event.stopPropagation();removeVideoFromTag(\'' + esc(tag) + '\',' + v.id + ')" title="移除此标签">\u00d7</button>' +
                '</div>' +
            '</div>';
        });
        html += '</div>';

        // 分页
        if (totalPages > 1) {
            html += '<div class="pending-page-nav">';
            html += '<div class="pending-page-btns">';
            html += '<button onclick="goTagMgrVideoPage(\'' + esc(tag) + '\',1)"' + (page <= 1 ? ' disabled' : '') + '>首页</button>';
            html += '<button onclick="goTagMgrVideoPage(\'' + esc(tag) + '\',' + (page - 1) + ')"' + (page <= 1 ? ' disabled' : '') + '>上一页</button>';
            html += '<span class="pending-page-info">第' + page + ' / ' + totalPages + ' 页 (共' + data.total + ' 条)</span>';
            html += '<button onclick="goTagMgrVideoPage(\'' + esc(tag) + '\',' + (page + 1) + ')"' + (page >= totalPages ? ' disabled' : '') + '>下一页</button>';
            html += '<button onclick="goTagMgrVideoPage(\'' + esc(tag) + '\',' + totalPages + ')"' + (page >= totalPages ? ' disabled' : '') + '>末页</button>';
            html += '<div class="pending-page-jump">';
            html += '<label>跳转</label>';
            html += '<input type="number" min="1" max="' + totalPages + '" placeholder="/' + totalPages + '" onkeydown="if(event.key===\'Enter\')goTagMgrVideoPage(\'' + esc(tag) + '\',parseInt(this.value))"/>';
            html += '<button onclick="goTagMgrVideoPage(\'' + esc(tag) + '\',parseInt(this.previousElementSibling.value))">GO</button>';
            html += '</div></div></div>';
        }

        container.innerHTML = html;
        container.querySelectorAll('[data-src]').forEach(function (el) { observeLazy(el); });
    }

    function goTagMgrVideoPage(tag, page) {
        _tagMgrVideoPage[tag] = page;
        var container = document.querySelector('#tagManagerList .pending-tag-videos[data-tag="' + tag + '"]');
        if (container && _tagMgrData[tag]) {
            renderTagMgrVideos(tag, container);
        }
    }

    // 从标签移除视频
    function removeVideoFromTag(tag, videoId) {
        // 先找到要删除的项，确定是视频还是图片
        var removedItem = null;
        if (_tagMgrData[tag]) {
            removedItem = _tagMgrData[tag].items.find(function (v) { return v.id === videoId; });
        }
        var isImage = removedItem && removedItem.type === 'image';

        api('DELETE', '/api/tags/' + encodeURIComponent(tag) + '/videos/' + videoId).then(function (r) {
            if (r.code === 200) {
                toast('已移除');
                // 刷新数据
                if (_tagMgrData[tag]) {
                    _tagMgrData[tag].items = _tagMgrData[tag].items.filter(function (v) { return v.id !== videoId; });
                    _tagMgrData[tag].total = _tagMgrData[tag].items.length;
                }
                var container = document.querySelector('#tagManagerList .pending-tag-videos[data-tag="' + tag + '"]');
                if (container) renderTagMgrVideos(tag, container);
                // 更新计数
                _tagMgrItems.forEach(function (t) {
                    if (t.name === tag) {
                        t.count = Math.max(0, (t.count || 1) - 1);
                        if (isImage) {
                            t.imageCount = Math.max(0, (t.imageCount || 1) - 1);
                        } else {
                            t.videoCount = Math.max(0, (t.videoCount || 1) - 1);
                        }
                    }
                });
                // 更新汇总显示（不重新渲染整个列表，避免折叠展开状态）
                var safeId = tag.replace(/[^a-zA-Z0-9]/g, '_');
                var card = document.getElementById('tagMgr-' + safeId);
                if (card) {
                    var summaryEl = card.querySelector('.pending-tag-summary');
                    var item = _tagMgrItems.find(function (i) { return i.name === tag; });
                    if (summaryEl && item) {
                        summaryEl.textContent = (item.videoCount || 0) + ' 个视频 / ' + (item.imageCount || 0) + ' 张图片';
                    }
                }
            } else {
                toast(r.msg || '操作失败');
            }
        });
    }

    // 添加视频到标签（弹窗搜索）
    function openAddVideoToTag(tag) {
        var overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = '<div class="confirm-dialog" style="max-width:500px">' +
            '<div class="confirm-title">添加视频到 ' + esc(tag) + '</div>' +
            '<input class="tag-mgr-search-input" placeholder="搜索视频名称..." style="width:100%;padding:8px 12px;background:var(--input);border:1px solid var(--input-border);border-radius:8px;color:var(--text);font-size:13px;outline:none;font-family:inherit;margin:12px 0"/>' +
            '<div class="tag-mgr-search-results" style="max-height:300px;overflow-y:auto"></div>' +
            '<div class="confirm-actions"><button class="btn btn-outline" onclick="this.closest(\'.confirm-overlay\').remove()">关闭</button></div>' +
        '</div>';

        var input = overlay.querySelector('input');
        var resultsDiv = overlay.querySelector('.tag-mgr-search-results');
        var searchTimer = null;

        input.addEventListener('input', function () {
            clearTimeout(searchTimer);
            var q = input.value.trim();
            if (!q) { resultsDiv.innerHTML = ''; return; }
            searchTimer = setTimeout(function () {
                api('GET', '/api/videos?keyword=' + encodeURIComponent(q) + '&pageSize=20').then(function (r) {
                    if (r.code !== 200) return;
                    var videos = r.data.list || [];
                    if (videos.length === 0) { resultsDiv.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px">无匹配视频</div>'; return; }
                    resultsDiv.innerHTML = videos.map(function (v) {
                        var thumb = v.thumbUrl ? '<img src="' + API + v.thumbUrl + '" style="width:60px;height:34px;object-fit:cover;border-radius:4px;flex-shrink:0"/>' : '<div style="width:60px;height:34px;background:var(--bg3);border-radius:4px;flex-shrink:0"></div>';
                        return '<div class="tag-mgr-search-item" style="display:flex;align-items:center;gap:10px;padding:8px;cursor:pointer;border-radius:8px;transition:background .15s" onmouseover="this.style.background=\'var(--bg-hover)\'" onmouseout="this.style.background=\'\'" onclick="addVideoToTag(\'' + esc(tag) + '\',' + v.id + ',this)">' +
                            thumb +
                            '<span style="font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(v.title || v.fileName || '') + '</span>' +
                            '<button class="btn btn-sm">添加</button>' +
                        '</div>';
                    }).join('');
                });
            }, 300);
        });

        overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
        document.body.appendChild(overlay);
        input.focus();
    }

    // 添加视频到标签（API调用）
    function addVideoToTag(tag, videoId, btnEl) {
        api('POST', '/api/tags/' + encodeURIComponent(tag) + '/videos', { videoId: videoId }).then(function (r) {
            if (r.code === 200) {
                toast('已添加');
                if (btnEl) { btnEl.style.opacity = '0.4'; btnEl.querySelector('.btn').disabled = true; }
                // 刷新该标签的视频列表
                var container = document.querySelector('#tagManagerList .pending-tag-videos[data-tag="' + tag + '"]');
                if (container) { container.dataset.loaded = ''; loadTagMgrVideos(tag, container); }
                _tagMgrItems.forEach(function (t) { if (t.name === tag) t.count = (t.count || 0) + 1; });
            } else {
                toast(r.msg || '添加失败');
            }
        });
    }

    // 编辑标签简介
    function editTagDescription(tag) {
        var meta = _tagMgrMeta[tag] || {};
        var overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = '<div class="confirm-dialog">' +
            '<div class="confirm-title">编辑 #' + esc(tag) + ' 简介</div>' +
            '<textarea class="tag-mgr-desc-input" rows="3" placeholder="输入标签简介..." style="width:100%;padding:10px;background:var(--input);border:1px solid var(--input-border);border-radius:8px;color:var(--text);font-size:14px;outline:none;font-family:inherit;resize:vertical;margin:12px 0">' + esc(meta.description || '') + '</textarea>' +
            '<div class="confirm-actions">' +
                '<button class="btn btn-outline desc-cancel">取消</button>' +
                '<button class="btn desc-ok">保存</button>' +
            '</div>' +
        '</div>';

        var textarea = overlay.querySelector('textarea');
        overlay.querySelector('.desc-cancel').onclick = function () { overlay.remove(); };
        overlay.querySelector('.desc-ok').onclick = function () {
            var desc = textarea.value.trim();
            overlay.remove();
            api('PUT', '/api/tags/' + encodeURIComponent(tag) + '/description', { description: desc }).then(function (r) {
                if (r.code === 200) {
                    toast('简介已更新');
                    if (!_tagMgrMeta[tag]) _tagMgrMeta[tag] = {};
                    _tagMgrMeta[tag].description = desc;
                    renderTagMgrList();
                } else {
                    toast(r.msg || '操作失败');
                }
            });
        };
        overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
        textarea.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); overlay.querySelector('.desc-ok').click(); }
        });
        document.body.appendChild(overlay);
        textarea.focus();
    }

    // 封面选择器
    function openCoverPicker(tag) {
        var data = _tagMgrData[tag];
        if (!data || data.items.length === 0) {
            // 先加载视频数据
            api('GET', '/api/tags/' + encodeURIComponent(tag) + '/videos?pageSize=1000').then(function (r) {
                if (r.code !== 200) return;
                _tagMgrData[tag] = { items: r.data.list || [], total: (r.data.list || []).length };
                showCoverPickerDialog(tag, _tagMgrData[tag].items);
            });
        } else {
            showCoverPickerDialog(tag, data.items);
        }
    }

    function showCoverPickerDialog(tag, items) {
        var overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = '<div class="confirm-dialog" style="max-width:700px;max-height:80vh;overflow-y:auto">' +
            '<div class="confirm-title">选择 #' + esc(tag) + ' 封面</div>' +
            '<div class="tag-mgr-cover-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0"></div>' +
            '<div class="confirm-actions"><button class="btn btn-outline" onclick="this.closest(\'.confirm-overlay\').remove()">取消</button></div>' +
        '</div>';

        var grid = overlay.querySelector('.tag-mgr-cover-grid');
        grid.innerHTML = items.slice(0, 40).map(function (v) {
            var thumbUrl = v.thumbUrl ? (API + v.thumbUrl) : '';
            var imgUrl = v.type === 'image' ? (API + v.url) : thumbUrl;
            return '<div class="tag-mgr-cover-option" style="cursor:pointer;border-radius:8px;overflow:hidden;border:2px solid transparent;transition:border-color .15s" onclick="setTagCover(\'' + esc(tag) + '\',' + v.id + ',this)" onmouseover="this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.borderColor=\'transparent\'">' +
                (imgUrl ? '<img src="' + imgUrl + '" style="width:100%;aspect-ratio:16/9;object-fit:cover;display:block"/>' : '<div style="width:100%;aspect-ratio:16/9;background:var(--bg3)"></div>') +
            '</div>';
        }).join('');

        overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
        document.body.appendChild(overlay);
    }

    // 设置标签封面
    function setTagCover(tag, videoId, el) {
        api('PUT', '/api/tags/' + encodeURIComponent(tag) + '/cover', { videoId: videoId }).then(function (r) {
            if (r.code === 200) {
                toast('封面已更新');
                if (!_tagMgrMeta[tag]) _tagMgrMeta[tag] = {};
                _tagMgrMeta[tag].coverVideoId = videoId;
                _tagMgrMeta[tag].coverUrl = '/api/stream/thumb/' + videoId;
                renderTagMgrList();
                // 关闭弹窗
                var overlay = el.closest('.confirm-overlay');
                if (overlay) overlay.remove();
            } else {
                toast(r.msg || '操作失败');
            }
        });
    }

    function startMgrRenameTag(oldTag) {
        var overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = '<div class="confirm-dialog">' +
            '<div class="confirm-title">重命名标签</div>' +
            '<div class="rename-tag-input-wrap">' +
                '<span class="rename-tag-prefix">#</span>' +
                '<input class="rename-tag-input" type="text" value="' + esc(oldTag.replace(/^#/, '')) + '"/>' +
            '</div>' +
            '<div class="confirm-actions">' +
                '<button class="btn btn-outline rename-cancel">取消</button>' +
                '<button class="btn rename-ok">确认</button>' +
            '</div>' +
        '</div>';

        var input = overlay.querySelector('.rename-tag-input');
        overlay.querySelector('.rename-cancel').onclick = function () { overlay.remove(); };
        overlay.querySelector('.rename-ok').onclick = function () {
            var newName = input.value.trim();
            if (!newName) { toast('标签名不能为空'); return; }
            if (newName === oldTag.replace(/^#/, '')) { overlay.remove(); return; }
            overlay.remove();
            api('POST', '/api/tags/rename', { oldName: oldTag, newName: newName.startsWith('#') ? newName : '#' + newName }).then(function (r) {
                if (r.code === 200) { toast('已重命名'); loadTagManagerList(); }
                else toast(r.msg || '操作失败');
            });
        };
        overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { overlay.querySelector('.rename-ok').click(); }
            if (e.key === 'Escape') { overlay.remove(); }
        });
        document.body.appendChild(overlay);
        input.focus();
        input.select();
    }

    function deleteTag(tagName) {
        showConfirmDialog(
            '删除标签',
            '确定删除标签「' + tagName + '」？该标签将从所有视频中移除，封面和简介也会被删除。',
            function () {
                api('DELETE', '/api/tags/' + encodeURIComponent(tagName)).then(function (r) {
                    if (r.code === 200) { toast('已删除'); loadTagManagerList(); }
                    else toast(r.msg || '操作失败');
                });
            }
        );
    }

    // 合并标签
    function mergeTag(sourceTag) {
        var overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = '<div class="confirm-dialog">' +
            '<div class="confirm-title">合并标签</div>' +
            '<div class="confirm-message">将「' + esc(sourceTag) + '」下的所有视频合并到目标标签，合并后原标签将被删除。</div>' +
            '<div class="rename-tag-input-wrap" style="margin-bottom:4px">' +
                '<span class="rename-tag-prefix">#</span>' +
                '<input class="rename-tag-input" type="text" placeholder="搜索目标标签..." id="mergeSearchInput"/>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--text3);margin-bottom:8px">只能合并到已存在的标签，请从列表中选择</div>' +
            '<div class="tag-merge-suggestions" style="max-height:200px;overflow-y:auto;margin:8px 0;border:1px solid var(--border);border-radius:8px"></div>' +
            '<div class="tag-merge-selected" style="min-height:28px;margin:8px 0"></div>' +
            '<div class="confirm-actions">' +
                '<button class="btn btn-outline merge-cancel">取消</button>' +
                '<button class="btn merge-ok" disabled>合并</button>' +
            '</div>' +
        '</div>';

        var input = overlay.querySelector('#mergeSearchInput');
        var suggestionsDiv = overlay.querySelector('.tag-merge-suggestions');
        var selectedDiv = overlay.querySelector('.tag-merge-selected');
        var okBtn = overlay.querySelector('.merge-ok');
        var selectedTarget = null;

        var updateSelected = function (tagName) {
            selectedTarget = tagName;
            if (tagName) {
                selectedDiv.innerHTML = '<div style="display:inline-flex;align-items:center;gap:6px;background:var(--accent);color:#fff;font-size:12px;padding:4px 12px;border-radius:12px">' +
                    esc(tagName) +
                    '<span style="cursor:pointer;opacity:.7" onclick="this.parentElement.parentElement.innerHTML=\'\';document.querySelector(\'.merge-ok\').disabled=true">✕</span>' +
                '</div>';
                okBtn.disabled = false;
            } else {
                selectedDiv.innerHTML = '';
                okBtn.disabled = true;
            }
        };

        var loadSuggestions = function (q) {
            var url = q ? '/api/tags/search?q=' + encodeURIComponent(q) : '/api/tags';
            api('GET', url).then(function (r) {
                if (r.code !== 200) return;
                var tags = (r.data || []).filter(function (t) { return t.name !== sourceTag; }).slice(0, 10);
                if (tags.length === 0) {
                    suggestionsDiv.innerHTML = '<div style="text-align:center;color:var(--text3);padding:16px;font-size:12px">无匹配标签</div>';
                    return;
                }
                suggestionsDiv.innerHTML = tags.map(function (t) {
                    var isSelected = selectedTarget === t.name;
                    return '<div class="tag-suggestion" onclick="window._selectMergeTarget(\'' + esc(t.name).replace(/'/g, "\\'") + '\')" style="padding:10px 12px;cursor:pointer;border-radius:6px;font-size:13px;color:' + (isSelected ? 'var(--text)' : 'var(--text2)') + ';display:flex;justify-content:space-between;align-items:center;background:' + (isSelected ? 'var(--bg-hover)' : 'transparent') + ';transition:background .15s" onmouseover="if(!\'' + isSelected + '\')this.style.background=\'var(--bg-hover)\'" onmouseout="if(!\'' + isSelected + '\')this.style.background=\'transparent\'">' +
                        '<span style="font-weight:' + (isSelected ? '600' : '400') + '">' + esc(t.name) + '</span>' +
                        '<span style="font-size:11px;color:var(--text3);background:var(--bg3);padding:2px 8px;border-radius:10px">' + t.count + ' 个视频</span>' +
                    '</div>';
                }).join('');
            });
        };

        loadSuggestions('');
        input.addEventListener('input', function () { loadSuggestions(input.value.trim()); });

        overlay.querySelector('.merge-cancel').onclick = function () { overlay.remove(); };
        okBtn.onclick = function () {
            var target = okBtn.getAttribute('data-target');
            if (!target) { toast('请选择目标标签'); return; }
            overlay.remove();
            doMergeTag(sourceTag, target);
        };
        overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { overlay.remove(); }
        });
        document.body.appendChild(overlay);
        input.focus();
    }

    window._selectMergeTarget = function (tagName) {
        var overlay = document.querySelector('.confirm-overlay');
        if (!overlay) return;
        var selectedDiv = overlay.querySelector('.tag-merge-selected');
        var okBtn = overlay.querySelector('.merge-ok');
        if (selectedDiv && okBtn) {
            selectedDiv.innerHTML = '<div style="display:inline-flex;align-items:center;gap:6px;background:var(--accent);color:#fff;font-size:12px;padding:4px 12px;border-radius:12px">' +
                esc(tagName) +
                '<span style="cursor:pointer;opacity:.7" onclick="this.parentElement.parentElement.innerHTML=\'\';var btn=document.querySelector(\'.merge-ok\');btn.disabled=true;btn.removeAttribute(\'data-target\')">✕</span>' +
            '</div>';
            okBtn.disabled = false;
            okBtn.setAttribute('data-target', tagName);
        }
        // 刷新列表高亮
        var input = overlay.querySelector('#mergeSearchInput');
        if (input) {
            var evt = new Event('input');
            input.dispatchEvent(evt);
        }
    };

    function doMergeTag(sourceTag, targetTag) {
        // 1. 先获取源标签下所有视频
        api('GET', '/api/tags/' + encodeURIComponent(sourceTag) + '/videos?pageSize=10000').then(function (r) {
            if (r.code !== 200) { toast('获取视频失败'); return; }
            var videos = (r.data && r.data.list) || [];

            // 2. 给每个视频添加目标标签（跳过已有该标签的）
            var addPromises = videos.map(function (v) {
                var existing = v.hashtag || '';
                var hasTarget = existing.split(',').some(function (t) { return t.trim().toLowerCase() === targetTag.toLowerCase(); });
                if (hasTarget) return Promise.resolve(); // 已有目标标签，跳过
                return api('POST', '/api/videos/' + v.id + '/tags', { tag: targetTag });
            });

            Promise.all(addPromises).then(function () {
                // 3. 删除源标签
                api('DELETE', '/api/tags/' + encodeURIComponent(sourceTag)).then(function (r2) {
                    if (r2.code === 200) {
                        toast('已将 ' + videos.length + ' 个视频合并到 ' + targetTag);
                        loadTagManagerList();
                    } else {
                        toast(r2.msg || '删除源标签失败');
                    }
                });
            });
        });
    }

    // === Tag Dropdown (per-video) ===
    var currentTagVideoId = null;
    var tagDropdownEl = null;

    function toggleTagDropdown(videoId, btn) {
        // 关闭已有的下拉框
        if (tagDropdownEl) {
            tagDropdownEl.remove();
            tagDropdownEl = null;
            if (currentTagVideoId === videoId) {
                currentTagVideoId = null;
                return;
            }
        }

        currentTagVideoId = videoId;
        tagDropdownEl = document.createElement('div');
        tagDropdownEl.className = 'tag-dropdown';
        tagDropdownEl.onclick = function (e) { e.stopPropagation(); };

        // 获取视频当前标签
        api('GET', '/api/videos/' + videoId).then(function (r) {
            if (r.code !== 200) return;
            var video = r.data;
            window._currentVideoTags = video.hashtag ? video.hashtag.split(',').map(function (t) { return t.trim(); }) : [];

            var html = '<div class="tag-dropdown-header">标签管理</div>';

            // 输入框
            html += '<div class="tag-input-wrap">' +
                '<input class="tag-input" placeholder="输入标签..." oninput="window._searchTags(this.value)" onkeydown="if(event.key===\'Enter\')window._addTagFromInput(' + videoId + ',this)"/>' +
                '<button class="tag-confirm" onclick="window._addTagFromInput(' + videoId + ',this.previousElementSibling)">&#10003;</button>' +
                '</div>';

            // 热门标签
            html += '<div class="tag-suggestions" id="tagSuggestions"></div>';

            tagDropdownEl.innerHTML = html;

            // 定位下拉框 (fixed定位追加到body)
            var rect = btn.getBoundingClientRect();
            tagDropdownEl.style.position = 'fixed';
            tagDropdownEl.style.bottom = 'auto';
            tagDropdownEl.style.left = rect.left + rect.width / 2 + 'px';
            tagDropdownEl.style.top = (rect.top - 8) + 'px';
            tagDropdownEl.style.transform = 'translate(-50%,-100%)';
            tagDropdownEl.style.marginBottom = '0';
            document.body.appendChild(tagDropdownEl);

            // 点击外部关闭
            setTimeout(function () {
                document.addEventListener('click', function handler(e) {
                    if (!tagDropdownEl.contains(e.target) && e.target !== btn) {
                        tagDropdownEl.remove();
                        tagDropdownEl = null;
                        currentTagVideoId = null;
                        document.removeEventListener('click', handler);
                    }
                });
            }, 0);

            // 加载热门标签
            loadTagSuggestions('');
        });
    }

    function loadTagSuggestions(query) {
        var url = query ? '/api/tags/search?q=' + encodeURIComponent(query) : '/api/tags';
        api('GET', url).then(function (r) {
            if (r.code !== 200) return;
            var container = document.getElementById('tagSuggestions');
            if (!container) return;

            var tags = r.data || [];
            // 过滤掉已存在的标签
            var currentTags = window._currentVideoTags || [];
            tags = tags.filter(function (t) { return currentTags.indexOf(t.name) === -1; });

            if (tags.length === 0) {
                container.innerHTML = '<div class="tag-no-result">无匹配标签</div>';
                return;
            }

            container.innerHTML = tags.slice(0, 10).map(function (t) {
                return '<div class="tag-suggestion" data-tag="' + esc(t.name) + '">' +
                    '<div class="tag-suggestion-thumb" id="tagThumb-' + esc(t.name).replace(/[^a-zA-Z0-9]/g, '_') + '"><div class="tag-suggestion-thumb-empty">#</div></div>' +
                    '<span class="tag-suggestion-name">' + esc(t.name) + '</span>' +
                    '<span class="tag-count">' + t.count + '</span>' +
                    '</div>';
            }).join('');

            // 绑定点击事件
            container.querySelectorAll('.tag-suggestion').forEach(function (el) {
                el.addEventListener('click', function () { selectTag(el.dataset.tag); });
            });

            // 异步加载每个标签的缩略图
            tags.slice(0, 10).forEach(function (t) {
                loadTagThumb(t.name);
            });
        });
    }

    function loadTagThumb(tagName) {
        var safeId = tagName.replace(/[^a-zA-Z0-9]/g, '_');
        var thumbEl = document.getElementById('tagThumb-' + safeId);
        if (!thumbEl) return;
        // 先查标签封面
        api('GET', '/api/tags/' + encodeURIComponent(tagName) + '/meta').then(function (r) {
            if (r.code === 200 && r.data && r.data.coverUrl) {
                thumbEl.innerHTML = '<img src="' + API + r.data.coverUrl + '" onerror="this.parentElement.innerHTML=\'<div class=tag-suggestion-thumb-empty>#</div>\'"/>';
                return;
            }
            // 没有封面，取第一个视频的缩略图
            api('GET', '/api/tags/' + encodeURIComponent(tagName) + '/videos?pageSize=1').then(function (r2) {
                if (r2.code === 200 && r2.data && r2.data.list && r2.data.list.length > 0) {
                    var v = r2.data.list[0];
                    var thumb = v.thumbUrl ? API + v.thumbUrl : '';
                    if (thumb) {
                        thumbEl.innerHTML = '<img src="' + thumb + '" onerror="this.parentElement.innerHTML=\'<div class=tag-suggestion-thumb-empty>#</div>\'"/>';
                    }
                }
            });
        });
    }

    function searchTags(query) {
        // 检查是否在详情页
        if (state.currentVideoId && document.getElementById('detailTagSuggestions')) {
            loadDetailTagSuggestions(query);
        } else {
            loadTagSuggestions(query);
        }
    }

    function hideTagPreview() {}
    function selectTag(tag) {
        var input = document.querySelector('.tag-input');
        if (input) input.value = tag;
    }

    function addTagFromInput(videoId, input) {
        var tag = input.value.trim();
        if (!tag) return;

        api('POST', '/api/videos/' + videoId + '/tags', { tag: tag }).then(function (r) {
            if (r.code === 200) {
                toast('标签已添加');
                input.value = '';
                closeTagDropdown();
                // 如果在详情页，只刷新详情不跳转
                if (state.currentVideoId === videoId) {
                    api('GET', '/api/videos/' + videoId).then(function (r2) {
                        if (r2.code === 200) {
                            renderDetailInfo(r2.data);
                            loadDetailTagCollections(r2.data);
                        }
                    });
                } else {
                    loadVideos();
                }
            } else {
                toast(r.msg || '添加失败');
            }
        });
    }

    function removeTag(videoId, tag) {
        api('DELETE', '/api/videos/' + videoId + '/tags?tag=' + encodeURIComponent(tag)).then(function (r) {
            if (r.code === 200) {
                toast('标签已删除');
                closeTagDropdown();
                // 如果在详情页，只刷新详情不跳转
                if (state.currentVideoId === videoId) {
                    api('GET', '/api/videos/' + videoId).then(function (r2) {
                        if (r2.code === 200) {
                            renderDetailInfo(r2.data);
                            loadDetailTagCollections(r2.data);
                        }
                    });
                } else {
                    loadVideos();
                }
            } else {
                toast(r.msg || '删除失败');
            }
        });
    }

    function closeTagDropdown() {
        if (tagDropdownEl) {
            tagDropdownEl.remove();
            tagDropdownEl = null;
            currentTagVideoId = null;
        }
    }

    // 点击外部关闭标签下拉框
    document.addEventListener('click', function (e) {
        // 不要在标签按钮或下拉框内部点击时关闭
        if (e.target.closest('.detail-like-btn') || e.target.closest('.feed-tag-btn')) return;
        if (e.target.closest('.tag-dropdown')) return;
        closeTagDropdown();
        closeDetailTagDropdown();
    });

    function toggleFolderPanel() {
        switchView('folders');
    }

    // === Actions ===
    function doSearch() {
        state.keyword = document.getElementById('searchInput').value.trim();
        var rightInput = document.getElementById('searchInputRight');
        if (rightInput) rightInput.value = state.keyword;
        var detailInput = document.getElementById('detailSearchInput');
        if (detailInput) detailInput.value = state.keyword;
        // 保存到最近搜索
        if (state.keyword) saveRecentSearch(state.keyword);
        state.page = 1;
        // 详情页搜索: 关闭详情, 跳回首页搜索
        var detailView = document.getElementById('detailView');
        var isDetailOpen = detailView && detailView.style.display !== 'none';
        if (isDetailOpen) {
            closeDetail(false);
            state.currentView = 'home';
            updateNav();
            document.getElementById('pendingView').style.display = 'none';
            document.getElementById('tagMgrView').style.display = 'none';
            document.getElementById('listView').style.display = '';
            filterState['home'] = { type: state.type, category: state.category, keyword: state.keyword, page: 1 };
            loadVideos();
            return;
        }
        // 保存当前页面的搜索关键词
        if (state.currentView === 'home' || state.currentView === 'likes') {
            filterState[state.currentView].keyword = state.keyword;
            filterState[state.currentView].page = 1;
        }
        // 非首页/点赞页搜索时跳转到首页
        if (state.currentView !== 'home' && state.currentView !== 'likes') {
            state.currentView = 'home';
            updateNav();
            document.getElementById('pendingView').style.display = 'none';
            document.getElementById('detailView').style.display = 'none';
            document.getElementById('tagMgrView').style.display = 'none';
            document.getElementById('listView').style.display = '';
            loadVideos();
            return;
        }
        if (state.currentView === 'likes') loadLikedVideos();
        else loadVideos();
    }
    function clearSearch() {
        document.getElementById('searchInput').value = '';
        var rightInput = document.getElementById('searchInputRight');
        if (rightInput) rightInput.value = '';
        var detailInput = document.getElementById('detailSearchInput');
        if (detailInput) detailInput.value = '';
        state.keyword = '';
        state.page = 1;
        var clearBtn = document.getElementById('rightSearchClear');
        if (clearBtn) clearBtn.style.visibility = 'hidden';
        if (state.currentView === 'home' || state.currentView === 'likes') {
            filterState[state.currentView].keyword = '';
            filterState[state.currentView].page = 1;
        }
        if (state.currentView === 'likes') loadLikedVideos();
        else loadVideos();
    }
    function toggleRightSearchClear(input) {
        var clearBtn = document.getElementById('rightSearchClear');
        if (clearBtn) clearBtn.style.visibility = input.value ? 'visible' : 'hidden';
    }
    function clearRightSearch() {
        document.getElementById('searchInputRight').value = '';
        document.getElementById('rightSearchClear').style.visibility = 'hidden';
        document.getElementById('searchInput').value = '';
        clearSearch();
    }
    function toggleDetailSearchClear(input) {
        var clearBtn = document.getElementById('detailSearchClear');
        if (clearBtn) clearBtn.style.visibility = input.value ? 'visible' : 'hidden';
    }
    function clearDetailSearch() {
        document.getElementById('detailSearchInput').value = '';
        document.getElementById('detailSearchClear').style.visibility = 'hidden';
        document.getElementById('searchInput').value = '';
        clearSearch();
    }
    function toggleTagSearchClear(input) {
        var clearBtn = input.parentElement.querySelector('.tag-search-clear');
        if (clearBtn) clearBtn.style.visibility = input.value ? 'visible' : 'hidden';
    }
    function clearTagMgrSearch() {
        document.getElementById('tagMgrSearch').value = '';
        document.getElementById('tagMgrSearchClear').style.visibility = 'hidden';
        filterTagMgr();
    }
    function clearPendingSearch() {
        document.getElementById('pendingSearch').value = '';
        document.getElementById('pendingSearchClear').style.visibility = 'hidden';
        filterPendingTags();
    }
    function searchTag(tag) {
        document.getElementById('searchInput').value = tag;
        var rightInput = document.getElementById('searchInputRight');
        if (rightInput) rightInput.value = tag;
        state.keyword = tag;
        state.page = 1;
        // 保存到过滤状态
        if (state.currentView === 'home' || state.currentView === 'likes') {
            filterState[state.currentView] = { type: state.type, category: state.category, keyword: tag, page: 1 };
        }
        loadVideos();
        window.scrollTo({ top: 0 });
    }
    function goPage(p) {
        if (p < 1 || p > state.totalPages) return;
        state.page = p;
        // 保存页码到过滤状态
        if (state.currentView === 'home' || state.currentView === 'likes') {
            filterState[state.currentView].page = p;
        }
        if (state.currentView === 'likes') loadLikedVideos();
        else loadVideos();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function toggleLike(id, btn) {
        api('POST', '/api/videos/' + id + '/like').then(function (r) {
            if (r.code === 200) {
                toast(r.data);
                var isLiked = r.data === '已点赞';

                // 如果传入了按钮引用，直接更新该按钮
                if (btn) {
                    btn.classList.toggle('liked', isLiked);
                    var countSpan = btn.querySelector('span');
                    if (countSpan) {
                        var current = parseInt(countSpan.textContent) || 0;
                        countSpan.textContent = isLiked ? current + 1 : Math.max(0, current - 1);
                    }
                }

                // 更新所有匹配的卡片
                var cards = document.querySelectorAll('[data-video-id="' + id + '"]');
                cards.forEach(function (card) {
                    var likeBtn = card.querySelector('.card-like');
                    if (!likeBtn) {
                        var btns = card.querySelectorAll('.feed-action-btn');
                        if (btns.length >= 2) likeBtn = btns[btns.length - 1];
                    }
                    if (!likeBtn || likeBtn === btn) return;

                    likeBtn.classList.toggle('liked', isLiked);
                    var countSpan = likeBtn.querySelector('span');
                    if (countSpan) {
                        var current = parseInt(countSpan.textContent) || 0;
                        countSpan.textContent = isLiked ? current + 1 : Math.max(0, current - 1);
                    }
                });

                if (state.currentView === 'likes') {
                    loadLikedVideos();
                }
            }
        });
    }

    // === Delete & Rename Video ===
    function showDeleteDialog(videoId, title) {
        var overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = '<div class="confirm-dialog">' +
            '<div class="confirm-title" style="color:var(--red)">⚠️ 删除视频</div>' +
            '<div class="confirm-message">确定要删除「<strong>' + esc(title) + '</strong>」吗？</div>' +
            '<div class="confirm-body" style="border:1px solid var(--red);background:rgba(244,33,46,.05)">' +
                '<div style="color:var(--red);font-weight:700;margin-bottom:6px">此操作将：</div>' +
                '<div style="font-size:13px;color:var(--text1);line-height:1.8">• 删除原文件（不可恢复）<br>• 删除所有点赞记录<br>• 删除所有评论<br>• 删除数据库记录</div>' +
            '</div>' +
            '<div class="confirm-actions">' +
                '<button class="btn btn-outline confirm-cancel">取消</button>' +
                '<button class="btn btn-red confirm-ok">确认删除</button>' +
            '</div>' +
        '</div>';
        overlay.querySelector('.confirm-cancel').onclick = function () { overlay.remove(); };
        overlay.querySelector('.confirm-ok').onclick = function () {
            overlay.remove();
            deleteVideo(videoId);
        };
        overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
        document.body.appendChild(overlay);
    }

    function deleteVideo(videoId) {
        api('DELETE', '/api/videos/' + videoId).then(function (r) {
            if (r.code === 200) {
                toast('已删除');
                closeDetail(true);
                loadVideos();
            } else {
                toast(r.msg || '删除失败');
            }
        }).catch(function () { toast('删除失败'); });
    }

    function showRenameDialog(videoId, currentTitle) {
        var overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = '<div class="confirm-dialog">' +
            '<div class="confirm-title">重命名文件</div>' +
            '<div class="rename-tag-input-wrap">' +
                '<input class="rename-tag-input" type="text" value="' + esc(currentTitle) + '"/>' +
            '</div>' +
            '<div style="font-size:12px;color:var(--text2);margin-top:8px">扩展名会自动保留</div>' +
            '<div class="confirm-actions" style="margin-top:16px">' +
                '<button class="btn btn-outline rename-cancel">取消</button>' +
                '<button class="btn rename-ok">确认</button>' +
            '</div>' +
        '</div>';
        var input = overlay.querySelector('.rename-tag-input');
        overlay.querySelector('.rename-cancel').onclick = function () { overlay.remove(); };
        overlay.querySelector('.rename-ok').onclick = function () {
            var newName = input.value.trim();
            if (!newName) { toast('文件名不能为空'); return; }
            if (newName === currentTitle) { overlay.remove(); return; }
            overlay.remove();
            renameVideo(videoId, newName);
        };
        overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') overlay.querySelector('.rename-ok').click();
            if (e.key === 'Escape') overlay.remove();
        });
        document.body.appendChild(overlay);
        input.focus();
        input.select();
    }

    function renameVideo(videoId, newName) {
        api('POST', '/api/videos/' + videoId + '/rename', { newName: newName }).then(function (r) {
            if (r.code === 200) {
                toast('重命名成功');
                // 只刷新详情页，不跳转
                api('GET', '/api/videos/' + videoId).then(function (r2) {
                    if (r2.code === 200) renderDetailInfo(r2.data);
                });
            } else {
                toast(r.msg || '重命名失败');
            }
        }).catch(function () { toast('重命名失败'); });
    }

    // === Refresh Thumbnail ===
    function showRefreshThumbDialog(videoId) {
        var overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.id = 'refreshThumbOverlay';
        overlay.innerHTML = '<div class="confirm-dialog" style="max-width:520px">' +
            '<div class="confirm-title">刷新视频封面</div>' +
            '<div class="confirm-message">选择截取位置，点击预览查看效果，满意后确认更换</div>' +
            '<div class="refresh-thumb-options" id="refreshThumbOptions">' +
                '<div class="refresh-thumb-option" onclick="previewRefreshThumb(' + videoId + ',-1,this)">' +
                    '<div class="refresh-thumb-preview" id="rtp--1"><div class="refresh-thumb-placeholder">智能</div></div>' +
                    '<div class="refresh-thumb-label">默认</div>' +
                '</div>' +
                '<div class="refresh-thumb-option" onclick="previewRefreshThumb(' + videoId + ',25,this)">' +
                    '<div class="refresh-thumb-preview" id="rtp-25"><div class="refresh-thumb-placeholder">25%</div></div>' +
                    '<div class="refresh-thumb-label">25%</div>' +
                '</div>' +
                '<div class="refresh-thumb-option" onclick="previewRefreshThumb(' + videoId + ',50,this)">' +
                    '<div class="refresh-thumb-preview" id="rtp-50"><div class="refresh-thumb-placeholder">50%</div></div>' +
                    '<div class="refresh-thumb-label">50%</div>' +
                '</div>' +
                '<div class="refresh-thumb-option" onclick="previewRefreshThumb(' + videoId + ',75,this)">' +
                    '<div class="refresh-thumb-preview" id="rtp-75"><div class="refresh-thumb-placeholder">75%</div></div>' +
                    '<div class="refresh-thumb-label">75%</div>' +
                '</div>' +
            '</div>' +
            '<div id="refreshThumbStatus" style="text-align:center;font-size:13px;color:var(--text2);margin-top:12px;min-height:20px">选择一个位置预览</div>' +
            '<div class="confirm-actions" style="margin-top:12px">' +
                '<button class="btn btn-outline" onclick="this.closest(\'.confirm-overlay\').remove()">取消</button>' +
            '</div>' +
        '</div>';
        overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
        document.body.appendChild(overlay);
    }

    function previewRefreshThumb(videoId, percent, el) {
        var status = document.getElementById('refreshThumbStatus');
        status.textContent = '截取中...';
        document.querySelectorAll('.refresh-thumb-option').forEach(function (o) { o.classList.remove('selected'); });
        el.classList.add('selected');

        // 移除旧的确认按钮
        var oldBtn = document.querySelector('.refresh-confirm-btn');
        if (oldBtn) oldBtn.remove();

        // 调用后端ffmpeg截取预览
        api('POST', '/api/videos/' + videoId + '/refresh-thumb', { percent: percent }).then(function (r) {
            if (r.code === 200 && r.data && r.data.thumbUrl) {
                var preview = el.querySelector('.refresh-thumb-preview');
                preview.innerHTML = '<img src="' + API + r.data.thumbUrl + '?t=' + Date.now() + '"/>';
                status.textContent = '预览满意后点击「确认更换」';
                // 添加确认按钮（此时缩略图已由后端生成，确认即完成）
                var actions = document.getElementById('refreshThumbOverlay').querySelector('.confirm-actions');
                if (!actions.querySelector('.refresh-confirm-btn')) {
                    var btn = document.createElement('button');
                    btn.className = 'btn refresh-confirm-btn';
                    btn.textContent = '确认更换';
                    btn.onclick = function () {
                        toast('封面已更新');
                        var overlay = document.getElementById('refreshThumbOverlay');
                        if (overlay) overlay.remove();
                        // 更新详情页信息
                        api('GET', '/api/videos/' + videoId).then(function (r2) {
                            if (r2.code === 200) renderDetailInfo(r2.data);
                        });
                        // 立即更新列表页中该视频的缩略图
                        var newThumbUrl = API + r.data.thumbUrl + '?t=' + Date.now();
                        var cards = document.querySelectorAll('[data-video-id="' + videoId + '"]');
                        cards.forEach(function (card) {
                            var thumbImg = card.querySelector('.card-thumb, .pending-video-thumb, .feed-thumb, .hot-tag-video-thumb');
                            if (thumbImg && thumbImg.tagName === 'IMG') {
                                thumbImg.src = newThumbUrl;
                            }
                        });
                        // 同时更新所有懒加载的缩略图（网格模式、热门标签、预分标签等）
                        var lazySelectors = [
                            'img.card-thumb[data-src*="/api/stream/thumb/' + videoId + '"]',
                            'img.pending-video-thumb[data-src*="/api/stream/thumb/' + videoId + '"]',
                            'img.hot-tag-video-thumb[data-src*="/api/stream/thumb/' + videoId + '"]'
                        ];
                        lazySelectors.forEach(function (sel) {
                            document.querySelectorAll(sel).forEach(function (img) {
                                img.src = newThumbUrl;
                                img.dataset.src = API + r.data.thumbUrl;
                            });
                        });
                    };
                    actions.insertBefore(btn, actions.firstChild);
                }
            } else {
                status.textContent = r.msg || '截取失败';
            }
        }).catch(function () { status.textContent = '请求失败'; });
    }

    // === Danmaku System ===
    var _danmakuData = [];
    var _danmakuVisible = localStorage.getItem('danmakuOn') !== 'false';
    var _danmakuVideoId = null;
    var _danmakuCleanupFns = {};

    // 保存弹幕开关状态到后端 + localStorage
    function saveDanmakuState() {
        localStorage.setItem('danmakuOn', _danmakuVisible ? 'true' : 'false');
        api('POST', '/api/user/settings', { settings: JSON.stringify({ danmakuOn: _danmakuVisible }) });
    }

    // 从后端加载用户设置
    function loadUserSettings() {
        api('GET', '/api/user/settings').then(function (r) {
            if (r.code === 200 && r.data) {
                try {
                    var settings = JSON.parse(r.data);
                    if (settings.hasOwnProperty('danmakuOn')) {
                        _danmakuVisible = settings.danmakuOn;
                        localStorage.setItem('danmakuOn', _danmakuVisible ? 'true' : 'false');
                        syncDanmakuUI();
                    }
                } catch (e) {}
            }
        });
    }

    // 同步所有弹幕 UI（按钮 + 输入框）
    function syncDanmakuUI() {
        // 弹窗播放器
        var modal = document.getElementById('danmakuToggleModal');
        if (modal) modal.classList.toggle('active', _danmakuVisible);
        // 详情页
        var detail = document.getElementById('danmakuToggleFsBtn');
        if (detail) detail.classList.toggle('active', _danmakuVisible);
        // 列表卡片
        document.querySelectorAll('.feed-danmaku-toggle').forEach(function (b) {
            b.classList.toggle('active', _danmakuVisible);
        });
        // 所有弹幕输入框禁用状态 + 提示词
        var disabled = !_danmakuVisible;
        var placeholder = _danmakuVisible ? '发弹幕，回车发送' : '弹幕已关闭';
        document.querySelectorAll('.danmaku-input').forEach(function (inp) {
            inp.disabled = disabled;
            inp.placeholder = placeholder;
            if (disabled && document.activeElement === inp) inp.blur();
        });
    }

    function loadDanmaku(videoId) {
        _danmakuVideoId = videoId;
        _danmakuData = [];
        api('GET', '/api/videos/' + videoId + '/danmaku').then(function (r) {
            if (r.code === 200 && r.data) {
                _danmakuData = r.data;
            }
        });
    }

    function sendDanmaku() {
        var input = document.getElementById('danmakuInputModal');
        if (!input) return;
        if (!_danmakuVisible) { toast('弹幕已关闭，请先开启弹幕'); return; }
        var content = input.value.trim();
        if (!content || !_danmakuVideoId) return;
        var vid = document.getElementById('modalVideo');
        var timePoint = vid ? vid.currentTime : 0;
        input.value = '';
        renderDanmakuItem({ content: content, color: '#ffffff' }, 'danmakuLayerModal');
        api('POST', '/api/videos/' + _danmakuVideoId + '/danmaku', { content: content, timePoint: timePoint, color: '#ffffff' });
    }

    function sendDetailDanmaku() {
        var input = document.getElementById('danmakuInputDetail');
        if (!input || !state.currentVideoId) return;
        if (!_danmakuVisible) { toast('弹幕已关闭，请先开启弹幕'); return; }
        var content = input.value.trim();
        if (!content) return;
        var vid = document.getElementById('detailVideo');
        var timePoint = vid ? vid.currentTime : 0;
        input.value = '';
        renderDanmakuItem({ content: content, color: '#ffffff' }, 'danmakuLayerDetail');
        api('POST', '/api/videos/' + state.currentVideoId + '/danmaku', { content: content, timePoint: timePoint, color: '#ffffff' });
    }

    function toggleDanmaku() {
        _danmakuVisible = !_danmakuVisible;
        saveDanmakuState();
        syncDanmakuUI();
        var layer = document.getElementById('danmakuLayerModal');
        if (layer) layer.innerHTML = '';
    }

    function toggleDetailDanmaku() {
        _danmakuVisible = !_danmakuVisible;
        saveDanmakuState();
        syncDanmakuUI();
        var layer = document.getElementById('danmakuLayerDetail');
        if (layer) layer.innerHTML = '';
    }

    function clearAllDanmakuItems() {
        document.querySelectorAll('.danmaku-layer').forEach(function (layer) {
            layer.innerHTML = '';
        });
    }

    function startDanmakuLoop(videoId, layerId, video) {
        _danmakuVideoId = videoId;
        var lastTime = -1;
        var fired = new Set();
        var onTimeUpdate = function () {
            if (!_danmakuVisible || !_danmakuData.length) return;
            var currentTime = video.currentTime;
            if (currentTime < lastTime) fired.clear();
            lastTime = currentTime;
            _danmakuData.forEach(function (d, i) {
                if (!fired.has(i) && d.timePoint <= currentTime + 0.5 && d.timePoint >= currentTime - 1) {
                    fired.add(i);
                    renderDanmakuItem(d, layerId);
                }
            });
        };
        video.addEventListener('timeupdate', onTimeUpdate);
        _danmakuCleanupFns[layerId] = function () {
            video.removeEventListener('timeupdate', onTimeUpdate);
            var layer = document.getElementById(layerId);
            if (layer) layer.innerHTML = '';
        };
    }

    function stopDanmakuLoop(layerId) {
        if (_danmakuCleanupFns[layerId]) {
            _danmakuCleanupFns[layerId]();
            delete _danmakuCleanupFns[layerId];
        }
    }

    function renderDanmakuItem(danmaku, layerId) {
        var layer = document.getElementById(layerId);
        if (!layer) return;
        var el = document.createElement('div');
        el.className = 'danmaku-item';
        el.textContent = danmaku.content;
        el.style.color = danmaku.color || '#fff';
        el.style.top = Math.random() * 70 + 5 + '%';
        var duration = 7 + Math.random() * 5;
        el.style.animationDuration = duration + 's';
        layer.appendChild(el);
        el.addEventListener('animationend', function () { el.remove(); });
    }

    // === Feed Danmaku ===
    var _feedDanmakuData = {};

    function sendFeedDanmaku(input, videoId) {
        if (!_danmakuVisible) { toast('弹幕已关闭，请先开启弹幕'); return; }
        var content = input.value.trim();
        if (!content) return;
        var wrap = input.closest('.feed-video-wrap');
        var video = wrap ? wrap.querySelector('video') : null;
        var timePoint = video ? video.currentTime : 0;
        input.value = '';
        var layerId = 'danmakuLayerFeed' + videoId;
        renderDanmakuItem({ content: content, color: '#ffffff' }, layerId);
        api('POST', '/api/videos/' + videoId + '/danmaku', { content: content, timePoint: timePoint, color: '#ffffff' });
    }

    function toggleFeedDanmaku(btn, videoId) {
        _danmakuVisible = !_danmakuVisible;
        saveDanmakuState();
        syncDanmakuUI();
        var layer = document.getElementById('danmakuLayerFeed' + videoId);
        if (layer) layer.innerHTML = '';
    }

    // === Hot Tags Page ===
    var _hotTagsData = [];
    var _hotTagsFiltered = [];
    var _hotTagsLoaded = false;
    var _hotTagPage = 1;
    var _HOT_TAGS_PER_PAGE = 20;
    var _HOT_TAG_VIDEO_PAGE_SIZE = 20;

    function loadHotTags() {
        if (_hotTagsLoaded) {
            _hotTagPage = 1;
            renderHotTagsPage();
            return;
        }
        var grid = document.getElementById('hotTagsGrid');
        if (!grid) return;
        grid.innerHTML = '<div class="hot-tag-loading"><div class="pending-spinner"></div>加载中...</div>';
        api('GET', '/api/tags').then(function (r) {
            if (r.code !== 200) { grid.innerHTML = '<div class="hot-tag-empty">加载失败</div>'; return; }
            var tags = r.data || [];
            // 并行获取每个标签的浏览数和点赞数
            var promises = tags.map(function (t) {
                return Promise.all([
                    api('GET', '/api/tags/' + encodeURIComponent(t.name) + '/videos?pageSize=1000'),
                    api('GET', '/api/tags/' + encodeURIComponent(t.name) + '/meta')
                ]).then(function (results) {
                    var videos = (results[0].code === 200 && results[0].data) ? (results[0].data.list || []) : [];
                    var totalViews = 0, totalLikes = 0;
                    videos.forEach(function (v) { totalViews += (v.viewCount || 0); totalLikes += (v.likeCount || 0); });
                    t.totalViews = totalViews;
                    t.totalLikes = totalLikes;
                    t.description = (results[1].code === 200 && results[1].data) ? (results[1].data.description || '') : '';
                    return t;
                }).catch(function () { t.totalViews = 0; t.totalLikes = 0; t.description = ''; return t; });
            });
            Promise.all(promises).then(function (results) {
                _hotTagsData = results.sort(function (a, b) { return (b.totalViews || 0) - (a.totalViews || 0); });
                _hotTagsFiltered = _hotTagsData;
                _hotTagsLoaded = true;
                _hotTagPage = 1;
                renderHotTagsPage();
            });
        });
    }

    function renderHotTagsPage() {
        var grid = document.getElementById('hotTagsGrid');
        if (!grid) return;
        var tags = _hotTagsFiltered;
        if (!tags || tags.length === 0) {
            grid.innerHTML = '<div class="hot-tag-empty">暂无标签</div>';
            return;
        }
        var totalPages = Math.ceil(tags.length / _HOT_TAGS_PER_PAGE);
        if (_hotTagPage > totalPages) _hotTagPage = totalPages;
        var start = (_hotTagPage - 1) * _HOT_TAGS_PER_PAGE;
        var pageTags = tags.slice(start, start + _HOT_TAGS_PER_PAGE);

        var html = pageTags.map(function (t, i) {
            var idx = start + i;
            var rank = idx + 1;
            var rankClass = rank <= 3 ? ' rank-' + rank : '';
            var rankLabel = rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : rank;
            // 统一处理标签名：去掉开头的#用于显示
            var displayName = t.name.replace(/^#+/, '');
            var firstChar = displayName.charAt(0).toUpperCase() || '#';
            return '<div class="hot-tag-card' + rankClass + '" data-tag="' + esc(t.name) + '">' +
                '<div class="hot-tag-header" onclick="toggleHotTagExpand(this)">' +
                    '<div class="hot-tag-rank">' + rankLabel + '</div>' +
                    '<div class="hot-tag-cover" id="htCover-' + idx + '"><div class="hot-tag-cover-empty">' + esc(firstChar) + '</div></div>' +
                    '<div class="hot-tag-info">' +
                        '<div class="hot-tag-name">#' + esc(displayName) + '</div>' +
                        (t.description ? '<div class="hot-tag-desc">' + esc(t.description) + '</div>' : '') +
                        '<div class="hot-tag-count">' + (t.count || 0) + ' 个内容</div>' +
                        '<div class="hot-tag-stats">' +
                            '<span class="hot-tag-stat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' + fmtCount(t.totalViews || 0) + '</span>' +
                            '<span class="hot-tag-stat hot-tag-stat-likes"><svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' + fmtCount(t.totalLikes || 0) + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<svg class="hot-tag-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>' +
                '</div>' +
                '<div class="hot-tag-videos" data-tag="' + esc(t.name) + '"></div>' +
            '</div>';
        }).join('');

        // 分页
        if (totalPages > 1) {
            html += '<div class="hot-tag-pagination">';
            html += '<button onclick="goHotTagPage(1)"' + (_hotTagPage <= 1 ? ' disabled' : '') + '>首页</button>';
            html += '<button onclick="goHotTagPage(' + (_hotTagPage - 1) + ')"' + (_hotTagPage <= 1 ? ' disabled' : '') + '>上一页</button>';
            html += '<span class="info">第' + _hotTagPage + ' / ' + totalPages + ' 页 (共' + tags.length + '个标签)</span>';
            html += '<button onclick="goHotTagPage(' + (_hotTagPage + 1) + ')"' + (_hotTagPage >= totalPages ? ' disabled' : '') + '>下一页</button>';
            html += '<button onclick="goHotTagPage(' + totalPages + ')"' + (_hotTagPage >= totalPages ? ' disabled' : '') + '>末页</button>';
            html += '<div class="jump"><label>跳转</label>';
            html += '<input type="number" min="1" max="' + totalPages + '" placeholder="/' + totalPages + '" onkeydown="if(event.key===\'Enter\')goHotTagPage(parseInt(this.value))"/>';
            html += '<button onclick="goHotTagPage(parseInt(this.previousElementSibling.value))">GO</button>';
            html += '</div></div>';
        }

        grid.innerHTML = html;
        // 异步加载封面
        pageTags.forEach(function (t, i) { loadHotTagCover(t.name, start + i); });
    }

    function goHotTagPage(page) {
        _hotTagPage = page;
        renderHotTagsPage();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function loadHotTagCover(tagName, index) {
        var coverEl = document.getElementById('htCover-' + index);
        if (!coverEl) return;
        api('GET', '/api/tags/' + encodeURIComponent(tagName) + '/meta').then(function (r) {
            if (r.code === 200 && r.data && r.data.coverUrl) {
                var img = new Image();
                img.onload = function () { coverEl.innerHTML = '<img src="' + API + r.data.coverUrl + '"/>'; };
                img.src = API + r.data.coverUrl;
                return;
            }
            api('GET', '/api/tags/' + encodeURIComponent(tagName) + '/videos?pageSize=1').then(function (r2) {
                if (r2.code === 200 && r2.data && r2.data.list && r2.data.list.length > 0) {
                    var v = r2.data.list[0];
                    var thumbUrl = v.thumbUrl ? API + v.thumbUrl : '';
                    if (thumbUrl) {
                        var img2 = new Image();
                        img2.onload = function () { coverEl.innerHTML = '<img src="' + thumbUrl + '"/>'; };
                        img2.src = thumbUrl;
                    }
                }
            });
        });
    }

    function toggleHotTagExpand(header) {
        var card = header.closest('.hot-tag-card');
        if (!card) return;
        var tagName = card.dataset.tag;
        var videosDiv = card.querySelector('.hot-tag-videos');
        if (!videosDiv) return;
        if (card.classList.contains('expanded')) {
            card.classList.remove('expanded');
        } else {
            card.classList.add('expanded');
            if (!videosDiv.dataset.loaded) {
                videosDiv.dataset.page = '1';
                loadHotTagVideos(tagName, videosDiv);
            }
        }
    }

    function loadHotTagVideos(tagName, container) {
        var page = parseInt(container.dataset.page) || 1;
        container.innerHTML = '<div class="hot-tag-loading"><div class="pending-spinner"></div>加载中...</div>';
        var params = new URLSearchParams({ page: page, pageSize: _HOT_TAG_VIDEO_PAGE_SIZE });
        api('GET', '/api/tags/' + encodeURIComponent(tagName) + '/videos?' + params).then(function (r) {
            if (r.code !== 200) { container.innerHTML = '<div class="hot-tag-empty">加载失败</div>'; return; }
            var d = r.data || {};
            var videos = d.list || [];
            if (videos.length === 0 && page === 1) {
                container.innerHTML = '<div class="hot-tag-empty">暂无内容</div>';
                container.dataset.loaded = '1';
                return;
            }
            renderHotTagVideoGrid(container, videos, d.total || 0, page, tagName);
            container.dataset.loaded = '1';
        });
    }

    function renderHotTagVideoGrid(container, videos, total, page, tagName) {
        var html = '<div class="hot-tag-video-grid">';
        videos.forEach(function (v) {
            html += buildHotTagVideoCard(v);
        });
        html += '</div>';
        // 分页
        var totalPages = Math.ceil(total / _HOT_TAG_VIDEO_PAGE_SIZE);
        if (totalPages > 1) {
            html += '<div class="hot-tag-pagination">';
            html += '<button onclick="goHotTagVideoPage(this,\'' + esc(tagName) + '\',1)"' + (page <= 1 ? ' disabled' : '') + '>首页</button>';
            html += '<button onclick="goHotTagVideoPage(this,\'' + esc(tagName) + '\',' + (page - 1) + ')"' + (page <= 1 ? ' disabled' : '') + '>上一页</button>';
            html += '<span class="info">第' + page + ' / ' + totalPages + ' 页 (共' + total + '个)</span>';
            html += '<button onclick="goHotTagVideoPage(this,\'' + esc(tagName) + '\',' + (page + 1) + ')"' + (page >= totalPages ? ' disabled' : '') + '>下一页</button>';
            html += '<button onclick="goHotTagVideoPage(this,\'' + esc(tagName) + '\',' + totalPages + ')"' + (page >= totalPages ? ' disabled' : '') + '>末页</button>';
            html += '</div>';
        }
        container.innerHTML = html;
        // 懒加载
        container.querySelectorAll('[data-src]').forEach(function (el) { observeLazy(el); });
    }

    function buildHotTagVideoCard(v) {
        var thumb = '';
        var preview = '';
        var isImage = v.type === 'image';
        if (isImage && v.thumbUrl) {
            thumb = '<img class="hot-tag-video-thumb" data-src="' + API + v.thumbUrl + '"/>';
        } else if (isImage) {
            thumb = '<img class="hot-tag-video-thumb" data-src="' + API + v.url + '"/>';
        } else if (v.thumbUrl) {
            thumb = '<img class="hot-tag-video-thumb" data-src="' + API + v.thumbUrl + '"/>';
            preview = '<video class="hot-tag-video-preview" muted preload="none" data-src="' + API + v.url + '"></video>';
        } else if (v.url) {
            thumb = '<video class="hot-tag-video-thumb" muted preload="metadata" data-src="' + API + v.url + '"></video>';
            preview = '<video class="hot-tag-video-preview" muted preload="none" data-src="' + API + v.url + '"></video>';
        } else {
            thumb = '<div class="hot-tag-video-thumb-empty">?</div>';
        }
        var title = esc(v.title || v.fileName || '');
        var click = isImage ? 'onclick="window._showImage(' + v.id + ')"' : 'onclick="window._play(' + v.id + ')"';
        var hover = isImage ? '' : ' onmouseenter="previewHotTagVideo(this)" onmouseleave="stopHotTagVideo(this)"';
        var likedCls = v.liked ? ' liked' : '';
        var badge = isImage ? '<span class="card-badge card-badge-img hot-tag-badge">图片</span>' : '';
        return '<div class="hot-tag-video-card" title="' + title + '">' +
            '<div class="hot-tag-video-thumb-wrap" ' + click + hover + '>' +
                thumb + preview + badge +
            '</div>' +
            '<div class="hot-tag-video-info">' +
                '<div class="hot-tag-video-title" onclick="window._openDetail(' + v.id + ')" style="cursor:pointer">' + title + '</div>' +
                '<div class="hot-tag-video-meta">' +
                    '<span>' + fmtSize(v.fileSize) + '</span>' +
                    '<div class="hot-tag-video-stats">' +
                        '<span class="hot-tag-video-views"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' + (v.viewCount || 0) + '</span>' +
                        '<button class="hot-tag-video-like' + likedCls + '" onclick="event.stopPropagation();window._like(' + v.id + ',this)">' +
                            '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
                            '<span>' + (v.likeCount || 0) + '</span>' +
                        '</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    function previewHotTagVideo(wrap) {
        var video = wrap.querySelector('.hot-tag-video-preview');
        if (!video) return;
        if (!video.src && video.dataset.src) video.src = video.dataset.src;
        if (video.readyState >= 2) {
            video.play().catch(function () {});
        } else {
            video.addEventListener('loadeddata', function handler() { video.play().catch(function () {}); video.removeEventListener('loadeddata', handler); });
        }
    }

    function stopHotTagVideo(wrap) {
        var video = wrap.querySelector('.hot-tag-video-preview');
        if (!video) return;
        video.pause();
        video.currentTime = 0;
    }

    function goHotTagVideoPage(btn, tagName, page) {
        var container = btn.closest('.hot-tag-videos');
        if (!container) return;
        container.dataset.page = page;
        container.dataset.loaded = '';
        loadHotTagVideos(tagName, container);
    }

    function filterHotTags() {
        var keyword = (document.getElementById('hotTagsSearch').value || '').toLowerCase().trim();
        if (!keyword) {
            _hotTagsFiltered = _hotTagsData;
        } else {
            _hotTagsFiltered = _hotTagsData.filter(function (t) { return t.name.toLowerCase().indexOf(keyword) >= 0; });
        }
        _hotTagPage = 1;
        renderHotTagsPage();
    }

    function clearHotTagsSearch() {
        document.getElementById('hotTagsSearch').value = '';
        document.getElementById('hotTagsSearchClear').style.visibility = 'hidden';
        _hotTagsFiltered = _hotTagsData;
        _hotTagPage = 1;
        renderHotTagsPage();
    }

    function toggleHotTagsClear(input) {
        document.getElementById('hotTagsSearchClear').style.visibility = input.value ? 'visible' : 'hidden';
    }

    // === Search Dropdown ===
    var _recentSearches = JSON.parse(localStorage.getItem('recentSearches') || '[]');
    var _searchDropdownTarget = null;

    function saveRecentSearch(keyword) {
        if (!keyword) return;
        _recentSearches = _recentSearches.filter(function (k) { return k !== keyword; });
        _recentSearches.unshift(keyword);
        if (_recentSearches.length > 5) _recentSearches = _recentSearches.slice(0, 5);
        localStorage.setItem('recentSearches', JSON.stringify(_recentSearches));
    }

    function showSearchDropdown(input) {
        _searchDropdownTarget = input;
        var dropdownId = getDropdownId(input);
        var dropdown = document.getElementById(dropdownId);
        if (!dropdown) return;
        renderSearchDropdown(dropdown, '');
        dropdown.classList.add('show');
    }

    function hideSearchDropdown() {
        document.querySelectorAll('.search-dropdown').forEach(function (el) {
            el.classList.remove('show');
        });
        _searchDropdownTarget = null;
    }

    function getDropdownId(input) {
        if (input.id === 'searchInput') return 'searchDropdownMain';
        if (input.id === 'searchInputRight') return 'searchDropdownRight';
        if (input.id === 'detailSearchInput') return 'searchDropdownDetail';
        if (input.id === 'tagMgrSearch') return 'searchDropdownTagMgr';
        if (input.id === 'pendingSearch') return 'searchDropdownPending';
        if (input.id === 'hotTagsSearch') return 'searchDropdownHotTags';
        return 'searchDropdownMain';
    }

    function onSearchInput(input) {
        _searchDropdownTarget = input;
        var dropdownId = getDropdownId(input);
        var dropdown = document.getElementById(dropdownId);
        if (!dropdown) return;
        var query = input.value.trim();
        if (query) {
            searchTagsForDropdown(dropdown, query);
        } else {
            renderSearchDropdown(dropdown, '');
        }
        dropdown.classList.add('show');
    }

    function renderSearchDropdown(dropdown, query) {
        var html = '';
        // 最近搜索
        if (_recentSearches.length > 0 && !query) {
            html += '<div class="search-dropdown-section">';
            html += '<div class="search-dropdown-label">最近搜索</div>';
            _recentSearches.forEach(function (keyword) {
                html += '<div class="search-dropdown-item" data-value="' + esc(keyword) + '">' +
                    '<svg class="search-dropdown-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
                    '<span class="search-dropdown-item-text">' + esc(keyword) + '</span>' +
                    '</div>';
            });
            html += '</div>';
        }
        // 热门标签
        html += '<div class="search-dropdown-section">';
        html += '<div class="search-dropdown-label">热门标签</div>';
        html += '<div id="dropdownHotTags"><div class="search-dropdown-empty">加载中...</div></div>';
        html += '</div>';
        dropdown.innerHTML = html;
        // 绑定最近搜索点击
        dropdown.querySelectorAll('.search-dropdown-item[data-value]').forEach(function (el) {
            el.addEventListener('mousedown', function (e) {
                e.preventDefault();
                fillSearch(el.dataset.value);
            });
        });
        // 加载热门标签
        loadHotTagsForDropdown(dropdown, query);
    }

    function searchTagsForDropdown(dropdown, query) {
        var html = '<div class="search-dropdown-section">';
        html += '<div class="search-dropdown-label">搜索标签</div>';
        html += '<div id="dropdownHotTags"><div class="search-dropdown-empty">搜索中...</div></div>';
        html += '</div>';
        dropdown.innerHTML = html;
        loadHotTagsForDropdown(dropdown, query);
    }

    function loadHotTagsForDropdown(dropdown, query) {
        var url = query ? '/api/tags/search?q=' + encodeURIComponent(query) : '/api/tags';
        api('GET', url).then(function (r) {
            var container = dropdown.querySelector('#dropdownHotTags');
            if (!container) return;
            if (r.code !== 200 || !r.data || r.data.length === 0) {
                container.innerHTML = '<div class="search-dropdown-empty">无匹配标签</div>';
                return;
            }
            var tags = r.data.slice(0, 5);
            container.innerHTML = tags.map(function (t) {
                return '<div class="search-dropdown-item" data-tag="' + esc(t.name) + '">' +
                    '<div class="search-dropdown-item-thumb" id="sdThumb-' + esc(t.name).replace(/[^a-zA-Z0-9]/g, '_') + '"><div class="search-dropdown-item-thumb-empty">#</div></div>' +
                    '<span class="search-dropdown-item-text">' + esc(t.name) + '</span>' +
                    '<span class="search-dropdown-item-count">' + t.count + '</span>' +
                    '</div>';
            }).join('');
            // 绑定点击
            container.querySelectorAll('.search-dropdown-item').forEach(function (el) {
                el.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    fillSearch(el.dataset.tag);
                });
            });
            // 异步加载缩略图
            tags.forEach(function (t) { loadSearchDropdownThumb(t.name); });
        });
    }

    function loadSearchDropdownThumb(tagName) {
        var safeId = tagName.replace(/[^a-zA-Z0-9]/g, '_');
        var thumbEl = document.getElementById('sdThumb-' + safeId);
        if (!thumbEl) return;
        api('GET', '/api/tags/' + encodeURIComponent(tagName) + '/meta').then(function (r) {
            if (r.code === 200 && r.data && r.data.coverUrl) {
                thumbEl.innerHTML = '<img src="' + API + r.data.coverUrl + '"/>';
                return;
            }
            api('GET', '/api/tags/' + encodeURIComponent(tagName) + '/videos?pageSize=1').then(function (r2) {
                if (r2.code === 200 && r2.data && r2.data.list && r2.data.list.length > 0) {
                    var v = r2.data.list[0];
                    if (v.thumbUrl) thumbEl.innerHTML = '<img src="' + API + v.thumbUrl + '"/>';
                }
            });
        });
    }

    function fillSearch(value) {
        if (!value) return;
        // 先记录当前目标再隐藏
        var activeId = _searchDropdownTarget ? _searchDropdownTarget.id : '';
        hideSearchDropdown();
        if (activeId === 'tagMgrSearch') {
            document.getElementById('tagMgrSearch').value = value;
            var btn1 = document.getElementById('tagMgrSearchClear');
            if (btn1) btn1.style.visibility = 'visible';
            filterTagMgr();
            return;
        }
        if (activeId === 'pendingSearch') {
            document.getElementById('pendingSearch').value = value;
            var btn2 = document.getElementById('pendingSearchClear');
            if (btn2) btn2.style.visibility = 'visible';
            filterPendingTags();
            return;
        }
        if (activeId === 'hotTagsSearch') {
            document.getElementById('hotTagsSearch').value = value;
            var btn3 = document.getElementById('hotTagsSearchClear');
            if (btn3) btn3.style.visibility = 'visible';
            filterHotTags();
            return;
        }
        // 同步所有主搜索框
        var inputs = ['searchInput', 'searchInputRight', 'detailSearchInput'];
        inputs.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = value;
        });
        // 显示所有清空按钮
        var clearBtns = ['rightSearchClear', 'detailSearchClear'];
        clearBtns.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.style.visibility = 'visible';
        });
        saveRecentSearch(value);
        doSearch();
    }

    // 弹窗点赞和详情
    function updateModalLikeBtn(id, btnId) {
        api('GET', '/api/videos/' + id).then(function (r) {
            if (r.code === 200 && r.data) {
                setModalLikeState(btnId, !!r.data.liked);
            }
        });
    }

    function setModalLikeState(btnId, isLiked) {
        var btn = document.getElementById(btnId);
        if (btn) {
            btn.classList.toggle('liked', isLiked);
            var svg = btn.querySelector('svg');
            if (svg) svg.setAttribute('fill', isLiked ? 'currentColor' : 'none');
        }
    }

    function modalLike() {
        if (!_modalCurrentId) return;
        api('POST', '/api/videos/' + _modalCurrentId + '/like').then(function (r) {
            if (r.code === 200) {
                toast(r.data);
                var isLiked = r.data === '已点赞';
                // 更新弹窗内的点赞按钮
                setModalLikeState('vpLikeBtn', isLiked);
                setModalLikeState('modalImageLikeBtn', isLiked);
                // 更新卡片上的点赞按钮
                var cards = document.querySelectorAll('[data-video-id="' + _modalCurrentId + '"]');
                cards.forEach(function (card) {
                    var likeBtn = card.querySelector('.card-like');
                    if (likeBtn) {
                        likeBtn.classList.toggle('liked', isLiked);
                        var svg = likeBtn.querySelector('svg');
                        if (svg) svg.setAttribute('fill', isLiked ? 'currentColor' : 'none');
                    }
                });
            }
        });
    }

    function modalDetail() {
        if (!_modalCurrentId) return;
        var id = _modalCurrentId;
        // 关闭弹窗
        closeModal();
        closeImageModal();
        // 打开详情
        openDetail(id);
    }

    // === Expose ===
    window._play = playVideo;
    window._showImage = showImage;
    window._like = toggleLike;
    window._searchTag = searchTag;
    window._filter = filter;
    window._hoverPlay = hoverPlay;
    window._hoverStop = hoverStop;
    window._feedPip = feedPip;
    window._feedFullscreen = feedFullscreen;
    window._feedToggleMute = feedToggleMute;
    window._feedTogglePlay = feedTogglePlay;
    window._feedCycleRate = feedCycleRate;
    window._openDetail = openDetail;
    window._closeDetail = closeDetail;
    window._openGalleryViewer = openGalleryViewer;
    window._closeGalleryViewer = closeGalleryViewer;
    window._galleryViewerPrev = galleryViewerPrev;
    window._galleryViewerNext = galleryViewerNext;
    window._modalLike = modalLike;
    window._modalDetail = modalDetail;
    window._modalPrevVideo = modalPrevVideo;
    window._modalNextVideo = modalNextVideo;
    window._modalLocateVideo = modalLocateVideo;
    window._galleryViewerLike = galleryViewerLike;
    window._galleryViewerDetail = galleryViewerDetail;
    window._galleryViewerLocate = galleryViewerLocate;
    window._galleryViewerToggleSlideshow = galleryViewerToggleSlideshow;
    window._galleryViewerSetInterval = galleryViewerSetInterval;
    window._galleryViewerSetTransition = galleryViewerSetTransition;
    window._showSlideshowSettings = showSlideshowSettings;
    window._hideSlideshowSettings = hideSlideshowSettings;
    window.toggleGalleryModeMenu = toggleGalleryModeMenu;

    // 轮播页码选择弹窗（全局函数）
    window._carouselPagePopup = function(e) {
        e.stopPropagation();
        var displayItems = _carouselLoopMode === 'single' ? _carouselPageItems : _carouselAllItems;
        var totalPages = Math.ceil(displayItems.length / 20);
        if (totalPages <= 1) return;

        var existing = document.getElementById('carouselPagePopup');
        if (existing) { existing.remove(); return; }

        var popup = document.createElement('div');
        popup.className = 'carousel-page-popup';
        popup.id = 'carouselPagePopup';
        var html = '<div class="carousel-page-title">跳转到</div><div class="carousel-page-list">';
        for (var p = 1; p <= totalPages; p++) {
            var start = (p - 1) * 20 + 1;
            var end = Math.min(p * 20, displayItems.length);
            var isCurrent = _carouselGlobalIndex >= (p - 1) * 20 && _carouselGlobalIndex < p * 20;
            html += '<div class="carousel-page-item' + (isCurrent ? ' active' : '') + '" onclick="window._carouselJumpPage(' + p + ')">' + start + '-' + end + '</div>';
        }
        html += '</div>';
        popup.innerHTML = html;

        var timeEl = document.getElementById('carouselTime');
        var rect = timeEl.getBoundingClientRect();
        popup.style.position = 'fixed';
        popup.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
        popup.style.left = (rect.left + rect.width / 2 - 50) + 'px';
        document.body.appendChild(popup);

        setTimeout(function() {
            document.addEventListener('click', function close(ev) {
                if (!popup.contains(ev.target)) {
                    popup.remove();
                    document.removeEventListener('click', close);
                }
            });
        }, 50);
    };

    window._carouselJumpPage = function(page) {
        var idx = (page - 1) * 20;
        _carouselGlobalIndex = idx;
        var popup = document.getElementById('carouselPagePopup');
        if (popup) popup.remove();
        // 触发activateCard
        var viewport = document.getElementById('carouselViewport');
        var track = document.getElementById('carouselTrack');
        if (track && viewport) {
            var card = track.querySelector('.carousel-card[data-idx="' + idx + '"]');
            if (card) {
                // 暂停旧视频
                var oldActive = track.querySelector('.carousel-card.active');
                if (oldActive) {
                    oldActive.classList.remove('active');
                    var oldVid = oldActive.querySelector('video');
                    if (oldVid && !oldVid.paused) oldVid.pause();
                }
                card.classList.add('active');
                var cardLeft = card.offsetLeft;
                var cardW = card.offsetWidth;
                var viewW = viewport.offsetWidth;
                viewport.scrollTo({ left: cardLeft - viewW / 2 + cardW / 2, behavior: 'smooth' });
                // 播放视频
                if (card.dataset.type === 'video') {
                    var vid = card.querySelector('video');
                    if (vid) vid.play().catch(function(){});
                }
                // 更新进度条
                var fill = document.getElementById('carouselFill');
                var timeEl2 = document.getElementById('carouselTime');
                if (fill && timeEl2) {
                    var pct = displayItems.length > 1 ? (idx / (displayItems.length - 1)) * 100 : 0;
                    fill.style.width = Math.min(100, pct) + '%';
                    timeEl2.textContent = (idx + 1) + ' / ' + displayItems.length;
                }
            }
        }
        // 保存位置
        localStorage.setItem(userKey('carouselIndex'), idx);
    };

    // 轮播页码选择弹窗（点击页码信息触发）
    window._carouselPageSelect = function(e) {
        e.stopPropagation();
        var existing = document.getElementById('carouselPagePopup');
        if (existing) { existing.remove(); return; }

        var popup = document.createElement('div');
        popup.className = 'carousel-page-popup';
        popup.id = 'carouselPagePopup';
        popup.style.maxHeight = '400px';
        popup.style.overflowY = 'auto';
        var html = '<div class="carousel-page-title">跳转到页码</div><div class="carousel-page-list">';
        var total = state.totalPages || 1;
        var current = state.page || 1;
        // 显示所有页码
        for (var p = 1; p <= total; p++) {
            html += '<div class="carousel-page-item' + (p === current ? ' active' : '') + '" onclick="window._carouselGoPage(' + p + ')">第' + p + '页</div>';
        }
        html += '</div>';
        popup.innerHTML = html;

        var pageInfo = document.getElementById('carouselPageInfo');
        var rect = pageInfo.getBoundingClientRect();
        popup.style.position = 'fixed';
        popup.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
        popup.style.left = (rect.left + rect.width / 2 - 60) + 'px';
        document.body.appendChild(popup);

        setTimeout(function() {
            document.addEventListener('click', function close(ev) {
                if (!popup.contains(ev.target)) {
                    popup.remove();
                    document.removeEventListener('click', close);
                }
            });
        }, 50);
    };

    // 跳转到指定页码
    window._carouselGoPage = function(page) {
        var popup = document.getElementById('carouselPagePopup');
        if (popup) popup.remove();

        if (page < 1 || page > state.totalPages) return;

        if (_carouselLoopMode === 'page') {
            // 全部循环模式：加载目标页并跳转
            loadCarouselPageAndGo(page);
        } else {
            // 单页模式：需要重新加载数据
            state.page = page;
            localStorage.setItem(userKey('carouselPage'), page);
            localStorage.setItem(userKey('carouselIndex'), 0);
            if (state.currentView === 'likes') loadLikedVideos();
            else loadVideos();
        }
    };

    // 全部循环模式：加载指定页并跳转
    function loadCarouselPageAndGo(targetPage) {
        // 计算目标页在_allItems中的起始位置
        var targetStartIdx = (targetPage - 1) * 20;

        // 检查是否需要加载新页面
        var currentLoadedCount = _carouselAllItems.length;
        var neededCount = targetStartIdx + 20; // 目标页的最后一条索引+1

        if (currentLoadedCount >= neededCount) {
            // 目标页已加载，直接跳转
            state.page = targetPage;
            _carouselGlobalIndex = targetStartIdx;
            goToCard(_carouselGlobalIndex);
            return;
        }

        // 需要加载更多页
        var fromPage = Math.ceil(currentLoadedCount / 20) + 1;
        var toPage = targetPage;

        // 逐页加载
        function loadNext(pageNum) {
            if (pageNum > toPage) {
                // 加载完成，跳转
                state.page = targetPage;
                _carouselGlobalIndex = Math.min(targetStartIdx, _carouselAllItems.length - 1);
                // 追加新卡片到DOM
                var track = document.getElementById('carouselTrack');
                if (track) {
                    var existingCount = track.querySelectorAll('.carousel-card').length;
                    for (var i = existingCount; i < _carouselAllItems.length; i++) {
                        appendCardToDOMSimple(_carouselAllItems[i], i);
                    }
                }
                goToCard(_carouselGlobalIndex);
                return;
            }

            var params = new URLSearchParams({ page: pageNum, pageSize: 20 });
            if (state.keyword) params.set('keyword', state.keyword);
            if (state.type) params.set('type', state.type);
            if (state.category) params.set('category', state.category);
            var url = state.currentView === 'likes' ? '/api/likes' : '/api/videos';

            api('GET', url + '?' + params).then(function (r) {
                if (r.code === 200 && r.data) {
                    state.totalPages = r.data.totalPages;
                    var newItems = r.data.list || [];
                    var existingIds = new Set(_carouselAllItems.map(function(v) { return v.id; }));
                    newItems.forEach(function (v) {
                        if (!existingIds.has(v.id)) _carouselAllItems.push(v);
                    });
                }
                loadNext(pageNum + 1);
            }).catch(function () {
                loadNext(pageNum + 1);
            });
        }

        loadNext(fromPage);
    }

    // 辅助函数：跳转到指定卡片
    function goToCard(idx) {
        var track = document.getElementById('carouselTrack');
        var viewport = document.getElementById('carouselViewport');
        if (track && viewport) {
            var card = track.querySelector('.carousel-card[data-idx="' + idx + '"]');
            if (card) {
                var oldActive = track.querySelector('.carousel-card.active');
                if (oldActive) oldActive.classList.remove('active');
                card.classList.add('active');
                viewport.scrollTo({ left: card.offsetLeft - viewport.offsetWidth / 2 + card.offsetWidth / 2, behavior: 'smooth' });
            }
        }
        var displayItems = _carouselLoopMode === 'single' ? _carouselPageItems : _carouselAllItems;
        var timeEl = document.getElementById('carouselTime');
        var fill = document.getElementById('carouselFill');
        var pageInfoEl = document.getElementById('carouselPageInfo');
        if (timeEl) timeEl.textContent = (idx + 1) + ' / ' + displayItems.length;
        if (fill) {
            var pct = displayItems.length > 1 ? (idx / (displayItems.length - 1)) * 100 : 0;
            fill.style.width = Math.min(100, pct) + '%';
        }
        if (pageInfoEl) {
            var currentPg = _carouselLoopMode === 'page' ? Math.floor(idx / 20) + 1 : state.page;
            pageInfoEl.textContent = '第' + currentPg + ' / ' + state.totalPages + ' 页 (共' + displayItems.length + ' 条)';
            // 更新上一页/下一页按钮状态
            var prevPageBtn = document.getElementById('carouselPrevPage');
            var nextPageBtn = document.getElementById('carouselNextPage');
            if (prevPageBtn) {
                prevPageBtn.disabled = currentPg <= 1;
                prevPageBtn.classList.toggle('disabled', currentPg <= 1);
            }
            if (nextPageBtn) {
                nextPageBtn.disabled = currentPg >= state.totalPages;
                nextPageBtn.classList.toggle('disabled', currentPg >= state.totalPages);
            }
        }
        localStorage.setItem(userKey('carouselIndex'), idx);
        localStorage.setItem(userKey('carouselPage'), state.page);
    }

    window._showDeleteDialog = showDeleteDialog;
    window._showRenameDialog = showRenameDialog;
    window._showRefreshThumbDialog = showRefreshThumbDialog;
    window.previewRefreshThumb = previewRefreshThumb;
    window.toggleFeedDefaultMute = toggleFeedDefaultMute;
    window.toggleDetailPlay = toggleDetailPlay;
    window.toggleDetailMute = toggleDetailMute;
    window.toggleDetailPip = toggleDetailPip;
    window.cyclePlaybackRate = cyclePlaybackRate;
    window.toggleDanmaku = toggleDanmaku;
    window.sendDanmaku = sendDanmaku;
    window.toggleDetailDanmaku = toggleDetailDanmaku;
    window.sendDetailDanmaku = sendDetailDanmaku;
    window._sendFeedDanmaku = sendFeedDanmaku;
    window._toggleFeedDanmaku = toggleFeedDanmaku;
    window._getPage = function () { return state.page; };
    window._getTotal = function () { return state.totalPages; };
    window.doLogin = doLogin;
    window.doLogout = doLogout;
    window.doSearch = doSearch;
    window.showSearchDropdown = showSearchDropdown;
    window.hideSearchDropdown = hideSearchDropdown;
    window.onSearchInput = onSearchInput;
    window.clearSearch = clearSearch;
    window.toggleRightSearchClear = toggleRightSearchClear;
    window.clearRightSearch = clearRightSearch;
    window.toggleDetailSearchClear = toggleDetailSearchClear;
    window.clearDetailSearch = clearDetailSearch;
    window.toggleTagSearchClear = toggleTagSearchClear;
    window.clearTagMgrSearch = clearTagMgrSearch;
    window.clearPendingSearch = clearPendingSearch;
    window.goPage = goPage;
    window.switchView = switchView;
    window.filterHotTags = filterHotTags;
    window.clearHotTagsSearch = clearHotTagsSearch;
    window.toggleHotTagsClear = toggleHotTagsClear;
    window.toggleHotTagExpand = toggleHotTagExpand;
    window.goHotTagPage = goHotTagPage;
    window.goHotTagVideoPage = goHotTagVideoPage;
    window.previewHotTagVideo = previewHotTagVideo;
    window.stopHotTagVideo = stopHotTagVideo;
    window.switchMode = switchMode;
    window.toggleFolderPanel = toggleFolderPanel;
    window.showTagManager = showTagManager;
    window.filterTagMgr = filterTagMgr;
    window.goTagMgrPage = goTagMgrPage;
    window.toggleTagMgrExpand = toggleTagMgrExpand;
    window.goTagMgrVideoPage = goTagMgrVideoPage;
    window.startMgrRenameTag = startMgrRenameTag;
    window.removeVideoFromTag = removeVideoFromTag;
    window.openAddVideoToTag = openAddVideoToTag;
    window.addVideoToTag = addVideoToTag;
    window.editTagDescription = editTagDescription;
    window.openCoverPicker = openCoverPicker;
    window.setTagCover = setTagCover;
    window.deleteTag = deleteTag;
    window.mergeTag = mergeTag;
    window.showPendingTags = showPendingTags;
    window.toggleTagExpand = toggleTagExpand;
    window.goFolderPage = goFolderPage;
    window.confirmAllTag = confirmAllTag;
    window.rejectAllTag = rejectAllTag;
    window.rejectAllTags = rejectAllTags;
    window.filterPendingTags = filterPendingTags;
    window.goPendingPage = goPendingPage;
    window.rejectVideoTag = rejectVideoTag;
    window.previewPendingVideo = previewPendingVideo;
    window.stopPendingVideo = stopPendingVideo;
    window.openDirBrowser = openDirBrowser;
    window.closeDirBrowser = closeDirBrowser;
    window.browseTo = browseTo;
    window.browseParent = browseParent;
    window.selectDir = selectDir;
    window.addFolder = addFolder;
    window._scanFolder = scanFolder;
    window.scanAllFolders = scanAllFolders;
    window._deleteFolder = deleteFolder;
    window._toggleFolderScanOption = toggleFolderScanOption;
    window.openPendingVideoPopup = openPendingVideoPopup;
    window.closePendingVideoPopup = closePendingVideoPopup;
    window.startRenameTag = startRenameTag;
    window.closeModal = closeModal;
    window.closeDetail = closeDetail;
    window.closeImageModal = closeImageModal;
    window.togglePip = togglePip;
    window.toggleFs = toggleFs;
    window.submitDetailComment = submitDetailComment;
    window._toggleTagDropdown = toggleTagDropdown;
    window._searchTags = searchTags;
    window._selectTag = selectTag;
    window._addTagFromInput = addTagFromInput;
    window._removeTag = removeTag;
    window._toggleDetailTagDropdown = toggleDetailTagDropdown;
    window._searchDetailTags = searchDetailTags;
    window._addDetailTagFromInput = addDetailTagFromInput;

    // === Keyboard Controls ===
    var rateIndicator = null;
    var rateIndicatorTimer = null;

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closeModal(); closeImageModal(); closeDetail(); closePendingVideoPopup(); closeCategoryModal(); }
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        // 详情页视频控制
        var detailView = document.getElementById('detailView');
        var isDetail = detailView && detailView.style.display !== 'none';
        if (isDetail) {
            var vid = document.getElementById('detailVideo');
            if (!vid) return;

            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    toggleDetailPlay();
                    showCenterIcon(vid);
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    vid.currentTime = Math.max(0, vid.currentTime - 5);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    vid.currentTime = Math.min(vid.duration, vid.currentTime + 5);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    changePlaybackRate(vid, 0.25);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    changePlaybackRate(vid, -0.25);
                    break;
            }
            return;
        }

        // 列表页翻页（画廊查看器打开时不触发）
        var galleryViewer = document.getElementById('galleryViewer');
        if (!galleryViewer) {
            if (e.key === 'ArrowLeft') goPage(state.page - 1);
            if (e.key === 'ArrowRight') goPage(state.page + 1);
        }
    });

    // 显示中间播放/暂停图标
    function showCenterIcon(vid) {
        var wrap = document.querySelector('.detail-video-wrap');
        if (!wrap) return;
        var icon = document.createElement('div');
        icon.className = 'center-icon-flash';
        icon.innerHTML = vid.paused ?
            '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>' :
            '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
        wrap.appendChild(icon);
        setTimeout(function () {
            icon.classList.add('fade-out');
            setTimeout(function () { if (icon.parentNode) icon.parentNode.removeChild(icon); }, 300);
        }, 400);
    }

    // 修改播放倍率
    function changePlaybackRate(vid, delta) {
        var rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];
        var current = vid.playbackRate;
        var idx = rates.indexOf(current);
        if (idx === -1) idx = rates.indexOf(1);
        var newIdx = Math.max(0, Math.min(rates.length - 1, idx + (delta > 0 ? 1 : -1)));
        vid.playbackRate = rates[newIdx];
        updateRateDisplay(rates[newIdx]);
        showRateIndicator(rates[newIdx]);
    }

    // 显示倍率指示器
    function showRateIndicator(rate) {
        if (!rateIndicator) {
            rateIndicator = document.createElement('div');
            rateIndicator.className = 'rate-indicator';
            document.querySelector('.detail-video-wrap').appendChild(rateIndicator);
        }
        rateIndicator.textContent = rate === 1 ? '1x' : rate + 'x';
        rateIndicator.classList.add('visible');
        if (rateIndicatorTimer) clearTimeout(rateIndicatorTimer);
        rateIndicatorTimer = setTimeout(function () {
            rateIndicator.classList.remove('visible');
        }, 3000);
    }

    // === Init ===
    if (state.token) {
        var savedVideoId = localStorage.getItem(userKey('detailVideoId'));
        if (savedVideoId) {
            // 先验证视频是否存在，再决定是否恢复详情页
            api('GET', '/api/videos/' + savedVideoId).then(function (r) {
                if (r.code === 200) {
                    showMain();
                    openDetail(parseInt(savedVideoId));
                } else {
                    // 视频已不存在，清除并回到首页
                    localStorage.removeItem(userKey('detailVideoId'));
                    showMain();
                }
            }).catch(function () {
                localStorage.removeItem(userKey('detailVideoId'));
                showMain();
            });
        } else {
            showMain();
        }
    }
})();
