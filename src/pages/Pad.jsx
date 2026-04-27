import { useEffect, useState, useCallback } from 'react';
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
  const [error, setError] = useState(null);
  const [requirePin, setRequirePin] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [shouldConnect, setShouldConnect] = useState(false);
  const usersRef = useRef({});

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

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
        setError('Failed to connect to the server.');
      }
    };
    initPad();
  }, [roomId]);

  useEffect(() => {
    if (!shouldConnect) return;

    socket = io(SOCKET_URL, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      timeout: 20000
    });

    socket.on('connect', () => {
      socket.emit('join_pad', {
        room_id: roomId,
        client_id: clientId,
        name: displayName,
        color: displayColor
      });
    });

    socket.on('connect_error', () => {
      setError('Realtime connection failed. Please refresh and try again.');
      toast.error('Realtime connection failed.');
    });

    socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') {
        toast.error('Connection lost.');
      }
    });

    socket.on('init_state', ({ content, users, my_sid }) => {
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

    socket.on('text_updated', ({ content: newContent }) => {
      setContent(newContent);
    });

    socket.on('user_typing', ({ sid }) => {
      setTypingUsers(prev => ({ ...prev, [sid]: Date.now() }));
    });

    socket.on('error', (err) => {
      setError(err.message);
      toast.error(err.message);
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
      handlePageLeave();
      if (socket) socket.disconnect();
    };
  }, [clientId, displayColor, displayName, roomId, navigate, shouldConnect]);

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

  const debouncedTextUpdate = useCallback(
    debounce((newContent) => {
      if (socket) socket.emit('text_update', { room_id: roomId, content: newContent });
    }, 300),
    [roomId]
  );

  const handleChange = (e) => {
    const val = e.target.value;
    setContent(val);
    debouncedTyping();
    debouncedTextUpdate(val);
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

  if (error) {
    return (
      <div className="h-screen bg-[#0e1111] flex items-center justify-center">
        <div className="bg-red-500/10 text-red-500 p-8 rounded-2xl flex flex-col items-center">
          <AlertTriangle size={32} className="mb-4" />
          <h2 className="text-xl">{error}</h2>
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

  const activeTyping = Object.keys(typingUsers).filter(sid => sid !== mySid).map(sid => users[sid]?.name);

  return (
    <div className="h-screen flex flex-col bg-[#0e1111] overflow-hidden">
      <div className="h-16 border-b border-gray-800 bg-[#151818] flex items-center justify-between px-6 shrink-0 relative z-10 shadow-sm">
        <div className="flex items-center space-x-4">
          <a href="/" className="text-xl font-bold font-mono tracking-wider text-gray-200 hover:text-white transition-colors">PAD:{roomId}</a>
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
          value={content}
          onChange={handleChange}
          autoFocus
          spellCheck={false}
          className="w-full h-full bg-transparent text-gray-200 text-lg leading-relaxed outline-none resize-none placeholder-gray-600 font-sans custom-scrollbar disabled:opacity-50"
          placeholder="Start typing..."
        />
      </div>
    </div>
  );
}
