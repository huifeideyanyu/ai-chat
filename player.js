/* 腌鱼 · 悬浮音乐播放器 */
(function () {
  var tracks = [
    { song: 'Supernatural', artist: 'NewJeans', src: 'assets/music/01-supernatural.mp3', cover: 'assets/covers/01-newjeans-flower.jpg' },
    { song: '丸ノ内サディスティック', artist: '椎名林檎', src: 'assets/music/02-marunouchi.mp3', cover: 'assets/covers/05-shiina-ringoku.jpg' },
    { song: '寂寞的恋人啊', artist: '莫文蔚', src: 'assets/music/03-lonely-lover.mp3', cover: 'assets/covers/24-karenmok-12floor.jpg' },
    { song: '映画と雨降りの朝', artist: 'GO!GO!7188', src: 'assets/music/04-rainy-morning.mp3', cover: 'assets/covers/02-alley-light.jpg' },
    { song: 'Levitating', artist: 'Dua Lipa', src: 'assets/music/05-levitating.mp3', cover: 'assets/covers/15-bubble-city.jpg' },
    { song: 'Stairway to Heaven', artist: 'Led Zeppelin', src: 'assets/music/06-stairway.mp3', cover: 'assets/covers/14-pinkfloyd.jpg' }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var panel = $('musicPlayer'), fab = $('mpFab');
  var audio = $('mpAudio');
  var cover = $('mpCover'), coverBox = cover.parentNode;
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
    cover.src = t.cover;
    fill.style.width = '0%';
    curEl.textContent = '0:00';
    durEl.textContent = '0:00';
    audio.load();
    if (autoplay) {
      var p = audio.play();
      if (p && p.catch) p.catch(function () { /* 浏览器可能拦截自动播放 */ });
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
    coverBox.classList.toggle('spin', !audio.paused);
  }

  // 事件
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

  // 折叠 / 展开
  function setCollapsed(c) {
    panel.classList.toggle('collapsed', c);
    fab.classList.toggle('show', c);
  }
  $('mpCollapse').addEventListener('click', function () { setCollapsed(true); });
  fab.addEventListener('click', function () { setCollapsed(false); });

  load(0, false);
})();
