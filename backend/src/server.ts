import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

import { RoomManager } from "./rooms/RoomManager";
import { Participant } from "./rooms/Participant";
import { Role } from "./rooms/Participant";

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const roomManager = new RoomManager();

app.get("/", (req, res) => {
  res.send("Watch Party Server Running 🚀");
});

io.on("connection", (socket) => {

  console.log("User connected:", socket.id);

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

    // If this socket was already in another room, leave first.
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
      state: room.getState()
    });

    io.to(roomId).emit("user_joined", {
      username,
      userId: socket.id,
      role,
      participants: room.getParticipants()
    });

  });

  socket.on("play", ({ roomId }) => {

    const room = roomManager.getRoom(roomId);
    if (!room) return;
    if (!room.canControlPlayback(socket.id)) {
      socket.emit("error_message", { message: "permission_denied: play requires host/moderator" });
      return;
    }

    room.play();

    io.to(roomId).emit("sync_state", room.getState());

  });

  socket.on("pause", ({ roomId }) => {

    const room = roomManager.getRoom(roomId);
    if (!room) return;
    if (!room.canControlPlayback(socket.id)) {
      socket.emit("error_message", { message: "permission_denied: pause requires host/moderator" });
      return;
    }

    room.pause();

    io.to(roomId).emit("sync_state", room.getState());

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

    io.to(roomId).emit("sync_state", room.getState());

  });

  socket.on("change_video", ({ roomId, videoId }) => {

    const room = roomManager.getRoom(roomId);
    if (!room) return;
    if (!room.canControlPlayback(socket.id)) {
      socket.emit("error_message", { message: "permission_denied: change_video requires host/moderator" });
      return;
    }
    if (!videoId || typeof videoId !== "string") {
      socket.emit("error_message", { message: "invalid_video_id" });
      return;
    }

    room.changeVideo(videoId);

    io.to(roomId).emit("sync_state", room.getState());

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
