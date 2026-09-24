Farm CrossSync 25
1. Product Overview
Farm CrossSync 25 is a cross-platform desktop application for Farming Simulator 25 that allows friends playing the same multiplayer farm to safely share their latest savegames through the cloud.
The core problem:
Friends playing the same FS25 farm need an easy way to exchange the latest savegame without manually copying folders between PCs.
The application provides:
    • Automatic FS25 save discovery.
    • Manual save-folder selection when needed.
    • Validation that a selected folder is actually an FS25 savegame.
    • Farm creation.
    • Farm join requests.
    • Owner approval/denial.
    • Farm membership.
    • One cloud save per player per farm.
    • One-click save upload.
    • One-click download of another player's save.
    • Automatic local backup before overwriting.
    • SHA-256 verification.
    • Local/cloud change detection.
    • Windows and Linux support.
    • Cloudflare-based backend.
    • Simple desktop UI.
The application does not merge FS25 saves.
Each player has their own complete cloud save. Downloading another player's save replaces the local save after a backup is created.

2. Product Philosophy
Keep the product intentionally small.
The core promise is:
Everyone in our FS25 farm can safely share their latest save without manually copying files.
Every feature should support one of these actions:
    1. Find an FS25 save.
    2. Create a farm.
    3. Join a farm.
    4. Approve members.
    5. Upload a save.
    6. See other players' saves.
    7. Download another player's save.
    8. Safely replace the local save.
Anything outside that should be considered a future feature unless it is required for reliability or security.

3. MVP Scope
Included
    • Windows
    • Linux
    • Tauri 2
    • Rust backend
    • Svelte + TypeScript frontend
    • Single local-first monorepo
    • Device-generated identity
    • Player display name
    • FS25 automatic save discovery
    • Manual save-folder selection
    • Save-folder validation
    • Farm creation
    • Farm code
    • Join requests
    • Owner approval/denial
    • Farm membership
    • Player list
    • One cloud save per player per farm
    • Save upload
    • Save download
    • Automatic local backup
    • SHA-256 verification
    • Timestamp metadata
    • Local/cloud change detection
    • Conflict warning
    • Basic settings
    • Cloudflare Workers
    • Cloudflare D1
    • Cloudflare R2
Explicitly excluded from MVP
    • Mods synchronization
    • Mod downloading
    • Mod version management
    • Full save history
    • Cloud save history
    • Save merging
    • Chat
    • Voice communication
    • Dedicated servers
    • Matchmaking
    • Public farm discovery
    • Global friends system
    • Social features
    • Mobile app
    • Automatic multiplayer management
    • Complex account system
    • Realtime WebSockets
    • Analytics
    • Advertising

4. Project / Repository Structure
The project is a single local-first Git monorepo; see the root README.md for the authoritative layout.
Local development structure:
FarmCrossSync25/
│
├── FarmCrossSync25-app/       Desktop application (Tauri 2 + Rust + Svelte)
├── FarmCrossSync25-backend/   Cloudflare Worker (Hono + D1 + R2)
├── specs/                     Active specifications
├── docs/                      Durable documentation
└── .scratch/                  Ticket pool and progress index
Component 1 — Desktop application
FarmCrossSync25-app/
Contains:
    • Tauri application.
    • Rust local filesystem logic.
    • Svelte frontend.
    • FS25 detection.
    • Save management.
    • Local backup system.
    • API client.
    • UI.
    • Documentation.
The desktop application is intended to eventually become public on GitHub.
Component 2 — Backend
FarmCrossSync25-backend/
Contains:
    • Cloudflare Worker.
    • Hono API.
    • D1 migrations.
    • R2 integration.
    • Authentication logic.
    • Authorization logic.
    • Farm management.
    • Invite system.
    • Deployment configuration.
The backend does not need to be published separately; the repository can be published later if the project becomes fully open-source/self-hostable.

5. Local Git Strategy
The monorepo uses Git from the beginning.
Initially:
local Git only
No GitHub remote is required.
Later:
git remote add origin ...
git push
The development workflow should therefore work completely offline/local except when testing real cloud services.
This allows OpenCode to:
    • Create commits.
    • Review changes.
    • Compare versions.
    • Revert changes.
    • Work independently on client/backend.
    • Keep client and backend changes in one history.

6. Development Environment
The project should support three environments.
Local
Tauri
   ↓
local Worker
   ↓
local D1
   ↓
local R2 simulation
Used for normal development and automated testing.
Staging
Tauri development build
        ↓
Cloudflare staging Worker
        ↓
staging D1
        ↓
staging R2
Used to verify real Cloudflare behavior.
Production
Released Tauri application
        ↓
production Worker
        ↓
production D1
        ↓
production R2
Production should only be introduced after the application works locally.

7. Cloudflare Architecture
                 Farm CrossSync 25
                     Tauri App
                         │
                         │ HTTPS
                         ▼
               ┌───────────────────┐
               │ Cloudflare Worker │
               │                   │
               │ Authentication    │
               │ Farms             │
               │ Membership        │
               │ Invitations       │
               │ Permissions       │
               │ Save metadata     │
               │ R2 authorization  │
               └─────────┬─────────┘
                         │
                ┌────────┴────────┐
                │                 │
                ▼                 ▼
           ┌─────────┐       ┌─────────┐
           │   D1    │       │   R2    │
           │ Metadata│       │  Files  │
           └─────────┘       └─────────┘
Worker
Responsible for:
    • Authentication.
    • Authorization.
    • Farm creation.
    • Farm joining.
    • Invitations.
    • Membership.
    • Save metadata.
    • Upload authorization.
    • Download authorization.
    • Permissions.
D1
Stores structured metadata.
R2
Stores actual save files.
The backend should not need to understand the contents of an FS25 save.

8. Cloudflare Development Strategy
Cloudflare does not need to be connected from the beginning.
The backend should first be developed locally using Wrangler.
OpenCode can develop:
    • Worker code.
    • D1 schema.
    • R2 integration.
    • API endpoints.
    • Tests.
    • Local development environment.
Once the backend is ready, Cloudflare can be connected.
The eventual workflow can be:
OpenCode
   ↓
local development
   ↓
tests
   ↓
Cloudflare login
   ↓
create staging resources
   ↓
deploy
   ↓
test
   ↓
production deployment
Production deployment should have a human checkpoint before destructive infrastructure operations.

9. Backend Secrets
The client must never contain:
    • Cloudflare API tokens.
    • R2 secret keys.
    • R2 access keys.
    • Database credentials.
    • JWT signing secrets.
    • Other production secrets.
Secrets belong in Cloudflare/Worker secret storage or local development secret files that are excluded from Git.
The desktop application only knows the API endpoint.
Example:
https://api.farmcrosssync.com

10. Device Identity
On first launch, the application generates a random UUID.
Example:
installation_id:
7f6a9c2e-4c4d-4e7e-a4d2-...
The user then chooses a display name:
Welcome

What should your friends see you as?

[ Bekto ]

[ Continue ]
The installation ID is registered with the backend.
The backend creates a user and issues a server-controlled authentication/session credential.
The UUID is not intended to be a permanent secret.
Do not use:
    • MAC addresses.
    • Hardware fingerprints.
    • CPU IDs.
    • Windows hardware IDs.
The system should use random identifiers and server-issued credentials.

11. User Model
User
├── id
├── installation_id
├── display_name
├── created_at
└── last_seen_at
A user can belong to multiple farms.
The display name can be changed later.

12. FS25 Save Discovery
The application should automatically search for FS25 saves first.
The user should not normally need to manually locate the save directory.
Initial screen:
FS25 Save Location

We can automatically search for your
Farming Simulator 25 saves.

[ Scan Automatically ]

or

[ Select Folder ]
The Tauri/Rust side performs the search.

13. Platform-Specific FS25 Discovery
Filesystem discovery belongs entirely to the desktop application.
Suggested structure:
src-tauri/
└── fs25/
    ├── mod.rs
    ├── discovery/
    │   ├── windows.rs
    │   └── linux.rs
    │
    ├── validator.rs
    ├── metadata.rs
    ├── hash.rs
    └── backup.rs
The frontend should not contain platform-specific filesystem logic.

14. FS25 Path Types
Keep these concepts separate:
FS25 installation
        ≠
FS25 user data
        ≠
specific savegame
The application may not need the installation path for the MVP.
The important path is the actual selected savegame.

15. Automatic Save Scanning
The scanner should search likely FS25 save locations for the current operating system.
For Linux, it should account for common Steam/Proton setups.
For Windows, it should account for the normal Documents/My Games location.
The scanner returns candidate savegames.
Example:
Found 3 savegames

○ Savegame 1
  Zielonka

○ Savegame 2
  Elmcreek

○ Savegame 3
  Riverbend Springs

[ Select ]

16. Manual Save Folder Selection
The user can manually select a folder.
The application must validate the selected folder.
It should not simply trust:
path exists
Instead:
Folder exists
        +
is directory
        +
is readable
        +
contains expected FS25 save structure
        +
expected metadata can be parsed
The exact FS25 validation markers should be determined from real FS25 savegames during implementation.
Do not hardcode assumptions before inspecting actual savegame structures.

17. Save Validation States
Valid
✓ FS25 savegame detected

Savegame 1
Map: Zielonka
Last modified: Today, 18:42
Suspicious
⚠ This appears to be an FS25 save,
but some expected files are missing.
Invalid
✕ This doesn't appear to be an FS25 savegame.

Please select an FS25 savegame folder.
Inaccessible
✕ The application cannot access this folder.

18. Save Metadata
Where practical, extract useful local metadata.
Potential metadata:
save slot
map
last modified
path
size
hash
The exact fields should be determined after inspecting actual FS25 saves.
The application should avoid unnecessarily parsing the entire save.

19. Local Save Scanner API
The frontend should communicate with Rust through a small abstraction.
Example:
scan_fs25_saves()
Returns something similar to:
[
  {
    "path": ".../savegame1",
    "slot": 1,
    "valid": true,
    "map": "Zielonka",
    "last_modified": "..."
  }
]
The exact API should be finalized during implementation.

20. Farm Creation
User selects:
Create Farm
Example:
Create Farm

Farm name
[ Bekto's Farm ]

FS25 Save
[ Savegame 1 ▼ ]

[ Create Farm ]
The backend creates:
farm_id
farm_code
owner_id
farm_name
created_at
The creator automatically becomes the owner.

21. Farm Code
Example:
X7K9-PQ2
The code should be:
    • Short.
    • Easy to type.
    • Case-insensitive.
    • Randomly generated.
    • Unique.
The farm code is an invitation mechanism.
It is not the actual security credential.
All operations still require authenticated membership authorization.

22. Farm Model
Farm
├── id
├── code
├── name
├── owner_id
└── created_at

23. Joining a Farm
Player chooses:
Join Farm
and enters:
Farm code

[ X7K9-PQ2 ]

[ Request to Join ]
The backend verifies the farm and creates a pending request.

24. Join Request Model
FarmInvite
├── id
├── farm_id
├── user_id
├── status
└── created_at
Possible states:
pending
accepted
denied

25. Owner Approval
Owner sees:
Join Requests

Marko
Wants to join Bekto's Farm

[ Accept ] [ Deny ]
Accept:
invite.status = accepted
and create:
farm_members
Deny:
invite.status = denied
Only the owner can approve/deny members in the MVP.

26. Farm Membership
FarmMember
├── farm_id
├── user_id
├── role
└── joined_at
Roles:
owner
member
Members can:
    • See farm members.
    • See uploaded saves.
    • Upload their own save.
    • Download other members' saves.
Members cannot:
    • Modify another player's save.
    • Manage membership.
    • Accept requests.
    • Modify farm ownership.

27. Farm Dashboard
The main screen should be centered around the current farm.
Example:
┌──────────────────────────────────────────────┐
│ Bekto's Farm                       X7K9-PQ2 │
├──────────────────────────────────────────────┤
│                                              │
│ Latest Save                                  │
│                                              │
│ Marko                                         │
│ Updated 5 minutes ago                        │
│                                              │
│ [ Download Latest ]   [ Upload My Save ]     │
│                                              │
├──────────────────────────────────────────────┤
│ Players                                      │
│                                              │
│ ● Bekto          Updated 12 min ago          │
│ ● Marko          Updated 5 min ago           │
│ ● Adnan          Updated 1 hour ago          │
│                                              │
└──────────────────────────────────────────────┘
The exact visual design can evolve during prototyping.

28. Player Save Model
Every player gets one current cloud save per farm.
Example:
Farm
└── players
    ├── user-A
    │   └── save
    ├── user-B
    │   └── save
    └── user-C
        └── save
Uploading again replaces the existing object.
There is no cloud history in the MVP.

29. R2 Object Layout
Suggested:
farms/{farm_id}/players/{user_id}/save
Use immutable IDs rather than player names.
This avoids problems when a player changes their display name.

30. Save Metadata in D1
PlayerSave
├── farm_id
├── user_id
├── object_key
├── file_size
├── sha256
├── save_name
└── uploaded_at
Example UI:
Farm Saves

Bekto
Updated 5 minutes ago

Marko
Updated 23 minutes ago

Adnan
Updated 1 hour ago

31. Upload Architecture
The desktop app should not contain permanent R2 credentials.
Flow:
Tauri
   |
   | request upload authorization
   v
Worker
   |
   | verify authentication
   | verify farm membership
   | verify ownership of save slot
   v
temporary authorized upload
   |
   v
R2
The actual save file should preferably go directly between the client and R2 rather than unnecessarily passing through the Worker.
After upload:
Tauri → Worker

upload complete
The Worker updates the save metadata.

32. Upload Flow
Player clicks:
Upload My Save
Application:
    1. Finds configured local save.
    2. Validates the save.
    3. Calculates SHA-256.
    4. Requests upload authorization.
    5. Uploads to R2.
    6. Verifies successful upload.
    7. Sends completion metadata.
    8. Worker updates D1.
    9. Existing cloud save is replaced.
Progress UI:
Uploading Save...

████████████████░░░░ 82%

14.2 MB
Success:
Save uploaded

Bekto's save
Updated just now

33. Download Flow
Farm dashboard:
Farm Saves

Bekto
[ Download ]

Marko
[ Download ]

Adnan
[ Download ]
User chooses another player's save.
Confirmation:
Download Marko's Save?

This will replace your current local FS25 save.

A backup will automatically be created first.

[ Cancel ]     [ Download & Replace ]

34. Safe Download / Replacement
The application must never silently overwrite the local save.
Flow:
Local save
    ↓
Create backup
    ↓
Download cloud save
    ↓
Verify SHA-256
    ↓
Replace local save
    ↓
Update local sync state
If anything fails:
Original local save remains untouched.

35. Local Backups
Before every cloud download that replaces the local save, create a backup.
Example:
backups/
    2026-09-21_18-42-11/
    2026-09-21_19-05-33/
Backup retention is fixed at the latest five timestamped backups per save, pruned on creation.

36. Conflict Detection
The application must remember the last synchronized local state.
Local state:
last_synced_hash
last_synced_at
Cloud state:
cloud_hash
uploaded_at
If the local save has changed since the application last synchronized it, downloading another player's save should trigger a warning.
Example:
Your local save has changed.

Your current save is different from the last
version you synchronized.

What do you want to do?

[ Keep My Save ]

[ Download Cloud Save ]

[ Cancel ]
Never silently destroy a potentially newer local save.

37. Local Sync State
The desktop application should maintain small local metadata.
Example:
Farm
  ↓
Selected local save
  ↓
last synced hash
  ↓
last downloaded cloud save
This metadata should be stored locally, not in the cloud unless there is a specific reason to do so.

38. Cloud Save Semantics
The system is not merging saves.
Conceptually:
LOCAL SAVE
    ↕
CLOUD SAVE
Each player controls their own cloud save.
The farm provides access to other players' current cloud saves.
This keeps the product simple and avoids attempting to understand or merge FS25's internal save data.

39. Current Farm Save
The MVP does not need a separate "official/current farm save" object.
Instead, the farm can simply display:
Latest upload:
Marko
18:32
The player can download whichever member's save they want.
This avoids unnecessary backend state.

40. Authentication
Initial authentication should use device-based identity.
Flow:
Generate installation UUID
        ↓
Register
        ↓
Create user
        ↓
Receive server-issued session credential
        ↓
Store securely in Tauri
Do not initially add:
    • Email/password.
    • Google login.
    • Discord login.
    • Steam login.
A proper account/migration system can be added later if users need to move identities between PCs.

41. API Structure
Approximate initial API:
POST /register

GET  /me

POST /farms
GET  /farms/:farmId

POST /farms/:farmId/join

GET  /farms/:farmId/invites

POST /invites/:inviteId/accept
POST /invites/:inviteId/deny

GET  /farms/:farmId/members

GET  /farms/:farmId/saves

POST /saves/upload-authorize
POST /saves/upload-complete

POST /saves/:playerId/download-authorize

DELETE /farms/:farmId/members/:userId
This is a starting API shape.
The exact contract should be created later by to-spec.

42. Authorization
Every protected backend operation must verify:
authenticated user
        ↓
belongs to farm?
        ↓
authorized for requested operation?
        ↓
allow/deny
Never trust IDs supplied by the client.
For example:
A player can:
    • Upload their own save.
    • Download another player's save if they belong to the farm.
A player cannot:
    • Upload another player's save.
    • Modify another player's metadata.
    • Access another farm's saves.
    • Accept their own invite.
    • Manage farm membership unless they are the owner.

43. Realtime Notifications
Do not build WebSockets for MVP.
Use simple polling while the farm screen is open.
For example:
GET /farms/:id/invites
GET /farms/:id/saves
every 15–30 seconds.
If realtime behavior becomes important later, Cloudflare Durable Objects or another realtime system can be introduced.

44. Desktop Architecture
Farm CrossSync 25
│
├── src/
│   ├── UI
│   ├── pages
│   ├── components
│   └── API client
│
└── src-tauri/
    ├── fs25/
    │   ├── discovery/
    │   │   ├── windows.rs
    │   │   └── linux.rs
    │   ├── validator.rs
    │   ├── metadata.rs
    │   ├── hash.rs
    │   └── backup.rs
    │
    ├── auth/
    ├── filesystem/
    └── commands/
Frontend:
Svelte
TypeScript
Desktop/core:
Tauri 2
Rust

45. Frontend Responsibilities
The frontend handles:
    • UI.
    • Navigation.
    • Forms.
    • Loading states.
    • Errors.
    • Confirmation dialogs.
    • Farm dashboard.
    • Player list.
    • Save list.
    • Settings.
It should not directly perform privileged filesystem operations.
Those should go through Tauri/Rust commands.

46. Rust Responsibilities
Rust handles:
    • Filesystem access.
    • FS25 discovery.
    • Save validation.
    • Save metadata.
    • Hashing.
    • Backups.
    • Safe replacement.
    • Local sync metadata.
    • Secure credential storage.
    • OS-specific behavior.

47. Settings
Keep settings minimal:
Settings

Player name
[ Bekto ]

FS25 Save
[ Savegame 1 ]

Save path
[ /path/to/savegame1 ]

Farm ID
XXXXXXXX

Farm code
X7K9-PQ2

[ Change Save ]

[ Leave Farm ]
The application should auto-detect paths whenever possible.
Manual configuration remains available as a fallback.

48. Error Handling
No internet
Unable to connect to cloud.

Your local save has not been changed.
Upload failure
Upload failed.

Your local save is safe.
Download failure
Download failed.

Your existing save was not replaced.
Invalid farm
Farm not found.
Already member
You are already a member of this farm.
Pending request
Your join request is already pending.
Missing save
FS25 savegame could not be found.

Check your save location.
Invalid save
Selected folder does not appear to be an FS25 savegame.
Hash mismatch
Downloaded save failed verification.

Your local save was not replaced.

49. Failure Safety
The application should prioritize protecting the user's local save.
The rule is:
A failed cloud operation must never destroy the existing local save.
Especially:
    • Failed download.
    • Interrupted download.
    • Corrupt download.
    • Hash mismatch.
    • Permission failure.
    • Disk failure.
    • Network timeout.
The original local save must remain recoverable.

50. GUI Prototype Before Real Application
Completed and removed: the prototype was built (tickets 13–14), used to validate the UX, and deleted from the repository once the real Tauri application shipped. This section is retained as historical context only.
Before implementing the actual Tauri application, create a simple browser-based HTML/CSS/JavaScript prototype.
It should use fake data.
Prototype screens:
    • Welcome.
    • Create Farm.
    • Join Farm.
    • Farm Dashboard.
    • Players.
    • Join Request.
    • Upload.
    • Download.
    • Download confirmation.
    • Conflict.
    • Settings.
    • Error states.
Prototype interactions:
    • Create farm.
    • Join farm.
    • Copy farm code.
    • Accept/deny request.
    • Fake upload.
    • Fake download.
    • Fake progress.
    • Success state.
    • Conflict state.
    • Toasts.
    • Player selection.
The prototype exists to validate UX and visual design.
It does not need Tauri, Rust, Cloudflare, or real FS25 integration.

51. Visual Design Direction
The application should feel like a modern gaming utility.
General inspiration:
    • Steam.
    • Discord.
    • Game launchers.
    • Mod managers.
    • Modern desktop utilities.
Avoid:
    • Enterprise SaaS appearance.
    • Excessive dashboards.
    • Huge amounts of text.
    • Complicated navigation.
    • Social-media-style UI.
The farm and save actions should be obvious.
Target:
~1000 × 700 desktop
and remain usable around:
900 × 600

52. Suggested Main Navigation
Keep navigation minimal.
Possible:
Farm
Players
Settings
or even:
Farm
Settings
Players can simply be part of the Farm screen.
The exact structure should be decided during GUI prototyping.

53. MVP Development Stages
Stage 1 — FS25 Local Prototype
Build and test:
    • FS25 detection.
    • Save scanning.
    • Save validation.
    • Manual path selection.
    • Metadata extraction.
    • Hashing.
    • Backup.
    • Safe replacement.
Goal:
Find save
→ validate
→ backup
→ replace

Stage 2 — GUI Prototype
Browser-only.
Fake:
    • Farms.
    • Players.
    • Saves.
    • Upload.
    • Download.
    • Invites.
Goal:
Validate UX before implementing the real desktop application.

Stage 3 — Local Backend
Build:
Worker
D1
R2 simulation
Implement:
    • Registration.
    • Farms.
    • Membership.
    • Invitations.
    • Permissions.
    • Save metadata.
    • Upload.
    • Download.
Everything should work locally.

Stage 4 — Cloudflare Staging
Connect Cloudflare.
Create:
staging Worker
staging D1
staging R2
Test the actual cloud workflow.

Stage 5 — Tauri Integration
Connect the real frontend and Rust filesystem logic to the backend.
Implement:
    • Registration.
    • Authentication.
    • Farm creation.
    • Farm joining.
    • Invitations.
    • Save uploads.
    • Save downloads.
    • Backups.
    • Conflict detection.

Stage 6 — Production
Create:
production Worker
production D1
production R2
Deploy backend.
Configure production API URL.
Build Tauri release versions.

Stage 7 — Reliability Testing
Test:
    • Interrupted uploads.
    • Interrupted downloads.
    • Offline mode.
    • Corrupted saves.
    • Hash mismatch.
    • Duplicate requests.
    • Simultaneous uploads.
    • Large saves.
    • Missing FS25 installation.
    • Missing savegame.
    • Invalid paths.
    • Permission violations.
    • Multiple farms.
    • Multiple PCs.
    • Leaving/rejoining farms.
    • Backend failures.

54. Production Deployment
Production desktop application:
Tauri
    ↓
https://api.farmcrosssync.com
Backend:
Cloudflare Worker
    ↓
D1
R2
The public Tauri application does not need access to Cloudflare infrastructure directly.
It only communicates with the API.

55. GitHub Strategy
Eventually:
Public repository
Farm CrossSync 25
Contains the Tauri application.
Private repository
Farm CrossSync 25-backend
Contains the production backend.
The public application can safely contain:
API_BASE_URL=https://api.farmcrosssync.com
It must not contain secrets.
The backend repository contains deployment configuration but production secrets remain outside Git.

56. Potential Open-Source Future
The backend does not have to remain private forever.
If desired later, it can become:
Farm CrossSync 25
├── desktop client
└── backend
or remain two separate public repositories.
A self-hosting mode could eventually allow users to run:
Their Tauri app
      ↓
Their Worker
      ↓
Their D1
      ↓
Their R2
This is optional and not part of the MVP.

57. Security Principles
    1. Never put cloud secrets in the desktop client.
    2. Never trust client-supplied user IDs.
    3. Verify farm membership server-side.
    4. Verify save ownership server-side.
    5. Use random installation IDs.
    6. Use server-issued authentication credentials.
    7. Use temporary/authorized R2 access rather than permanent client credentials.
    8. Verify downloaded file hashes.
    9. Back up local saves before replacement.
    10. Never silently overwrite changed local data.
    11. Keep production secrets outside Git.
    12. Require explicit confirmation for destructive local operations.

58. MVP Definition of Done
The MVP is complete when two or more players can:
    1. Install the application.
    2. Choose their player names.
    3. Automatically discover FS25 saves.
    4. Manually select a save folder if discovery fails.
    5. Validate the selected folder as an FS25 save.
    6. Create a farm.
    7. Receive a farm code.
    8. Share the code with friends.
    9. Request to join.
    10. Owner accepts/denies the request.
    11. See farm members.
    12. Upload their current save.
    13. See when other players last uploaded.
    14. Download another player's save.
    15. Automatically back up their existing save.
    16. Verify the downloaded save.
    17. Safely replace the local save.
    18. Detect local changes before overwriting.
    19. Recover safely from failed uploads/downloads.
    20. Work on Windows and Linux.
If those functions work reliably, the product is already useful.

59. Final Technology Stack
Desktop
Tauri 2
Rust
Svelte
TypeScript
Backend
Cloudflare Workers
Hono
TypeScript
Database
Cloudflare D1
Object storage
Cloudflare R2
Local development
Wrangler
Local Worker
Local D1
Local R2 simulation
Version control
Git

Farm CrossSync 25
Farm CrossSync 25-backend

60. Final Architecture
                    USER
                     │
                     ▼
        ┌─────────────────────────┐
        │ Farm CrossSync 25       │
        │                         │
        │ Tauri                   │
        │ Svelte + TypeScript     │
        │ Rust                    │
        └────────────┬────────────┘
                     │
          ┌──────────┴───────────┐
          │                      │
          ▼                      ▼
     LOCAL FS25             HTTPS API
          │                      │
          │                      ▼
          │             ┌─────────────────┐
          │             │ Cloudflare      │
          │             │ Worker          │
          │             │                 │
          │             │ Auth            │
          │             │ Farms           │
          │             │ Members         │
          │             │ Invites         │
          │             │ Permissions     │
          │             │ Save metadata   │
          │             └───────┬─────────┘
          │                     │
          │              ┌──────┴──────┐
          │              ▼             ▼
          │           ┌──────┐      ┌──────┐
          │           │ D1   │      │ R2   │
          │           │ DB   │      │ Saves│
          │           └──────┘      └──────┘
          │
          ▼
   Local automatic backup

