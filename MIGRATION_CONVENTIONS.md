# Mongo → Prisma/Supabase migration conventions (Sebenza)

Read `prisma/schema.prisma`, `db.js`, `utils/dto.js` first. The React client is
FROZEN — every route must keep its exact path, method, auth behavior, status
codes, and JSON response shape from the Mongoose version.

## Imports
```js
const { prisma } = require('../db');
const { toDTO, sanitizeUser, isId } = require('../utils/dto');
```
No `mongoose`, no `require('../models/...')` anywhere.

## Model accessors
`prisma.user`, `prisma.trustDoc`, `prisma.workExperience`, `prisma.endorsement`,
`prisma.team`, `prisma.teamMember`, `prisma.service`, `prisma.transaction`,
`prisma.job`, `prisma.application`, `prisma.review`, `prisma.message`,
`prisma.notification`, `prisma.smsVerification`, `prisma.verification`.

## Schema mapping gotchas
- IDs are UUID strings. `_id` does not exist in the DB — wrap every response
  object in `toDTO(...)`, which mirrors `id` into `_id` recursively and converts
  Decimal → Number. Validate ids with `isId(str)`; NEVER use 24-hex regexes or
  `mongoose.Types.ObjectId`.
- `user.location` is now two columns `lat`,`lng`. Where the client expects
  `location: {lat,lng}`, build it explicitly.
- Job applications are their own table: `prisma.application`
  (fields: jobId, applicantId, proposedAmount, status, negotiationHistory Json,
  …). `job.applications` is a relation include. `job.acceptedApplicationId`
  points at an application id.
- Team members are their own table: `prisma.teamMember` (team.members relation).
  Team QR session lives in `team.qrCode` / `team.qrExpiresAt` columns.
- User subarrays became tables: trustDocs → `prisma.trustDoc`, workExperience →
  `prisma.workExperience`, endorsedBy → `prisma.endorsement`
  (`userId` = endorsee, `endorserId` = voucher).
- `communityStats`, `bankAccount`, `portfolioImages`, image arrays,
  `negotiationHistory`, `pingLog`, `issueReports`, `workProofPhotos` etc. are
  JSONB (`Json`): read-modify-write the whole value
  (`data: { communityStats: {...updated} }`). Never assume `$inc`/`$push`.
- Money fields are Decimal: compare/compute with `Number(x)`; atomic changes
  via `{ increment: n }` / `{ decrement: n }`.

## populate() → include + rename
Mongo populate left the FK field holding the populated object (e.g.
`review.reviewerId.name`). Prisma `include` puts it under the relation name.
Convert to the client's expected shape:
```js
const rows = await prisma.review.findMany({ include: { reviewer: { select: { id:true, name:true, avatar:true } } } });
const out = rows.map(({ reviewer, ...r }) => ({ ...r, reviewerId: reviewer }));
res.json(toDTO(out));
```
Same pattern for `applicantId`, `posterId`, `supervisorId`, `serviceId`, etc.
When the code did NOT populate, the plain FK string is already correct.

## Misc
- `refreshTrust(prisma, userId)` — new signature (`utils/trustScore.js`).
- Uploads: unchanged API — `upload` middleware + `uploadFile/uploadFiles`
  from `../middleware/upload` (now Supabase Storage).
- `findByIdAndUpdate(id, x)` → `prisma.X.update({ where: { id }, data })` —
  but update() throws if the row is missing; when the old code tolerated a
  missing row, use `updateMany` or catch P2025.
- Sorting: `orderBy: { createdAt: 'desc' }`; `limit` → `take`; `.select()` →
  `select: {...}` (must include `id: true` when selecting).
- Keep notification sending (`utils/notifications`) and socket emits identical.
- Auth middleware in each route file stays as-is (JWT, sets req.userId or
  req.user.userId — keep whichever that file used).
