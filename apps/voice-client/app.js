// SmartDev Voice Client

(function () {
  'use strict';

  // ===== DOM Elements =====
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const messages = document.getElementById('messages');
  const confirmPanel = document.getElementById('confirm-panel');
  const confirmQuestion = document.getElementById('confirm-question');
  const confirmButtons = document.getElementById('confirm-buttons');
  const textInput = document.getElementById('text-input');
  const sendBtn = document.getElementById('send-btn');
  const micBtn = document.getElementById('mic-btn');
  const authModal = document.getElementById('auth-modal');
  const passcodeInput = document.getElementById('passcode-input');
  const authBtn = document.getElementById('auth-btn');

  // ===== State =====
  let ws = null;
  let isRecording = false;
  let recognition = null;

  // ===== WebSocket =====
  function connect(passcode) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = function () {
      setStatus('connecting', 'Authenticating...');
      ws.send(JSON.stringify({ type: 'auth', passcode: passcode }));
    };

    ws.onmessage = function (event) {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      handleServerMessage(msg);
    };

    ws.onclose = function () {
      setStatus('disconnected', 'Disconnected');
      setTimeout(function () { connect(passcode); }, 3000);
    };

    ws.onerror = function () {
      setStatus('disconnected', 'Connection error');
    };
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'auth_ok':
        authModal.classList.add('hidden');
        setStatus('connected', 'Connected');
        addMessage('system', 'Connected. Tap the mic and speak, or type below.');
        break;

      case 'auth_fail':
        authModal.classList.remove('hidden');
        addMessage('error', 'Authentication failed. Check your passcode.');
        break;

      case 'response':
        setStatus('connected', 'Connected');
        addMessage('assistant', msg.content);
        break;

      case 'confirm':
        setStatus('connected', 'Awaiting confirmation');
        showConfirmation(msg.confirmData || msg);
        break;

      case 'status':
        if (msg.content === 'Thinking...') {
          setStatus('thinking', 'Thinking...');
        } else {
          addMessage('system', msg.content);
        }
        break;

      case 'error':
        setStatus('connected', 'Connected');
        addMessage('error', msg.content);
        break;
    }
  }

  // ===== UI Helpers =====
  function setStatus(state, text) {
    statusDot.className = '';
    if (state === 'connected') statusDot.classList.add('connected');
    if (state === 'thinking') statusDot.classList.add('thinking');
    statusText.textContent = text;
  }

  function addMessage(role, content) {
    const div = document.createElement('div');
    div.className = 'message ' + role;

    // Simple markdown-ish rendering for code blocks
    let html = escapeHtml(content);
    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    div.innerHTML = html;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function escapeHtml(text) {
    var el = document.createElement('span');
    el.textContent = text;
    return el.innerHTML;
  }

  function showConfirmation(data) {
    confirmPanel.classList.remove('hidden');
    var source = data.source === 'claude-code' ? '[Claude Code] ' : '';
    confirmQuestion.textContent = source + (data.question || 'Confirm this action?');
    confirmButtons.innerHTML = '';

    var externalId = data.externalId || null;
    var options = data.options || ['Yes', 'No'];
    options.forEach(function (opt, i) {
      var btn = document.createElement('button');
      btn.className = 'confirm-btn';
      if (i === 0) btn.classList.add('primary');
      else if (i === options.length - 1) btn.classList.add('danger');
      else btn.classList.add('secondary');
      btn.textContent = opt;
      btn.onclick = function () {
        confirmPanel.classList.add('hidden');
        var msg = { type: 'confirm', choice: i + 1 };
        if (externalId) msg.externalId = externalId;
        ws.send(JSON.stringify(msg));
        addMessage('user', 'Chose: ' + opt);
        setStatus('connected', 'Connected');
      };
      confirmButtons.appendChild(btn);
    });
  }

  // ===== Send Text =====
  function sendText(text) {
    if (!text.trim() || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'text', content: text.trim() }));
    addMessage('user', text.trim());
    textInput.value = '';
  }

  sendBtn.onclick = function () { sendText(textInput.value); };
  textInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendText(textInput.value);
    }
  });

  // ===== Speech Recognition =====
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = function (event) {
      var transcript = event.results[0][0].transcript;
      sendText(transcript);
    };

    recognition.onend = function () {
      isRecording = false;
      micBtn.classList.remove('recording');
    };

    recognition.onerror = function (event) {
      isRecording = false;
      micBtn.classList.remove('recording');
      if (event.error !== 'no-speech') {
        addMessage('system', 'Speech error: ' + event.error);
      }
    };
  } else {
    micBtn.style.display = 'none';
    addMessage('system', 'Speech recognition not available in this browser. Use text input.');
  }

  micBtn.onclick = function () {
    if (!recognition) return;
    if (isRecording) {
      recognition.stop();
    } else {
      recognition.start();
      isRecording = true;
      micBtn.classList.add('recording');
    }
  };

  // ===== Auth =====
  function doAuth() {
    var passcode = passcodeInput.value;
    connect(passcode);
  }

  authBtn.onclick = doAuth;
  passcodeInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doAuth();
  });
})();
