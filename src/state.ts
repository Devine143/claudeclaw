import { EventEmitter } from 'node:events';

// ── Bot info (set once from onStart, read by dashboard) ─────────────

let _botUsername = '';
let _botName = '';

export function setBotInfo(username: string, name: string): void {
  _botUsername = username;
  _botName = name;
}

export function getBotInfo(): { username: string; name: string } {
  return { username: _botUsername, name: _botName };
}

// ── Telegram connection state ────────────────────────────────────────

let _telegramConnected = false;

export function getTelegramConnected(): boolean {
  return _telegramConnected;
}

export function setTelegramConnected(v: boolean): void {
  _telegramConnected = v;
}

// ── Chat event bus (SSE broadcasting) ────────────────────────────────

export interface ChatEvent {
  type: 'user_message' | 'assistant_message' | 'processing' | 'progress' | 'error' | 'hive_mind';
  chatId: string;
  agentId?: string;
  content?: string;
  source?: 'telegram' | 'dashboard';
  description?: string;
  processing?: boolean;
  timestamp: number;
}

export const chatEvents = new EventEmitter();
chatEvents.setMaxListeners(20);

export function emitChatEvent(event: Omit<ChatEvent, 'timestamp'>): void {
  const full: ChatEvent = { ...event, timestamp: Date.now() };
  chatEvents.emit('chat', full);
}

// ── Processing state ─────────────────────────────────────────────────

let _processing = false;
let _processingChatId = '';

export function setProcessing(chatId: string, v: boolean): void {
  _processing = v;
  _processingChatId = v ? chatId : '';
  emitChatEvent({ type: 'processing', chatId, processing: v });
}

export function getIsProcessing(): { processing: boolean; chatId: string } {
  return { processing: _processing, chatId: _processingChatId };
}

// ── Message queue (prevents concurrent queries per chat) ────────────

const _pendingMessages = new Map<string, string[]>();
const _activeChats = new Set<string>();

export function isChatBusy(chatId: string): boolean {
  return _activeChats.has(chatId);
}

export function setChatBusy(chatId: string, busy: boolean): void {
  if (busy) _activeChats.add(chatId);
  else _activeChats.delete(chatId);
}

export function queueMessage(chatId: string, message: string): void {
  const queue = _pendingMessages.get(chatId) ?? [];
  queue.push(message);
  _pendingMessages.set(chatId, queue);
}

export function drainQueue(chatId: string): string | undefined {
  const queue = _pendingMessages.get(chatId);
  if (!queue || queue.length === 0) {
    _pendingMessages.delete(chatId);
    return undefined;
  }
  // Combine all queued messages into one (user sent multiple while busy)
  const combined = queue.join('\n\n');
  _pendingMessages.delete(chatId);
  return combined;
}

// ── Active query abort ──────────────────────────────────────────────

const _activeAbort = new Map<string, AbortController>();

export function setActiveAbort(chatId: string, ctrl: AbortController | null): void {
  if (ctrl) _activeAbort.set(chatId, ctrl);
  else _activeAbort.delete(chatId);
}

export function abortActiveQuery(chatId: string): boolean {
  const ctrl = _activeAbort.get(chatId);
  if (ctrl) {
    ctrl.abort();
    _activeAbort.delete(chatId);
    return true;
  }
  return false;
}
