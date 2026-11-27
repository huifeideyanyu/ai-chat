/* 小聊 · 本地 AI 聊天助手 */
(function () {
  'use strict';

  var STORE_KEY = 'xiaoliao_chat_v1';

  var PRESETS = {
    openai:   { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    moonshot: { baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.6' },
    ollama:   { baseUrl: 'http://localhost:11434/v1', model: 'llama3' }
  };

  var defaultState = function () {
    return {
      settings: {
        baseUrl: 'https://api.moonshot.cn/v1',
        apiKey: 'sk-ms-9YcBHV2QIakIBippyCn5qpMImscVmiMk9juXl9fOIg7EjRDQ5s0UM8MT',
        model: 'kimi-k2.6',
        system: '你是一个友好、简洁、有帮助的 AI 助手，使用中文回答。',
        temperature: 1,
        maxTokens: 8192
      },
      chats: [],
      activeId: null,
      theme: 'light'
    };
  };

  var state = loadState();
  var generating = false;
  var abortController = null;
  // 只有明确的本地运行环境（localhost/127.0.0.1）才尝试代理；
  // 线上静态托管（包括套了 CDN 反代的域名）一律走浏览器直连，避免相对路径被 CDN 劫持成 405/502。
  var isLocal = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
  var proxyAvailable = false;

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    sidebar: $('sidebar'), sidebarMask: $('sidebarMask'), collapseBtn: $('collapseBtn'), menuBtn: $('menuBtn'),
    newChatBtn: $('newChatBtn'), chatList: $('chatList'), settingsBtn: $('settingsBtn'),
    chatTitle: $('chatTitle'), modelBadge: $('modelBadge'), themeBtn: $('themeBtn'),
    messages: $('messages'), welcome: $('welcome'), userInput: $('userInput'),
    sendBtn: $('sendBtn'), stopBtn: $('stopBtn'),
    settingsModal: $('settingsModal'), closeSettingsBtn: $('closeSettingsBtn'),
    cancelSettingsBtn: $('cancelSettingsBtn'), saveSettingsBtn: $('saveSettingsBtn'),
    cfgBaseUrl: $('cfgBaseUrl'), cfgApiKey: $('cfgApiKey'), cfgModel: $('cfgModel'),
    cfgSystem: $('cfgSystem'), cfgTemperature: $('cfgTemperature'), cfgMaxTokens: $('cfgMaxTokens'),
    toggleKeyBtn: $('toggleKeyBtn'), testBtn: $('testBtn'), testResult: $('testResult')
  };

  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      var s = JSON.parse(raw);
      var d = defaultState();
      s.settings = Object.assign(d.settings, s.settings || {});
      s.chats = s.chats || [];
      s.theme = s.theme || 'light';
      return s;
    } catch (e) {
      return defaultState();
    }
  }

  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function activeChat() {
    for (var i = 0; i < state.chats.length; i++) {
      if (state.chats[i].id === state.activeId) return state.chats[i];
    }
    return null;
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- 轻量 Markdown 渲染 ---------- */
  function markdown(text) {
    if (!text) return '';
    var blocks = [];
    var out = String(text).replace(/```(\w*)\n?([\s\S]*?)```/g, function (m, lang, code) {
      var i = blocks.length;
      var label = escapeHtml(lang || 'code');
      blocks.push('<pre class="code-block"><div class="code-header"><span>' + label +
        '</span><button class="copy-code-btn" data-code="' + encodeURIComponent(code) + '">复制</button></div><code>' +
        escapeHtml(code.replace(/\n$/, '')) + '</code></pre>');
      return '\u0000B' + i + '\u0000';
    });
    out = escapeHtml(out);
    out = out.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
    out = out.replace(/^(#{1,3})\s+(.+)$/gm, function (m, h, t) { return '<h' + h.length + '>' + t + '</h' + h.length + '>'; });
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    out = out.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');
    out = out.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    out = out.replace(/^\s*\d+\.\s+(.+)$/gm, '<li>$1</li>');
    out = out.replace(/(?:<li>[\s\S]*?<\/li>\n?)+/g, function (m) { return '<ul>' + m + '</ul>'; });
    out = out.replace(/^---+$/gm, '<hr>');
    out = out.replace(/\n/g, '<br>');
    out = out.replace(/<\/(h[1-6]|ul|blockquote|pre)>\s*<br>/g, '</$1>');
    out = out.replace(/<br>\s*<(h[1-6]|ul|blockquote|pre)>/g, '<$1>');
    out = out.replace(/\u0000B(\d+)\u0000/g, function (m, i) { return blocks[+i]; });
    return out;
  }

  /* ---------- 渲染 ---------- */
  function renderAll() {
    renderChatList();
    renderHeader();
    renderMessages();
  }

  function renderHeader() {
    var chat = activeChat();
    els.chatTitle.textContent = chat ? chat.title : '新的对话';
    var s = state.settings;
    var hasApi = !!(s.apiKey && s.baseUrl && s.model);
    els.modelBadge.textContent = hasApi ? s.model : '未配置 API · 点击左下角设置';
    els.userInput.placeholder = hasApi ? '输入消息… （Enter 发送，Shift + Enter 换行）' : '请先在「设置 / API」中填写 API Key';
  }

  function renderChatList() {
    els.chatList.innerHTML = '';
    if (!state.chats.length) {
      var empty = document.createElement('div');
      empty.style.cssText = 'color:var(--text-muted);font-size:12px;padding:10px;text-align:center;';
      empty.textContent = '暂无对话';
      els.chatList.appendChild(empty);
      return;
    }
    state.chats.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; }).forEach(function (chat) {
      var item = document.createElement('div');
      item.className = 'chat-item' + (chat.id === state.activeId ? ' active' : '');
      item.innerHTML = '<span class="chat-icon">💬</span><span class="chat-name">' + escapeHtml(chat.title) +
        '</span><button class="chat-del" title="删除对话">✕</button>';
      item.addEventListener('click', function () {
        if (generating) return;
        state.activeId = chat.id;
        saveState(); renderAll(); closeSidebar();
      });
      item.querySelector('.chat-del').addEventListener('click', function (e) {
        e.stopPropagation();
        if (!confirm('确定删除对话「' + chat.title + '」吗？')) return;
        state.chats = state.chats.filter(function (c) { return c.id !== chat.id; });
        if (state.activeId === chat.id) state.activeId = state.chats.length ? state.chats[0].id : null;
        saveState(); renderAll();
      });
      els.chatList.appendChild(item);
    });
  }

  function messageEl(role, content, reasoning) {
    var wrap = document.createElement('div');
    wrap.className = 'message ' + role;
    var avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? '我' : '✦';
    var right = document.createElement('div');
    var bubble = document.createElement('div');
    bubble.className = 'bubble' + (content ? '' : ' empty');
    var html = '';
    if (reasoning) {
      html += '<details class="reasoning"><summary>💭 思考过程</summary><div class="reasoning-body">' +
        escapeHtml(reasoning) + '</div></details>';
    }
    html += markdown(content);
    bubble.innerHTML = html;
    right.appendChild(bubble);
    if (role === 'assistant' && content) {
      var actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.innerHTML = '<button class="msg-action" data-act="copy">复制</button>';
      right.appendChild(actions);
    }
    wrap.appendChild(avatar);
    wrap.appendChild(right);
    return wrap;
  }

  function renderMessages() {
    els.messages.innerHTML = '';
    var chat = activeChat();
    if (!chat || !chat.messages.length) {
      els.messages.appendChild(els.welcome);
      els.welcome.style.display = '';
      return;
    }
    els.welcome.style.display = 'none';
    chat.messages.forEach(function (m) {
      els.messages.appendChild(messageEl(m.role, m.content, m.reasoning));
    });
    scrollToBottom();
  }

  function scrollToBottom() { els.messages.scrollTop = els.messages.scrollHeight; }

  function newChat() {
    if (generating) return;
    var chat = { id: uid(), title: '新的对话', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    state.chats.push(chat);
    state.activeId = chat.id;
    saveState(); renderAll(); closeSidebar();
    els.userInput.focus();
  }

  /* ---------- 发送与流式输出 ---------- */
  function setGenerating(v) {
    generating = v;
    els.sendBtn.style.display = v ? 'none' : '';
    els.stopBtn.style.display = v ? '' : 'none';
    els.userInput.disabled = v;
  }

  function send(text) {
    text = (text || '').trim();
    if (!text || generating) return;

    var s = state.settings;
    if (!s.apiKey || !s.baseUrl || !s.model) {
      openSettings();
      setTestResult('请先填写接口地址、API Key 和模型名称', 'err');
      return;
    }

    var chat = activeChat();
    if (!chat) { chat = { id: uid(), title: '新的对话', messages: [], createdAt: Date.now(), updatedAt: Date.now() }; state.chats.push(chat); state.activeId = chat.id; }

    chat.messages.push({ role: 'user', content: text });
    if (chat.messages.length === 1 || chat.title === '新的对话') {
      chat.title = text.length > 18 ? text.slice(0, 18) + '…' : text;
    }
    chat.messages.push({ role: 'assistant', content: '' });
    chat.updatedAt = Date.now();
    saveState(); renderAll();
    els.userInput.value = '';
    autoResize();
    stream(chat);
  }

  function buildMessages(chat) {
    var s = state.settings;
    var list = [];
    if (s.system && s.system.trim()) list.push({ role: 'system', content: s.system.trim() });
    chat.messages.slice(0, -1).forEach(function (m) { list.push({ role: m.role, content: m.content }); });
    return list;
  }

  function apiUrl() {
    if (proxyAvailable) return 'api/chat';
    return state.settings.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  }

  function usingProxy() { return proxyAvailable; }

  // 探测本地代理是否可用：仅 localhost 环境下尝试，线上静态托管一律直连
  async function detectProxy() {
    if (!isLocal) { proxyAvailable = false; return; }
    try {
      var res = await fetch('api/ping', { method: 'GET', cache: 'no-store' });
      if (res.ok) {
        var data = await res.json();
        proxyAvailable = !!(data && data.proxy);
      }
    } catch (e) { proxyAvailable = false; }
  }

  // 月之暗面 Kimi 推理模型（kimi-k2.6 / k3 系列）只接受 temperature=1
  function safeTemperature(model, value) {
    var t = parseFloat(value);
    if (isNaN(t)) t = 1;
    if (/^kimi-/i.test(model || '')) return 1;
    return t;
  }

  async function stream(chat) {
    var s = state.settings;
    var assistantMsg = chat.messages[chat.messages.length - 1];
    setGenerating(true);
    abortController = new AbortController();
    var bubbleEl = els.messages.querySelector('.message.assistant:last-child .bubble');
    var actionsEl = els.messages.querySelector('.message.assistant:last-child .msg-actions');

    try {
      var payload = {
        model: s.model,
        messages: buildMessages(chat),
        temperature: safeTemperature(s.model, s.temperature),
        max_tokens: parseInt(s.maxTokens, 10) || 2048,
        stream: true
      };
      var fetchOpts = { method: 'POST', signal: abortController.signal, headers: { 'Content-Type': 'application/json' } };
      if (usingProxy()) {
        payload.baseUrl = s.baseUrl;
        payload.apiKey = s.apiKey;
      } else {
        fetchOpts.headers['Authorization'] = 'Bearer ' + s.apiKey;
      }
      var res = await fetch(apiUrl(), Object.assign(fetchOpts, { body: JSON.stringify(payload) }));

      if (!res.ok) {
        var errText = await res.text();
        try { var j = JSON.parse(errText); errText = (j.error && j.error.message) || errText; } catch (e) {}
        throw new Error('HTTP ' + res.status + '：' + errText);
      }

      if (!res.body) throw new Error('当前接口未返回流式内容');

      var reader = res.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buffer = '';
      var gotContent = false;
      var reasoning = '';
      var reasoningEl = null;

      function renderBubble() {
        if (!bubbleEl) return;
        bubbleEl.classList.remove('empty');
        var html = '';
        if (reasoning) {
          html += '<details class="reasoning"><summary>💭 思考过程</summary><div class="reasoning-body">' +
            escapeHtml(reasoning) + '</div></details>';
        }
        html += markdown(assistantMsg.content);
        bubbleEl.innerHTML = html;
      }

      while (true) {
        var r = await reader.read();
        if (r.done) break;
        buffer += decoder.decode(r.value, { stream: true });
        var parts = buffer.split('\n');
        buffer = parts.pop();
        for (var i = 0; i < parts.length; i++) {
          var line = parts[i].trim();
          if (!line || line.indexOf('data:') !== 0) continue;
          var data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            var obj = JSON.parse(data);
            var delta = obj.choices && obj.choices[0] && obj.choices[0].delta;
            var piece = delta && delta.content ? delta.content : '';
            var think = delta && delta.reasoning_content ? delta.reasoning_content : '';
            if (think) reasoning += think;
            if (piece) {
              gotContent = true;
              assistantMsg.content += piece;
              renderBubble();
              scrollToBottom();
            } else if (think && reasoning && reasoning.length % 12 < 4) {
              renderBubble();
              scrollToBottom();
            }
          } catch (e) {}
        }
      }
      // 处理缓冲区尾部
      if (buffer.indexOf('data:') === 0) {
        var d = buffer.slice(5).trim();
        if (d !== '[DONE]') {
          try {
            var o = JSON.parse(d);
            var c = o.choices && o.choices[0] && o.choices[0].delta && o.choices[0].delta.content;
            if (c) { assistantMsg.content += c; gotContent = true; }
          } catch (e) {}
        }
      }
      if (!gotContent && !reasoning) assistantMsg.content = '（模型未返回内容，请检查模型名称或接口设置）';
      if (reasoning) assistantMsg.reasoning = reasoning;
      renderBubble();
      if (!actionsEl) renderMessages();
    } catch (err) {
      if (err.name === 'AbortError') {
        if (!assistantMsg.content) assistantMsg.content = '（已停止生成）';
        if (reasoning) assistantMsg.reasoning = reasoning;
      } else {
        var extra = '';
        if (err.message === 'Failed to fetch') {
          if (location.protocol === 'http:' && !isLocal) {
            extra = '\n\n🔑 最可能原因：你用 http 打开，浏览器拦截了到 AI 接口的安全请求。请改用 https 访问本网站。';
          } else {
            extra = '\n\n🔑 最可能原因：当前接口不允许浏览器跨域，或网络不通。可尝试本地运行 node server.js 走代理模式。';
          }
        }
        assistantMsg.content = '**⚠ 请求失败**\n\n' + escapeHtml(err.message) + extra +
          '\n\n其他检查项：API Key、接口地址、模型名称是否正确。';
      }
      renderMessages();
    } finally {
      chat.updatedAt = Date.now();
      saveState();
      abortController = null;
      setGenerating(false);
      scrollToBottom();
      els.userInput.focus();
    }
  }

  /* ---------- 设置弹窗 ---------- */
  function openSettings() {
    var s = state.settings;
    els.cfgBaseUrl.value = s.baseUrl || '';
    els.cfgApiKey.value = s.apiKey || '';
    els.cfgModel.value = s.model || '';
    els.cfgSystem.value = s.system || '';
    els.cfgTemperature.value = safeTemperature(s.model, s.temperature);
    els.cfgMaxTokens.value = s.maxTokens;
    els.cfgApiKey.type = 'password';
    els.toggleKeyBtn.textContent = '显示';
    setTestResult('', '');
    els.settingsModal.style.display = 'flex';
    setTimeout(function () { els.cfgApiKey.focus(); }, 50);
  }

  function closeSettings() { els.settingsModal.style.display = 'none'; }

  function setTestResult(msg, kind) {
    els.testResult.textContent = msg || '';
    els.testResult.className = 'test-result' + (kind ? ' ' + kind : '');
  }

  function readForm() {
    return {
      baseUrl: els.cfgBaseUrl.value.trim(),
      apiKey: els.cfgApiKey.value.trim(),
      model: els.cfgModel.value.trim(),
      system: els.cfgSystem.value,
      temperature: els.cfgTemperature.value,
      maxTokens: els.cfgMaxTokens.value
    };
  }

  function applyForm(form) {
    state.settings = form;
    saveState();
    renderHeader();
  }

  /* ---------- 事件绑定 ---------- */
  function openSidebar() { els.sidebar.classList.remove('collapsed'); els.sidebarMask.classList.add('show'); }
  function closeSidebar() { els.sidebar.classList.add('collapsed'); els.sidebarMask.classList.remove('show'); }

  els.newChatBtn.addEventListener('click', newChat);
  els.menuBtn.addEventListener('click', openSidebar);
  els.collapseBtn.addEventListener('click', closeSidebar);
  els.sidebarMask.addEventListener('click', closeSidebar);
  els.settingsBtn.addEventListener('click', openSettings);
  els.closeSettingsBtn.addEventListener('click', closeSettings);
  els.cancelSettingsBtn.addEventListener('click', closeSettings);
  els.settingsModal.addEventListener('click', function (e) { if (e.target === els.settingsModal) closeSettings(); });

  els.saveSettingsBtn.addEventListener('click', function () {
    var form = readForm();
    if (!form.baseUrl || !form.apiKey || !form.model) {
      setTestResult('接口地址、API Key、模型名称都需要填写', 'err');
      return;
    }
    applyForm(form);
    closeSettings();
  });

  els.toggleKeyBtn.addEventListener('click', function () {
    var show = els.cfgApiKey.type === 'password';
    els.cfgApiKey.type = show ? 'text' : 'password';
    els.toggleKeyBtn.textContent = show ? '隐藏' : '显示';
  });

  document.querySelectorAll('.preset-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var p = PRESETS[btn.dataset.preset];
      if (!p) return;
      els.cfgBaseUrl.value = p.baseUrl;
      els.cfgModel.value = p.model;
      setTestResult('已填入预设，请再粘贴 API Key', 'ok');
    });
  });

  els.testBtn.addEventListener('click', async function () {
    var form = readForm();
    if (!form.baseUrl || !form.apiKey || !form.model) {
      setTestResult('请先填写接口地址、API Key 和模型名称', 'err');
      return;
    }
    els.testBtn.disabled = true;
    setTestResult('正在测试…', '');
    try {
      var payload = { model: form.model, messages: [{ role: 'user', content: '回复 OK' }], temperature: safeTemperature(form.model, form.temperature), max_tokens: 64, stream: false };
      var fetchOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
      if (usingProxy()) {
        payload.baseUrl = form.baseUrl;
        payload.apiKey = form.apiKey;
        fetchOpts.body = JSON.stringify(payload);
        var res = await fetch('api/chat', Object.assign(fetchOpts, { body: JSON.stringify(payload) }));
      } else {
        fetchOpts.headers['Authorization'] = 'Bearer ' + form.apiKey;
        var res = await fetch(form.baseUrl.replace(/\/+$/, '') + '/chat/completions', Object.assign(fetchOpts, { body: JSON.stringify(payload) }));
      }
      if (!res.ok) {
        var t = await res.text();
        try { var j = JSON.parse(t); t = (j.error && j.error.message) || t; } catch (e) {}
        throw new Error('HTTP ' + res.status + '：' + t);
      }
      var data = await res.json();
      var reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      setTestResult('✓ 连接成功' + (reply ? '（模型回复：' + String(reply).slice(0, 20) + '）' : ''), 'ok');
    } catch (err) {
      setTestResult('✗ ' + err.message, 'err');
    } finally {
      els.testBtn.disabled = false;
    }
  });

  els.themeBtn.addEventListener('click', function () {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.body.dataset.theme = state.theme;
    els.themeBtn.textContent = state.theme === 'dark' ? '☀' : '☾';
    saveState();
  });

  function autoResize() {
    els.userInput.style.height = 'auto';
    els.userInput.style.height = Math.min(els.userInput.scrollHeight, 180) + 'px';
  }

  els.userInput.addEventListener('input', autoResize);
  els.userInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send(els.userInput.value);
    }
  });
  els.sendBtn.addEventListener('click', function () { send(els.userInput.value); });
  els.stopBtn.addEventListener('click', function () { if (abortController) abortController.abort(); });

  // file:// 打开时给出提示（部分浏览器允许直连，若失败建议用本地服务）
  if (location.protocol === 'file:') {
    var warn = document.createElement('div');
    warn.style.cssText = 'max-width:820px;margin:12px auto;padding:12px 16px;border-radius:10px;background:#fff3cd;color:#7a5b00;border:1px solid #ffd97d;font-size:13px;text-align:center;';
    warn.innerHTML = 'ℹ 当前是双击打开方式。若请求失败，请在该文件夹运行 <code>node server.js</code> 后访问 <b>http://localhost:3000</b>，或把网站上传到支持 HTTPS 的静态托管。';
    els.messages.insertBefore(warn, els.messages.firstChild);
  }

  els.welcome.addEventListener('click', function (e) {
    var card = e.target.closest('.tip-card');
    if (card) send(card.dataset.tip);
  });

  els.messages.addEventListener('click', function (e) {
    var copyBtn = e.target.closest('.copy-code-btn');
    if (copyBtn) {
      var code = decodeURIComponent(copyBtn.dataset.code || '');
      navigator.clipboard.writeText(code).then(function () {
        copyBtn.textContent = '已复制';
        setTimeout(function () { copyBtn.textContent = '复制'; }, 1500);
      });
      return;
    }
    var act = e.target.closest('.msg-action');
    if (act && act.dataset.act === 'copy') {
      var bubble = act.closest('.message').querySelector('.bubble');
      navigator.clipboard.writeText(bubble.innerText).then(function () {
        act.textContent = '已复制';
        setTimeout(function () { act.textContent = '复制'; }, 1500);
      });
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeSettings(); closeSidebar(); }
  });

  /* ---------- 初始化 ---------- */
  document.body.dataset.theme = state.theme;
  els.themeBtn.textContent = state.theme === 'dark' ? '☀' : '☾';
  if (!state.chats.length && !state.activeId) {
    // 不预建空对话，首页显示欢迎语
  }
  renderAll();
  if (window.innerWidth <= 760) closeSidebar();
  autoResize();

  // http 线上页面请求 https API 会被浏览器当作混合内容拦截 → 引导改用 https
  if (location.protocol === 'http:' && !isLocal) {
    var httpsUrl = 'https://' + location.host + location.pathname;
    var sslTip = document.createElement('div');
    sslTip.style.cssText = 'max-width:820px;margin:0 auto 16px;padding:12px 16px;border-radius:10px;background:#fff3cd;color:#7a5b00;border:1px solid #ffd97d;font-size:13px;text-align:center;';
    sslTip.innerHTML = '⚠ 你正在用 <b>http</b> 访问，浏览器会拦截向 AI 接口的安全请求。请改用 <b>https</b>：' +
      '<a href="' + httpsUrl + '" style="color:#8a6d00;font-weight:700;text-decoration:underline">' + httpsUrl + '</a>';
    els.messages.insertBefore(sslTip, els.messages.firstChild);
  }

  // 探测本地代理：有则用代理，无（静态托管）则浏览器直连 API
  detectProxy().then(function () {
    renderHeader();
    var tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;bottom:70px;right:18px;z-index:50;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-size:11px;color:var(--text-muted);box-shadow:var(--shadow);';
    tip.textContent = proxyAvailable ? '● 本地代理模式' : '● 直连 API 模式（静态托管）';
    document.body.appendChild(tip);
    setTimeout(function () { if (tip.parentNode) tip.parentNode.removeChild(tip); }, 4000);
  });
})();
