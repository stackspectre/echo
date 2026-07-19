/**
 * scripts/seed-feedback.js
 *
 * Bulk-inserts realistic-looking feedback directly into MongoDB, bypassing
 * the API entirely (so the rate limiter doesn't get in the way, and it's
 * fast — thousands of entries in a couple seconds via insertMany).
 *
 * Usage:
 *   node scripts/seed-feedback.js 500        → adds 500 feedback entries
 *   node scripts/seed-feedback.js 2000        → adds 2000 (good load-test size)
 *   node scripts/seed-feedback.js --clear      → deletes ALL feedback (asks to confirm)
 *
 * Or via npm:
 *   npm run seed -- 500
 *   npm run seed -- --clear
 */

require("dotenv").config();
const readline = require("readline");
const { connectDb, Feedback } = require("../db");

const FIRST_NAMES = [
  "Aditi", "Rohan", "Meera", "Kabir", "Priya", "Arjun", "Sana", "Devraj", "Riya", "Vikram",
  "Neha", "Aarav", "Ishita", "Kunal", "Tanya", "Rahul", "Ananya", "Siddharth", "Pooja", "Karan",
  "Divya", "Amit", "Sneha", "Nikhil", "Kavya", "Yash", "Anjali", "Varun", "Simran", "Aryan",
  "Naomi", "Ethan", "Chloe", "Liam", "Zara", "Mateo", "Ines", "Felix", "Amara", "Leo",
];
const LAST_NAMES = [
  "Sharma", "Mehta", "Iyer", "Singh", "Kapoor", "Nair", "Gupta", "Reddy", "Joshi", "Malhotra",
  "Verma", "Chatterjee", "Bhatt", "Rao", "Desai", "Khanna", "Pillai", "Menon", "Saxena", "Bose",
  "Fernandes", "D'Souza", "Chowdhury", "Agarwal", "Kulkarni", "Bansal", "Chauhan", "Trivedi",
];
const DOMAINS = ["gmail.com", "outlook.com", "yahoo.com", "proton.me", "workmail.com", "icloud.com"];

const TEMPLATES = {
  5: [
    "Migrated our whole team over last week. Everyone actually opens it now instead of avoiding it.",
    "The realtime updates feel like magic — posted from my phone and watched it appear on my laptop instantly.",
    "Been using this for three weeks and I'm consistently impressed by how polished it feels.",
    "This completely changed how we collect feedback. No more scattered spreadsheets.",
    "Support replied in nine minutes on a Sunday. Nine minutes! And they actually fixed it.",
    "Exactly what we needed — simple, fast, and nobody had to be trained on how to use it.",
    "The reply threads make it feel like an actual conversation instead of a one-way form.",
    "Clean, fast, and it just works. Hard to ask for more from a tool like this.",
    "Genuinely the best feedback tool I've used at any company, and I've used a lot of them.",
    "Our response rate tripled after switching. People actually want to leave feedback now.",
  ],
  4: [
    "Really solid experience overall. Only wish reply notifications were a touch faster.",
    "Onboarding was smooth, just lost my place once when I switched tabs mid-setup.",
    "Good product. The mobile experience could use a little more polish around the composer.",
    "Does everything we need. Search could be a bit smarter about typos.",
    "Very happy with it so far — the admin panel is more useful than I expected.",
    "Solid core product, though pricing tiers took me a minute to fully understand.",
    "Works great day to day. Would love a way to filter by date range on the wall.",
    "Impressed overall. The like/reply system is intuitive, took zero explaining to my team.",
  ],
  3: [
    "It's fine. Does what it says, nothing more, nothing less.",
    "Decent tool, but I keep forgetting it exists until someone else mentions it.",
    "Works as expected. Wish there was a bit more customization on the composer.",
    "Middle of the road — not bad, not amazing. Gets the job done.",
    "Fine for small teams. Not sure how it'd hold up at a much bigger scale.",
    "Reasonable experience. The rating picker took me a second to understand at first.",
  ],
  2: [
    "Ran into a couple of bugs submitting from mobile Safari. Needs polish.",
    "Admin panel feels a bit bare — would like more filtering options.",
    "It's okay but the search feature missed some obvious matches for me.",
    "Had to refresh twice before my reply showed up. Otherwise fine.",
  ],
  1: [
    "Feedback didn't seem to save the first time I tried — had to resubmit.",
    "Confusing at first, took a while to understand how replies worked.",
    "Ran into a loading issue on our office wifi, wasn't sure if it went through.",
  ],
};

const REPLY_TEMPLATES = [
  "Thanks for flagging this — logging it for our next sprint.",
  "Really appreciate the specific detail here, this helps a lot.",
  "Totally agree with this one.",
  "We're on it! Should be fixed within the week.",
  "Glad to hear it's working well for your team.",
  "Could you share a bit more detail? Want to make sure we reproduce this correctly.",
  "This is being rebuilt this month — your timing is perfect.",
];
const REPLY_NAMES = ["Team Echo", "Priya N.", "Dev Support", "Arjun (Support)"];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function weightedRating() {
  // skews positive, like most real product feedback: mostly 4-5, some 3, few 1-2
  const r = Math.random();
  if (r < 0.40) return 5;
  if (r < 0.70) return 4;
  if (r < 0.85) return 3;
  if (r < 0.95) return 2;
  return 1;
}

function randomPastDate(maxDaysAgo) {
  const ms = Math.random() * maxDaysAgo * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
}

function buildFeedback() {
  const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
  const email = `${name.split(" ")[0].toLowerCase()}.${name.split(" ")[1].toLowerCase()}${Math.floor(Math.random() * 999)}@${pick(DOMAINS)}`;
  const rating = weightedRating();
  const text = pick(TEMPLATES[rating]);
  const createdAt = randomPastDate(45);

  const replies = [];
  if (Math.random() < 0.28) {
    const replyCount = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < replyCount; i++) {
      replies.push({
        name: pick(REPLY_NAMES),
        text: pick(REPLY_TEMPLATES),
        createdAt: new Date(createdAt.getTime() + (i + 1) * 1000 * 60 * 60 * (1 + Math.random() * 20)),
      });
    }
  }

  const likedBy = [];
  const likeCount = Math.floor(Math.random() * (rating >= 4 ? 60 : 15));
  for (let i = 0; i < likeCount; i++) likedBy.push(`seed-client-${Math.random().toString(36).slice(2)}`);

  return { name, email, rating, text, createdAt, replies, likedBy };
}

async function seed(count) {
  console.log(`Generating ${count} feedback entries...`);
  const docs = Array.from({ length: count }, buildFeedback);
  const start = Date.now();
  await Feedback.insertMany(docs);
  console.log(`✓ Inserted ${count} feedback entries in ${Date.now() - start}ms`);
}

async function clear() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) =>
    rl.question("This will permanently delete ALL feedback in the database. Type 'yes' to confirm: ", resolve)
  );
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") {
    console.log("Cancelled — nothing was deleted.");
    return;
  }
  const { deletedCount } = await Feedback.deleteMany({});
  console.log(`✓ Deleted ${deletedCount} feedback entries.`);
}

async function main() {
  await connectDb();
  const arg = process.argv[2];

  if (arg === "--clear") {
    await clear();
  } else {
    const count = parseInt(arg, 10);
    if (!count || count < 1) {
      console.log('Usage: node scripts/seed-feedback.js <count>   e.g. node scripts/seed-feedback.js 500');
      console.log('       node scripts/seed-feedback.js --clear   to wipe all feedback');
      process.exit(1);
    }
    await seed(count);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});