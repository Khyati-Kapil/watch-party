import { Participant } from "./Participant";

export class Room {
  private participants = new Map<string, Participant>();
  private hostId: string;

  private videoId: string = "";
  private playState: "playing" | "paused" = "paused";
  private currentTime: number = 0;

  constructor(public roomId: string, host: Participant) {
    this.hostId = host.socketId;
    this.participants.set(host.socketId, host);
  }

  addParticipant(user: Participant) {
    this.participants.set(user.socketId, user);
  }

  removeParticipant(socketId: string) {
    this.participants.delete(socketId);
  }

  getParticipants() {
    return Array.from(this.participants.values());
  }

  play() {
    this.playState = "playing";
  }

  pause() {
    this.playState = "paused";
  }

  seek(time: number) {
    this.currentTime = time;
  }

  changeVideo(videoId: string) {
    this.videoId = videoId;
    this.currentTime = 0;
    this.playState = "paused";
  }

  getState() {
    return {
      videoId: this.videoId,
      playState: this.playState,
      currentTime: this.currentTime
    };
  }
}