export interface Actor { id: string; role: string }

// The owner of a resource, or an admin, may manage it.
export function canManage(user: Actor, ownerId: string): boolean {
  return user.role === "ADMIN" || user.id === ownerId;
}
