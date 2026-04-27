import { useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Copy, CheckCircle2, AlertTriangle, Download } from 'lucide-react';
import debounce from 'lodash.debounce';
import toast from 'react-hot-toast';
import { API_BASE_URL, SOCKET_URL } from '../lib/config';
import { useRef } from 'react';

let socket;
const CLIENT_ID_STORAGE_KEY = 'rustpad_client_id';
const DISPLAY_NAME_STORAGE_KEY = 'rustpad_display_name';
const DISPLAY_COLOR_STORAGE_KEY = 'rustpad_display_color';
const USER_COLORS = [
  '#ef4444',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#84cc16'
];
const NAME_ADJECTIVES = ['Neon', 'Cyber', 'Shadow', 'Ghost', 'Holo', 'Quantum', 'Hyper', 'Stellar'];
const NAME_NOUNS = ['Tiger', 'Byte', 'Fox', 'Wolf', 'Lynx', 'Pulse', 'Wave', 'Core'];

function getClientId() {
  const existing = window.sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const generated =
    window.crypto?.randomUUID?.() ||
    `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, generated);
  return generated;
}

function getRandomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function getDisplayName() {
  const existing = window.sessionStorage.getItem(DISPLAY_NAME_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const generated = `${getRandomItem(NAME_ADJECTIVES)}${getRandomItem(NAME_NOUNS)}`;
  window.sessionStorage.setItem(DISPLAY_NAME_STORAGE_KEY, generated);
  return generated;
}

function getDisplayColor() {
  const existing = window.sessionStorage.getItem(DISPLAY_COLOR_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const generated = getRandomItem(USER_COLORS);
  window.sessionStorage.setItem(DISPLAY_COLOR_STORAGE_KEY, generated);
  return generated;
}

function deriveOperations(previousText, nextText) {
  if (previousText === nextText) {
    return [];
  }

  let start = 0;
  while (
    start < previousText.length &&
    start < nextText.length &&
    previousText[start] === nextText[start]
  ) {
    start += 1;
  }

  let previousEnd = previousText.length - 1;
  let nextEnd = nextText.length - 1;
  while (
    previousEnd >= start &&
    nextEnd >= start &&
    previousText[previousEnd] === nextText[nextEnd]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  const deletedText = previousText.slice(start, previousEnd + 1);
  const insertedText = nextText.slice(start, nextEnd + 1);
  const operations = [];

  if (deletedText) {
    operations.push({
      type: 'delete',
      position: start,
      text: deletedText
    });
  }

  if (insertedText) {
    operations.push({
      type: 'insert',
      position: start,
      text: insertedText
    });
  }

  return operations;
}

function applyOperationToText(currentText, operation) {
  if (!operation) return currentText;

  if (operation.type === 'insert') {
    return (
      currentText.slice(0, operation.position) +
      operation.text +
      currentText.slice(operation.position)
    );
  }

  if (operation.type === 'delete') {
    if (currentText.slice(operation.position, operation.position + operation.text.length) !== operation.text) {
      return null;
    }
    return (
      currentText.slice(0, operation.position) +
      currentText.slice(operation.position + operation.text.length)
    );
  }

  return null;
}

function applyOperationsToText(currentText, operations) {
  let nextText = currentText;

  for (const operation of operations) {
    nextText = applyOperationToText(nextText, operation);
    if (nextText == null) {
      return null;
    }
  }

  return nextText;
}

function adjustSelectionForOperation(selectionStart, selectionEnd, operation) {
  let nextStart = selectionStart;
  let nextEnd = selectionEnd;

  if (operation.type === 'insert') {
    const delta = operation.text.length;
    if (operation.position <= nextStart) nextStart += delta;
    if (operation.position <= nextEnd) nextEnd += delta;
    return { start: nextStart, end: nextEnd };
  }

  const deleteLength = operation.text.length;
  const deleteEnd = operation.position + deleteLength;

  if (operation.position < nextStart) {
    nextStart -= Math.min(deleteEnd - operation.position, nextStart - operation.position, deleteLength);
  }
  if (operation.position < nextEnd) {
    nextEnd -= Math.min(deleteEnd - operation.position, nextEnd - operation.position, deleteLength);
  }

  nextStart = Math.max(operation.position, nextStart);
  nextEnd = Math.max(operation.position, nextEnd);
  return { start: nextStart, end: nextEnd };
}

function cloneOperation(operation) {
  return {
    type: operation.type,
    position: operation.position,
    text: operation.text,
    client_id: operation.client_id
  };
}

function shouldShiftForInsert(applied, incoming) {
  if (applied.position < incoming.position) {
    return true;
  }
  if (applied.position > incoming.position) {
    return false;
  }

  // Tiebreaker: shift the incoming/local op when its client_id is strictly
  // greater — strict < mirrors the server-side rule exactly.
  const appliedClientId = applied.client_id || '';
  const incomingClientId = incoming.client_id || '';
  return appliedClientId < incomingClientId;
}

function transformInsertAgainstInsert(operation, applied) {
  const transformed = cloneOperation(operation);
  if (shouldShiftForInsert(applied, transformed)) {
    transformed.position += applied.text.length;
  }
  return [transformed];
}

function transformInsertAgainstDelete(operation, applied) {
  const transformed = cloneOperation(operation);
  const deleteStart = applied.position;
  const deleteEnd = deleteStart + applied.text.length;

  if (transformed.position <= deleteStart) {
    return [transformed];
  }
  if (transformed.position >= deleteEnd) {
    transformed.position -= applied.text.length;
    return [transformed];
  }

  transformed.position = deleteStart;
  return [transformed];
}

function transformDeleteAgainstInsert(operation, applied, allowSplit) {
  const insertPosition = applied.position;
  const insertLength = applied.text.length;
  const deleteStart = operation.position;
  const deleteEnd = deleteStart + operation.text.length;

  if (insertPosition <= deleteStart) {
    const transformed = cloneOperation(operation);
    transformed.position += insertLength;
    return [transformed];
  }

  if (insertPosition >= deleteEnd) {
    return [cloneOperation(operation)];
  }

  if (!allowSplit) {
    return null;
  }

  const splitIndex = insertPosition - deleteStart;
  const beforeText = operation.text.slice(0, splitIndex);
  const afterText = operation.text.slice(splitIndex);
  const transformed = [];

  if (afterText) {
    transformed.push({
      type: 'delete',
      position: insertPosition + insertLength,
      text: afterText
    });
  }
  if (beforeText) {
    transformed.push({
      type: 'delete',
      position: deleteStart,
      text: beforeText
    });
  }

  return transformed;
}

function transformDeleteAgainstDelete(operation, applied, allowNoop) {
  const deleteStart = operation.position;
  const deleteText = operation.text;
  const deleteEnd = deleteStart + deleteText.length;

  const appliedStart = applied.position;
  const appliedLength = applied.text.length;
  const appliedEnd = appliedStart + appliedLength;

  const beforeRemoved = Math.max(0, Math.min(appliedLength, deleteStart - appliedStart));
  const newPosition = deleteStart - beforeRemoved;

  const overlapStart = Math.max(deleteStart, appliedStart);
  const overlapEnd = Math.min(deleteEnd, appliedEnd);

  let newText = deleteText;
  if (overlapStart < overlapEnd) {
    const prefixLength = overlapStart - deleteStart;
    const suffixStart = overlapEnd - deleteStart;
    newText = deleteText.slice(0, prefixLength) + deleteText.slice(suffixStart);
  }

  if (!newText) {
    return allowNoop ? [] : null;
  }

  return [{
    type: 'delete',
    position: newPosition,
    text: newText
  }];
}

function transformOperationAgainst(operation, applied, { allowSplit = false, allowNoop = false } = {}) {
  if (operation.type === 'insert' && applied.type === 'insert') {
    return transformInsertAgainstInsert(operation, applied);
  }
  if (operation.type === 'insert' && applied.type === 'delete') {
    return transformInsertAgainstDelete(operation, applied);
  }
  if (operation.type === 'delete' && applied.type === 'insert') {
    return transformDeleteAgainstInsert(operation, applied, allowSplit);
  }
  if (operation.type === 'delete' && applied.type === 'delete') {
    return transformDeleteAgainstDelete(operation, applied, allowNoop);
  }
  return null;
}

function transformOperationsAgainstHistory(operations, history, options) {
  let transformedOperations = operations.map(cloneOperation);

  for (const applied of history) {
    const nextOperations = [];
    for (const operation of transformedOperations) {
      const transformed = transformOperationAgainst(operation, applied, options);
      if (transformed == null) {
        return null;
      }
      nextOperations.push(...transformed);
    }
    transformedOperations = nextOperations;
  }

  return transformedOperations;
}

// Rebase every operation in the queue against a remote operation that has
// already been transformed to sit "on top of" the queued work.  The
// transformed remote op is what the server will broadcast; the queue ops
// must be shifted to account for it.
function rebaseQueuedOperationsAgainstRemote(queuedOperations, transformedRemoteOperation) {
  const rebasedOperations = [];

  for (const operation of queuedOperations) {
    const transformed = transformOperationAgainst(operation, transformedRemoteOperation, {
      allowSplit: false,
      allowNoop: false
    });
    if (transformed == null || transformed.length !== 1) {
      return null;
    }
    rebasedOperations.push(transformed[0]);
  }

  return rebasedOperations;
}

export default function Pad() {
  const { id: roomId } = useParams();
  const navigate = useNavigate();
  const [clientId] = useState(() => getClientId());
  const [displayName] = useState(() => getDisplayName());
  const [displayColor] = useState(() => getDisplayColor());
  
  const [content, setContent] = useState('');
  const [users, setUsers] = useState({});
  const [mySid, setMySid] = useState('');
  const [typingUsers, setTypingUsers] = useState({});
  const [copied, setCopied] = useState(false);
  const [fatalError, setFatalError] = useState(null);
  const [connectionState, setConnectionState] = useState('connecting');
  const [requirePin, setRequirePin] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [shouldConnect, setShouldConnect] = useState(false);
  const usersRef = useRef({});
  const hasShownReconnectToastRef = useRef(false);
  const textareaRef = useRef(null);
  const serverContentRef = useRef('');
  const contentRef = useRef('');
  const versionRef = useRef(0);
  const queuedOperationsRef = useRef([]);
  const inflightCountRef = useRef(0);
  // Stores the cursor range to restore after the next React DOM commit.
  // useLayoutEffect reads and clears this synchronously after every render,
  // which avoids the rAF race with React 18's async rendering.
  const pendingSelectionRef = useRef(null);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  // Restore cursor position after every render where a remote op arrived.
  // Must be useLayoutEffect (not useEffect/rAF) so it runs after React writes
  // the new textarea value to the DOM but before the browser paints.
  useLayoutEffect(() => {
    const pending = pendingSelectionRef.current;
    if (pending && textareaRef.current) {
      textareaRef.current.setSelectionRange(pending.start, pending.end);
      pendingSelectionRef.current = null;
    }
  });

  const debouncedOperationFlush = useCallback(
    debounce(() => {
      if (!socket?.connected || inflightCountRef.current > 0 || queuedOperationsRef.current.length === 0) {
        return;
      }

      const operations = queuedOperationsRef.current.slice();
      inflightCountRef.current = operations.length;
      socket.emit('text_operations', {
        room_id: roomId,
        operations,
        base_version: versionRef.current,
        client_id: clientId
      });
    }, 75),
    [clientId, roomId]
  );

  useEffect(() => {
    const initPad = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/rooms/${roomId}`);
        if (res.status === 404) {
          await fetch(`${API_BASE_URL}/api/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_secure: false, pin: '', room_id: roomId })
          });
          setShouldConnect(true);
        } else if (res.ok) {
          const data = await res.json();
          if (data.is_secure) {
            setRequirePin(true);
          } else {
            setShouldConnect(true);
          }
        }
      } catch (err) {
        setFatalError('Failed to connect to the server.');
      }
    };
    initPad();
  }, [roomId]);

  useEffect(() => {
    if (!shouldConnect) return;

    socket = io(SOCKET_URL, {
      path: '/socket.io',
      transports: ['polling', 'websocket'],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });

    socket.on('connect', () => {
      setConnectionState('connected');
      hasShownReconnectToastRef.current = false;
      socket.emit('join_pad', {
        room_id: roomId,
        client_id: clientId,
        name: displayName,
        color: displayColor
      });
    });

    socket.on('connect_error', () => {
      setConnectionState('reconnecting');
      if (!hasShownReconnectToastRef.current) {
        toast('Reconnecting to the room…', { icon: '🔄', duration: 2000 });
        hasShownReconnectToastRef.current = true;
      }
    });

    socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') {
        setConnectionState('reconnecting');
        if (!hasShownReconnectToastRef.current) {
          toast('Connection lost. Reconnecting…', { icon: '📡', duration: 2200 });
          hasShownReconnectToastRef.current = true;
        }
      }
    });

    socket.on('init_state', ({ content, version, users, my_sid }) => {
      serverContentRef.current = content;
      contentRef.current = content;
      versionRef.current = version || 0;
      queuedOperationsRef.current = [];
      inflightCountRef.current = 0;
      setContent(content);
      setUsers(users);
      setMySid(my_sid);
    });

    socket.on('user_joined', ({ sid, user }) => {
      setUsers(prev => ({ ...prev, [sid]: user }));
      toast(`${user.name} joined`, { icon: '👋', duration: 2000 });
    });

    socket.on('user_left', ({ sid }) => {
      const leavingUser = usersRef.current[sid];
      if (leavingUser) {
        toast(`${leavingUser.name} left the chat`, { icon: '🚪', duration: 2500 });
      }

      setUsers(prev => {
        const next = { ...prev };
        delete next[sid];
        return next;
      });
      setTypingUsers(prev => {
        const next = {...prev};
        delete next[sid];
        return next;
      });
    });

    socket.on('operations_applied', ({ version, client_applied_count, applied_operations }) => {
      const nextServerContent = applyOperationsToText(serverContentRef.current, applied_operations || []);
      if (nextServerContent == null) {
        socket.emit('sync_request', { room_id: roomId });
        return;
      }

      serverContentRef.current = nextServerContent;
      versionRef.current = version;
      queuedOperationsRef.current = queuedOperationsRef.current.slice(client_applied_count);
      inflightCountRef.current = 0;

      const nextRenderedContent = applyOperationsToText(
        serverContentRef.current,
        queuedOperationsRef.current
      );
      if (nextRenderedContent == null) {
        socket.emit('sync_request', { room_id: roomId });
        return;
      }

      contentRef.current = nextRenderedContent;
      setContent(nextRenderedContent);
      if (queuedOperationsRef.current.length > 0) {
        debouncedOperationFlush();
      }
    });

    socket.on('operation_applied', ({ operation, version }) => {
      const queuedOperations = queuedOperationsRef.current.slice();
      // Transform the remote op past our local queue so we know where it
      // actually lands in the document the user sees.
      const transformedRemoteOperations = transformOperationsAgainstHistory(
        [operation],
        queuedOperations,
        { allowSplit: true, allowNoop: true }
      );
      // The queue must be rebased against the *transformed* remote op
      // (the one shifted past our local work), not the raw server op.
      // Using the raw op here was the root cause of position divergence.
      const rebasedQueuedOperations = transformedRemoteOperations && transformedRemoteOperations.length === 1
        ? rebaseQueuedOperationsAgainstRemote(queuedOperations, transformedRemoteOperations[0])
        : null;

      if (transformedRemoteOperations == null || rebasedQueuedOperations == null) {
        socket.emit('sync_request', { room_id: roomId });
        return;
      }

      const nextServerContent = applyOperationToText(serverContentRef.current, operation);
      if (nextServerContent == null) {
        socket.emit('sync_request', { room_id: roomId });
        return;
      }

      const textarea = textareaRef.current;
      // Always track cursor position — even when the textarea is not actively
      // focused (e.g. user has switched to another tab/window). Previously we
      // only restored the cursor when isFocused=true, which meant switching tabs
      // caused the cursor to snap to end when Tab 2's ops arrived in Tab 1.
      let selStart = textarea ? textarea.selectionStart : 0;
      let selEnd   = textarea ? textarea.selectionEnd   : 0;

      for (const transformedOperation of transformedRemoteOperations) {
        const adjusted = adjustSelectionForOperation(selStart, selEnd, transformedOperation);
        selStart = adjusted.start;
        selEnd   = adjusted.end;
      }

      const nextRenderedContent = applyOperationsToText(nextServerContent, rebasedQueuedOperations);
      if (nextRenderedContent == null) {
        socket.emit('sync_request', { room_id: roomId });
        return;
      }

      serverContentRef.current = nextServerContent;
      queuedOperationsRef.current = rebasedQueuedOperations;
      contentRef.current = nextRenderedContent;
      versionRef.current = version;
      setContent(nextRenderedContent);

      // Always schedule cursor restore — we track position even when unfocused.
      pendingSelectionRef.current = { start: selStart, end: selEnd };

    });

    socket.on('full_sync', ({ content: syncedContent, version, reason }) => {
      serverContentRef.current = syncedContent;
      contentRef.current = syncedContent;
      versionRef.current = version;
      queuedOperationsRef.current = [];
      inflightCountRef.current = 0;
      setContent(syncedContent);
      if (reason === 'version_mismatch' || reason === 'operation_conflict') {
        toast('Document resynced to keep everyone in sync.', { icon: '🛠️', duration: 2200 });
      }
      // Drain any ops that were buffered while we were out of sync.
      if (queuedOperationsRef.current.length > 0) {
        debouncedOperationFlush();
      }
    });

    socket.on('user_typing', ({ sid }) => {
      setTypingUsers(prev => ({ ...prev, [sid]: Date.now() }));
    });

    socket.on('error', (err) => {
      if (err.message === 'Room not found' || err.message === 'Room is full') {
        setFatalError(err.message);
      } else {
        toast.error(err.message);
      }
      if (err.message === 'Room not found' || err.message === 'Room is full') {
        setTimeout(() => navigate('/'), 2000);
      }
    });

    const handlePageLeave = () => {
      if (socket?.connected) {
        socket.emit('leave_pad', { room_id: roomId });
      }
    };

    window.addEventListener('pagehide', handlePageLeave);

    return () => {
      window.removeEventListener('pagehide', handlePageLeave);
      debouncedOperationFlush.cancel();
      handlePageLeave();
      if (socket) socket.disconnect();
    };
  }, [clientId, debouncedOperationFlush, displayColor, displayName, roomId, navigate, shouldConnect]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setTypingUsers(prev => {
        const next = { ...prev };
        let changed = false;
        for (const sid in next) {
          if (now - next[sid] > 3000) {
            delete next[sid];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const debouncedTyping = useCallback(
    debounce(() => {
      if (socket) socket.emit('typing', { room_id: roomId });
    }, 500),
    [roomId]
  );

  const handleChange = (e) => {
    const val = e.target.value;
    const operations = deriveOperations(contentRef.current, val).map((operation) => ({
      ...operation,
      client_id: clientId
    }));
    if (operations.length === 0) {
      setContent(val);
      contentRef.current = val;
      return;
    }

    queuedOperationsRef.current = [...queuedOperationsRef.current, ...operations];
    contentRef.current = val;
    setContent(val);
    debouncedTyping();
    debouncedOperationFlush();
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    toast.success('Link copied!');
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadText = () => {
    const element = document.createElement("a");
    const file = new Blob([content], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = `pad-${roomId}.txt`;
    document.body.appendChild(element); // Required for this to work in FireFox
    element.click();
    toast.success('Downloaded as txt');
  };

  const handlePinSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE_URL}/api/rooms/${roomId}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput })
      });
      if (res.ok) {
        setRequirePin(false);
        setShouldConnect(true);
      } else {
        toast.error('Invalid PIN');
      }
    } catch(err) {
      toast.error('Connection error.');
    }
  };

  if (fatalError) {
    return (
      <div className="h-screen bg-[#0e1111] flex items-center justify-center">
        <div className="bg-red-500/10 text-red-500 p-8 rounded-2xl flex flex-col items-center">
          <AlertTriangle size={32} className="mb-4" />
          <h2 className="text-xl">{fatalError}</h2>
        </div>
      </div>
    );
  }

  if (requirePin) {
    return (
      <div className="h-screen bg-[#0e1111] flex items-center justify-center p-4">
        <div className="bg-[#151818] p-8 rounded-2xl border border-gray-800 shadow-2xl w-full max-w-md">
          <h2 className="text-2xl font-bold mb-6 text-white text-center">Secure Pad</h2>
          <form onSubmit={handlePinSubmit} className="space-y-4">
            <input 
              type="password" 
              placeholder="Enter PIN" 
              required
              autoFocus
              className="w-full bg-[#1e2323] border border-gray-700 rounded-xl px-4 py-3 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all text-white placeholder-gray-500 text-center tracking-widest text-lg"
              value={pinInput}
              onChange={e => setPinInput(e.target.value)}
            />
            <button type="submit" className="w-full bg-purple-600 hover:bg-purple-500 text-white rounded-xl py-3 px-4 font-medium transition-all">
              Unlock
            </button>
          </form>
        </div>
      </div>
    );
  }

  const activeTyping = Object.keys(typingUsers).filter(sid => sid !== mySid).map(sid => users[sid]?.name).filter(Boolean);

  return (
    <div className="h-screen flex flex-col bg-[#0e1111] overflow-hidden relative">
      <div className="h-16 border-b border-gray-800 bg-[#151818] flex items-center justify-between px-6 shrink-0 relative z-10 shadow-sm">
        <div className="flex items-center space-x-4">
          <a href="/" className="text-xl font-bold font-mono tracking-wider text-gray-200 hover:text-white transition-colors">PAD:{roomId}</a>
          {connectionState !== 'connected' && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-amber-300">
              Reconnecting
            </span>
          )}
          {activeTyping.length > 0 && (
            <span className="text-xs text-blue-400 italic animate-pulse">
              {activeTyping.join(', ')} is typing...
            </span>
          )}
        </div>

        <div className="flex items-center space-x-6">
          <div className="flex items-center -space-x-2 mr-2">
             {Object.entries(users).map(([sid, user]) => (
               <div 
                 key={sid} 
                 className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 border-[#151818] text-white tooltip cursor-pointer hover:z-20 relative"
                 style={{ backgroundColor: user.color }}
                 title={user.name + (sid === mySid ? ' (You)' : '')}
               >
                 {user.name.substring(0, 2).toUpperCase()}
               </div>
             ))}
             <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center border-2 border-[#151818] text-xs font-bold text-gray-400 pl-2 pr-2 ml-2 shadow-sm">
               {Object.keys(users).length}/20
             </div>
          </div>

          <button onClick={downloadText} className="text-gray-400 hover:text-white transition-colors p-2" title="Download as .txt">
            <Download size={18} />
          </button>
          <button 
            onClick={copyLink}
            className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl transition-all shadow-lg"
          >
            {copied ? <CheckCircle2 size={16} className="text-green-200"/> : <Copy size={16}/>}
            <span className="text-sm font-medium">{copied ? 'Copied' : 'Share'}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 w-full max-w-5xl self-center p-6 py-8 md:p-12 overflow-hidden flex">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          autoFocus
          spellCheck={false}
          className="w-full h-full bg-transparent text-gray-200 text-lg leading-relaxed outline-none resize-none placeholder-gray-600 font-sans custom-scrollbar disabled:opacity-50"
          placeholder="Start typing..."
        />
      </div>
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 text-[11px] tracking-[0.24em] uppercase text-gray-600/90 pointer-events-none">
        Developed by Faizal Imam
      </div>
    </div>
  );
}
