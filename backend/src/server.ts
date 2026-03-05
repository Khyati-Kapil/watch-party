import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import ytSearch from "yt-search";

import { RoomManager } from "./rooms/RoomManager";
import { Participant } from "./rooms/Participant";
import { Role } from "./rooms/Participant";

dotenv.config();

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN ?? "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins.includes("*") ? "*" : allowedOrigins
}));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins.includes("*") ? "*" : allowedOrigins
  }
});

const roomManager = new RoomManager();

const YT_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

function extractYouTubeVideoId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;
  if (YT_ID_REGEX.test(raw)) return raw;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    const v = url.searchParams.get("v");
    if (v && YT_ID_REGEX.test(v)) return v;

    const parts = url.pathname.split("/").filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      if (YT_ID_REGEX.test(parts[i])) {
        return parts[i];
      }
    }
  } catch {
    return null;
  }

  const match = raw.match(/([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

app.get("/", (req, res) => {
  res.send("Watch Party Server Running 🚀");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION ?? "1.0.0"
  });
});

app.get("/api/search-youtube", async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) {
      res.status(400).json({ error: "query_required" });
      return;
    }

    const result = await ytSearch(q);
    const videos = result.videos.slice(0, 8).map((video: any) => ({
      videoId: video.videoId,
      title: video.title,
      channel: video.author.name,
      duration: video.timestamp,
      thumbnail: video.thumbnail
    }));

    res.json({ videos });
  } catch (error) {
    console.error("YouTube search failed:", error);
    res.status(500).json({ error: "search_failed" });
  }
});

io.on("connection", (socket) => {

  console.log("User connected:", socket.id);

  const emitSyncState = (
    roomId: string,
    sourceSocketId: string,
    reason: "play" | "pause" | "seek" | "change_video" | "progress" | "manual_sync",
    broadcastToSource = true
  ) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const payload = {
      ...room.getState(),
      sourceSocketId,
      reason,
      serverTimeMs: Date.now()
    };

    if (broadcastToSource) {
      io.to(roomId).emit("sync_state", payload);
      return;
    }

    socket.to(roomId).emit("sync_state", payload);
  };

  const leaveRoom = (roomId?: string) => {
    if (!roomId) return;

    const room = roomManager.getRoom(roomId);
    if (!room || !room.hasParticipant(socket.id)) return;

    const { removed, newHost } = room.removeParticipant(socket.id);
    if (!removed) return;

    socket.leave(roomId);
    socket.data.roomId = undefined;

    io.to(roomId).emit("user_left", {
      username: removed.username,
      userId: removed.socketId,
      participants: room.getParticipants()
    });

    if (newHost) {
      io.to(roomId).emit("role_assigned", {
        userId: newHost.socketId,
        username: newHost.username,
        role: newHost.role,
        participants: room.getParticipants()
      });
    }

    if (room.isEmpty()) {
      roomManager.deleteRoom(roomId);
    }
  };

  socket.on("join_room", ({ roomId, username }) => {
    if (!roomId || !username) {
      socket.emit("error_message", { message: "roomId and username are required" });
      return;
    }
    leaveRoom(socket.data.roomId as string | undefined);

    let room = roomManager.getRoom(roomId);
    const role: Role = room ? "participant" : "host";

    const user = new Participant(socket.id, username, role);

    if (!room) {
      room = roomManager.createRoom(roomId, user);
    } else {
      room.addParticipant(user);
    }

    socket.join(roomId);
    socket.data.roomId = roomId;

    socket.emit("joined_room", {
      roomId,
      userId: socket.id,
      role,
      participants: room.getParticipants(),
      state: room.getState(),
      chatHistory: room.getChatMessages()
    });

    io.to(roomId).emit("user_joined", {
      username,
      userId: socket.id,
      role,
      participants: room.getParticipants()
    });

  });

  socket.on("play", ({ roomId, currentTime }) => {

    const room = roomManager.getRoom(roomId);
    if (!room) return;
    if (!room.canControlPlayback(socket.id)) {
      socket.emit("error_message", { message: "permission_denied: play requires host/moderator" });
      return;
    }

    if (typeof currentTime === "number") {
      room.setCurrentTime(currentTime);
    }
    room.play();

    emitSyncState(roomId, socket.id, "play");

  });

  socket.on("pause", ({ roomId, currentTime }) => {

    const room = roomManager.getRoom(roomId);
    if (!room) return;
    if (!room.canControlPlayback(socket.id)) {
      socket.emit("error_message", { message: "permission_denied: pause requires host/moderator" });
      return;
    }

    if (typeof currentTime === "number") {
      room.setCurrentTime(currentTime);
    }
    room.pause();

    emitSyncState(roomId, socket.id, "pause");

  });

  socket.on("seek", ({ roomId, time }) => {

    const room = roomManager.getRoom(roomId);
    if (!room) return;
    if (!room.canControlPlayback(socket.id)) {
      socket.emit("error_message", { message: "permission_denied: seek requires host/moderator" });
      return;
    }
    if (typeof time !== "number" || Number.isNaN(time) || time < 0) {
      socket.emit("error_message", { message: "invalid_seek_time" });
      return;
    }

    room.seek(time);

    emitSyncState(roomId, socket.id, "seek");

  });

  socket.on("change_video", ({ roomId, videoId }) => {

    const room = roomManager.getRoom(roomId);
    if (!room) return;
    if (!room.canControlPlayback(socket.id)) {
      socket.emit("error_message", { message: "permission_denied: change_video requires host/moderator" });
      return;
    }
    const parsedVideoId = extractYouTubeVideoId(videoId);
    if (!parsedVideoId) {
      socket.emit("error_message", { message: "invalid_video_id" });
      return;
    }

    room.changeVideo(parsedVideoId);

    emitSyncState(roomId, socket.id, "change_video");

  });

  socket.on("progress", ({ roomId, currentTime }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    if (!room.canControlPlayback(socket.id)) return;
    if (typeof currentTime !== "number" || Number.isNaN(currentTime) || currentTime < 0) return;

    const previousTime = room.getState().currentTime;
    room.setCurrentTime(currentTime);
    if (Math.abs(currentTime - previousTime) < 0.8) {
      return;
    }

    emitSyncState(roomId, socket.id, "progress", false);
  });

  socket.on("request_sync", ({ roomId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    if (!room.hasParticipant(socket.id)) return;

    emitSyncState(roomId, "server", "manual_sync", true);
  });

  socket.on("assign_role", ({ roomId, userId, role }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    if (role !== "moderator" && role !== "participant") {
      socket.emit("error_message", { message: "invalid_role: only moderator/participant supported" });
      return;
    }

    const result = room.assignRole(socket.id, userId, role);
    if (!result.ok) {
      socket.emit("error_message", { message: result.reason });
      return;
    }

    io.to(roomId).emit("role_assigned", {
      userId: result.participant.socketId,
      username: result.participant.username,
      role: result.participant.role,
      participants: room.getParticipants()
    });
  });

  socket.on("remove_participant", ({ roomId, userId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    if (!room.canRemoveParticipants(socket.id)) {
      socket.emit("error_message", { message: "permission_denied: only host can remove participants" });
      return;
    }

    if (!room.hasParticipant(userId)) {
      socket.emit("error_message", { message: "participant_not_found" });
      return;
    }
    if (userId === socket.id) {
      socket.emit("error_message", { message: "host_cannot_remove_self_use_leave_or_transfer" });
      return;
    }

    const { removed, newHost } = room.removeParticipant(userId);
    if (!removed) return;

    const targetSocket = io.sockets.sockets.get(userId);
    if (targetSocket) {
      targetSocket.leave(roomId);
      targetSocket.data.roomId = undefined;
      targetSocket.emit("participant_removed", { roomId, userId });
    }

    io.to(roomId).emit("participant_removed", {
      userId,
      participants: room.getParticipants()
    });

    if (newHost) {
      io.to(roomId).emit("role_assigned", {
        userId: newHost.socketId,
        username: newHost.username,
        role: newHost.role,
        participants: room.getParticipants()
      });
    }

    if (room.isEmpty()) {
      roomManager.deleteRoom(roomId);
    }
  });

  socket.on("transfer_host", ({ roomId, userId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    if (!userId || typeof userId !== "string") {
      socket.emit("error_message", { message: "participant_not_found" });
      return;
    }

    const result = room.transferHost(socket.id, userId);
    if (!result.ok) {
      socket.emit("error_message", { message: result.reason });
      return;
    }

    io.to(roomId).emit("role_assigned", {
      userId: result.previousHost.socketId,
      username: result.previousHost.username,
      role: result.previousHost.role,
      participants: room.getParticipants()
    });

    io.to(roomId).emit("role_assigned", {
      userId: result.newHost.socketId,
      username: result.newHost.username,
      role: result.newHost.role,
      participants: room.getParticipants()
    });
  });

  socket.on("send_message", ({ roomId, text }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const sender = room.getParticipant(socket.id);
    if (!sender) {
      socket.emit("error_message", { message: "not_in_room" });
      return;
    }

    if (typeof text !== "string" || !text.trim()) {
      socket.emit("error_message", { message: "message_cannot_be_empty" });
      return;
    }

    const trimmed = text.trim();
    if (trimmed.length > 500) {
      socket.emit("error_message", { message: "message_too_long_max_500_chars" });
      return;
    }

    const message = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: sender.socketId,
      username: sender.username,
      role: sender.role,
      text: trimmed,
      timestamp: new Date().toISOString()
    };

    room.addChatMessage(message);
    io.to(roomId).emit("message_received", message);
  });

  socket.on("leave_room", ({ roomId }) => {
    leaveRoom(roomId);
  });

  socket.on("disconnect", () => {

    console.log("User disconnected:", socket.id);
    leaveRoom((socket.data.roomId as string | undefined) ?? roomManager.findRoomBySocketId(socket.id)?.roomId);

  });

});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
