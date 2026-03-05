import { useEffect, useMemo, useRef, useState } from "react";
import YouTube from "react-youtube";
import "./App.css";
import { socket } from "./socket";

type Role = "host" | "moderator" | "participant";
type SyncReason = "play" | "pause" | "seek" | "change_video" | "progress" | "manual_sync";

type Participant = {
  socketId: string;
  username: string;
  role: Role;
};

type ChatMessage = {
  id: string;
  userId: string;
  username: string;
  role: Role;
  text: string;
  timestamp: string;
};

type SearchVideo = {
  videoId: string;
  title: string;
  channel: string;
  duration: string;
  thumbnail: string;
};

type SyncState = {
  videoId: string;
  playState: "playing" | "paused";
  currentTime: number;
  sourceSocketId?: string;
  reason?: SyncReason;
  serverTimeMs?: number;
};

const SESSION_KEY = "watch_party_session";
const API_BASE_URL = (import.meta.env.VITE_API_URL ?? import.meta.env.VITE_SOCKET_URL ?? "http://localhost:5000").replace(/\/$/, "");

function generateRoomCode(length = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function setRoomInUrl(roomId?: string) {
  const url = new URL(window.location.href);
  if (roomId) {
    url.searchParams.set("room", roomId);
  } else {
    url.searchParams.delete("room");
  }
  window.history.replaceState({}, "", url.toString());
}

function roleLabel(role: Role) {
  if (role === "host") return "Host";
  if (role === "moderator") return "Mod";
  return "Viewer";
}

function App() {
  const [connectionStatus, setConnectionStatus] = useState(socket.connected ? "connected" : "connecting");
  const [roomInput, setRoomInput] = useState("");
  const [username, setUsername] = useState("");
  const [joinedRoomId, setJoinedRoomId] = useState("");
  const [myUserId, setMyUserId] = useState("");
  const [myRole, setMyRole] = useState<Role>("participant");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [videoId, setVideoId] = useState("dQw4w9WgXcQ");
  const [status, setStatus] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchVideo[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const playerRef = useRef<any>(null);
  const suppressOutgoingStateRef = useRef(false);
  const suppressResetTimerRef = useRef<number | null>(null);
  const myUserIdRef = useRef("");
  const joinedRoomIdRef = useRef("");
  const usernameRef = useRef("");
  const videoIdRef = useRef("dQw4w9WgXcQ");
  const canControlPlaybackRef = useRef(false);
  const isPlayingRef = useRef(false);
  const lastSyncedTimeRef = useRef(0);
  const bufferingStartTimeRef = useRef<number | null>(null);
  const pendingJoinNameRef = useRef("");
  const pendingSyncStateRef = useRef<SyncState | null>(null);

  const canControlPlayback = useMemo(
    () => myRole === "host" || myRole === "moderator",
    [myRole]
  );
  const isHost = myRole === "host";
  const showSearchResults = isSearching || searchResults.length > 0;

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
    videoIdRef.current = videoId;
  }, [videoId]);

  useEffect(() => {
    canControlPlaybackRef.current = canControlPlayback;
  }, [canControlPlayback]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const safePlayerCall = (fn: () => void) => {
    try {
      fn();
    } catch {
    }
  };

  const getCurrentTimeSafe = () => {
    if (!playerRef.current) return 0;
    try {
      const current = Number(playerRef.current.getCurrentTime?.() ?? 0);
      return Number.isFinite(current) && current >= 0 ? current : 0;
    } catch {
      return 0;
    }
  };

  const persistSession = (roomId: string, name: string) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ roomId, username: name }));
  };

  const clearSession = () => {
    localStorage.removeItem(SESSION_KEY);
  };

  const updateParticipants = (list: Participant[]) => {
    setParticipants(list);
    if (myUserIdRef.current) {
      const me = list.find((p) => p.socketId === myUserIdRef.current);
      if (me) {
        setMyRole(me.role);
      }
    }
  };

  const resetJoinedState = (message: string) => {
    setJoinedRoomId("");
    setMyUserId("");
    setMyRole("participant");
    setParticipants([]);
    setIsPlaying(false);
    setChatMessages([]);
    setChatInput("");
    setSearchResults([]);
    pendingSyncStateRef.current = null;
    setStatus(message);
    pendingJoinNameRef.current = "";
    setRoomInUrl(undefined);
    clearSession();
  };

  const joinRoom = () => {
    const roomId = roomInput.trim().toUpperCase();
    const name = username.trim();
    if (!roomId || !name) {
      setStatus("Room ID and username are required.");
      return;
    }
    pendingJoinNameRef.current = name;
    socket.emit("join_room", { roomId, username: name });
  };

  const createRoom = () => {
    const code = generateRoomCode();
    setRoomInput(code);
    setRoomInUrl(code);
    if (!username.trim()) {
      setStatus("Room code created. Enter username and click Join Room.");
      return;
    }
    pendingJoinNameRef.current = username.trim();
    socket.emit("join_room", { roomId: code, username: username.trim() });
  };

  const leaveRoom = () => {
    if (!joinedRoomIdRef.current) return;
    socket.emit("leave_room", { roomId: joinedRoomIdRef.current });
    resetJoinedState("Left room.");
  };

  const goBackToLanding = () => {
    if (joinedRoomIdRef.current) {
      socket.emit("leave_room", { roomId: joinedRoomIdRef.current });
    }
    resetJoinedState("");
  };

  const copyInviteLink = async () => {
    const roomId = joinedRoomIdRef.current || roomInput.trim();
    if (!roomId) {
      setStatus("Join or create a room first.");
      return;
    }
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Invite link copied.");
    } catch {
      setStatus(`Copy failed. Share this URL: ${url}`);
    }
  };

  const onReady = (event: any) => {
    playerRef.current = event.target;
    if (joinedRoomIdRef.current) {
      socket.emit("request_sync", { roomId: joinedRoomIdRef.current });
    }
    if (pendingSyncStateRef.current) {
      const pending = pendingSyncStateRef.current;
      pendingSyncStateRef.current = null;
      applyRemoteSync(pending);
    }
  };

  const onPlayerError = (event: any) => {
    const code = event?.data;
    if (code === 2 || code === 5 || code === 100 || code === 101 || code === 150) {
      setStatus(`YouTube cannot play this video (error ${code}). Try another video.`);
    }
  };

  const applyRemoteSync = (state: SyncState) => {
    if (!playerRef.current) {
      pendingSyncStateRef.current = state;
      return;
    }

    const transitDelaySeconds = state.serverTimeMs
      ? Math.max(0, (Date.now() - state.serverTimeMs) / 1000)
      : 0;
    const targetTime = state.playState === "playing"
      ? state.currentTime + transitDelaySeconds
      : state.currentTime;

    const localTime = getCurrentTimeSafe();
    const drift = Math.abs(localTime - targetTime);
    const isProgressCorrection = state.reason === "progress";

    if (isProgressCorrection && drift < 0.35) {
      return;
    }

    suppressOutgoingStateRef.current = true;

    if (drift > 0.25 || state.reason === "seek" || state.reason === "change_video") {
      safePlayerCall(() => playerRef.current.seekTo(targetTime, true));
    }

    if (state.playState === "playing") {
      safePlayerCall(() => playerRef.current.playVideo());
      setIsPlaying(true);
    } else {
      safePlayerCall(() => playerRef.current.pauseVideo());
      setIsPlaying(false);
    }

    lastSyncedTimeRef.current = targetTime;

    if (suppressResetTimerRef.current !== null) {
      window.clearTimeout(suppressResetTimerRef.current);
    }

    suppressResetTimerRef.current = window.setTimeout(() => {
      suppressOutgoingStateRef.current = false;
    }, 350);
  };

  const onStateChange = (event: any) => {
    if (!joinedRoomIdRef.current || !canControlPlaybackRef.current || suppressOutgoingStateRef.current) return;

    const currentTime = getCurrentTimeSafe();

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

  const playNow = () => {
    if (!joinedRoomIdRef.current || !canControlPlaybackRef.current) return;
    socket.emit("play", { roomId: joinedRoomIdRef.current, currentTime: getCurrentTimeSafe() });
  };

  const pauseNow = () => {
    if (!joinedRoomIdRef.current || !canControlPlaybackRef.current) return;
    socket.emit("pause", { roomId: joinedRoomIdRef.current, currentTime: getCurrentTimeSafe() });
  };

  const searchVideos = async () => {
    if (!canControlPlaybackRef.current) return;
    const q = searchQuery.trim();
    if (!q) {
      setStatus("Enter a search query.");
      return;
    }

    try {
      setIsSearching(true);
      const response = await fetch(`${API_BASE_URL}/api/search-youtube?q=${encodeURIComponent(q)}`);
      if (!response.ok) throw new Error("search_failed");
      const data = await response.json();
      const videos = Array.isArray(data.videos) ? data.videos : [];
      setSearchResults(videos);
      if (videos.length === 0) {
        setStatus("No results found.");
      }
    } catch {
      setStatus("Search failed. Try again.");
    } finally {
      setIsSearching(false);
    }
  };

  const watchFromSearch = (videoIdToWatch: string) => {
    if (!joinedRoomIdRef.current || !canControlPlaybackRef.current) return;
    socket.emit("change_video", { roomId: joinedRoomIdRef.current, videoId: videoIdToWatch });
    setSearchResults([]);
    setSearchQuery("");
    setStatus("Changing video from search result...");
  };

  const assignRole = (userId: string, role: "moderator" | "participant") => {
    if (!joinedRoomIdRef.current || !isHost) return;
    socket.emit("assign_role", { roomId: joinedRoomIdRef.current, userId, role });
  };

  const transferHost = (userId: string) => {
    if (!joinedRoomIdRef.current || !isHost) return;
    socket.emit("transfer_host", { roomId: joinedRoomIdRef.current, userId });
  };

  const removeParticipant = (userId: string) => {
    if (!joinedRoomIdRef.current || !isHost) return;
    socket.emit("remove_participant", { roomId: joinedRoomIdRef.current, userId });
  };

  const sendMessage = () => {
    if (!joinedRoomIdRef.current) return;
    const text = chatInput.trim();
    if (!text) return;
    socket.emit("send_message", { roomId: joinedRoomIdRef.current, text });
    setChatInput("");
  };

  useEffect(() => {
    const progressInterval = window.setInterval(() => {
      if (!joinedRoomIdRef.current || !canControlPlaybackRef.current || !isPlayingRef.current) return;
      socket.emit("progress", { roomId: joinedRoomIdRef.current, currentTime: getCurrentTimeSafe() });
    }, 2000);

    return () => window.clearInterval(progressInterval);
  }, []);

  useEffect(() => {
    const roomFromUrl = new URL(window.location.href).searchParams.get("room");
    if (roomFromUrl) {
      setRoomInput(roomFromUrl.toUpperCase());
    }

    const rawSession = localStorage.getItem(SESSION_KEY);
    if (!rawSession) return;
    try {
      const saved = JSON.parse(rawSession) as { roomId?: string; username?: string };
      if (saved.roomId) setRoomInput(saved.roomId.toUpperCase());
      if (saved.username) setUsername(saved.username);
    } catch {
      clearSession();
    }
  }, []);

  useEffect(() => {
    socket.on("connect", () => {
      setConnectionStatus("connected");
      setStatus("Connected to server.");

      const rawSession = localStorage.getItem(SESSION_KEY);
      let roomToJoin: string | undefined = joinedRoomIdRef.current || undefined;
      let usernameToJoin: string | undefined = usernameRef.current || undefined;

      if (!roomToJoin || !usernameToJoin) {
        const roomFromUrl = new URL(window.location.href).searchParams.get("room")?.toUpperCase();
        if (roomFromUrl) {
          roomToJoin = roomFromUrl;
        }
      }

      if ((!roomToJoin || !usernameToJoin) && rawSession) {
        try {
          const saved = JSON.parse(rawSession) as { roomId?: string; username?: string };
          roomToJoin = roomToJoin || saved.roomId;
          usernameToJoin = usernameToJoin || saved.username;
        } catch {
          clearSession();
        }
      }

      if (roomToJoin && usernameToJoin) {
        socket.emit("join_room", { roomId: roomToJoin, username: usernameToJoin });
        setStatus(`Joining ${roomToJoin}...`);
      }
    });

    socket.on("disconnect", () => {
      setConnectionStatus("disconnected");
      setStatus("Disconnected from server. Waiting to reconnect...");
    });

    socket.on("connect_error", () => {
      setConnectionStatus("error");
      setStatus("Connection failed. Retrying...");
    });

    socket.on("joined_room", (data: {
      roomId: string;
      userId: string;
      role: Role;
      participants: Participant[];
      state: SyncState;
      chatHistory?: ChatMessage[];
    }) => {
      setJoinedRoomId(data.roomId);
      setMyUserId(data.userId);
      setMyRole(data.role);
      updateParticipants(data.participants);
      setStatus(`Joined room ${data.roomId} as ${data.role}.`);
      setRoomInput(data.roomId);
      setRoomInUrl(data.roomId);

      const persistedName = pendingJoinNameRef.current || usernameRef.current;
      persistSession(data.roomId, persistedName);
      setChatMessages(Array.isArray(data.chatHistory) ? data.chatHistory : []);

      if (data.state.videoId) {
        setVideoId(data.state.videoId);
      }
      applyRemoteSync(data.state);
    });

    socket.on("user_joined", (data: { participants: Participant[] }) => {
      updateParticipants(data.participants);
    });

    socket.on("user_left", (data: { participants: Participant[] }) => {
      updateParticipants(data.participants);
    });

    socket.on("role_assigned", (data: {
      userId: string;
      role: Role;
      participants: Participant[];
    }) => {
      updateParticipants(data.participants);
      if (data.userId === myUserIdRef.current) {
        setMyRole(data.role);
      }
    });

    socket.on("participant_removed", (data: {
      userId: string;
      participants?: Participant[];
    }) => {
      if (data.userId === myUserIdRef.current) {
        resetJoinedState("You were removed from the room by host.");
        return;
      }
      if (data.participants) {
        updateParticipants(data.participants);
      }
    });

    socket.on("error_message", (data: { message: string }) => {
      setStatus(`Error: ${data.message}`);
    });

    socket.on("sync_state", (state: SyncState) => {
      if (state.videoId && state.videoId !== videoIdRef.current) {
        setVideoId(state.videoId);
        pendingSyncStateRef.current = state;
        return;
      }
      applyRemoteSync(state);
    });

    socket.on("message_received", (message: ChatMessage) => {
      setChatMessages((prev) => [...prev, message].slice(-100));
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("connect_error");
      socket.off("joined_room");
      socket.off("user_joined");
      socket.off("user_left");
      socket.off("role_assigned");
      socket.off("participant_removed");
      socket.off("error_message");
      socket.off("sync_state");
      socket.off("message_received");
      if (suppressResetTimerRef.current !== null) {
        window.clearTimeout(suppressResetTimerRef.current);
      }
    };
  }, []);

  const orderedParticipants = [...participants].sort((a, b) => {
    const rank = { host: 0, moderator: 1, participant: 2 };
    return rank[a.role] - rank[b.role] || a.username.localeCompare(b.username);
  });

  if (!joinedRoomId) {
    return (
      <div className="landing-screen">
        <div className="landing-glow" />
        <div className="doodle doodle-star" />
        <div className="doodle doodle-zig" />
        <div className="doodle doodle-ring" />
        <div className="doodle doodle-dotgrid" />
        <main className="landing-content">
          <h1>
            Watch Together,
            <br />
            <span>In Perfect Sync</span>
          </h1>
          <p>
            Create a room, share the code, and watch YouTube videos with friends using synchronized playback and role-based controls.
          </p>

          <section className="landing-panels">
            <div className="party-card host-card">
              <h3>Host a Party</h3>
              <p>Create a room and become Host instantly. Invite others with a room code.</p>
              <label>Display Name</label>
              <input
                value={username}
                placeholder="Enter your name"
                onChange={(e) => setUsername(e.target.value)}
              />
              <button className="primary-action" onClick={createRoom}>Create Watch Party</button>
            </div>

            <div className="party-card join-card">
              <h3>Join a Room</h3>
              <p>Enter your name and room code shared by your friends.</p>
              <label>Display Name</label>
              <input
                value={username}
                placeholder="Enter your name"
                onChange={(e) => setUsername(e.target.value)}
              />
              <label>Room Code</label>
              <div className="join-row">
                <input
                  value={roomInput}
                  placeholder="ROOM CODE"
                  onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                />
                <button className="join-button" onClick={joinRoom}>Join</button>
              </div>
            </div>
          </section>

          <div className="feature-row">
            <span>Real-time sync</span>
            <span>Role-based controls</span>
            <span>Share via room code</span>
          </div>

          <p className={`status-text ${status.toLowerCase().startsWith("error") ? "error" : ""}`}>{status}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="room-screen">
      <div className="room-shell">
        <header className="room-topbar">
          <div>
            <h2>{joinedRoomId}</h2>
            <p>{connectionStatus} • {participants.length} watching • you are {roleLabel(myRole)}</p>
          </div>

          <div className="top-actions">
            <button className="ghost" onClick={goBackToLanding}>Back</button>
            <button className="ghost" onClick={copyInviteLink}>Copy Invite</button>
            <button className="danger" onClick={leaveRoom}>Leave</button>
          </div>
        </header>

        {status ? <p className={`room-status ${status.toLowerCase().startsWith("error") ? "error" : ""}`}>{status}</p> : null}

        <div className="room-layout">
          <section className="video-area">
            <div className={`search-panel ${showSearchResults ? "expanded" : "compact"}`}>
              <div className="search-row">
                <input
                  value={searchQuery}
                  onChange={(e) => {
                    const nextQuery = e.target.value;
                    setSearchQuery(nextQuery);
                    if (!nextQuery.trim()) {
                      setSearchResults([]);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      searchVideos();
                    }
                  }}
                  placeholder="Search YouTube videos"
                  disabled={!canControlPlayback}
                />
                <button className="ghost" onClick={searchVideos} disabled={!canControlPlayback || isSearching}>
                  {isSearching ? "Searching..." : "Search"}
                </button>
              </div>

              {showSearchResults ? (
                <div className="search-results">
                  {searchResults.map((video) => (
                    <div key={video.videoId} className="search-item">
                      <img src={video.thumbnail} alt={video.title} />
                      <div className="search-meta">
                        <strong>{video.title}</strong>
                        <span>{video.channel} • {video.duration}</span>
                      </div>
                      <button onClick={() => watchFromSearch(video.videoId)} disabled={!canControlPlayback}>
                        Watch
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="video-shell">
              <YouTube
                key={videoId}
                videoId={videoId}
                onReady={onReady}
                onError={onPlayerError}
                onStateChange={onStateChange}
                opts={{
                  width: "100%",
                  height: "520",
                  host: "https://www.youtube.com",
                  playerVars: {
                    enablejsapi: 1,
                    origin: window.location.origin,
                    controls: canControlPlayback ? 1 : 0,
                    rel: 0
                  }
                }}
              />
            </div>

            <div className="control-panel">
              <button onClick={playNow} disabled={!canControlPlayback}>Play</button>
              <button onClick={pauseNow} disabled={!canControlPlayback}>Pause</button>
              <p className="control-note">Use the YouTube scrub bar for seeking. Use search above to change video.</p>
            </div>
          </section>

          <aside className="sidebar">
            <div className="sidebar-head">
              <h3>People</h3>
              <span>{participants.length}</span>
            </div>

            <div className="people-list">
              {orderedParticipants.map((p) => (
                <div key={p.socketId} className="person-card">
                  <div className="person-info">
                    <strong>{p.username}{p.socketId === myUserId ? " (you)" : ""}</strong>
                    <span>{roleLabel(p.role)}</span>
                  </div>

                  {isHost && p.socketId !== myUserId ? (
                    <div className="person-actions">
                      {p.role !== "moderator" ? (
                        <button className="ghost" onClick={() => assignRole(p.socketId, "moderator")}>Make Mod</button>
                      ) : (
                        <button className="ghost" onClick={() => assignRole(p.socketId, "participant")}>Demote</button>
                      )}
                      <button className="ghost" onClick={() => transferHost(p.socketId)}>Make Host</button>
                      <button className="danger" onClick={() => removeParticipant(p.socketId)}>Remove</button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="chat-panel">
              <div className="chat-head">Chat</div>
              <div className="chat-list">
                {chatMessages.map((msg) => (
                  <div key={msg.id} className={`chat-item ${msg.userId === myUserId ? "mine" : ""}`}>
                    <div className="chat-meta">
                      <strong>{msg.username}</strong>
                      <span>{roleLabel(msg.role)}</span>
                    </div>
                    <p>{msg.text}</p>
                  </div>
                ))}
                {chatMessages.length === 0 ? (
                  <div className="chat-empty">No messages yet.</div>
                ) : null}
              </div>

              <div className="chat-compose">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Type a message..."
                />
                <button onClick={sendMessage}>Send</button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export default App;
