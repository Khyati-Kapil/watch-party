import { useEffect, useMemo, useRef, useState } from "react";
import YouTube from "react-youtube";
import "./App.css";
import { socket } from "./socket";

type Role = "host" | "moderator" | "participant";
type SyncReason = "play" | "pause" | "seek" | "change_video" | "progress";

type Participant = {
  socketId: string;
  username: string;
  role: Role;
};

type SyncState = {
  videoId: string;
  playState: "playing" | "paused";
  currentTime: number;
  sourceSocketId?: string;
  reason?: SyncReason;
};

const SESSION_KEY = "watch_party_session";

function extractYouTubeVideoId(input: string): string | null {
  if (!input) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;

  try {
    const url = new URL(input);
    const v = url.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

    const pathParts = url.pathname.split("/").filter(Boolean);
    const maybeId = pathParts[pathParts.length - 1];
    if (maybeId && /^[a-zA-Z0-9_-]{11}$/.test(maybeId)) return maybeId;
  } catch {
    return null;
  }

  return null;
}

function App() {
  const [roomInput, setRoomInput] = useState("");
  const [username, setUsername] = useState("");
  const [joinedRoomId, setJoinedRoomId] = useState("");
  const [myUserId, setMyUserId] = useState("");
  const [myRole, setMyRole] = useState<Role>("participant");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [videoId, setVideoId] = useState("dQw4w9WgXcQ");
  const [videoInput, setVideoInput] = useState("dQw4w9WgXcQ");
  const [seekInput, setSeekInput] = useState("0");
  const [status, setStatus] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);

  const playerRef = useRef<any>(null);
  const suppressOutgoingStateRef = useRef(false);
  const suppressResetTimerRef = useRef<number | null>(null);
  const myUserIdRef = useRef("");
  const joinedRoomIdRef = useRef("");
  const usernameRef = useRef("");
  const canControlPlaybackRef = useRef(false);
  const isPlayingRef = useRef(false);
  const lastSyncedTimeRef = useRef(0);
  const bufferingStartTimeRef = useRef<number | null>(null);
  const pendingJoinNameRef = useRef("");

  const canControlPlayback = useMemo(
    () => myRole === "host" || myRole === "moderator",
    [myRole]
  );
  const isHost = myRole === "host";

  useEffect(() => {
    myUserIdRef.current = myUserId;
  }, [myUserId]);

  useEffect(() => {
    joinedRoomIdRef.current = joinedRoomId;
  }, [joinedRoomId]);

  useEffect(() => {
    usernameRef.current = username;
  }, [username]);

  useEffect(() => {
    canControlPlaybackRef.current = canControlPlayback;
  }, [canControlPlayback]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const getPlayerTime = () => {
    if (!playerRef.current) return 0;
    const current = Number(playerRef.current.getCurrentTime?.() ?? 0);
    return Number.isFinite(current) && current >= 0 ? current : 0;
  };

  const persistSession = (roomId: string, name: string) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ roomId, username: name }));
  };

  const clearSession = () => {
    localStorage.removeItem(SESSION_KEY);
  };

  const joinRoom = () => {
    const roomId = roomInput.trim();
    const name = username.trim();

    if (!roomId || !name) {
      setStatus("Room ID and username are required.");
      return;
    }

    pendingJoinNameRef.current = name;
    socket.emit("join_room", { roomId, username: name });
  };

  const resetJoinedState = (message: string) => {
    setJoinedRoomId("");
    setMyUserId("");
    setMyRole("participant");
    setParticipants([]);
    setIsPlaying(false);
    setStatus(message);
    pendingJoinNameRef.current = "";
    clearSession();
  };

  const leaveRoom = () => {
    if (!joinedRoomIdRef.current) return;
    socket.emit("leave_room", { roomId: joinedRoomIdRef.current });
    resetJoinedState("Left room.");
  };

  const onReady = (event: any) => {
    playerRef.current = event.target;
  };

  const applyRemoteSync = (state: SyncState) => {
    if (!playerRef.current) return;

    suppressOutgoingStateRef.current = true;
    playerRef.current.seekTo(state.currentTime, true);

    if (state.playState === "playing") {
      playerRef.current.playVideo();
      setIsPlaying(true);
    } else {
      playerRef.current.pauseVideo();
      setIsPlaying(false);
    }

    lastSyncedTimeRef.current = state.currentTime;

    if (suppressResetTimerRef.current !== null) {
      window.clearTimeout(suppressResetTimerRef.current);
    }

    suppressResetTimerRef.current = window.setTimeout(() => {
      suppressOutgoingStateRef.current = false;
    }, 350);
  };

  const onStateChange = (event: any) => {
    if (!joinedRoomIdRef.current || !canControlPlaybackRef.current || suppressOutgoingStateRef.current) return;

    const currentTime = getPlayerTime();

    if (event.data === 3) {
      bufferingStartTimeRef.current = currentTime;
      return;
    }

    const maybeBufferedTime = bufferingStartTimeRef.current;
    if (maybeBufferedTime !== null) {
      const drift = Math.abs(currentTime - maybeBufferedTime);
      if (drift >= 1.25) {
        socket.emit("seek", { roomId: joinedRoomIdRef.current, time: currentTime });
        lastSyncedTimeRef.current = currentTime;
      }
      bufferingStartTimeRef.current = null;
    }

    if (event.data === 1) {
      setIsPlaying(true);
      socket.emit("play", { roomId: joinedRoomIdRef.current, currentTime });
      return;
    }

    if (event.data === 2) {
      setIsPlaying(false);
      socket.emit("pause", { roomId: joinedRoomIdRef.current, currentTime });
    }
  };

  const sendSeek = () => {
    if (!joinedRoomIdRef.current || !canControlPlaybackRef.current) return;
    const time = Number(seekInput);
    if (Number.isNaN(time) || time < 0) {
      setStatus("Seek value must be a non-negative number.");
      return;
    }

    if (Math.abs(time - lastSyncedTimeRef.current) < 0.5) {
      return;
    }

    socket.emit("seek", { roomId: joinedRoomIdRef.current, time });
    lastSyncedTimeRef.current = time;
  };

  const sendVideoChange = () => {
    if (!joinedRoomIdRef.current || !canControlPlaybackRef.current) return;
    const parsed = extractYouTubeVideoId(videoInput.trim());
    if (!parsed) {
      setStatus("Enter a valid YouTube URL or 11-character video ID.");
      return;
    }
    socket.emit("change_video", { roomId: joinedRoomIdRef.current, videoId: parsed });
  };

  const assignRole = (userId: string, role: "moderator" | "participant") => {
    if (!joinedRoomIdRef.current || !isHost) return;
    socket.emit("assign_role", { roomId: joinedRoomIdRef.current, userId, role });
  };

  const removeParticipant = (userId: string) => {
    if (!joinedRoomIdRef.current || !isHost) return;
    socket.emit("remove_participant", { roomId: joinedRoomIdRef.current, userId });
  };

  useEffect(() => {
    const progressInterval = window.setInterval(() => {
      if (!joinedRoomIdRef.current || !canControlPlaybackRef.current || !isPlayingRef.current) {
        return;
      }

      const currentTime = getPlayerTime();
      socket.emit("progress", {
        roomId: joinedRoomIdRef.current,
        currentTime
      });
    }, 2000);

    return () => {
      window.clearInterval(progressInterval);
    };
  }, []);

  useEffect(() => {
    socket.on("connect", () => {
      setStatus("Connected to server.");

      const rawSession = localStorage.getItem(SESSION_KEY);
      if (!rawSession || joinedRoomIdRef.current) return;

      try {
        const saved = JSON.parse(rawSession) as { roomId?: string; username?: string };
        if (!saved.roomId || !saved.username) return;

        setRoomInput(saved.roomId);
        setUsername(saved.username);
        socket.emit("join_room", { roomId: saved.roomId, username: saved.username });
        setStatus(`Rejoining room ${saved.roomId}...`);
      } catch {
        clearSession();
      }
    });

    socket.on("disconnect", () => {
      setStatus("Disconnected from server. Waiting to reconnect...");
    });

    socket.on(
      "joined_room",
      (data: {
        roomId: string;
        userId: string;
        role: Role;
        participants: Participant[];
        state: SyncState;
      }) => {
        setJoinedRoomId(data.roomId);
        setMyUserId(data.userId);
        setMyRole(data.role);
        setParticipants(data.participants);
        setStatus(`Joined room ${data.roomId} as ${data.role}.`);
        const persistedName = pendingJoinNameRef.current || usernameRef.current;
        persistSession(data.roomId, persistedName);

        if (data.state.videoId) {
          setVideoId(data.state.videoId);
          setVideoInput(data.state.videoId);
        }

        applyRemoteSync(data.state);
      }
    );

    socket.on("user_joined", (data: { participants: Participant[] }) => {
      setParticipants(data.participants);
    });

    socket.on("user_left", (data: { participants: Participant[] }) => {
      setParticipants(data.participants);
    });

    socket.on(
      "role_assigned",
      (data: {
        userId: string;
        role: Role;
        participants: Participant[];
      }) => {
        setParticipants(data.participants);
        if (data.userId === myUserIdRef.current) {
          setMyRole(data.role);
        }
      }
    );

    socket.on(
      "participant_removed",
      (data: {
        userId: string;
        participants?: Participant[];
      }) => {
        if (data.userId === myUserIdRef.current) {
          resetJoinedState("You were removed from the room by host.");
          return;
        }

        if (data.participants) {
          setParticipants(data.participants);
        }
      }
    );

    socket.on("error_message", (data: { message: string }) => {
      setStatus(`Error: ${data.message}`);
    });

    socket.on("sync_state", (state: SyncState) => {
      if (state.sourceSocketId && state.sourceSocketId === myUserIdRef.current) {
        return;
      }

      if (state.videoId) {
        setVideoId(state.videoId);
        setVideoInput(state.videoId);
      }
      applyRemoteSync(state);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("joined_room");
      socket.off("user_joined");
      socket.off("user_left");
      socket.off("role_assigned");
      socket.off("participant_removed");
      socket.off("error_message");
      socket.off("sync_state");
      if (suppressResetTimerRef.current !== null) {
        window.clearTimeout(suppressResetTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="app-shell">
      <h1>YouTube Watch Party</h1>

      <div className="panel">
        <input
          value={roomInput}
          placeholder="Room ID"
          onChange={(e) => setRoomInput(e.target.value)}
          disabled={Boolean(joinedRoomId)}
        />
        <input
          value={username}
          placeholder="Username"
          onChange={(e) => setUsername(e.target.value)}
          disabled={Boolean(joinedRoomId)}
        />
        {!joinedRoomId ? (
          <button onClick={joinRoom}>Join Room</button>
        ) : (
          <button onClick={leaveRoom}>Leave Room</button>
        )}
      </div>

      <p className="status-line">
        Room: <strong>{joinedRoomId || "Not joined"}</strong> | Role: <strong>{joinedRoomId ? myRole : "-"}</strong>
      </p>
      {status ? <p className="status-message">{status}</p> : null}

      <div className="panel controls">
        <input
          value={videoInput}
          onChange={(e) => setVideoInput(e.target.value)}
          placeholder="YouTube URL or video ID"
          disabled={!joinedRoomId || !canControlPlayback}
        />
        <button onClick={sendVideoChange} disabled={!joinedRoomId || !canControlPlayback}>
          Change Video
        </button>

        <input
          value={seekInput}
          onChange={(e) => setSeekInput(e.target.value)}
          placeholder="Seek time (seconds)"
          disabled={!joinedRoomId || !canControlPlayback}
        />
        <button onClick={sendSeek} disabled={!joinedRoomId || !canControlPlayback}>
          Seek
        </button>
      </div>

      <div className={`player-wrap ${canControlPlayback ? "" : "viewer-mode"}`}>
        <YouTube
          videoId={videoId}
          onReady={onReady}
          onStateChange={onStateChange}
          opts={{
            width: "100%",
            height: "420",
            playerVars: {
              controls: canControlPlayback ? 1 : 0,
              rel: 0
            }
          }}
        />
      </div>

      <h2>Participants</h2>
      <div className="participants">
        {participants.map((p) => (
          <div className="participant-row" key={p.socketId}>
            <span>
              {p.username} ({p.role})
              {p.socketId === myUserId ? " - you" : ""}
            </span>

            {isHost && p.socketId !== myUserId ? (
              <div className="host-actions">
                {p.role !== "moderator" ? (
                  <button onClick={() => assignRole(p.socketId, "moderator")}>Make Moderator</button>
                ) : (
                  <button onClick={() => assignRole(p.socketId, "participant")}>Make Participant</button>
                )}
                <button onClick={() => removeParticipant(p.socketId)}>Remove</button>
              </div>
            ) : null}
          </div>
        ))}

        {participants.length === 0 ? (
          <div className="participant-row">
            <span>No participants yet.</span>
          </div>
        ) : null}
      </div>

      {!canControlPlayback && joinedRoomId ? (
        <p className="hint">You are in view-only mode. Host or moderator controls playback.</p>
      ) : null}
    </div>
  );
}

export default App;
