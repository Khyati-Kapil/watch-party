export type Role = "host" | "moderator" | "participant";

export class Participant {
  constructor(
    public socketId: string,
    public username: string,
    public role: Role
  ) {}

  setRole(role: Role) {
    this.role = role;
  }
} 

