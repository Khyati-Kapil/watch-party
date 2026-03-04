import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import YouTube from "react-youtube";

const socket = io("http://localhost:5000");

function App() {

  const [roomId, setRoomId] = useState("");
  const [username, setUsername] = useState("");
  const [participants, setParticipants] = useState<any[]>([]);
  const [videoId, setVideoId] = useState("dQw4w9WgXcQ");

  const playerRef = useRef<any>(null);

  const joinRoom = () => {
    socket.emit("join_room", { roomId, username });
  };

  const onReady = (event: any) => {
    playerRef.current = event.target;
  };

  const onStateChange = (event: any) => {

    if (!roomId) return;

    if (event.data === 1) {
      socket.emit("play", { roomId });
    }

    if (event.data === 2) {
      socket.emit("pause", { roomId });
    }

  };

  useEffect(() => {

    socket.on("user_joined", (data) => {
      setParticipants(data.participants);
    });

    socket.on("sync_state", (state) => {

      if (!playerRef.current) return;

      playerRef.current.seekTo(state.currentTime);

      if (state.playState === "playing") {
        playerRef.current.playVideo();
      } else {
        playerRef.current.pauseVideo();
      }

      if (state.videoId) {
        setVideoId(state.videoId);
      }

    });

    return () => {
      socket.off("user_joined");
      socket.off("sync_state");
    };

  }, []);

  return (
    <div style={{ padding: "40px" }}>

      <h1>YouTube Watch Party</h1>

      <input
        placeholder="Room ID"
        onChange={(e) => setRoomId(e.target.value)}
      />

      <input
        placeholder="Username"
        onChange={(e) => setUsername(e.target.value)}
      />

      <button onClick={joinRoom}>Join Room</button>

      <h2>Participants</h2>

      {participants.map((p) => (
        <div key={p.socketId}>
          {p.username} - {p.role}
        </div>
      ))}

      <div style={{ marginTop: "30px" }}>

        <YouTube
          videoId={videoId}
          onReady={onReady}
          onStateChange={onStateChange}
        />

      </div>

    </div>
  );
}

export default App;