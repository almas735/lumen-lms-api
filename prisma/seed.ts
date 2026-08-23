import { prisma } from "../src/lib/prisma";
import bcrypt from "bcrypt";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed in production");
  }

  console.log("Wiping existing data...");
  await prisma.refreshToken.deleteMany();
  await prisma.course.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash("Password123", 12);

  const admin = await prisma.user.create({
    data: { email: "admin@lumen.dev", passwordHash: passwordHash, fullName: "Dana Admin", role: "ADMIN" },
  });

  const instructorNames = ["Priya Instructor", "James Instructor", "Maria Instructor"];
  const instructorEmails = ["priya@lumen.dev", "james@lumen.dev", "maria@lumen.dev"];
  const instructors = [];
  for (let i = 0; i < 3; i++) {
    const u = await prisma.user.create({
      data: { email: instructorEmails[i], passwordHash: passwordHash, fullName: instructorNames[i], role: "INSTRUCTOR" },
    });
    instructors.push(u);
  }

  const studentNames = [
    "Sam Student", "Alex Student", "Jordan Student", "Taylor Student", "Casey Student",
    "Morgan Student", "Riley Student", "Jamie Student", "Drew Student", "Avery Student",
  ];
  const students = [];
  for (let i = 0; i < 10; i++) {
    const email = i === 0 ? "sam@lumen.dev" : "student" + (i + 1) + "@lumen.dev";
    const u = await prisma.user.create({
      data: { email: email, passwordHash: passwordHash, fullName: studentNames[i], role: "STUDENT" },
    });
    students.push(u);
  }

  const levels: ("BEGINNER" | "INTERMEDIATE" | "ADVANCED")[] = ["BEGINNER", "INTERMEDIATE", "ADVANCED"];
  const titles = [
    "Introduction to Web Development", "Advanced React Patterns", "Database Design Fundamentals",
    "Python for Data Science", "Machine Learning Basics", "UX Design Principles",
    "Cloud Computing Essentials", "JavaScript Deep Dive", "Mobile App Development",
    "DevOps and CI/CD", "API Design Best Practices", "Cybersecurity Fundamentals",
    "Agile Project Management", "TypeScript Mastery", "Docker and Containers",
    "System Design Interview Prep", "Git and Version Control", "SQL for Analysts",
    "Building REST APIs", "Introduction to Algorithms",
  ];

  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const status = i < 14 ? "PUBLISHED" : i < 18 ? "DRAFT" : "ARCHIVED";
    await prisma.course.create({
      data: {
        title: title,
        slug: slug,
        summary: "Learn " + title.toLowerCase() + " from the ground up, with hands-on examples.",
        description: "This course covers everything you need to know about " + title.toLowerCase() + ". You will build real projects and gain practical, hands-on experience along the way.",
        level: levels[i % 3],
        status: status,
        thumbnailUrl: "https://picsum.photos/seed/" + slug + "/400/240",
        instructorId: instructors[i % instructors.length].id,
        publishedAt: status === "PUBLISHED" ? new Date() : null,
      },
    });
  }

  console.log("Seeded:", admin.email, "+ 3 instructors + 10 students + 20 courses");
}

main().catch(function (e) { console.error(e); process.exit(1); }).finally(function () { return prisma.$disconnect(); });
