import { Room } from "./Room";
import { Participant } from "./Participant";

export class RoomManager {
  private rooms = new Map<string, Room>();

  createRoom(roomId: string, host: Participant) {
    const room = new Room(roomId, host);
    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId: string) {
    return this.rooms.get(roomId);
  }

  findRoomBySocketId(socketId: string) {
    for (const room of this.rooms.values()) {
      if (room.hasParticipant(socketId)) {
        return room;
      }
    }
    return undefined;
  }

  deleteRoom(roomId: string) {
    this.rooms.delete(roomId);
  }
}
