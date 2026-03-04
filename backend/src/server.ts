import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

import { RoomManager } from "./rooms/RoomManager";
import { Participant } from "./rooms/Participant";

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

  socket.on("join_room", ({ roomId, username }) => {

    let room = roomManager.getRoom(roomId);

    const isNewRoom = !room;
    const role = isNewRoom ? "host" : "participant";

    const user = new Participant(socket.id, username, role);

    if (isNewRoom) {
      room = roomManager.createRoom(roomId, user);
    } else {
      room.addParticipant(user);
    }

    socket.join(roomId);

    io.to(roomId).emit("user_joined", {
      participants: room.getParticipants()
    });

  });

  socket.on("play", ({ roomId }) => {

    const room = roomManager.getRoom(roomId);
    if (!room) return;

    room.play();

    io.to(roomId).emit("sync_state", room.getState());

  });

  socket.on("pause", ({ roomId }) => {

    const room = roomManager.getRoom(roomId);
    if (!room) return;

    room.pause();

    io.to(roomId).emit("sync_state", room.getState());

  });

  socket.on("seek", ({ roomId, time }) => {

    const room = roomManager.getRoom(roomId);
    if (!room) return;

    room.seek(time);

    io.to(roomId).emit("sync_state", room.getState());

  });

  socket.on("change_video", ({ roomId, videoId }) => {

    const room = roomManager.getRoom(roomId);
    if (!room) return;

    room.changeVideo(videoId);

    io.to(roomId).emit("sync_state", room.getState());

  });

  socket.on("disconnect", () => {

    console.log("User disconnected:", socket.id);

  });

});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});