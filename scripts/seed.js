// Seed the two persistent test accounts + the Precision Crew business team.
// Usage: node scripts/seed.js  (requires DATABASE_URL in .env)
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { prisma } = require('../db');

// Safety: never seed known-password test accounts into a production database.
if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_SEED) {
  console.error('Refusing to seed test accounts in production. Set ALLOW_SEED=1 to override.');
  process.exit(1);
}

async function main() {
  const password = await bcrypt.hash('TestPass123!', 10);
  const stats = {
    reliabilityScore: 100, givenRatingsAvg: 0, receivedRatingsAvg: 0,
    totalGivenReviews: 0, totalReceivedReviews: 0, complainerScore: 0,
    completionRate: 100, cancellationRate: 0, disputeRate: 0,
    jobsCompleted: 0, jobsRequested: 0, timeWasterFlags: 0,
    providerLateFlags: 0, impatientFlags: 0
  };

  const poster = await prisma.user.upsert({
    where: { email: 'poster.sebenza.test1@example.com' },
    update: {},
    create: {
      name: 'Pieter Poster Test', email: 'poster.sebenza.test1@example.com',
      password, phone: '0710000001', lat: -33.9, lng: 25.57,
      skills: ['General work/Helper'], primaryCategory: 'General work/Helper',
      referralCode: 'PIET0001', communityStats: stats,
    }
  });
  const worker = await prisma.user.upsert({
    where: { email: 'worker.sebenza.test1@example.com' },
    update: {},
    create: {
      name: 'Nomsa Worker Test', email: 'worker.sebenza.test1@example.com',
      password, phone: '0710000002', lat: -33.9, lng: 25.58,
      skills: ['Cleaning'], primaryCategory: 'Cleaning',
      referralCode: 'NOMS0001', communityStats: stats,
    }
  });

  let team = await prisma.team.findFirst({ where: { supervisorId: poster.id } });
  if (!team) {
    team = await prisma.team.create({
      data: {
        supervisorId: poster.id, name: 'Precision Crew', type: 'business',
        lat: poster.lat, lng: poster.lng,
        members: { create: [{ userId: worker.id, inviteEmail: worker.email, name: worker.name, status: 'active', joinedAt: new Date() }] }
      }
    });
    await prisma.user.update({ where: { id: poster.id }, data: { teamId: team.id, teamRole: 'supervisor', accountType: 'business', businessName: 'Precision Crew' } });
    await prisma.user.update({ where: { id: worker.id }, data: { teamId: team.id, teamRole: 'member' } });
  }

  console.log('Seeded:', { poster: poster.id, worker: worker.id, team: team.id });
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
