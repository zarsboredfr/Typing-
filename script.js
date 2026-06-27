const pageType = document.body.dataset.page || 'login';
const authSection = document.getElementById('authSection');
const chatSection = document.getElementById('chatSection');
const userStatus = document.getElementById('userStatus');
const logoutButton = document.getElementById('logoutButton');
const authForm = document.getElementById('authForm');
const authTitle = document.getElementById('authTitle');
const authSwitchText = document.getElementById('authSwitchText');
const switchAuthButton = document.getElementById('switchAuthButton');
const authError = document.getElementById('authError');
const usernameInput = document.getElementById('usernameInput');
const displayNameInput = document.getElementById('displayNameInput');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const emailLabel = document.getElementById('emailLabel');
const messagesEl = document.getElementById('messages');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const emojiButton = document.getElementById('emojiButton');
const gifButton = document.getElementById('gifButton');
const emojiPicker = document.getElementById('emojiPicker');
const gifPicker = document.getElementById('gifPicker');
const typingIndicator = document.getElementById('typingIndicator');
const onlineUsersEl = document.getElementById('onlineUsers');
const settingsUsernameInput = document.getElementById('settingsUsernameInput');
const settingsDisplayNameInput = document.getElementById('settingsDisplayNameInput');
const settingsAvatarInput = document.getElementById('settingsAvatarInput');
const settingsAvatarPreview = document.getElementById('avatarPreview');
const settingsBioInput = document.getElementById('settingsBioInput');
const settingsEmailInput = document.getElementById('settingsEmailInput');
const settingsSaveProfileButton = document.getElementById('settingsSaveProfileButton');
const settingsCurrentPass = document.getElementById('settingsCurrentPass');
const settingsNewPass = document.getElementById('settingsNewPass');
const settingsConfirmPass = document.getElementById('settingsConfirmPass');
const settingsChangePasswordButton = document.getElementById('settingsChangePasswordButton');
const profileModal = document.getElementById('profileModal');
const profileClose = document.getElementById('profileClose');
const profileAvatar = document.getElementById('profileAvatar');
const profileDisplay = document.getElementById('profileDisplay');
const profileUsername = document.getElementById('profileUsername');
const profileBio = document.getElementById('profileBio');
const profileMemberSince = document.getElementById('profileMemberSince');
const profileFriendsSince = document.getElementById('profileFriendsSince');
const profileFriendButton = document.getElementById('profileFriendButton');

const AUTH_KEY = 'typingAuth';
const API_BASE = (() => {
  if (window.location.protocol === 'file:') return 'http://localhost:3000';
  const host = window.location.host;
  if (host.includes('5500') || host.includes('8080') || host.includes('3001')) {
    return 'http://localhost:3000';
  }
  return '';
})();
let authMode = pageType === 'signup' ? 'signup' : 'login';
let socket = null;
let typingTimeout = null;

function getStoredAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY)) || {};
  } catch {
    return {};
  }
}

function saveAuth(auth) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

function getAuthToken() {
  return getStoredAuth().token || '';
}

function connectSocket() {
  if (socket) {
    socket.disconnect();
  }
  socket = io(API_BASE || '', { withCredentials: true });

  socket.on('connect_error', (error) => {
    if (authError) authError.textContent = error.message;
  });

  socket.on('onlineUsers', (users) => {
    onlineUsersEl.innerHTML = users
      .map((user) => `<div>${escapeHtml(user.username)}</div>`)
      .join('');
  });

  socket.on('typing', (payload) => {
    typingIndicator.textContent = payload?.isTyping
      ? `${escapeHtml(payload.username)} is typing...`
      : 'No one is typing';
  });

  socket.on('message', (message) => {
    addMessageToList(message, getStoredAuth().user?.id);
    scrollToBottom();
  });

  socket.on('messageDeleted', (payload) => {
    const messageEl = document.querySelector(`[data-id="${payload.id}"]`);
    if (messageEl) {
      messageEl.remove();
    }
  });
}

function sendTypingEvent(isTyping) {
  if (!socket) return;
  socket.emit('typing', { isTyping });
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const url = API_BASE ? `${API_BASE}${path}` : path;
  try {
    const res = await fetch(url, { ...options, headers, credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Unable to reach backend. Make sure the Node server is running on http://localhost:3000.');
    }
    throw error;
  }
}

function showAuth() {
  if (authSection) authSection.classList.remove('hidden');
  if (chatSection) chatSection.classList.add('hidden');
  if (logoutButton) logoutButton.classList.add('hidden');
  if (userStatus) userStatus.textContent = 'Please log in';
  setAuthMode(authMode);
}

function showChat(user) {
  if (authSection) authSection.classList.add('hidden');
  if (chatSection) chatSection.classList.remove('hidden');
  if (logoutButton) logoutButton.classList.remove('hidden');
  if (userStatus) userStatus.textContent = `Logged in as ${escapeHtml(user.displayName || user.username)}`;
  if (messageInput) messageInput.focus();
}

function showSettings(user) {
  if (authSection) authSection.classList.add('hidden');
  if (chatSection) chatSection.classList.add('hidden');
  if (logoutButton) logoutButton.classList.remove('hidden');
  if (userStatus) userStatus.textContent = `Settings for ${escapeHtml(user.username)}`;
  populateSettings(user);
}

function updateAvatarPreview(url) {
  if (!settingsAvatarPreview) return;
  settingsAvatarPreview.src = url || 'https://api.dicebear.com/initials/svg?seed=Anonymous';
}

function populateSettings(user) {
  if (settingsUsernameInput) settingsUsernameInput.value = user.username || '';
  if (settingsDisplayNameInput) settingsDisplayNameInput.value = user.displayName || user.username || '';
  if (settingsAvatarInput) settingsAvatarInput.value = user.avatar || '';
  if (settingsEmailInput) settingsEmailInput.value = user.email || '';
  if (settingsBioInput) settingsBioInput.value = user.bio || '';
  updateAvatarPreview(user.avatar || 'https://api.dicebear.com/initials/svg?seed=' + encodeURIComponent(user.username || 'Anonymous'));
}

function setAuthMode(mode) {
  authMode = mode;
  if (authTitle) authTitle.textContent = mode === 'login' ? 'Log in' : 'Sign up';
  if (authSwitchText) authSwitchText.textContent = mode === 'login' ? 'No account?' : 'Already have one?';
  if (switchAuthButton) switchAuthButton.textContent = mode === 'login' ? 'Sign up' : 'Log in';
  if (authError) authError.textContent = '';
}

function renderMessages(messages = [], currentUserId = null) {
  messagesEl.innerHTML = '';
  if (messages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'message';
    empty.textContent = 'No messages yet.';
    messagesEl.appendChild(empty);
    return;
  }
  messages.forEach((message) => {
    addMessageToList(message, currentUserId);
  });
}

async function loadMessages() {
  const data = await apiFetch('/api/messages');
  const currentUserId = getStoredAuth().user?.id;
  renderMessages(data.messages || [], currentUserId);
  scrollToBottom();
}

async function loadCurrentUser() {
  try {
    const data = await apiFetch('/api/me');
    saveAuth({ token: getStoredAuth().token || data.token, user: data.user });
    if (pageType === 'chat') {
      showChat(data.user);
      connectSocket();
      await loadMessages();
    } else if (pageType === 'settings') {
      showSettings(data.user);
    }
  } catch (error) {
    clearAuth();
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    if (pageType === 'chat' || pageType === 'settings') {
      window.location.href = 'index.html';
      return;
    }
    if (error.message !== 'Unauthorized' && authError) {
      authError.textContent = error.message;
    }
  }
}

async function submitAuth(event) {
  event.preventDefault();
  const email = emailInput ? emailInput.value.trim() : '';
  const username = usernameInput ? usernameInput.value.trim() : '';
  const password = passwordInput.value.trim();

  if (authMode === 'signup') {
    if (!username || !password || !email) {
      if (authError) authError.textContent = 'Username, password, and email are required for sign up.';
      return;
    }
  } else {
    if (!email || !password) {
      if (authError) authError.textContent = 'Email and password are required to log in.';
      return;
    }
  }

  try {
    const payload = authMode === 'signup'
      ? { username, displayName: displayNameInput?.value.trim(), password, email }
      : { email, password };
    const endpoint = authMode === 'signup' ? '/api/signup' : '/api/login';
    const data = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    saveAuth({ token: data.token, user: data.user });
    if (usernameInput) usernameInput.value = '';
    if (displayNameInput) displayNameInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (emailInput) emailInput.value = '';
    window.location.href = 'chat.html';
  } catch (error) {
    if (authError) authError.textContent = error.message;
  }
}

let selectedGifUrl = null;

async function submitMessage(event) {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text && !selectedGifUrl) return;
  if (!socket) {
    if (authError) authError.textContent = 'Not connected to backend.';
    return;
  }
  socket.emit('message', { text, gifUrl: selectedGifUrl }, (response) => {
    if (response?.error) {
      if (authError) authError.textContent = response.error;
      return;
    }
    messageInput.value = '';
    selectedGifUrl = null;
    if (gifPicker) gifPicker.classList.add('hidden');
    scrollToBottom();
  });
}

async function saveProfile() {
  const displayName = settingsDisplayNameInput?.value.trim();
  const email = settingsEmailInput?.value.trim();
  const avatar = settingsAvatarInput?.value.trim();
  const bio = settingsBioInput?.value.trim();

  if (!displayName || !email) {
    alert('Please fill in display name and email.');
    return;
  }

  try {
    const data = await apiFetch('/api/me', {
      method: 'PUT',
      body: JSON.stringify({ displayName, email, avatar, bio }),
    });
    saveAuth({ user: data.user });
    populateSettings(data.user);
    alert('Profile updated successfully.');
  } catch (error) {
    alert(error.message);
  }
}

async function openProfileModal(userId) {
  try {
    const data = await apiFetch(`/api/users/${userId}`);
    const profile = data.profile;
    if (profileAvatar) profileAvatar.src = profile.avatar || 'https://api.dicebear.com/initials/svg?seed=Anonymous';
    if (profileDisplay) profileDisplay.textContent = profile.displayName || profile.username;
    if (profileUsername) profileUsername.textContent = `@${profile.username}`;
    if (profileBio) profileBio.textContent = profile.bio || 'No bio available.';
    if (profileMemberSince) profileMemberSince.textContent = profile.createdAt
      ? new Date(profile.createdAt).toLocaleDateString()
      : 'Unknown';
    if (profileFriendsSince) profileFriendsSince.textContent = data.friendSince
      ? new Date(data.friendSince).toLocaleDateString()
      : 'Not friends yet';
    if (profileFriendButton) {
      profileFriendButton.dataset.userId = userId;
      profileFriendButton.textContent = data.friendSince ? 'Friends' : 'Add Friend';
      profileFriendButton.disabled = !!data.friendSince;
    }
    if (profileModal) profileModal.classList.remove('hidden');
  } catch (error) {
    alert(error.message);
  }
}

async function changePassword() {
  const currentPass = settingsCurrentPass?.value || '';
  const newPass = settingsNewPass?.value || '';
  const confirmPass = settingsConfirmPass?.value || '';
  if (!currentPass || !newPass || !confirmPass) {
    alert('Please fill in all password fields.');
    return;
  }
  if (newPass !== confirmPass) {
    alert('New passwords do not match.');
    return;
  }

  try {
    await apiFetch('/api/me/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword: currentPass, newPassword: newPass }),
    });
    settingsCurrentPass.value = '';
    settingsNewPass.value = '';
    settingsConfirmPass.value = '';
    alert('Password changed successfully.');
  } catch (error) {
    alert(error.message);
  }
}

function addMessageToList(message, currentUserId = null) {
  if (document.querySelector(`[data-id="${message.id}"]`)) return;
  const isOwn = currentUserId && currentUserId === message.userId;
  const item = document.createElement('div');
  item.className = `message${isOwn ? ' own' : ''}`;
  item.dataset.id = message.id;
  item.innerHTML = `
    <div class="message-avatar" data-user-id="${escapeHtml(message.userId)}">
      <img src="${escapeHtml(message.avatar || 'https://api.dicebear.com/initials/svg?seed=' + encodeURIComponent(message.authorDisplayName || message.author))}" alt="${escapeHtml(message.authorDisplayName || message.author)} avatar" />
    </div>
    <div class="message-content">
      <div class="message-header">
        <div class="message-author" data-user-id="${escapeHtml(message.userId)}"><strong>${escapeHtml(message.authorDisplayName || message.author)}</strong> · ${escapeHtml(message.authorUsername || message.author)} · ${new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        ${isOwn ? '<div class="message-actions"><button type="button" class="message-action delete-button">🗑</button></div>' : ''}
      </div>
      <div class="message-text">${escapeHtml(message.text || '')}</div>
      ${message.gifUrl ? `<div class="message-gif"><img src="${escapeHtml(message.gifUrl)}" alt="GIF" /></div>` : ''}
      <div class="message-status">Delivered</div>
    </div>
  `;
  messagesEl.appendChild(item);
}

function escapeHtml(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toggleEmojiPicker() {
  if (!emojiPicker) return;
  emojiPicker.classList.toggle('hidden');
  if (gifPicker) gifPicker.classList.add('hidden');
}

function insertEmoji(emoji) {
  messageInput.value += emoji;
  messageInput.focus();
}

function startTyping() {
  if (!socket) return;
  sendTypingEvent(true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => sendTypingEvent(false), 700);
}

if (authForm) {
  authForm.addEventListener('submit', submitAuth);
}
if (switchAuthButton) {
  switchAuthButton.addEventListener('click', () => {
    if (pageType === 'login') {
      window.location.href = 'signup.html';
    } else {
      window.location.href = 'index.html';
    }
  });
}
if (logoutButton) {
  logoutButton.addEventListener('click', () => {
    clearAuth();
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    window.location.href = 'index.html';
  });
}
if (messageForm) {
  messageForm.addEventListener('submit', submitMessage);
}
if (messageInput) {
  messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitMessage(event);
      return;
    }
  });
  messageInput.addEventListener('input', startTyping);
}
if (emojiButton) {
  emojiButton.addEventListener('click', toggleEmojiPicker);
}
if (emojiPicker) {
  emojiPicker.addEventListener('click', (event) => {
    const button = event.target.closest('.emoji-item');
    if (!button) return;
    insertEmoji(button.textContent.trim());
  });
}
if (settingsAvatarInput) {
  settingsAvatarInput.addEventListener('input', () => updateAvatarPreview(settingsAvatarInput.value.trim()));
}
if (settingsSaveProfileButton) {
  settingsSaveProfileButton.addEventListener('click', saveProfile);
}
if (settingsChangePasswordButton) {
  settingsChangePasswordButton.addEventListener('click', changePassword);
}
if (gifButton) {
  gifButton.addEventListener('click', () => {
    if (!gifPicker) return;
    gifPicker.classList.toggle('hidden');
    if (emojiPicker) emojiPicker.classList.add('hidden');
  });
}
if (gifPicker) {
  gifPicker.addEventListener('click', (event) => {
    const button = event.target.closest('.gif-item');
    if (!button) return;
    selectedGifUrl = button.dataset.url || '';
    if (selectedGifUrl) {
      messageInput.value = `GIF: ${selectedGifUrl}`;
      gifPicker.classList.add('hidden');
    }
  });
}
if (profileClose) {
  profileClose.addEventListener('click', () => {
    if (profileModal) profileModal.classList.add('hidden');
  });
}
if (profileFriendButton) {
  profileFriendButton.addEventListener('click', async () => {
    const targetId = profileFriendButton.dataset.userId;
    if (!targetId) return;
    try {
      await apiFetch(`/api/friends/${targetId}`, { method: 'POST' });
      profileFriendButton.textContent = 'Friends';
      profileFriendButton.disabled = true;
      if (profileFriendsSince) profileFriendsSince.textContent = new Date().toLocaleDateString();
    } catch (error) {
      alert(error.message);
    }
  });
}

function attachSettingsTabs() {
  const tabItems = document.querySelectorAll('.menu-item');
  const tabs = document.querySelectorAll('.tab-content');
  if (!tabItems.length || !tabs.length) return;

  tabItems.forEach((item) => {
    item.addEventListener('click', () => {
      tabItems.forEach((i) => i.classList.remove('active'));
      tabs.forEach((tab) => tab.classList.add('hidden'));
      item.classList.add('active');
      const tabId = item.getAttribute('data-tab');
      const target = document.getElementById(tabId);
      if (target) target.classList.remove('hidden');
    });
  });
}
if (messagesEl) {
  messagesEl.addEventListener('click', (event) => {
    const button = event.target.closest('.delete-button');
    if (button) {
      const messageId = button.closest('.message')?.dataset.id;
      if (!messageId || !socket) return;
      socket.emit('deleteMessage', { id: messageId }, (response) => {
        if (response?.error && authError) {
          authError.textContent = response.error;
        }
      });
      return;
    }

    const authorElement = event.target.closest('.message-author, .message-avatar');
    if (!authorElement) return;
    const userId = authorElement.dataset.userId;
    if (!userId) return;
    openProfileModal(userId);
  });
}

function initializePage() {
  if (pageType === 'chat' || pageType === 'settings') {
    if (pageType === 'settings') {
      attachSettingsTabs();
    }
    loadCurrentUser();
    return;
  }

  authMode = pageType === 'signup' ? 'signup' : 'login';
  setAuthMode(authMode);
  if (getAuthToken()) {
    window.location.href = 'chat.html';
  }
}

initializePage();
