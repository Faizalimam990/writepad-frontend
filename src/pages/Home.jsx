import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, FileText, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { API_BASE_URL } from '../lib/config';

export default function Home() {
  const [isSecure, setIsSecure] = useState(false);
  const [pin, setPin] = useState('');
  const [joinId, setJoinId] = useState('');
  const [joinPin, setJoinPin] = useState('');
  const navigate = useNavigate();

  const handleCreate = async (e) => {
    e.preventDefault();
    if (isSecure && pin.length < 4) {
      toast.error('PIN must be at least 4 digits');
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_secure: isSecure, pin })
      });
      const data = await res.json();
      if (data.room_id) {
        navigate(`/pad/${data.room_id}`);
      } else {
        toast.error(data.error || 'Failed to create room');
      }
    } catch(err) {
      toast.error('Server connection error. Ensure backend is running.');
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!joinId) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/rooms/${joinId}`);
      if (!res.ok) {
        toast.error('Room not found');
        return;
      }
      const data = await res.json();
      
      if (data.is_secure) {
        const authRes = await fetch(`${API_BASE_URL}/api/rooms/${joinId}/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: joinPin })
        });
        if (!authRes.ok) {
          toast.error('Invalid PIN');
          return;
        }
      }
      
      if (data.user_count >= 20) {
        toast.error('Room is full (max 20)');
        return;
      }

      navigate(`/pad/${joinId}`);
    } catch(err) {
      toast.error('Error connecting to server.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-8">
        
        <div className="bg-[#151818] p-8 rounded-2xl border border-gray-800 shadow-2xl hover:border-gray-700 transition-colors">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 mb-6">
            <FileText size={24} />
          </div>
          <h2 className="text-2xl font-bold mb-2">Create a Pad</h2>
          <p className="text-gray-400 mb-8">Start a new real-time collaborative document.</p>
          
          <form onSubmit={handleCreate} className="space-y-6">
             <label className="flex items-center space-x-3 cursor-pointer group">
              <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${isSecure ? 'bg-blue-500 border-blue-500' : 'border-gray-600 group-hover:border-gray-400'}`}>
                {isSecure && <Lock size={12} className="text-white" />}
              </div>
              <input type="checkbox" checked={isSecure} onChange={(e) => setIsSecure(e.target.checked)} className="hidden" />
              <span className="text-gray-300 group-hover:text-white transition-colors">Secure with PIN</span>
             </label>

             {isSecure && (
               <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                 <input 
                   type="text" 
                   maxLength="6"
                   placeholder="Enter 4-6 digit PIN" 
                   className="w-full bg-[#1e2323] border border-gray-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-white placeholder-gray-500"
                   value={pin}
                   onChange={e => setPin(e.target.value)}
                 />
               </div>
             )}

             <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-3 px-4 font-medium transition-all flex items-center justify-center space-x-2">
               <span>Create Pad</span>
               <ArrowRight size={18} />
             </button>
          </form>
        </div>

        <div className="bg-[#151818] p-8 rounded-2xl border border-gray-800 shadow-2xl hover:border-gray-700 transition-colors">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-purple-500/10 text-purple-400 mb-6">
            <Lock size={24} />
          </div>
          <h2 className="text-2xl font-bold mb-2">Join a Pad</h2>
          <p className="text-gray-400 mb-8">Enter a Room ID to join an existing session.</p>

          <form onSubmit={handleJoin} className="space-y-4">
             <input 
               type="text" 
               placeholder="Room ID (e.g. x7y8z9)" 
               required
               className="w-full bg-[#1e2323] border border-gray-700 rounded-xl px-4 py-3 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all text-white placeholder-gray-500"
               value={joinId}
               onChange={e => setJoinId(e.target.value)}
             />
             <input 
               type="text" 
               placeholder="PIN (if secure)" 
               className="w-full bg-[#1e2323] border border-gray-700 rounded-xl px-4 py-3 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all text-white placeholder-gray-500"
               value={joinPin}
               onChange={e => setJoinPin(e.target.value)}
             />

             <button type="submit" className="w-full bg-purple-600 hover:bg-purple-500 text-white rounded-xl py-3 px-4 font-medium transition-all flex items-center justify-center space-x-2 mt-4">
               <span>Join Room</span>
               <ArrowRight size={18} />
             </button>
          </form>
        </div>

      </div>
    </div>
  )
}
