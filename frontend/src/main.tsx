import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { io } from "socket.io-client";
const socket = io("http://localhost:5000");
socket.on("connect", () => {
  console.log("Connected to server:", socket.id);
});
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
