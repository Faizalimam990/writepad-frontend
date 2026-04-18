import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Copy, CheckCircle2, AlertTriangle, Download } from 'lucide-react';
import debounce from 'lodash.debounce';
import toast from 'react-hot-toast';

let socket;

export default function Pad() {
  const { id: roomId } = useParams();
  const navigate = useNavigate();
  
  const [content, setContent] = useState('');
  const [users, setUsers] = useState({});
  const [mySid, setMySid] = useState('');
  const [typingUsers, setTypingUsers] = useState({});
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    socket = io('http://localhost:5000');

    socket.on('connect', () => {
      socket.emit('join_pad', { room_id: roomId });
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
      setUsers(prev => {
        const next = { ...prev };
        if (next[sid]) toast(`${next[sid].name} left`, { icon: '🚪', duration: 2000 });
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

    return () => {
      socket.disconnect();
    };
  }, [roomId, navigate]);

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
