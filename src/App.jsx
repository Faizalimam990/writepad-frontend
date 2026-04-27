import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Pad from './pages/Pad'
import { Toaster } from 'react-hot-toast'

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-center" toastOptions={{ style: { background: '#222', color: '#fff', border: '1px solid #444' } }} />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/pad/:id" element={<Pad />} />
        <Route path="/:id" element={<Pad />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
