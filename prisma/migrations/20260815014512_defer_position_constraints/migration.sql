DROP INDEX "modules_course_id_position_key";
ALTER TABLE "modules" ADD CONSTRAINT "modules_course_id_position_key" UNIQUE ("course_id", "position") DEFERRABLE INITIALLY DEFERRED;

DROP INDEX "lessons_module_id_position_key";
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_module_id_position_key" UNIQUE ("module_id", "position") DEFERRABLE INITIALLY DEFERRED;
