// Runs inside every test worker before any test file: a second safety net.
const url = process.env.DATABASE_URL || "";
const path = url.split("?")[0];
const name = path.substring(path.lastIndexOf("/") + 1);

if (!name.endsWith("_test")) {
  throw new Error("Refusing to run tests against '" + name + "'. The database name must end with _test.");
}
