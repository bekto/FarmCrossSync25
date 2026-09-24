/**
 * Farms & membership constants and guards.
 *
 * Rule: a farm holds a maximum of 16 members. Reject joins once the farm is at
 * capacity (see specs/farm-crosssync-25/systems/farms-and-membership.md).
 */
export const MAX_FARM_MEMBERS = 16;

export class FarmCapacityError extends Error {
  constructor() {
    super(`farm_capacity_reached: maximum ${MAX_FARM_MEMBERS} members per farm`);
    this.name = "FarmCapacityError";
  }
}

export const isAtCapacity = (memberCount: number) =>
  memberCount >= MAX_FARM_MEMBERS;

export const assertCanAddMember = (memberCount: number): void => {
  if (isAtCapacity(memberCount)) throw new FarmCapacityError();
};

/**
 * Farm code generation. A code is a short invitation handle (shape `X7K9-PQ2`),
 * case-insensitive, unique across farms. It is not a credential.
 *
 * Confusables (I, O, 0, 1) are omitted so codes survive being read aloud or
 * typed by hand.
 */
export const FARM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const FARM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{3}$/;

export const MAX_CODE_ATTEMPTS = 10;

const randomChars = (n: number) =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(n)),
    (b) => FARM_CODE_ALPHABET[b % FARM_CODE_ALPHABET.length],
  ).join("");

export const generateFarmCode = (): string =>
  `${randomChars(4)}-${randomChars(3)}`;

export const normalizeFarmCode = (code: string) => code.trim().toUpperCase();

/**
 * Outcome of a join-by-code request, given the caller's current relationship to
 * the farm. A denied invite is not represented here: a denied user is free to
 * request again, so the handler inserts a fresh `pending` row rather than
 * reopening the old one.
 */
export type JoinRequestState =
  | "already_member"
  | "pending_request"
  | "create_request";

export const decideJoinRequest = (
  isMember: boolean,
  hasPendingInvite: boolean,
): JoinRequestState => {
  if (isMember) return "already_member";
  if (hasPendingInvite) return "pending_request";
  return "create_request";
};

/**
 * Whether `caller` may remove `target` from a farm. Any member may remove
 * themselves (leave); only the owner may remove someone else (kick). The caller
 * with no membership can only satisfy the self case, and the handler verifies
 * the target row exists before trusting this.
 */
export const canRemoveMember = (
  callerId: string,
  callerRole: string | null,
  targetUserId: string,
): boolean => targetUserId === callerId || callerRole === "owner";

/**
 * Outcome of an owner-initiated ownership transfer. Only the current owner may
 * transfer, the target must already be a member, and self-transfer is a
 * meaningless no-op (and would demote the caller), so it is rejected.
 */
export type OwnershipTransferDecision =
  | "forbidden"
  | "target_not_found"
  | "cannot_transfer_to_self"
  | "transfer";

export const decideOwnershipTransfer = (
  callerId: string,
  callerRole: string | null,
  targetUserId: string,
  targetRole: string | null,
): OwnershipTransferDecision => {
  if (callerRole !== "owner") return "forbidden";
  if (targetRole === null) return "target_not_found";
  if (targetUserId === callerId) return "cannot_transfer_to_self";
  return "transfer";
};

/**
 * Generates a code that `codeExists` reports as free. `codeExists` is injected
 * so collision handling is deterministically testable.
 */
export const generateUniqueFarmCode = async (
  codeExists: (code: string) => Promise<boolean>,
): Promise<string> => {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateFarmCode();
    if (!(await codeExists(code))) return code;
  }
  throw new Error("farm_code_collision: exhausted attempts");
};
