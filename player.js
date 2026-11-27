/* 腌鱼 · 悬浮音乐播放器（可拖动 / 可收起） */
(function () {
  var tracks = [
    { song: 'Supernatural', artist: 'NewJeans', src: 'assets/music/01-supernatural.mp3' },
    { song: '丸ノ内サディスティック', artist: '椎名林檎', src: 'assets/music/02-marunouchi.mp3' },
    { song: '寂寞的恋人啊', artist: '莫文蔚', src: 'assets/music/03-lonely-lover.mp3' },
    { song: '映画と雨降りの朝', artist: 'GO!GO!7188', src: 'assets/music/04-rainy-morning.mp3' },
    { song: 'Levitating', artist: 'Dua Lipa', src: 'assets/music/05-levitating.mp3' },
    { song: 'Stairway to Heaven', artist: 'Led Zeppelin', src: 'assets/music/06-stairway.mp3' }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var panel = $('musicPlayer'), fab = $('mpFab');
  var dragbar = $('mpDragbar');
  var audio = $('mpAudio');
  var songEl = $('mpSong'), artistEl = $('mpArtist');
  var playBtn = $('mpPlay'), prevBtn = $('mpPrev'), nextBtn = $('mpNext');
  var progress = $('mpProgress'), fill = $('mpProgressFill');
  var curEl = $('mpCur'), durEl = $('mpDur');
  var idx = 0, dragging = false;

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  function load(i, autoplay) {
    idx = (i + tracks.length) % tracks.length;
    var t = tracks[idx];
    audio.src = t.src;
    songEl.textContent = t.song;
    artistEl.textContent = t.artist;
    fill.style.width = '0%';
    curEl.textContent = '0:00';
    durEl.textContent = '0:00';
    audio.load();
    if (autoplay) {
      var p = audio.play();
      if (p && p.catch) p.catch(function () {});
    }
  }

  function toggle() {
    if (audio.paused) {
      var p = audio.play();
      if (p && p.catch) p.catch(function () {});
    } else {
      audio.pause();
    }
  }

  function updatePlayState() {
    playBtn.textContent = audio.paused ? '▶' : '❚❚';
  }

  // 播放控制事件
  playBtn.addEventListener('click', toggle);
  prevBtn.addEventListener('click', function () { load(idx - 1, !audio.paused); });
  nextBtn.addEventListener('click', function () { load(idx + 1, !audio.paused); });
  audio.addEventListener('play', updatePlayState);
  audio.addEventListener('pause', updatePlayState);
  audio.addEventListener('ended', function () { load(idx + 1, true); });
  audio.addEventListener('loadedmetadata', function () { durEl.textContent = fmt(audio.duration); });
  audio.addEventListener('timeupdate', function () {
    if (dragging) return;
    curEl.textContent = fmt(audio.currentTime);
    if (audio.duration) fill.style.width = (audio.currentTime / audio.duration * 100) + '%';
  });

  // 进度条拖动 / 点击跳转
  function seek(e) {
    if (!audio.duration) return;
    var rect = progress.getBoundingClientRect();
    var x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    var ratio = Math.max(0, Math.min(1, x / rect.width));
    audio.currentTime = ratio * audio.duration;
    fill.style.width = (ratio * 100) + '%';
    curEl.textContent = fmt(audio.currentTime);
  }
  progress.addEventListener('mousedown', function (e) { dragging = true; seek(e); });
  document.addEventListener('mousemove', function (e) { if (dragging) seek(e); });
  document.addEventListener('mouseup', function () { dragging = false; });
  progress.addEventListener('touchstart', function (e) { dragging = true; seek(e); }, { passive: true });
  document.addEventListener('touchmove', function (e) { if (dragging) seek(e); }, { passive: true });
  document.addEventListener('touchend', function () { dragging = false; });

  // 折叠 / 展开（位置计时器独立）
  function setCollapsed(c) {
    panel.classList.toggle('collapsed', c);
    fab.classList.toggle('show', c);
  }
  $('mpCollapse').addEventListener('click', function () { setCollapsed(true); });
  fab.addEventListener('click', function () { setCollapsed(false); });

  // ---------- 拖动面板 ----------
  var pos = { left: null, top: null };   // null 表示用 CSS 默认 right/bottom
  var drag = null;

  function currentRect() {
    var r = panel.getBoundingClientRect();
    return { left: r.left, top: r.top };
  }
  function applyPos(left, top) {
    pos.left = left; pos.top = top;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }
  // 记住展开按钮位置，收起时把 fab 也移过去
  function moveFabToPanel() {
    var r = panel.getBoundingClientRect();
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
    fab.style.left = Math.max(8, r.left + r.width - 46) + 'px';
    fab.style.top = Math.max(8, r.top + r.height - 46) + 'px';
  }

  dragbar.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.mp-collapse')) return;
    var r = currentRect();
    drag = { startX: e.clientX, startY: e.clientY, left: r.left, top: r.top };
    panel.classList.add('dragging');
    dragbar.setPointerCapture(e.pointerId);
  });
  dragbar.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    var maxLeft = window.innerWidth - panel.offsetWidth - 6;
    var maxTop = window.innerHeight - panel.offsetHeight - 6;
    var l = Math.max(6, Math.min(maxLeft, drag.left + dx));
    var t = Math.max(6, Math.min(maxTop, drag.top + dy));
    applyPos(l, t);
  });
  function endDrag() {
    if (!drag) return;
    drag = null;
    panel.classList.remove('dragging');
    moveFabToPanel();
  }
  dragbar.addEventListener('pointerup', endDrag);
  dragbar.addEventListener('pointercancel', endDrag);

  // 窗口缩放时把面板拉回可视区
  window.addEventListener('resize', function () {
    if (pos.left === null) return;
    var maxLeft = window.innerWidth - panel.offsetWidth - 6;
    var maxTop = window.innerHeight - panel.offsetHeight - 6;
    applyPos(Math.max(6, Math.min(maxLeft, pos.left)), Math.max(6, Math.min(maxTop, pos.top)));
    moveFabToPanel();
  });

  load(0, false);
})();
