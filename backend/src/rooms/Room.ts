import { Participant } from "./Participant";

type PlayState = "playing" | "paused";

export class Room {
  private participants = new Map<string, Participant>();
  private hostId: string;

  private videoId: string = "";
  private playState: PlayState = "paused";
  private currentTime: number = 0;

  constructor(public roomId: string, host: Participant) {
    this.hostId = host.socketId;
    this.participants.set(host.socketId, host);
  }

  addParticipant(user: Participant) {
    this.participants.set(user.socketId, user);
  }

  removeParticipant(socketId: string) {
    const removed = this.participants.get(socketId);
    if (!removed) {
      return { removed: undefined, newHost: undefined };
    }

    this.participants.delete(socketId);

    let newHost: Participant | undefined;
    if (socketId === this.hostId && this.participants.size > 0) {
      const firstParticipant = this.participants.values().next().value as
        | Participant
        | undefined;
      if (firstParticipant) {
        this.hostId = firstParticipant.socketId;
        firstParticipant.setRole("host");
        newHost = firstParticipant;
      }
    }

    return { removed, newHost };
  }

  getParticipants() {
    return Array.from(this.participants.values());
  }

  getParticipant(socketId: string) {
    return this.participants.get(socketId);
  }

  hasParticipant(socketId: string) {
    return this.participants.has(socketId);
  }

  isEmpty() {
    return this.participants.size === 0;
  }

  canControlPlayback(socketId: string) {
    const participant = this.participants.get(socketId);
    if (!participant) return false;
    return participant.role === "host" || participant.role === "moderator";
  }

  canAssignRoles(socketId: string) {
    return socketId === this.hostId;
  }

  assignRole(requesterId: string, targetId: string, role: "moderator" | "participant") {
    if (!this.canAssignRoles(requesterId)) {
      return { ok: false as const, reason: "only_host_can_assign_roles" };
    }

    const target = this.participants.get(targetId);
    if (!target) {
      return { ok: false as const, reason: "participant_not_found" };
    }

    target.setRole(role);
    return { ok: true as const, participant: target };
  }

  canRemoveParticipants(socketId: string) {
    return socketId === this.hostId;
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
