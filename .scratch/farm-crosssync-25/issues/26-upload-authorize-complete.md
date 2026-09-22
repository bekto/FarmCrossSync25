# 26: Upload authorize and complete

**What to build:** Worker-side upload authorization for the caller's own slot and metadata completion after the direct-to-R2 put, replacing any previous save in that slot.

**Priority:** P0

**Blocked by:** 25

**Status:** pending

- [ ] `upload-authorize` verifies authentication, farm membership, and slot ownership before issuing temporary write authorization
- [ ] A non-member or another user's slot gets 403
- [ ] `upload-complete` replaces player_saves metadata and any previous entry for that slot
- [ ] The Worker never streams save bytes
- [ ] An authorize without a complete leaves previous metadata authoritative

## Work Log
