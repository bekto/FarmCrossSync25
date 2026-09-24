# Farms & Membership

## Purpose
Define the trusted group of players who can see and fetch each other's cloud saves, and keep that group under owner control.

## User-facing behaviour
- Create Farm: name + bound local save. The creator becomes owner and receives a short farm code (example shape `X7K9-PQ2`) shown with a copy action.
- Join Farm: enter a farm code → "Request to Join" → pending until the owner acts.
- Owner sees Join Requests with Accept / Deny.
- Farm screen shows members with their last upload time; the farm name and code stay visible.
- Owner-only actions on player rows: "Make owner" (transfer ownership) and kick. Kick and leave both remove the player and delete their cloud save in that farm.
- Leave Farm is available to every member (Settings and/or player row).
- Multi-farm membership with one active farm, switched by a dropdown on the Farm screen.
- Ownership transfer is immediate and confirmed with a dialog. The previous owner remains a member.

## Data it manages
- Farm: id, code, name, owner_id, created_at.
- Membership: farm_id, user_id, role (owner | member), joined_at. Joined order drives succession.
- Join requests: id, farm_id, user_id, status (pending | accepted | denied), created_at.
- Constraints: maximum 16 members per farm.

## Interfaces
- `POST /farms` — create (name + creator becomes owner).
- `GET /farms/:farmId` — farm detail for members.
- `POST /farms/:farmId/join` — request to join by code.
- `GET /farms/:farmId/invites` — pending requests (owner).
- `POST /invites/:inviteId/accept` and `POST /invites/:inviteId/deny` — owner only.
- `GET /farms/:farmId/members` — member list.
- `DELETE /farms/:farmId/members/:userId` — owner kick, or self-leave.
- `POST /farms/:farmId/transfer-owner` — owner hands ownership to a chosen member.
- Consumes: authenticated identity from Identity & Auth. Emits: membership facts to Cloud Save Sync (authorization source) and to Desktop UI (polls every 20s).

## Edge cases & constraints
- Farm code is only an invitation mechanism, not a credential. Every operation still requires authenticated, server-verified membership. Codes are short, case-insensitive, randomly generated, and unique (regenerate on collision).
- Only the owner approves/denies requests, kicks, and transfers ownership.
- Kick = leave: membership ends and that player's cloud save in the farm is deleted. Local saves are untouched.
- Owner leave-succession: ownership goes to the earliest-joined remaining member (oldest `joined_at`). If no members remain, the farm and all its cloud saves are deleted.
- Last member leaving (including owner alone) deletes the farm entirely and cascades to all cloud saves and pending requests.
- Transfer-owner is immediate; the new owner inherits pending join requests.
- Reject joins when the farm is at 16 members.
- Re-joining while a request is already pending returns "pending request"; joining while already a member returns "already a member". A denied request may be re-submitted later.
- A player cannot accept their own join request (they are not owner until accepted).
- Never trust client-supplied membership or role claims; verify on every request.
- There is no "official farm save" object. The dashboard simply shows the latest upload; players download whichever member's save they want.
